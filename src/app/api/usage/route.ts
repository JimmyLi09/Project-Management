import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { identityOf, isFull } from '@/lib/permissions';
import { getDb, listUsers } from '@/server/db';
import { usageList } from '@/server/usageStore';

/* REQ-060「用户与权限 → 登录与使用」:每人在线状态、最后活动、最近登录、今天 / 本周 / 本月时长、近 14 天。
   只有 PD / BD。停用 / 已删除的账号默认不列,?all=1 才带上(历史记录一直都在)。 */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!isFull(identityOf(user))) return NextResponse.json({ error: '仅 PD / BD 可查看登录与使用 / PD / BD only' }, { status: 403 });
  const all = req.nextUrl.searchParams.get('all') === '1';
  const users = listUsers().filter((u) => all || (!u.disabled && !u.deletedAt));
  return NextResponse.json({ now: Date.now(), ...usageList(getDb(), users, Date.now()) });
}
