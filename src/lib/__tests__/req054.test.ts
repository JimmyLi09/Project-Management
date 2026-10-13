import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

/* REQ-054 售前接洽:一份和 10/12 正式库一样的小库 ——
   007 · 147-Senja Close sales gallery(LED + 投影,Kian Lim 负责,已交接)
   046 · BOC Lobby LED(AV 立项询价建的,没负责人)
   048 · 171-50JHS(正式项目,当前最大编号之一)
   049 · 147-Senja Close sales gallery(id muy6ka5ieeir,只有投影,AV 立项询价建的)—— 预演已确认,启动时改为售前记录
   q1   上线后 AV 立项询价新建的售前记录(没有编号)—— 启动补编号必须跳过它 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audax-054-'));
process.env.AUDAX_DATA_DIR = dir;
process.env.AUDAX_NO_BACKUP = '1';
(globalThis as { require?: unknown }).require = (id: string) => {
  if (id === './demo') return { shouldSeedDemo: () => false, seedDemo: () => undefined };
  throw new Error(`unexpected require ${id}`);
};

const row = (task: string) => ({ no: '1', phase: '', task, taskEn: task, owner: 'Audax', assignee: '', weeks: 1, typical: '', gate: '', freeze: false, status: 'todo', note: '', s: '', e: '' });
const pkg = (id: string, svc: string) => ({ id, svc, start: '', delivery: '', buffer: 0, owner: '', status: 'active', schedule: [row('x')] });
const base = (o: Record<string, unknown> & { id: string; created: number }) => ({
  client: 'CDL', start: '2026-10-01', delivery: '', difficulty: 'medium', points: 0, owners: [], perm: [], buffer: 0, stage: 'presales',
  update: {}, parties: {}, contacts: [], checklist: [], jobRecord: [], ...o,
});
const av = { at: 1, by: '总监 PD', text: '立项询价创建项目', k: 'proj.createAv' };
const P = {
  p007: base({ id: 'p007', serial: 7, name: '147-Senja Close sales gallery', services: ['led', 'projector'], owners: ['Kian Lim'], created: 100,
    packages: [pkg('pk7a', 'led'), pkg('pk7b', 'projector')], handover: { status: 'accepted' }, log: [],
    contacts: [{ role: 'developer', company: 'CDL', person: 'Ann Tan', phone: '+65 9111 2222', email: '' }] }),
  p046: base({ id: 'p046', serial: 46, name: 'BOC Lobby LED', services: ['led'], created: 200, packages: [pkg('pk46', 'led')], handover: { status: 'not_started' }, log: [av] }),
  p048: base({ id: 'p048', serial: 48, name: '171-50JHS', services: ['cgi'], created: 300, packages: [pkg('pk48', 'cgi')], log: [] }),
  p049: base({ id: 'muy6ka5ieeir', serial: 49, name: '147-Senja Close sales gallery', services: ['projector'], created: 400, delivery: '2026-12-01',
    packages: [pkg('pk49', 'projector')], handover: { status: 'not_started' }, log: [av],
    contacts: [{ role: 'developer', company: 'CDL', person: 'ann tan', phone: '91112222', email: '' }, { role: 'maincon', company: 'Woh Hup', person: 'Bob', phone: '8', email: '' }] }),
  q1: base({ id: 'q1', name: 'Marina One Lobby LED', services: ['led'], created: 500, packages: [pkg('pkq1', 'led')], log: [av],
    approach: { status: 'open', source: 'av', createdAt: 500 } }),
};
{
  const d = new Database(path.join(dir, 'audax.db'));
  d.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1)');
  d.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  for (const p of Object.values(P)) d.prepare('INSERT INTO projects (id, data, created_at, updated_at) VALUES (?, ?, ?, 1)').run(p.id, JSON.stringify(p), p.created);
  /* JM 看过预演:只改 049(046 待确认,不在里面) */
  d.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('mig.req054.approved', JSON.stringify({ at: 1, by: 'jm', ids: ['muy6ka5ieeir'] }));
  d.close();
}

const PD = { name: '总监 PD', role: 'director' as const };
const SALES = { name: 'Candy', role: 'sales' as const };
const PM = { name: 'Kian Lim', role: 'pm' as const };

test('REQ-054 上线迁移:预演确认过的 049 去掉编号变售前记录;046 不动;q1 启动补编号也跳过;下一个正式项目拿 049', async () => {
  const { getDb, getProject, nextProjectSerial } = await import('../../server/db.ts');
  const d = getDb();
  const flag = JSON.parse((d.prepare("SELECT value FROM meta WHERE key = 'mig.req054.approach'").get() as { value: string }).value);
  assert.deepEqual(flag.changed.map((c: { serial: number }) => c.serial), [49]);
  const p49 = getProject('muy6ka5ieeir')!;
  assert.equal(p49.serial, undefined);
  assert.equal(p49.approach?.status, 'open');
  assert.equal(p49.approach?.legacySerial, 49);
  assert.equal(p49.approach?.createdAt, 400, '售前记录的创建时间 = 原项目创建时间');
  assert.ok(p49.log[0].k === 'approach.mig');
  assert.equal(getProject('p046')!.serial, 46, '046 待确认,不动');
  assert.equal(getProject('p007')!.serial, 7);
  assert.equal(getProject('q1')!.serial, undefined, '售前记录不被启动补编号');
  assert.equal(nextProjectSerial(), 49, '049 空出来,下一个正式项目用 049');
  const reports = fs.readdirSync(path.join(dir, 'migrations'));
  const rep = fs.readFileSync(path.join(dir, 'migrations', reports.find((f) => f.startsWith('054-approach-'))!), 'utf8');
  assert.match(rep, /049 \| 147-Senja Close/);
  assert.match(rep, /046 \| BOC Lobby LED .*待 JM 确认/);
});

test('REQ-054 口径:正式 / 售前分开;可见性;售前上不能指派 PM / 交接 / 开票', async () => {
  const { listProjects, getProject } = await import('../../server/db.ts');
  const { formalProjects, approachProjects, isApproach } = await import('../approach.ts');
  const { canSeeProject, visibleProjects } = await import('../permissions.ts');
  const { applyAction } = await import('../../server/actions.ts');
  const all = listProjects();
  assert.deepEqual(formalProjects(all).map((p) => p.id).sort(), ['p007', 'p046', 'p048']);
  assert.deepEqual(approachProjects(all, 'open').map((p) => p.id).sort(), ['muy6ka5ieeir', 'q1']);
  const p49 = getProject('muy6ka5ieeir')!;
  assert.ok(isApproach(p49));
  assert.equal(canSeeProject(PM, p49), false, 'PM 看不到售前记录(没有负责人)');
  assert.ok(canSeeProject(SALES, p49) && canSeeProject(PD, p49));
  assert.ok(canSeeProject({ name: 'Fin', role: 'finance' }, p49), 'Finance 的「AV 方案成本」是只读 → 看得到');
  assert.ok(!visibleProjects(PM, all).some((p) => isApproach(p)));
  for (const a of [{ type: 'addOwner', name: 'Kian Lim' }, { type: 'submitHandover', assignedPmId: 'Kian Lim', salesBrief: '' },
    { type: 'markInvoiced', invoiceRef: 'INV-1', issuedDate: '2026-10-13' }, { type: 'setEngineer', name: 'E' }] as const) {
    assert.throws(() => applyAction(PD, getProject('muy6ka5ieeir')!, a as never), /先转为正式项目/, a.type);
  }
  applyAction(PD, getProject('muy6ka5ieeir')!, { type: 'renameProject', name: '147-Senja Close sales gallery' });   // 其他照常
});

test('REQ-054 并入已有项目:投影并进 007 已有的那一份;AV 数据改挂到 007;立项记录合并;联系人去重;售前只读留底', async () => {
  const { getDb, getProject } = await import('../../server/db.ts');
  const { getInquiry } = await import('../../server/avdb.ts');
  const { previewMerge, mergeApproach } = await import('../../server/approach.ts');
  const { applyAction } = await import('../../server/actions.ts');
  const { canEdit } = await import('../permissions.ts');
  const d = getDb();
  getInquiry('p007');   // 建 AV 表
  const ins = (t: string, cols: string, vals: unknown[]) => d.prepare(`INSERT INTO ${t} (${cols}) VALUES (${vals.map(() => '?').join(',')})`).run(...vals);
  ins('av_inquiry', 'project_id, location, notes, lines, packs, created_by, created_at, answers', ['p007', 'Senja Close', '', '["led"]', '{"led":"led@1.2"}', 'sys', 1, '{}']);
  ins('av_inquiry', 'project_id, location, notes, lines, packs, created_by, created_at, answers', ['muy6ka5ieeir', 'Senja Close Blk 2', 'sales gallery 投影', '["projector"]', '{"projector":"prj@0.2"}', '总监 PD', 2, '{"prj_scene":"wall"}']);
  ins('av_config', 'project_id, line, pack_version, cfg, summary, created_by, created_at', ['p007', 'led', 'led@1.2', '{}', '{}', 'x', 1]);
  ins('av_config', 'project_id, line, pack_version, cfg, summary, created_by, created_at', ['muy6ka5ieeir', 'projector', 'prj@0.2', '{}', '{}', 'x', 2]);
  ins('av_drawing', 'project_id, line, file_name, grade, scale_mm_per_unit, threshold, notes, uploaded_by, uploaded_at', ['muy6ka5ieeir', 'projector', 'plan.dxf', 'A', 1, 1, '', 'x', 2]);

  const plan = previewMerge(SALES, 'muy6ka5ieeir', 'p007');
  assert.ok(plan.ok, plan.reason);
  assert.deepEqual(plan.svcs.map((x) => [x.svc, x.targetHas, x.moves]), [['projector', true, 2]]);
  const before7 = getProject('p007')!;
  const r = mergeApproach(SALES, 'muy6ka5ieeir', 'p007');
  const t = getProject('p007')!, ap = getProject('muy6ka5ieeir')!;
  assert.equal(t.packages.length, 2, '投影并进 007 已有的投影服务包,不新增第二份');
  assert.equal(t.version, (before7.version || 0) + 1);
  const cnt = (sql: string, ...a: unknown[]) => (d.prepare(sql).get(...a) as { c: number }).c;
  assert.equal(cnt("SELECT COUNT(*) c FROM av_config WHERE project_id = 'p007' AND line = 'projector'"), 1, '方案挂到 007');
  assert.equal(cnt("SELECT COUNT(*) c FROM av_drawing WHERE project_id = 'p007'"), 1, '图纸挂到 007');
  assert.equal(cnt("SELECT COUNT(*) c FROM av_config WHERE project_id = 'muy6ka5ieeir'"), 0);
  const ti = getInquiry('p007')!;
  assert.deepEqual(ti.lines, ['led', 'projector'], '业务线取并集');
  assert.equal(ti.packs.projector, 'prj@0.2', '搬过去的线用售前那份的规则包');
  assert.equal(ti.location, 'Senja Close', '地点冲突以目标为准');
  assert.equal(ti.notes, 'sales gallery 投影', '目标为空才补');
  assert.equal((ti.answers as Record<string, string>).prj_scene, 'wall');
  assert.equal(getInquiry('muy6ka5ieeir'), null, '售前那条立项记录合并后删掉');
  assert.equal(ap.approach?.inquiryLegacy?.location, 'Senja Close Blk 2', '原内容存进 inquiryLegacy');
  assert.equal(t.delivery, '2026-12-01', '交付日目标为空才补');
  assert.deepEqual(t.contacts!.map((c) => c.person), ['Ann Tan', 'Bob'], '联系人按姓名 + 电话去重,目标没有的才加');
  assert.ok(t.log.some((l) => l.k === 'approach.mergeIn') && t.log.some((l) => l.k === 'approach.mergeKeep'), '目标日志:并入 + 地点以目标为准');
  assert.equal(ap.approach?.status, 'merged');
  assert.equal(ap.approach?.mergedInto, 'p007');
  assert.ok(ap.log.some((l) => l.k === 'approach.merged' && /007/.test(l.text)));
  assert.equal(canEdit(PD, ap), false, '已并入的售前记录只读');
  assert.throws(() => applyAction(PD, ap, { type: 'renameProject', name: 'x' }), /已关闭/);
  assert.equal(r.plan.ok, true);
  assert.throws(() => mergeApproach(SALES, 'muy6ka5ieeir', 'p007'), /还开着/);
});

test('REQ-054 并入冲突:目标这条线已有 AV 方案 → 不能并,整体不动', async () => {
  const { getDb, getProject } = await import('../../server/db.ts');
  const { previewMerge, mergeApproach } = await import('../../server/approach.ts');
  const d = getDb();
  d.prepare("INSERT INTO av_config (project_id, line, pack_version, cfg, summary, created_by, created_at) VALUES ('q1', 'led', 'led@1.2', '{}', '{}', 'x', 3)").run();
  const plan = previewMerge(PD, 'q1', 'p007');
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /新建正式项目/);
  const v = getProject('p007')!.version;
  assert.throws(() => mergeApproach(PD, 'q1', 'p007'), /不能并入/);
  assert.equal(getProject('p007')!.version, v, '整体回滚,目标没动');
  assert.equal((d.prepare("SELECT COUNT(*) c FROM av_config WHERE project_id = 'q1'").get() as { c: number }).c, 1);
  /* 售前没有 AV 数据的线不算冲突:048 没有 LED 方案 → 能并 */
  assert.equal(previewMerge(PD, 'q1', 'p048').ok, true);
  assert.equal(previewMerge(PD, 'q1', 'p048').svcs[0].targetHas, false, '048 没有 LED → 新增一份');
});

test('REQ-054 新建正式项目 / 未成交 / 重新打开;权限', async () => {
  const { getProject, nextProjectSerial } = await import('../../server/db.ts');
  const { convertApproach, markApproachLost, reopenApproach } = await import('../../server/approach.ts');
  const { canEdit } = await import('../permissions.ts');
  assert.throws(() => convertApproach(PM, 'q1'), /Sales \/ PD \/ BD/);
  markApproachLost(SALES, 'q1', '客户预算不够');
  let q = getProject('q1')!;
  assert.equal(q.approach?.status, 'lost');
  assert.equal(q.approach?.lostReason, '客户预算不够');
  assert.equal(canEdit(PD, q), false, '未成交只读');
  assert.throws(() => convertApproach(SALES, 'q1'), /还开着/);
  reopenApproach(SALES, 'q1');
  q = getProject('q1')!;
  assert.equal(q.approach?.status, 'open');
  assert.ok(q.log.some((l) => l.k === 'approach.reopen') && q.log.some((l) => l.k === 'approach.lostWhy'));
  const next = nextProjectSerial();
  assert.throws(() => convertApproach(SALES, 'q1', { pm: 'Kian Lim' }), /仅 PD \/ BD 可指派 PM/, 'Sales 不能顺便指派 PM');
  assert.equal(getProject('q1')!.approach?.status, 'open', '失败整体回滚');
  convertApproach(PD, 'q1', { quotationNo: 'Q-2026-118', pm: 'Kian Lim' });
  q = getProject('q1')!;
  assert.equal(q.serial, next, `拿到下一个编号 ${next}`);
  assert.equal(q.approach?.status, 'converted');
  assert.equal(q.quotationNo, 'Q-2026-118');
  assert.deepEqual(q.owners, ['Kian Lim']);
  assert.ok(q.log.some((l) => l.k === 'approach.convert' && l.text.includes(String(next).padStart(3, '0'))));
  assert.equal((await import('../approach.ts')).isApproach(q), false, '转正式后就是普通正式项目');
});

test('REQ-054 登记表导入按项目名对项目:售前记录不参与(147-Senja Close 售前和 007 同名不报重名)', async () => {
  const { importRegisterRecords, getProject, getDb } = await import('../../server/db.ts');
  const d = getDb();
  /* 再造一条同名的开着的售前记录 */
  const o = { ...P.p049, id: 'q2', serial: undefined, approach: { status: 'open', source: 'av', createdAt: 600 } };
  d.prepare('INSERT INTO projects (id, data, created_at, updated_at, version) VALUES (?, ?, 600, 1, 1)').run('q2', JSON.stringify(o));
  const r = importRegisterRecords('led', [{ project: '147-Senja Close sales gallery', patch: { siteAddress: 'Senja Close' } }], 'PD');
  assert.equal(r.updated, 1);
  assert.equal(getProject('p007')!.packages.find((x) => x.svc === 'led')!.record?.siteAddress, 'Senja Close');
});

test('REQ-054 迁移计划:条件与 --include', async () => {
  const { planMig054, resolveInclude, approachFails } = await import('../mig054.ts');
  const { newProject } = await import('../project.ts');
  const mk = (o: Record<string, unknown>) => Object.assign(newProject({ name: 'X', client: '', services: ['led'], start: '' }), { log: [av] }, o);
  const a = mk({ id: 'a', serial: 46 }), b = mk({ id: 'muy6ka5ieeir', serial: 49 }), c = mk({ id: 'c', serial: 50, owners: ['Kian'] }), e = mk({ id: 'e', serial: 51, log: [] });
  const plan = planMig054([a, b, c, e]);
  assert.deepEqual(plan.map((r) => [r.serial, r.action]), [[46, 'confirm'], [49, 'change'], [50, 'skip']], '不是 AV 建的(051)不列');
  assert.match(plan[2].why, /有负责人/);
  assert.deepEqual(planMig054([a, b], ['a']).map((r) => r.action), ['change', 'change'], '--include 046');
  assert.deepEqual(resolveInclude([a, b], ['046', 'nope']), { ids: ['a'], bad: ['nope'] });
  assert.match(approachFails(mk({ invoiced: true, serial: 3 })).join(), /开过 Invoice/);
});
