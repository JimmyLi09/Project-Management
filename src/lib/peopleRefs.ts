/* ===== REQ-051 · 项目里按名字引用人的地方 =====
   项目里记人都是记名字。这里集中列出「这个人负责 / 被指派」的位置,
   改名(把所有引用跟着改)和删除用户(先把他的工作转给接手人)都用这一份,不会漏。

   职责类(会被改名 / 转交):
     owners(PM)、engineer(项目工程师)、perm(编辑授权)、服务包负责人 pk.owner、
     交接给谁 handover.assignedPmId、排期 assignee、信息清单 owner
     (含迁移前的 pk.checklist、checklistLegacy、已移除的项)。
   历史类(**不改**,显示时标「(已删除)」):日志 by、收料记录 by / receivedBy、交接 / 完工 /
     核对 / 开票的操作人等 —— 当时是谁做的就是谁。 */

import type { ChecklistGroup, ChecklistItem, Project } from './types';

const isOpenRow = (status: string) => status !== 'done';
const isOpenItem = (it: ChecklistItem) => it.status !== 'confirmed' && it.status !== 'na';

/* live = 只看正在用的清单(转交、数工作量);否则连迁移前的备份和已移除的项一起(改名) */
function eachChecklistItem(p: Project, fn: (it: ChecklistItem) => void, live = false) {
  const groups = (gs?: ChecklistGroup[]) => (gs || []).forEach((g) => (g.items || []).forEach(fn));
  groups(p.checklist);
  (p.packages || []).forEach((pk) => groups(pk.checklist));
  if (live) return;
  (p.checklistLegacy || []).forEach((l) => groups(l.checklist));
  (p.checklistRemoved || []).forEach((r) => r.item && fn(r.item));
}

export interface PersonWork { projects: string[]; todos: number; checklist: number }

/* 这个人名下还有什么(删除前给 PD / BD 看) */
export function workOf(projects: Project[], name: string): PersonWork {
  const out: PersonWork = { projects: [], todos: 0, checklist: 0 };
  for (const p of projects) {
    const owns = (p.owners || []).includes(name) || p.engineer === name || (p.perm || []).includes(name)
      || (p.packages || []).some((pk) => pk.owner === name)
      || (p.handover?.assignedPmId === name && p.handover.status !== 'accepted');
    if (owns && !p.archived) out.projects.push(p.id);
    if (p.archived) continue;
    (p.packages || []).forEach((pk) => (pk.schedule || []).forEach((r) => { if (r.assignee === name && isOpenRow(r.status)) out.todos++; }));
    eachChecklistItem(p, (it) => { if (it.owner === name && isOpenItem(it)) out.checklist++; }, true);
  }
  return out;
}

const swapList = (list: string[] | undefined, from: string, to: string) => {
  if (!list || !list.includes(from)) return list;
  const out: string[] = [];
  for (const n of list.map((x) => (x === from ? to : x))) if (!out.includes(n)) out.push(n);   // 接手人本来就在名单里时不重复
  return out;
};

/* 改名:把所有职责类引用换成新名字,返回改了几处 */
export function renameInProject(p: Project, from: string, to: string): number {
  let n = 0;
  const lists: ('owners' | 'perm')[] = ['owners', 'perm'];
  for (const k of lists) { const next = swapList(p[k], from, to); if (next !== p[k]) { p[k] = next as string[]; n++; } }
  if (p.engineer === from) { p.engineer = to; n++; }
  if (p.handover && p.handover.assignedPmId === from) { p.handover.assignedPmId = to; n++; }
  (p.packages || []).forEach((pk) => {
    if (pk.owner === from) { pk.owner = to; n++; }
    (pk.schedule || []).forEach((r) => { if (r.assignee === from) { r.assignee = to; n++; } });
  });
  eachChecklistItem(p, (it) => { if (it.owner === from) { it.owner = to; n++; } });
  return n;
}

/* 删除用户前转交:项目职责 → toProjects;未完成的排期 → toTasks;未确认的清单项 → toChecklist。
   已完成的排期行、已确认的清单项是历史,保留原名(显示「(已删除)」)。
   已归档的项目整个是历史(开完票 / 收尾了),不动 —— 和删除弹窗里数的口径一样(workOf)。
   某一类没给接手人(那一类本来就没有工作)就不碰那一类,绝不写进空名字。 */
export function handOverWork(p: Project, from: string, to: { projects: string; tasks: string; checklist: string }): { projects: number; tasks: number; checklist: number } {
  const c = { projects: 0, tasks: 0, checklist: 0 };
  if (p.archived || !from) return c;
  if (to.projects) {
    for (const k of ['owners', 'perm'] as const) { const next = swapList(p[k], from, to.projects); if (next !== p[k]) { p[k] = next as string[]; c.projects++; } }
    if (p.engineer === from) { p.engineer = to.projects; c.projects++; }
    if (p.handover && p.handover.assignedPmId === from && p.handover.status !== 'accepted') { p.handover.assignedPmId = to.projects; c.projects++; }
    (p.packages || []).forEach((pk) => { if (pk.owner === from) { pk.owner = to.projects; c.projects++; } });
  }
  if (to.tasks) {
    (p.packages || []).forEach((pk) => (pk.schedule || []).forEach((r) => { if (r.assignee === from && isOpenRow(r.status)) { r.assignee = to.tasks; c.tasks++; } }));
  }
  if (to.checklist) eachChecklistItem(p, (it) => { if (it.owner === from && isOpenItem(it)) { it.owner = to.checklist; c.checklist++; } }, true);
  return c;
}
