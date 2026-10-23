/* ===== REQ-060 登录与使用时间 · 两张表的读写 =====
   user_sessions:一行一段(登录 → 登出 / 最后一次活动)。sid 是 cookie 里带的那个随机串 ——
     同一个 cookie 离线(15 分钟没动静)以后再回来,同一个 sid 开新的一行,不用重新登录。
   user_activity_daily:每人每天用了多少分钟。last_minute 记最后算过的那一分钟(从 1970 起的分钟数),
     同一分钟第二次心跳(另一个标签页)就不加 —— 按「用户 + 分钟」去重,重启也不会重复算。
   只存在本机 SQLite,不读写项目数据。函数都带 d / now,单元测试用内存库直接调。 */
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { localDay } from '@/lib/localDate';
import {
  ACTIVE_MS, addDays, deviceOf, lastDays, OFFLINE_MS, periodRange, retainFrom, sumMinutes, usageDays, usageStatus,
  type LogoutReason, type SessionRow, type UsageDay, type UsageStatus,
} from '@/lib/usage';

export function ensureUsageTables(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sid TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      login_at INTEGER NOT NULL,
      logout_at INTEGER,
      logout_reason TEXT,
      last_seen_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL DEFAULT 0,
      device TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, login_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_sid ON user_sessions(sid);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_open ON user_sessions(last_seen_at) WHERE logout_at IS NULL;
    CREATE TABLE IF NOT EXISTS user_activity_daily (
      user_id INTEGER NOT NULL,
      day TEXT NOT NULL,
      active_minutes INTEGER NOT NULL DEFAULT 0,
      last_minute INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day)
    );
  `);
}

export const newSid = () => crypto.randomBytes(16).toString('base64url');

/* 超过 15 分钟没动静的段:在最后一次活动那里结束,标「超时自动登出」 */
export function closeStale(d: Database.Database, now: number) {
  d.prepare("UPDATE user_sessions SET logout_at = last_seen_at, logout_reason = 'expired' WHERE logout_at IS NULL AND last_seen_at < ?").run(now - OFFLINE_MS);
}

/* 登录成功:新开一段,返回放进 cookie 的 sid */
export function startSession(d: Database.Database, o: { userId: number; ua: string; ip: string; now: number; sid?: string }): string {
  const sid = o.sid || newSid();
  closeStale(d, o.now);
  d.prepare('INSERT INTO user_sessions (sid, user_id, login_at, last_seen_at, last_active_at, device, ip) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(sid, o.userId, o.now, o.now, o.now, deviceOf(o.ua), o.ip.slice(0, 64));
  return sid;
}

/* 主动登出:这个 cookie 没结束的段写上登出时间 */
export function endSession(d: Database.Database, sid: string, now: number, reason: LogoutReason = 'manual') {
  closeStale(d, now);
  d.prepare('UPDATE user_sessions SET logout_at = ?, logout_reason = ? WHERE sid = ? AND logout_at IS NULL').run(now, reason, sid);
}

/* REQ-051 停用 / 删除账号:他没结束的段在最后一次活动那里结束,标「已停用」 */
export function closeUserSessions(d: Database.Database, userId: number, reason: LogoutReason, now: number) {
  closeStale(d, now);
  d.prepare('UPDATE user_sessions SET logout_at = last_seen_at, logout_reason = ? WHERE user_id = ? AND logout_at IS NULL').run(reason, userId);
}

/* 心跳:sinceInput = 距离上次点击 / 按键 / 滚动 / 鼠标移动多少毫秒。
   5 分钟内有操作才算这一分钟;同一个人同一分钟只算一次。返回这一下有没有算进时长 */
export function heartbeat(d: Database.Database, o: { sid: string; userId: number; sinceInput: number; ua: string; ip: string; now: number }): { counted: boolean } {
  const since = Math.max(0, Math.min(Number(o.sinceInput) || 0, 24 * 3600_000));
  const active = since <= ACTIVE_MS;
  return d.transaction(() => {
    closeStale(d, o.now);
    const open = d.prepare('SELECT id FROM user_sessions WHERE sid = ? AND logout_at IS NULL ORDER BY id DESC LIMIT 1').get(o.sid) as { id: number } | undefined;
    if (open) {
      d.prepare(`UPDATE user_sessions SET last_seen_at = ?${active ? ', last_active_at = MAX(last_active_at, ?)' : ''} WHERE id = ?`)
        .run(...(active ? [o.now, o.now - since, open.id] : [o.now, open.id]));
    } else {
      /* 离线以后又回来(cookie 还有效):同一个 sid 新开一段 */
      d.prepare('INSERT INTO user_sessions (sid, user_id, login_at, last_seen_at, last_active_at, device, ip) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(o.sid, o.userId, o.now, o.now, active ? o.now - since : 0, deviceOf(o.ua), o.ip.slice(0, 64));
    }
    if (!active) return { counted: false };
    const minute = Math.floor(o.now / 60_000);
    const r = d.prepare(`INSERT INTO user_activity_daily (user_id, day, active_minutes, last_minute) VALUES (?, ?, 1, ?)
      ON CONFLICT(user_id, day) DO UPDATE SET active_minutes = active_minutes + 1, last_minute = excluded.last_minute
      WHERE excluded.last_minute > user_activity_daily.last_minute`).run(o.userId, localDay(new Date(o.now)), minute);
    return { counted: r.changes > 0 };
  })();
}

/* 保留 12 个月:更早的段和每日时长删掉 */
export function pruneUsage(d: Database.Database, now: number): { sessions: number; days: number } {
  const from = retainFrom(localDay(new Date(now)));
  const [y, m, dd] = from.split('-').map(Number);
  const cut = new Date(y, m - 1, dd).getTime();
  const s = d.prepare('DELETE FROM user_sessions WHERE COALESCE(logout_at, last_seen_at) < ?').run(cut);
  const a = d.prepare('DELETE FROM user_activity_daily WHERE day < ?').run(from);
  return { sessions: s.changes, days: a.changes };
}

/* ── 读 ── */
export interface UsageUserIn { id: number; name: string; username: string; role: string; position?: string; disabled?: boolean; deletedAt?: number }
export interface UsageListRow {
  id: number; name: string; username: string; role: string; position: string; disabled: boolean; deleted: boolean;
  status: UsageStatus; lastSeen: number | null; lastLogin: number | null;
  minutes: { today: number; week: number; month: number };
  days14: { day: string; minutes: number }[];
}
export function usageList(d: Database.Database, users: UsageUserIn[], now: number): { today: string; online: number; users: UsageListRow[] } {
  closeStale(d, now);
  const today = localDay(new Date(now));
  const from = [addDays(today, -13), periodRange('month', today).from, periodRange('week', today).from].sort()[0];
  const act = d.prepare('SELECT user_id, day, active_minutes FROM user_activity_daily WHERE day >= ?').all(from) as { user_id: number; day: string; active_minutes: number }[];
  const open = d.prepare('SELECT user_id, last_seen_at, last_active_at FROM user_sessions WHERE logout_at IS NULL').all() as { user_id: number; last_seen_at: number; last_active_at: number }[];
  const last = d.prepare('SELECT user_id, MAX(last_seen_at) AS seen, MAX(login_at) AS login FROM user_sessions GROUP BY user_id').all() as { user_id: number; seen: number; login: number }[];
  const days14 = lastDays(14, today);
  const rows = users.map((u) => {
    const mine = act.filter((a) => a.user_id === u.id).map((a) => ({ day: a.day, minutes: a.active_minutes }));
    const l = last.find((x) => x.user_id === u.id);
    return {
      id: u.id, name: u.name, username: u.username, role: u.role, position: u.position || '',
      disabled: !!u.disabled, deleted: !!u.deletedAt,
      status: usageStatus(open.filter((s) => s.user_id === u.id), now),
      lastSeen: l?.seen ?? null, lastLogin: l?.login ?? null,
      minutes: { today: sumMinutes(mine, periodRange('today', today)), week: sumMinutes(mine, periodRange('week', today)), month: sumMinutes(mine, periodRange('month', today)) },
      days14: days14.map((day) => ({ day, minutes: mine.find((x) => x.day === day)?.minutes || 0 })),
    };
  });
  return { today, online: rows.filter((r) => r.status === 'online').length, users: rows };
}

/* 明细:截止到 end 的 7 天,从新到旧 */
export function usageDetail(d: Database.Database, userId: number, end: string, now: number, n = 7): { end: string; status: UsageStatus; days: UsageDay[] } {
  closeStale(d, now);
  const days = lastDays(n, end);
  const [y, m, dd] = days[0].split('-').map(Number);
  const t0 = new Date(y, m - 1, dd).getTime();
  const [y2, m2, d2] = addDays(end, 1).split('-').map(Number);
  const t1 = new Date(y2, m2 - 1, d2).getTime();
  const sessions = d.prepare('SELECT id, user_id, login_at, logout_at, logout_reason, last_seen_at, last_active_at, device FROM user_sessions WHERE user_id = ? AND login_at >= ? AND login_at < ? ORDER BY login_at')
    .all(userId, t0, t1) as SessionRow[];
  const mins = Object.fromEntries((d.prepare('SELECT day, active_minutes FROM user_activity_daily WHERE user_id = ? AND day >= ? AND day <= ?').all(userId, days[0], end) as { day: string; active_minutes: number }[]).map((r) => [r.day, r.active_minutes]));
  const open = d.prepare('SELECT last_seen_at, last_active_at FROM user_sessions WHERE user_id = ? AND logout_at IS NULL').all(userId) as { last_seen_at: number; last_active_at: number }[];
  return { end, status: usageStatus(open, now), days: usageDays(days, sessions, mins).reverse() };
}
