import { NextResponse } from 'next/server';
import { getDb } from '@/server/db';
import { clearSessionCookie, sessionPayload } from '@/server/session';
import { endSession } from '@/server/usageStore';

export async function POST() {
  /* REQ-060:登录记录里这一段写上登出时间 */
  const p = await sessionPayload();
  if (p?.sid) {
    try { endSession(getDb(), p.sid, Date.now(), 'manual'); } catch (e) { console.warn('[REQ-060] 登出记录没写上:', e); }
  }
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
