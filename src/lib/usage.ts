/* ===== REQ-060 登录与使用时间 · 纯规则(服务端存取和页面共用) =====
   - 在线:2 分钟内有心跳,并且 5 分钟内有点击 / 按键 / 滚动 / 鼠标移动;
   - 空闲:还没登出、15 分钟内有过请求,但不算在线;
   - 离线:已登出,或超过 15 分钟没有任何请求。
   「一段」= 从登录(或离线之后再回来)到登出 / 最后一次活动。超过 15 分钟没动静,这一段就在最后一次活动那里结束,
   标「超时自动登出」;cookie 还有效,回来接着用就是新的一段。
   使用时长只算心跳:页面在前台、5 分钟内有操作才发,每 60 秒一次,同一个人同一分钟只算一次(多个标签页不翻倍)。
   日期一律按本地日期(服务器 / 浏览器的时区,新加坡 UTC+8)。不记录看了哪些页面、哪些项目。 */
import { localDay } from './localDate';

export const HEARTBEAT_MS = 60_000;
export const ONLINE_MS = 2 * 60_000;
export const ACTIVE_MS = 5 * 60_000;
export const OFFLINE_MS = 15 * 60_000;
export const RETAIN_MONTHS = 12;

export type UsageStatus = 'online' | 'idle' | 'offline';
export type LogoutReason = 'manual' | 'expired' | 'disabled';

export interface SessionRow {
  id: number;
  user_id: number;
  login_at: number;
  logout_at: number | null;
  logout_reason: LogoutReason | null;
  last_seen_at: number;
  last_active_at: number;
  device: string;
}

/* User-Agent 归纳成「Chrome · Windows」「Safari · iPhone」 */
export function deviceOf(ua: string): string {
  const s = ua || '';
  const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android'
    : /Windows/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'Mac' : /CrOS/.test(s) ? 'ChromeOS' : /Linux/.test(s) ? 'Linux' : '';
  const br = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /Firefox\/|FxiOS/.test(s) ? 'Firefox'
    : /Chrome\/|CriOS/.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : '';
  return [br, os].filter(Boolean).join(' · ') || (s ? s.slice(0, 40) : '—');
}

/* 这个人现在的状态 —— 看他所有没结束的段里最新的那一段 */
export function usageStatus(open: Pick<SessionRow, 'last_seen_at' | 'last_active_at'>[], now: number): UsageStatus {
  if (!open.length) return 'offline';
  const seen = Math.max(...open.map((s) => s.last_seen_at));
  const active = Math.max(...open.map((s) => s.last_active_at || 0));
  if (now - seen > OFFLINE_MS) return 'offline';
  if (now - seen <= ONLINE_MS && now - active <= ACTIVE_MS) return 'online';
  return 'idle';
}

const dayDate = (day: string) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (day: string, n: number) => { const d = dayDate(day); d.setDate(d.getDate() + n); return localDay(d); };

/* 今天 / 本周(周一开始)/ 本月 的起止日(含) */
export type UsagePeriod = 'today' | 'week' | 'month';
export function periodRange(period: UsagePeriod, today: string): { from: string; to: string } {
  if (period === 'today') return { from: today, to: today };
  const d = dayDate(today);
  if (period === 'week') { const back = (d.getDay() + 6) % 7; return { from: addDays(today, -back), to: today }; }
  return { from: `${today.slice(0, 7)}-01`, to: today };
}
export const sumMinutes = (days: { day: string; minutes: number }[], r: { from: string; to: string }) =>
  days.filter((x) => x.day >= r.from && x.day <= r.to).reduce((n, x) => n + x.minutes, 0);
/* 截止到 end 的 n 天(含 end),从早到晚 */
export const lastDays = (n: number, end: string) => Array.from({ length: n }, (_, i) => addDays(end, i - n + 1));

/* 12 个月前那一天(保留期的起点) */
export function retainFrom(today: string): string {
  const d = dayDate(today); d.setMonth(d.getMonth() - RETAIN_MONTHS); return localDay(d);
}

/* 明细:每天的几段(按登录那天归)、当天时长、用过的设备 */
export interface UsageSegment { login: number; logout: number | null; reason: LogoutReason | null; device: string; lastSeen: number }
export interface UsageDay { day: string; minutes: number; segments: UsageSegment[]; devices: string[] }
export function usageDays(days: string[], sessions: SessionRow[], minutes: Record<string, number>): UsageDay[] {
  return days.map((day) => {
    const segs = sessions.filter((s) => localDay(new Date(s.login_at)) === day).sort((a, b) => a.login_at - b.login_at)
      .map((s) => ({ login: s.login_at, logout: s.logout_at, reason: s.logout_reason, device: s.device, lastSeen: s.last_seen_at }));
    return { day, minutes: minutes[day] || 0, segments: segs, devices: [...new Set(segs.map((s) => s.device).filter(Boolean))] };
  });
}

/* ── 显示 ── */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
export const hm = (ts: number) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const dMon = (ts: number) => { const d = new Date(ts); return `${pad(d.getDate())}-${MON[d.getMonth()]}`; };
const WD_ZH = ['日', '一', '二', '三', '四', '五', '六'];
const WD_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const dayLabel = (day: string, lang: 'zh' | 'en') => {
  const d = dayDate(day);
  return `${pad(d.getDate())}-${MON[d.getMonth()]}${lang === 'zh' ? `(${WD_ZH[d.getDay()]})` : ` (${WD_EN[d.getDay()]})`}`;
};
export function fmtMinutes(min: number, lang: 'zh' | 'en'): string {
  if (!min) return '—';
  if (min < 60) return lang === 'zh' ? `${min} 分钟` : `${min} min`;
  const h = (min / 60).toFixed(1);
  return lang === 'zh' ? `${h} 小时` : `${h} h`;
}
/* 「刚刚」「2 分钟前」「3 小时前」「昨天 17:42」「3 天前」「10-Oct 11:02」 */
export function fmtAgo(ts: number | null, now: number, lang: 'zh' | 'en'): string {
  if (!ts) return lang === 'zh' ? '从未登录' : 'Never';
  const m = Math.floor((now - ts) / 60_000);
  if (m < 1) return lang === 'zh' ? '刚刚' : 'just now';
  if (m < 60) return lang === 'zh' ? `${m} 分钟前` : `${m} min ago`;
  const today = localDay(new Date(now)), day = localDay(new Date(ts));
  if (day === today) return lang === 'zh' ? `${Math.floor(m / 60)} 小时前` : `${Math.floor(m / 60)} h ago`;
  if (day === addDays(today, -1)) return lang === 'zh' ? `昨天 ${hm(ts)}` : `Yesterday ${hm(ts)}`;
  const days = Math.round((dayDate(today).getTime() - dayDate(day).getTime()) / 86400000);
  if (days < 7) return lang === 'zh' ? `${days} 天前` : `${days} days ago`;
  return `${dMon(ts)} ${hm(ts)}`;
}
export const STATUS_TEXT: Record<UsageStatus, [string, string]> = {
  online: ['● 在线', '● Online'],
  idle: ['● 空闲', '● Idle'],
  offline: ['○ 离线', '○ Offline'],
};
export const REASON_TEXT: Record<LogoutReason, [string, string]> = {
  manual: ['', ''],
  expired: ['超时自动登出', 'Timed out'],
  disabled: ['已停用', 'Account disabled'],
};
