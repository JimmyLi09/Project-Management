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

export type Dimension = 'points' | 'onTime' | 'quality' | 'load';
export type ScoreMode = 'threshold' | 'linear' | 'banded';

export const DIMENSIONS: [Dimension, string, string, string][] = [
  ['points', '积分产出', 'Points output', '本期项目按积分规则(REQ-038)算出的分之和'],
  ['onTime', '准时交付率', 'On-time rate', '本期完工的项目里,实际完工日不晚于交付日(含 buffer)的比例'],
  ['quality', '售后质量', 'Post-sales quality', '提交过完工审批的项目里,一次通过(没被打回 / 要求整改)的比例'],
  ['load', '项目负载', 'Workload', '本期经手的项目数'],
];
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

export interface KpiRules { sets: KpiRuleSet[] }

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
    },
  }],
};

/* 挑最贴合的一套规则:角色+业务 > 业务 > 角色 > 默认 */
export function ruleSetFor(rules: KpiRules, role: string, svc: string): KpiRuleSet {
  const s = rules.sets;
  return s.find((x) => x.role === role && x.svc === svc && role && svc)
    || s.find((x) => !x.role && x.svc === svc && svc)
    || s.find((x) => x.role === role && !x.svc && role)
    || s.find((x) => !x.role && !x.svc)
    || DEFAULT_KPI_RULES.sets[0];
}

/* 原始值 → 0–100 分 */
export function scoreOf(rule: DimRule, raw: number | null): number | null {
  if (raw == null) return null;
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

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/* ---- 周期 ---- */
export type PeriodKey = 'month' | 'quarter' | 'year' | 'custom';
export interface Period { from: string; to: string }

export function periodOf(key: PeriodKey, today = new Date(), custom?: Period): Period {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
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
  return new Date(p.created).toISOString().slice(0, 10);
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
export interface DimRaw { points: number; onTime: number | null; quality: number | null; load: number }
export interface PersonKpi {
  name: string;
  role: string;
  raw: DimRaw;
  scores: Record<Dimension, number | null>;
  total: number | null;
  projects: Project[];
  /* 明细用:准时 / 质量 各自的分子分母,让人看得出这个比例怎么来的 */
  detail: { onTimeHit: number; onTimeAll: number; qualityHit: number; qualityAll: number };
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
}

/* 算出每个人的四维原始值与加权总分。
   归属:项目算在它的 PM(owners)头上 —— 与 REQ-038 的「积分默认全归 PM」一致。 */
export function computeKpi(inp: KpiInput): PersonKpi[] {
  const { projects, users, rules, period, svc, pointRulesFor } = inp;
  const pool = projects.filter((p) => !p.archived && inPeriod(p, period) && (!svc || (p.packages || []).some((pk) => pk.svc === svc)));

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

    const raw: DimRaw = {
      points,
      onTime: onTimeAll ? Math.round((onTimeHit / onTimeAll) * 100) : null,
      quality: qualityAll ? Math.round((qualityHit / qualityAll) * 100) : null,
      load: mine.length,
    };

    const scores = {} as Record<Dimension, number | null>;
    (Object.keys(raw) as Dimension[]).forEach((k) => {
      const r = set.dims[k];
      scores[k] = r && r.on ? scoreOf(r, raw[k]) : null;
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
      detail: { onTimeHit, onTimeAll, qualityHit, qualityAll },
    };
  });
}

export const round1 = (n: number) => Math.round(n * 10) / 10;

/* 权重合计 —— 界面提示用(建议 100%,但不强制) */
export const weightSum = (set: KpiRuleSet) =>
  (Object.keys(set.dims) as Dimension[]).reduce((a, k) => a + (set.dims[k].on ? set.dims[k].weight : 0), 0);

/* 按生效日挑版本,和积分规则同一套做法 */
export function kpiRulesAt(versions: KpiRuleVersion[], at: number): KpiRules {
  if (!versions.length) return DEFAULT_KPI_RULES;
  const sorted = [...versions].sort((a, b) => a.version - b.version);
  const day = new Date(at).toISOString().slice(0, 10);
  let pick = sorted[0];
  for (const v of sorted) if (!v.effectiveFrom || v.effectiveFrom <= day) pick = v;
  return pick.rules;
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
      if (out[d].mode === 'linear' && out[d].floor >= out[d].target) {
        return { ok: false, error: `「${dimName(d, 'zh')}」的 0 分线不能高于满分线` };
      }
      if (out[d].mode === 'banded' && out[d].bands.length === 0) {
        return { ok: false, error: `「${dimName(d, 'zh')}」选了分段,但一段都没设` };
      }
    }
    sets.push({ role, svc, dims: out });
  }
  if (!sets.some((s) => !s.role && !s.svc)) return { ok: false, error: '必须保留一套「不限角色 / 不限业务」的默认规则' };
  return { ok: true, rules: { sets } };
}

function num(v: unknown, dflt: number, lo: number, hi: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return round1(clamp(n, lo, hi));
}
