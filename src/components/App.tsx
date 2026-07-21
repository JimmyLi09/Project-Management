'use client';

import React, { useEffect, useState } from 'react';
import type { User } from '@/lib/types';
import { StoreProvider, useStore } from './store';
import { allOverdue, fmtDate } from '@/lib/project';
import { ROLE_LABEL } from '@/lib/permissions';
import BoardView from './views/BoardView';
import ProjectsView from './views/ProjectsView';
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

function Shell() {
  const { user, view } = useStore();
  return (
    <>
      <Header />
      <main>
        {view.name === 'project' ? <ProjectDetail /> : (
          <>
            <Nav />
            {view.name === 'board' && <BoardView />}
            {view.name === 'projects' && <ProjectsView />}
            {view.name === 'mytasks' && <MyTasksView />}
            {view.name === 'dupdate' && <DirectorUpdateView />}
            {view.name === 'stats' && <StatsView />}
            {view.name === 'users' && <UsersView />}
          </>
        )}
      </main>
    </>
  );
}

function Header() {
  const { user, projects, setView } = useStore();
  const [notifOpen, setNotifOpen] = useState(false);
  const overdue = allOverdue(projects);

  useEffect(() => {
    if (!notifOpen) return;
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.notif') && !t.closest('.bell')) setNotifOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [notifOpen]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  const roleCls =
    user.role === 'member' || user.role === 'viewer' || user.role === 'pm' ? 'pm'
      : user.role === 'bd' ? 'director'
      : user.role;

  return (
    <>
      <header className="top">
        <div className="brand">
          <span className="dot">A</span>
          <div>
            Audax · 项目协作台<br />
            <small>Project Collaboration</small>
          </div>
        </div>
        <div className="spacer" />
        <div className="idbox">
          <span className={`role ${roleCls}`}>{ROLE_LABEL[user.role]}</span>
          <span className="uname">{user.name}</span>
          <button className="logout" onClick={logout}>退出</button>
        </div>
        <button className="bell" onClick={(e) => { e.stopPropagation(); setNotifOpen(!notifOpen); }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {overdue.length > 0 && <span className="badge">{overdue.length}</span>}
        </button>
        <div className="store-badge"><b /><span>已连接</span></div>
      </header>
      {notifOpen && (
        <div className="notif">
          <h4>逾期提醒 Overdue <span className="n">{overdue.length}</span></h4>
          <div className="nlist">
            {overdue.length === 0 ? (
              <div className="empty-n">✓ 暂无逾期项<br />All on schedule</div>
            ) : overdue.map((o, i) => (
              <div
                key={i}
                className="nitem"
                onClick={() => { setNotifOpen(false); setView({ name: 'project', pid: o.p.id, tab: 'schedule', pkg: 0 }); }}
              >
                <span className="over">逾期 {o.days}天</span>
                <div>
                  <b>{o.p.name}</b> · {o.row.phase}
                  <div className="meta">{o.row.task} · 应完成 {fmtDate(o.due)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function Nav() {
  const { view, go, me } = useStore();
  const tab = (name: Parameters<typeof go>[0], label: string) => (
    <button className={`navtab ${view.name === name ? 'active' : ''}`} onClick={() => go(name)}>
      {label}
    </button>
  );
  return (
    <div className="nav">
      {tab('board', '总览看板 Board')}
      {tab('projects', '项目卡片 Projects')}
      {tab('mytasks', '我的待办 My Tasks')}
      {tab('dupdate', '向上汇报 Director Update')}
      {tab('stats', '统计 Stats')}
      {(me.role === 'director' || me.role === 'bd') && tab('users', '用户 Users')}
    </div>
  );
}
