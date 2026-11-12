/* ===== REQ-037 / REQ-063:KPI 规则版本 + 修改记录的上线日 =====
   版本列表原来写在 /api/kpi-rules 里,REQ-063 起项目动作(修改记录按规则算收费)、
   培训(晋级条件要季度分值)也要读,挪到这里共用。 */
import { getSetting, listKpiRules, listPointRules, setSetting } from './db';
import { DEFAULT_POINT_RULES, rulesAt, validateRules, type PointRuleVersion, type PointRules } from '@/lib/points';
import { DEFAULT_KPI_RULES, kpiRulesAt, validateKpiRules, type KpiRuleVersion, type KpiRules } from '@/lib/kpi';
import { SINCE_KEY_063 } from '@/lib/revisions';

/* 每一版都过一遍 validateKpiRules:老版本缺的新维度 / 区间 / 轮次规则在这里按出厂值补上 */
export function kpiRuleVersions(): KpiRuleVersion[] {
  return listKpiRules().map((r) => {
    let rules = DEFAULT_KPI_RULES;
    try { const v = validateKpiRules(JSON.parse(r.rules)); if (v.ok) rules = v.rules; } catch { /* 坏行回落到出厂默认 */ }
    return { version: r.version, rules, effectiveFrom: r.effective_from, note: r.note, createdAt: r.created_at, createdBy: r.created_by };
  });
}

/* 今天生效的那一版 */
export const currentKpiRules = (now = Date.now()): KpiRules => kpiRulesAt(kpiRuleVersions(), now);

/* ---- REQ-063 上线日 ----
   「平均修改轮数」只把上线日之后交接的项目 0 轮按 0 算;上线前的老项目要记过至少一轮才算。
   第一次启动新版本时记下当天(只记一次);PD / BD 可以在「规则设置 · KPI 规则」里改。 */
export const since063 = (): string => getSetting(SINCE_KEY_063);
export function setSince063(day: string) { setSetting(SINCE_KEY_063, day); }

/* REQ-038 积分规则版本(和 /api/point-rules 同一套清洗)—— 服务端算季度项目分值用 */
export function pointRuleVersions(): PointRuleVersion[] {
  return listPointRules().map((r) => {
    let rules = DEFAULT_POINT_RULES;
    try { const v = validateRules(JSON.parse(r.rules)); if (v.ok) rules = v.rules; } catch { /* 坏行回落到出厂默认 */ }
    return { version: r.version, rules, effectiveFrom: r.effective_from, note: r.note, createdAt: r.created_at, createdBy: r.created_by };
  });
}
/* 项目按它创建时生效的那一版积分规则计分(和前端 store 的 rulesFor 一样) */
export function pointRulesFor(): (createdAt: number) => PointRules {
  const vs = pointRuleVersions();
  return (createdAt: number) => (vs.length ? rulesAt(vs, createdAt) : DEFAULT_POINT_RULES);
}
