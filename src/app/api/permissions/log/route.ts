import { NextResponse } from 'next/server';
import { listAdminLog } from '@/server/db';
import { currentUser } from '@/server/session';
import { canAdmin, identityOf } from '@/lib/permissions';

/* REQ-051 管理日志(改权限表、删除 / 停用账号)—— 只有 PD / BD 看 */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canAdmin(identityOf(user))) return NextResponse.json({ error: '仅 PD/BD / PD / BD only' }, { status: 403 });
  return NextResponse.json({ entries: listAdminLog(300) });
}
