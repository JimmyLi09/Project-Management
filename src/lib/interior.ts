/* ===== REQ-058 §2.3 · 室内资料是可选组 =====
   新建项目勾「包含室内部分」(p.includeInterior)才显示;3D VR/720、单元模型本来就是做室内,自动包含。
   不包含时「室内资料」(key = int)这一组照样生成、存在项目里(不丢数据,之后可以打开),但:
   清单页不显示、不算完成率 / 待处理 / 逾期、不导出、不进待办。老项目没有 key = int 的组,这里不起作用。 */
import type { ChecklistGroup } from './types';
import { INTERIOR_AUTO_SVCS, INTERIOR_KEY } from './templates';

/* 这个项目的业务里有没有自动包含室内的(3D VR/720、单元模型) */
type P = { services?: string[]; packages?: { svc: string }[]; includeInterior?: boolean };
/* 新建项目时问「包含室内部分」的业务(模板里有室内资料组、但不是本来就做室内的) */
export const INTERIOR_OPT_SVCS = ['cgi', 'ani'];
export const interiorAuto = (p: P) =>
  (p.services || []).some((s) => INTERIOR_AUTO_SVCS.includes(s)) || (p.packages || []).some((pk) => INTERIOR_AUTO_SVCS.includes(pk.svc));
export const interiorOn = (p: P) => !!p.includeInterior || interiorAuto(p);
export const isInteriorGroup = (g: Pick<ChecklistGroup, 'key'>) => g.key === INTERIOR_KEY;
/* 这一组现在要不要藏起来 */
export const clGroupHidden = (p: P, g: Pick<ChecklistGroup, 'key'>) =>
  isInteriorGroup(g) && !interiorOn(p);
/* 显示 / 计数 / 导出用的分组 */
export const visibleGroups = (p: P & { checklist?: ChecklistGroup[] }): ChecklistGroup[] =>
  (p.checklist || []).filter((g) => !clGroupHidden(p, g));
/* 项目里有没有室内资料组(有才显示「包含室内部分」开关) */
export const hasInteriorGroup = (p: { checklist?: ChecklistGroup[] }) => (p.checklist || []).some(isInteriorGroup);
