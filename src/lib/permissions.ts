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

export const canAssign = (u: Identity, _p?: Project) => isFull(u);

export const canStageTo = (u: Identity, p: Project, s: string) =>
  s === 'presales' || s === 'invoice' ? canCommercial(u, p) : canEdit(u, p);

export const canMeta = (u: Identity, p: Project) => canEdit(u, p) || canCommercial(u, p);

export const canRowEdit = (u: Identity, p: Project, row?: ScheduleRow) =>
  canEdit(u, p) || (u.role === 'member' && !!row && row.assignee === u.name);

export const canDecide = (u: Identity) => isFull(u);

export const canCreate = (u: Identity) => isFull(u) || u.role === 'sales';

export const canAdmin = (u: Identity) => isFull(u);

export const ROLE_LABEL: Record<Role, string> = {
  director: 'PD',
  bd: 'BD',
  sales: '销售',
  pm: 'PM',
  member: '成员',
  viewer: '只读',
};
