/* ===== Isomorphic domain logic (used by both server and client) ===== */

import { GENERIC, TPL, diffPoints, STAGES, stageIdx, type Template } from './templates';
import type {
  ChecklistGroup,
  DirectorUpdate,
  Project,
  ScheduleRow,
  ServicePackage,
  Stage,
} from './types';

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function todayMid(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
export function fmtDate(d: Date | null | undefined): string {
  if (!d) return '—';
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return d.getDate().toString().padStart(2, '0') + '-' + m[d.getMonth()] + '-' + d.getFullYear();
}
export function parseISO(s: string | null | undefined): Date | null {
  return s ? new Date(s + 'T00:00:00') : null;
}
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export interface NewProjectInput {
  name: string;
  client: string;
  services: string[];
  owners?: string[];
  difficulty?: string;
  points?: number | null;
  start: string;
  delivery?: string;
  buffer?: number;
  mainContractor?: string;
  architect?: string;
  landscape?: string;
  interior?: string;
  creative?: string;
}

export function buildPackage(svc: string, start: string, tpl?: Template): ServicePackage {
  const t = tpl || TPL[svc] || GENERIC;
  return {
    svc,
    start: start || '',
    delivery: '',
    buffer: 0,
    owner: '',
    status: 'active',
    schedule: t.schedule.map((p) => ({
      id: newId(), no: p[0], phase: p[1], task: p[2], taskEn: p[3], owner: p[4], assignee: '',
      weeks: p[5], typical: p[6], gate: p[7], freeze: p[8], status: 'todo' as const,
      note: '', s: '', e: '',
    })),
    checklist: t.checklist.map((g) => ({
      group: g[0], groupEn: g[1], color: g[2],
      items: g[3].map((i) => ({ id: newId(), zh: i[0], en: i[1], status: 'pending' as const, date: '', remark: '', owner: '', shots: [] as string[] })),
    })),
  };
}

export function newProject(o: NewProjectInput, tplLookup?: (svc: string) => Template): Project {
  const services = o.services && o.services.length ? o.services : ['others'];
  const difficulty = (o.difficulty || 'medium') as Project['difficulty'];
  return {
    id: uid(),
    name: o.name,
    client: o.client,
    services,
    stage: 'presales',
    difficulty,
    points: o.points != null ? o.points : diffPoints(difficulty) * services.length,
    owners: o.owners || [],
    perm: [],
    start: o.start,
    delivery: o.delivery || '',
    buffer: o.buffer || 0,
    created: Date.now(),
    update: emptyUpdate(),
    parties: {
      mainContractor: o.mainContractor || '',
      architect: o.architect || '',
      landscape: o.landscape || '',
      interior: o.interior || '',
      creative: o.creative || '',
    },
    log: [],
    packages: services.map((svc) => buildPackage(svc, o.start || '', tplLookup ? tplLookup(svc) : undefined)),
  };
}

export function emptyUpdate(): DirectorUpdate {
  return {
    done: '', nextNodes: '', risks: '', needDirector: '', clientPending: '', budget: '',
    by: '', at: 0, dDecision: '', dStatus: 'pending', dDate: '', dBy: '',
  };
}

export function projPoints(p: Project): number {
  return p.points != null
    ? p.points
    : diffPoints(p.difficulty) * ((p.services && p.services.length) || 1);
}

let _idc = 0;
/* short unique id; stable once assigned & persisted (see migrate + backfillIds) */
export function newId(): string {
  _idc = (_idc + 1) % 1e6;
  return 'i' + Date.now().toString(36) + _idc.toString(36) + Math.random().toString(36).slice(2, 6);
}

export function migrate(p: any): Project {
  if (!p.packages) {
    p.packages = [{ svc: (p.services && p.services[0]) || 'others', schedule: p.schedule || [], checklist: p.checklist || [] }];
  }
  p.packages.forEach((pk: any) => {
    if (pk.start === undefined) pk.start = p.start || '';
    if (pk.delivery === undefined) pk.delivery = '';
    if (pk.buffer === undefined) pk.buffer = 0;
    if (pk.owner === undefined) pk.owner = '';
    if (pk.status === undefined) pk.status = 'active';
    (pk.schedule || []).forEach((r: any) => {
      if (r.assignee === undefined) r.assignee = '';
      if (!r.id) r.id = newId();
    });
    (pk.checklist || []).forEach((g: any) => (g.items || []).forEach((it: any) => {
      if (!it.id) it.id = newId();
      if (it.owner === undefined) it.owner = '';
      /* fold a legacy single shot into the shots[] array */
      if (!Array.isArray(it.shots)) it.shots = it.shot ? [it.shot] : [];
      if (it.shot) delete it.shot;
    }));
  });
  if (!p.update) p.update = {};
  (['done', 'nextNodes', 'risks', 'needDirector', 'clientPending', 'budget'] as const).forEach((f) => {
    if (p.update[f] === undefined) p.update[f] = '';
  });
  if (p.update.dStatus === undefined) {
    p.update.dDecision = ''; p.update.dStatus = 'pending'; p.update.dDate = ''; p.update.dBy = '';
  }
  if (p.points === undefined) p.points = diffPoints(p.difficulty) * ((p.services && p.services.length) || 1);
  if (!p.log) p.log = [];
  if (!p.perm) p.perm = [];
  return p as Project;
}

export const pkgStart = (p: Project, pk: ServicePackage) => (pk && pk.start) || p.start || '';

export interface PlanDate { start: Date; end: Date }

export function planDates(pkg: ServicePackage, start: string): (PlanDate | null)[] {
  const base = parseISO(start);
  const out: (PlanDate | null)[] = [];
  let cur: Date | null = base ? new Date(base) : null;
  for (const r of pkg.schedule) {
    const ovS = parseISO(r.s), ovE = parseISO(r.e);
    if ((!r.weeks || r.weeks <= 0) && !ovS && !ovE) { out.push(null); continue; }
    const s = ovS || cur;
    if (!s) { out.push(null); continue; }
    const e = ovE || (() => { const x = new Date(s); x.setDate(x.getDate() + Math.round((r.weeks || 0) * 7) - 1); return x; })();
    out.push({ start: s, end: e });
    cur = new Date(e);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export const statusPct = (s: string) => (s === 'done' ? 100 : s === 'wip' ? 50 : s === 'block' ? 25 : 0);

/* Project lifecycle stage is DERIVED from progress, not set manually */
export function projStage(p: Project): Stage {
  if (p.invoiced) return 'invoice';
  const sp = schedProgress(p);
  if (sp.total > 0 && sp.done === sp.total) return 'complete';
  let started = false;
  p.packages.forEach((pk) => pk.schedule.forEach((r) => { if (r.status === 'wip' || r.status === 'done') started = true; }));
  if (started) return 'progress';
  if ((p.owners || []).length > 0) return 'handover';
  return 'presales';
}
export const stageName = (p: Project) => STAGES[stageIdx(projStage(p))];

/* 3 macro stages: 0=准备 Prep · 1=制作 Production · 2=交付 Delivery */
export const MACRO: [string, string, string][] = [
  ['准备', 'Prep-work', '#8E7CC3'],
  ['制作', 'Production', '#2C6E8F'],
  ['交付', 'Delivery', '#3F7A4E'],
];
export function macroStage(r: ScheduleRow, i: number): number {
  const s = (r.phase + ' ' + r.task + ' ' + r.taskEn).toLowerCase();
  if (/交付|交接|移交|签收|handover|deliver|sign-?off|部署/.test(s)) return 2;
  if (i === 0 || /信息|需求|brief|简报|绘图确认|分镜|情绪|info|require|briefing|storyboard/.test(s)) return 0;
  return 1;
}

/* distribute each phase's dates to fit [start → delivery-buffer]; writes per-phase overrides */
export function fitWindow(pkg: ServicePackage, startISO: string, deliveryISO: string, buffer: number): boolean {
  const start = parseISO(startISO);
  if (!start) return false;
  const rows = pkg.schedule.map((r, i) => ({ r, i })).filter((x) => x.r.weeks > 0);
  const totalW = rows.reduce((a, x) => a + x.r.weeks, 0);
  if (totalW <= 0) return false;
  let totalDays = 0;
  const del = parseISO(deliveryISO);
  if (del) {
    const end = new Date(del);
    end.setDate(end.getDate() - (buffer || 0));
    totalDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  }
  if (!del || totalDays < rows.length) totalDays = Math.round(totalW * 7);
  let cursor = new Date(start);
  let acc = 0;
  rows.forEach((x, k) => {
    const share = x.r.weeks / totalW;
    let dur = Math.max(1, Math.round(totalDays * share));
    if (k === rows.length - 1) dur = Math.max(1, totalDays - acc);
    const s = new Date(cursor);
    const e = new Date(s);
    e.setDate(e.getDate() + dur - 1);
    x.r.s = isoDate(s);
    x.r.e = isoDate(e);
    acc += dur;
    cursor = new Date(e);
    cursor.setDate(cursor.getDate() + 1);
  });
  return true;
}

export function pkgProgress(pkg: ServicePackage) {
  const rows = pkg.schedule.filter((r) => r.weeks > 0 || r.s || r.e);
  const done = rows.filter((r) => r.status === 'done').length;
  return { done, total: rows.length, pct: rows.length ? Math.round((done / rows.length) * 100) : 0 };
}
export function schedProgress(p: Project) {
  let done = 0, total = 0;
  p.packages.forEach((pk) => { const pr = pkgProgress(pk); done += pr.done; total += pr.total; });
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}
export function pkgInfo(pkg: ServicePackage) {
  let c = 0, t = 0;
  pkg.checklist.forEach((g) => g.items.forEach((i) => { if (i.status === 'na') return; t++; if (i.status === 'confirmed') c++; }));
  return { done: c, total: t, pct: t ? Math.round((c / t) * 100) : 0 };
}
export function infoProgress(p: Project) {
  let c = 0, t = 0;
  p.packages.forEach((pk) => { const ip = pkgInfo(pk); c += ip.done; t += ip.total; });
  return { done: c, total: t, pct: t ? Math.round((c / t) * 100) : 0 };
}

export interface OverdueItem {
  p: Project;
  pkg: ServicePackage;
  pi: number;
  row: ScheduleRow;
  idx: number;
  due: Date;
  days: number;
}
/* ── risk keys & dismissal (A5) ──
   A risk is derived from data, so we identify each by a stable key and let the
   team mark it 已处理/忽略 — dismissed risks drop out of every risk surface
   (overdue list, health 预警, KPIs, bell) until restored or the row moves. */
export type RiskKind = 'od' | 'bl' | 'fz';
export const riskKey = (kind: RiskKind, pi: number, idx: number) => `${kind}:${pi}:${idx}`;
const dismissedSet = (p: Project) => new Set(p.dismissedRisks || []);
export const isRiskDismissed = (p: Project, key: string) => (p.dismissedRisks || []).includes(key);

export function overdueItems(p: Project): OverdueItem[] {
  const t = todayMid();
  const dm = dismissedSet(p);
  const out: OverdueItem[] = [];
  p.packages.forEach((pk, pi) => {
    const pd = planDates(pk, pkgStart(p, pk));
    pk.schedule.forEach((r, i) => {
      const d = pd[i];
      if (r.status !== 'done' && d && d.end < t && !dm.has(riskKey('od', pi, i))) {
        out.push({ p, pkg: pk, pi, row: r, idx: i, due: d.end, days: Math.round((t.getTime() - d.end.getTime()) / 86400000) });
      }
    });
  });
  return out;
}
export function allOverdue(list: Project[]): OverdueItem[] {
  let a: OverdueItem[] = [];
  list.forEach((p) => { a = a.concat(overdueItems(p)); });
  return a.sort((x, y) => y.days - x.days);
}

/* Whether a project is "mine" — used to scope risk/alert surfaces so each
   person sees only their own; PD/BD/Sales/Viewer see everything. */
export function isMyProject(p: Project, me: { name: string; role: string }): boolean {
  if (me.role === 'pm' || me.role === 'member') {
    if ((p.owners || []).includes(me.name)) return true;
    return p.packages.some((pk) => pk.schedule.some((r) => r.assignee === me.name));
  }
  return true; // director / bd / sales / viewer
}

export type Health = 'ok' | 'risk' | 'over';
export function projectHealth(p: Project): Health {
  if (overdueItems(p).length) return 'over';
  const t = todayMid();
  const soon = new Date(t);
  soon.setDate(soon.getDate() + 7);
  const dm = dismissedSet(p);
  let risk = false;
  p.packages.forEach((pk, pi) => {
    const pd = planDates(pk, pkgStart(p, pk));
    pk.schedule.forEach((r, i) => {
      if (r.status === 'block' && !dm.has(riskKey('bl', pi, i))) risk = true;
      const d = pd[i];
      if (r.freeze && r.status !== 'done' && d && d.start <= soon && !dm.has(riskKey('fz', pi, i))) risk = true;
    });
  });
  return risk ? 'risk' : 'ok';
}

export function nextFreeze(p: Project) {
  const cands: { row: ScheduleRow; date: Date | null; svc: string }[] = [];
  p.packages.forEach((pk) => {
    const pd = planDates(pk, pkgStart(p, pk));
    pk.schedule.forEach((r, i) => {
      if (r.freeze && r.status !== 'done') cands.push({ row: r, date: pd[i] ? pd[i]!.start : null, svc: pk.svc });
    });
  });
  cands.sort((a, b) => {
    if (a.date && b.date) return a.date.getTime() - b.date.getTime();
    if (a.date) return -1;
    if (b.date) return 1;
    return 0;
  });
  return cands[0] || null;
}

export function plannedFinish(p: Project): Date | null {
  let fin: Date | null = null;
  p.packages.forEach((pk) => {
    const pd = planDates(pk, pkgStart(p, pk));
    for (let i = pd.length - 1; i >= 0; i--) {
      if (pd[i]) {
        if (!fin || pd[i]!.end > fin) fin = pd[i]!.end;
        break;
      }
    }
  });
  return fin;
}
export function totalDays(p: Project): number {
  let mx = 0;
  p.packages.forEach((pk) => {
    let d = 0;
    pk.schedule.forEach((r) => { d += Math.round((r.weeks || 0) * 7); });
    if (d > mx) mx = d;
  });
  return mx;
}
/* days of slack (positive) or overrun (negative) between planned finish(+buffer) and required delivery */
export function deliverySlack(p: Project): number | null {
  const del = parseISO(p.delivery), fin = plannedFinish(p);
  if (!del || !fin) return null;
  const finB = new Date(fin);
  finB.setDate(finB.getDate() + (p.buffer || 0));
  return Math.round((del.getTime() - finB.getTime()) / 86400000);
}

export function staleInfo(u: DirectorUpdate | undefined, lang: 'zh' | 'en' = 'zh') {
  const en = lang === 'en';
  if (!u || !u.at) return { cls: 'stale-bad', txt: en ? 'never updated' : '未更新' };
  const days = Math.floor((Date.now() - u.at) / 86400000);
  const staleTxt = en ? `stale ${days}d` : `${days}天未更新`;
  if (days > 14) return { cls: 'stale-bad', txt: staleTxt };
  if (days > 7) return { cls: 'stale-warn', txt: staleTxt };
  return { cls: 'stale-ok', txt: days <= 0 ? (en ? 'updated today' : '今日更新') : en ? `${days}d ago` : `${days}天前` };
}
