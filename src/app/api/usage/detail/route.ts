import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { identityOf, isFull } from '@/lib/permissions';
import { getDb, getUserById } from '@/server/db';
import { usageDetail } from '@/server/usageStore';
import { localDay } from '@/lib/localDate';

/* REQ-060 登录明细:?uid=<用户>&end=YYYY-MM-DD,截止到 end 的 7 天(默认今天)。
   PD / BD 看任何人;别人只能看自己(「我的使用记录」),看别人 403。 */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const uid = Number(q.get('uid') || user.id);
  if (uid !== user.id && !isFull(identityOf(user))) return NextResponse.json({ error: '只能看自己的使用记录 / You can only view your own usage' }, { status: 403 });
  const who = getUserById(uid);
  if (!who) return NextResponse.json({ error: '没有这个用户 / No such user' }, { status: 404 });
  const today = localDay();
  const end = /^\d{4}-\d{2}-\d{2}$/.test(q.get('end') || '') && q.get('end')! <= today ? q.get('end')! : today;
  return NextResponse.json({ user: { id: who.id, name: who.name, position: who.position || '', role: who.role }, today, ...usageDetail(getDb(), uid, end, Date.now()) });
}
