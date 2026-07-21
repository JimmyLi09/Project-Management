import crypto from 'crypto';
import { cookies } from 'next/headers';
import { getSecret, getUserById } from './db';
import type { User } from '@/lib/types';

const COOKIE = 'audax_session';
const MAX_AGE = 60 * 60 * 24 * 14; // 14 days

interface SessionPayload {
  uid: number;
  exp: number;
}

function sign(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

export function createToken(userId: number): string {
  const payload: SessionPayload = { uid: userId, exp: Date.now() + MAX_AGE * 1000 };
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

export async function setSessionCookie(userId: number) {
  const store = await cookies();
  store.set(COOKIE, createToken(userId), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  const payload = parseToken(store.get(COOKIE)?.value);
  if (!payload) return null;
  return getUserById(payload.uid) || null;
}
