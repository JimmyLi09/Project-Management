/* ===== Role-based permissions (enforced server-side, mirrored client-side for UI) =====
   PD / BD  — full access: everything incl. assignment, points, decisions
   Sales    — presales / invoice / commercial info; production read-only; can create
   PM       — production edit on assigned projects
   Member   — only tasks assigned (👤) to them
   Viewer   — read-only */

import type { Project, Role, ScheduleRow, User } from './types';

export interface Identity {
  name: string;
  role: Role;
}

export const identityOf = (u: User): Identity => ({ name: u.name, role: u.role });

export const isFull = (u: Identity) => u.role === 'director' || u.role === 'bd';

export const canEdit = (u: Identity, p: Project) =>
  isFull(u) || (p.owners || []).includes(u.name) || (p.perm || []).includes(u.name);

export const canCommercial = (u: Identity, _p?: Project) => isFull(u) || u.role === 'sales';

/* v2.2 §6/§7: Finance may edit invoice/payment status only (not production).
   PD/BD can view finance info but only Finance may change it (§7.2). */
export const isFinance = (u: Identity) => u.role === 'finance';
export const canEditFinance = (u: Identity) => u.role === 'finance';

export const canAssign = (u: Identity, _p?: Project) => isFull(u);

export const canStageTo = (u: Identity, p: Project, s: string) =>
  s === 'presales' || s === 'invoice' ? canCommercial(u, p) : canEdit(u, p);

export const canMeta = (u: Identity, p: Project) => canEdit(u, p) || canCommercial(u, p);

export const canRowEdit = (u: Identity, p: Project, row?: ScheduleRow) =>
  canEdit(u, p) || (u.role === 'member' && !!row && row.assignee === u.name);

export const canDecide = (u: Identity) => isFull(u);

export const canCreate = (u: Identity) => isFull(u) || u.role === 'sales';

/* REQ-008: only Sales / PD / BD may delete a project. PM & members can edit/add
   but never delete; viewer/finance cannot either. Server is the final authority. */
export const canDelete = (u: Identity) => isFull(u) || u.role === 'sales';

export const canAdmin = (u: Identity) => isFull(u);

/* ===== REQ-022: who sees which part of the post-sales workflow =====
   Sales 管两头(交接、核对/开票/收款),PM 只管制作 —— 整张售后卡片对 PM
   完全不出现。这些只影响前端呈现:服务端 applyAction 里每个 action 自己的
   权限校验一条都没动,藏 UI 不等于放宽权限。

   注意 canEdit 对 PD/BD 也返回 true,不能拿它判断「是不是 PM」,否则 PD 会
   跟着被藏掉、无法审批 —— 判断 PM 一律用 isPM。 */
export const isPM = (u: Identity) => u.role === 'pm';
/* member / viewer / finance 只旁观,不参与生产也不发起售后 */
const isBystander = (u: Identity) => u.role === 'member' || u.role === 'viewer';

/* PM 整块不见;其余角色都看得到卡片(至少是顶部六步时间线) */
export const canSeeWorkflow = (u: Identity) => !isPM(u);
/* 顶部六步时间线:除 PM 外一律保留(只读),含 Finance 与 member/viewer */
export const canSeeWorkflowTimeline = (u: Identity) => !isPM(u);

export const canSeeHandoverBlock = (u: Identity) =>
  !isPM(u) && !isBystander(u) && u.role !== 'finance' && canCommercial(u);
export const canSeeCompletionBlock = (u: Identity) => isFull(u);
export const canSeeVerifyBlock = (u: Identity) =>
  !isPM(u) && !isBystander(u) && u.role !== 'finance' && canCommercial(u);
export const canSeeFinanceBlock = (u: Identity) =>
  !isPM(u) && !isBystander(u) && (isFull(u) || u.role === 'sales' || u.role === 'finance');

/* 「提交完工」的新家:排期页底部,只给本项目的 PM 与全权角色 */
export const canSubmitCompletionHere = (u: Identity, p: Project) => canEdit(u, p);

/* REQ-012: anyone who actually builds schedules/checklists may save one as a
   reusable template — that includes PM, who owns the production content.
   Viewer / member / finance can still read and apply, not save. */
export const canSaveTemplate = (u: Identity) => isFull(u) || u.role === 'sales' || u.role === 'pm';

/* Only the author or PD/BD may delete a shared template, so one person can't
   wipe another team's saved layout. */
export const canDeleteTemplate = (u: Identity, createdBy: string) => isFull(u) || u.name === createdBy;

export const ROLE_LABEL: Record<Role, string> = {
  director: 'PD',
  bd: 'BD',
  sales: '销售',
  pm: 'PM',
  member: '成员',
  viewer: '只读',
  finance: 'Finance',
};
