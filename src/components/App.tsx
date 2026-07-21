'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { User } from '@/lib/types';
import { StoreProvider, useStore } from './store';
import { allOverdue, fmtDate } from '@/lib/project';
import { canCreate, isFull, ROLE_LABEL } from '@/lib/permissions';
import { useLang } from '@/lib/i18n';
import { Avatar, Icon } from './ui';
import OverviewView from './views/OverviewView';
import ProjectsView, { NewProjectModal } from './views/ProjectsView';
import TeamView from './views/TeamView';
import MyTasksView from './views/MyTasksView';
import DirectorUpdateView from './views/DirectorUpdateView';
import StatsView from './views/StatsView';
import UsersView from './views/UsersView';
import TemplatesView from './views/TemplatesView';
import ProjectDetail from './views/ProjectDetail';

export default function App({ user }: { user: User }) {
  return (
    <StoreProvider user={user}>
      <Shell />
    </StoreProvider>
  );
}

const PAGE_META: Record<string, { title: [string, string]; sub: [string, string] }> = {
  overview: { title: ['总览', 'Overview'], sub: ['项目组合健康度、团队负载与优先事项', 'Portfolio health, team load and priorities'] },
  projects: { title: ['项目', 'Projects'], sub: ['全部项目 · 按服务与负责人筛选', 'All projects · filter by service and PM'] },
  team: { title: ['团队负载', 'Team Allocation'], sub: ['团队工作量与项目分配', 'Workload and assignments across the team'] },
  mytasks: { title: ['我的待办', 'My Tasks'], sub: ['你的未完成任务 · 按到期日排序', 'Your open items, sorted by due date'] },
  dupdate: { title: ['向上汇报', 'Director Update'], sub: ['每周汇报、风险与决策闭环', 'Weekly updates, risks and decisions'] },
  stats: { title: ['统计报表', 'Reports'], sub: ['项目统计 · 按 PM 的项目数与积分', 'Projects and points by PM'] },
  users: { title: ['用户管理', 'Users'], sub: ['账号、角色与访问权限', 'Accounts, roles and access'] },
  templates: { title: ['模板管理', 'Templates'], sub: ['编辑生产排期与信息清单模板(仅影响之后新建的项目)', 'Edit schedule & checklist templates (affects new projects only)'] },
};

function Shell() {
  const { user, me, view, go, projects, setView } = useStore();
  const { lang, setLang, t } = useLang();
  const [showNew, setShowNew] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showPw, setShowPw] = useState(false);
  /* force a password change when the account is flagged (first login / after reset) */
  const [mustChange, setMustChange] = useState(!!user.mustChangePassword);
  const overdue = useMemo(() => allOverdue(projects), [projects]);

  useEffect(() => {
    if (!notifOpen) return;
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.notif-pop') && !t.closest('.bell-btn')) setNotifOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [notifOpen]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  const isProject = view.name === 'project';
  const meta = PAGE_META[view.name] || PAGE_META.overview;
  const project = isProject ? projects.find((p) => p.id === view.pid) : undefined;

  const navItem = (name: typeof view.name, icon: string, label: string, badge?: number) => (
    <button className={`side-item ${view.name === name ? 'active' : ''}`} onClick={() => go(name)}>
      <Icon name={icon} size={17} />
      <span className="grow">{label}</span>
      {badge ? <span className="side-badge tnum">{badge}</span> : null}
    </button>
  );

  const myOpenCount = useMemo(() => {
    let n = 0;
    projects.forEach((p) => {
      const isOwner = (p.owners || []).includes(me.name);
      p.packages.forEach((pk) => pk.schedule.forEach((r) => {
        if (r.status === 'done') return;
        if (me.role === 'director' || me.role === 'bd' || me.role === 'sales') n++;
        else if (me.role === 'member') { if (r.assignee === me.name) n++; }
        else if (me.role !== 'viewer' && (isOwner || r.assignee === me.name)) n++;
      }));
    });
    return n;
  }, [projects, me]);

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="side-logo">
          <div className="logo-mark"><span /></div>
          <div>
            <div className="logo-word">AUDAX</div>
            <div className="logo-sub">PROJECT PLATFORM</div>
          </div>
        </div>
        <nav className="side-nav">
          {navItem('overview', 'home', t('总览', 'Overview'))}
          {navItem('projects', 'grid', t('项目', 'Projects'))}
          {navItem('team', 'users', t('团队负载', 'Team Allocation'))}
          {navItem('mytasks', 'check', t('我的待办', 'My Tasks'), myOpenCount)}
          {navItem('dupdate', 'presentation', t('向上汇报', 'Director Update'))}
          {navItem('stats', 'trending', t('统计报表', 'Reports'))}
          {isFull(me) && navItem('users', 'settings', t('用户管理', 'Users'))}
          {isFull(me) && navItem('templates', 'layers', t('模板管理', 'Templates'))}
        </nav>
        <div className="side-user">
          <Avatar name={user.name} size={34} />
          <div style={{ flex: 1, lineHeight: 1.2, minWidth: 0 }}>
            <div className="nm">{user.name}</div>
            <div className="rl">{user.position || ROLE_LABEL[user.role]}</div>
          </div>
          <button title={t('修改密码', 'Change password')} onClick={() => setShowPw(true)} style={{ color: 'var(--text2)', display: 'flex' }}>
            <Icon name="lock" size={15} />
          </button>
          <button title={t('退出登录', 'Sign out')} onClick={logout} style={{ color: 'var(--text2)', display: 'flex' }}>
            <Icon name="logout" size={16} />
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          {isProject ? (
            <>
              <button className="icon-btn" onClick={() => go('projects')} title={t('返回', 'Back')}><Icon name="back" /></button>
              <div>
                <div className="page-title">{project?.name || t('项目', 'Project')}</div>
                <div className="page-sub">{project?.client || ''}</div>
              </div>
            </>
          ) : (
            <div>
              <div className="page-title">{lang === 'zh' ? meta.title[0] : meta.title[1]}</div>
              <div className="page-sub">{lang === 'zh' ? meta.sub[0] : meta.sub[1]}</div>
            </div>
          )}
          <div style={{ flex: 1 }} />
          <div className="searchbox">
            <Icon name="search" size={16} />
            <input
              placeholder={t('搜索项目、客户、人员…', 'Search projects, people…')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') go('projects'); }}
            />
          </div>
          <button
            className="icon-btn" title={t('切换语言', 'Switch language')}
            style={{ width: 'auto', padding: '0 12px', fontSize: 12.5, fontWeight: 700, color: 'var(--navy700)' }}
            onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
          >
            {lang === 'zh' ? 'EN' : '中文'}
          </button>
          <button className="icon-btn bell-btn" aria-label="Notifications" onClick={(e) => { e.stopPropagation(); setNotifOpen(!notifOpen); }}>
            <Icon name="bell" />
            {overdue.length > 0 && <span className="dot-badge" />}
          </button>
          {canCreate(me) && (
            <button className="btn-navy" onClick={() => setShowNew(true)}>
              <Icon name="plus" size={16} /><span>{t('新建项目', 'New Project')}</span>
            </button>
          )}
        </header>

        {notifOpen && (
          <div className="notif-pop panel" style={{ position: 'absolute', top: 86, right: 32, width: 380, maxWidth: 'calc(100vw - 40px)', zIndex: 50, boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
            <div className="panel-head" style={{ padding: '14px 18px' }}>
              <span className="panel-title" style={{ fontSize: 14 }}>{t('逾期提醒', 'Overdue')} <span className="tnum" style={{ color: 'var(--danger)' }}>{overdue.length}</span></span>
            </div>
            <div style={{ maxHeight: 340, overflow: 'auto' }}>
              {overdue.length === 0 ? (
                <div style={{ padding: 26, textAlign: 'center', color: 'var(--text2)', fontSize: 12.5 }}>✓ {t('暂无逾期项', 'All on schedule')}</div>
              ) : overdue.map((o, i) => (
                <div
                  key={i} className="row-hover"
                  style={{ padding: '12px 18px', borderTop: '1px solid var(--row-line)', cursor: 'pointer', display: 'flex', gap: 10 }}
                  onClick={() => { setNotifOpen(false); setView({ name: 'project', pid: o.p.id, tab: 'schedule', pkg: 0 }); }}
                >
                  <span className="badge" style={{ background: '#fbe9e7', color: '#b23a32', flexShrink: 0 }}>{t(`逾期 ${o.days} 天`, `${o.days}d late`)}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.p.name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>{o.row.task} · {t('应完成', 'due')} {fmtDate(o.due)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <section className="content">
          <div className="content-inner">
            {view.name === 'overview' && <OverviewView />}
            {view.name === 'projects' && <ProjectsView search={search} />}
            {view.name === 'team' && <TeamView />}
            {view.name === 'mytasks' && <MyTasksView />}
            {view.name === 'dupdate' && <DirectorUpdateView />}
            {view.name === 'stats' && <StatsView />}
            {view.name === 'users' && <UsersView />}
            {view.name === 'templates' && <TemplatesView />}
            {view.name === 'project' && <ProjectDetail />}
          </div>
        </section>
      </main>

      {showNew && <NewProjectModal onClose={() => setShowNew(false)} />}
      {(showPw || mustChange) && (
        <ChangePasswordModal
          forced={mustChange}
          onClose={() => setShowPw(false)}
          onDone={() => { setMustChange(false); setShowPw(false); }}
        />
      )}
      <Toast />
    </div>
  );
}

function ChangePasswordModal({ forced, onClose, onDone }: { forced: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useLang();
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [nw2, setNw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (nw !== nw2) { setErr(t('两次输入的新密码不一致', 'New passwords do not match')); return; }
    if (nw.length < 6) { setErr(t('新密码至少 6 位', 'New password must be ≥6 chars')); return; }
    setBusy(true); setErr('');
    const res = await fetch('/api/auth/password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: cur, newPassword: nw }),
    });
    setBusy(false);
    if (res.ok) onDone();
    else { const b = await res.json().catch(() => ({})); setErr(b.error || t('修改失败', 'Failed')); }
  }

  return (
    <div className="overlay" onClick={(e) => { if (!forced && e.target === e.currentTarget) onClose(); }}>
      <form className="modal" style={{ maxWidth: 400 }} onSubmit={submit}>
        <h2>{t('修改密码', 'Change password')}</h2>
        <div className="msub">
          {forced
            ? t('首次登录(或密码被重置),请先设置新密码。', 'First login (or your password was reset) — please set a new password.')
            : t('输入当前密码与新密码。', 'Enter your current and new password.')}
        </div>
        {err && <div className="login-err">{err}</div>}
        <div className="field"><label>{t('当前密码', 'Current password')}</label><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoFocus required /></div>
        <div className="field"><label>{t('新密码(≥6位)', 'New password (≥6 chars)')}</label><input type="password" value={nw} onChange={(e) => setNw(e.target.value)} required /></div>
        <div className="field"><label>{t('确认新密码', 'Confirm new password')}</label><input type="password" value={nw2} onChange={(e) => setNw2(e.target.value)} required /></div>
        <div className="modal-actions">
          {!forced && <button type="button" className="btn-line" onClick={onClose}>{t('取消', 'Cancel')}</button>}
          <button className="btn-navy" disabled={busy}>{busy ? t('提交中…', 'Saving…') : t('确认修改', 'Change password')}</button>
        </div>
      </form>
    </div>
  );
}

/* transient bottom banner for conflict / info messages */
function Toast() {
  const { toast, setToast } = useStore();
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(id);
  }, [toast, setToast]);
  if (!toast) return null;
  return (
    <div className="toast" onClick={() => setToast('')}>
      {toast}
    </div>
  );
}
