/* REQ-060 · 登录与使用时间:登录段、心跳去重、在线 / 空闲 / 离线、今天 / 本周 / 本月、明细、12 个月清理 */
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { localDay } from '../localDate.ts';
import { addDays, deviceOf, fmtAgo, fmtMinutes, periodRange, retainFrom, usageStatus } from '../usage.ts';
import { closeStale, closeUserSessions, endSession, ensureUsageTables, heartbeat, pruneUsage, startSession, usageDetail, usageList } from '../../server/usageStore.ts';

const MIN = 60_000;
const UA_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const fresh = () => { const d = new Database(':memory:'); ensureUsageTables(d); return d; };
/* 本地时间某天的某个时刻 */
const at = (day: string, h: number, m = 0, s = 0) => { const [y, mo, dd] = day.split('-').map(Number); return new Date(y, mo - 1, dd, h, m, s).getTime(); };
const hb = (d: Database.Database, sid: string, uid: number, now: number, sinceInput = 1000) => heartbeat(d, { sid, userId: uid, sinceInput, ua: UA_WIN, ip: '10.0.0.5', now });
/* 像真的浏览器那样:from 到 to 每分钟一次心跳 */
const run = (d: Database.Database, sid: string, uid: number, from: number, to: number) => { for (let t = from; t <= to; t += MIN) hb(d, sid, uid, t); };
const mins = (d: Database.Database, uid: number, day: string) => ((d.prepare('SELECT active_minutes FROM user_activity_daily WHERE user_id = ? AND day = ?').get(uid, day) as { active_minutes: number } | undefined)?.active_minutes || 0);
const USERS = [{ id: 1, name: 'JM', username: 'jm', role: 'pm', position: 'Senior PM' }, { id: 2, name: 'Candy', username: 'candy', role: 'sales' }];

test('设备:User-Agent 归纳成「浏览器 · 系统」', () => {
  assert.equal(deviceOf(UA_WIN), 'Chrome · Windows');
  assert.equal(deviceOf(UA_IPHONE), 'Safari · iPhone');
  assert.equal(deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0'), 'Edge · Windows');
  assert.equal(deviceOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0'), 'Firefox · Mac');
});

test('登录记一段;心跳 3 分钟 = 3 分钟;两个标签页同一分钟只算一次', () => {
  const d = fresh();
  const day = '2026-10-22';
  const t0 = at(day, 9, 0, 5);
  const sid = startSession(d, { userId: 1, ua: UA_WIN, ip: '10.0.0.5', now: t0 });
  const row = d.prepare('SELECT * FROM user_sessions WHERE sid = ?').get(sid) as { login_at: number; device: string; ip: string; logout_at: number | null };
  assert.equal(row.login_at, t0); assert.equal(row.device, 'Chrome · Windows'); assert.equal(row.ip, '10.0.0.5'); assert.equal(row.logout_at, null);
  /* 第二个标签页(同一个 cookie)和第二台设备(另一个 cookie)在同一分钟里都发心跳 */
  const sid2 = startSession(d, { userId: 1, ua: UA_IPHONE, ip: '10.0.0.9', now: t0 + 1000 });
  for (let k = 0; k < 3; k++) {
    assert.equal(hb(d, sid, 1, t0 + k * MIN + 10_000).counted, true);
    assert.equal(hb(d, sid, 1, t0 + k * MIN + 40_000).counted, false, '同一个 cookie 的另一个标签页');
    assert.equal(hb(d, sid2, 1, t0 + k * MIN + 50_000).counted, false, '另一台设备同一分钟');
  }
  assert.equal(mins(d, 1, day), 3);
  /* 5 分钟以上没操作:不算时长,也不更新「最后操作」 */
  const before = (d.prepare('SELECT last_active_at FROM user_sessions WHERE sid = ?').get(sid) as { last_active_at: number }).last_active_at;
  assert.equal(hb(d, sid, 1, t0 + 4 * MIN, 6 * MIN).counted, false);
  assert.equal(mins(d, 1, day), 3);
  assert.equal((d.prepare('SELECT last_active_at FROM user_sessions WHERE sid = ?').get(sid) as { last_active_at: number }).last_active_at, before);
});

test('在线 / 空闲 / 离线', () => {
  const now = at('2026-10-22', 12);
  assert.equal(usageStatus([], now), 'offline');
  assert.equal(usageStatus([{ last_seen_at: now - MIN, last_active_at: now - 2 * MIN }], now), 'online');
  /* 心跳还在(5 分钟内有操作才发),但已经 6 分钟没操作 → 空闲 */
  assert.equal(usageStatus([{ last_seen_at: now - 30_000, last_active_at: now - 6 * MIN }], now), 'idle');
  /* 关了页面:3 分钟没心跳 → 空闲;16 分钟 → 离线 */
  assert.equal(usageStatus([{ last_seen_at: now - 3 * MIN, last_active_at: now - 3 * MIN }], now), 'idle');
  assert.equal(usageStatus([{ last_seen_at: now - 16 * MIN, last_active_at: now - 16 * MIN }], now), 'offline');
});

test('登出 / 超时 / 停用:各自写上原因;超时以后回来是新的一段', () => {
  const d = fresh();
  const day = '2026-10-21';
  const a = startSession(d, { userId: 1, ua: UA_WIN, ip: 'x', now: at(day, 9, 5) });
  run(d, a, 1, at(day, 9, 6), at(day, 12, 30));
  endSession(d, a, at(day, 12, 31));
  let r = d.prepare('SELECT logout_at, logout_reason FROM user_sessions WHERE sid = ?').get(a) as { logout_at: number; logout_reason: string };
  assert.deepEqual([r.logout_at, r.logout_reason], [at(day, 12, 31), 'manual']);
  /* 14:10 登录,18:22 最后一次心跳,之后没动静 */
  const b = startSession(d, { userId: 1, ua: UA_WIN, ip: 'x', now: at(day, 14, 10) });
  run(d, b, 1, at(day, 14, 11), at(day, 18, 22));
  closeStale(d, at(day, 18, 40));
  r = d.prepare('SELECT logout_at, logout_reason FROM user_sessions WHERE sid = ?').get(b) as { logout_at: number; logout_reason: string };
  assert.deepEqual([r.logout_at, r.logout_reason], [at(day, 18, 22), 'expired'], '超时:在最后一次活动那里结束');
  assert.equal(mins(d, 1, day), 205 + 252, '9:06–12:30 + 14:11–18:22 每分钟一次');
  /* 第二天同一个 cookie 回来:同一个 sid 新开一段 */
  hb(d, b, 1, at(addDays(day, 1), 8, 52));
  const segs = d.prepare('SELECT login_at, logout_at FROM user_sessions WHERE sid = ? ORDER BY id').all(b) as { login_at: number; logout_at: number | null }[];
  assert.equal(segs.length, 2);
  assert.deepEqual([segs[1].login_at, segs[1].logout_at], [at(addDays(day, 1), 8, 52), null]);
  /* 停用 */
  const c = startSession(d, { userId: 2, ua: UA_IPHONE, ip: 'y', now: at(day, 10) });
  run(d, c, 2, at(day, 10, 1), at(day, 10, 7));
  closeUserSessions(d, 2, 'disabled', at(day, 10, 9));
  r = d.prepare('SELECT logout_at, logout_reason FROM user_sessions WHERE sid = ?').get(c) as { logout_at: number; logout_reason: string };
  assert.deepEqual([r.logout_at, r.logout_reason], [at(day, 10, 7), 'disabled']);
});

test('今天 / 本周(周一起)/ 本月,按本地日期', () => {
  assert.deepEqual(periodRange('today', '2026-10-22'), { from: '2026-10-22', to: '2026-10-22' });
  assert.deepEqual(periodRange('week', '2026-10-22'), { from: '2026-10-19', to: '2026-10-22' });   // 10-22 是周四
  assert.deepEqual(periodRange('week', '2026-10-25'), { from: '2026-10-19', to: '2026-10-25' });   // 周日还在这一周
  assert.deepEqual(periodRange('week', '2026-10-26'), { from: '2026-10-26', to: '2026-10-26' });
  assert.deepEqual(periodRange('month', '2026-10-22'), { from: '2026-10-01', to: '2026-10-22' });
  const d = fresh();
  const sid = startSession(d, { userId: 1, ua: UA_WIN, ip: 'x', now: at('2026-09-30', 9) });
  /* 9-30(上个月)、10-18(上周日)、10-20、10-22 各用几分钟。
     10-22 本地 0:30 那一分钟也算当天(服务器在 UTC+8 时,UTC 还是前一天 16:30) */
  hb(d, sid, 1, at('2026-10-22', 0, 30, 5));
  for (const [day, n] of [['2026-09-30', 4], ['2026-10-18', 5], ['2026-10-20', 7], ['2026-10-22', 3]] as [string, number][]) {
    for (let k = 0; k < n; k++) hb(d, sid, 1, at(day, 10, k, 10));
  }
  const now = at('2026-10-22', 12);
  const l = usageList(d, USERS, now);
  const jm = l.users.find((u) => u.id === 1)!;
  assert.deepEqual(jm.minutes, { today: 4, week: 11, month: 16 });
  assert.equal(jm.days14.length, 14);
  assert.equal(jm.days14[13].day, '2026-10-22'); assert.equal(jm.days14[13].minutes, 4);
  assert.equal(jm.days14.find((x) => x.day === '2026-10-18')!.minutes, 5);
  assert.equal(l.today, localDay(new Date(now)));
  const candy = l.users.find((u) => u.id === 2)!;
  assert.deepEqual([candy.status, candy.lastSeen, candy.lastLogin, candy.minutes.month], ['offline', null, null, 0]);
});

test('列表:在线人数、最后活动、最近登录', () => {
  const d = fresh();
  const now = at('2026-10-22', 9, 10);
  const s1 = startSession(d, { userId: 1, ua: UA_WIN, ip: 'x', now: at('2026-10-22', 8, 52) });
  run(d, s1, 1, at('2026-10-22', 8, 52, 30), now - 30_000);
  const s2 = startSession(d, { userId: 2, ua: UA_IPHONE, ip: 'y', now: at('2026-10-21', 10, 5) });
  run(d, s2, 2, at('2026-10-21', 10, 6), at('2026-10-21', 17, 42));
  const l = usageList(d, USERS, now);
  assert.equal(l.online, 1);
  const jm = l.users.find((u) => u.id === 1)!, candy = l.users.find((u) => u.id === 2)!;
  assert.deepEqual([jm.status, jm.lastLogin, jm.lastSeen], ['online', at('2026-10-22', 8, 52), now - 30_000]);
  assert.deepEqual([candy.status, candy.lastLogin, candy.lastSeen], ['offline', at('2026-10-21', 10, 5), at('2026-10-21', 17, 42)]);
  assert.equal(fmtAgo(jm.lastSeen, now, 'zh'), '刚刚');
  assert.equal(fmtAgo(candy.lastSeen, now, 'zh'), '昨天 17:42');
  assert.equal(fmtAgo(candy.lastSeen, now, 'en'), 'Yesterday 17:42');
  assert.equal(fmtAgo(now - 2 * MIN, now, 'zh'), '2 分钟前');
  assert.equal(fmtAgo(null, now, 'zh'), '从未登录');
  assert.equal(fmtMinutes(3, 'zh'), '3 分钟'); assert.equal(fmtMinutes(192, 'zh'), '3.2 小时'); assert.equal(fmtMinutes(192, 'en'), '3.2 h'); assert.equal(fmtMinutes(0, 'zh'), '—');
});

test('明细:近 7 天从新到旧,一天几段、时长、设备;往前翻', () => {
  const d = fresh();
  /* 21 日:9:05 登录用了 3 分钟,9:12 登出;14:10 手机登录,14:11 一次心跳,之后没动静 → 超时 */
  const a = startSession(d, { userId: 1, ua: UA_WIN, ip: 'x', now: at('2026-10-21', 9, 5) });
  run(d, a, 1, at('2026-10-21', 9, 5, 30), at('2026-10-21', 9, 7, 30));
  endSession(d, a, at('2026-10-21', 9, 12));
  const b = startSession(d, { userId: 1, ua: UA_IPHONE, ip: 'x', now: at('2026-10-21', 14, 10) });
  hb(d, b, 1, at('2026-10-21', 14, 11));
  const c = startSession(d, { userId: 1, ua: UA_WIN, ip: 'x', now: at('2026-10-22', 8, 52) });
  run(d, c, 1, at('2026-10-22', 8, 52, 30), at('2026-10-22', 9, 0, 30));
  const now = at('2026-10-22', 9, 1);
  const det = usageDetail(d, 1, '2026-10-22', now);
  assert.equal(det.days.length, 7);
  assert.deepEqual(det.days.map((x) => x.day), ['2026-10-22', '2026-10-21', '2026-10-20', '2026-10-19', '2026-10-18', '2026-10-17', '2026-10-16']);
  const d21 = det.days[1];
  assert.equal(d21.segments.length, 2);
  assert.deepEqual(d21.segments.map((s) => [s.login, s.logout, s.reason]), [[at('2026-10-21', 9, 5), at('2026-10-21', 9, 12), 'manual'], [at('2026-10-21', 14, 10), at('2026-10-21', 14, 11), 'expired']]);
  assert.equal(d21.minutes, 4);
  assert.deepEqual(d21.devices, ['Chrome · Windows', 'Safari · iPhone']);
  assert.deepEqual([det.days[0].segments[0].logout, det.status], [null, 'online']);
  /* 往前翻 7 天:10-15 往前,没有记录 */
  const prev = usageDetail(d, 1, addDays('2026-10-22', -7), now);
  assert.equal(prev.days[0].day, '2026-10-15');
  assert.ok(prev.days.every((x) => !x.segments.length && !x.minutes));
});

test('保留 12 个月:更早的登录段和每日时长清掉', () => {
  const d = fresh();
  const old = startSession(d, { userId: 1, ua: UA_WIN, ip: 'x', now: at('2025-10-01', 9) });
  hb(d, old, 1, at('2025-10-01', 9, 5));
  endSession(d, old, at('2025-10-01', 10));
  const recent = startSession(d, { userId: 1, ua: UA_WIN, ip: 'x', now: at('2025-11-02', 9) });
  hb(d, recent, 1, at('2025-11-02', 9, 5));
  assert.equal(retainFrom('2026-10-22'), '2025-10-22');
  const r = pruneUsage(d, at('2026-10-22', 3));
  assert.deepEqual(r, { sessions: 1, days: 1 });
  assert.equal((d.prepare('SELECT COUNT(*) AS n FROM user_sessions').get() as { n: number }).n, 1);
  assert.equal(mins(d, 1, '2025-11-02'), 1);
});
