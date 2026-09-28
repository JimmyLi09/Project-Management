/* ===== Role-based permissions (enforced server-side, mirrored client-side for UI) =====
   PD / BD  — full access: everything incl. assignment, points, decisions
   Sales    — presales / invoice / commercial info; production read-only; can create
   PM       — production edit on assigned projects
   Member   — only tasks assigned (👤) to them
   Viewer   — read-only */

import type { Project, Role, ScheduleRow, User } from './types';
import { ROLE_TERMS } from './terms';

export interface Identity {
  name: string;
  role: Role;
}

export const identityOf = (u: User): Identity => ({ name: u.name, role: u.role });

export const isFull = (u: Identity) => u.role === 'director' || u.role === 'bd';

/* REQ-043: 项目上被点名的工程师,对这个项目和 PM 一样能改生产内容
   —— 「每个项目单独一个 engineer」,他就是这个项目的人,不是路过帮忙勾一行的。
   老项目没有 engineer 字段,这一条对它们恒为假,行为一个字没变。 */
export const canEdit = (u: Identity, p: Project) =>
  isFull(u) || (p.owners || []).includes(u.name) || (p.perm || []).includes(u.name) || p.engineer === u.name;

export const canCommercial = (u: Identity, _p?: Project) => isFull(u) || u.role === 'sales';

/* ===== REQ-043: 项目可见性 —— PM / Engineer 只看自己的项目 =====
   收窄的只有 pm 与 member 这两个「干活的」角色。director / bd 本来就看全部;
   sales 要跟自己没建过的单子、finance 要给所有项目开票、viewer 就是拿来旁观
   的 —— 项目上并没有「Sales 对接人」这类归属字段,硬把他们也收窄等于让他们
   看不见该管的项目。这三个角色保持看全部(0922 已确认)。

   归属的判据和 canEdit 用的是同一批数据:owners = PM,engineer = 这个项目的
   工程师(项目级指派,一个项目一个人),perm = 额外参与人。最后再兜一条「有
   一行任务点名指派给我」—— 没被指派为项目工程师、只是来帮一行忙的人,也得
   看得见那个项目,否则他连自己的待办都点不开。 */
export const isScopedRole = (u: Identity) => u.role === 'pm' || u.role === 'member';

export const isOnProject = (u: Identity, p: Project) =>
  (p.owners || []).includes(u.name)
  || p.engineer === u.name
  || (p.perm || []).includes(u.name)
  || (p.packages || []).some((pk) => (pk.schedule || []).some((r) => r.assignee === u.name));

export const canSeeProject = (u: Identity, p: Project) => !isScopedRole(u) || isOnProject(u, p);

/* 服务端取项目、客户端过列表都走这一个口子 —— 列表 / 待办 / 统计 / 汇报 /
   档案 / 搜索全是从同一份 projects 派生出来的,所以在这里过一次就够了。 */
export const visibleProjects = <T extends Project>(u: Identity, ps: T[]): T[] =>
  (isScopedRole(u) ? ps.filter((p) => isOnProject(u, p)) : ps);

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

/* AV platform · LED spec v1.0 §11. PD/BD stand in for 管理员.
   销售 may start a project and upload drawings but not review them or export
   drawings; 人工校核 and 出图 belong to the PM — on projects they are assigned
   to. Without a project these answer the role-level question (what to show);
   with one, whether this person may act on that project. */
export const canUploadDrawing = (u: Identity, p?: Project) =>
  isFull(u) || u.role === 'sales' || (u.role === 'pm' && (!p || canEdit(u, p)));
export const canReviewDrawing = (u: Identity, p?: Project) =>
  isFull(u) || (u.role === 'pm' && (!p || canEdit(u, p)));
export const canExportLed = (u: Identity) => isFull(u) || u.role === 'pm';

/* Price library and costing. Cost prices are commercial data: production
   members and read-only viewers do not see them. Only PD / BD edit prices and
   company parameters (管理员, §11). Saving a configuration or a cost sheet is
   the project PM's job, like review. */
export const canViewPrices = (u: Identity) => u.role !== 'member' && u.role !== 'viewer';
export const canEditPrices = (u: Identity) => isFull(u);
export const canCostProject = (u: Identity, p?: Project) => canReviewDrawing(u, p);

/* 07 报价审批 (2026-09-26): sales or the project's PM put a quotation together
   and submit it; every quotation needs PD / BD approval before it goes out. */
export const canSubmitQuote = (u: Identity, p?: Project) =>
  isFull(u) || u.role === 'sales' || (u.role === 'pm' && (!p || canEdit(u, p)));
export const canApproveQuote = (u: Identity) => isFull(u);

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

/* REQ-041: 角色名的两语词条集中在 lib/terms.ts,这里只保留中文一份
   给旧调用点用;界面上取名请用 roleTerm(role, lang),不要直接读这张表
   —— 直接读等于把 EN 模式下的角色名又写死成中文。 */
export const ROLE_LABEL: Record<Role, string> = {
  director: ROLE_TERMS.director[0],
  bd: ROLE_TERMS.bd[0],
  sales: ROLE_TERMS.sales[0],
  pm: ROLE_TERMS.pm[0],
  member: ROLE_TERMS.member[0],
  viewer: ROLE_TERMS.viewer[0],
  finance: ROLE_TERMS.finance[0],
};

/* ===== REQ-035: 知识库 =====
   需求默认口径:总监 / PM 可编辑,其余角色只读 + 可导出。
   BD 与总监同权(平台里两者一直是一档),删除文档收得更紧一些 ——
   知识库是公司资产,误删一篇 SOP 比误改一篇代价大。 */
export const canEditKb = (u: Identity) => isFull(u) || u.role === 'pm';
export const canDeleteKb = (u: Identity) => isFull(u);

/* REQ-036: 新人培训 —— 路径与题库由 总监 / BD / PM 维护(和知识库同一档);
   学员进度所有人都能看自己的,管理视图另判。 */
export const canEditTraining = (u: Identity) => canEditKb(u);
export const canSeeAllTraining = (u: Identity) => canEditKb(u);
/* 具体到某一条路径:勾了「仅总监维护」的,PM 就碰不了了。
   题库和学员在同一批人里(全体 PM)的时候,这是唯一能真正把答案挡住的办法。 */
export const canEditPath = (u: Identity, adminOnly: boolean) =>
  (adminOnly ? isFull(u) : canEditTraining(u));
