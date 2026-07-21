'use client';

/* ===== Client-side store: fetches from API, dispatches permission-checked actions ===== */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Project, User } from '@/lib/types';
import type { ProjectAction } from '@/server/actions';
import type { Identity } from '@/lib/permissions';

export interface View {
  name: 'board' | 'projects' | 'mytasks' | 'dupdate' | 'stats' | 'users' | 'project';
  pid?: string;
  tab?: 'overview' | 'schedule' | 'checklist';
  pkg?: number;
}

interface Store {
  user: User;
  me: Identity;
  projects: Project[];
  users: User[];
  view: View;
  setView: (v: View) => void;
  go: (name: View['name']) => void;
  openProject: (pid: string) => void;
  dispatch: (pid: string, action: ProjectAction) => Promise<boolean>;
  createProject: (input: Record<string, unknown>) => Promise<Project | null>;
  removeProject: (pid: string) => Promise<boolean>;
  refresh: () => Promise<void>;
  refreshUsers: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('store missing');
  return s;
};

export function StoreProvider({ user, children }: { user: User; children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [view, setView] = useState<View>({ name: 'board' });

  const refresh = useCallback(async () => {
    const res = await fetch('/api/projects');
    if (res.status === 401) { location.href = '/login'; return; }
    if (res.ok) setProjects((await res.json()).projects);
  }, []);

  const refreshUsers = useCallback(async () => {
    const res = await fetch('/api/users');
    if (res.ok) setUsers((await res.json()).users);
  }, []);

  useEffect(() => {
    refresh();
    refreshUsers();
    /* light polling so teammates' changes appear without manual reload */
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh, refreshUsers]);

  const dispatch = useCallback(async (pid: string, action: ProjectAction) => {
    const res = await fetch(`/api/projects/${pid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });
    if (res.ok) {
      const { project } = await res.json();
      setProjects((list) => list.map((p) => (p.id === pid ? project : p)));
      return true;
    }
    const body = await res.json().catch(() => ({}));
    alert(body.error || '操作失败');
    return false;
  }, []);

  const createProject = useCallback(async (input: Record<string, unknown>) => {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (res.ok) {
      const { project } = await res.json();
      setProjects((list) => [project, ...list]);
      return project as Project;
    }
    const body = await res.json().catch(() => ({}));
    alert(body.error || '创建失败');
    return null;
  }, []);

  const removeProject = useCallback(async (pid: string) => {
    const res = await fetch(`/api/projects/${pid}`, { method: 'DELETE' });
    if (res.ok) {
      setProjects((list) => list.filter((p) => p.id !== pid));
      return true;
    }
    const body = await res.json().catch(() => ({}));
    alert(body.error || '删除失败');
    return false;
  }, []);

  const store = useMemo<Store>(() => ({
    user,
    me: { name: user.name, role: user.role },
    projects,
    users,
    view,
    setView,
    go: (name) => setView({ name }),
    openProject: (pid) => setView({ name: 'project', pid, tab: 'overview', pkg: 0 }),
    dispatch,
    createProject,
    removeProject,
    refresh,
    refreshUsers,
  }), [user, projects, users, view, dispatch, createProject, removeProject, refresh, refreshUsers]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
