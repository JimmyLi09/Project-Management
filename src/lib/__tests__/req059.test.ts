/* REQ-059 · 1022 反馈四项小修:开票日期(UTC+8)、新建项目「发展商」、3D VR/720 改软件、项目 PM 可删未开工的业务 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, newProject } from '../project.ts';
import { applyAction, PermissionError, ValidationError } from '../../server/actions.ts';
import { getBuiltinTemplate } from '../templates.ts';
import { roleKeyOf, CONTACT_ROLES, roleBilingual } from '../contactRoles.ts';
import { DEFAULT_HW_SVCS, formatOf, isHw, setServerJobFormatSource } from '../jobFormat.ts';
import { ensureJobRows } from '../jobRecord.ts';
import { canRemovePkg, pkgStarted, PKG_LAST_MSG, PKG_STARTED_MSG } from '../pkgRemove.ts';
import type { Project } from '../types.ts';

/* 服务器在新加坡 / 马来西亚 = UTC+8 */
process.env.TZ = 'Asia/Singapore';
setServerJobFormatSource(() => ({}));
const PD = { name: 'PD', role: 'director' } as never;
const SALES = { name: 'Candy', role: 'sales' } as never;
const JM = { name: 'JM', role: 'pm' } as never;
const KELLY = { name: 'Kelly', role: 'pm' } as never;
const DYLAN = { name: 'Dylan', role: 'member' } as never;
const ACC = { name: 'Account', role: 'finance' } as never;
const VIEW = { name: 'Vee', role: 'viewer' } as never;
const BD = { name: 'BD', role: 'bd' } as never;
const act = (u: unknown, p: Project, a: unknown) => applyAction(u as never, p, a as never, { tplForSvc: getBuiltinTemplate });
const mk = (services: string[], extra: Record<string, unknown> = {}) =>
  migrate(newProject({ name: 'T', client: 'C', services, start: '2026-10-01', owners: ['JM'], ...extra } as never));

test('REQ-059 §1 · UTC+8:开票日期 2026-09-30 / 10-01 / 12-31 都能通过并归档', () => {
  assert.equal(new Date(2026, 8, 30).getTimezoneOffset(), -480, '这个测试要跑在 UTC+8');
  for (const d of ['2026-09-30', '2026-10-01', '2026-12-31']) {
    const p = mk(['maxhub']);
    act(SALES, p, { type: 'markInvoiced', invoiceRef: 'INV-161', issuedDate: d });
    assert.equal(p.invoiceClose!.issuedDate, d, d);
    assert.equal(p.archived, true, d);
  }
});

test('REQ-059 §1 · 校验不过:报错说清楚是哪一栏(中英),并把收到的原值写进服务器日志', () => {
  const logs: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => { logs.push(a.join(' ')); };
  try {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ invoiceRef: 'INV-1', issuedDate: '' }, /开票日期.*invoice date/],
      [{ invoiceRef: 'INV-1', issuedDate: '2026-02-30' }, /开票日期/],
      [{ invoiceRef: 'INV-1', issuedDate: '2026/09/30' }, /开票日期/],
      [{ invoiceRef: '', issuedDate: '2026-09-30' }, /Invoice 号.*invoice number/],
      [{ invoiceRef: 'INV-1', issuedDate: '2026-09-30', dueDate: '2026-09-29' }, /到期日不能早于开票日期/],
      [{ invoiceRef: 'INV-1', issuedDate: '2026-09-30', dueDate: '30/10/2026' }, /到期日格式不对/],
    ];
    for (const [a, re] of cases) {
      const p = mk(['maxhub']);
      assert.throws(() => act(SALES, p, { type: 'markInvoiced', ...a }), (e: Error) => e instanceof ValidationError && re.test(e.message), JSON.stringify(a));
      assert.equal(p.archived, undefined, '没有归档');
    }
    assert.equal(logs.length, cases.length);
    assert.match(logs[2], /\[REQ-059\].*issuedDate="2026\/09\/30"/, '原值原样写进日志');
    assert.match(logs[4], /dueDate="2026-09-29"/);
  } finally { console.warn = warn; }
  /* 到期日等于开票日期可以 */
  const p = mk(['maxhub']);
  act(SALES, p, { type: 'markInvoiced', invoiceRef: 'INV-2', issuedDate: '2026-09-30', dueDate: '2026-09-30' });
  assert.equal(p.invoiceClose!.dueDate, '2026-09-30');
});

test('REQ-059 §2 · 新建项目「相关公司」:Developer / 发展商 排第一,选了存成键 developer', () => {
  assert.equal(roleBilingual(CONTACT_ROLES[0]), 'Developer / 发展商');
  assert.equal(CONTACT_ROLES.length, 6);
  assert.equal(roleKeyOf('Developer / 发展商'), 'developer');
  const p = newProject({ name: 'T', client: 'ID Co', services: ['cgi'], start: '', companies: [{ role: 'Developer / 发展商', company: 'Noel Property', person: '', phone: '', email: '' }] } as never);
  assert.deepEqual(p.contacts!.map((c) => [c.role, c.company]), [['developer', 'ID Co'], ['developer', 'Noel Property']]);
});

test('REQ-059 §3 · 3D VR/720 默认是软件 · 4 栏:新项目有一行 4 栏;原来的额外项目行留在表里,不再补空行', () => {
  assert.equal(DEFAULT_HW_SVCS.length, 8);
  assert.equal(formatOf('vrar'), 'sw');
  assert.equal(isHw('vrar', { vrar: 'hw' }), true, '登记表管理里改回硬件照样生效');
  const p = newProject({ name: '065-11A Carmen Street VR', client: 'C', services: ['vrar'], start: '' } as never);
  assert.deepEqual(p.jobRecord!.map((r) => [r.svc, r.item]), [['vrar', '3D VR / 720']]);
  /* 老项目:登记表字段还在 pk.record,4 栏表里有一行原来的「额外项目」 */
  const q = newProject({ name: '065', client: 'C', services: ['vrar'], start: '' } as never);
  q.jobRecord = [{ id: 'x1', svc: 'vrar', item: '3D VR / 720', detail: 'Virtual tour of Semi-D house for 2 units', qty: '2', note: 'Complimentary hosting for 1 year', pk: q.packages[0].id } as never];
  q.packages[0].record = { clientContact: 'Derek Low' } as never;
  assert.equal(ensureJobRows(q), 0, '已经有这项业务的行,不补空行');
  assert.equal(q.jobRecord.length, 1);
  assert.equal((q.packages[0].record as Record<string, string>).clientContact, 'Derek Low', '登记表字段原样保留');
});

test('REQ-059 §4 · 谁能删业务:Sales / PD / BD 照旧;项目 PM 只能删没开工的;其他角色看不到', () => {
  const p = mk(['cgi', 'av']);
  const av = p.packages.findIndex((x) => x.svc === 'av');
  for (const u of [PD, BD, SALES]) assert.deepEqual(canRemovePkg(u, p, av), { show: true, ok: true });
  assert.deepEqual(canRemovePkg(JM, p, av), { show: true, ok: true }, 'JM 是项目 PM,AV 还没开工');
  for (const u of [KELLY, DYLAN, ACC, VIEW]) assert.equal(canRemovePkg(u, p, av).show, false, '不是这个项目的 PM / 工程师 / 财务 / 只读:看不到');
  /* 排期有「进行中」→ 已开工 */
  const cgi = p.packages.findIndex((x) => x.svc === 'cgi');
  p.packages[cgi].schedule[0].status = 'wip';
  assert.deepEqual(canRemovePkg(JM, p, cgi), { show: true, ok: false, why: PKG_STARTED_MSG });
  assert.deepEqual(canRemovePkg(PD, p, cgi), { show: true, ok: true }, 'PD 照旧能删');
  p.packages[cgi].schedule[0].status = 'done';
  assert.equal(pkgStarted(p, cgi), true, '已完成也算');
  p.packages[cgi].schedule[0].status = 'todo';
  assert.equal(pkgStarted(p, cgi), false);
});

test('REQ-059 §4 · 已开工看清单:只属于它的项收到 / 确认 / 有收料记录才算;和别的业务共用的项不算', () => {
  const p = mk(['cgi', 'scale']);
  const ci = p.packages.findIndex((x) => x.svc === 'cgi');
  const items = p.checklist!.flatMap((g) => g.items);
  const own = items.find((it) => (it.svcs || []).length === 1 && it.svcs![0] === 'cgi')!;
  const shared = items.find((it) => (it.svcs || []).includes('cgi') && (it.svcs || []).length > 1);
  assert.ok(own, '有只属于效果图的项');
  if (shared) { shared.status = 'received'; assert.equal(pkgStarted(p, ci), false, '共用的项收到了,不算这一份开工'); shared.status = 'pending'; }
  own.status = 'confirmed';
  assert.equal(pkgStarted(p, ci), true, '只属于它的项已确认');
  own.status = 'pending';
  own.receipts = [{ id: 'r1', date: '2026-10-20', fileName: 'site.pdf', from: '', via: 'Email', path: '', status: 'received', remark: '' } as never];
  assert.equal(pkgStarted(p, ci), true, '有收料记录');
  own.receipts = [];
  own.status = 'na';
  assert.equal(pkgStarted(p, ci), false, '不适用不算');
});

test('REQ-059 §4 · 后端:PM 删已开工的业务 403(同一句话);没开工的能删;只剩一份谁都删不了;收尾 / 已关闭只读', () => {
  const p = mk(['cgi', 'av']);
  const cgi = p.packages.findIndex((x) => x.svc === 'cgi');
  p.packages[cgi].schedule[0].status = 'wip';
  assert.throws(() => act(JM, p, { type: 'removeServicePackage', pkg: cgi }), (e: Error) => e instanceof PermissionError && e.message === PKG_STARTED_MSG);
  assert.throws(() => act(DYLAN, p, { type: 'removeServicePackage', pkg: cgi }), PermissionError, '工程师不能删');
  act(JM, p, { type: 'removeServicePackage', pkg: p.packages.findIndex((x) => x.svc === 'av') });
  assert.deepEqual(p.packages.map((x) => x.svc), ['cgi']);
  assert.ok(p.log.some((l) => /pkg\.remove|删除业务/.test(JSON.stringify(l))), '写了日志');
  assert.deepEqual(canRemovePkg(PD, p, 0), { show: true, ok: false, why: PKG_LAST_MSG, last: true });
  assert.deepEqual(canRemovePkg(JM, p, 0).why, PKG_LAST_MSG);
  assert.throws(() => act(PD, p, { type: 'removeServicePackage', pkg: 0 }), (e: Error) => e instanceof ValidationError && e.message === PKG_LAST_MSG);
  /* REQ-057:进了开票 / 收尾,PM 端只读 —— 按钮都不出 */
  const q = mk(['cgi', 'av']);
  q.invoiced = true;
  assert.equal(canRemovePkg(JM, q, 1).show, false);
  assert.equal(canRemovePkg(PD, q, 1).ok, true, 'PD 不受影响');
  /* REQ-054:已关闭的售前记录 */
  const r = mk(['cgi', 'av']);
  r.approach = { status: 'lost' } as never;
  assert.equal(canRemovePkg(PD, r, 1).show, false);
});
