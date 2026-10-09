'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useStore, useWho } from '../store';
import { ROLE_LABEL } from '@/lib/permissions';
import { roleTerm } from '@/lib/terms';
import { useLang } from '@/lib/i18n';
import { fmtDate } from '@/lib/project';
import { logText } from '@/lib/logmsg';
import { workOf, type PersonWork } from '@/lib/peopleRefs';
import {
  allowedLevels, defaultPermTable, PERM_MODULES, PERM_ROLES,
  type PermLevel, type PermModule, type PermRole, type PermTable,
} from '@/lib/permTable';
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

/* REQ-051: 「用户与权限」两个标签 —— 账号 / 权限设置 */
export default function UsersView() {
  const { t } = useLang();
  const [tab, setTab] = useState<'accounts' | 'perm'>(() => {
    try { return (localStorage.getItem('audax.usersTab') as 'accounts' | 'perm') || 'accounts'; } catch { return 'accounts'; }
  });
  const pick = (k: 'accounts' | 'perm') => { setTab(k); try { localStorage.setItem('audax.usersTab', k); } catch { /* ignore */ } };
  return (
    <>
      <div className="detail-tabs" style={{ marginBottom: 16, borderTop: 'none', borderBottom: '1px solid var(--border)' }}>
        <button className={`detail-tab ${tab === 'accounts' ? 'active' : ''}`} onClick={() => pick('accounts')} data-testid="users-tab-accounts">{t('账号', 'Accounts')}</button>
        <button className={`detail-tab ${tab === 'perm' ? 'active' : ''}`} onClick={() => pick('perm')} data-testid="users-tab-perm">{t('权限设置', 'Permissions')}</button>
      </div>
      {tab === 'accounts' ? <AccountsTab /> : <PermTab />}
    </>
  );
}

function AccountsTab() {
  const { allUsers, projects, refreshUsers, refresh, user: meUser } = useStore();
  const users = useMemo(() => allUsers.filter((u) => !u.deletedAt), [allUsers]);   // 已删除的不在列表里
  const { lang, t } = useLang();
  const [editUser, setEditUser] = useState<User | null>(null);
  const [delUser, setDelUser] = useState<User | null>(null);
  /* 负责项目 / 未完成待办:PD / BD 看得到全部项目,前端数就准 */
  const work = useMemo(() => {
    const m: Record<string, PersonWork> = {};
    users.forEach((u) => { m[u.name] = workOf(projects, u.name); });
    return m;
  }, [users, projects]);
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

  /* REQ-051 多了两列数字和「删除」,边距收一点、列头不折行 */
  const cell: React.CSSProperties = { padding: '12px 14px', borderTop: '1px solid var(--row-line)', fontSize: 13 };
  const th: React.CSSProperties = { padding: '12px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text2)', background: 'var(--hover-bg)', textAlign: 'left', whiteSpace: 'nowrap' };

  return (
    <div className="grid-2col" style={{ display: 'grid', gridTemplateColumns: '2.2fr 1fr', gap: 20, alignItems: 'start' }}>
      <div className="panel clip">
        <div className="panel-head"><span className="panel-title">{t('账号', 'Accounts')}</span></div>
        <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <th style={th}>{t('用户', 'User')}</th>
              <th style={th}>{t('账号', 'Username')}</th>
              <th style={th}>Email</th>
              <th style={th}>{t('职位', 'Position')}</th>
              <th style={th}>{t('系统角色', 'Role')}</th>
              <th style={{ ...th, textAlign: 'right' }}>{t('负责项目', 'Projects')}</th>
              <th style={{ ...th, textAlign: 'right' }}>{t('未完成待办', 'Open tasks')}</th>
              <th style={th}></th>
            </tr>
            {users.map((u) => (
              <tr key={u.id} style={u.disabled ? { opacity: 0.5 } : undefined} data-testid="user-row" data-name={u.name}>
                <td style={cell}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, fontWeight: 600, whiteSpace: 'nowrap' }}>
                    <Avatar name={u.name} size={26} />{u.name}
                    {u.disabled && <span className="badge" style={{ background: '#fbe9e7', color: '#b23a32' }}>{t('已停用', 'Disabled')}</span>}
                    {u.mustChangePassword && !u.disabled && <span className="badge" style={{ background: '#fbf0dc', color: '#a8690b' }} title={t('下次登录须改密码', 'Must change password on next login')}>🔑</span>}
                  </span>
                </td>
                <td style={{ ...cell, color: 'var(--text2)' }} className="tnum">{u.username}</td>
                <td style={{ ...cell, color: 'var(--text2)', fontSize: 12 }}>{u.email || '—'}</td>
                <td style={{ ...cell, fontSize: 12.5 }}>{u.position || '—'}</td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }} title={lang === 'zh' ? ROLE_DESC[u.role][0] : ROLE_DESC[u.role][1]}>{roleTerm(u.role, lang)}</td>
                <td style={{ ...cell, textAlign: 'right' }} className="tnum">{work[u.name]?.projects.length || 0}</td>
                <td style={{ ...cell, textAlign: 'right' }} className="tnum">{work[u.name]?.todos || 0}</td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                  <button className="btn-line sm" onClick={() => setEditUser(u)}>{t('编辑', 'Edit')}</button>
                  {u.role !== 'director' && u.role !== 'bd' && u.id !== meUser.id && (
                    <button className="btn-line sm danger" style={{ marginLeft: 6 }} onClick={() => setDelUser(u)} data-testid="user-delete">{t('删除', 'Delete')}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <div style={{ padding: '10px 22px', fontSize: 11.5, color: 'var(--text2)', borderTop: '1px solid var(--row-line)' }}>
          {t('登录可用「账号」或「Email」+ 密码;系统角色决定权限,职位仅作显示。', 'Sign in with username or email + password; the role controls permissions, position is display-only.')}
          <br />{t('PD / BD 账号不能删除；至少保留 1 个 PD。删除前先把他名下的工作转交给别人。', 'PD and BD accounts can’t be deleted; at least one PD stays. Hand someone’s work over before deleting them.')}
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
              <option key={r} value={r}>{roleTerm(r, lang)} — {lang === 'zh' ? ROLE_DESC[r][0] : ROLE_DESC[r][1]}</option>
            ))}
          </select>
        </div>
        <button className="btn-navy" disabled={busy} style={{ marginTop: 4 }}>{busy ? t('创建中…', 'Creating…') : t('创建账号', 'Create account')}</button>
      </form>
      {editUser && <EditUserModal u={editUser} onClose={() => setEditUser(null)} onSaved={() => { setEditUser(null); refreshUsers(); }} />}
      {delUser && <DeleteUserModal u={delUser} candidates={users.filter((x) => !x.disabled && x.id !== delUser.id)}
        onClose={() => setDelUser(null)} onDone={() => { setDelUser(null); refreshUsers(); refresh(); }} />}
    </div>
  );
}

/* ===== REQ-051 删除用户:先转交再删 =====
   显示他名下的工作(负责的项目、未完成待办、指派的信息清单项),每类选一个接手人
   (默认同角色的第一个人),勾「我确认删除」才能点。人数以服务端现数为准。 */
function DeleteUserModal({ u, candidates, onClose, onDone }: { u: User; candidates: User[]; onClose: () => void; onDone: () => void }) {
  const { t, lang } = useLang();
  const { setToast } = useStore();
  const [work, setWork] = useState<PersonWork | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  /* 同角色的排前面,默认选第一个 */
  const sorted = useMemo(() => [...candidates].sort((a, b) => Number(b.role === u.role) - Number(a.role === u.role)), [candidates, u.role]);
  const def = sorted[0]?.name || '';
  const [toP, setToP] = useState(def);
  const [toT, setToT] = useState(def);
  const [toC, setToC] = useState(def);
  useEffect(() => {
    fetch(`/api/users/${u.id}`).then((r) => r.json()).then((b) => { if (b.work) setWork(b.work); else setErr(b.error || ''); }).catch(() => setErr(t('读取失败', 'Failed to load')));
  }, [u.id, t]);
  const rows: { k: 'p' | 't' | 'c'; zh: string; en: string; n: number; v: string; set: (s: string) => void }[] = work ? [
    { k: 'p', zh: '负责的项目', en: 'Projects', n: work.projects.length, v: toP, set: setToP },
    { k: 't', zh: '未完成待办', en: 'Open tasks', n: work.todos, v: toT, set: setToT },
    { k: 'c', zh: '指派的信息清单项', en: 'Checklist items', n: work.checklist, v: toC, set: setToC },
  ] : [];
  const anyWork = rows.some((r) => r.n > 0);

  async function go() {
    setBusy(true); setErr('');
    const res = await fetch(`/api/users/${u.id}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toProjects: work?.projects.length ? toP : '', toTasks: work?.todos ? toT : '', toChecklist: work?.checklist ? toC : '', confirm: true }),
    });
    setBusy(false);
    const b = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(b.error || t('删除失败', 'Delete failed')); return; }
    setToast(t(`✓ ${u.name} 已删除`, `✓ ${u.name} deleted`) + (b.touched ? t(`；${b.touched} 个项目里的工作已转交`, `; work handed over in ${b.touched} projects`) : ''));
    onDone();
  }

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 500 }} data-testid="delete-user-modal">
        <h2>{t('删除用户', 'Delete user')} · {u.name}</h2>
        <div className="msub">{t('删除后不能登录、已打开的页面下一次操作即退出；用户列表和指派下拉里都不再出现。项目日志和历史记录里仍保留他的名字，显示「（已删除）」。',
          'Once deleted they can’t sign in, and any open session ends on its next request; they disappear from the user list and assignment pickers. Logs and history keep their name, marked "(deleted)".')}</div>
        {err && <div className="login-err">{err}</div>}
        {!work && !err && <div style={{ fontSize: 12.5, color: 'var(--text2)', margin: '12px 0' }}>{t('正在统计他名下的工作…', 'Counting their work…')}</div>}
        {work && (anyWork ? (
          <>
            <div style={{ fontWeight: 600, fontSize: 13, margin: '12px 0 6px' }}>{t('先转交他名下的工作', 'Hand over their work first')}</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.k} style={{ borderTop: '1px solid var(--row-line2)' }}>
                    <td style={{ padding: '7px 4px' }}>{t(r.zh, r.en)}</td>
                    <td style={{ padding: '7px 4px' }} className="tnum" data-testid={`del-n-${r.k}`}>{r.n}</td>
                    <td style={{ padding: '7px 4px' }}>
                      {r.n > 0 ? (
                        <select className="in sm" value={r.v} onChange={(e) => r.set(e.target.value)} data-testid={`del-to-${r.k}`}>
                          {sorted.map((c) => <option key={c.id} value={c.name}>{c.name} · {roleTerm(c.role, lang)}</option>)}
                        </select>
                      ) : <span style={{ color: 'var(--text2)' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 6 }}>
              {t('已完成的排期、已确认的清单项、已归档的项目是历史，保留原名。', 'Finished schedule rows, confirmed checklist items and archived projects are history and keep the original name.')}
            </div>
          </>
        ) : <div style={{ fontSize: 12.5, color: 'var(--text2)', margin: '12px 0' }}>{t('他名下没有项目、待办和清单项，可以直接删除。', 'Nothing is assigned to them — they can be deleted directly.')}</div>)}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 13 }}>
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} data-testid="del-confirm" />
          {t(`我确认删除 ${u.name}`, `I confirm deleting ${u.name}`)}
        </label>
        <div className="modal-actions">
          <button className="btn-line" onClick={onClose}>{t('取消', 'Cancel')}</button>
          <button className="btn-navy" onClick={go} disabled={!ok || !work || busy || (anyWork && !sorted.length)} data-testid="del-go">
            {busy ? t('处理中…', 'Working…') : anyWork ? t('转交并删除', 'Hand over & delete') : t('删除', 'Delete')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ===== REQ-051 权限设置:按角色的权限表 =====
   每格「不可见 / 只读 / 可编辑」,选项到这个角色在原有规则里的上限为止(上限 = 默认值)。
   PD / BD 两列锁定。保存后已登录的人刷新即生效;每改一格记一条日志。 */
const LV: Record<PermLevel, [string, string]> = { none: ['不可见', 'Hidden'], read: ['只读', 'Read only'], edit: ['可编辑', 'Can edit'] };
const LV_COLOR: Record<PermLevel, string> = { none: 'var(--text2)', read: '#2f6db5', edit: 'var(--success)' };

function PermTab() {
  const { permTable, setPermTable, setToast } = useStore();
  const { t, lang } = useLang();
  const who = useWho();
  const [draft, setDraft] = useState<PermTable>(() => JSON.parse(JSON.stringify(permTable)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [log, setLog] = useState<{ at: number; by: string; text: string; k?: string; p?: Record<string, string | number | null | undefined> }[]>([]);
  const defaults = useMemo(() => defaultPermTable(), []);
  const loadLog = () => fetch('/api/permissions/log').then((r) => (r.ok ? r.json() : { entries: [] })).then((b) => setLog(b.entries || [])).catch(() => {});
  useEffect(() => { loadLog(); }, []);
  const dirty = JSON.stringify(draft) !== JSON.stringify(permTable);
  const set = (r: PermRole, m: PermModule, v: PermLevel) => setDraft((d) => ({ ...d, [r]: { ...d[r], [m]: v } }));

  async function save() {
    setBusy(true); setErr('');
    const res = await fetch('/api/permissions', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ table: draft }) });
    setBusy(false);
    const b = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(b.error || t('保存失败', 'Save failed')); return; }
    setPermTable(b.table);
    setDraft(JSON.parse(JSON.stringify(b.table)));
    setToast(b.changed ? t(`✓ 权限已保存（${b.changed} 处），已登录的人刷新后生效`, `✓ Permissions saved (${b.changed} changes); others see it after a refresh`) : t('没有改动', 'Nothing changed'));
    loadLog();
  }

  const th: React.CSSProperties = { padding: '10px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text2)', background: 'var(--hover-bg)', textAlign: 'left', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '9px 12px', borderTop: '1px solid var(--row-line)', fontSize: 13, verticalAlign: 'top' };
  return (
    <>
      <div className="panel clip" data-testid="perm-table">
        <div className="panel-head" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="panel-title">{t('按角色的权限表', 'Permissions by role')}</span>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>{t('每格选「不可见 / 只读 / 可编辑」；REQ-043「PM / Engineer 只看自己的项目」继续生效', 'Each cell: Hidden / Read only / Can edit. REQ-043 (PM / Engineer see only their own projects) still applies')}</span>
          <span style={{ flex: 1 }} />
          <button className="btn-line sm" onClick={() => { setDraft(defaultPermTable()); setToast(t('已恢复默认，点「保存」生效', 'Defaults restored — click Save to apply')); }} data-testid="perm-reset">{t('恢复默认', 'Restore defaults')}</button>
          <button className="btn-navy sm" onClick={save} disabled={busy || !dirty} data-testid="perm-save">{busy ? t('保存中…', 'Saving…') : t('保存', 'Save')}</button>
        </div>
        {err && <div className="login-err" style={{ margin: '10px 16px' }}>{err}</div>}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <th style={th}>{t('功能模块', 'Module')}</th>
                {/* 需求里这一列叫 Engineer —— 系统角色名是「成员」,两个都写上 */}
                {PERM_ROLES.map((r) => <th key={r} style={th}>{r === 'member' ? t('Engineer（成员）', 'Engineer (Member)') : roleTerm(r, lang)}</th>)}
              </tr>
              {PERM_MODULES.map((m) => (
                <tr key={m.key}>
                  <td style={td}>
                    <b style={{ fontWeight: 600 }}>{lang === 'zh' ? m.zh : m.en}</b>
                    <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 2, maxWidth: 300 }}>{lang === 'zh' ? m.noteZh : m.noteEn}</div>
                  </td>
                  {PERM_ROLES.map((r) => {
                    if (r === 'director' || r === 'bd') return <td key={r} style={{ ...td, background: 'var(--hover-bg)', color: 'var(--text2)', fontSize: 12, whiteSpace: 'nowrap' }}>{t('可编辑', 'Can edit')} 🔒</td>;
                    const pr = r as PermRole;
                    const v = draft[pr][m.key];
                    const opts = allowedLevels(pr, m.key);
                    const changed = v !== defaults[pr][m.key];
                    return (
                      <td key={r} style={{ ...td, whiteSpace: 'nowrap' }}>
                        {opts.length > 1 ? (
                          <select className="in sm" value={v} onChange={(e) => set(pr, m.key, e.target.value as PermLevel)} data-testid={`perm-${r}-${m.key}`}
                            style={{ width: 'auto', color: LV_COLOR[v], fontWeight: v === 'edit' ? 600 : 400 }}>
                            {opts.map((l) => <option key={l} value={l}>{t(LV[l][0], LV[l][1])}</option>)}
                          </select>
                        ) : <span style={{ fontSize: 12, color: LV_COLOR[v] }} data-testid={`perm-${r}-${m.key}`} title={t('原有规则就是这样，不能改', 'Fixed by the existing rules')}>{t(LV[v][0], LV[v][1])}</span>}
                        {changed && <span style={{ marginLeft: 6, fontSize: 11, color: '#a8690b' }} title={t(`默认：${LV[defaults[pr][m.key]][0]}`, `Default: ${LV[defaults[pr][m.key]][1]}`)}>{t('已改', 'changed')}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 16px', fontSize: 11.5, color: 'var(--text2)', borderTop: '1px solid var(--row-line)', lineHeight: 1.6 }}>
          {t('PD / BD 固定为全部可编辑（锁定），避免把自己锁在外面。「只读」角色不在表里，照旧全部只读。', 'PD and BD are locked to "Can edit" so nobody locks themselves out. The Viewer role isn’t in the table and stays read-only.')}<br />
          {t('默认值 = 上线前的规则；每格最多放到原有规则允许的程度。原有的细则照旧叠加：比如只有 Finance 能改开票信息、Sales 要在项目里有「编辑授权」才能改制作内容。想让某个人改某个项目，在项目里给他「编辑授权」。',
            'Defaults = the rules before this change; a cell can’t go beyond what those rules allow. The finer rules still apply on top: only Finance edits invoice details, Sales needs project edit access to change production content, and so on. To let one person edit one project, grant them edit access on that project.')}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16, padding: '14px 18px' }} data-testid="perm-log">
        <div className="panel-title" style={{ marginBottom: 8 }}>{t('修改记录', 'Change log')}</div>
        {log.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>{t('还没有修改记录。', 'No changes yet.')}</div>}
        {log.slice(0, 50).map((e, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, padding: '6px 0', borderTop: i ? '1px solid var(--row-line2)' : undefined, fontSize: 12.5 }}>
            <span className="tnum" style={{ color: 'var(--text2)', whiteSpace: 'nowrap' }}>{fmtDate(new Date(e.at))} {new Date(e.at).toTimeString().slice(0, 5)}</span>
            <b style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{who(e.by)}</b>
            <span>{logText(e, lang)}</span>
          </div>
        ))}
      </div>
    </>
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
              <option key={r} value={r}>{roleTerm(r, lang)} — {lang === 'zh' ? ROLE_DESC[r][0] : ROLE_DESC[r][1]}</option>
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
