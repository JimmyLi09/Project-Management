import { NextRequest, NextResponse } from 'next/server';
import { getPermTable, savePermTable } from '@/server/db';
import { currentUser } from '@/server/session';
import { canAdmin, identityOf } from '@/lib/permissions';
import { CEILING, defaultPermTable, FLOOR } from '@/lib/permTable';

/* REQ-051 按角色的权限表。
   GET:所有登录的人都能拿(前端按它藏菜单 / 标签);PUT:只有 PD / BD。
   存进来的表一律过 sanitize(夹在 [下限, 上限] 之间),每改一格记一条管理日志。 */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  return NextResponse.json({ table: getPermTable(), defaults: defaultPermTable(), ceiling: CEILING, floor: FLOOR });
}

export async function PUT(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canAdmin(identityOf(user))) return NextResponse.json({ error: '仅 PD/BD 可修改权限 / PD / BD only' }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { table?: unknown } | null;
  if (!body || typeof body.table !== 'object' || !body.table) return NextResponse.json({ error: '无效请求' }, { status: 400 });
  const r = savePermTable(body.table, user.name);
  return NextResponse.json(r);
}
