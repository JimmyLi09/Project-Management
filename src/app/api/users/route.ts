import { NextRequest, NextResponse } from 'next/server';
import { createUser, getUserByUsername, listUsers } from '@/server/db';
import { currentUser } from '@/server/session';
import { canAdmin, identityOf } from '@/lib/permissions';
import type { Role } from '@/lib/types';

const ROLES: Role[] = ['director', 'bd', 'sales', 'pm', 'member', 'viewer'];

/* All signed-in users may list users (needed for PM assignment pickers). */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  return NextResponse.json({ users: listUsers() });
}

/* Only PD/BD may create accounts. */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canAdmin(identityOf(user))) {
    return NextResponse.json({ error: '仅 PD/BD 可管理用户' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  const name = String(body.name || '').trim();
  const role = body.role as Role;
  if (!username || !password || !name || !ROLES.includes(role)) {
    return NextResponse.json({ error: '请完整填写账号/密码/姓名/角色' }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: '密码至少 6 位' }, { status: 400 });
  }
  if (getUserByUsername(username)) {
    return NextResponse.json({ error: '账号已存在' }, { status: 409 });
  }
  const created = createUser(username, password, name, role);
  return NextResponse.json({ user: created });
}
