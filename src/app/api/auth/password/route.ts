import { NextRequest, NextResponse } from 'next/server';
import { changePassword } from '@/server/db';
import { currentUser } from '@/server/session';

/* A signed-in user changes their own password (verifies the current one). */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const currentPw = String(body.currentPassword || '');
  const newPw = String(body.newPassword || '');
  if (!currentPw || !newPw) return NextResponse.json({ error: '请填写当前密码与新密码' }, { status: 400 });
  if (newPw.length < 6) return NextResponse.json({ error: '新密码至少 6 位' }, { status: 400 });
  if (newPw === currentPw) return NextResponse.json({ error: '新密码不能与当前密码相同' }, { status: 400 });
  const r = changePassword(user.id, currentPw, newPw);
  if (!r.ok) return NextResponse.json({ error: r.error || '修改失败' }, { status: 400 });
  return NextResponse.json({ ok: true });
}
