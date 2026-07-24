/* ===== Server-side project mutations =====
   Every mutation from the client arrives as a typed action; permission is
   checked here against the authenticated user (never trusted from client). */

import type { Identity } from '@/lib/permissions';
import {
  canAssign, canCommercial, canDecide, canEdit, canRowEdit,
} from '@/lib/permissions';
import { buildPackage, fitWindow, newId, parseISO, isoDate, totalDays } from '@/lib/project';
import { SVC, type Template } from '@/lib/templates';
import type { ChecklistStatus, Project, ScheduleStatus } from '@/lib/types';

/* Optional context the route supplies so we can rebuild from edited templates
   without importing the DB layer here (keeps this file client-safe for types). */
export interface ActionCtx {
  tplForSvc?: (svc: string) => Template;
}

export type ProjectAction =
  | { type: 'toggleDone'; pkg: number; idx: number }
  | { type: 'cycleStatus'; pkg: number; idx: number }
  | { type: 'setRowStatus'; pkg: number; idx: number; status: ScheduleStatus }
  | { type: 'editSched'; pkg: number; idx: number; field: 'task' | 'taskEn' | 'owner' | 'assignee' | 'note' | 's' | 'e' | 'phase' | 'delayNote'; value: string }
  | { type: 'editSchedNum'; pkg: number; idx: number; field: 'weeks'; value: number }
  | { type: 'addRow'; pkg: number }
  | { type: 'removeRow'; pkg: number; idx: number }
  | { type: 'moveRow'; pkg: number; idx: number; dir: -1 | 1 }
  | { type: 'setClStatus'; pkg: number; gi: number; ii: number; value: ChecklistStatus }
  | { type: 'editCl'; pkg: number; gi: number; ii: number; field: 'date' | 'remark' | 'zh' | 'en' | 'owner'; value: string }
  | { type: 'toggleHighlight'; pkg: number; gi: number; ii: number }
  | { type: 'addItem'; pkg: number; gi: number; items?: { zh: string; en: string }[] }
  | { type: 'removeItem'; pkg: number; gi: number; ii: number }
  | { type: 'moveItem'; pkg: number; gi: number; ii: number; dir: -1 | 1 }
  | { type: 'addGroup'; pkg: number; name: string }
  | { type: 'resetChecklist'; pkg: number }
  | { type: 'attachShot'; pkg: number; gi: number; ii: number; data: string }
  | { type: 'removeShot'; pkg: number; gi: number; ii: number; shotIdx?: number }
  | { type: 'setPkgField'; pkg: number; field: 'start' | 'delivery' | 'owner' | 'resourceLinks'; value: string }
  | { type: 'setPkgBuffer'; pkg: number; value: number }
  | { type: 'reversePkg'; pkg: number }
  | { type: 'reverseSchedule' }
  | { type: 'setDelivery'; value: string }
  | { type: 'setBuffer'; value: number }
  | { type: 'setDiff'; value: string }
  | { type: 'setPoints'; value: number }
  | { type: 'addOwner'; name: string }
  | { type: 'removeOwner'; name: string }
  | { type: 'transferProject'; from: string; to: string; includeTasks: boolean }
  | { type: 'setArchived'; value: boolean }
  | { type: 'dismissRisk'; key: string }
  | { type: 'restoreRisk'; key: string }
  | { type: 'editUpdate'; field: 'done' | 'nextNodes' | 'risks' | 'needDirector' | 'clientPending' | 'budget'; value: string }
  | { type: 'setDecision'; field: 'dDecision' | 'dStatus'; value: string }
  | { type: 'toggleInvoiced' };

export class PermissionError extends Error {}
export class ValidationError extends Error {}

/* Replace `from` with `to` in a project's ownership (and optionally task
   assignments and per-package owners). Returns true if anything changed. */
export function transferInProject(
  p: Project, by: string, from: string, to: string, includeTasks: boolean,
): boolean {
  let changed = false;
  if ((p.owners || []).includes(from)) {
    p.owners = p.owners.filter((n) => n !== from);
    if (!p.owners.includes(to)) p.owners.push(to);
    changed = true;
  }
  p.packages.forEach((pk) => {
    if (pk.owner === from) { pk.owner = to; changed = true; }
    if (includeTasks) {
      pk.schedule.forEach((r) => {
        if (r.assignee === from) { r.assignee = to; changed = true; }
      });
    }
  });
  if (changed) logIt(p, by, `项目转交 Handover: ${from} → ${to}${includeTasks ? '(含任务指派)' : ''}`);
  return changed;
}

const svcName = (k: string) => SVC[k]?.label || k;

function logIt(p: Project, by: string, text: string) {
  p.log = p.log || [];
  p.log.unshift({ at: Date.now(), by, text });
  if (p.log.length > 200) p.log.length = 200;
}

function getRow(p: Project, pkg: number, idx: number) {
  const pk = p.packages[pkg];
  if (!pk) throw new ValidationError('无效的服务包');
  const r = pk.schedule[idx];
  if (!r) throw new ValidationError('无效的排期行');
  return { pk, r };
}
function getItem(p: Project, pkg: number, gi: number, ii: number) {
  const pk = p.packages[pkg];
  if (!pk) throw new ValidationError('无效的服务包');
  const g = pk.checklist[gi];
  if (!g) throw new ValidationError('无效的清单栏目');
  const it = g.items[ii];
  if (!it) throw new ValidationError('无效的清单项');
  return { pk, g, it };
}

/* Mutates p in place. Throws PermissionError / ValidationError. */
export function applyAction(u: Identity, p: Project, a: ProjectAction, ctx: ActionCtx = {}): void {
  const { tplForSvc } = ctx;
  switch (a.type) {
    case 'toggleDone': {
      const { pk, r } = getRow(p, a.pkg, a.idx);
      if (!canRowEdit(u, p, r)) throw new PermissionError('无编辑权限');
      const was = r.status;
      r.status = r.status === 'done' ? 'todo' : 'done';
      logIt(p, u.name, `${svcName(pk.svc)}·${r.task}: ${was}→${r.status}`);
      break;
    }
    case 'cycleStatus': {
      const { r } = getRow(p, a.pkg, a.idx);
      if (!canRowEdit(u, p, r)) throw new PermissionError('无编辑权限');
      const o: ScheduleStatus[] = ['todo', 'wip', 'done', 'block'];
      const was = r.status;
      r.status = o[(o.indexOf(r.status) + 1) % o.length];
      logIt(p, u.name, `${r.task}: ${was}→${r.status}`);
      break;
    }
    case 'setRowStatus': {
      const { r } = getRow(p, a.pkg, a.idx);
      if (!canRowEdit(u, p, r)) throw new PermissionError('无编辑权限');
      const was = r.status;
      r.status = a.status;
      logIt(p, u.name, `${r.task}: ${was}→${r.status}`);
      break;
    }
    case 'editSched': {
      const { r } = getRow(p, a.pkg, a.idx);
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      (r as any)[a.field] = a.value;
      if (a.field === 's' || a.field === 'e') logIt(p, u.name, `${r.task} 日期(${a.field})=${a.value || '—'}`);
      break;
    }
    case 'editSchedNum': {
      const { r } = getRow(p, a.pkg, a.idx);
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      r.weeks = Number(a.value) || 0;
      break;
    }
    case 'addRow': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const pk = p.packages[a.pkg];
      if (!pk) throw new ValidationError('无效的服务包');
      pk.schedule.push({
        no: String(pk.schedule.length), phase: '新阶段', task: '新阶段', taskEn: 'New phase',
        owner: '', assignee: '', weeks: 1, typical: '—', gate: '', freeze: false,
        status: 'todo', note: '', s: '', e: '',
      });
      logIt(p, u.name, '新增阶段');
      break;
    }
    case 'removeRow': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const { pk, r } = getRow(p, a.pkg, a.idx);
      logIt(p, u.name, `删除阶段: ${r.task}`);
      pk.schedule.splice(a.idx, 1);
      break;
    }
    case 'moveRow': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const { pk } = getRow(p, a.pkg, a.idx);
      const j = a.idx + (a.dir === 1 ? 1 : -1);
      if (j < 0 || j >= pk.schedule.length) break; // at an edge, no-op
      const arr = pk.schedule;
      [arr[a.idx], arr[j]] = [arr[j], arr[a.idx]];
      logIt(p, u.name, `调整阶段顺序 Reorder phase`);
      break;
    }
    case 'setClStatus': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const { it } = getItem(p, a.pkg, a.gi, a.ii);
      const was = it.status;
      it.status = a.value;
      it.updatedAt = Date.now();
      logIt(p, u.name, `清单「${it.zh}」: ${was}→${a.value}`);
      break;
    }
    case 'editCl': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const { it } = getItem(p, a.pkg, a.gi, a.ii);
      (it as any)[a.field] = a.value;
      it.updatedAt = Date.now();
      break;
    }
    case 'toggleHighlight': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const { it } = getItem(p, a.pkg, a.gi, a.ii);
      it.highlight = !it.highlight;
      it.updatedAt = Date.now();
      break;
    }
    case 'addItem': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const pk = p.packages[a.pkg];
      const g = pk?.checklist[a.gi];
      if (!g) throw new ValidationError('无效的清单栏目');
      /* B3: add one or more preset items chosen from the default library,
         or a single blank item when none are supplied */
      const toAdd = (a.items && a.items.length ? a.items : [{ zh: '新信息项', en: 'New item' }])
        .map((x) => ({ zh: String(x.zh || '').slice(0, 200), en: String(x.en || '').slice(0, 200) }))
        .filter((x) => x.zh || x.en);
      if (!toAdd.length) toAdd.push({ zh: '新信息项', en: 'New item' });
      for (const x of toAdd) g.items.push({ id: newId(), zh: x.zh, en: x.en, status: 'pending', date: '', remark: '', owner: '', shots: [] });
      break;
    }
    case 'removeItem': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const { g } = getItem(p, a.pkg, a.gi, a.ii);
      g.items.splice(a.ii, 1);
      break;
    }
    case 'moveItem': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const { g } = getItem(p, a.pkg, a.gi, a.ii);
      const j = a.ii + (a.dir === 1 ? 1 : -1);
      if (j < 0 || j >= g.items.length) break; // at an edge, no-op
      [g.items[a.ii], g.items[j]] = [g.items[j], g.items[a.ii]];
      break;
    }
    case 'addGroup': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const pk = p.packages[a.pkg];
      if (!pk) throw new ValidationError('无效的服务包');
      pk.checklist.push({
        group: a.name || '特殊需求', groupEn: 'Custom', color: '#607080',
        items: [{ id: newId(), zh: '新信息项', en: 'New item', status: 'pending', date: '', remark: '', owner: '', shots: [] }],
      });
      break;
    }
    case 'resetChecklist': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const pk = p.packages[a.pkg];
      if (!pk) throw new ValidationError('无效的服务包');
      /* rebuild this package's checklist from the effective template for its
         service, discarding edits — status/dates/remarks are reset too */
      const fresh = buildPackage(pk.svc, pk.start, tplForSvc?.(pk.svc));
      pk.checklist = fresh.checklist;
      logIt(p, u.name, `恢复默认信息清单 Reset checklist to default`);
      break;
    }
    case 'attachShot': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(a.data)) throw new ValidationError('无效的图片数据');
      if (a.data.length > 800_000) throw new ValidationError('图片过大,请压缩后上传');
      const { it } = getItem(p, a.pkg, a.gi, a.ii);
      if (!Array.isArray(it.shots)) it.shots = it.shot ? [it.shot] : [];
      if (it.shots.length >= 8) throw new ValidationError('每项最多 8 张图片');
      it.shots.push(a.data);
      it.shot = undefined;
      it.updatedAt = Date.now();
      if (!it.date) it.date = isoDate(new Date());
      if (it.status === 'pending') it.status = 'received';
      logIt(p, u.name, `上传资料截图: ${it.zh}`);
      break;
    }
    case 'removeShot': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const { it } = getItem(p, a.pkg, a.gi, a.ii);
      if (!Array.isArray(it.shots)) it.shots = it.shot ? [it.shot] : [];
      if (typeof a.shotIdx === 'number' && a.shotIdx >= 0 && a.shotIdx < it.shots.length) it.shots.splice(a.shotIdx, 1);
      else it.shots = []; // no index → clear all (back-compat)
      it.shot = undefined;
      it.updatedAt = Date.now();
      break;
    }
    case 'setPkgField': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const pk = p.packages[a.pkg];
      if (!pk) throw new ValidationError('无效的服务包');
      pk[a.field] = a.value;
      logIt(p, u.name, `${svcName(pk.svc)} ${a.field}=${a.value || '—'}`);
      break;
    }
    case 'setPkgBuffer': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const pk = p.packages[a.pkg];
      if (!pk) throw new ValidationError('无效的服务包');
      pk.buffer = Number(a.value) || 0;
      logIt(p, u.name, `${svcName(pk.svc)} buffer=${pk.buffer}`);
      break;
    }
    case 'reversePkg': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const pk = p.packages[a.pkg];
      if (!pk) throw new ValidationError('无效的服务包');
      const del = parseISO(pk.delivery);
      if (!del) throw new ValidationError('请先填该服务「交付日」');
      let startISO = pk.start || p.start;
      if (!startISO) {
        let d = 0;
        pk.schedule.forEach((r) => { d += Math.round((r.weeks || 0) * 7); });
        const ns = new Date(del);
        ns.setDate(ns.getDate() - d - (pk.buffer || 0));
        startISO = isoDate(ns);
      }
      pk.start = startISO;
      fitWindow(pk, startISO, pk.delivery, pk.buffer || 0);
      logIt(p, u.name, `${svcName(pk.svc)} 倒排:按起始+交付自动生成各阶段日期`);
      break;
    }
    case 'reverseSchedule': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const del = parseISO(p.delivery);
      if (!del) throw new ValidationError('请先填交付日 Delivery date');
      const total = totalDays(p) + (p.buffer || 0);
      const ns = new Date(del);
      ns.setDate(ns.getDate() - total);
      p.start = isoDate(ns);
      p.packages.forEach((pk) => {
        if (!pk.start) pk.start = p.start;
        if (!pk.delivery) pk.delivery = p.delivery;
        fitWindow(pk, pk.start || p.start, pk.delivery || p.delivery, pk.buffer || p.buffer || 0);
      });
      logIt(p, u.name, '按交付日倒排,各服务阶段日期自动生成');
      break;
    }
    case 'setDelivery': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      p.delivery = a.value;
      break;
    }
    case 'setBuffer': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      p.buffer = Number(a.value) || 0;
      break;
    }
    case 'setDiff': {
      if (!canAssign(u, p)) throw new PermissionError('仅 PD/BD 可制定难度/积分');
      p.difficulty = a.value as Project['difficulty'];
      break;
    }
    case 'setPoints': {
      if (!canAssign(u, p)) throw new PermissionError('仅 PD/BD 可制定积分');
      p.points = Number(a.value) || 0;
      logIt(p, u.name, `积分设为 ${p.points}`);
      break;
    }
    case 'addOwner': {
      if (!canAssign(u, p)) throw new PermissionError('仅 PD/BD 可指派 PM');
      const nm = (a.name || '').trim();
      if (!nm) throw new ValidationError('名字不能为空');
      p.owners = p.owners || [];
      if (!p.owners.includes(nm)) p.owners.push(nm);
      logIt(p, u.name, `指派 PM: ${nm}`);
      break;
    }
    case 'removeOwner': {
      if (!canAssign(u, p)) throw new PermissionError('仅 PD/BD 可调整人员');
      p.owners = (p.owners || []).filter((n) => n !== a.name);
      break;
    }
    case 'transferProject': {
      if (!canAssign(u, p)) throw new PermissionError('仅 PD/BD 可转交项目');
      const from = (a.from || '').trim(), to = (a.to || '').trim();
      if (!from || !to) throw new ValidationError('转出人与接收人不能为空');
      if (from === to) throw new ValidationError('转出人与接收人相同');
      transferInProject(p, u.name, from, to, a.includeTasks);
      break;
    }
    case 'editUpdate': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      p.update = p.update || ({} as Project['update']);
      p.update[a.field] = a.value;
      p.update.by = u.name;
      p.update.at = Date.now();
      break;
    }
    case 'setDecision': {
      if (!canDecide(u)) throw new PermissionError('仅 PD/BD 可回批决策');
      p.update = p.update || ({} as Project['update']);
      if (a.field === 'dStatus') {
        p.update.dStatus = a.value as Project['update']['dStatus'];
        logIt(p, u.name, `Director 决定: ${a.value}`);
      } else {
        p.update.dDecision = a.value;
      }
      p.update.dBy = u.name;
      p.update.dDate = isoDate(new Date());
      break;
    }
    case 'toggleInvoiced': {
      if (!canCommercial(u, p)) throw new PermissionError('仅 PD/BD/销售可标记开票收尾');
      p.invoiced = !p.invoiced;
      logIt(p, u.name, p.invoiced ? '标记开票/收尾' : '撤销开票');
      break;
    }
    case 'setArchived': {
      if (!canAssign(u, p)) throw new PermissionError('仅 PD/BD 可归档项目');
      p.archived = !!a.value;
      logIt(p, u.name, p.archived ? '归档项目 Archived' : '取消归档 Unarchived');
      break;
    }
    case 'dismissRisk': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      if (!a.key) throw new ValidationError('无效的风险标识');
      p.dismissedRisks = p.dismissedRisks || [];
      if (!p.dismissedRisks.includes(a.key)) {
        p.dismissedRisks.push(a.key);
        logIt(p, u.name, `标记风险已处理 Risk dismissed: ${a.key}`);
      }
      break;
    }
    case 'restoreRisk': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      p.dismissedRisks = (p.dismissedRisks || []).filter((k) => k !== a.key);
      logIt(p, u.name, `恢复风险 Risk restored: ${a.key}`);
      break;
    }
    default:
      throw new ValidationError('未知操作');
  }
}
