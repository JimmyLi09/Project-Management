/* REQ-063 · KPI 看板补充(每月看 3 个数、PM 级别与季度项目分值、两个新维度)+ 项目修改记录
   重点:原来四个维度的评分和每个人的 KPI 总分在升级前后完全一致(scoreOf / computeKpi 老逻辑原样抄在下面对比)。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* applyAction 在 server/actions.ts 里,import 它会连带打开库 —— 给一个空的临时库 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audax-063-'));
process.env.AUDAX_DATA_DIR = dir;
process.env.AUDAX_NO_BACKUP = '1';
(globalThis as { require?: unknown }).require = (id: string) => {
  if (id === './demo') return { shouldSeedDemo: () => false, seedDemo: () => undefined };
  throw new Error(`unexpected require ${id}`);
};

const { newProject, migrate, projPoints } = await import('../project.ts');
const kpi = await import('../kpi.ts');
const {
  DEFAULT_KPI_RULES, DIMENSIONS, bandOf, companyCards, computeKpi, firstPassOf, inPeriod, kpiRulesForPeriod, onTimeOf,
  pointsIn, quarterOf, recentQuarterPoints, ruleSetFor, scoreOf, validateKpiRules,
} = kpi;
const rev = await import('../revisions.ts');
const { DEFAULT_REV_RULES, clientRounds, dueItems, effectivePkgs, needsReasonMeeting, quoteOverdue, recompute, roundMap, salesTodo } = rev;
const { DEFAULT_POINT_RULES } = await import('../points.ts');
const { promoChecklist, DEFAULT_PROMO } = await import('../train.ts');
const { canEditRev, canQuoteRev, canRecordRev, canWaiveRev } = await import('../permissions.ts');
const { PM_CLOSED_MSG } = await import('../closeout.ts');
const { applyAction } = await import('../../server/actions.ts');
type Project = import('../types.ts').Project;
type DimRule = import('../kpi.ts').DimRule;
type KpiRules = import('../kpi.ts').KpiRules;
type Revision = import('../revisions.ts').Revision;

const PD = { name: 'PD', role: 'director' as const };
const KEN = { name: 'Ken', role: 'pm' as const };
const JASON = { name: 'Jason', role: 'pm' as const };
const SALLY = { name: 'Sally', role: 'sales' as const };
const SAM = { name: 'Sam', role: 'sales' as const };
const USERS = [PD, KEN, JASON, SALLY, SAM, { name: 'Vic', role: 'viewer' as const }];
const pts = () => DEFAULT_POINT_RULES;
const errName = (n: string) => (e: Error) => e.constructor.name === n;

/* ===== 升级前的 scoreOf / computeKpi(原样抄自 0423bea 的 src/lib/kpi.ts)===== */
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
function oldScoreOf(rule: DimRule, raw: number | null): number | null {
  if (raw == null) return null;
  if (rule.mode === 'threshold') return raw >= rule.target ? 100 : 0;
  if (rule.mode === 'banded') {
    const bands = [...rule.bands].sort((a, b) => b.at - a.at);
    for (const b of bands) if (raw >= b.at) return clamp(b.score, 0, 100);
    return 0;
  }
  const span = rule.target - rule.floor;
  if (span <= 0) return raw >= rule.target ? 100 : 0;
  return Math.round(clamp(((raw - rule.floor) / span) * 100, 0, 100));
}
type OldDim = 'points' | 'onTime' | 'quality' | 'load';
function oldComputeKpi(inp: { projects: Project[]; users: { name: string; role: string }[]; rules: KpiRules; period: { from: string; to: string }; svc: string }) {
  const { projects, users, rules, period, svc } = inp;
  const pool = projects.filter((p) => (!p.archived || p.archiveReason === 'invoiced') && inPeriod(p, period) && (!svc || (p.packages || []).some((pk) => pk.svc === svc)));
  return users.map((u) => {
    const mine = pool.filter((p) => (p.owners || []).includes(u.name));
    const set = ruleSetFor(rules, u.role, svc);
    const points = Math.round(mine.reduce((a, p) => a + projPoints(p, pts()), 0) * 10) / 10;
    let onTimeHit = 0, onTimeAll = 0, qualityHit = 0, qualityAll = 0;
    mine.forEach((p) => {
      const ot = onTimeOf(p); if (ot != null) { onTimeAll++; if (ot) onTimeHit++; }
      const fp = firstPassOf(p); if (fp != null) { qualityAll++; if (fp) qualityHit++; }
    });
    const raw = { points, onTime: onTimeAll ? Math.round((onTimeHit / onTimeAll) * 100) : null, quality: qualityAll ? Math.round((qualityHit / qualityAll) * 100) : null, load: mine.length };
    const scores = {} as Record<OldDim, number | null>;
    (Object.keys(raw) as OldDim[]).forEach((k) => { const r = set.dims[k]; scores[k] = r && r.on ? oldScoreOf(r, raw[k]) : null; });
    let sum = 0, wsum = 0;
    (Object.keys(scores) as OldDim[]).forEach((k) => { const s = scores[k], r = set.dims[k]; if (s == null || !r || !r.on || r.weight <= 0) return; sum += s * r.weight; wsum += r.weight; });
    return { name: u.name, raw, scores, total: wsum ? Math.round(sum / wsum) : null };
  });
}

/* ===== 造数据 ===== */
let seq = 0;
function proj(o: { name?: string; owners?: string[]; services?: string[]; finish?: string; delivery?: string; handoverAt?: number; created?: number; sales?: string }): Project {
  const p = newProject({ name: o.name || `P${++seq}`, client: 'C', services: o.services || ['cgi'], start: '2026-08-01', owners: o.owners || ['Ken'] } as never);
  migrate(p);
  p.id = `p${++seq}`;
  if (o.created) p.created = o.created;
  p.delivery = o.delivery || '2026-11-20';
  p.packages.forEach((pk) => pk.schedule.forEach((r, i) => { r.status = o.finish ? 'done' : (i ? 'todo' : 'done'); r.s = '2026-08-01'; r.e = o.finish || '2026-08-10'; }));
  if (o.handoverAt || o.sales) p.handover = { status: 'accepted', salesBrief: '', assignedPmId: (o.owners || ['Ken'])[0], submittedBy: o.sales || 'Sally', submittedAt: o.handoverAt || 0, briefingAt: 0 };
  return p;
}
const revAt = (src: 'client' | 'internal', date: string, fee?: Revision['fee']): Revision => ({ id: `r${++seq}`, src, date, note: 'x', by: 'Ken', at: 1, ...(fee ? { fee } : {}) });
const day = (s: string) => new Date(`${s}T10:00:00`).getTime();

test('REQ-063 · scoreOf:原来四个维度(越高越好)在各种规则下和升级前逐个一致', () => {
  const modes = ['threshold', 'linear', 'banded'] as const;
  let n = 0;
  for (const mode of modes) {
    for (const target of [0, 1, 6, 20, 60, 100, 250]) {
      for (const floor of [0, 5, 20, 60, 100, 300]) {
        const rule: DimRule = { on: true, weight: 25, mode, target, floor, bands: [{ at: 90, score: 100 }, { at: 70, score: 80 }, { at: 40, score: 30 }, { at: 120, score: 140 }] };
        for (const raw of [null, -5, 0, 0.5, 1, 3, 5.9, 6, 19.9, 20, 40, 59, 60, 61, 70, 89, 90, 100, 101, 250, 1e4]) {
          assert.equal(scoreOf(rule, raw), oldScoreOf(rule, raw), `${mode} t=${target} f=${floor} raw=${raw}`);
          assert.equal(scoreOf(rule, raw, false), oldScoreOf(rule, raw));
          n++;
        }
      }
    }
  }
  assert.ok(n > 2000);
  /* 出厂规则里原来四个维度一字未改 */
  const d0 = DEFAULT_KPI_RULES.sets[0].dims;
  assert.deepEqual([d0.points, d0.onTime, d0.quality, d0.load].map((r) => [r.on, r.weight, r.mode, r.target, r.floor]),
    [[true, 40, 'linear', 20, 0], [true, 30, 'linear', 100, 60], [true, 20, 'linear', 100, 60], [true, 10, 'linear', 6, 0]]);
});

test('REQ-063 · 新维度:平均修改轮数越低越好(≤2 轮 100、≥5 轮 0、3.5 轮 50);回收率 0%→0、80%→100;默认关闭、权重 0', () => {
  const d = DEFAULT_KPI_RULES.sets[0].dims;
  assert.deepEqual([d.revRounds.on, d.revRounds.weight, d.revRecover.on, d.revRecover.weight], [false, 0, false, 0]);
  const rr = { ...d.revRounds, on: true };
  assert.deepEqual([1, 2, 3.5, 5, 6].map((x) => scoreOf(rr, x, true)), [100, 100, 50, 0, 0]);
  assert.equal(scoreOf({ ...rr, mode: 'threshold', target: 3 }, 3, true), 100);
  assert.equal(scoreOf({ ...rr, mode: 'threshold', target: 3 }, 3.1, true), 0);
  assert.equal(scoreOf({ ...rr, mode: 'banded', bands: [{ at: 2, score: 100 }, { at: 4, score: 60 }] }, 3, true), 60);
  assert.equal(scoreOf({ ...rr, mode: 'banded', bands: [{ at: 2, score: 100 }, { at: 4, score: 60 }] }, 4.5, true), 0);
  const rc = { ...d.revRecover, on: true };
  assert.deepEqual([0, 40, 60, 80, 100].map((x) => scoreOf(rc, x)), [0, 50, 75, 100, 100]);
  assert.ok(kpi.LOWER_BETTER.has('revRounds') && !kpi.LOWER_BETTER.has('revRecover') && !kpi.LOWER_BETTER.has('points'));
});

test('REQ-063 · validateKpiRules:老版本(只有四个维度)读出来新维度是关闭 / 权重 0,区间 / 轮次规则 / 目标补默认;原来四维不变', () => {
  const old = { sets: [
    { role: '', svc: '', dims: { points: { on: true, weight: 50, mode: 'linear', target: 30, floor: 0, bands: [] }, onTime: { on: false, weight: 0, mode: 'threshold', target: 90, floor: 0, bands: [] }, quality: { on: true, weight: 30, mode: 'banded', target: 0, floor: 0, bands: [{ at: 90, score: 100 }] }, load: { on: true, weight: 20, mode: 'linear', target: 8, floor: 1, bands: [] } } },
    { role: 'pm', svc: 'cgi', dims: { points: { on: true, weight: 100, mode: 'linear', target: 10, floor: 0, bands: [] } } },
  ] };
  const v = validateKpiRules(old);
  assert.ok(v.ok);
  if (!v.ok) return;
  for (const s of v.rules.sets) {
    assert.deepEqual(s.dims.revRounds, { on: false, weight: 0, mode: 'linear', target: 2, floor: 5, bands: [] });
    assert.deepEqual(s.dims.revRecover, { on: false, weight: 0, mode: 'linear', target: 80, floor: 0, bands: [] });
  }
  assert.deepEqual(v.rules.sets[0].dims.points, old.sets[0].dims.points);
  assert.deepEqual(v.rules.sets[0].dims.quality, old.sets[0].dims.quality);
  /* 老版本里缺的原四维照旧按「开着、权重 25」补(和升级前一样) */
  assert.deepEqual([v.rules.sets[1].dims.onTime.on, v.rules.sets[1].dims.onTime.weight], [true, 25]);
  assert.deepEqual(v.rules.bands, { coord: { lo: 40, hi: 70 }, pm: { lo: 60, hi: 90 }, senior: { lo: 90, hi: 120 }, director: null });
  assert.deepEqual(v.rules.rev, DEFAULT_REV_RULES);
  assert.deepEqual(v.rules.targets, { onTime: 90, rounds: 3, recover: 80 });
  /* 越低越好的线性:0 分线要高于满分线 */
  const bad = JSON.parse(JSON.stringify(v.rules)) as KpiRules;
  bad.sets[0].dims.revRounds = { on: true, weight: 10, mode: 'linear', target: 5, floor: 2, bands: [] };
  const r = validateKpiRules(bad);
  assert.ok(!r.ok && /0 分线要高于满分线/.test(r.error));
  bad.sets[0].dims.revRounds = { on: true, weight: 10, mode: 'linear', target: 2, floor: 5, bands: [] };
  assert.ok(validateKpiRules(bad).ok);
  /* 区间:上限要大于下限;PM Director 可以不设 */
  const b2 = JSON.parse(JSON.stringify(v.rules)) as KpiRules;
  b2.bands.pm = { lo: 90, hi: 60 };
  assert.ok(!validateKpiRules(b2).ok);
});

/* 一批有修改记录的项目:Ken 两个、Jason 一个、没交接的、手动归档的、开票归档的 */
function sample(): Project[] {
  const a = proj({ owners: ['Ken'], services: ['cgi', 'ani'], finish: '2026-11-05', delivery: '2026-11-10', handoverAt: day('2026-11-02') });
  a.packages[0].revisions = [revAt('client', '2026-11-03'), revAt('client', '2026-11-04'), revAt('internal', '2026-11-04')];
  a.packages[1].revisions = [revAt('client', '2026-11-03'), revAt('client', '2026-11-03'), revAt('client', '2026-11-04'), revAt('client', '2026-11-05', 'confirmed')];
  a.completionReview = { status: 'approved', summary: '', links: '', submittedBy: 'Ken', submittedAt: 1, approval: { pdId: 'PD', status: 'approved', note: '', decidedAt: 1 } };
  const b = proj({ owners: ['Ken', 'Jason'], services: ['scale'], finish: '2026-11-20', delivery: '2026-11-12', handoverAt: day('2026-10-01') });
  b.packages[0].revisions = [revAt('client', '2026-11-01'), revAt('client', '2026-11-02'), revAt('client', '2026-11-03'), revAt('client', '2026-11-04', 'waived'), revAt('client', '2026-11-05', 'due')];
  const c = proj({ owners: ['Jason'], services: ['cgi'], finish: '2026-10-15', delivery: '2026-10-30' });
  const d = proj({ owners: ['Ken'], services: ['vrar'] });
  const e = proj({ owners: ['Ken'], services: ['cgi'], finish: '2026-11-08' }); e.archived = true; e.archiveReason = 'manual';
  const f = proj({ owners: ['Jason'], services: ['led'], finish: '2026-11-09', delivery: '2026-11-30' }); f.archived = true; f.archiveReason = 'invoiced';
  f.packages[0].revisions = [revAt('client', '2026-11-01', 'quoted')];
  return [a, b, c, d, e, f];
}

test('REQ-063 · 升级后不做任何设置:每个人各周期的四维原始值 / 分数 / 加权总分和升级前完全一致', () => {
  const ps = sample();
  const oldRules = validateKpiRules({ sets: [{ role: '', svc: '', dims: { points: { on: true, weight: 40, mode: 'linear', target: 20, floor: 0 }, onTime: { on: true, weight: 30, mode: 'linear', target: 100, floor: 60 }, quality: { on: true, weight: 20, mode: 'threshold', target: 100 }, load: { on: true, weight: 10, mode: 'banded', bands: [{ at: 1, score: 50 }, { at: 3, score: 100 }] } } }, { role: 'pm', svc: '', dims: { points: { on: true, weight: 70, mode: 'linear', target: 15, floor: 2 }, load: { on: false } } }] });
  assert.ok(oldRules.ok);
  const ruleSets = [DEFAULT_KPI_RULES, oldRules.ok ? oldRules.rules : DEFAULT_KPI_RULES];
  const periods = [{ from: '2026-11-01', to: '2026-11-30' }, { from: '2026-10-01', to: '2026-12-31' }, { from: '2026-01-01', to: '2026-12-31' }, { from: '2026-10-01', to: '2026-10-31' }, { from: '2000-01-01', to: '2100-12-31' }];
  let n = 0;
  for (const rules of ruleSets) for (const period of periods) for (const svc of ['', 'cgi', 'scale']) for (const since of ['', '2026-11-01', '2026-01-01']) {
    const now = computeKpi({ projects: ps, users: USERS, rules, period, svc, pointRulesFor: pts, since063: since });
    const was = oldComputeKpi({ projects: ps, users: USERS, rules, period, svc });
    now.forEach((x, i) => {
      const o = was[i];
      assert.equal(x.total, o.total, `${x.name} ${period.from}~${period.to} svc=${svc}`);
      assert.deepEqual([x.raw.points, x.raw.onTime, x.raw.quality, x.raw.load], [o.raw.points, o.raw.onTime, o.raw.quality, o.raw.load]);
      assert.deepEqual([x.scores.points, x.scores.onTime, x.scores.quality, x.scores.load], [o.scores.points, o.scores.onTime, o.scores.quality, o.scores.load]);
      assert.equal(x.scores.revRounds, null, '默认关闭,不算分');
      assert.equal(x.scores.revRecover, null);
      n++;
    });
  }
  assert.ok(n > 300);
});

test('REQ-063 · 两个新维度的原始值(按人,只算负责的项目)+ 打开 revRounds 给 10% 后总分按新权重变', () => {
  const ps = sample();
  const period = { from: '2026-11-01', to: '2026-11-30' };
  const run = (rules: KpiRules, since = '2026-11-01') => computeKpi({ projects: ps, users: [KEN, JASON], rules, period, svc: '', pointRulesFor: pts, since063: since });
  const [ken, jason] = run(DEFAULT_KPI_RULES);
  /* Ken 本月完工:a(上线后交接,两个服务包 2 + 4 轮;内部的不算);b 11-20 完工但上线前交接 —— 有记录就算(5 轮)。e 是手动归档,不算 */
  assert.equal(ken.raw.revRounds, Math.round(((2 + 4 + 5) / 3) * 10) / 10);
  assert.deepEqual([ken.detail.revPkgs, ken.detail.revSum], [3, 11]);
  /* 回收率:Ken 负责的项目上日期在本月的应收费轮 = a 的 confirmed、b 的 waived + due → 1/3 */
  assert.equal(ken.raw.revRecover, 33);
  assert.deepEqual(ken.detail.fee, { due: 1, quoted: 0, confirmed: 1, waived: 1, total: 3 });
  /* Jason:b(5 轮)+ f(开票归档,照算;它的 quoted 轮也算应收费) */
  assert.equal(jason.detail.fee.total, 3);
  assert.equal(jason.raw.revRecover, 0);
  /* 没有有效服务包 / 没有应收费轮 = null(不参与加权) */
  const none = computeKpi({ projects: [proj({ owners: ['Ken'], finish: '2026-11-03', handoverAt: day('2026-01-01') })], users: [KEN], rules: DEFAULT_KPI_RULES, period, svc: '', pointRulesFor: pts, since063: '2026-11-01' })[0];
  assert.deepEqual([none.raw.revRounds, none.raw.revRecover], [null, null], '上线前交接、没有记录的老项目不算;没有应收费轮');
  /* 打开 revRounds、给 10% */
  const on = JSON.parse(JSON.stringify(DEFAULT_KPI_RULES)) as KpiRules;
  on.sets[0].dims.revRounds = { ...on.sets[0].dims.revRounds, on: true, weight: 10 };
  const [ken2] = run(on);
  const s = scoreOf(on.sets[0].dims.revRounds, ken.raw.revRounds, true)!;
  assert.equal(ken2.scores.revRounds, s);
  const d = on.sets[0].dims;
  let sum = 0, w = 0;
  (['points', 'onTime', 'quality', 'load'] as const).forEach((k) => { const v = ken.scores[k]; if (v != null && d[k].on && d[k].weight > 0) { sum += v * d[k].weight; w += d[k].weight; } });
  sum += s * 10; w += 10;
  assert.equal(ken2.total, Math.round(sum / w), '总分 = 原来的加权 + 平均修改轮数 10%');
  assert.ok(ken2.detail.revPkgs > 0);
});

test('REQ-063 · 一个周期用哪一版规则:上线前结束的周期照旧用今天的版本;上线后的用周期结束那天的版本(没结束的按今天)', () => {
  const mk = (version: number, effectiveFrom: string, weight: number) => {
    const r = JSON.parse(JSON.stringify(DEFAULT_KPI_RULES)) as KpiRules;
    r.sets[0].dims.points.weight = weight;
    return { version, rules: r, effectiveFrom, note: '', createdAt: 0, createdBy: 'PD' };
  };
  const vs = [mk(1, '2026-01-01', 11), mk(2, '2026-11-20', 22), mk(3, '2027-02-01', 33)];
  const since = '2026-11-12', today = '2026-12-05';
  const w = (p: { from: string; to: string }, s = since, t = today) => kpiRulesForPeriod(vs, p, s, t).sets[0].dims.points.weight;
  assert.equal(w({ from: '2026-10-01', to: '2026-10-31' }), 22, '上线前结束的周期:和以前一样用今天生效的版本');
  assert.equal(w({ from: '2026-11-01', to: '2026-11-30' }), 22, '11 月结束于 11-30,那天生效的是 v2');
  assert.equal(w({ from: '2026-11-01', to: '2026-11-15' }), 11, '结束于 11-15(上线后),那天还是 v1 —— 以后再改规则也不改写它');
  assert.equal(w({ from: '2026-10-01', to: '2026-12-31' }), 22, '还没结束的季度按今天');
  assert.equal(w({ from: '2026-11-01', to: '2026-11-15' }, ''), 22, '没有上线日 = 全按以前的做法');
  assert.equal(w({ from: '2026-11-01', to: '2026-11-15' }, since, '2027-03-01'), 11, '到了 v3 生效以后,过去的周期仍按它结束那天的版本');
  assert.equal(w({ from: '2026-12-01', to: '2026-12-31' }, since, '2027-03-01'), 22);
  /* 「PD 打开 revRounds 并生效:生效日之前的周期仍按旧规则算」 */
  assert.equal(w({ from: '2026-11-01', to: '2026-11-19' }), 11);
  assert.equal(kpiRulesForPeriod([], { from: '2026-11-01', to: '2026-11-30' }, since, today), DEFAULT_KPI_RULES);
  /* 上线后第一次存规则(11-20 存、当天生效):11-01 ~ 11-15 这个已结束的周期那时还没有任何版本 → 出厂默认;
     以前的做法(没排到就用最早那一版)会把它改写成新规则 */
  const first = { ...mk(1, '2026-11-20', 44), createdAt: day('2026-11-20') };
  assert.equal(kpiRulesForPeriod([first], { from: '2026-11-01', to: '2026-11-15' }, since, '2026-11-25'), DEFAULT_KPI_RULES);
  assert.equal(kpiRulesForPeriod([first], { from: '2026-11-01', to: '2026-11-30' }, since, '2026-11-25').sets[0].dims.points.weight, 44, '还没结束的周期按今天');
  assert.equal(kpiRulesForPeriod([first], { from: '2026-10-01', to: '2026-10-31' }, since, '2026-11-25').sets[0].dims.points.weight, 44, '上线前结束的周期照旧(和以前一样用今天的)');
  /* 把生效日往前写(11-25 存、生效日 11-01):已经结束的 11-01 ~ 11-15 不被改写;还没结束的 11 月用它 */
  const back = { ...mk(2, '2026-11-01', 55), createdAt: day('2026-11-25') };
  assert.equal(kpiRulesForPeriod([first, back], { from: '2026-11-01', to: '2026-11-15' }, since, '2026-11-26'), DEFAULT_KPI_RULES);
  assert.equal(kpiRulesForPeriod([{ ...first, effectiveFrom: '2026-11-10', createdAt: day('2026-11-10') }, back], { from: '2026-11-01', to: '2026-11-15' }, since, '2026-11-26').sets[0].dims.points.weight, 44);
  /* 升级那一刻:有一版生效日在将来(以前的做法:没排到用最早那一版),本期照旧 —— 什么都不变 */
  const future = { ...mk(1, '2026-12-01', 66), createdAt: day('2026-11-01') };
  assert.equal(kpiRulesForPeriod([future], { from: '2026-11-01', to: '2026-11-30' }, since, since).sets[0].dims.points.weight, kpi.kpiRulesAt([future], day(since)).sets[0].dims.points.weight);
});

test('REQ-063 · 修改轮次:R1、R2 免费,R3 免费,R4 起应收费;内部的不占轮次、没有收费状态;删 R2 后重编号、已确认的不动', () => {
  const p = proj({ owners: ['Ken'] });
  const pk = p.packages[0];
  const now = day('2026-11-12');
  pk.revisions = [];
  const add = (src: 'client' | 'internal') => { pk.revisions!.push(revAt(src, '2026-11-12')); recompute(pk, DEFAULT_REV_RULES, now); };
  add('client'); add('client'); add('internal'); add('client'); add('client');
  const fees = () => pk.revisions!.map((r) => [roundMap(pk).get(r.id) ?? null, r.fee ?? null]);
  assert.deepEqual(fees(), [[1, 'free'], [2, 'free'], [null, null], [3, 'free'], [4, 'due']]);
  assert.equal(pk.revisions![4].dueAt, now);
  assert.equal(clientRounds(pk), 4);
  /* R5 → 已确认 */
  add('client');
  pk.revisions![5].fee = 'confirmed';
  /* 删 R2:原 R3 → R2(免费),原 R4 → R3(待报价变回免费),已确认的(原 R5)→ R4 不动 */
  const back = (() => { pk.revisions = pk.revisions!.filter((_, i) => i !== 1); return recompute(pk, DEFAULT_REV_RULES, now + 1); })();
  assert.deepEqual(fees(), [[1, 'free'], [null, null], [2, 'free'], [3, 'free'], [4, 'confirmed']]);
  assert.equal(back.length, 1, '一轮从待报价变回免费');
  assert.equal(pk.revisions![3].dueAt, undefined);
  /* 再记一轮:R5 应收费,dueAt 是新的时间 */
  add('client');
  assert.deepEqual(fees().at(-1), [5, 'due']);
});

test('REQ-063 · 动作 + 权限:PM 记 / 改 / 删自己的;Sales 出报价 / 客户确认,PM 没有(403);免收只有 PD / BD 且必须写原因', () => {
  const p = proj({ owners: ['Ken'], sales: 'Sally', handoverAt: day('2026-11-01') });
  const vBefore = JSON.stringify([p.salesVerification, p.completionReview]);
  const add = (u: typeof KEN | typeof PD, note = '改') => applyAction(u, p, { type: 'addRevision', pkg: 0, src: 'client', date: '2026-11-12', note });
  add(KEN); add(KEN); add(KEN);
  assert.ok(needsReasonMeeting(p.packages[0], DEFAULT_REV_RULES), '第 3 轮:该开原因会');
  applyAction(KEN, p, { type: 'addRevision', pkg: 0, src: 'internal', date: '2026-11-12', note: '内审' });
  add(KEN);
  const revs = () => p.packages[0].revisions!;
  const r4 = revs()[4];
  assert.deepEqual([roundMap(p.packages[0]).get(r4.id), r4.fee], [4, 'due']);
  assert.equal(JSON.stringify([p.salesVerification, p.completionReview]), vBefore, '记修改不碰完工审批 / Variation');
  assert.ok(p.log.some((e) => e.k === 'rev.add'));
  /* 校验 */
  assert.throws(() => applyAction(KEN, p, { type: 'addRevision', pkg: 0, src: 'client', date: '2026-11-12', note: '  ' }), errName('ValidationError'));
  assert.throws(() => applyAction(KEN, p, { type: 'addRevision', pkg: 0, src: 'client', date: '2026-13-01', note: 'x' }), errName('ValidationError'));
  assert.throws(() => applyAction(KEN, p, { type: 'addRevision', pkg: 0, src: 'x' as never, date: '2026-11-12', note: 'x' }), errName('ValidationError'));
  /* 谁能记:Sales / Jason(不是负责 PM)不能 */
  assert.throws(() => applyAction(SALLY, p, { type: 'addRevision', pkg: 0, src: 'client', date: '2026-11-12', note: 'x' }), errName('PermissionError'));
  assert.throws(() => applyAction(JASON, p, { type: 'addRevision', pkg: 0, src: 'client', date: '2026-11-12', note: 'x' }), errName('PermissionError'));
  /* 报价:PM 403;Sales 可以;要按顺序 */
  assert.throws(() => applyAction(KEN, p, { type: 'setRevFee', pkg: 0, id: r4.id, fee: 'quoted' }), errName('PermissionError'));
  assert.throws(() => applyAction(SALLY, p, { type: 'setRevFee', pkg: 0, id: r4.id, fee: 'confirmed' }), errName('ValidationError'), '先出报价才能确认');
  assert.throws(() => applyAction(SALLY, p, { type: 'setRevFee', pkg: 0, id: revs()[0].id, fee: 'quoted' }), errName('ValidationError'), '免费的轮不收费');
  applyAction(SALLY, p, { type: 'setRevFee', pkg: 0, id: r4.id, fee: 'quoted' });
  assert.deepEqual([r4.fee, r4.quotedBy, r4.dueAt], ['quoted', 'Sally', undefined]);
  assert.throws(() => applyAction(KEN, p, { type: 'setRevFee', pkg: 0, id: r4.id, fee: 'confirmed' }), errName('PermissionError'));
  applyAction(SAM, p, { type: 'setRevFee', pkg: 0, id: r4.id, fee: 'confirmed' });
  assert.equal(r4.fee, 'confirmed');
  /* 免收:PM / Sales 403;PD 不写原因 400 */
  add(KEN);
  const r5 = revs()[5];
  assert.equal(r5.fee, 'due');
  assert.throws(() => applyAction(KEN, p, { type: 'setRevFee', pkg: 0, id: r5.id, fee: 'waived', reason: '老客户' }), errName('PermissionError'));
  assert.throws(() => applyAction(SALLY, p, { type: 'setRevFee', pkg: 0, id: r5.id, fee: 'waived', reason: '老客户' }), errName('PermissionError'));
  assert.throws(() => applyAction(PD, p, { type: 'setRevFee', pkg: 0, id: r5.id, fee: 'waived', reason: ' ' }), errName('ValidationError'));
  assert.equal(r5.fee, 'due', '没写原因被拒时一点没改');
  applyAction(PD, p, { type: 'setRevFee', pkg: 0, id: r5.id, fee: 'waived', reason: '老客户,PD 批准' });
  assert.deepEqual([r5.fee, r5.waiveReason], ['waived', '老客户,PD 批准']);
  /* 改 / 删:PM 只能动自己记的、免费 / 待报价的;已确认 / 免收的 PM 动不了,PD 可以 */
  assert.ok(canEditRev(KEN, p, revs()[0]) && !canEditRev(KEN, p, r4) && !canEditRev(KEN, p, r5) && canEditRev(PD, p, r4));
  assert.throws(() => applyAction(KEN, p, { type: 'deleteRevision', pkg: 0, id: r4.id }), errName('PermissionError'));
  applyAction(PD, p, { type: 'addRevision', pkg: 0, src: 'client', date: '2026-11-12', note: 'PD 记的' });
  const byPd = revs().at(-1)!;
  assert.throws(() => applyAction(KEN, p, { type: 'editRevision', pkg: 0, id: byPd.id, note: 'Ken 改' }), errName('PermissionError'), 'PM 不能改别人记的');
  applyAction(KEN, p, { type: 'editRevision', pkg: 0, id: revs()[0].id, note: '改了内容', date: '2026-11-10' });
  assert.deepEqual([revs()[0].note, revs()[0].date, revs()[0].editedBy], ['改了内容', '2026-11-10', 'Ken']);
  assert.throws(() => applyAction(PD, p, { type: 'editRevision', pkg: 0, id: r4.id, src: 'internal' }), errName('ValidationError'), '已确认的轮不能改来源');
  /* 删 R2:后面的轮次前移,已确认 / 免收的不动 */
  const before = revs().length;
  applyAction(KEN, p, { type: 'deleteRevision', pkg: 0, id: revs()[1].id });
  assert.equal(revs().length, before - 1);
  assert.deepEqual([roundMap(p.packages[0]).get(r4.id), r4.fee, roundMap(p.packages[0]).get(r5.id), r5.fee], [3, 'confirmed', 4, 'waived']);
  assert.ok(p.log.some((e) => e.k === 'rev.remove'));
  /* 原因会:PM 写一句结论;只能一次;Sales 不能 */
  assert.throws(() => applyAction(SALLY, p, { type: 'reasonMeeting', pkg: 0, note: '客户内部意见不一致' }), errName('PermissionError'));
  assert.throws(() => applyAction(KEN, p, { type: 'reasonMeeting', pkg: 0, note: '' }), errName('ValidationError'));
  applyAction(KEN, p, { type: 'reasonMeeting', pkg: 0, note: '客户内部意见不一致' });
  assert.ok(!needsReasonMeeting(p.packages[0], DEFAULT_REV_RULES), '登记后不再提醒,再记也不重复出现');
  assert.throws(() => applyAction(PD, p, { type: 'reasonMeeting', pkg: 0, note: '再来' }), errName('ValidationError'));
  add(KEN);
  assert.ok(!needsReasonMeeting(p.packages[0], DEFAULT_REV_RULES));
  /* 没到 3 轮不能登记 */
  const q = proj({ owners: ['Ken'] });
  applyAction(KEN, q, { type: 'addRevision', pkg: 0, src: 'client', date: '2026-11-12', note: 'x' });
  assert.throws(() => applyAction(KEN, q, { type: 'reasonMeeting', pkg: 0, note: 'x' }), errName('ValidationError'));
  /* 规则改成第 3 轮起收费(ctx.rev) */
  applyAction(KEN, q, { type: 'addRevision', pkg: 0, src: 'client', date: '2026-11-12', note: 'x' });
  applyAction(KEN, q, { type: 'addRevision', pkg: 0, src: 'client', date: '2026-11-12', note: 'x' }, { rev: { ...DEFAULT_REV_RULES, chargeFrom: 3 } });
  assert.equal(q.packages[0].revisions![2].fee, 'due');
  /* 权限函数(前端按钮同一套) */
  assert.ok(canRecordRev(KEN, p) && canRecordRev(PD, p) && !canRecordRev(SALLY, p) && !canRecordRev(JASON, p));
  assert.ok(canQuoteRev(SALLY) && canQuoteRev(PD) && !canQuoteRev(KEN));
  assert.ok(canWaiveRev(PD) && !canWaiveRev(SALLY) && !canWaiveRev(KEN));
});

test('REQ-063 · REQ-057:项目进了开票 / 收尾,PM 端修改记录只读(后端拦,原因说清楚);PD / Sales 照常', () => {
  const p = proj({ owners: ['Ken'], finish: '2026-11-05' });
  const t = Date.now();
  p.handover = { status: 'accepted', salesBrief: '', assignedPmId: 'Ken', submittedBy: 'Sally', submittedAt: t, briefingAt: t };
  p.completionReview = { status: 'approved', summary: '', links: '', submittedBy: 'Ken', submittedAt: t, approval: { pdId: 'PD', status: 'approved', note: '', decidedAt: t } };
  p.salesVerification = { status: 'verified', scopeMatches: true, jobOrderUpdated: true, variationStatus: 'none', finalInvoiceAllowed: true, by: 'Sally', at: t };
  assert.throws(() => applyAction(KEN, p, { type: 'addRevision', pkg: 0, src: 'client', date: '2026-11-12', note: 'x' }), (e: Error) => e.message === PM_CLOSED_MSG);
  assert.equal(canRecordRev(KEN, p), false);
  applyAction(PD, p, { type: 'addRevision', pkg: 0, src: 'client', date: '2026-11-12', note: 'PD 照常' });
  assert.equal(p.packages[0].revisions!.length, 1);
});

test('REQ-063 · 每月看 3 个数:3 个服务包修改 2 / 3 / 4 轮 → 3.0;上线前交接无记录的老项目不拉低,上线后交接 0 轮的按 0 算;回收率 60%', () => {
  const since = '2026-11-01';
  const period = { from: '2026-11-01', to: '2026-11-30' };
  const a = proj({ services: ['cgi', 'ani'], finish: '2026-11-10', delivery: '2026-11-15', handoverAt: day('2026-11-02') });
  a.packages[0].revisions = [revAt('client', '2026-11-03'), revAt('client', '2026-11-04')];
  a.packages[1].revisions = [revAt('client', '2026-11-03'), revAt('client', '2026-11-04'), revAt('client', '2026-11-05')];
  const b = proj({ services: ['scale'], finish: '2026-11-12', delivery: '2026-11-11', handoverAt: day('2026-11-03') });
  b.packages[0].revisions = [revAt('client', '2026-11-03'), revAt('client', '2026-11-04'), revAt('client', '2026-11-05'), revAt('client', '2026-11-06', 'due')];
  const old = proj({ services: ['cgi'], finish: '2026-11-15', delivery: '2026-11-20', handoverAt: day('2026-09-01') });
  let c = companyCards([a, b, old], period, since);
  assert.equal(c.rounds.avg, 3);
  assert.deepEqual([c.rounds.pkgs, c.rounds.sum], [3, 9]);
  assert.deepEqual([c.onTime.all, c.onTime.hit, c.onTime.pct], [3, 2, 67]);
  /* 上线后交接、0 轮 → 按 0 算 */
  const fresh = proj({ services: ['cgi'], finish: '2026-11-16', delivery: '2026-11-20', handoverAt: day('2026-11-05') });
  c = companyCards([a, b, old, fresh], period, since);
  assert.deepEqual([c.rounds.pkgs, c.rounds.avg], [4, Math.round((9 / 4) * 10) / 10]);
  /* 没走交接的按建项目那天算交接日 */
  const noHandover = proj({ services: ['cgi'], finish: '2026-11-16', created: day('2026-11-06') });
  assert.equal(effectivePkgs(noHandover, since).length, 1);
  const noHandoverOld = proj({ services: ['cgi'], finish: '2026-11-16', created: day('2026-10-06') });
  assert.equal(effectivePkgs(noHandoverOld, since).length, 0);
  /* 回收率:本月应收费 5 轮(已确认 3、待报价 1、免收 1)→ 60% */
  const r = proj({ services: ['cgi'] });
  r.packages[0].revisions = [revAt('client', '2026-11-02', 'confirmed'), revAt('client', '2026-11-03', 'confirmed'), revAt('client', '2026-11-04', 'confirmed'), revAt('client', '2026-11-05', 'due'), revAt('client', '2026-11-06', 'waived'), revAt('client', '2026-10-30', 'confirmed'), revAt('client', '2026-11-07', 'free')];
  c = companyCards([r], period, since);
  assert.deepEqual([c.recover.total, c.recover.confirmed, c.recover.due, c.recover.waived, c.recover.pct], [5, 3, 1, 1, 60]);
  assert.equal(companyCards([a], period, since).recover.pct, null, '没有应收费轮 = 显示「没有应收费的」');
  /* 切换周期跟着变 */
  assert.equal(companyCards([r], { from: '2026-10-01', to: '2026-12-31' }, since).recover.total, 6);
  /* 手动归档的不算 */
  r.archived = true; r.archiveReason = 'manual';
  assert.equal(companyCards([r], period, since).recover.total, 0);
});

test('REQ-063 · 级别区间:Ken(PM 60–90)71 区间内 / 55 低于 / 95 高于;Jason(Coordinator 40–70)65 已达上一级下限;Director 不设', () => {
  const B = DEFAULT_KPI_RULES.bands;
  assert.equal(bandOf(B, 'pm', 71).state, 'in');
  assert.equal(bandOf(B, 'pm', 55).state, 'below');
  assert.equal(bandOf(B, 'pm', 95).state, 'above');
  assert.equal(bandOf(B, 'coord', 65).state, 'inNext');
  assert.equal(bandOf(B, 'coord', 59).state, 'in');
  assert.equal(bandOf(B, 'senior', 120).state, 'in', 'Senior 的上一级(Director)不设区间');
  assert.equal(bandOf(B, 'senior', 121).state, 'above');
  assert.equal(bandOf(B, 'director', 500).state, 'none');
  assert.equal(bandOf(B, '', 50).state, 'none');
  assert.deepEqual([bandOf(B, 'pm', 71).lo, bandOf(B, 'pm', 71).hi], [60, 90]);
  /* 改了区间跟着变 */
  assert.equal(bandOf({ ...B, pm: { lo: 75, hi: 100 } }, 'pm', 71).state, 'below');
});

test('REQ-063 · 季度项目分值 = 那个季度的积分(和看板 points 一列同一个数);最近 N 个已结束季度给晋级条件用', () => {
  const ps = [
    proj({ owners: ['Ken'], finish: '2026-11-05' }), proj({ owners: ['Ken'], finish: '2026-08-05' }),
    proj({ owners: ['Ken'], finish: '2026-07-20' }), proj({ owners: ['Ken'], finish: '2026-02-01' }),
  ];
  assert.deepEqual(quarterOf('2026-11-12'), { from: '2026-10-01', to: '2026-12-31', label: '2026 Q4' });
  assert.deepEqual(quarterOf('2026-01-01'), { from: '2026-01-01', to: '2026-03-31', label: '2026 Q1' });
  const q4 = quarterOf('2026-11-12');
  const k = computeKpi({ projects: ps, users: [KEN], rules: DEFAULT_KPI_RULES, period: q4, svc: '', pointRulesFor: pts })[0];
  assert.equal(pointsIn(ps, 'Ken', q4, pts), k.raw.points);
  const qs = recentQuarterPoints(ps, 'Ken', 3, '2026-11-12', pts);
  assert.deepEqual(qs.map((q) => q.label), ['2026 Q3', '2026 Q2', '2026 Q1']);
  assert.equal(qs[0].points, pointsIn(ps, 'Ken', quarterOf('2026-08-01'), pts));
  assert.ok(qs[0].points > 0 && qs[1].points === 0 && qs[2].points > 0);
  /* 晋级条件(REQ-062):连续 2 个季度 ≥ 60 */
  const promo = DEFAULT_PROMO.find((x) => x.kpi && x.kpi.quarters === 2 && x.kpi.min === 60)!;
  const item = (quarters?: { label: string; points: number }[]) => promoChecklist(promo, { levels: {}, menteesDone: 0, manual: {}, quarters }).find((x) => x.id === 'kpi')!;
  assert.equal(item().met, null, '没接上时照旧「待 KPI 接入」');
  assert.equal(item([{ label: '2026 Q3', points: 71 }, { label: '2026 Q2', points: 60 }]).met, true);
  assert.equal(item([{ label: '2026 Q3', points: 71 }, { label: '2026 Q2', points: 59 }]).met, false);
  assert.equal(item([{ label: '2026 Q3', points: 71 }]).met, false, '不够 2 个季度');
  assert.match(item([{ label: '2026 Q3', points: 71 }, { label: '2026 Q2', points: 60 }]).zh, /2026 Q3 71/);
});

test('REQ-063 · Sales 待办:项目的 Sales = 交接提交人(是 Sales 时);没记 Sales 的所有 Sales 都看到;超过 48 小时标红;出报价后消失', () => {
  const now = day('2026-11-12');
  const withSales = proj({ owners: ['Ken'], sales: 'Sally', handoverAt: day('2026-11-01') });
  const noSales = proj({ owners: ['Ken'] });
  const byPd = proj({ owners: ['Ken'], sales: 'PD', handoverAt: day('2026-11-01') });   // 交接是 PD 提交的 = 没记 Sales
  for (const p of [withSales, noSales, byPd]) {
    p.packages[0].revisions = [1, 2, 3, 4].map(() => revAt('client', '2026-11-10'));
    recompute(p.packages[0], DEFAULT_REV_RULES, now);
  }
  const items = dueItems([withSales, noSales, byPd], USERS, DEFAULT_REV_RULES, now);
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((x) => x.sales), ['Sally', null, null]);
  assert.equal(salesTodo(items, 'Sally').length, 3);
  assert.equal(salesTodo(items, 'Sam').length, 2, 'Sam 看不到 Sally 那个项目的');
  assert.equal(items[0].round, 4);
  assert.ok(!items[0].overdue);
  const later = now + 48 * 3600_000 + 60_000;
  assert.ok(dueItems([withSales], USERS, DEFAULT_REV_RULES, later)[0].overdue, '超过 48 小时');
  assert.ok(!quoteOverdue(withSales.packages[0].revisions![3], DEFAULT_REV_RULES, now + 47 * 3600_000));
  /* 出了报价就不在待办里 */
  withSales.packages[0].revisions![3].fee = 'quoted';
  assert.equal(dueItems([withSales], USERS, DEFAULT_REV_RULES, later).length, 0);
  /* 手动归档的不列 */
  noSales.archived = true; noSales.archiveReason = 'manual';
  assert.equal(dueItems([noSales], USERS, DEFAULT_REV_RULES, now).length, 0);
});

test('REQ-063 · 维度表:原来四个维度的顺序、名字不变,新加的两个在后面;kpi.ts 不读 REQ-057 的只读口径', () => {
  assert.deepEqual(DIMENSIONS.map((d) => d[0]), ['points', 'onTime', 'quality', 'load', 'revRounds', 'revRecover']);
  assert.deepEqual(DIMENSIONS.slice(0, 4).map((d) => d[1]), ['积分产出', '准时交付率', '售后质量', '项目负载']);
  const src = fs.readFileSync(new URL('../kpi.ts', import.meta.url), 'utf8');
  assert.ok(!/isArchivedFor|pmClosed|pmLocked/.test(src));
});
