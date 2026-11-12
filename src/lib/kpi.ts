/* ===== REQ-037: KPI 看板 + KPI 规则 =====

   四个维度全部**从平台已有数据算出来**,没有一处是人工录入的:
     points  积分产出   —— REQ-038 的积分规则算出来的分
     onTime  准时交付率 —— 实际完工日 vs 交付日(含 buffer)
     quality 售后质量   —— 完工审批一次通过率(被打回 / 要求整改就算没通过)
     load    项目负载   —— 本期经手的项目数

   每个维度先算出一个**原始值**,再按规则里的评分方式折成 0–100 分,
   最后按权重加权成总分。规则可以按「角色 + 业务」分别配置,
   所以模型师和 Sales 不用被同一把尺子量。

   口径写在这里、也显示在界面的明细里 —— KPI 最怕的是「这分怎么来的说不清」。 */

import { parseISO, plannedFinish, projPoints } from './project';
import type { PointRules } from './points';
import type { Project } from './types';
import { localDay } from './localDate';
import {
  DEFAULT_CARD_TARGETS, DEFAULT_REV_RULES, countCharged, effectivePkgs, emptyFee, recoverPct,
  type CardTargets, type FeeCount, type RevRules,
} from './revisions';

/* REQ-063:加了两个维度 revRounds(平均修改轮数,越低越好)、revRecover(修改费回收率)。
   默认关闭、权重 0,老规则版本里没有它们的一律按「关闭」补上 —— 升级后谁的总分都不变。 */
export type Dimension = 'points' | 'onTime' | 'quality' | 'load' | 'revRounds' | 'revRecover';
export type ScoreMode = 'threshold' | 'linear' | 'banded';

export const DIMENSIONS: [Dimension, string, string, string][] = [
  ['points', '积分产出', 'Points output', '本期项目按积分规则(REQ-038)算出的分之和'],
  ['onTime', '准时交付率', 'On-time rate', '本期完工的项目里,实际完工日不晚于交付日(含 buffer)的比例'],
  ['quality', '售后质量', 'Post-sales quality', '提交过完工审批的项目里,一次通过(没被打回 / 要求整改)的比例'],
  ['load', '项目负载', 'Workload', '本期经手的项目数'],
  ['revRounds', '平均修改轮数', 'Avg revision rounds', '本期完工项目的有效服务包,客户修改轮数的平均(越低越好)'],
  ['revRecover', '修改费回收率', 'Revision fee recovery', '日期在本期的应收费轮里,客户已确认收费的比例(免收算没收回)'],
];
/* 越低越好的维度 —— 只有它们的评分方向反过来,原来四个维度不受影响 */
export const LOWER_BETTER: ReadonlySet<Dimension> = new Set<Dimension>(['revRounds']);
export const NEW_DIMS_063: Dimension[] = ['revRounds', 'revRecover'];
export const dimName = (d: Dimension, lang: 'zh' | 'en') => {
  const f = DIMENSIONS.find((x) => x[0] === d)!;
  return lang === 'zh' ? f[1] : f[2];
};

export const SCORE_MODES: [ScoreMode, string, string][] = [
  ['threshold', '阈值满分', 'Threshold'],
  ['linear', '线性', 'Linear'],
  ['banded', '分段', 'Banded'],
];

export interface DimRule {
  on: boolean;
  weight: number;                        // 权重 %
  mode: ScoreMode;
  target: number;                        // 满分线(达到即 100)
  floor: number;                         // 线性模式的 0 分线
  bands: { at: number; score: number }[]; // 分段模式:达到 at 就给 score
}

export interface KpiRuleSet {
  role: string;                          // '' = 不限角色
  svc: string;                           // '' = 不限业务
  dims: Record<Dimension, DimRule>;
}

/* REQ-063:PM 级别的每季度项目分值区间(PM Director 不设 = null) */
export type PmLevelKey = 'coord' | 'pm' | 'senior' | 'director';
export const PM_LEVEL_ORDER: PmLevelKey[] = ['coord', 'pm', 'senior', 'director'];
export const PM_LEVEL_NAME: Record<PmLevelKey, string> = { coord: 'Project Coordinator', pm: 'PM', senior: 'Senior PM', director: 'PM Director' };
export type LevelBands = Record<PmLevelKey, { lo: number; hi: number } | null>;
export const DEFAULT_BANDS: LevelBands = { coord: { lo: 40, hi: 70 }, pm: { lo: 60, hi: 90 }, senior: { lo: 90, hi: 120 }, director: null };

/* bands / rev / targets 是 REQ-063 加的,全公司一份(不分角色 / 业务),跟着规则版本走。
   老版本里没有,读的时候(validateKpiRules)补默认值。 */
export interface KpiRules { sets: KpiRuleSet[]; bands: LevelBands; rev: RevRules; targets: CardTargets }

export interface KpiRuleVersion {
  version: number;
  rules: KpiRules;
  effectiveFrom: string;
  note: string;
  createdAt: number;
  createdBy: string;
}

const dim = (on: boolean, weight: number, mode: ScoreMode, target: number, floor = 0): DimRule =>
  ({ on, weight, mode, target, floor, bands: [] });

/* 出厂默认:四维等权,阈值取「够得着但要使劲」的位置。
   这只是个能跑起来的起点 —— 总监在「规则设置 · KPI 规则」里改的那一版才算数。 */
export const DEFAULT_KPI_RULES: KpiRules = {
  sets: [{
    role: '', svc: '',
    dims: {
      points: dim(true, 40, 'linear', 20, 0),    // 本期 20 分封顶
      onTime: dim(true, 30, 'linear', 100, 60),  // 准时率 60% 起算,100% 满分
      quality: dim(true, 20, 'linear', 100, 60),
      load: dim(true, 10, 'linear', 6, 0),       // 本期 6 个项目封顶
      ...newDims(),
    },
  }],
  bands: DEFAULT_BANDS,
  rev: DEFAULT_REV_RULES,
  targets: DEFAULT_CARD_TARGETS,
};

/* REQ-063 两个新维度的出厂值:关闭、权重 0。
   平均修改轮数:≤ 2 轮 100 分,≥ 5 轮 0 分(越低越好:target 是满分线、floor 是 0 分线,floor > target)。
   回收率:0% 0 分,80% 100 分。 */
function newDims(): Record<'revRounds' | 'revRecover', DimRule> {
  return { revRounds: dim(false, 0, 'linear', 2, 5), revRecover: dim(false, 0, 'linear', 80, 0) };
}

/* 挑最贴合的一套规则:角色+业务 > 业务 > 角色 > 默认 */
export function ruleSetFor(rules: KpiRules, role: string, svc: string): KpiRuleSet {
  const s = rules.sets;
  return s.find((x) => x.role === role && x.svc === svc && role && svc)
    || s.find((x) => !x.role && x.svc === svc && svc)
    || s.find((x) => x.role === role && !x.svc && role)
    || s.find((x) => !x.role && !x.svc)
    || DEFAULT_KPI_RULES.sets[0];
}

/* 原始值 → 0–100 分。
   lower = 越低越好(REQ-063 只有 revRounds 用):阈值 = 不超过 target 满分;线性 = floor(0 分线)> target(满分线);
   分段 = 不超过 at 就给 score。lower 不传(原来四个维度)走的还是原来那几行,一个字没改。 */
export function scoreOf(rule: DimRule, raw: number | null, lower = false): number | null {
  if (raw == null) return null;
  if (lower) return scoreLower(rule, raw);
  if (rule.mode === 'threshold') return raw >= rule.target ? 100 : 0;
  if (rule.mode === 'banded') {
    /* 从高到低找第一个够得着的段;一段都够不着就 0 分 */
    const bands = [...rule.bands].sort((a, b) => b.at - a.at);
    for (const b of bands) if (raw >= b.at) return clamp(b.score, 0, 100);
    return 0;
  }
  const span = rule.target - rule.floor;
  if (span <= 0) return raw >= rule.target ? 100 : 0;
  return Math.round(clamp(((raw - rule.floor) / span) * 100, 0, 100));
}

function scoreLower(rule: DimRule, raw: number): number {
  if (rule.mode === 'threshold') return raw <= rule.target ? 100 : 0;
  if (rule.mode === 'banded') {
    const bands = [...rule.bands].sort((a, b) => a.at - b.at);
    for (const b of bands) if (raw <= b.at) return clamp(b.score, 0, 100);
    return 0;
  }
  const span = rule.floor - rule.target;
  if (span <= 0) return raw <= rule.target ? 100 : 0;
  return Math.round(clamp(((rule.floor - raw) / span) * 100, 0, 100));
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/* ---- 周期 ---- */
export type PeriodKey = 'month' | 'quarter' | 'year' | 'custom';
export interface Period { from: string; to: string }

export function periodOf(key: PeriodKey, today = new Date(), custom?: Period): Period {
  const iso = (d: Date) => d.toISOString().slice(0, 10);   // 和下面的 Date.UTC 配对 —— 时区无关,不要换成本地
  const y = today.getFullYear(), m = today.getMonth();
  if (key === 'custom' && custom) return custom;
  if (key === 'month') return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(new Date(Date.UTC(y, m + 1, 0))) };
  if (key === 'quarter') {
    const q = Math.floor(m / 3) * 3;
    return { from: iso(new Date(Date.UTC(y, q, 1))), to: iso(new Date(Date.UTC(y, q + 3, 0))) };
  }
  return { from: iso(new Date(Date.UTC(y, 0, 1))), to: iso(new Date(Date.UTC(y, 11, 31))) };
}

/* 项目落在本期的哪一天上 —— 用来判断它算不算本期的账。
   优先级:实际完工日 > 交付日 > 创建日。写在这里,界面明细里也照着解释。 */
export function anchorDate(p: Project): string {
  const fin = actualFinish(p);
  if (fin) return fin;
  if (p.delivery) return p.delivery;
  return localDay(new Date(p.created));
}

/* 实际完工日:所有排期行都做完时,取最晚的那个实际结束日。
   没做完 / 没填日期就返回 null —— 宁可不算,不要拿计划日冒充实际。 */
export function actualFinish(p: Project): string | null {
  const rows = (p.packages || []).flatMap((pk) => pk.schedule || []);
  if (!rows.length || rows.some((r) => r.status !== 'done')) return null;
  let last = '';
  rows.forEach((r) => { if (r.e && r.e > last) last = r.e; });
  return last || null;
}

export const inPeriod = (p: Project, period: Period) => {
  const a = anchorDate(p);
  return a >= period.from && a <= period.to;
};

/* ---- 四个维度的原始值 ---- */
export interface DimRaw {
  points: number; onTime: number | null; quality: number | null; load: number;
  revRounds: number | null;     // REQ-063:没有有效服务包 = null(不参与加权)
  revRecover: number | null;    // REQ-063:没有应收费轮 = null
}
export interface PersonKpi {
  name: string;
  role: string;
  raw: DimRaw;
  scores: Record<Dimension, number | null>;
  total: number | null;
  projects: Project[];
  /* 明细用:准时 / 质量 各自的分子分母,让人看得出这个比例怎么来的 */
  detail: {
    onTimeHit: number; onTimeAll: number; qualityHit: number; qualityAll: number;
    revPkgs: number; revSum: number;   // REQ-063:有效服务包数、客户修改轮数合计
    fee: FeeCount;                     // REQ-063:日期在本期的应收费轮
  };
}

/* 一个项目准时了吗 —— 实际完工日 <= 交付日 + buffer。
   算不出实际完工日(没做完 / 没填日期)或没有交付日就返回 null,不计入分母。 */
export function onTimeOf(p: Project): boolean | null {
  const fin = actualFinish(p);
  if (!fin || !p.delivery) return null;
  const due = parseISO(p.delivery);
  if (!due) return null;
  due.setDate(due.getDate() + (p.buffer || 0));
  const f = parseISO(fin);
  return f ? f.getTime() <= due.getTime() : null;
}

/* 完工审批一次过了吗。没提交过完工审批的项目不计入分母 ——
   还没走到这一步,不该算它的质量分。 */
export function firstPassOf(p: Project): boolean | null {
  const cr = p.completionReview;
  if (!cr || cr.status === 'not_started' || !cr.submittedAt) return null;
  const st = cr.approval?.status;
  if (st === 'approved') {
    /* 被打回过又改好的,不算一次通过 —— 日志里留了痕 */
    const bounced = (p.log || []).some((e) => /打回|整改|rejected|changes/i.test(e.text || ''));
    return !bounced;
  }
  if (st === 'rejected' || st === 'changes_requested') return false;
  return null;   // 还在审批中
}

export interface KpiInput {
  projects: Project[];
  users: { name: string; role: string }[];
  rules: KpiRules;
  period: Period;
  svc: string;                                   // '' = 全部业务
  pointRulesFor: (createdAt: number) => PointRules;
  /* REQ-063:上线日(YYYY-MM-DD)。不传 = 按「全是上线前的老项目」算平均修改轮数(只算有记录的) */
  since063?: string;
}

/* REQ-045 的口径:开 Invoice 自动归档的照算,手动归档的不算 */
const counted = (p: Project) => !p.archived || p.archiveReason === 'invoiced';

/* 算出每个人的四维原始值与加权总分。
   归属:项目算在它的 PM(owners)头上 —— 与 REQ-038 的「积分默认全归 PM」一致。 */
export function computeKpi(inp: KpiInput): PersonKpi[] {
  const { projects, users, rules, period, svc, pointRulesFor } = inp;
  const since = inp.since063 || '';
  /* REQ-045: 开 Invoice 自动归档的是做完的项目,积分 / 准时 / 一次通过照算(和开票前一样);
     手动归档的照旧不算 */
  const pool = projects.filter((p) => (!p.archived || p.archiveReason === 'invoiced') && inPeriod(p, period) && (!svc || (p.packages || []).some((pk) => pk.svc === svc)));
  /* REQ-063 回收率看的是「日期在本期的应收费轮」,和项目归哪一期无关 —— 所以从全部项目里找 */
  const all = projects.filter(counted);

  return users.map((u) => {
    const mine = pool.filter((p) => (p.owners || []).includes(u.name));
    const set = ruleSetFor(rules, u.role, svc);

    const points = round1(mine.reduce((a, p) => a + projPoints(p, pointRulesFor(p.created)), 0));

    let onTimeHit = 0, onTimeAll = 0, qualityHit = 0, qualityAll = 0;
    mine.forEach((p) => {
      const ot = onTimeOf(p);
      if (ot != null) { onTimeAll++; if (ot) onTimeHit++; }
      const fp = firstPassOf(p);
      if (fp != null) { qualityAll++; if (fp) qualityHit++; }
    });

    /* REQ-063 平均修改轮数:本期完工(实际完工日在本期)的项目,有效服务包的客户修改轮数平均 */
    let revPkgs = 0, revSum = 0;
    mine.forEach((p) => {
      if (!actualFinish(p)) return;
      effectivePkgs(p, since, svc).forEach((x) => { revPkgs++; revSum += x.rounds; });
    });
    /* REQ-063 回收率:这个人负责的项目上,日期在本期的应收费轮 */
    const fee = emptyFee();
    all.forEach((p) => {
      if (!(p.owners || []).includes(u.name)) return;
      countCharged((p.packages || []).filter((pk) => !svc || pk.svc === svc), period.from, period.to, fee);
    });

    const raw: DimRaw = {
      points,
      onTime: onTimeAll ? Math.round((onTimeHit / onTimeAll) * 100) : null,
      quality: qualityAll ? Math.round((qualityHit / qualityAll) * 100) : null,
      load: mine.length,
      revRounds: revPkgs ? round1(revSum / revPkgs) : null,
      revRecover: recoverPct(fee),
    };

    const scores = {} as Record<Dimension, number | null>;
    (Object.keys(raw) as Dimension[]).forEach((k) => {
      const r = set.dims[k];
      scores[k] = r && r.on ? scoreOf(r, raw[k], LOWER_BETTER.has(k)) : null;
    });

    /* 加权:只算「开着 + 算得出分」的维度。某一维这个人这期没有样本
       (比如一个项目都还没完工),就把它的权重排除掉重新归一 ——
       否则等于因为没数据白扣分。 */
    let sum = 0, wsum = 0;
    (Object.keys(scores) as Dimension[]).forEach((k) => {
      const s = scores[k], r = set.dims[k];
      if (s == null || !r || !r.on || r.weight <= 0) return;
      sum += s * r.weight; wsum += r.weight;
    });

    return {
      name: u.name, role: u.role, raw, scores,
      total: wsum ? Math.round(sum / wsum) : null,
      projects: mine,
      detail: { onTimeHit, onTimeAll, qualityHit, qualityAll, revPkgs, revSum, fee },
    };
  });
}

export const round1 = (n: number) => Math.round(n * 10) / 10;

/* 权重合计 —— 界面提示用(建议 100%,但不强制) */
export const weightSum = (set: KpiRuleSet) =>
  (Object.keys(set.dims) as Dimension[]).reduce((a, k) => a + (set.dims[k].on ? set.dims[k].weight : 0), 0);

/* 按生效日挑版本,和积分规则同一套做法 */
export function kpiRulesAt(versions: KpiRuleVersion[], at: number): KpiRules {
  return kpiRulesOn(versions, localDay(new Date(at)));   // 生效日按本地那一天比
}
/* 同上,直接给哪一天(YYYY-MM-DD) */
export function kpiRulesOn(versions: KpiRuleVersion[], day: string): KpiRules {
  if (!versions.length) return DEFAULT_KPI_RULES;
  const sorted = [...versions].sort((a, b) => a.version - b.version);
  let pick = sorted[0];
  for (const v of sorted) if (!v.effectiveFrom || v.effectiveFrom <= day) pick = v;
  return pick.rules;
}

/* REQ-063(JM 1112 定):看板上的一个周期用哪一版规则。
   - 周期结束日在上线日之前的:和以前一样,用「今天」生效的那一版(升级不改变任何历史数字);
   - 周期结束日在上线日(含)之后的:用周期结束那天的规则 —— 只看那天**已经存在**的版本,
     按生效日挑(挑法和以前一样);那天一版都还没存过就是出厂默认。还没结束的周期按今天(= 以前的做法)。
     所以以后再存新规则(包括把生效日往前写的),已经结束的周期都不会被改写。
   since 为空(上线日还没记下来)= 全按以前的做法。 */
export function kpiRulesForPeriod(versions: KpiRuleVersion[], period: Period, since: string, today: string): KpiRules {
  if (!since || period.to < since) return kpiRulesOn(versions, today);
  const day = period.to < today ? period.to : today;
  return kpiRulesOn(versions.filter((v) => !v.createdAt || localDay(new Date(v.createdAt)) <= day), day);
}

/* ---- REQ-063:季度项目分值 / 级别区间 / 每月看 3 个数 ---- */

/* 某一天所在的季度 */
export function quarterOf(day: string): Period & { label: string } {
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7)) - 1;
  const q = Math.floor(m / 3);
  const iso = (d: Date) => d.toISOString().slice(0, 10);   // Date.UTC 配对,时区无关
  return { from: iso(new Date(Date.UTC(y, q * 3, 1))), to: iso(new Date(Date.UTC(y, q * 3 + 3, 0))), label: `${y} Q${q + 1}` };
}
/* 前一个季度 */
const prevQuarter = (q: Period) => {
  const d = new Date(`${q.from}T00:00:00Z`);
  d.setUTCDate(0);   // 上个季度最后一天
  return quarterOf(d.toISOString().slice(0, 10));
};

/* 某人某个季度的项目分值 = 那个季度的积分(points 维度的原始值,REQ-038 规则)。现算,不落库。
   直接走 computeKpi,保证和看板 points 那一列是同一个数。 */
export function pointsIn(projects: Project[], name: string, period: Period, pointRulesFor: (createdAt: number) => PointRules): number {
  return computeKpi({ projects, users: [{ name, role: '' }], rules: DEFAULT_KPI_RULES, period, svc: '', pointRulesFor })[0].raw.points;
}

/* 给 REQ-062 晋级条件用:最近 n 个**已结束**的季度(最近的在前)各自的项目分值 */
export function recentQuarterPoints(projects: Project[], name: string, n: number, today: string, pointRulesFor: (createdAt: number) => PointRules) {
  const out: { label: string; from: string; to: string; points: number }[] = [];
  let q = prevQuarter(quarterOf(today));
  for (let i = 0; i < n; i++) {
    out.push({ ...q, points: pointsIn(projects, name, q, pointRulesFor) });
    q = prevQuarter(q);
  }
  return out;
}

/* 季度分值落在级别区间的哪儿:低于区间 / 区间内 / 区间内 · 已达上一级下限 / 高于区间 · 可考虑晋级 / 不设区间 */
export type BandState = 'below' | 'in' | 'inNext' | 'above' | 'none';
export function bandOf(bands: LevelBands, level: string, pts: number): { state: BandState; lo: number | null; hi: number | null } {
  const lv = PM_LEVEL_ORDER.includes(level as PmLevelKey) ? (level as PmLevelKey) : null;
  const b = lv ? bands[lv] : null;
  if (!lv || !b) return { state: 'none', lo: null, hi: null };
  if (pts < b.lo) return { state: 'below', lo: b.lo, hi: b.hi };
  if (pts > b.hi) return { state: 'above', lo: b.lo, hi: b.hi };
  const next = bands[PM_LEVEL_ORDER[PM_LEVEL_ORDER.indexOf(lv) + 1]];
  return { state: next && pts >= next.lo ? 'inNext' : 'in', lo: b.lo, hi: b.hi };
}
export const BAND_TEXT: Record<BandState, [string, string]> = {
  below: ['低于区间', 'Below range'],
  in: ['区间内', 'Within range'],
  inNext: ['区间内 · 已达上一级下限', 'Within range · reached next level’s minimum'],
  above: ['高于区间 · 可考虑晋级', 'Above range · consider promotion'],
  none: ['不设区间', 'No range'],
};

/* 顶部「每月看 3 个数」—— 全公司口径,跟着看板选的周期 */
export interface CompanyCards {
  onTime: { hit: number; all: number; pct: number | null; finished: number };
  rounds: { pkgs: number; sum: number; avg: number | null; projects: number };
  recover: FeeCount & { pct: number | null };
}
export function companyCards(projects: Project[], period: Period, since: string): CompanyCards {
  const pool = projects.filter(counted);
  const finished = pool.filter((p) => { const f = actualFinish(p); return !!f && f >= period.from && f <= period.to; });
  let hit = 0, all = 0, pkgs = 0, sum = 0, withPk = 0;
  finished.forEach((p) => {
    const ot = onTimeOf(p);
    if (ot != null) { all++; if (ot) hit++; }
    const eff = effectivePkgs(p, since);
    if (eff.length) withPk++;
    eff.forEach((x) => { pkgs++; sum += x.rounds; });
  });
  const fee = emptyFee();
  pool.forEach((p) => countCharged(p.packages || [], period.from, period.to, fee));
  return {
    onTime: { hit, all, pct: all ? Math.round((hit / all) * 100) : null, finished: finished.length },
    rounds: { pkgs, sum, avg: pkgs ? round1(sum / pkgs) : null, projects: withPk },
    recover: { ...fee, pct: recoverPct(fee) },
  };
}

/* 落库前的清洗 */
export function validateKpiRules(raw: unknown): { ok: true; rules: KpiRules } | { ok: false; error: string } {
  const r = raw as Partial<KpiRules>;
  if (!r || !Array.isArray(r.sets) || !r.sets.length) return { ok: false, error: '规则格式不对:至少要有一套默认规则' };
  if (r.sets.length > 60) return { ok: false, error: '规则最多 60 套' };
  const modes = new Set(SCORE_MODES.map((m) => m[0]));
  const dims = DIMENSIONS.map((d) => d[0]);
  const seen = new Set<string>();
  const sets: KpiRuleSet[] = [];

  for (const s of r.sets) {
    const role = String(s?.role || '').slice(0, 20);
    const svc = String(s?.svc || '').slice(0, 40);
    const key = role + '|' + svc;
    if (seen.has(key)) return { ok: false, error: `「${role || '不限角色'} / ${svc || '不限业务'}」这套规则重复了` };
    seen.add(key);
    const out = {} as Record<Dimension, DimRule>;
    for (const d of dims) {
      const x = (s?.dims || {})[d] as Partial<DimRule> | undefined;
      /* REQ-063:老版本里没有新维度 —— 按出厂值(关闭、权重 0)补上,历史周期的总分不会变 */
      if (!x && NEW_DIMS_063.includes(d)) { out[d] = newDims()[d as 'revRounds' | 'revRecover']; continue; }
      const mode = (modes.has(x?.mode as ScoreMode) ? x!.mode : 'linear') as ScoreMode;
      out[d] = {
        on: x?.on !== false,
        weight: num(x?.weight, 25, 0, 100),
        mode,
        target: num(x?.target, 100, 0, 1e6),
        floor: num(x?.floor, 0, 0, 1e6),
        bands: (Array.isArray(x?.bands) ? x!.bands! : []).slice(0, 10)
          .map((b) => ({ at: num(b?.at, 0, 0, 1e6), score: num(b?.score, 0, 0, 100) })),
      };
      if (LOWER_BETTER.has(d)) {
        if (out[d].mode === 'linear' && out[d].floor <= out[d].target) {
          return { ok: false, error: `「${dimName(d, 'zh')}」越低越好:0 分线要高于满分线` };
        }
      } else if (out[d].mode === 'linear' && out[d].floor >= out[d].target) {
        return { ok: false, error: `「${dimName(d, 'zh')}」的 0 分线不能高于满分线` };
      }
      if (out[d].mode === 'banded' && out[d].bands.length === 0) {
        return { ok: false, error: `「${dimName(d, 'zh')}」选了分段,但一段都没设` };
      }
    }
    sets.push({ role, svc, dims: out });
  }
  if (!sets.some((s) => !s.role && !s.svc)) return { ok: false, error: '必须保留一套「不限角色 / 不限业务」的默认规则' };

  /* REQ-063:级别区间、修改轮次规则、三个数的目标。老版本没有 → 出厂值 */
  const rb = (r as { bands?: Partial<Record<PmLevelKey, { lo?: unknown; hi?: unknown } | null>> }).bands;
  const bands = {} as LevelBands;
  for (const lv of PM_LEVEL_ORDER) {
    const x = rb && typeof rb === 'object' && lv in rb ? rb[lv] : undefined;
    if (x === undefined) { bands[lv] = DEFAULT_BANDS[lv] ? { ...DEFAULT_BANDS[lv]! } : null; continue; }
    if (x === null) { bands[lv] = null; continue; }
    const lo = num(x.lo, 0, 0, 1e6), hi = num(x.hi, 0, 0, 1e6);
    if (hi <= lo) return { ok: false, error: `「${PM_LEVEL_NAME[lv]}」的区间上限要大于下限` };
    bands[lv] = { lo, hi };
  }
  const rr = ((r as { rev?: Partial<RevRules> }).rev || {}) as Partial<RevRules>;
  const rev: RevRules = {
    e5Round: Math.round(num(rr.e5Round, DEFAULT_REV_RULES.e5Round, 1, 50)),
    chargeFrom: Math.round(num(rr.chargeFrom, DEFAULT_REV_RULES.chargeFrom, 1, 50)),
    reasonAt: Math.round(num(rr.reasonAt, DEFAULT_REV_RULES.reasonAt, 1, 50)),
    quoteHours: Math.round(num(rr.quoteHours, DEFAULT_REV_RULES.quoteHours, 1, 720)),
  };
  const rt = ((r as { targets?: Partial<CardTargets> }).targets || {}) as Partial<CardTargets>;
  const targets: CardTargets = {
    onTime: num(rt.onTime, DEFAULT_CARD_TARGETS.onTime, 0, 100),
    rounds: num(rt.rounds, DEFAULT_CARD_TARGETS.rounds, 0, 50),
    recover: num(rt.recover, DEFAULT_CARD_TARGETS.recover, 0, 100),
  };
  return { ok: true, rules: { sets, bands, rev, targets } };
}

function num(v: unknown, dflt: number, lo: number, hi: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return round1(clamp(n, lo, hi));
}
