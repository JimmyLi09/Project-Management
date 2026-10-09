/* ===== Server-side project mutations =====
   Every mutation from the client arrives as a typed action; permission is
   checked here against the authenticated user (never trusted from client). */

import type { Identity } from '@/lib/permissions';
import {
  canAssign, canCommercial, canDecide, canEdit, canEditFinance, canEditModule, canRowEdit, isFull, canDelete , canMeta, canMarkInvoice } from '@/lib/permissions';
import { ACTION_MODULE, PERM_MODULES } from '@/lib/permTable';
import { buildPackage, deriveStatuses, fitWindow, newId, parseISO, isoDate, totalDays } from '@/lib/project';
import { getBuiltinTemplate, SVC, type Template } from '@/lib/templates';
import { stagesFromTemplate } from '@/lib/calendarStages';
import { isLegacyCgiStages, type LocalDate } from '@/features/schedule-planner/domain/schedule';
import { distributeByWeights, layoutFromStart } from '@/features/schedule-planner/domain/duration';
import {
  ALL, clGroups, dropSvc, findClItem, inScope, instOf, mergeIntoProject, moveToRemoved, projectSvcs, replaceSection, restoreRemoved,
} from '@/lib/sharedChecklist';
import type { CalendarSchedule, CalendarStage, ChecklistStatus, Project, ReceiptRecord, ScheduleStatus } from '@/lib/types';
import { cleanReceipt, sortReceipts, syncFromLatest, syncToLatest } from '@/lib/receipts';
import { applyProjField, projSourceOf } from '@/lib/records';
import { logZh, type LogParams } from '@/lib/logmsg';

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
  /* REQ-044: 信息清单在项目上(一张),项按 id 定位,分组按它在整张清单里的序号 */
  | { type: 'setClStatus'; item: string; value: ChecklistStatus }
  | { type: 'editCl'; item: string; field: 'date' | 'remark' | 'zh' | 'en' | 'owner' | 'received'; value: string }
  /* REQ-042: 收料记录(多条、不覆盖) */
  | { type: 'addReceipt'; item: string; rec: Partial<ReceiptRecord> }
  | { type: 'editReceipt'; item: string; id: string; rec: Partial<ReceiptRecord> }
  | { type: 'removeReceipt'; item: string; id: string }
  | { type: 'renameGroup'; gi: number; name: string; nameEn?: string }
  | { type: 'renameProject'; name: string }
  | { type: 'setQuotationNo'; value: string }
  | { type: 'setClient'; value: string }
  | { type: 'removeGroup'; gi: number }
  | { type: 'setNoCategories'; value: boolean }
  | { type: 'toggleHighlight'; item: string }
  | { type: 'addItem'; gi: number; items?: { zh: string; en: string }[]; svcs?: string[] }
  | { type: 'removeItem'; item: string }
  | { type: 'moveItem'; item: string; dir: -1 | 1; scope?: string }
  | { type: 'reorderItem'; item: string; to: string }
  | { type: 'addGroup'; name: string; svcs?: string[] }
  | { type: 'resetChecklist'; scope: string }
  | { type: 'attachShot'; item: string; data: string }
  | { type: 'removeShot'; item: string; shotIdx?: number }
  | { type: 'setItemSvcs'; item: string; svcs: string[] }
  | { type: 'restoreClItem'; item: string; scope?: string }
  | { type: 'setPkgField'; pkg: number; field: 'start' | 'delivery' | 'owner' | 'resourceLinks'; value: string }
  | { type: 'setPkgBuffer'; pkg: number; value: number }
  | { type: 'reversePkg'; pkg: number }
  | { type: 'reverseSchedule' }
  | { type: 'setDelivery'; value: string }
  | { type: 'setBuffer'; value: number }
  | { type: 'setDiff'; value: string }
  | { type: 'setPoints'; value: number | null }
  | { type: 'setPkgTier'; pkg: number; id: string; value?: number | null }
  /* REQ-040: 日历排期存回项目 */
  | { type: 'saveCalendar'; pkg: number; stages: CalendarStage[]; boundaries: string[]; syncDelivery?: boolean; excludeHolidays?: boolean }
  | { type: 'calendarFlow'; pkg: number; choice: 'switch' | 'keep' | 'undo' }
  | { type: 'saveCalendarArchives'; pkg: number; archives: NonNullable<CalendarSchedule['archives']> }
  | { type: 'addOwner'; name: string }
  | { type: 'removeOwner'; name: string }
  | { type: 'setEngineer'; name: string }   // REQ-043: 指派 / 换掉 / 清空项目工程师
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
  | { type: 'toggleInvoiced' }
  /* REQ-045 */
  | { type: 'markInvoiced'; invoiceRef: string; issuedDate: string; dueDate?: string; note?: string }
  | { type: 'undoInvoice'; reason?: string };

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
  /* REQ-043: 工程师也是项目级指派 —— 人休假 / 离职时,这一栏不跟着走,项目
     就还挂在走掉的人名下,新来的人看不见它。 */
  if (p.engineer === from) { p.engineer = to; changed = true; }
  p.packages.forEach((pk) => {
    if (pk.owner === from) { pk.owner = to; changed = true; }
    if (includeTasks) {
      pk.schedule.forEach((r) => {
        if (r.assignee === from) { r.assignee = to; changed = true; }
      });
    }
  });
  if (changed) logIt(p, by, includeTasks ? 'proj.transferTasks' : 'proj.transfer', { from, to });
  return changed;
}

const svcName = (k: string) => SVC[k]?.label || k;

/* 操作日志 i18n:存 key + 参数,不存渲染好的句子 —— 存句子的话,写的时候是
   哪种语言,以后就永远是哪种语言。同时把中文那句渲染进 text,导出和老客户端
   还能读到一句人话。词条表在 lib/logmsg.ts。 */
function logIt(p: Project, by: string, k: string, params?: LogParams) {
  p.log = p.log || [];
  p.log.unshift({ at: Date.now(), by, text: logZh(k, params), k, p: params });
  if (p.log.length > 200) p.log.length = 200;
}

/* ===== REQ-045 开 Invoice 自动归档 =====
   归档只是「不出现在工作视图」,开票 / 收款信息原样留着 —— 财务页按开票状态显示,
   不看 archived。 */
export function archiveForInvoice(p: Project, by: string, at = Date.now()) {
  /* 已经被 PD / BD 手动归档的(含没有原因的老归档)不改原因 —— 否则以后撤回开票会把它带出来 */
  if (p.archived) return;
  p.archived = true;
  p.archivedAt = at;
  p.archivedBy = by;
  p.archiveReason = 'invoiced';
}
/* 撤回开票时:只有「因开票自动归档」的才跟着取消;PD / BD 手动归档的不动 */
function unarchiveForInvoice(p: Project): boolean {
  if (!p.archived || p.archiveReason !== 'invoiced') return false;
  p.archived = false;
  delete p.archivedAt; delete p.archivedBy; delete p.archiveReason;
  return true;
}
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (s: string) => ISO_DAY.test(s) && !!parseISO(s) && isoDate(parseISO(s)!) === s;

/* 0922 变更单:资料 patch 里如果有与项目同源的 key(Project detail / Client
   Contact / Handover Date),把它写到项目字段上并记一条日志,返回 true 表示
   这一格已经处理过、不要再往 record 里塞一份。权限沿用 setRecord 自己的
   canEdit —— 它比这几个字段各自的动作(canMeta / canEdit)只严不松。 */
function routeProjSourced(p: Project, u: Identity, key: string, value: unknown): boolean {
  const src = projSourceOf(key);
  if (!src) return false;
  const r = applyProjField(p, src, String(value ?? ''));
  if (!r.ok) throw new ValidationError(r.error);
  if (r.log) logIt(p, u.name, r.log.k, r.log.p);
  return true;
}

function getRow(p: Project, pkg: number, idx: number) {
  const pk = p.packages[pkg];
  if (!pk) throw new ValidationError('无效的服务包');
  const r = pk.schedule[idx];
  if (!r) throw new ValidationError('无效的排期行');
  return { pk, r };
}
/* REQ-044: 清单项按 id 找(筛选之后序号会错位)。旧页面还发 pkg/gi/ii 的,提示刷新 */
function getItem(p: Project, id: unknown) {
  if (typeof id !== 'string' || !id) throw new ValidationError('信息清单已改为各业务共用一张,请刷新页面后再操作');
  const hit = findClItem(p, id);
  if (!hit) throw new ValidationError('找不到这个信息项(可能刚被别人移除),请刷新');
  return hit;
}
function getGroup(p: Project, gi: unknown) {
  const g = typeof gi === 'number' ? clGroups(p)[gi] : undefined;
  if (!g) throw new ValidationError('无效的清单栏目');
  return g;
}
/* 只收项目里有的服务;一个都不剩就报错 */
function pickSvcs(p: Project, list: unknown, fallback: string[]): string[] {
  const have = projectSvcs(p);
  const out = Array.isArray(list) ? [...new Set(list.map(String))].filter((s) => have.includes(s)) : fallback;
  if (!out.length) throw new ValidationError('至少选一个适用的服务');
  return out;
}
const svcsText = (svcs: string[]) => svcs.map((s) => SVC[s]?.label || s).join('、');

/* Mutates p in place. Throws PermissionError / ValidationError. */
export function applyAction(u: Identity, p: Project, a: ProjectAction, ctx: ActionCtx = {}): void {
  const { tplForSvc } = ctx;
  /* REQ-051: 先过权限表(模块级),再走下面每个动作各自的业务规则 */
  const mod = ACTION_MODULE[a.type];
  if (mod && !canEditModule(u, mod)) {
    const m = PERM_MODULES.find((x) => x.key === mod)!;
    throw new PermissionError(`你的角色没有「${m.zh}」的编辑权限 / Your role can't edit "${m.en}"`);
  }
  switch (a.type) {
    case 'toggleDone': {
      const { pk, r } = getRow(p, a.pkg, a.idx);
      if (!canRowEdit(u, p, r)) throw new PermissionError('无编辑权限');
      const was = r.status;
      r.status = r.status === 'done' ? 'todo' : 'done';
      logIt(p, u.name, 'sched.statusSvc', { svc: pk.svc, task: r.task, from: was, to: r.status });
      break;
    }
    case 'cycleStatus': {
      const { r } = getRow(p, a.pkg, a.idx);
      if (!canRowEdit(u, p, r)) throw new PermissionError('无编辑权限');
      const o: ScheduleStatus[] = ['todo', 'wip', 'done', 'block'];
      const was = r.status;
      r.status = o[(o.indexOf(r.status) + 1) % o.length];
      logIt(p, u.name, 'sched.status', { task: r.task, from: was, to: r.status });
      break;
    }
    case 'setRowStatus': {
      const { r } = getRow(p, a.pkg, a.idx);
      if (!canRowEdit(u, p, r)) throw new PermissionError('无编辑权限');
      const was = r.status;
      r.status = a.status;
      logIt(p, u.name, 'sched.status', { task: r.task, from: was, to: r.status });
      break;
    }
    case 'editSched': {
      const { r } = getRow(p, a.pkg, a.idx);
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      (r as any)[a.field] = a.value;
      if (a.field === 's' || a.field === 'e') logIt(p, u.name, 'sched.date', { task: r.task, field: a.field, value: a.value });
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
      logIt(p, u.name, 'sched.addRow');
      break;
    }
    case 'removeRow': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const { pk, r } = getRow(p, a.pkg, a.idx);
      logIt(p, u.name, 'sched.removeRow', { task: r.task });
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
      logIt(p, u.name, 'sched.reorder');
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
      logIt(p, u.name, 'sched.reorderDrag', { task: moved.task });
      break;
    }
    case 'setClStatus': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const { it } = getItem(p, a.item);
      const was = it.status;
      it.status = a.value;
      syncToLatest(it, u.name);   // REQ-042: 行上改状态 = 改 Latest 那条
      it.updatedAt = Date.now();
      logIt(p, u.name, 'cl.status', { item: it.zh, clFrom: was, clTo: a.value });
      break;
    }
    /* ===== REQ-042: 每个信息项的多条收料记录 =====
       追加不覆盖:收到 v02 是新增一条,v01 留在历史里。
       每次动完都把 Latest 同步回 item 的老字段(status/date/received/remark)——
       导出、KPI、进度统计读的都还是那几个字段,这样它们一行都不用改。 */
    case 'addReceipt': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const { it } = getItem(p, a.item);
      if (!Array.isArray(it.receipts)) it.receipts = [];
      if (it.receipts.length >= 60) throw new ValidationError('一个信息项最多 60 条收料记录');
      const fresh = cleanReceipt(a.rec || {}, u.name);
      /* 接收人默认就是录的人(多数时候是同一个),留个默认免得每条都要手填;
         想改在表单里改,编辑时清空就是真清空,服务端不再回填。 */
      if (!fresh.receivedBy) fresh.receivedBy = u.name;
      it.receipts = sortReceipts([fresh, ...it.receipts]);
      syncFromLatest(it);
      it.updatedAt = Date.now();
      logIt(p, u.name, a.rec?.fileName ? 'cl.receiptAddFile' : 'cl.receiptAdd',
        { item: it.zh, file: a.rec?.fileName ? String(a.rec.fileName).slice(0, 60) : undefined });
      break;
    }
    case 'editReceipt': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const { it } = getItem(p, a.item);
      const list = it.receipts || [];
      const cur = list.find((r) => r.id === a.id);
      if (!cur) throw new ValidationError('找不到这条收料记录');
      /* 保留原 id 与首次录入人,改的是内容 */
      const next = { ...cleanReceipt(a.rec || {}, cur.by || u.name, cur.id), at: cur.at || Date.now() };
      it.receipts = sortReceipts(list.map((r) => (r.id === a.id ? next : r)));
      syncFromLatest(it);
      it.updatedAt = Date.now();
      logIt(p, u.name, 'cl.receiptEdit', { item: it.zh });
      break;
    }
    case 'removeReceipt': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const { it } = getItem(p, a.item);
      const list = it.receipts || [];
      if (!list.some((r) => r.id === a.id)) throw new ValidationError('找不到这条收料记录');
      it.receipts = list.filter((r) => r.id !== a.id);
      /* 全删光了就把老字段退回未收到,不要留一个「已收到」却查无记录的状态 */
      if (it.receipts.length) syncFromLatest(it);
      else { it.status = 'pending'; it.date = ''; it.received = ''; }
      it.updatedAt = Date.now();
      logIt(p, u.name, 'cl.receiptRemove', { item: it.zh });
      break;
    }
    case 'editCl': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const { it } = getItem(p, a.item);
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
      /* REQ-042: 行上直接改「收到内容 / 日期」时,把改动落到 Latest ——
         否则行上写着已收到、展开记录却是空的,两套表示会分叉。
         备注不在其列:清单项备注是对外的,记录备注是内部的,两者不互通。 */
      if (a.field === 'received' || a.field === 'date') syncToLatest(it, u.name);
      it.updatedAt = Date.now();
      break;
    }
    /* REQ-028: 改项目名。权限沿用 canMeta —— PD/BD/Sales/PM 可改,viewer 只读。
       项目名是各处的显示主键(列表、登记表、导出、日志),所以只做最基本的
       非空与长度校验,不去动名字里自带的编号(140- 之类由用户自己写)。 */
    case 'renameProject': {
      if (!canMeta(u, p)) throw new PermissionError('无修改项目名的权限');
      const name = String(a.name || '').trim().slice(0, 120);
      if (!name) throw new ValidationError('项目名不能为空');
      if (name === p.name) break;
      const was = p.name;
      p.name = name;
      logIt(p, u.name, 'proj.rename', { from: was, to: name });
      break;
    }
    /* REQ-031: 报价单号。非必填、纯文本,不做唯一性校验也不接外部报价系统 —— 
       它现在只是个便于对账检索的记录字段。 */
    case 'setQuotationNo': {
      if (!canMeta(u, p)) throw new PermissionError('无修改报价号的权限');
      const v = String(a.value || '').trim().slice(0, 60);
      if (v === (p.quotationNo || '')) break;
      p.quotationNo = v;
      logIt(p, u.name, 'proj.quotationNo', { value: v });
      break;
    }
    /* REQ-039: Job Record 顶上那张「同步自项目创建」的表保留只读,但表里每一项
       都得在别处改得动 —— 客户名以前只能在建项目时填,建完就锁死了。 */
    case 'setClient': {
      if (!canMeta(u, p)) throw new PermissionError('无修改客户的权限');
      const v = String(a.value || '').trim().slice(0, 120);
      if (v === (p.client || '')) break;
      const was = p.client;
      p.client = v;
      logIt(p, u.name, 'proj.client', { from: was, to: v });
      break;
    }
    case 'renameGroup': {
      // REQ-014: rename a checklist category
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const g = getGroup(p, a.gi);
      const name = String(a.name || '').slice(0, 120).trim();
      if (!name) throw new ValidationError('分类名不能为空');
      const old = g.group;
      g.group = name;
      if (a.nameEn !== undefined) g.groupEn = String(a.nameEn).slice(0, 120);
      logIt(p, u.name, 'cl.renameGroup', { from: old, to: name });
      break;
    }
    case 'removeGroup': {
      /* REQ-014: delete a checklist category. REQ-044: 分类里的项先进「已移除的项」(可恢复),
         整张清单各业务共用,不能一点就把别的业务也要的资料删没 */
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const g = getGroup(p, a.gi);
      const gi = clGroups(p).indexOf(g);
      for (let ii = g.items.length - 1; ii >= 0; ii--) moveToRemoved(p, gi, ii, u.name, 'group');
      p.checklist = clGroups(p).filter((x) => x !== g);
      logIt(p, u.name, 'cl.removeGroup', { group: g.group });
      break;
    }
    case 'setNoCategories': {
      // REQ-014: flat mode — no fixed categories. REQ-044: 项目级开关
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      p.noCategories = !!a.value;
      logIt(p, u.name, p.noCategories ? 'cl.flat' : 'cl.grouped');
      break;
    }
    case 'toggleHighlight': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const { it } = getItem(p, a.item);
      it.highlight = !it.highlight;
      it.updatedAt = Date.now();
      break;
    }
    case 'addItem': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const g = getGroup(p, a.gi);
      /* REQ-044: 新项挂哪些服务 —— 界面默认 = 当前标签;「全部」下默认全部服务 */
      const svcs = pickSvcs(p, a.svcs, projectSvcs(p));
      /* B3: add one or more preset items chosen from the default library,
         or a single blank item when none are supplied */
      const toAdd = (a.items && a.items.length ? a.items : [{ zh: '新信息项', en: 'New item' }])
        .map((x) => ({ zh: String(x.zh || '').slice(0, 200), en: String(x.en || '').slice(0, 200) }))
        .filter((x) => x.zh || x.en);
      if (!toAdd.length) toAdd.push({ zh: '新信息项', en: 'New item' });
      for (const x of toAdd) g.items.push({ id: newId(), zh: x.zh, en: x.en, status: 'pending', date: '', remark: '', owner: '', shots: [], receipts: [], svcs: [...svcs] });
      break;
    }
    case 'removeItem': {
      /* REQ-044: 不直接删,进「已移除的项」—— 这一项可能别的业务也在用 */
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const { gi, ii, it } = getItem(p, a.item);
      moveToRemoved(p, gi, ii, u.name, 'item');
      logIt(p, u.name, 'cl.removeItem', { item: it.zh });
      break;
    }
    case 'moveItem': {
      /* 和筛选后看到的上 / 下一项换位置(中间被筛掉的不动) */
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const { g, ii } = getItem(p, a.item);
      const scope = String(a.scope || ALL);
      const step = a.dir === 1 ? 1 : -1;
      let j = ii + step;
      while (j >= 0 && j < g.items.length && !inScope(g.items[j], scope)) j += step;
      if (j < 0 || j >= g.items.length) break; // at an edge, no-op
      [g.items[ii], g.items[j]] = [g.items[j], g.items[ii]];
      break;
    }
    case 'reorderItem': {
      /* REQ-012: drag-to-reorder checklist items inside a category. The array
         order IS the persisted order (same as the schedule), so there's no
         second `order` field to drift out of sync. REQ-044: 按 id 指定拖哪一项、放到哪一项的位置 */
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const from = getItem(p, a.item), to = getItem(p, a.to);
      if (from.g !== to.g || from.ii === to.ii) break;
      const [moved] = from.g.items.splice(from.ii, 1);
      from.g.items.splice(to.ii, 0, moved);
      break;
    }
    case 'addGroup': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const svcs = pickSvcs(p, a.svcs, projectSvcs(p));
      if (!p.checklist) p.checklist = [];
      p.checklist.push({
        group: String(a.name || '').slice(0, 120).trim() || '特殊需求', groupEn: 'Custom', color: '#607080',
        items: [{ id: newId(), zh: '新信息项', en: 'New item', status: 'pending', date: '', remark: '', owner: '', shots: [], receipts: [], svcs }],
      });
      break;
    }
    case 'resetChecklist': {
      /* 用默认模板恢复 —— REQ-044: 作用于当前标签对应的服务(「全部」= 整张清单)。
         被换掉的项进「已移除的项」(可恢复);同名的共用项保留内容,只是重新挂上标签 */
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const scope = String(a.scope || ALL);
      const svcs = scope === ALL ? projectSvcs(p) : pickSvcs(p, [scope], []);
      const tplGroups = svcs.map((svc) => ({ svc, groups: buildPackage(svc, '', tplForSvc?.(svc)).checklist || [] }));
      if (scope === ALL) {
        replaceSection(p, ALL, [], () => [], { by: u.name, reason: 'reset' });
        tplGroups.forEach(({ svc, groups }) => mergeIntoProject(p, groups, () => [svc]));
      } else {
        replaceSection(p, scope, tplGroups[0].groups, () => [scope], { by: u.name, reason: 'reset' });
      }
      logIt(p, u.name, 'cl.resetScope', { scope: scope === ALL ? '全部' : svcsText([scope]) });
      break;
    }
    case 'setItemSvcs': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const { it } = getItem(p, a.item);
      it.svcs = pickSvcs(p, a.svcs, []);
      it.updatedAt = Date.now();
      logIt(p, u.name, 'cl.svcs', { item: it.zh, svcs: svcsText(it.svcs) });
      break;
    }
    case 'restoreClItem': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const idx = (p.checklistRemoved || []).findIndex((r) => r.item.id === a.item);
      const it = idx >= 0 ? restoreRemoved(p, idx, String(a.scope || ALL)) : null;
      if (!it) throw new ValidationError('找不到这一项(可能已经恢复过了)');
      logIt(p, u.name, 'cl.restore', { item: it.zh });
      break;
    }
    case 'attachShot': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(a.data)) throw new ValidationError('无效的图片数据');
      if (a.data.length > 800_000) throw new ValidationError('图片过大,请压缩后上传');
      const { it } = getItem(p, a.item);
      if (!Array.isArray(it.shots)) it.shots = it.shot ? [it.shot] : [];
      if (it.shots.length >= 8) throw new ValidationError('每项最多 8 张图片');
      it.shots.push(a.data);
      it.shot = undefined;
      it.updatedAt = Date.now();
      if (!it.date) it.date = isoDate(new Date());
      if (it.status === 'pending') it.status = 'received';
      logIt(p, u.name, 'cl.shot', { item: it.zh });
      break;
    }
    case 'removeShot': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const { it } = getItem(p, a.item);
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
      logIt(p, u.name, 'pkg.field', { svc: pk.svc, field: a.field, value: a.value });
      break;
    }
    case 'setPkgBuffer': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const pk = p.packages[a.pkg];
      if (!pk) throw new ValidationError('无效的服务包');
      pk.buffer = Number(a.value) || 0;
      logIt(p, u.name, 'pkg.buffer', { svc: pk.svc, value: pk.buffer });
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
      logIt(p, u.name, 'sched.reverse', { svc: pk.svc });
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
      logIt(p, u.name, 'sched.reverseAll');
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
    /* REQ-038: 手填积分现在会盖过积分规则算出来的分,所以要标记出来 ——
       建项目时按难度自动播的种子分不是人填的,不能挡住规则。
       value 传 null 就是「不手填了,回到按规则算」。 */
    case 'setPoints': {
      if (!canAssign(u, p)) throw new PermissionError('仅 PD/BD 可制定积分');
      if (a.value == null) {
        p.pointsManual = false;
        logIt(p, u.name, 'points.auto');
        break;
      }
      p.points = Number(a.value) || 0;
      p.pointsManual = true;
      logIt(p, u.name, 'points.manual', { value: p.points });
      break;
    }
    /* REQ-038: PM 给一份业务选积分档位。区间档(LED 3–7)再带上选定的分值。
       规则是全局的,但「这个项目这块 LED 算几分」是项目内的判断,所以放开给
       项目编辑权 —— 需求写的就是「无法自动判定时由 PM 选档」。 */
    /* ===== REQ-040: 日历排期 =====
       只存 boundaries + 阶段 + 备注;起止和工期是派生值,存下来早晚对不上。
       与老的 schedule 数组并存 —— 导出 / KPI / 进度统计读的还是那一套。 */
    case 'saveCalendar': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const pk = p.packages[a.pkg];
      if (!pk) throw new ValidationError('无效的服务包');
      const stages = (Array.isArray(a.stages) ? a.stages : []).slice(0, 50).map((x, i) => ({
        id: String(x?.id || `stage-${i}`).slice(0, 80),
        name: String(x?.name || `阶段 ${i + 1}`).slice(0, 120),
        /* 空串不落库 —— 存一个空的英文位和没有这一位是两回事,
           前者会让回落逻辑白跑一趟。 */
        ...(x?.nameEn ? { nameEn: String(x.nameEn).slice(0, 120) } : {}),
        tone: String(x?.tone || 'coral').slice(0, 20),
        note: String(x?.note || '').slice(0, 200),
        ...(typeof x?.weeks === 'number' && Number.isFinite(x.weeks) && x.weeks >= 0 ? { weeks: Math.min(x.weeks, 52) } : {}),
      }));
      if (!stages.length) throw new ValidationError('至少要有一个阶段');
      const boundaries = (Array.isArray(a.boundaries) ? a.boundaries : [])
        .map((d) => String(d)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 51);
      /* N 个阶段要 N+1 个分界点 —— 对不上就是还没排完,不落库 */
      if (boundaries.length && boundaries.length !== stages.length + 1) {
        throw new ValidationError('阶段数与分界点数对不上,请重新排一次');
      }
      const prev = pk.calendar;
      pk.calendar = {
        stages, boundaries,
        version: (prev?.version || 0) + 1,
        updatedAt: Date.now(), updatedBy: u.name,
        archives: prev?.archives || [],
        excludeHolidays: a.excludeHolidays !== false,
        /* 已经提示过的选择留着;再存一次之后「撤销换阶段」就不再提供 */
        ...(prev?.flow047 ? { flow047: prev.flow047 } : {}),
      };
      /* 打通交付日:最后一个分界点就是这份业务排到的交付日。
         只在用户勾了同步时才动项目的交付日 —— 不声不响改掉交付日太吓人。 */
      const last = boundaries[boundaries.length - 1];
      if (last) {
        pk.delivery = last;
        if (a.syncDelivery) {
          const was = p.delivery;
          p.delivery = last;
          if (was !== last) logIt(p, u.name, 'cal.delivery', { from: was, to: last });
        }
      }
      logIt(p, u.name, 'cal.save', { svc: pk.svc, version: pk.calendar.version, stages: stages.length });
      break;
    }
    /* REQ-047:已有 CGI 项目的日历排期还是老流程 → 提示一次。
       switch:换成当前 CGI 模板的阶段,把原来的整段日期(首日 → 末日)按新阶段的默认周数重新分配,
               原来的阶段和日期留在 flowUndo,可撤销;keep:保持不变,不再提示;undo:换回原来的。 */
    case 'calendarFlow': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const pk = p.packages[a.pkg];
      if (!pk) throw new ValidationError('无效的服务包');
      const cal = pk.calendar;
      if (!cal) throw new ValidationError('还没有日历排期');
      if (a.choice === 'keep') {
        cal.flow047 = 'kept';
        logIt(p, u.name, 'cal.flowKeep', { svc: pk.svc });
        break;
      }
      if (a.choice === 'undo') {
        if (!cal.flowUndo) throw new ValidationError('没有可撤销的更换');
        cal.stages = cal.flowUndo.stages;
        cal.boundaries = cal.flowUndo.boundaries;
        delete cal.flowUndo;
        cal.flow047 = 'kept';
        cal.version += 1; cal.updatedAt = Date.now(); cal.updatedBy = u.name;
        logIt(p, u.name, 'cal.flowUndo', { svc: pk.svc });
        break;
      }
      if (pk.svc !== 'cgi' || !isLegacyCgiStages(cal.stages)) throw new ValidationError('这份排期不是老的效果图流程');
      const next = stagesFromTemplate(pk.svc, (tplForSvc ?? getBuiltinTemplate)(pk.svc));
      const ex = cal.excludeHolidays !== false;
      const b = cal.boundaries as LocalDate[];
      let boundaries: string[] = [];
      if (b.length === cal.stages.length + 1) {
        boundaries = distributeByWeights(b[0], b[b.length - 1], next.map((x) => x.weeks ?? 1), ex)
          ?? distributeByWeights(b[0], b[b.length - 1], next.map((x) => x.weeks ?? 1), false)
          ?? layoutFromStart(b[0], next.map((x) => x.weeks), ex);
      } else if (b.length) {
        boundaries = layoutFromStart(b[0], next.map((x) => x.weeks), ex);
      }
      cal.flowUndo = { stages: cal.stages, boundaries: cal.boundaries };
      cal.stages = next.map((x) => ({ id: x.id, name: x.name, ...(x.nameEn ? { nameEn: x.nameEn } : {}), tone: x.tone, note: '', ...(x.weeks !== undefined ? { weeks: x.weeks } : {}) }));
      cal.boundaries = boundaries;
      cal.flow047 = 'switched';
      cal.version += 1; cal.updatedAt = Date.now(); cal.updatedBy = u.name;
      logIt(p, u.name, 'cal.flowSwitch', { svc: pk.svc, stages: next.length });
      break;
    }
    case 'saveCalendarArchives': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const pk = p.packages[a.pkg];
      if (!pk) throw new ValidationError('无效的服务包');
      if (!pk.calendar) throw new ValidationError('还没有日历排期');
      pk.calendar.archives = (Array.isArray(a.archives) ? a.archives : []).slice(0, 30);
      break;
    }
    case 'setPkgTier': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      const pk = p.packages[a.pkg];
      if (!pk) throw new ValidationError('无效的业务');
      const id = String(a.id || '').trim().slice(0, 40);
      if (!id) { delete pk.pointTier; logIt(p, u.name, 'points.tierClear', { svc: pk.svc }); break; }
      const val = a.value == null ? undefined : Number(a.value);
      pk.pointTier = { id, ...(val != null && Number.isFinite(val) ? { value: Math.max(0, Math.min(1000, val)) } : {}) };
      logIt(p, u.name, val != null ? 'points.tierValue' : 'points.tier', { svc: pk.svc, tier: id, value: val });
      break;
    }
    case 'addOwner': {
      if (!canAssign(u, p)) throw new PermissionError('仅 PD/BD 可指派 PM');
      const nm = (a.name || '').trim();
      if (!nm) throw new ValidationError('名字不能为空');
      p.owners = p.owners || [];
      if (!p.owners.includes(nm)) p.owners.push(nm);
      logIt(p, u.name, 'owner.add', { name: nm });
      break;
    }
    case 'removeOwner': {
      if (!canAssign(u, p)) throw new PermissionError('仅 PD/BD 可调整人员');
      p.owners = (p.owners || []).filter((n) => n !== a.name);
      break;
    }
    /* REQ-043: 项目工程师。和指派 PM 同一档权限 —— 这个字段决定谁看得见、
       改得动这个项目,不能让被指派的人自己改。填空字符串就是撤下来。 */
    case 'setEngineer': {
      if (!canAssign(u, p)) throw new PermissionError('仅 PD/BD 可指派工程师');
      const nm = (a.name || '').trim();
      const was = p.engineer || '';
      if (nm === was) break;
      p.engineer = nm || undefined;
      logIt(p, u.name, nm ? (was ? 'eng.replace' : 'eng.set') : 'eng.clear', { name: nm, was });
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
        logIt(p, u.name, 'wf.decision', { value: a.value });
      } else {
        p.update.dDecision = a.value;
      }
      p.update.dBy = u.name;
      p.update.dDate = isoDate(new Date());
      break;
    }
    case 'toggleInvoiced': {
      /* REQ-045: 旧开关并进「已开 Invoice」—— 不再单独存在(没刷新的旧页面点到这里时给句人话) */
      throw new ValidationError('「标记开票」已改为「已开 Invoice」,请刷新页面后在阶段 5 填 Invoice 号');
    }
    case 'markInvoiced': {
      if (!canMarkInvoice(u, p)) throw new PermissionError('仅 Finance / Sales / PD / BD 可标记已开 Invoice');
      const inv = p.invoiceClose!;
      if (inv.invoiceStatus === 'issued') throw new ValidationError('这个项目已开 Invoice');
      const ref = String(a.invoiceRef || '').trim().slice(0, 60);
      const day = String(a.issuedDate || '').trim();
      if (!ref) throw new ValidationError('请填写 Invoice 号');
      if (!validDay(day)) throw new ValidationError('请填写开票日期');
      const due = String(a.dueDate || '').trim();
      if (due && !validDay(due)) throw new ValidationError('到期日格式不对');
      inv.invoiceRef = ref;
      inv.issuedDate = day;
      if (due) inv.dueDate = due;
      const note = String(a.note || '').trim().slice(0, 300);
      if (note) inv.financeNote = inv.financeNote ? `${inv.financeNote}\n${note}` : note;
      inv.invoiceStatus = 'issued';
      inv.issuedBy = u.name;
      p.invoiced = true;
      archiveForInvoice(p, u.name);
      logIt(p, u.name, 'proj.invoiceArchive', { ref });
      break;
    }
    case 'undoInvoice': {
      if (!canMarkInvoice(u, p)) throw new PermissionError('仅 Finance / Sales / PD / BD 可撤回开票');
      const inv = p.invoiceClose!;
      if (inv.invoiceStatus !== 'issued' && !p.invoiced) throw new ValidationError('这个项目还没开 Invoice');
      if (inv.paymentStatus === 'partial' || inv.paymentStatus === 'received') {
        throw new ValidationError('已登记收款,不能撤回开票;请 Finance 先核对收款记录');
      }
      const ref = inv.invoiceRef || '—';
      inv.invoiceStatus = 'pending_finance';
      inv.invoiceRef = '';
      inv.issuedDate = '';
      inv.paymentStatus = 'pending';
      delete inv.issuedBy;
      p.invoiced = false;
      const reason = String(a.reason || '').trim().slice(0, 200);
      const back = unarchiveForInvoice(p);
      logIt(p, u.name, back ? 'proj.invoiceUndoUnarchive' : 'proj.invoiceUndo', { ref, note: reason ? ' — ' + reason : '' });
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
      logIt(p, u.name, 'wf.handoverSubmit', { pm });
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
      logIt(p, u.name, was === pm ? 'wf.handoverEdit' : 'wf.handoverReassign', { from: was, to: pm });
      break;
    }
    case 'acceptHandover': {
      const h = p.handover!;
      if (h.status !== 'submitted') throw new ValidationError('当前没有待接收的交接');
      const isAssignedPm = u.name === h.assignedPmId;
      if (!isAssignedPm && !isFull(u)) throw new PermissionError('仅被指派的 PM(或 PD/BD)可接单');
      h.status = 'accepted';
      h.briefingAt = Date.now();
      logIt(p, u.name, 'wf.handoverAccept');
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
      logIt(p, u.name, 'wf.completionSubmit');
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
        logIt(p, u.name, 'wf.completionApprove');
      } else {
        /* §10.2 reject / changes → bounce back to production; PM reworks and
           resubmits. Bump the workflow version so the next submit is a new
           idempotency key (allows re-submission). */
        cr.approval.status = a.decision;
        cr.status = 'changes_requested';
        p.workflowVersion = (p.workflowVersion || 1) + 1;
        logIt(p, u.name, a.decision === 'rejected' ? 'wf.completionReject' : 'wf.completionChanges',
          { note: a.note ? ' — ' + a.note : '' });
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
      logIt(p, u.name, a.finalInvoiceAllowed ? 'wf.salesVerify' : 'wf.salesVerifyHold');
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
        logIt(p, u.name, 'wf.variationReapprove', { note: a.note ? ' — ' + a.note : '' });
      } else {
        /* 仅修正文字/附件/JD 引用 → 不重审,只记录 */
        sv.variationStatus = 'resolved';
        logIt(p, u.name, 'wf.variationNote', { note: a.note ? ' — ' + a.note : '' });
      }
      break;
    }
    case 'editFinance': {
      if (!canEditFinance(u)) throw new PermissionError('仅 Finance 可编辑开票/收款信息');
      const inv = p.invoiceClose!;
      (inv as any)[a.field] = String(a.value || '').slice(0, 300);
      logIt(p, u.name, inv.invoiceStatus === 'issued' ? 'fin.editAfterIssue' : 'fin.edit', { field: a.field, value: a.value });
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
      logIt(p, u.name, 'fin.invoiceStatus', { from, to: a.value, note: a.reason ? ' — ' + a.reason : '' });
      /* REQ-045: Finance 在 ④ 里点「开票」和「已开 Invoice」是同一件事 → 一样自动归档;
         作废则一样取消(只取消因开票而归档的) */
      if (from !== 'issued' && a.value === 'issued') {
        inv.issuedBy = u.name;
        p.invoiced = true;
        archiveForInvoice(p, u.name);
        logIt(p, u.name, 'proj.invoiceArchive', { ref: inv.invoiceRef });
      } else if (from === 'issued' && a.value !== 'issued') {
        p.invoiced = false;
        if (unarchiveForInvoice(p)) logIt(p, u.name, 'proj.unarchive');
      }
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
      logIt(p, u.name, 'fin.paymentStatus', { from, to: a.value });
      break;
    }
    case 'setPaymentRisk': {
      if (!canCommercial(u, p)) throw new PermissionError('仅 Sales / PD / BD 可设置 Payment Risk');
      const pr = p.paymentRisk!;
      pr.depositRequired = !!a.depositRequired;
      pr.depositStatus = a.depositStatus;
      pr.level = a.level;
      if (a.level === 'none') pr.resolvedAt = Date.now();
      logIt(p, u.name, a.depositRequired ? 'fin.riskDeposit' : 'fin.risk', { level: a.level, deposit: a.depositStatus });
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
      let touchedRec = false;
      for (const [k, v] of Object.entries(a.patch)) {
        if (k === 'updatedAt') continue; // server-owned
        /* 0922 变更单:与项目同源的那几栏不进 record,直接落到项目字段上 */
        if (routeProjSourced(p, u, k, v)) continue;
        rec[k] = String(v ?? '').slice(0, 2000);
        touchedRec = true;
      }
      if (touchedRec) {
        rec.updatedAt = Date.now();
        pk.record = rec;
        logIt(p, u.name, 'record.update', { svc: pk.svc });
      }
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
        pk = { svc, start: '', delivery: '', buffer: 0, owner: '', status: 'active', schedule: [] };
        const label = String(a.label || '').slice(0, 40).trim();
        if (label) pk.label = label;
        /* 新实例带上该业务的默认排期与信息清单,和建项目时一致 */
        const tpl = tplForSvc?.(svc);
        p.packages.push(pk);
        if (tpl) {
          const built = buildPackage(svc, '', tpl);
          pk.schedule = built.schedule;
          /* REQ-044: 模板清单并进项目的共用清单 —— 同名项不重复,只多一个服务标签。
             同一种服务的第二份起,只属于它的项单独一条(名字后加实例名) */
          const inst = instOf(p, p.packages.length - 1);
          const r = mergeIntoProject(p, built.checklist || [], () => [svc], { inst: inst || undefined });
          logIt(p, u.name, 'cl.pkgMerge', { svc: svcsText([svc]) + (inst ? ' · ' + inst : ''), added: r.added, tagged: r.tagged });
        }
        if (!Array.isArray(p.services)) p.services = [];
        if (!p.services.includes(svc)) p.services.push(svc);   // services 是类型清单,仍然去重
      }
      const rec: Record<string, string | number | undefined> = { ...(pk.record || {}) };
      for (const [k, v] of Object.entries(a.patch || {})) {
        if (k === 'updatedAt') continue;
        if (routeProjSourced(p, u, k, v)) continue;   // 0922 变更单:同源那几栏落到项目上
        rec[k] = String(v ?? '').slice(0, 2000);
      }
      rec.updatedAt = Date.now();
      pk.record = rec;
      logIt(p, u.name, a.asNew ? 'pkg.add' : 'pkg.addRecord', { svc, label: pk.label ? ' · ' + pk.label : '' });
      break;
    }
    /* REQ-026: 删掉一份业务实例。整包连排期、信息清单、资料一起没,
       所以按 REQ-008 的口径只放给 Sales / PD / BD,和删项目同一档。 */
    case 'removeServicePackage': {
      if (!canDelete(u)) throw new PermissionError('仅 Sales / PD / BD 可删除业务');
      const pk = p.packages[a.pkg];
      if (!pk) throw new ValidationError('无效的服务包');
      if (p.packages.length <= 1) throw new ValidationError('至少要保留一份业务');
      const inst = instOf(p, a.pkg);
      p.packages.splice(a.pkg, 1);
      /* REQ-044: 只去掉这个服务标签;不再属于任何服务的项进「已移除的项」(可恢复),不直接删 */
      const moved = dropSvc(p, pk.svc, { by: u.name, reason: `svc:${pk.svc}`, keepSvc: p.packages.some((x) => x.svc === pk.svc), inst: inst || undefined });
      if (moved) logIt(p, u.name, 'cl.pkgDrop', { svc: svcsText([pk.svc]) + (inst ? ' · ' + inst : ''), moved });
      /* services 是类型清单:只有该类型一份不剩时才从清单里摘掉 */
      if (!p.packages.some((x) => x.svc === pk.svc)) {
        p.services = (p.services || []).filter((x) => x !== pk.svc);
      }
      logIt(p, u.name, 'pkg.remove', { svc: pk.svc, label: pk.label ? ' · ' + pk.label : '' });
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
      logIt(p, u.name, 'sched.customNode', { name });
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
      logIt(p, u.name, a.kind === 'holiday' ? 'sched.holiday' : 'sched.gate', { text });
      break;
    }
    case 'setArchived': {
      if (!canAssign(u, p)) throw new PermissionError('仅 PD/BD 可归档项目');
      p.archived = !!a.value;
      /* REQ-045: 记下谁、何时、为什么;手动取消归档后,撤回开票也不会再动它 */
      if (p.archived) { p.archivedAt = Date.now(); p.archivedBy = u.name; p.archiveReason = 'manual'; }
      else { delete p.archivedAt; delete p.archivedBy; delete p.archiveReason; }
      logIt(p, u.name, p.archived ? 'proj.archive' : 'proj.unarchive');
      break;
    }
    case 'dismissRisk': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      if (!a.key) throw new ValidationError('无效的风险标识');
      p.dismissedRisks = p.dismissedRisks || [];
      if (!p.dismissedRisks.includes(a.key)) {
        p.dismissedRisks.push(a.key);
        logIt(p, u.name, 'risk.dismiss', { key: a.key });
      }
      break;
    }
    case 'restoreRisk': {
      if (!canEdit(u, p)) throw new PermissionError('无编辑权限');
      p.dismissedRisks = (p.dismissedRisks || []).filter((k) => k !== a.key);
      logIt(p, u.name, 'risk.restore', { key: a.key });
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
