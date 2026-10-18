/* REQ-057 · 进了「5 开票 / 收尾」,PM / Engineer 这边自动归档(只读);其他角色和 KPI 不变 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* applyAction 在 server/actions.ts 里,import 它会连带打开库 —— 给一个空的临时库 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audax-057-'));
process.env.AUDAX_DATA_DIR = dir;
process.env.AUDAX_NO_BACKUP = '1';
(globalThis as { require?: unknown }).require = (id: string) => {
  if (id === './demo') return { shouldSeedDemo: () => false, seedDemo: () => undefined };
  throw new Error(`unexpected require ${id}`);
};

const { newProject, projStage, migrate } = await import('../project.ts');
const { pmClosed, inInvoiceStage, PM_CLOSED_MSG } = await import('../closeout.ts');
const { canEdit, canRowEdit, canMeta, isArchivedFor, pmLocked, canMarkInvoice, canCommercial } = await import('../permissions.ts');
const { myTasks } = await import('../myTasks.ts');
type Project = import('../types.ts').Project;

const JM = { name: 'JM', role: 'pm' as const };
const DYLAN = { name: 'Dylan', role: 'member' as const };
const SALES = { name: 'Sally', role: 'sales' as const };
const FIN = { name: 'Fiona', role: 'finance' as const };
const PD = { name: '总监 PD', role: 'director' as const };
const VIEWER = { name: 'Vic', role: 'viewer' as const };

/* 162-Model Frame for P&T:JM 负责、Dylan 是工程师(也被指派了一行),排期还有没做完的行(逾期) */
function frame(): Project {
  const p = newProject({ name: '162-Model Frame for P&T', client: 'P&T', services: ['scale'], start: '2026-09-01', owners: ['JM'], engineer: 'Dylan' } as never);
  migrate(p);
  const rows = p.packages[0].schedule;
  rows.forEach((r) => { r.status = 'done'; });
  Object.assign(rows[0], { status: 'wip', assignee: 'Dylan', s: '2026-09-01', e: '2026-10-01' });
  Object.assign(rows[1], { status: 'todo', assignee: '', s: '2026-09-01', e: '2026-10-02' });
  return p;
}
const now = Date.now();
const toInvoice = (p: Project) => {
  p.handover = { status: 'accepted', salesBrief: '', assignedPmId: 'JM', submittedBy: 'Sally', submittedAt: now, briefingAt: now };
  p.completionReview = { status: 'approved', summary: '', links: '', submittedBy: 'JM', submittedAt: now, approval: { pdId: '总监 PD', status: 'approved', note: '', decidedAt: now } };
  p.salesVerification = { status: 'verified', scopeMatches: true, jobOrderUpdated: true, variationStatus: 'none', finalInvoiceAllowed: true, by: 'Sally', at: now };
  return p;
};
const toComplete = (p: Project) => {   // 087 那种「4 完成 · 待 PD 批准」
  toInvoice(p);
  p.completionReview!.status = 'submitted'; p.completionReview!.approval.status = 'pending';
  p.salesVerification!.status = 'not_started'; p.salesVerification!.finalInvoiceAllowed = false;
  return p;
};

test('REQ-057 · pmClosed 和「projStage === invoice 且未归档」完全一致(各种流程状态 + 老的「已开票」勾)', () => {
  const cases: [string, (p: Project) => void][] = [
    ['刚建', () => {}],
    ['已交接', (p) => { p.handover = { ...toInvoice(frame()).handover! }; }],
    ['待 PD 批准', toComplete],
    ['PD 批准、Sales 未核对', (p) => { toInvoice(p); p.salesVerification!.status = 'not_started'; }],
    ['Sales 核对但不让开票', (p) => { toInvoice(p); p.salesVerification!.finalInvoiceAllowed = false; }],
    ['开票 / 收尾', toInvoice],
    ['已开 Invoice、还没归档', (p) => { toInvoice(p); p.invoiceClose = { invoiceRef: 'INV-1', issuedDate: '2026-10-17', dueDate: '', invoiceStatus: 'issued', paymentStatus: 'pending', financeNote: '' }; }],
    ['已开 Invoice、已归档', (p) => { toInvoice(p); p.archived = true; p.archiveReason = 'invoiced'; }],
    ['老项目打过「已开票」勾', (p) => { p.invoiced = true; }],
    ['排期全部完成(老口径 complete)', (p) => { p.packages[0].schedule.forEach((r) => { r.status = 'done'; }); }],
  ];
  for (const [name, f] of cases) {
    const p = frame(); f(p);
    assert.equal(pmClosed(p), !p.archived && projStage(p) === 'invoice', name);
    assert.equal(inInvoiceStage(p), projStage(p) === 'invoice', name);
  }
  assert.ok(pmClosed(toInvoice(frame())));
  assert.ok(!pmClosed(toComplete(frame())), '087 这种待 PD 批准的不算');
});

test('REQ-057 · 谁算归档:PM / Engineer 算;Sales / Finance / PD / Viewer 不算;正式归档对所有人都算', () => {
  const p = toInvoice(frame());
  assert.deepEqual([JM, DYLAN].map((u) => isArchivedFor(p, u)), [true, true]);
  assert.deepEqual([SALES, FIN, PD, VIEWER].map((u) => isArchivedFor(p, u)), [false, false, false, false]);
  p.archived = true;
  assert.deepEqual([JM, DYLAN, SALES, FIN, PD, VIEWER].map((u) => isArchivedFor(p, u)), [true, true, true, true, true, true]);
  const c = toComplete(frame());
  assert.deepEqual([JM, DYLAN, SALES].map((u) => isArchivedFor(c, u)), [false, false, false], '没进开票 / 收尾的照常');
});

test('REQ-057 · 只读:PM 改不了、Engineer 自己负责的那一行也改不了;Sales / PD 照常;开票按钮照旧', () => {
  const p = toInvoice(frame());
  const row = p.packages[0].schedule[0];
  assert.equal(canEdit(JM, p), false);
  assert.equal(canMeta(JM, p), false, '项目信息也只读');
  assert.equal(canEdit(DYLAN, p), false, '项目工程师');
  assert.equal(canRowEdit(DYLAN, p, row), false, 'Engineer 改自己负责的排期行那条路也拦住');
  assert.ok(pmLocked(JM, p) && pmLocked(DYLAN, p) && !pmLocked(SALES, p) && !pmLocked(PD, p));
  assert.ok(canEdit(PD, p) && canCommercial(SALES, p) && canMarkInvoice(SALES, p) && canMarkInvoice(FIN, p));
  const back = toComplete(frame());
  assert.ok(canEdit(JM, back) && canRowEdit(DYLAN, back, back.packages[0].schedule[0]), '没进开票 / 收尾的照常能改');
});

test('REQ-057 · 后端:PM / Engineer 的任何改动都 403 并说清楚原因;Sales 发起需要重审的 Variation 后项目回到 PM 手上', async () => {
  const { applyAction, PermissionError } = await import('../../server/actions.ts') as typeof import('../../server/actions.ts') & { PermissionError: new (...a: unknown[]) => Error };
  const p = toInvoice(frame());
  const it = (p.checklist || []).flatMap((g) => g.items)[0];
  const tries: [typeof JM | typeof DYLAN, Record<string, unknown>][] = [
    [JM, { type: 'editSched', pkg: 0, idx: 1, field: 'note', value: 'x' }],
    [JM, { type: 'setClStatus', item: it.id, value: 'received' }],
    [JM, { type: 'addJobRow', svc: 'scale' }],
    [JM, { type: 'renameProject', name: 'x' }],
    [DYLAN, { type: 'cycleStatus', pkg: 0, idx: 0 }],
    [DYLAN, { type: 'setRowStatus', pkg: 0, idx: 0, status: 'done' }],
  ];
  for (const [u, a] of tries) {
    assert.throws(() => applyAction(u, p, a as never), (e: Error) => e.constructor.name === 'PermissionError' && e.message === PM_CLOSED_MSG, `${u.name} ${a.type}`);
  }
  void PermissionError;
  applyAction(PD, p, { type: 'editSched', pkg: 0, idx: 1, field: 'note', value: 'PD 照常能改' } as never);
  assert.equal(p.packages[0].schedule[1].note, 'PD 照常能改');
  /* Sales 撤回:Variation 影响报价 → 完工包退回、Sales 核对清零 → 离开开票 / 收尾 */
  applyAction(SALES, p, { type: 'raiseVariation', affectsQuote: true, note: '客户加一面' } as never);
  assert.equal(projStage(p) === 'invoice', false);
  assert.ok(!isArchivedFor(p, JM) && canEdit(JM, p));
  applyAction(JM, p, { type: 'editSched', pkg: 0, idx: 1, field: 'note', value: 'JM 又能改了' } as never);
  assert.equal(p.packages[0].schedule[1].note, 'JM 又能改了');
});

test('REQ-057 · 我的待办 / 提醒:PM / Engineer 不再看到这些项目的逾期任务;PD / Sales 照旧;待办行数口径和侧栏一致', () => {
  const today = new Date(2026, 9, 18);
  const p = toInvoice(frame());
  const live = toComplete(frame());
  live.id = 'live'; live.name = '087-Other';
  assert.equal(myTasks([p, live], JM, today).filter((x) => x.p.id === p.id).length, 0, 'JM 待办里没有 162');
  assert.ok(myTasks([p, live], JM, today).some((x) => x.p.id === 'live'), '087 照常在');
  assert.equal(myTasks([p], DYLAN, today).length, 0, 'Dylan 自己那一行也不再提醒');
  assert.ok(myTasks([p], PD, today).length > 0, 'PD 照旧看得到');
  assert.ok(myTasks([p], SALES, today).length > 0, 'Sales 照旧看得到');
});

test('REQ-057 · KPI / 时效统计照算(还是 p.archived 口径,不因 PM 端隐藏而少算)', async () => {
  const { computeKpi, DEFAULT_KPI_RULES } = await import('../kpi.ts');
  const { workflowMetrics } = await import('../metrics.ts');
  const { DEFAULT_POINT_RULES } = await import('../points.ts') as unknown as { DEFAULT_POINT_RULES: never };
  const src = fs.readFileSync(new URL('../kpi.ts', import.meta.url), 'utf8') + fs.readFileSync(new URL('../metrics.ts', import.meta.url), 'utf8');
  assert.ok(!/isArchivedFor|pmClosed|pmLocked/.test(src), 'kpi.ts / metrics.ts 没有换成 isArchivedFor');
  const p = toInvoice(frame());
  const run = (ps: Project[]) => computeKpi({ projects: ps, users: [JM], rules: DEFAULT_KPI_RULES, period: { from: '2000-01-01', to: '2100-12-31' } as never, svc: '', pointRulesFor: () => DEFAULT_POINT_RULES })[0];
  const k = run([p]);
  assert.equal(k.projects.length, 1, '162 照样算在 JM 头上');
  assert.ok(k.raw.points > 0, `积分照算(${k.raw.points})`);
  assert.equal(k.raw.points, run([toComplete(frame())]).raw.points, '和收尾前一样多');
  assert.ok(workflowMetrics([p]) !== null);
});
