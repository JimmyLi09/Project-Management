'use client';

/* ===== Client-side store: fetches from API, dispatches permission-checked actions ===== */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Project, User } from '@/lib/types';
import type { ProjectAction } from '@/server/actions';
import type { Identity } from '@/lib/permissions';

export interface View {
  name: 'overview' | 'projects' | 'team' | 'mytasks' | 'dupdate' | 'stats' | 'contacts' | 'finance' | 'registers' | 'users' | 'templates' | 'project';
  pid?: string;
  tab?: 'overview' | 'schedule' | 'checklist' | 'jobrecord';
  pkg?: number;
}

interface Store {
  user: User;
  me: Identity;
  projects: Project[];
  users: User[];
  view: View;
  toast: string;
  setToast: (s: string) => void;
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
  const [view, setView] = useState<View>({ name: 'overview' });
  const [toast, setToast] = useState('');
  /* latest known version per project (updated synchronously on every write) and
     a per-project promise chain, so a single user's rapid successive edits
     serialize and each carries the freshest version — strict CAS still rejects
     genuine cross-user conflicts. */
  const versionsRef = useRef<Record<string, number>>({});
  const chainRef = useRef<Record<string, Promise<boolean>>>({});
  const noteVersions = (list: Project[]) => { list.forEach((p) => { if (typeof p.version === 'number') versionsRef.current[p.id] = p.version; }); };

  const refresh = useCallback(async () => {
    const res = await fetch('/api/projects');
    if (res.status === 401) { location.href = '/login'; return; }
    if (res.ok) { const ps = (await res.json()).projects as Project[]; noteVersions(ps); setProjects(ps); }
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

  const dispatch = useCallback((pid: string, action: ProjectAction) => {
    /* v2.2 [P0-3] strict optimistic lock. Serialize per project so a user's own
       fast successive edits don't race their own version; cross-user conflicts
       still reject (409 stale) → re-read + prompt to reconfirm. */
    const run = async (): Promise<boolean> => {
      const base = versionsRef.current[pid];
      const res = await fetch(`/api/projects/${pid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...action, baseVersion: base }),
      });
      if (res.ok) {
        const { project } = await res.json();
        if (typeof project.version === 'number') versionsRef.current[pid] = project.version;
        setProjects((list) => list.map((p) => (p.id === pid ? project : p)));
        return true;
      }
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.stale) {
        const fresh = await fetch(`/api/projects/${pid}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (fresh?.project) {
          if (typeof fresh.project.version === 'number') versionsRef.current[pid] = fresh.project.version;
          setProjects((list) => list.map((p) => (p.id === pid ? fresh.project : p)));
        }
        setToast('⚠ 此项目刚被他人修改,已为你刷新,请核对后重新操作。');
        return false;
      }
      alert(body.error || '操作失败');
      return false;
    };
    const prev = chainRef.current[pid] || Promise.resolve(true);
    const next = prev.then(run, run);
    chainRef.current[pid] = next;
    return next;
  }, []);

  const createProject = useCallback(async (input: Record<string, unknown>) => {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (res.ok) {
      const { project } = await res.json();
      if (typeof project.version === 'number') versionsRef.current[project.id] = project.version;
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
    toast,
    setToast,
    setView,
    go: (name) => setView({ name }),
    openProject: (pid) => setView({ name: 'project', pid, tab: 'overview', pkg: 0 }),
    dispatch,
    createProject,
    removeProject,
    refresh,
    refreshUsers,
  }), [user, projects, users, view, toast, dispatch, createProject, removeProject, refresh, refreshUsers]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
