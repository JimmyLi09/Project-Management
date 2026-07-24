'use client';

/* ===== Shared UI primitives (icons, avatars, badges, progress) — from the Audax Platform design file ===== */

import React, { createContext, useContext } from 'react';
import { useLang } from '@/lib/i18n';
import type { Health } from '@/lib/project';
import type { ChecklistStatus, ScheduleStatus } from '@/lib/types';

/* C6: global name→avatar-photo map so <Avatar> can show real photos everywhere
   without threading a src prop through every call site. App fills it from users. */
const AvatarSrcCtx = createContext<Record<string, string>>({});
export function AvatarSrcProvider({ map, children }: { map: Record<string, string>; children: React.ReactNode }) {
  return <AvatarSrcCtx.Provider value={map}>{children}</AvatarSrcCtx.Provider>;
}

/* Lucide icon paths from the design file */
const PATHS: Record<string, string> = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/><path d="M9 21v-6h6v6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  check: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  checkSm: '<path d="M20 6 9 17l-5-5"/>',
  presentation: '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  settings: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="7" r="3"/><circle cx="7" cy="17" r="3"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/>',
  trending: '<path d="M22 7 13.5 15.5l-5-5L2 17"/><path d="M16 7h6v6"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  layers: '<path d="m12.83 2.18 8.72 4.36a1 1 0 0 1 0 1.79L12.83 12.7a1.85 1.85 0 0 1-1.66 0L2.45 8.33a1 1 0 0 1 0-1.79l8.72-4.36a1.85 1.85 0 0 1 1.66 0Z"/><path d="m22 12-9.17 4.58a1.85 1.85 0 0 1-1.66 0L2 12"/><path d="m22 17-9.17 4.58a1.85 1.85 0 0 1-1.66 0L2 17"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
};

export function Icon({ name, size = 17, style }: { name: string; size?: number; style?: React.CSSProperties }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}
      dangerouslySetInnerHTML={{ __html: PATHS[name] || '' }}
    />
  );
}

/* ── avatars: initials on a deterministic color ── */
const AV_COLORS = ['#174A7E', '#2E63B7', '#0B2341', '#B9772A', '#16865B', '#6D7B8A', '#0891b2', '#7c3aed'];

export function initialsOf(name: string): string {
  const t = (name || '?').trim();
  if (!t) return '?';
  if (/[一-鿿]/.test(t)) return t.length > 2 ? t.slice(t.length - 2) : t; // Chinese: given name
  const parts = t.split(/\s+/).filter(Boolean);
  return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : t.slice(0, 2).toUpperCase();
}
export function avatarColor(name: string): string {
  let h = 0;
  for (const ch of name || '?') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}

export function Avatar({ name, size = 28, title, src }: { name: string; size?: number; title?: string; src?: string }) {
  const map = useContext(AvatarSrcCtx);
  const photo = src || map[name];
  if (photo) {
    return (
      <span
        className="avatar"
        title={title || name}
        style={{ width: size, height: size, padding: 0, overflow: 'hidden', background: 'transparent' }}
      >
        <img src={photo} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </span>
    );
  }
  const init = initialsOf(name);
  const fs = init.length > 1 ? size * 0.36 : size * 0.44;
  return (
    <span
      className="avatar"
      title={title || name}
      style={{ width: size, height: size, background: avatarColor(name), fontSize: fs }}
    >
      {init}
    </span>
  );
}

export function AvatarStack({ names, size = 24 }: { names: string[]; size?: number }) {
  return (
    <span className="avatar-stack">
      {names.slice(0, 4).map((n) => <Avatar key={n} name={n} size={size} />)}
    </span>
  );
}

/* ── status colour maps from the design file (bilingual labels) ── */
export interface PillMeta { label: string; zh: string; dot: string; bg: string; fg: string }

export const HM: Record<Health | 'completed', PillMeta> = {
  ok: { label: 'On Track', zh: '正常', dot: '#16865B', bg: '#e6f2ec', fg: '#0f6a48' },
  risk: { label: 'At Risk', zh: '预警', dot: '#D98A12', bg: '#fbf0dc', fg: '#a8690b' },
  over: { label: 'Delayed', zh: '逾期', dot: '#D4483F', bg: '#fbe9e7', fg: '#b23a32' },
  completed: { label: 'Completed', zh: '已完成', dot: '#6D7B8A', bg: '#eef1f4', fg: '#51606f' },
};

export const TM: Record<ScheduleStatus, PillMeta> = {
  done: { label: 'Done', zh: '已完成', dot: '#16865B', bg: '#e6f2ec', fg: '#0f6a48' },
  wip: { label: 'In Progress', zh: '进行中', dot: '#2E63B7', bg: '#e7eefb', fg: '#234f97' },
  block: { label: 'Blocked', zh: '受阻', dot: '#D4483F', bg: '#fbe9e7', fg: '#b23a32' },
  todo: { label: 'To Do', zh: '未开始', dot: '#6D7B8A', bg: '#eef1f4', fg: '#51606f' },
};

export const CM: Record<ChecklistStatus, PillMeta> = {
  confirmed: { label: 'Approved', zh: '已确认', dot: '#16865B', bg: '#e6f2ec', fg: '#0f6a48' },
  received: { label: 'Received', zh: '已收到', dot: '#2E63B7', bg: '#e7eefb', fg: '#234f97' },
  pending: { label: 'Pending', zh: '未收到', dot: '#D98A12', bg: '#fbf0dc', fg: '#a8690b' },
  revision: { label: 'Revision', zh: '需修订', dot: '#D4483F', bg: '#fbe9e7', fg: '#b23a32' },
  rejected: { label: 'Rejected', zh: '退回', dot: '#D4483F', bg: '#fbe9e7', fg: '#b23a32' },
  na: { label: 'N / A', zh: 'N/A', dot: '#b6bfc9', bg: '#eef1f4', fg: '#6D7B8A' },
};

export function Pill({ m }: { m: PillMeta }) {
  const { lang } = useLang();
  return (
    <span className="badge" style={{ background: m.bg, color: m.fg }}>
      <span className="bdot" style={{ background: m.dot }} />
      {lang === 'zh' ? m.zh : m.label}
    </span>
  );
}

export function ProgressBar({ pct, color, showPct = true }: { pct: number; color?: string; showPct?: boolean }) {
  const c = color || (pct >= 100 ? '#16865B' : 'var(--navy700)');
  return (
    <span className="progress">
      <span className="track"><span className="fill" style={{ width: `${Math.min(100, pct)}%`, background: c }} /></span>
      {showPct && <span className="pv tnum">{pct}%</span>}
    </span>
  );
}

export function healthColor(pct: number): string {
  return pct >= 85 ? '#D4483F' : pct >= 70 ? '#D98A12' : '#16865B';
}
