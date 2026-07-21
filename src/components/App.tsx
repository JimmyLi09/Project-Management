'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { User } from '@/lib/types';
import { StoreProvider, useStore } from './store';
import { allOverdue, fmtDate } from '@/lib/project';
import { canCreate, isFull, ROLE_LABEL } from '@/lib/permissions';
import { Avatar, Icon } from './ui';
import OverviewView from './views/OverviewView';
import ProjectsView, { NewProjectModal } from './views/ProjectsView';
import TeamView from './views/TeamView';
import MyTasksView from './views/MyTasksView';
import DirectorUpdateView from './views/DirectorUpdateView';
import StatsView from './views/StatsView';
import UsersView from './views/UsersView';
import ProjectDetail from './views/ProjectDetail';

export default function App({ user }: { user: User }) {
  return (
    <StoreProvider user={user}>
      <Shell />
    </StoreProvider>
  );
}

const PAGE_META: Record<string, { title: string; sub: string }> = {
  overview: { title: 'Overview', sub: '项目组合健康度、团队负载与优先事项' },
  projects: { title: 'Projects', sub: '全部项目 · 按服务与负责人筛选' },
  team: { title: 'Team Allocation', sub: '团队工作量与项目分配' },
  mytasks: { title: 'My Tasks', sub: '你的未完成任务 · 按到期日排序' },
  dupdate: { title: 'Director Update', sub: '每周汇报、风险与决策闭环' },
  stats: { title: 'Reports', sub: '项目统计 · 按 PM 的项目数与积分' },
  users: { title: 'Users', sub: '账号、角色与访问权限' },
};

function Shell() {
  const { user, me, view, go, projects, setView } = useStore();
  const [showNew, setShowNew] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [search, setSearch] = useState('');
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
          {navItem('overview', 'home', 'Overview 总览')}
          {navItem('projects', 'grid', 'Projects 项目')}
          {navItem('team', 'users', 'Team Allocation 团队')}
          {navItem('mytasks', 'check', 'My Tasks 待办', myOpenCount)}
          {navItem('dupdate', 'presentation', 'Director Update 汇报')}
          {navItem('stats', 'trending', 'Reports 统计')}
          {isFull(me) && navItem('users', 'settings', 'Users 用户')}
        </nav>
        <div className="side-user">
          <Avatar name={user.name} size={34} />
          <div style={{ flex: 1, lineHeight: 1.2, minWidth: 0 }}>
            <div className="nm">{user.name}</div>
            <div className="rl">{ROLE_LABEL[user.role]}</div>
          </div>
          <button title="退出登录 Sign out" onClick={logout} style={{ color: 'var(--text2)', display: 'flex' }}>
            <Icon name="logout" size={16} />
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          {isProject ? (
            <>
              <button className="icon-btn" onClick={() => go('projects')} title="Back"><Icon name="back" /></button>
              <div>
                <div className="page-title">{project?.name || 'Project'}</div>
                <div className="page-sub">{project?.client || ''}</div>
              </div>
            </>
          ) : (
            <div>
              <div className="page-title">{meta.title}</div>
              <div className="page-sub">{meta.sub}</div>
            </div>
          )}
          <div style={{ flex: 1 }} />
          <div className="searchbox">
            <Icon name="search" size={16} />
            <input
              placeholder="Search projects, people…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') go('projects'); }}
            />
          </div>
          <button className="icon-btn bell-btn" aria-label="Notifications" onClick={(e) => { e.stopPropagation(); setNotifOpen(!notifOpen); }}>
            <Icon name="bell" />
            {overdue.length > 0 && <span className="dot-badge" />}
          </button>
          {canCreate(me) && (
            <button className="btn-navy" onClick={() => setShowNew(true)}>
              <Icon name="plus" size={16} /><span>New Project</span>
            </button>
          )}
        </header>

        {notifOpen && (
          <div className="notif-pop panel" style={{ position: 'absolute', top: 86, right: 32, width: 380, maxWidth: 'calc(100vw - 40px)', zIndex: 50, boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
            <div className="panel-head" style={{ padding: '14px 18px' }}>
              <span className="panel-title" style={{ fontSize: 14 }}>Overdue <span className="tnum" style={{ color: 'var(--danger)' }}>{overdue.length}</span></span>
            </div>
            <div style={{ maxHeight: 340, overflow: 'auto' }}>
              {overdue.length === 0 ? (
                <div style={{ padding: 26, textAlign: 'center', color: 'var(--text2)', fontSize: 12.5 }}>✓ All on schedule</div>
              ) : overdue.map((o, i) => (
                <div
                  key={i} className="row-hover"
                  style={{ padding: '12px 18px', borderTop: '1px solid var(--row-line)', cursor: 'pointer', display: 'flex', gap: 10 }}
                  onClick={() => { setNotifOpen(false); setView({ name: 'project', pid: o.p.id, tab: 'schedule', pkg: 0 }); }}
                >
                  <span className="badge" style={{ background: '#fbe9e7', color: '#b23a32', flexShrink: 0 }}>{o.days}d late</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.p.name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>{o.row.task} · due {fmtDate(o.due)}</div>
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
            {view.name === 'project' && <ProjectDetail />}
          </div>
        </section>
      </main>

      {showNew && <NewProjectModal onClose={() => setShowNew(false)} />}
    </div>
  );
}
