import { NextRequest, NextResponse } from 'next/server';
import { getUserByLogin, verifyPassword } from '@/server/db';
import { setSessionCookie } from '@/server/session';

export async function POST(req: NextRequest) {
  const { username, password } = await req.json().catch(() => ({}));
  if (!username || !password) {
    return NextResponse.json({ error: '请输入账号和密码' }, { status: 400 });
  }
  /* accepts username or email */
  const user = getUserByLogin(String(username).trim().toLowerCase());
  if (!user || !verifyPassword(String(password), user.password_hash)) {
    return NextResponse.json({ error: '账号或密码错误' }, { status: 401 });
  }
  if ((user as { disabled?: number | boolean }).disabled) {
    return NextResponse.json({ error: '账号已停用,请联系管理员' }, { status: 403 });
  }
  await setSessionCookie(user.id);
  return NextResponse.json({
    user: {
      id: user.id, username: user.username, name: user.name, role: user.role,
      email: user.email, position: user.position,
      mustChangePassword: !!(user as { must_change_pw?: number }).must_change_pw,
    },
  });
}
