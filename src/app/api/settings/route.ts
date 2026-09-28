import { NextRequest, NextResponse } from 'next/server';
import { getSetting, setSetting } from '@/server/db';
import { currentUser } from '@/server/session';
import { identityOf, isFull } from '@/lib/permissions';

/* REQ-016: global app settings. GET ?key=... (any signed-in user);
   PUT { key, value } (PD/BD only). Keys are whitelisted. */
const ALLOWED_KEYS = new Set(['exportNotes']);

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const key = req.nextUrl.searchParams.get('key') || '';
  if (!ALLOWED_KEYS.has(key)) return NextResponse.json({ error: '未知设置项' }, { status: 400 });
  return NextResponse.json({ key, value: getSetting(key) });
}

export async function PUT(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!isFull(identityOf(user))) return NextResponse.json({ error: '仅 PD/BD 可修改全局设置' }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { key?: string; value?: string } | null;
  const key = String(body?.key || '');
  if (!ALLOWED_KEYS.has(key)) return NextResponse.json({ error: '未知设置项' }, { status: 400 });
  setSetting(key, String(body?.value ?? '').slice(0, 4000));
  return NextResponse.json({ ok: true });
}
