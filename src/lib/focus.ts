/* ===== 0922 变更单 · REQ-011 / REQ-034:统计与汇报里的数字可点击下钻 =====
   统计报表和向上汇报上的每个数字都是「一组项目」数出来的。点它,就该看到
   那一组项目本身 —— 所以这里只定义「那一组是哪一组」,由项目列表页照单过滤。

   口径写在这一个文件里,统计页算数和列表页过滤用的是同一个谓词;两边各写
   一遍的话,数字和点开后看到的条数迟早对不上。 */

import type { Project } from './types';
import { overdueItems, projStage, staleInfo } from './project';
import { STAGES } from './templates';

export type Focus =
  | { kind: 'all' }
  | { kind: 'active' }                                   // 进行中(未到完工 / 开票)
  | { kind: 'overdue' }                                  // 有逾期阶段的项目
  | { kind: 'points' }                                   // 全部,按积分从高到低
  | { kind: 'stage'; stage: string }
  | { kind: 'pm'; name: string; active?: boolean }
  | { kind: 'decision' }                                 // 需 Director 决定且未批
  | { kind: 'stale' }                                    // 周报超期未更新
  | { kind: 'collections' }                              // 逾期未收款 / 收款高风险
  /* 售后 SLA 那张表的样本集是 metrics 一边算耗时一边攒出来的,没法用一个
     谓词重算(要拿到每个项目在该步骤花了几天)。所以那几格直接把项目 id
     带过来,附一句它是哪一组。 */
  | { kind: 'ids'; ids: string[]; label: string; labelEn: string };

/* 统计表里「(未指派)」那一行的内部名。用一个不可能当人名的标记,而不是译好的
   「(未指派)」—— 那串文字会跟着语言变,拿它当 key 迟早对不上。 */
export const UNASSIGNED_PM = '\u0000unassigned';
export const isUnassignedName = (n: string) => n === UNASSIGNED_PM;

const isActive = (p: Project) => { const s = projStage(p); return s !== 'invoice' && s !== 'complete'; };

export function matchFocus(p: Project, f: Focus): boolean {
  switch (f.kind) {
    case 'all': return true;
    case 'points': return true;
    case 'active': return isActive(p);
    case 'overdue': return overdueItems(p).length > 0;
    case 'stage': return projStage(p) === f.stage;
    case 'pm': {
      const owners = p.owners || [];
      const mine = isUnassignedName(f.name) ? owners.length === 0 : owners.includes(f.name);
      return mine && (f.active ? isActive(p) : true);
    }
    case 'decision': return !!p.update?.needDirector && p.update.dStatus === 'pending';
    case 'stale': return staleInfo(p.update).cls !== 'stale-ok' && (p.owners || []).length > 0;
    case 'collections': return p.commercialStatus === 'overdue' || p.paymentRisk?.level === 'high';
    case 'ids': return f.ids.includes(p.id);
  }
}

/* 列表页顶上那条「你现在看的是哪一组」。点进来的人得知道自己点了什么,
   也得能一键退回全部。 */
export function focusLabel(f: Focus, lang: 'zh' | 'en'): string {
  const zh = lang === 'zh';
  switch (f.kind) {
    case 'all': return zh ? '全部项目' : 'All projects';
    case 'points': return zh ? '全部项目 · 按积分排序' : 'All projects · by points';
    case 'active': return zh ? '进行中' : 'Active';
    case 'overdue': return zh ? '有逾期阶段的项目' : 'Projects with overdue phases';
    case 'stage': {
      const s = STAGES.find((x) => x[0] === f.stage);
      return `${zh ? '阶段' : 'Stage'}:${s ? (zh ? s[1] : s[2]) : f.stage}`;
    }
    case 'pm': {
      const who = isUnassignedName(f.name) ? (zh ? '(未指派)' : '(unassigned)') : f.name;
      return f.active ? `${who} · ${zh ? '进行中' : 'active'}` : who;
    }
    case 'decision': return zh ? '待 Director 决策' : 'Awaiting Director decision';
    case 'stale': return zh ? '周报未更新' : 'Stale weekly updates';
    case 'collections': return zh ? '逾期收款 / 收款高风险' : 'Overdue collections / high risk';
    case 'ids': return zh ? f.label : f.labelEn;
  }
}
