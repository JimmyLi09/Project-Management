import { NextRequest, NextResponse } from 'next/server';
import { getUserByLogin, verifyPassword } from '@/server/db';
import { setSessionCookie } from '@/server/session';

/* Public link: slow down password guessing. After 5 wrong passwords for one
   account from one address, that pair waits 15 minutes. Kept in memory — a
   restart clears it, which is fine for this purpose. */
const FAILS = new Map<string, { n: number; until: number }>();
const LIMIT = 5;
const LOCK_MS = 15 * 60_000;

export async function POST(req: NextRequest) {
  const { username, password } = await req.json().catch(() => ({}));
  if (!username || !password) {
    return NextResponse.json({ error: '请输入账号和密码' }, { status: 400 });
  }
  const login = String(username).trim().toLowerCase();
  const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
  const key = `${ip}|${login}`;
  const now = Date.now();
  if ((FAILS.get(key)?.until ?? 0) > now) {
    return NextResponse.json({ error: '密码错误次数过多，请 15 分钟后再试' }, { status: 429 });
  }
  /* accepts username or email */
  const user = getUserByLogin(login);
  if (!user || !verifyPassword(String(password), user.password_hash)) {
    if (FAILS.size > 1000) for (const [k, v] of FAILS) if (v.until <= now) FAILS.delete(k);
    const f = FAILS.get(key) ?? { n: 0, until: 0 };
    f.n += 1;
    if (f.n >= LIMIT) { f.n = 0; f.until = now + LOCK_MS; }
    FAILS.set(key, f);
    return NextResponse.json({ error: '账号或密码错误' }, { status: 401 });
  }
  FAILS.delete(key);
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
