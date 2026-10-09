import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canCreate, canDelete, canEdit, canEditFinance, canExportLed, canMarkInvoice, canMeta, canReviewDrawing, canRowEdit,
  canSeeFinanceBlock, canSeeModule, canSubmitCompletionHere, canSubmitQuote, canUploadDrawing, canViewPrices, isFull, priceView,
  type Identity,
} from '../permissions.ts';
import {
  ACTION_MODULE, allowedLevels, CEILING, defaultPermTable, EDITABLE_ROLES, PERM_MODULES, permDiff, sanitizePermTable, setPermSource,
  type PermTable,
} from '../permTable.ts';
import { handOverWork, renameInProject, workOf } from '../peopleRefs.ts';
import { redactProject } from '../permRedact.ts';
import { newProject } from '../project.ts';
import { applyAction, PermissionError } from '../../server/actions.ts';
import type { Project, Role } from '../types.ts';

const ROLES: Role[] = ['director', 'bd', 'sales', 'pm', 'member', 'viewer', 'finance'];
const use = (t: PermTable) => setPermSource(() => t);

function proj(): Project {
  const p = newProject({ name: 'T', client: 'C', services: ['cgi'], start: '2026-10-01' } as never);
  p.owners = ['Pam'];
  p.engineer = 'Eve';
  p.packages[0].schedule[0].assignee = 'Mo';
  p.packages[0].schedule[1].assignee = 'Mo';
  p.packages[0].schedule[1].status = 'done';
  return p;
}

/* 上线前的写法,原样抄过来对比:默认表下每个函数的结果必须一字不差 */
const OLD = {
  canMarkInvoice: (u: Identity) => u.role === 'finance' || isFull(u) || u.role === 'sales',
  canEditFinance: (u: Identity) => u.role === 'finance',
  canMeta: (u: Identity, p: Project) => canEdit(u, p) || isFull(u) || u.role === 'sales',
  canCreate: (u: Identity) => isFull(u) || u.role === 'sales',
  canRowEdit: (u: Identity, p: Project, r: Project['packages'][0]['schedule'][0]) => canEdit(u, p) || (u.role === 'member' && r.assignee === u.name),
  canUploadDrawing: (u: Identity, p: Project) => isFull(u) || u.role === 'sales' || (u.role === 'pm' && canEdit(u, p)),
  canReviewDrawing: (u: Identity, p: Project) => isFull(u) || (u.role === 'pm' && canEdit(u, p)),
  canExportLed: (u: Identity) => isFull(u) || u.role === 'pm',
  canViewPrices: (u: Identity) => u.role !== 'member' && u.role !== 'viewer',
  priceView: (u: Identity) => (isFull(u) ? 'full' : u.role === 'finance' ? 'full' : u.role === 'sales' ? 'list' : 'none'),
  canSubmitQuote: (u: Identity) => isFull(u) || u.role === 'sales',
  canSeeFinanceBlock: (u: Identity) => u.role !== 'pm' && u.role !== 'member' && u.role !== 'viewer' && (isFull(u) || u.role === 'sales' || u.role === 'finance'),
  canSubmitCompletionHere: (u: Identity, p: Project) => canEdit(u, p),
};

test('REQ-051 默认权限表 = 上线前的规则:每个角色 × 每个函数结果不变', () => {
  use(defaultPermTable());
  const p = proj();
  const people = ['Pam', 'Eve', 'Mo', 'Zed'];
  for (const role of ROLES) for (const name of people) {
    const u = { name, role };
    const tag = `${role}/${name}`;
    assert.equal(canMarkInvoice(u), OLD.canMarkInvoice(u), tag + ' canMarkInvoice');
    assert.equal(canEditFinance(u), OLD.canEditFinance(u), tag + ' canEditFinance');
    assert.equal(canMeta(u, p), OLD.canMeta(u, p), tag + ' canMeta');
    assert.equal(canCreate(u), OLD.canCreate(u), tag + ' canCreate');
    assert.equal(canDelete(u), OLD.canCreate(u), tag + ' canDelete');
    for (const r of p.packages[0].schedule) assert.equal(canRowEdit(u, p, r), OLD.canRowEdit(u, p, r), tag + ' canRowEdit');
    assert.equal(canUploadDrawing(u, p), OLD.canUploadDrawing(u, p), tag + ' canUploadDrawing');
    assert.equal(canReviewDrawing(u, p), OLD.canReviewDrawing(u, p), tag + ' canReviewDrawing');
    assert.equal(canExportLed(u), OLD.canExportLed(u), tag + ' canExportLed');
    assert.equal(canViewPrices(u), OLD.canViewPrices(u), tag + ' canViewPrices');
    assert.equal(priceView(u), OLD.priceView(u), tag + ' priceView');
    assert.equal(canSubmitQuote(u), OLD.canSubmitQuote(u), tag + ' canSubmitQuote');
    assert.equal(canSeeFinanceBlock(u), OLD.canSeeFinanceBlock(u), tag + ' canSeeFinanceBlock');
    assert.equal(canSubmitCompletionHere(u, p), OLD.canSubmitCompletionHere(u, p), tag + ' canSubmitCompletionHere');
    for (const m of PERM_MODULES) if (m.key !== 'users') assert.ok(canSeeModule(u, m.key), tag + ' sees ' + m.key);
  }
});

test('REQ-051 默认表下,上线前能做的项目动作照样能做(模块那道门不挡)', () => {
  use(defaultPermTable());
  const p = proj();
  /* PM 改排期 / 清单 / 资料 / 联系人;Engineer 勾自己的行;Finance 改开票 */
  applyAction({ name: 'Pam', role: 'pm' }, p, { type: 'setRowStatus', pkg: 0, idx: 0, status: 'wip' } as never);
  applyAction({ name: 'Pam', role: 'pm' }, p, { type: 'addContact' } as never);
  applyAction({ name: 'Mo', role: 'member' }, p, { type: 'toggleDone', pkg: 0, idx: 0 } as never);
  p.invoiceClose = {} as never;
  applyAction({ name: 'Fin', role: 'finance' }, p, { type: 'editFinance', field: 'financeNote', value: 'n' } as never);
  assert.equal(p.packages[0].schedule[0].status, 'done');
});

test('REQ-051 每个上限格都不超过原规则:PM / Engineer 财务只读、Engineer / Finance AV 只读、统计只读、用户与权限不可见', () => {
  assert.equal(CEILING.pm.finance, 'read');
  assert.equal(CEILING.member.finance, 'read');
  assert.equal(CEILING.member.avcost, 'read');
  assert.equal(CEILING.finance.avcost, 'read');
  for (const r of EDITABLE_ROLES) { assert.equal(CEILING[r].stats, 'read'); assert.equal(CEILING[r].users, 'none'); }
  assert.deepEqual(allowedLevels('pm', 'finance'), ['none', 'read']);
  assert.deepEqual(allowedLevels('sales', 'projects'), ['read', 'edit'], '项目列表至少只读');
  assert.deepEqual(allowedLevels('member', 'users'), ['none']);
});

test('REQ-051 存进来的表不可信:超过上限夹回、低于下限抬起、坏值取默认', () => {
  const t = sanitizePermTable({
    pm: { finance: 'edit', schedule: 'none', projects: 'none' },
    member: { schedule: 'bogus', avcost: 'edit' },
    director: { schedule: 'none' },
  });
  assert.equal(t.pm.finance, 'read', '超过上限 → 上限');
  assert.equal(t.pm.schedule, 'none');
  assert.equal(t.pm.projects, 'read', '下限');
  assert.equal(t.member.schedule, 'edit', '坏值 → 默认');
  assert.equal(t.member.avcost, 'read');
  assert.ok(!('director' in t), 'PD / BD 不进表');
  assert.deepEqual(sanitizePermTable(null), defaultPermTable());
  assert.deepEqual(permDiff(defaultPermTable(), t).map((d) => `${d.role}.${d.module}`).sort(), ['pm.projects', 'pm.schedule']);
});

test('REQ-051 Engineer 排期改成不可见:看不到、改不了(服务端动作被拒),PD 不受影响', () => {
  const t = defaultPermTable();
  t.member.schedule = 'none';
  use(t);
  const p = proj();
  const mo = { name: 'Mo', role: 'member' as Role };
  assert.equal(canSeeModule(mo, 'schedule'), false);
  assert.equal(canRowEdit(mo, p, p.packages[0].schedule[0]), false);
  assert.throws(() => applyAction(mo, p, { type: 'toggleDone', pkg: 0, idx: 0 } as never), PermissionError);
  assert.throws(() => applyAction({ name: 'Eve', role: 'member' }, p, { type: 'editSched', pkg: 0, idx: 0, field: 'note', value: 'x' } as never), PermissionError);
  applyAction({ name: 'Boss', role: 'director' }, p, { type: 'toggleDone', pkg: 0, idx: 0 } as never);
  /* 接口下发的那份:任务名清空,状态和负责人还在 */
  const q = redactProject(mo, p);
  assert.equal(q.packages[0].schedule[0].task, '');
  assert.equal(q.packages[0].schedule[0].assignee, 'Mo');
  assert.equal(q.packages[0].schedule[0].status, p.packages[0].schedule[0].status);
  assert.notEqual(p.packages[0].schedule[0].task, '', '库里那份不动');
  assert.equal(redactProject({ name: 'Pam', role: 'pm' }, p), p, 'PM 没被收紧,原样返回');
  use(defaultPermTable());
});

test('REQ-051 模块级只读:Sales 信息清单只读 → 清单动作被拒,其余照旧', () => {
  const t = defaultPermTable();
  t.sales.checklist = 'read';
  use(t);
  const p = proj();
  p.perm = ['Sam'];
  const sam = { name: 'Sam', role: 'sales' as Role };
  assert.throws(() => applyAction(sam, p, { type: 'addGroup', name: 'x' } as never), PermissionError);
  applyAction(sam, p, { type: 'addContact' } as never);
  use(defaultPermTable());
});

test('REQ-051 动作 → 模块对照:排期 / 清单 / 财务的主要动作都有归属', () => {
  for (const a of ['toggleDone', 'editSched', 'saveCalendar', 'submitCompletion']) assert.equal(ACTION_MODULE[a], 'schedule', a);
  for (const a of ['setClStatus', 'addReceipt', 'addItem']) assert.equal(ACTION_MODULE[a], 'checklist', a);
  for (const a of ['markInvoiced', 'setInvoiceStatus', 'editFinance']) assert.equal(ACTION_MODULE[a], 'finance', a);
  assert.equal(ACTION_MODULE.setRecord, 'record');
  assert.equal(ACTION_MODULE.addContact, 'contacts');
  assert.equal(ACTION_MODULE.addOwner, undefined, '指派本来就只有 PD / BD');
});

test('REQ-051 删除前转交:未完成的转给接手人,已完成 / 已确认的保留原名,归档项目不动', () => {
  const p = proj();
  p.owners = ['Marcus', 'Pam'];
  p.perm = ['Marcus'];
  p.packages[0].owner = 'Marcus';
  const rows = p.packages[0].schedule;
  rows[0].assignee = 'Marcus'; rows[0].status = 'todo';
  rows[1].assignee = 'Marcus'; rows[1].status = 'done';
  const items = (p.checklist || []).flatMap((g) => g.items);
  items[0].owner = 'Marcus'; items[0].status = 'pending';
  items[1].owner = 'Marcus'; items[1].status = 'confirmed';
  const archived = proj();
  archived.owners = ['Marcus'];
  archived.archived = true;

  const w = workOf([p, archived], 'Marcus');
  assert.deepEqual(w, { projects: [p.id], todos: 1, checklist: 1 });

  const c = handOverWork(p, 'Marcus', { projects: 'Pam', tasks: 'Mo', checklist: 'Eve' });
  assert.deepEqual(p.owners, ['Pam'], '接手人本来就在名单里时不重复');
  assert.deepEqual(p.perm, ['Pam']);
  assert.equal(p.packages[0].owner, 'Pam');
  assert.equal(rows[0].assignee, 'Mo');
  assert.equal(rows[1].assignee, 'Marcus', '已完成的是历史');
  assert.equal(items[0].owner, 'Eve');
  assert.equal(items[1].owner, 'Marcus', '已确认的是历史');
  assert.ok(c.projects >= 3 && c.tasks === 1 && c.checklist === 1, JSON.stringify(c));
  assert.deepEqual(handOverWork(archived, 'Marcus', { projects: 'Pam', tasks: 'Pam', checklist: 'Pam' }), { projects: 0, tasks: 0, checklist: 0 });
  assert.deepEqual(archived.owners, ['Marcus']);
  /* 没给接手人的那一类不碰,绝不写空名字 */
  const q = proj(); q.owners = ['Marcus'];
  handOverWork(q, 'Marcus', { projects: '', tasks: 'Mo', checklist: 'Mo' });
  assert.deepEqual(q.owners, ['Marcus']);
});

test('REQ-051 改名:清单负责人、交接给谁、已移除的项都跟着改(以前漏的)', () => {
  const p = proj();
  const it = (p.checklist || [])[0].items[0];
  it.owner = 'Old';
  p.handover = { status: 'submitted', salesBrief: '', assignedPmId: 'Old', submittedBy: 'S', submittedAt: 1, briefingAt: 0 };
  p.checklistRemoved = [{ item: { ...it, id: 'x1', owner: 'Old' }, group: 'g', groupEn: 'g', color: '', at: 1, by: 'Old', reason: 'removed' } as never];
  p.owners = ['Old'];
  p.packages[0].schedule[0].assignee = 'Old';
  const n = renameInProject(p, 'Old', 'New');
  assert.equal(it.owner, 'New');
  assert.equal(p.handover.assignedPmId, 'New');
  assert.equal(p.checklistRemoved![0].item.owner, 'New');
  assert.equal(p.checklistRemoved![0].by, 'Old', '「谁移除的」是历史,不改');
  assert.deepEqual(p.owners, ['New']);
  assert.equal(p.packages[0].schedule[0].assignee, 'New');
  assert.ok(n >= 5);
});
