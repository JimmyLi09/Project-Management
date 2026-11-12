import { NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { getDb } from '@/server/db';
import { trainUsers } from '@/server/trainStore';
import { identityOf, isFull } from '@/lib/permissions';

/* REQ-063:KPI 看板的「级别」列 —— 每个人的 PM 级别(REQ-062 的 users.pm_level)。
   KPI 看板只有 PD / BD 能进(JM 1112 定:不对 PM 开放),这里同样只给 PD / BD。
   改级别走 POST /api/train { op: 'setPmLevel' }(也只有 PD / BD,别人 403)。 */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!isFull(identityOf(user))) return NextResponse.json({ error: '只有 PD / BD 能看 / PD / BD only' }, { status: 403 });
  const levels = Object.fromEntries(trainUsers(getDb()).filter((u) => !u.deleted).map((u) => [u.name, u.pmLevel]));
  return NextResponse.json({ levels });
}
