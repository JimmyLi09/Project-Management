import crypto from 'crypto';
import { cookies, headers } from 'next/headers';
import { getSecret, getUserById } from './db';
import type { User } from '@/lib/types';

const COOKIE = 'audax_session';
const MAX_AGE = 60 * 60 * 24 * 14; // 14 days

interface SessionPayload {
  uid: number;
  exp: number;
  sid?: string;   // REQ-060:登录记录 user_sessions 的那一段;上线前登录的 cookie 没有,第一次心跳时补上
}

function sign(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

export function createToken(userId: number, sid?: string, exp?: number): string {
  const payload: SessionPayload = { uid: userId, exp: exp || Date.now() + MAX_AGE * 1000, ...(sid ? { sid } : {}) };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${data}.${sign(data, getSecret())}`;
}

export function parseToken(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expect = sign(data, getSecret());
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString()) as SessionPayload;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/* exp:补 sid 时沿用原来的到期时间(不因为心跳把 14 天往后推) */
export async function setSessionCookie(userId: number, sid?: string, exp?: number) {
  const store = await cookies();
  // Over the public HTTPS link (Cloudflare Tunnel sets X-Forwarded-Proto) the
  // cookie is HTTPS-only; plain http://<server IP>:3000 on the intranet keeps working.
  const https = (await headers()).get('x-forwarded-proto') === 'https';
  store.set(COOKIE, createToken(userId, sid, exp), {
    httpOnly: true,
    secure: https,
    sameSite: 'lax',
    path: '/',
    maxAge: exp ? Math.max(1, Math.floor((exp - Date.now()) / 1000)) : MAX_AGE,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE);
}

/* REQ-060:cookie 里的内容(登出、心跳要用 sid);签名不对 / 过期是 null */
export async function sessionPayload(): Promise<SessionPayload | null> {
  const store = await cookies();
  return parseToken(store.get(COOKIE)?.value);
}

/* REQ-060:请求从哪来、用什么浏览器 —— 只存,界面上不显示 IP */
export async function clientInfo(): Promise<{ ua: string; ip: string }> {
  const h = await headers();
  return { ua: h.get('user-agent') || '', ip: h.get('cf-connecting-ip') || h.get('x-forwarded-for')?.split(',')[0].trim() || 'local' };
}

export async function currentUser(): Promise<User | null> {
  const payload = await sessionPayload();
  if (!payload) return null;
  const u = getUserById(payload.uid);
  /* REQ-051: 停用 / 删除以后,已经登录的会话下一次请求就失效(以前只在登录时查) */
  if (!u || u.disabled || u.deletedAt) return null;
  return u;
}
