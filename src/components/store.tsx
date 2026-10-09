'use client';

/* ===== Client-side store: fetches from API, dispatches permission-checked actions ===== */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Project, User } from '@/lib/types';
import type { ProjectAction } from '@/server/actions';
import type { Identity } from '@/lib/permissions';
import type { Handoff, StoredDrawing } from '@/av/core/handoff';
import type { AvDerived, FieldOverrides } from '@/lib/records';
import type { Focus } from '@/lib/focus';
import { DEFAULT_POINT_RULES, rulesAt, type PointRuleVersion, type PointRules } from '@/lib/points';
import { DEFAULT_KPI_RULES, kpiRulesAt, type KpiRuleVersion, type KpiRules } from '@/lib/kpi';
import { defaultPermTable, sanitizePermTable, setPermSource, type PermTable } from '@/lib/permTable';
import { useLang } from '@/lib/i18n';

export interface View {
  name: 'overview' | 'projects' | 'team' | 'mytasks' | 'dupdate' | 'stats' | 'contacts' | 'finance' | 'registers' | 'avhome' | 'avconfig' | 'avcostquote' | 'avlibrary' | 'avinquiry' | 'ledingest' | 'ledstudio' | 'prjstudio' | 'elvstudio' | 'pvstudio' | 'avcost' | 'avquote' | 'avcases' | 'avprices' | 'users' | 'templates' | 'rules' | 'knowledge' | 'training' | 'kpi' | 'project';
  pid?: string;
  tab?: 'overview' | 'schedule' | 'checklist' | 'jobrecord';
  pkg?: number;
  /* 0922 变更单:从统计 / 汇报上的某个数字点进来时,带上「那个数字数的是
     哪一组项目」—— 项目列表照它过滤,并在顶上标出来、可一键清除。 */
  focus?: Focus;
  /* 0929 AV 改版:合并页里现在开着哪个标签(方案配置的业务线、成本与报价的
     两档、资料库的两档)。放在 view 上而不是各页自己的 state —— 从工作台
     「去报价 ›」这种链接要能直接落到指定标签上。 */
  sub?: string;
  /* AV-017:06 成本核算落在哪条业务线(从 05 某条线「下一步」过来时带上) */
  line?: string;
}

/* ===== AV-017 · 网址同步 =====
   切页只改 state 不改网址的话,浏览器后退直接离开平台、刷新回总览。现在每次
   切页把「视图 + 标签 + 业务线 + 项目」写进网址(pushState),后退 / 前进由
   popstate 还原,刷新时从网址读回来。全站都走这一条,不只 AV。 */

/* 老的单页入口(0929 合并前的独立菜单)一律落到合并页的对应标签上,
   这样步骤条、顶栏、后退都只有一套。 */
const LEGACY: Partial<Record<View['name'], View>> = {
  ledstudio: { name: 'avconfig', sub: 'led' },
  prjstudio: { name: 'avconfig', sub: 'projector' },
  elvstudio: { name: 'avconfig', sub: 'elv' },
  pvstudio: { name: 'avconfig', sub: 'pv' },
  avcost: { name: 'avcostquote', sub: 'cost' },
  avquote: { name: 'avcostquote', sub: 'quote' },
  avcases: { name: 'avlibrary', sub: 'cases' },
  avprices: { name: 'avlibrary', sub: 'prices' },
};
export const normalizeView = (v: View): View => {
  const l = LEGACY[v.name];
  return l ? { ...l, ...(v.line ? { line: v.line } : {}) } : v;
};

/* 进入这些页面时网址带上当前 AV 项目 */
export const AV_FLOW_VIEWS: View['name'][] = ['avinquiry', 'ledingest', 'avconfig', 'avcostquote'];
const VIEW_NAMES = new Set<string>(['overview', 'projects', 'team', 'mytasks', 'dupdate', 'stats', 'contacts', 'finance', 'registers', 'avhome', 'avconfig', 'avcostquote', 'avlibrary', 'avinquiry', 'ledingest', 'ledstudio', 'prjstudio', 'elvstudio', 'pvstudio', 'avcost', 'avquote', 'avcases', 'avprices', 'users', 'templates', 'rules', 'knowledge', 'training', 'kpi', 'project']);

export function viewToQuery(v: View, avProject: string): string {
  const q = new URLSearchParams();
  q.set('v', v.name);
  if (v.sub) q.set('s', v.sub);
  if (v.line) q.set('line', v.line);
  if (v.pid) q.set('pid', v.pid);
  if (v.tab) q.set('tab', v.tab);
  if (typeof v.pkg === 'number' && v.pkg) q.set('pkg', String(v.pkg));
  if (v.focus) q.set('f', JSON.stringify(v.focus));
  if (avProject && AV_FLOW_VIEWS.includes(v.name)) q.set('p', avProject);
  return '?' + q.toString();
}

export function queryToView(search: string): { view: View; p: string } | null {
  const q = new URLSearchParams(search);
  const name = q.get('v');
  if (!name || !VIEW_NAMES.has(name)) return null;
  const v: View = { name: name as View['name'] };
  if (q.get('s')) v.sub = q.get('s')!;
  if (q.get('line')) v.line = q.get('line')!;
  if (q.get('pid')) v.pid = q.get('pid')!;
  const tab = q.get('tab');
  if (tab === 'overview' || tab === 'schedule' || tab === 'checklist' || tab === 'jobrecord') v.tab = tab;
  if (q.get('pkg')) v.pkg = Number(q.get('pkg')) || 0;
  if (v.name === 'project' && v.pkg === undefined) v.pkg = 0;
  try { if (q.get('f')) v.focus = JSON.parse(q.get('f')!) as Focus; } catch { /* 坏了就不带 */ }
  return { view: normalizeView(v), p: q.get('p') ?? '' };
}

const AV_PROJECT_KEY = 'audax.avProject';

interface Store {
  user: User;
  me: Identity;
  projects: Project[];
  /* REQ-051: users = 还能用的账号(指派下拉、团队负载、KPI 都用它,停用 / 已删除的不出现);
     allUsers = 全部(用户管理、历史记录认名字用) */
  users: User[];
  allUsers: User[];
  /* REQ-051: 当前生效的权限表(permissions.ts 的函数都读它);PD / BD 改完调 setPermTable */
  permTable: PermTable;
  setPermTable: (t: PermTable) => void;
  view: View;
  toast: string;
  setToast: (s: string) => void;
  setView: (v: View) => void;
  go: (name: View['name']) => void;
  /* AV-017:页面里的「‹ 后退」。平台里有上一页就退回去,没有就是 false */
  canBack: boolean;
  back: () => void;
  openProject: (pid: string) => void;
  /* 0922 变更单:下钻到按某个口径过滤的项目列表 */
  drillTo: (focus: Focus) => void;
  dispatch: (pid: string, action: ProjectAction) => Promise<boolean>;
  createProject: (input: Record<string, unknown>) => Promise<Project | null>;
  removeProject: (pid: string) => Promise<boolean>;
  refresh: () => Promise<void>;
  refreshUsers: () => Promise<void>;
  /* AV · LED: the drawing under 04 review survives switching views, and the
     reviewed values are handed to 05 exactly once. */
  ledProjectId: string;
  setLedProjectId: (id: string) => void;
  ledIngest: StoredDrawing | null;
  setLedIngest: (r: StoredDrawing | null) => void;
  ledHandoff: Handoff | null;
  setLedHandoff: (h: Handoff | null) => void;
  /* REQ-023: 用户改过的资料卡字段定义,按服务类型覆盖出厂默认 */
  recordFields: FieldOverrides;
  refreshRecordFields: () => Promise<void>;
  /* REQ-039:资料卡上数量 L/H、电源线、数据线由 LED 方案配置带过来。
     按项目 id 存一份,登记表跨项目一张表也只取这一次。 */
  avDerived: Record<string, AvDerived>;
  refreshAvDerived: () => Promise<void>;
  /* REQ-038: 积分规则的全部版本 + 「当下这一版」。按项目创建日取版本用 rulesFor。 */
  pointRuleVersions: PointRuleVersion[];
  pointRules: PointRules;
  rulesFor: (createdAt: number) => PointRules;
  refreshPointRules: () => Promise<void>;
  /* REQ-037: KPI 规则,和积分规则同一套版本机制 */
  kpiRuleVersions: KpiRuleVersion[];
  kpiRules: KpiRules;
  refreshKpiRules: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('store missing');
  return s;
};

export function StoreProvider({ user, permTable: initialPerm, children }: { user: User; permTable?: PermTable; children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [allUsers, setUsers] = useState<User[]>([]);
  const users = useMemo(() => allUsers.filter((u) => !u.disabled && !u.deletedAt), [allUsers]);
  /* REQ-051: 权限表。首屏由服务端页面带进来;之后随轮询刷新(PD / BD 改了,别人刷新即生效)。
     permissions.ts 是全局读的,所以表一变就把 source 指过去,再靠 permTable 进依赖让界面重画。 */
  const [permTable, setPermTableState] = useState<PermTable>(() => sanitizePermTable(initialPerm ?? defaultPermTable()));
  const permRef = useRef(permTable);
  permRef.current = permTable;
  setPermSource(() => permRef.current);
  const setPermTable = useCallback((t: PermTable) => setPermTableState(sanitizePermTable(t)), []);
  const refreshPerms = useCallback(async () => {
    const res = await fetch('/api/permissions').catch(() => null);
    if (!res?.ok) return;
    const t = (await res.json()).table as PermTable;
    setPermTableState((cur) => (JSON.stringify(cur) === JSON.stringify(t) ? cur : sanitizePermTable(t)));
  }, []);
  const [recordFields, setRecordFields] = useState<FieldOverrides>({});
  const [avDerived, setAvDerived] = useState<Record<string, AvDerived>>({});
  const [pointRuleVersions, setPointRuleVersions] = useState<PointRuleVersion[]>([]);
  const [kpiRuleVersions, setKpiRuleVersions] = useState<KpiRuleVersion[]>([]);
  const [view, setViewState] = useState<View>({ name: 'overview' });
  /* history.state.i:这是平台里第几页(0 = 进平台的第一页),「‹ 后退」据此判断 */
  const [histIdx, setHistIdx] = useState(0);
  const [toast, setToast] = useState('');
  const [ledProjectId, setLedProjectIdState] = useState('');
  const avProjectRef = useRef('');
  const viewRef = useRef<View>({ name: 'overview' });
  const idxRef = useRef(0);

  const setView = useCallback((raw: View) => {
    const v = normalizeView(raw);
    const url = viewToQuery(v, avProjectRef.current);
    viewRef.current = v;
    setViewState(v);
    try {
      if (url === location.search) return;
      idxRef.current += 1;
      history.pushState({ audax: 1, i: idxRef.current }, '', url);
      setHistIdx(idxRef.current);
    } catch { /* 沙箱里不让改历史:照常切页 */ }
  }, []);

  /* 换项目不算一次「翻页」:替换当前网址,不往历史里塞一条 */
  const setLedProjectId = useCallback((id: string) => {
    avProjectRef.current = id;
    setLedProjectIdState(id);
    try {
      if (id) localStorage.setItem(AV_PROJECT_KEY, id);
      history.replaceState(history.state, '', viewToQuery(viewRef.current, id));
    } catch { /* ignore */ }
  }, []);

  /* 首屏:从网址读回停在哪(刷新停在原处);没有就留在总览。项目取网址里的,
     没有就取「上次在做的 AV 项目」。挂载后再读 —— 服务端渲染时没有 location。 */
  useEffect(() => {
    let p = '';
    try { p = localStorage.getItem(AV_PROJECT_KEY) || ''; } catch { /* ignore */ }
    const parsed = queryToView(location.search);
    if (parsed?.p) p = parsed.p;
    if (p) { avProjectRef.current = p; setLedProjectIdState(p); }
    const v = parsed?.view ?? { name: 'overview' as const };
    viewRef.current = v;
    setViewState(v);
    const i = typeof history.state?.i === 'number' ? history.state.i : 0;
    idxRef.current = i;
    setHistIdx(i);
    try { history.replaceState({ audax: 1, i }, '', viewToQuery(v, p)); } catch { /* ignore */ }
    const onPop = () => {
      const got = queryToView(location.search);
      const nv = got?.view ?? { name: 'overview' as const };
      viewRef.current = nv;
      setViewState(nv);
      if (got?.p) { avProjectRef.current = got.p; setLedProjectIdState(got.p); }
      const ni = typeof history.state?.i === 'number' ? history.state.i : 0;
      idxRef.current = ni;
      setHistIdx(ni);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const [ledIngest, setLedIngest] = useState<StoredDrawing | null>(null);
  const [ledHandoff, setLedHandoff] = useState<Handoff | null>(null);
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
    if (res.status === 401) { location.href = '/login'; return; }
    if (res.ok) setUsers((await res.json()).users);
  }, []);

  /* REQ-023: 字段定义是全局的,和项目数据分开取一次即可 */
  const refreshRecordFields = useCallback(async () => {
    const res = await fetch('/api/record-fields');
    if (res.ok) setRecordFields(((await res.json()).overrides || {}) as FieldOverrides);
  }, []);

  /* REQ-039: LED 方案配置算出来的那几个数,一次取全 */
  const refreshAvDerived = useCallback(async () => {
    const res = await fetch('/api/av/derived');
    if (res.ok) setAvDerived(((await res.json()).derived || {}) as Record<string, AvDerived>);
  }, []);

  /* REQ-038: 积分规则同样是全局的,取一次即可 */
  const refreshPointRules = useCallback(async () => {
    const res = await fetch('/api/point-rules');
    if (res.ok) setPointRuleVersions(((await res.json()).versions || []) as PointRuleVersion[]);
  }, []);

  const refreshKpiRules = useCallback(async () => {
    const res = await fetch('/api/kpi-rules');
    if (res.ok) setKpiRuleVersions(((await res.json()).versions || []) as KpiRuleVersion[]);
  }, []);

  useEffect(() => {
    refresh();
    refreshUsers();
    refreshRecordFields();
    refreshAvDerived();
    refreshPointRules();
    refreshKpiRules();
    /* light polling so teammates' changes appear without manual reload */
    const t = setInterval(() => { refresh(); refreshPerms(); }, 30_000);
    return () => clearInterval(t);
  }, [refresh, refreshUsers, refreshRecordFields, refreshAvDerived, refreshPointRules, refreshKpiRules, refreshPerms]);

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
      /* REQ-051: 账号被停用 / 删除后会话立即失效 —— 下一次操作就回登录页 */
      if (res.status === 401) { location.href = '/login'; return false; }
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
    allUsers,
    permTable,
    setPermTable,
    view,
    toast,
    setToast,
    setView,
    go: (name) => setView({ name }),
    canBack: histIdx > 0,
    back: () => { try { history.back(); } catch { /* ignore */ } },
    openProject: (pid) => setView({ name: 'project', pid, tab: 'overview', pkg: 0 }),
    drillTo: (focus) => setView({ name: 'projects', focus }),
    dispatch,
    createProject,
    removeProject,
    refresh,
    refreshUsers,
    ledProjectId,
    setLedProjectId,
    ledIngest,
    setLedIngest,
    ledHandoff,
    setLedHandoff,
    recordFields,
    refreshRecordFields,
    avDerived,
    refreshAvDerived,
    pointRuleVersions,
    pointRules: rulesAt(pointRuleVersions, Date.now()),
    rulesFor: (createdAt: number) => (pointRuleVersions.length ? rulesAt(pointRuleVersions, createdAt) : DEFAULT_POINT_RULES),
    refreshPointRules,
    kpiRuleVersions,
    kpiRules: kpiRuleVersions.length ? kpiRulesAt(kpiRuleVersions, Date.now()) : DEFAULT_KPI_RULES,
    refreshKpiRules,
  }), [user, projects, users, allUsers, permTable, setPermTable, view, histIdx, setView, setLedProjectId, toast, dispatch, createProject, removeProject, refresh, refreshUsers, recordFields, refreshRecordFields, avDerived, refreshAvDerived, pointRuleVersions, refreshPointRules, kpiRuleVersions, refreshKpiRules, ledProjectId, ledIngest, ledHandoff]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

/* REQ-051: 历史记录里显示人名用这个 —— 已删除的人显示「X(已删除)」。
   只有名字对得上一个已删除的账号、又没有同名的在用账号时才标(改过名的老名字照原样显示)。 */
export function useWho(): (name: string | undefined | null) => string {
  const { allUsers } = useStore();
  const { t } = useLang();
  const tag = t('（已删除）', ' (deleted)');
  return useMemo(() => {
    const deleted = new Set(allUsers.filter((u) => u.deletedAt).map((u) => u.name));
    const live = new Set(allUsers.filter((u) => !u.deletedAt).map((u) => u.name));
    return (name) => (name && deleted.has(name) && !live.has(name) ? name + tag : name || '');
  }, [allUsers, tag]);
}
