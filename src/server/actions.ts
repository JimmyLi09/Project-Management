/* ===== Server-side project mutations =====
   Every mutation from the client arrives as a typed action; permission is
   checked here against the authenticated user (never trusted from client). */

import type { Identity } from '@/lib/permissions';
import {
  canAssign, canCommercial, canDecide, canEdit, canEditFinance, canRowEdit, isFull, canDelete } from '@/lib/permissions';
import { buildPackage, deriveStatuses, fitWindow, newId, parseISO, isoDate, totalDays } from '@/lib/project';
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
  | { type: 'reorderRow'; pkg: number; from: number; to: number }
  | { type: 'setSchedStyle'; value: 'classic' | 'weeks' | 'dates' }
  | { type: 'addSpecialRow'; pkg: number; kind: 'milestone' | 'holiday'; text: string; date: string }
  | { type: 'setClStatus'; pkg: number; gi: number; ii: number; value: ChecklistStatus }
  | { type: 'editCl'; pkg: number; gi: number; ii: number; field: 'date' | 'remark' | 'zh' | 'en' | 'owner' | 'received'; value: string }
  | { type: 'renameGroup'; pkg: number; gi: number; name: string; nameEn?: string }
  | { type: 'removeGroup'; pkg: number; gi: number }
  | { type: 'setNoCategories'; pkg: number; value: boolean }
  | { type: 'toggleHighlight'; pkg: number; gi: number; ii: number }
  | { type: 'addItem'; pkg: number; gi: number; items?: { zh: string; en: string }[] }
  | { type: 'removeItem'; pkg: number; gi: number; ii: number }
  | { type: 'moveItem'; pkg: number; gi: number; ii: number; dir: -1 | 1 }
  | { type: 'reorderItem'; pkg: number; gi: number; from: number; to: number }
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
  | { type: 'submitHandover'; salesBrief: string; assignedPmId: string }
  | { type: 'acceptHandover' }
  | { type: 'editHandover'; salesBrief: string; assignedPmId: string }
  | { type: 'submitCompletion'; summary: string; links: string }
  | { type: 'decideCompletion'; decision: 'approved' | 'rejected' | 'changes_requested'; note: string }
  | { type: 'salesVerify'; scopeMatches: boolean; jobOrderUpdated: boolean; finalInvoiceAllowed: boolean }
  | { type: 'raiseVariation'; affectsQuote: boolean; note: string }
  | { type: 'editFinance'; field: 'invoiceRef' | 'issuedDate' | 'dueDate' | 'financeNote'; value: string }
  | { type: 'setInvoiceStatus'; value: 'pending_finance' | 'issued' | 'cancelled'; reason: string }
  | { type: 'setPaymentStatus'; value: 'pending' | 'partial' | 'received' | 'overdue' }
  | { type: 'setPaymentRisk'; depositRequired: boolean; depositStatus: 'none' | 'pending' | 'received'; level: 'none' | 'watch' | 'high' }
  | { type: 'addContact' }
  | { type: 'editContact'; idx: number; field: 'role' | 'company' | 'person' | 'phone' | 'email'; value: string }
  | { type: 'removeContact'; idx: number }
  | { type: 'addScopeItem'; pkg: number }
  | { type: 'editScopeItem'; pkg: number; idx: number; field: 'item' | 'qty' | 'note'; value: string }
  | { type: 'removeScopeItem'; pkg: number; idx: number }
  | { type: 'setArchived'; value: boolean }
  | { type: 'dismissRisk'; key: string }
  | { type: 'restoreRisk'; key: string }
  | { type: 'editUpdate'; field: 'done' | 'nextNodes' | 'risks' | 'needDirector' | 'clientPending' | 'budget'; value: string }
  | { type: 'setDecision'; field: 'dDecision' | 'dStatus'; value: string }
  | { type: 'setRecord'; pkg: number; patch: Record<string, string> }
  | { type: 'addServicePackage'; svc: string; patch: Record<string, string>; asNew?: boolean; label?: string }
  | { type: 'removeServicePackage'; pkg: number }
  | { type: 'addCustomNode'; pkg: number; name: string; date: string; owner: string; atIdx?: number }
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
    case 'reorderRow': {
      // REQ-002: drag-to-reorder — move a phase from one index to another
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const pk = p.packages[a.pkg];
      if (!pk) throw new ValidationError('无效的服务包');
      const n = pk.schedule.length;
      if (a.from < 0 || a.from >= n || a.to < 0 || a.to >= n || a.from === a.to) break;
      const arr = pk.schedule;
      const [moved] = arr.splice(a.from, 1);
      arr.splice(a.to, 0, moved);
      logIt(p, u.name, `拖动调整阶段顺序 Reorder: ${moved.task}`);
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
      const was = (it as any)[a.field];
      (it as any)[a.field] = a.value;
      /* REQ-013: filling in "received content / file name" auto-advances the
         item to Received and stamps today's date — but only from Pending and
         only when the field was previously empty, so a manual Status/Date
         always wins and editing a remark never changes the status. */
      if (a.field === 'received' && !String(was || '').trim() && String(a.value || '').trim()) {
        if (it.status === 'pending') it.status = 'received';
        if (!it.date) it.date = isoDate(new Date());
      }
      it.updatedAt = Date.now();
      break;
    }
    case 'renameGroup': {
      // REQ-014: rename a checklist category
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const pk = p.packages[a.pkg];
      if (!pk || !pk.checklist[a.gi]) throw new ValidationError('无效的分类');
      const g = pk.checklist[a.gi];
      const name = String(a.name || '').slice(0, 120).trim();
      if (!name) throw new ValidationError('分类名不能为空');
      const old = g.group;
      g.group = name;
      if (a.nameEn !== undefined) g.groupEn = String(a.nameEn).slice(0, 120);
      logIt(p, u.name, `重命名清单分类: ${old} → ${name}`);
      break;
    }
    case 'removeGroup': {
      // REQ-014: delete a checklist category (with its items)
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const pk = p.packages[a.pkg];
      if (!pk || !pk.checklist[a.gi]) throw new ValidationError('无效的分类');
      const [g] = pk.checklist.splice(a.gi, 1);
      logIt(p, u.name, `删除清单分类: ${g.group}`);
      break;
    }
    case 'setNoCategories': {
      // REQ-014: flat mode — no fixed categories for this package
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const pk = p.packages[a.pkg];
      if (!pk) throw new ValidationError('无效的服务包');
      pk.noCategories = !!a.value;
      logIt(p, u.name, pk.noCategories ? '清单切换为「无固定分类」' : '清单恢复分类模式');
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
    case 'reorderItem': {
      /* REQ-012: drag-to-reorder checklist items inside a category. The array
         order IS the persisted order (same as the schedule), so there's no
         second `order` field to drift out of sync. */
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const pk = p.packages[a.pkg];
      const g = pk && pk.checklist[a.gi];
      if (!g) throw new ValidationError('无效的分类');
      const n = g.items.length;
      if (a.from < 0 || a.from >= n || a.to < 0 || a.to >= n || a.from === a.to) break;
      const [moved] = g.items.splice(a.from, 1);
      g.items.splice(a.to, 0, moved);
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
    /* ===== v2.2 Version 1A · S2 — Sales → PM handover ===== */
    case 'submitHandover': {
      if (!canCommercial(u, p)) throw new PermissionError('仅 Sales / PD / BD 可提交交接');
      const pm = String(a.assignedPmId || '').trim();
      if (!pm) throw new ValidationError('请指定接单 PM');
      const h = p.handover!;
      if (h.status === 'accepted') throw new ValidationError('该项目已被 PM 接单,无法重复交接');
      h.status = 'submitted';
      h.salesBrief = String(a.salesBrief || '');
      h.assignedPmId = pm;
      h.submittedBy = u.name;
      h.submittedAt = Date.now();
      /* make sure the assigned PM owns the project so it flows to My Tasks */
      if (!(p.owners || []).includes(pm)) p.owners = [...(p.owners || []), pm];
      logIt(p, u.name, `提交交接给 PM「${pm}」Submit handover`);
      break;
    }
    /* REQ-022: PM 接收之前,Sales 还能改简报或改派 PM。
       这刻意不走 submitHandover —— 后者在 workflow_actions 里有
       (project, submit_handover, workflowVersion) 的唯一键,一个版本只允许提交
       一次(防重复提交的 P0 保障)。改内容是另一回事,不该消耗那把钥匙。
       submittedAt 保持不变:SLA 的计时从首次提交那一刻起算,改内容不重置。 */
    case 'editHandover': {
      if (!canCommercial(u, p)) throw new PermissionError('仅 Sales / PD / BD 可修改交接');
      const h = p.handover!;
      if (h.status !== 'submitted') {
        throw new ValidationError(h.status === 'accepted' ? 'PM 已接单,交接不可再改' : '尚未发起交接');
      }
      const pm = String(a.assignedPmId || '').trim();
      if (!pm) throw new ValidationError('请指定接单 PM');
      const was = h.assignedPmId;
      h.salesBrief = String(a.salesBrief || '');
      h.assignedPmId = pm;
      /* 新 PM 要能在「我的待办」里看到项目;原 PM 留在成员里不动 ——
         他可能是 PD 另外指派的,这里不该替人做减法。 */
      if (!(p.owners || []).includes(pm)) p.owners = [...(p.owners || []), pm];
      logIt(p, u.name, was === pm ? '修改交接简报 Edit handover brief' : `交接改派 PM「${was}」→「${pm}」`);
      break;
    }
    case 'acceptHandover': {
      const h = p.handover!;
      if (h.status !== 'submitted') throw new ValidationError('当前没有待接收的交接');
      const isAssignedPm = u.name === h.assignedPmId;
      if (!isAssignedPm && !isFull(u)) throw new PermissionError('仅被指派的 PM(或 PD/BD)可接单');
      h.status = 'accepted';
      h.briefingAt = Date.now();
      logIt(p, u.name, `接受交接,进入生产 Accept handover`);
      break;
    }
    /* ===== S3 — PM completion package + PD approval ===== */
    case 'submitCompletion': {
      if (!canEdit(u, p)) throw new PermissionError('仅项目 PM(或 PD/BD)可提交完成包');
      const cr = p.completionReview!;
      if (cr.status === 'submitted') throw new ValidationError('完成包已提交,等待 PD 审批');
      if (cr.approval?.status === 'approved') throw new ValidationError('完成包已批准');
      cr.status = 'submitted';
      cr.summary = String(a.summary || '');
      cr.links = String(a.links || '');
      cr.submittedBy = u.name;
      cr.submittedAt = Date.now();
      cr.approval = { pdId: '', status: 'pending', note: '', decidedAt: 0 }; // fresh review
      logIt(p, u.name, `提交完成包 Submit completion package`);
      break;
    }
    case 'decideCompletion': {
      if (!canDecide(u)) throw new PermissionError('仅 PD/BD 可审批完成包');
      const cr = p.completionReview!;
      if (cr.status !== 'submitted') throw new ValidationError('当前没有待审批的完成包');
      cr.approval.pdId = u.name;
      cr.approval.note = String(a.note || '');
      cr.approval.decidedAt = Date.now();
      if (a.decision === 'approved') {
        cr.approval.status = 'approved';
        cr.status = 'approved';
        logIt(p, u.name, `批准完成包 PD approved`);
      } else {
        /* §10.2 reject / changes → bounce back to production; PM reworks and
           resubmits. Bump the workflow version so the next submit is a new
           idempotency key (allows re-submission). */
        cr.approval.status = a.decision;
        cr.status = 'changes_requested';
        p.workflowVersion = (p.workflowVersion || 1) + 1;
        logIt(p, u.name, `${a.decision === 'rejected' ? '驳回' : '要求修改'}完成包,退回生产 ${a.decision}${a.note ? ' — ' + a.note : ''}`);
      }
      break;
    }
    /* ===== S4 — Sales verify + Finance status + Payment Risk ===== */
    case 'salesVerify': {
      if (!canCommercial(u, p)) throw new PermissionError('仅 Sales / PD / BD 可核对');
      if (p.completionReview?.approval?.status !== 'approved') throw new ValidationError('完成包尚未 PD 批准,无法核对');
      const sv = p.salesVerification!;
      sv.status = 'verified';
      sv.scopeMatches = !!a.scopeMatches;
      sv.jobOrderUpdated = !!a.jobOrderUpdated;
      sv.finalInvoiceAllowed = !!a.finalInvoiceAllowed;
      sv.variationStatus = 'none';
      sv.by = u.name;
      sv.at = Date.now();
      logIt(p, u.name, `Sales 核对完成${a.finalInvoiceAllowed ? '(允许开票)' : '(暂不开票)'} Sales verified`);
      break;
    }
    case 'raiseVariation': {
      if (!canCommercial(u, p) && !canEdit(u, p)) throw new PermissionError('无权限提出 Variation');
      const sv = p.salesVerification!;
      if (a.affectsQuote) {
        /* §10.1: 影响报价/范围/交付日 → 必须重新走 PD 审批 → 退回生产重做 */
        sv.variationStatus = 'reapproval';
        sv.status = 'not_started';
        sv.finalInvoiceAllowed = false;
        const cr = p.completionReview!;
        cr.status = 'changes_requested';
        cr.approval.status = 'changes_requested';
        cr.approval.note = `Variation:${a.note || ''}`;
        p.workflowVersion = (p.workflowVersion || 1) + 1;
        logIt(p, u.name, `Variation(影响报价)→ 退回重走 PD 审批 ${a.note ? '— ' + a.note : ''}`);
      } else {
        /* 仅修正文字/附件/JD 引用 → 不重审,只记录 */
        sv.variationStatus = 'resolved';
        logIt(p, u.name, `Variation(不影响报价,仅记录)${a.note ? '— ' + a.note : ''}`);
      }
      break;
    }
    case 'editFinance': {
      if (!canEditFinance(u)) throw new PermissionError('仅 Finance 可编辑开票/收款信息');
      const inv = p.invoiceClose!;
      (inv as any)[a.field] = String(a.value || '').slice(0, 300);
      logIt(p, u.name, `Finance 改单 ${a.field}=${a.value || '—'}${inv.invoiceStatus === 'issued' ? '(已开票后修改)' : ''}`);
      break;
    }
    case 'setInvoiceStatus': {
      if (!canEditFinance(u)) throw new PermissionError('仅 Finance 可变更开票状态');
      const inv = p.invoiceClose!;
      const from = inv.invoiceStatus;
      const ok = (from === 'pending_finance' && (a.value === 'issued' || a.value === 'cancelled'))
        || (from === 'issued' && a.value === 'cancelled')
        || (from === 'cancelled' && a.value === 'pending_finance')
        || (from === a.value);
      if (!ok) throw new ValidationError(`开票状态不能从 ${from} 变为 ${a.value}`);
      if (a.value === 'issued' && !inv.invoiceRef.trim()) throw new ValidationError('开票前请先填写 Invoice Reference');
      if (from === 'issued' && a.value !== 'issued' && !String(a.reason || '').trim()) throw new ValidationError('修改已开票状态必须填写原因');
      if (a.value === 'issued' && !inv.issuedDate) inv.issuedDate = isoDate(new Date());
      inv.invoiceStatus = a.value;
      logIt(p, u.name, `开票状态 ${from}→${a.value}${a.reason ? ' — ' + a.reason : ''}`);
      break;
    }
    case 'setPaymentStatus': {
      if (!canEditFinance(u)) throw new PermissionError('仅 Finance 可变更收款状态');
      const inv = p.invoiceClose!;
      if (inv.invoiceStatus !== 'issued') throw new ValidationError('未开票,无法更新收款状态');
      const from = inv.paymentStatus;
      const ok = (from === 'pending' && (a.value === 'partial' || a.value === 'received' || a.value === 'overdue'))
        || (from === 'partial' && (a.value === 'received' || a.value === 'overdue'))
        || (from === 'overdue' && (a.value === 'partial' || a.value === 'received'))
        || (from === a.value);
      if (!ok) throw new ValidationError(`收款状态不能从 ${from} 变为 ${a.value}`);
      inv.paymentStatus = a.value;
      logIt(p, u.name, `收款状态 ${from}→${a.value}`);
      break;
    }
    case 'setPaymentRisk': {
      if (!canCommercial(u, p)) throw new PermissionError('仅 Sales / PD / BD 可设置 Payment Risk');
      const pr = p.paymentRisk!;
      pr.depositRequired = !!a.depositRequired;
      pr.depositStatus = a.depositStatus;
      pr.level = a.level;
      if (a.level === 'none') pr.resolvedAt = Date.now();
      logIt(p, u.name, `Payment Risk: ${a.level}${a.depositRequired ? ` · 定金 ${a.depositStatus}` : ''}`);
      break;
    }
    case 'addContact': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      if (!Array.isArray(p.contacts)) p.contacts = [];
      p.contacts.push({ role: '', company: '', person: '', phone: '', email: '' });
      break;
    }
    case 'editContact': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      if (!Array.isArray(p.contacts)) p.contacts = [];
      const c = p.contacts[a.idx];
      if (!c) throw new ValidationError('无效的联系人');
      (c as any)[a.field] = String(a.value).slice(0, 200);
      break;
    }
    case 'removeContact': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      if (Array.isArray(p.contacts) && p.contacts[a.idx]) p.contacts.splice(a.idx, 1);
      break;
    }
    case 'addScopeItem': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const pk = p.packages[a.pkg];
      if (!pk) throw new ValidationError('无效的服务包');
      if (!Array.isArray(pk.scopeItems)) pk.scopeItems = [];
      pk.scopeItems.push({ item: '', qty: '', note: '' });
      break;
    }
    case 'editScopeItem': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const pk = p.packages[a.pkg];
      if (!pk || !Array.isArray(pk.scopeItems) || !pk.scopeItems[a.idx]) throw new ValidationError('无效的服务内容项');
      (pk.scopeItems[a.idx] as any)[a.field] = String(a.value).slice(0, 500);
      break;
    }
    case 'removeScopeItem': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const pk = p.packages[a.pkg];
      if (pk && Array.isArray(pk.scopeItems) && pk.scopeItems[a.idx]) pk.scopeItems.splice(a.idx, 1);
      break;
    }
    case 'setRecord': {
      // Job Record edit-all & register row-edit share this. Merges a partial
      // record into the package; single source of truth for both views.
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const pk = p.packages[a.pkg];
      if (!pk) throw new ValidationError('无效的服务包');
      if (!a.patch || typeof a.patch !== 'object') throw new ValidationError('无效的资料');
      const rec: Record<string, string | number | undefined> = { ...(pk.record || {}) };
      for (const [k, v] of Object.entries(a.patch)) {
        if (k === 'updatedAt') continue; // server-owned
        rec[k] = String(v ?? '').slice(0, 2000);
      }
      rec.updatedAt = Date.now();
      pk.record = rec;
      logIt(p, u.name, `更新资料 Record: ${pk.svc}`);
      break;
    }
    case 'addServicePackage': {
      // §3: "新增记录" from a register — ensure the project has a package of this
      // svc and set its record. If the svc already exists, merge into it (no dup).
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const svc = String(a.svc || '').trim();
      if (!svc) throw new ValidationError('无效的业务类型');
      /* REQ-026: asNew=true 时无条件新开一份实例(一个项目可以有两块 LED);
         不带 asNew 时保持原来的「有就并进去」—— 登记表的新增记录与 CSV 导入
         走的是那条路,它们按项目名+业务找记录,不该一导入就冒出重复卡片。 */
      let pk = a.asNew ? undefined : p.packages.find((x) => x.svc === svc);
      if (!pk) {
        if (p.packages.length >= 24) throw new ValidationError('一个项目最多 24 份业务');
        pk = { svc, start: '', delivery: '', buffer: 0, owner: '', status: 'active', schedule: [], checklist: [] };
        const label = String(a.label || '').slice(0, 40).trim();
        if (label) pk.label = label;
        /* 新实例带上该业务的默认排期与信息清单,和建项目时一致 */
        const tpl = tplForSvc?.(svc);
        if (tpl) { const built = buildPackage(svc, '', tpl); pk.schedule = built.schedule; pk.checklist = built.checklist; }
        p.packages.push(pk);
        if (!Array.isArray(p.services)) p.services = [];
        if (!p.services.includes(svc)) p.services.push(svc);   // services 是类型清单,仍然去重
      }
      const rec: Record<string, string | number | undefined> = { ...(pk.record || {}) };
      for (const [k, v] of Object.entries(a.patch || {})) { if (k === 'updatedAt') continue; rec[k] = String(v ?? '').slice(0, 2000); }
      rec.updatedAt = Date.now();
      pk.record = rec;
      logIt(p, u.name, `${a.asNew ? '新增业务' : '新增登记记录'} ${svcName(svc)}${pk.label ? '·' + pk.label : ''}`);
      break;
    }
    /* REQ-026: 删掉一份业务实例。整包连排期、信息清单、资料一起没,
       所以按 REQ-008 的口径只放给 Sales / PD / BD,和删项目同一档。 */
    case 'removeServicePackage': {
      if (!canDelete(u)) throw new PermissionError('仅 Sales / PD / BD 可删除业务');
      const pk = p.packages[a.pkg];
      if (!pk) throw new ValidationError('无效的服务包');
      if (p.packages.length <= 1) throw new ValidationError('至少要保留一份业务');
      p.packages.splice(a.pkg, 1);
      /* services 是类型清单:只有该类型一份不剩时才从清单里摘掉 */
      if (!p.packages.some((x) => x.svc === pk.svc)) {
        p.services = (p.services || []).filter((x) => x !== pk.svc);
      }
      logIt(p, u.name, `删除业务 ${svcName(pk.svc)}${pk.label ? '·' + pk.label : ''}`);
      break;
    }
    case 'addCustomNode': {
      // §5: manual ad-hoc schedule node (sample / extra request)
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const pk = p.packages[a.pkg];
      if (!pk) throw new ValidationError('无效的服务包');
      const name = String(a.name || '').slice(0, 200).trim();
      if (!name) throw new ValidationError('请填写节点名称');
      const row = {
        id: newId(), no: '', phase: name, task: name, taskEn: name,
        owner: '', assignee: String(a.owner || '').slice(0, 120), weeks: 0, typical: '—', gate: '',
        freeze: false, status: 'todo' as const, note: '', s: String(a.date || ''), e: String(a.date || ''),
        custom: true,
      };
      const at = typeof a.atIdx === 'number' && a.atIdx >= 0 && a.atIdx < pk.schedule.length ? a.atIdx + 1 : pk.schedule.length;
      pk.schedule.splice(at, 0, row);
      logIt(p, u.name, `新增自定义节点 Custom node: ${name}`);
      break;
    }
    case 'setSchedStyle': {
      // REQ-018: which schedule template this project uses (view + export)
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      if (!['classic', 'weeks', 'dates'].includes(a.value)) throw new ValidationError('无效的排期样式');
      p.schedStyle = a.value;
      break;
    }
    case 'addSpecialRow': {
      // REQ-018 style B: red milestone / holiday band rows
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const pk = p.packages[a.pkg];
      if (!pk) throw new ValidationError('无效的服务包');
      const text = String(a.text || '').slice(0, 200).trim();
      if (!text) throw new ValidationError('请填写内容');
      pk.schedule.push({
        id: newId(), no: '', phase: text, task: text, taskEn: text,
        owner: '', assignee: '', weeks: 0, typical: '—', gate: '', freeze: false,
        status: 'todo', note: '', s: String(a.date || ''), e: String(a.date || ''),
        kind: a.kind,
      });
      logIt(p, u.name, `${a.kind === 'holiday' ? '新增假期行' : '新增卡点行'}: ${text}`);
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
  /* v2.2 §5.1/§5.2: keep the derived Production/Commercial status fresh after
     every mutation (stage is derived at read time via projStage). */
  const d = deriveStatuses(p);
  p.productionStatus = d.productionStatus;
  p.commercialStatus = d.commercialStatus;
}
