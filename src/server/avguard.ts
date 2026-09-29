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
import { canSeeProject, identityOf } from '@/lib/permissions';
import type { Project, User } from '@/lib/types';

export const AV_DENY = '非你管理 / 参与的项目';

/* 看得见就返回 null,看不见就返回可以直接 return 的 403。
   项目不存在时返回 null —— 各路由本来就有自己的「项目不存在」分支,
   这里不抢它的活,也不因此泄漏「这个 id 存在不存在」。 */
export function denyUnlessVisible(user: User, project: Project | null | undefined): NextResponse | null {
  if (!project) return null;
  if (canSeeProject(identityOf(user), project)) return null;
  return NextResponse.json({ error: AV_DENY }, { status: 403 });
}
