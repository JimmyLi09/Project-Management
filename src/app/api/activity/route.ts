import { NextRequest, NextResponse } from 'next/server';
import { getDb, getUserById } from '@/server/db';
import { clientInfo, sessionPayload, setSessionCookie } from '@/server/session';
import { heartbeat, startSession } from '@/server/usageStore';

/* REQ-060 心跳:页面在前台、5 分钟内有操作时浏览器每 60 秒发一次,{ sinceInput: 距离上次操作的毫秒数 }。
   只更新登录记录和每日时长两张小表,不读写项目数据。没登录(或账号停用)返回 401 —— 前端不跳登录页、不提示。 */
export async function POST(req: NextRequest) {
  const p = await sessionPayload();
  const u = p ? getUserById(p.uid) : null;
  if (!p || !u || u.disabled || u.deletedAt) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { sinceInput?: unknown };
  const now = Date.now();
  const { ua, ip } = await clientInfo();
  let sid = p.sid;
  if (!sid) {
    /* 上线前就登录着的 cookie 没有 sid:从这一下开始记一段,cookie 补上 sid(到期时间不变) */
    sid = startSession(getDb(), { userId: u.id, ua, ip, now });
    await setSessionCookie(u.id, sid, p.exp);
  }
  const r = heartbeat(getDb(), { sid, userId: u.id, sinceInput: Number(body.sinceInput) || 0, ua, ip, now });
  return NextResponse.json({ ok: true, counted: r.counted });
}
