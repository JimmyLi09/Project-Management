import { NextRequest, NextResponse } from 'next/server';
import { getUserByUsername, verifyPassword } from '@/server/db';
import { setSessionCookie } from '@/server/session';

export async function POST(req: NextRequest) {
  const { username, password } = await req.json().catch(() => ({}));
  if (!username || !password) {
    return NextResponse.json({ error: '请输入账号和密码' }, { status: 400 });
  }
  const user = getUserByUsername(String(username).trim().toLowerCase());
  if (!user || !verifyPassword(String(password), user.password_hash)) {
    return NextResponse.json({ error: '账号或密码错误' }, { status: 401 });
  }
  await setSessionCookie(user.id);
  return NextResponse.json({
    user: { id: user.id, username: user.username, name: user.name, role: user.role },
  });
}
