'use client';

import React, { useState } from 'react';
import { useStore } from '../store';
import { ROLE_LABEL } from '@/lib/permissions';
import type { Role } from '@/lib/types';

const ROLE_DESC: Record<Role, string> = {
  director: '全部权限(项目/人员/积分/决策)',
  bd: '全部权限(同 PD)',
  sales: '售前 / 商业资料 / 开票;生产只读',
  pm: '被指派项目的生产内容',
  member: '仅指派给自己的任务',
  viewer: '只读',
};

export default function UsersView() {
  const { users, refreshUsers } = useStore();
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
      setMsg(`✓ 已创建账号 ${username}`);
      setUsername(''); setPassword(''); setName('');
      refreshUsers();
    } else {
      const body = await res.json().catch(() => ({}));
      setMsg(body.error || '创建失败');
    }
  }

  return (
    <>
      <div className="page-head"><h1>用户管理</h1><span className="en">USERS</span></div>
      <p className="sub">正式版:每位成员使用个人账号登录,后台按角色控制查看与编辑范围(前端无法越权)。项目中的「负责 PM / 指派👤」按姓名匹配账号姓名。</p>
      <table className="stat-table" style={{ marginBottom: 22 }}>
        <tbody>
          <tr><th>账号</th><th>姓名</th><th>角色</th><th>权限</th></tr>
          {users.map((u) => (
            <tr key={u.id}>
              <td className="mono">{u.username}</td>
              <td>{u.name}</td>
              <td>{ROLE_LABEL[u.role]}</td>
              <td style={{ color: 'var(--muted)' }}>{ROLE_DESC[u.role]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={submit} style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: 18, maxWidth: 520 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>新建账号 New account</h3>
        {msg && <div className="sub" style={{ color: msg.startsWith('✓') ? 'var(--green)' : 'var(--red)' }}>{msg}</div>}
        <div className="two">
          <div className="field"><label>账号(登录名)</label><input value={username} onChange={(e) => setUsername(e.target.value)} required /></div>
          <div className="field"><label>初始密码(≥6位)</label><input value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          <div className="field"><label>姓名(显示名)</label><input value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div className="field">
            <label>角色</label>
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]} — {ROLE_DESC[r]}</option>)}
            </select>
          </div>
        </div>
        <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
          <button className="btn" disabled={busy}>{busy ? '创建中…' : '创建账号'}</button>
        </div>
      </form>
    </>
  );
}
