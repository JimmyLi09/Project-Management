'use client';

import React, { useState } from 'react';
import { useStore } from '../store';
import { ROLE_LABEL } from '@/lib/permissions';
import { useLang } from '@/lib/i18n';
import { Avatar } from '../ui';
import type { Role, User } from '@/lib/types';

const ROLE_DESC: Record<Role, [string, string]> = {
  director: ['全部权限(项目/人员/积分/决策)', 'Full access (projects, people, points, decisions)'],
  bd: ['全部权限(同 PD)', 'Full access (same as PD)'],
  sales: ['售前 / 商业资料 / 开票;生产只读', 'Presales / commercial / invoice; production read-only'],
  pm: ['被指派项目的生产内容', 'Production content of assigned projects'],
  member: ['仅指派给自己的任务', 'Only tasks assigned to them'],
  viewer: ['只读', 'Read-only'],
  finance: ['开票/收款状态跟踪(不改生产)', 'Invoice/payment status tracking (no production edits)'],
};

export default function UsersView() {
  const { users, refreshUsers } = useStore();
  const { lang, t } = useLang();
  const [editUser, setEditUser] = useState<User | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [position, setPosition] = useState('');
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
      body: JSON.stringify({ username, password, name, role, email, position }),
    });
    setBusy(false);
    if (res.ok) {
      setMsg(t(`✓ 已创建账号 ${username}`, `✓ Account ${username} created`));
      setUsername(''); setPassword(''); setName(''); setEmail(''); setPosition('');
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
            <tr>
              <th style={th}>{t('用户', 'User')}</th>
              <th style={th}>{t('账号', 'Username')}</th>
              <th style={th}>Email</th>
              <th style={th}>{t('职位', 'Position')}</th>
              <th style={th}>{t('系统角色', 'Role')}</th>
              <th style={th}></th>
            </tr>
            {users.map((u) => (
              <tr key={u.id} style={u.disabled ? { opacity: 0.5 } : undefined}>
                <td style={cell}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, fontWeight: 600 }}>
                    <Avatar name={u.name} size={26} />{u.name}
                    {u.disabled && <span className="badge" style={{ background: '#fbe9e7', color: '#b23a32' }}>{t('已停用', 'Disabled')}</span>}
                    {u.mustChangePassword && !u.disabled && <span className="badge" style={{ background: '#fbf0dc', color: '#a8690b' }} title={t('下次登录须改密码', 'Must change password on next login')}>🔑</span>}
                  </span>
                </td>
                <td style={{ ...cell, color: 'var(--text2)' }} className="tnum">{u.username}</td>
                <td style={{ ...cell, color: 'var(--text2)', fontSize: 12 }}>{u.email || '—'}</td>
                <td style={{ ...cell, fontSize: 12.5 }}>{u.position || '—'}</td>
                <td style={cell} title={lang === 'zh' ? ROLE_DESC[u.role][0] : ROLE_DESC[u.role][1]}>{ROLE_LABEL[u.role]}</td>
                <td style={cell}><button className="btn-line sm" onClick={() => setEditUser(u)}>{t('编辑', 'Edit')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: '10px 22px', fontSize: 11.5, color: 'var(--text2)', borderTop: '1px solid var(--row-line)' }}>
          {t('登录可用「账号」或「Email」+ 密码;系统角色决定权限,职位仅作显示。', 'Sign in with username or email + password; the role controls permissions, position is display-only.')}
        </div>
      </div>

      <form onSubmit={submit} className="panel" style={{ padding: 22 }}>
        <div className="panel-title" style={{ marginBottom: 14 }}>{t('新建账号', 'New account')}</div>
        {msg && <div style={{ fontSize: 12.5, marginBottom: 12, color: msg.startsWith('✓') ? 'var(--success)' : 'var(--danger)' }}>{msg}</div>}
        <div className="field"><label>{t('账号(登录名)', 'Username')}</label><input value={username} onChange={(e) => setUsername(e.target.value)} required /></div>
        <div className="field"><label>{t('初始密码(≥6位)', 'Initial password (≥6 chars)')}</label><input value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        <div className="field"><label>{t('姓名(显示名,用于指派,需唯一)', 'Name (display, used for assignment, unique)')}</label><input value={name} onChange={(e) => setName(e.target.value)} required /></div>
        <div className="field"><label>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@audax.com" /></div>
        <div className="field"><label>{t('职位(如 Senior PM / 3D Artist)', 'Position (e.g. Senior PM / 3D Artist)')}</label><input value={position} onChange={(e) => setPosition(e.target.value)} /></div>
        <div className="field">
          <label>{t('系统角色(决定权限)', 'Role (controls permissions)')}</label>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]} — {lang === 'zh' ? ROLE_DESC[r][0] : ROLE_DESC[r][1]}</option>
            ))}
          </select>
        </div>
        <button className="btn-navy" disabled={busy} style={{ marginTop: 4 }}>{busy ? t('创建中…', 'Creating…') : t('创建账号', 'Create account')}</button>
      </form>
      {editUser && <EditUserModal u={editUser} onClose={() => setEditUser(null)} onSaved={() => { setEditUser(null); refreshUsers(); }} />}
    </div>
  );
}

function EditUserModal({ u, onClose, onSaved }: { u: User; onClose: () => void; onSaved: () => void }) {
  const { t, lang } = useLang();
  const [name, setName] = useState(u.name);
  const [email, setEmail] = useState(u.email || '');
  const [position, setPosition] = useState(u.position || '');
  const [role, setRole] = useState<Role>(u.role);
  const [pointCap, setPointCap] = useState<string>(u.pointCap ? String(u.pointCap) : '');
  const [avatar, setAvatar] = useState<string | undefined>(u.avatar);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true); setMsg('');
    const cap = pointCap.trim() === '' ? 0 : Number(pointCap);
    const res = await fetch('/api/users', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id, name, email, position, role, pointCap: cap }),
    });
    setBusy(false);
    if (res.ok) onSaved();
    else { const b = await res.json().catch(() => ({})); setMsg(b.error || t('保存失败', 'Save failed')); }
  }

  /* C6: compress to a ~200px square-ish JPEG and upload the avatar */
  function uploadAvatar(input: HTMLInputElement) {
    const f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) { setMsg(t('只支持图片文件', 'Only image files')); return; }
    const rd = new FileReader();
    rd.onload = (e) => {
      const img = new Image();
      img.onload = async () => {
        const mx = 200;
        let w = img.width, h = img.height;
        if (w > mx || h > mx) { const s = mx / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d')!.drawImage(img, 0, 0, w, h);
        let data: string;
        try { data = c.toDataURL('image/jpeg', 0.72); } catch { setMsg(t('图片处理失败', 'Failed to process image')); return; }
        const res = await fetch('/api/users', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: u.id, action: 'setAvatar', avatar: data }),
        });
        if (res.ok) { setAvatar(data); setMsg(t('✓ 头像已更新', '✓ Avatar updated')); onSaved(); }
        else setMsg((await res.json().catch(() => ({}))).error || t('上传失败', 'Upload failed'));
      };
      img.onerror = () => setMsg(t('无法读取图片', 'Could not read image'));
      img.src = e.target!.result as string;
    };
    rd.readAsDataURL(f);
  }

  async function removeAvatar() {
    const res = await fetch('/api/users', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id, action: 'setAvatar', avatar: '' }),
    });
    if (res.ok) { setAvatar(undefined); setMsg(t('✓ 已恢复首字母头像', '✓ Reverted to initials')); onSaved(); }
    else setMsg((await res.json().catch(() => ({}))).error || t('失败', 'Failed'));
  }

  async function resetPw() {
    const pw = prompt(t(`为 ${u.name} 设置新的初始密码(≥6位),对方下次登录须修改:`, `New initial password for ${u.name} (≥6 chars); they must change it on next login:`));
    if (pw === null) return;
    if (pw.length < 6) { setMsg(t('密码至少 6 位', 'Password must be ≥6 chars')); return; }
    const res = await fetch('/api/users', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id, action: 'resetPassword', newPassword: pw }),
    });
    setMsg(res.ok ? t('✓ 密码已重置', '✓ Password reset') : ((await res.json().catch(() => ({}))).error || t('失败', 'Failed')));
  }

  async function toggleDisabled() {
    const disabling = !u.disabled;
    if (disabling && !confirm(t(`停用 ${u.name} 的账号?对方将无法登录(建议先转交其项目)。`, `Disable ${u.name}'s account? They won't be able to sign in (transfer their projects first).`))) return;
    const res = await fetch('/api/users', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id, action: 'setDisabled', disabled: disabling }),
    });
    if (res.ok) onSaved();
    else setMsg((await res.json().catch(() => ({}))).error || t('失败', 'Failed'));
  }

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <h2>{t('编辑用户', 'Edit user')} · {u.username}</h2>
        <div className="msub">{t('改姓名会自动同步到所有项目的负责人与任务指派(按姓名匹配)。', 'Renaming propagates to all project ownership and task assignments (matched by name).')}</div>
        {msg && <div className={msg.startsWith('✓') ? 'login-hint' : 'login-err'} style={msg.startsWith('✓') ? { color: 'var(--success)' } : undefined}>{msg}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
          <Avatar name={u.name} size={54} src={avatar} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label className="btn-line sm" style={{ cursor: 'pointer' }}>
              📷 {t('上传头像', 'Upload photo')}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => uploadAvatar(e.target)} />
            </label>
            {avatar && <button className="btn-line sm danger" onClick={removeAvatar}>{t('移除', 'Remove')}</button>}
          </div>
        </div>
        <div className="field"><label>{t('姓名', 'Name')}</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field"><label>{t('职位', 'Position')}</label><input value={position} onChange={(e) => setPosition(e.target.value)} /></div>
        <div className="field">
          <label>{t('系统角色', 'Role')}</label>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]} — {lang === 'zh' ? ROLE_DESC[r][0] : ROLE_DESC[r][1]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{t('积分上限(负载预警,0 或留空=不限)', 'Point cap (overload warning; 0 or blank = no limit)')}</label>
          <input type="number" min={0} max={999} value={pointCap} onChange={(e) => setPointCap(e.target.value)} placeholder={t('例如 8', 'e.g. 8')} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--row-line)', paddingTop: 14, marginTop: 4 }}>
          <button className="btn-line sm" onClick={resetPw}>🔑 {t('重置密码', 'Reset password')}</button>
          <button className={`btn-line sm ${u.disabled ? '' : 'danger'}`} onClick={toggleDisabled}>
            {u.disabled ? '↺ ' + t('恢复账号', 'Re-enable') : '⛔ ' + t('停用账号', 'Disable')}
          </button>
        </div>
        <div className="modal-actions">
          <button className="btn-line" onClick={onClose}>{t('取消', 'Cancel')}</button>
          <button className="btn-navy" onClick={save} disabled={busy}>{busy ? t('保存中…', 'Saving…') : t('保存', 'Save')}</button>
        </div>
      </div>
    </div>
  );
}
