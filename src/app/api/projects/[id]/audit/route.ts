import { NextRequest, NextResponse } from 'next/server';
import { getProject, listAudit } from '@/server/db';
import { currentUser } from '@/server/session';
import { canSeeProject, identityOf, priceView } from '@/lib/permissions';
import { redactLog } from '@/server/avredact';

/* Full permanent audit trail for a project (never rotated, unlike the
   200-entry in-document log). Any signed-in user who can see the project. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;
  const p = getProject(id);
  if (!p) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
  /* REQ-043: 操作日志里写着谁在什么时候改了什么 —— 项目本身看不到的人,
     日志也不该看到。 */
  if (!canSeeProject(identityOf(user), p)) return NextResponse.json({ error: '非你管理 / 参与的项目' }, { status: 403 });
  /* 字段级隔离:成本确认、提交报价这几条日志带着金额与毛利,按人抹掉 */
  const v = priceView(identityOf(user));
  return NextResponse.json({ entries: listAudit(id, 2000).map((e) => redactLog(e, v)) });
}
