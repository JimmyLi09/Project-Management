/* ===== AV 接口的项目可见性守卫(REQ-043)=====
   AV 平台的接口都是「给我一个 project id,我把这个项目的东西给你」。角色那一
   层它们各自查得挺严(谁能改方案、谁能确认成本、谁能审批报价),但漏了一个
   更靠前的问题:**这个人看不看得见这个项目**。

   结果是 PM 拿不到别人项目的 /api/projects/<id>(403),却能从
   /api/av/cost?project=<同一个 id> 拿到那个项目的方案、成本表和公司毛利下限。
   写操作没事 —— canEdit 早就把 PM 挡在别人项目外面了;漏的全是读。

   所以这里只做一件事:在拿到项目之后、干任何事之前,先问一句 canSeeProject。
   口径和 REQ-043 完全一致,不另立规矩:总监 / BD / Sales / Finance / Viewer
   看全部,PM 与 Engineer 只看自己的。 */

import { NextResponse } from 'next/server';
import { canEditModule, canSeeModule, canSeeProject, identityOf, pmLocked } from '@/lib/permissions';
import { PM_CLOSED_MSG } from '@/lib/closeout';
import type { Project, User } from '@/lib/types';
import { APPROACH_CLOSED_MSG, isClosedApproach } from '@/lib/approach';

export const AV_DENY = '非你管理 / 参与的项目';

/* 看得见就返回 null,看不见就返回可以直接 return 的 403。
   项目不存在时返回 null —— 各路由本来就有自己的「项目不存在」分支,
   这里不抢它的活,也不因此泄漏「这个 id 存在不存在」。 */
export function denyUnlessVisible(user: User, project: Project | null | undefined, write = false): NextResponse | null {
  if (!project) return null;
  if (!canSeeProject(identityOf(user), project)) return NextResponse.json({ error: AV_DENY }, { status: 403 });
  /* REQ-054:已关闭的售前记录(未成交 / 已并入)只读 —— 写接口传 write = true */
  if (write && isClosedApproach(project)) return NextResponse.json({ error: APPROACH_CLOSED_MSG }, { status: 400 });
  /* REQ-057:进了开票 / 收尾,PM / Engineer 在 AV 这边也只读 */
  if (write && pmLocked(identityOf(user), project)) return NextResponse.json({ error: PM_CLOSED_MSG }, { status: 403 });
  return null;
}

/* REQ-051: 权限表里「AV 方案成本」对这个角色是「不可见」时,AV 的接口一律拒绝 ——
   不只是前端藏菜单。写操作各自的 can… 里已经带了模块级「可编辑」那一道。 */
export const AV_MODULE_DENY = '你的角色看不到「AV 方案成本」/ Your role has no access to "AV design & cost"';
export function denyAvModule(user: User): NextResponse | null {
  return canSeeModule(identityOf(user), 'avcost') ? null : NextResponse.json({ error: AV_MODULE_DENY }, { status: 403 });
}
/* 「AV 方案成本」只读的角色:看得到、改不了(01 立项问答这类只查了 canMeta 的写接口用) */
export const AV_EDIT_DENY = '你的角色对「AV 方案成本」只读 / Your role has read-only access to "AV design & cost"';
export function denyAvEdit(user: User): NextResponse | null {
  return canEditModule(identityOf(user), 'avcost') ? null : NextResponse.json({ error: AV_EDIT_DENY }, { status: 403 });
}
