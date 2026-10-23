'use client';

/* ===== REQ-060 登录与使用时间 =====
   - useHeartbeat:页面在前台、5 分钟内有点击 / 按键 / 滚动 / 鼠标移动,每 60 秒 POST /api/activity。
     失败(断网、401)都不提示、不跳登录页,下一分钟再发;
   - UsageTab:「用户与权限 → 登录与使用」(只有 PD / BD,后端也只给 PD / BD);
   - UsageDetail:某个人近 7 天每天的登录段、时长、设备(「明细」和「我的使用记录」共用)。 */
import React, { useEffect, useState } from 'react';
import { useLang } from '@/lib/i18n';
import { roleTerm } from '@/lib/terms';
import { addDays, ACTIVE_MS, dayLabel, dMon, fmtAgo, fmtMinutes, HEARTBEAT_MS, hm, REASON_TEXT, STATUS_TEXT, type UsageDay, type UsagePeriod, type UsageStatus } from '@/lib/usage';
import { localDay } from '@/lib/localDate';

export function useHeartbeat() {
  useEffect(() => {
    let last = Date.now();
    let lastMove = 0;
    const mark = () => { last = Date.now(); };
    /* 鼠标移动很频繁,一秒记一次就够 */
    const move = () => { const n = Date.now(); if (n - lastMove > 1000) { lastMove = n; last = n; } };
    const evs: [string, EventListener][] = [['pointerdown', mark], ['keydown', mark], ['wheel', mark], ['touchstart', mark], ['scroll', mark], ['mousemove', move]];
    evs.forEach(([e, f]) => window.addEventListener(e, f, { passive: true, capture: true }));
    const beat = () => {
      if (document.visibilityState !== 'visible') return;
      const since = Date.now() - last;
      if (since > ACTIVE_MS) return;
      fetch('/api/activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sinceInput: since }), keepalive: true }).catch(() => { /* 静默,下一分钟再发 */ });
    };
    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => { clearInterval(timer); evs.forEach(([e, f]) => window.removeEventListener(e, f, { capture: true })); };
  }, []);
}

const STATUS_COLOR: Record<UsageStatus, string> = { online: '#2f7a5b', idle: '#b85c1e', offline: '#8a8478' };

interface Row {
  id: number; name: string; username: string; role: string; position: string; disabled: boolean; deleted: boolean;
  status: UsageStatus; lastSeen: number | null; lastLogin: number | null;
  minutes: Record<UsagePeriod, number>; days14: { day: string; minutes: number }[];
}

export function UsageTab() {
  const { lang, t } = useLang();
  const [data, setData] = useState<{ now: number; online: number; users: Row[] } | null>(null);
  const [err, setErr] = useState('');
  const [period, setPeriod] = useState<UsagePeriod>('today');
  const [all, setAll] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => fetch(`/api/usage${all ? '?all=1' : ''}`).then(async (r) => {
      const b = await r.json().catch(() => ({}));
      if (!alive) return;
      if (!r.ok) { setErr(b.error || t('读取失败', 'Could not load')); return; }
      setErr(''); setData(b);
    }).catch(() => { /* 下一分钟再读 */ });
    load();
    const timer = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(timer); };
  }, [all]);   // eslint-disable-line react-hooks/exhaustive-deps

  const PER: [UsagePeriod, string, string][] = [['today', '今天', 'Today'], ['week', '本周', 'This week'], ['month', '本月', 'This month']];
  const perName = (k: UsagePeriod) => { const x = PER.find((p) => p[0] === k)!; return lang === 'zh' ? x[1] : x[2]; };
  const rows = data?.users || [];
  const now = data?.now || Date.now();
  const mx = Math.max(60, ...rows.flatMap((r) => r.days14.map((d) => d.minutes)));
  const status = (s: UsageStatus) => (lang === 'zh' ? STATUS_TEXT[s][0] : STATUS_TEXT[s][1]);
  const who = (r: Row) => `${r.name}${r.deleted ? t('(已删除)', ' (deleted)') : r.disabled ? t('(已停用)', ' (disabled)') : ''}`;
  const lastLogin = (r: Row) => (r.lastLogin ? `${dMon(r.lastLogin)} ${hm(r.lastLogin)}` : '—');

  async function exportXlsx() {
    if (busy || !data) return;
    setBusy(true);
    try {
      /* 点了才加载 exceljs,不进首屏 */
      const mod = await import('exceljs');
      const m = mod as unknown as { default?: typeof mod };
      const X = m.default && 'Workbook' in m.default ? m.default : mod;
      const wb = new X.Workbook();
      const ws = wb.addWorksheet(t('登录与使用', 'Login & usage'));
      const days = rows[0]?.days14.map((d) => d.day) || [];
      ws.addRow([t('登录与使用', 'Login & usage'), `${t('导出时间', 'Exported')} ${dMon(now)} ${hm(now)}`, `${data.online} ${t('人在线', 'online')}`]);
      ws.addRow([t('用户', 'User'), t('职位', 'Position'), t('状态', 'Status'), t('最后活动', 'Last activity'), t('最近登录', 'Last login'),
        `${t('使用时长', 'Usage')}(${perName(period)})`, ...days.map((d) => d.slice(5))]).font = { bold: true };
      rows.forEach((r) => ws.addRow([who(r), r.position || roleTerm(r.role, lang), status(r.status), fmtAgo(r.lastSeen, now, lang), lastLogin(r),
        fmtMinutes(r.minutes[period], lang), ...r.days14.map((d) => d.minutes)]));
      ws.addRow([]);
      ws.addRow([t('近 14 天各列是当天使用分钟数。只算页面在前台、5 分钟内有操作的时间。', 'The last 14 columns are minutes used that day — only time with the page in front and activity within 5 minutes counts.')]);
      ws.columns.forEach((c, i) => { c.width = i === 0 ? 18 : i < 6 ? 16 : 7; });
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url; a.download = `Usage_${localDay()}_${period}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally { setBusy(false); }
  }

  return (
    <div data-testid="usage-tab">
      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--row-line)', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--navy900)' }}>{t('登录与使用', 'Login & usage')}</div>
          <span data-testid="usage-online" style={{ fontSize: 12.5, color: 'var(--text2)' }}>· {data ? t(`${data.online} 人在线`, `${data.online} online`) : '…'}</span>
          <div style={{ flex: 1 }} />
          {PER.map(([k]) => (
            <button key={k} className={`chip ${period === k ? 'active' : ''}`} data-testid={`usage-period-${k}`} onClick={() => setPeriod(k)}>{perName(k)}</button>
          ))}
          <label style={{ fontSize: 12.5, display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} data-testid="usage-all" />{t('含已停用', 'Include disabled')}
          </label>
          <button className="btn-line sm" onClick={exportXlsx} disabled={busy || !data} data-testid="usage-xlsx">{busy ? t('生成中…', 'Creating…') : t('导出 Excel', 'Export Excel')}</button>
        </div>
        {err && <div style={{ padding: 16, color: 'var(--danger)' }}>{err}</div>}
        <table className="usage-tbl" data-testid="usage-table">
          <thead>
            <tr>
              <th>{t('用户', 'User')}</th><th>{t('职位', 'Position')}</th><th>{t('状态', 'Status')}</th><th>{t('最后活动', 'Last activity')}</th>
              <th>{t('最近登录', 'Last login')}</th><th>{t('使用时长', 'Usage')}({perName(period)})</th><th style={{ width: 200 }}>{t('近 14 天', 'Last 14 days')}</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid="usage-row" data-user={r.username} style={r.disabled ? { color: 'var(--text2)' } : undefined}>
                <td style={{ fontWeight: 600 }}>{who(r)}</td>
                <td>{r.position || roleTerm(r.role, lang)}</td>
                <td data-testid="usage-status" data-status={r.status} style={{ color: STATUS_COLOR[r.status], fontWeight: 600 }}>{status(r.status)}</td>
                <td data-testid="usage-last">{fmtAgo(r.lastSeen, now, lang)}</td>
                <td data-testid="usage-login">{lastLogin(r)}</td>
                <td data-testid="usage-minutes" data-min={r.minutes[period]} style={{ fontWeight: 700 }}>{fmtMinutes(r.minutes[period], lang)}</td>
                <td>
                  <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 26 }}>
                    {r.days14.map((d) => (
                      <span key={d.day} title={`${d.day} · ${fmtMinutes(d.minutes, lang)}`}
                        style={{ width: 11, height: Math.max(2, (d.minutes / mx) * 26), background: d.minutes ? '#6B4E9E' : '#e6e0d6', borderRadius: 2 }} />
                    ))}
                  </div>
                </td>
                <td><button className="btn-line sm" data-testid="usage-detail-btn" onClick={() => setSel(sel === r.id ? null : r.id)}>{t('明细', 'Details')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sel !== null && <div style={{ marginTop: 14 }}><UsageDetail uid={sel} onClose={() => setSel(null)} /></div>}
      <div className="msub" style={{ marginTop: 10, lineHeight: 1.7 }}>
        {t('· 在线 = 2 分钟内有活动;空闲 = 已登录但 5 分钟以上没操作;离线 = 已登出,或 15 分钟以上没有任何请求。',
          '· Online = active within 2 minutes; Idle = signed in but no activity for 5+ minutes; Offline = signed out, or no request for 15+ minutes.')}<br />
        {t('· 使用时长只算页面在前台、5 分钟内有点击 / 输入 / 滚动的时间;不记录看了哪些页面。记录保留 12 个月。',
          '· Usage only counts time with the page in front and a click / key / scroll within 5 minutes; pages viewed are not recorded. Kept for 12 months.')}
      </div>
    </div>
  );
}

/* 某个人近 7 天的明细,可以往前翻 */
export function UsageDetail({ uid, onClose, self }: { uid?: number; onClose?: () => void; self?: boolean }) {
  const { lang, t } = useLang();
  const [end, setEnd] = useState<string>('');
  const [d, setD] = useState<{ user: { name: string }; today: string; end: string; days: UsageDay[] } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams(); if (uid) q.set('uid', String(uid)); if (end) q.set('end', end);
    fetch(`/api/usage/detail?${q}`).then(async (r) => {
      const b = await r.json().catch(() => ({}));
      if (!alive) return;
      if (!r.ok) { setErr(b.error || t('读取失败', 'Could not load')); return; }
      setErr(''); setD(b);
    }).catch(() => setErr(t('读取失败', 'Could not load')));
    return () => { alive = false; };
  }, [uid, end]);   // eslint-disable-line react-hooks/exhaustive-deps
  const reason = (r: string | null) => (r && r !== 'manual' ? (lang === 'zh' ? REASON_TEXT[r as 'expired'][0] : REASON_TEXT[r as 'expired'][1]) : '');
  /* 登出 / 最后活动:登出那天和登录不是同一天时带上日期 */
  const outText = (s: UsageDay['segments'][number]) => {
    if (s.logout === null) return t('仍在线', 'Still signed in');
    const at = localDay(new Date(s.logout)) === localDay(new Date(s.login)) ? hm(s.logout) : `${dMon(s.logout)} ${hm(s.logout)}`;
    const why = reason(s.reason);
    return why ? `${at}(${why})` : at;
  };
  const days = d?.days || [];
  const empty = d && days.every((x) => !x.segments.length && !x.minutes);
  return (
    <div className="panel" data-testid="usage-detail" style={{ padding: 0, overflow: 'hidden', borderColor: 'var(--navy700)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px', borderBottom: '1px solid var(--row-line)' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--navy900)' }} data-testid="usage-detail-title">
          {self ? t('我的使用记录', 'My usage') : `${d?.user.name || ''} · ${t('登录明细', 'Sign-in details')}`}
          <span style={{ fontWeight: 400, color: 'var(--text2)', fontSize: 12.5 }}> · {d ? `${dayLabel(days[days.length - 1]?.day || d.end, lang)} – ${dayLabel(d.end, lang)}` : ''}</span>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn-line sm" data-testid="usage-prev" disabled={!d} onClick={() => d && setEnd(addDays(d.end, -7))}>← {t('前 7 天', 'Previous 7 days')}</button>
        <button className="btn-line sm" data-testid="usage-next" disabled={!d || d.end >= d.today} onClick={() => d && setEnd(addDays(d.end, 7) > d.today ? d.today : addDays(d.end, 7))}>{t('后 7 天', 'Next 7 days')} →</button>
        {onClose && <button className="btn-line sm" onClick={onClose} title={t('关闭', 'Close')}>✕</button>}
      </div>
      {err && <div style={{ padding: 16, color: 'var(--danger)' }}>{err}</div>}
      <table className="usage-tbl">
        <thead><tr><th>{t('日期', 'Date')}</th><th>{t('登录', 'Sign in')}</th><th>{t('登出 / 最后活动', 'Sign out / last activity')}</th><th>{t('使用时长', 'Usage')}</th><th>{t('设备', 'Device')}</th></tr></thead>
        <tbody>
          {empty && <tr><td colSpan={5} className="msub">{t('这 7 天没有登录记录', 'No sign-ins in these 7 days')}</td></tr>}
          {!empty && days.map((x) => (
            <tr key={x.day} data-testid="usage-day" data-day={x.day}>
              <td>{dayLabel(x.day, lang)}</td>
              <td data-testid="usage-day-in">{x.segments.length ? x.segments.map((s) => hm(s.login)).join(' · ') : '—'}</td>
              <td data-testid="usage-day-out">{x.segments.length ? x.segments.map(outText).join(' · ') : '—'}</td>
              <td data-testid="usage-day-min">{fmtMinutes(x.minutes, lang)}</td>
              <td>{x.devices.join(' / ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="msub" style={{ padding: '8px 18px' }}>
        {t('一天里登录多次就按段列出;「超时自动登出」= 15 分钟以上没有任何操作或会话过期。只记登录 / 登出 / 使用时长和设备,不记看了哪些页面。',
          'Several sign-ins in a day are listed one after another. “Timed out” = no activity for 15+ minutes or the session expired. Only sign-ins, sign-outs, usage time and device are recorded — not the pages viewed.')}
      </div>
    </div>
  );
}

/* 头像旁边「我的使用记录」 */
export function MyUsageModal({ onClose }: { onClose: () => void }) {
  const { t } = useLang();
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 860, width: '94vw' }} data-testid="my-usage">
        <UsageDetail self onClose={onClose} />
        <div className="modal-actions"><button className="btn-line" onClick={onClose}>{t('关闭', 'Close')}</button></div>
      </div>
    </div>
  );
}
