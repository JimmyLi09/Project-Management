'use client';

import React, { useState } from 'react';
import { useStore } from '../store';
import { ROLE_LABEL } from '@/lib/permissions';
import { useLang } from '@/lib/i18n';
import { Avatar } from '../ui';
import type { Role } from '@/lib/types';

const ROLE_DESC: Record<Role, [string, string]> = {
  director: ['全部权限(项目/人员/积分/决策)', 'Full access (projects, people, points, decisions)'],
  bd: ['全部权限(同 PD)', 'Full access (same as PD)'],
  sales: ['售前 / 商业资料 / 开票;生产只读', 'Presales / commercial / invoice; production read-only'],
  pm: ['被指派项目的生产内容', 'Production content of assigned projects'],
  member: ['仅指派给自己的任务', 'Only tasks assigned to them'],
  viewer: ['只读', 'Read-only'],
};

export default function UsersView() {
  const { users, refreshUsers } = useStore();
  const { lang, t } = useLang();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('pm');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, name, role }),
    });
    setBusy(false);
    if (res.ok) {
      setMsg(t(`✓ 已创建账号 ${username}`, `✓ Account ${username} created`));
      setUsername(''); setPassword(''); setName('');
      refreshUsers();
    } else {
      const body = await res.json().catch(() => ({}));
      setMsg(body.error || t('创建失败', 'Failed to create'));
    }
  }

  const cell: React.CSSProperties = { padding: '12px 22px', borderTop: '1px solid var(--row-line)', fontSize: 13 };
  const th: React.CSSProperties = { padding: '12px 22px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text2)', background: 'var(--hover-bg)', textAlign: 'left' };

  return (
    <div className="grid-2col" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 20, alignItems: 'start' }}>
      <div className="panel clip">
        <div className="panel-head"><span className="panel-title">{t('账号', 'Accounts')}</span></div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr><th style={th}>{t('用户', 'User')}</th><th style={th}>{t('账号', 'Username')}</th><th style={th}>{t('角色', 'Role')}</th><th style={th}>{t('权限', 'Access')}</th></tr>
            {users.map((u) => (
              <tr key={u.id}>
                <td style={cell}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, fontWeight: 600 }}><Avatar name={u.name} size={26} />{u.name}</span></td>
                <td style={{ ...cell, color: 'var(--text2)' }} className="tnum">{u.username}</td>
                <td style={cell}>{ROLE_LABEL[u.role]}</td>
                <td style={{ ...cell, color: 'var(--text2)', fontSize: 12 }}>{lang === 'zh' ? ROLE_DESC[u.role][0] : ROLE_DESC[u.role][1]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={submit} className="panel" style={{ padding: 22 }}>
        <div className="panel-title" style={{ marginBottom: 14 }}>{t('新建账号', 'New account')}</div>
        {msg && <div style={{ fontSize: 12.5, marginBottom: 12, color: msg.startsWith('✓') ? 'var(--success)' : 'var(--danger)' }}>{msg}</div>}
        <div className="field"><label>{t('账号(登录名)', 'Username')}</label><input value={username} onChange={(e) => setUsername(e.target.value)} required /></div>
        <div className="field"><label>{t('初始密码(≥6位)', 'Initial password (≥6 chars)')}</label><input value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        <div className="field"><label>{t('姓名(显示名,用于指派)', 'Name (display, used for assignment)')}</label><input value={name} onChange={(e) => setName(e.target.value)} required /></div>
        <div className="field">
          <label>{t('角色', 'Role')}</label>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]} — {lang === 'zh' ? ROLE_DESC[r][0] : ROLE_DESC[r][1]}</option>
            ))}
          </select>
        </div>
        <button className="btn-navy" disabled={busy} style={{ marginTop: 4 }}>{busy ? t('创建中…', 'Creating…') : t('创建账号', 'Create account')}</button>
      </form>
    </div>
  );
}
