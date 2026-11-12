/* REQ-062 · 新人培训:分阶段解锁、定级免修、过关自动升级(不降)、评分表及格线、派项目限制、晋级条件、
   PM 级别预填、只加表加列(REQ-036 老数据不动)、权限 */
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  ASSIST, DAY, INDEPENDENT, TRAIN_BIZ_KEYS, canAct, coverageGaps, defaultConfig, mentorEligible, ownerGate, personView,
  pkgOwnerGate, pmLevelFromPosition, promoChecklist, readyToPass, rubricResult, type TrainData,
} from '../train.ts';
import {
  addAssess, addTrack, ensure062, finishAssess, gateOn, getConfig, levelsOf, loadData, markRead, prefillPmLevels, reconcile,
  saveQuiz, savePlacement, seed062, setConfigPart, setLevel, setMark, setMentor, setNoviceStart, skillLog, viewOf,
} from '../../server/trainStore.ts';
import { canEdit, canEditQuizOnly, canEditTraining, canSeeAllTraining, canSeeProject, isOnProject } from '../permissions.ts';
import type { Project } from '../types.ts';

const T0 = new Date(2026, 10, 2, 9).getTime();
const empty = (over: Partial<TrainData> = {}): TrainData => ({
  user: 'Alice', role: 'pm', mentor: 'Skye', noviceStart: T0, tracks: [], placement: null, levels: {}, marks: {}, assess: [], passes: {}, reads: {}, ...over,
});
const cfg = defaultConfig();
const st = (v: ReturnType<typeof personView>, key: string) => v.stages.find((s) => s.key === key)!;

/* 和 db.ts 一样的老表(上线前的库) */
function oldDb() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, name TEXT NOT NULL, role TEXT NOT NULL, position TEXT NOT NULL DEFAULT '', disabled INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE kb_docs (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0, biz TEXT, sec TEXT);
  CREATE TABLE training_paths (id TEXT PRIMARY KEY, title TEXT NOT NULL, assignees TEXT NOT NULL DEFAULT '[]');
  CREATE TABLE training_progress (path_id TEXT NOT NULL, user_name TEXT NOT NULL, done TEXT NOT NULL DEFAULT '[]', PRIMARY KEY (path_id, user_name));
  CREATE TABLE training_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, path_id TEXT NOT NULL, user_name TEXT NOT NULL, score REAL NOT NULL);`);
  const u = d.prepare('INSERT INTO users (username, name, role, position) VALUES (?, ?, ?, ?)');
  u.run('pd', 'PD', 'director', 'Director'); u.run('skye', 'Skye', 'pm', 'Senior PM'); u.run('alice', 'Alice', 'pm', ''); u.run('jason', 'Jason', 'pm', 'Project Coordinator');
  u.run('ken', 'Ken', 'pm', 'PM'); u.run('candy', 'Candy', 'sales', 'Sales'); u.run('kevin', 'Kevin', 'member', '3D Artist');
  d.prepare("INSERT INTO training_paths VALUES ('tp1', '老路径', '[\"Alice\"]')").run();
  d.prepare("INSERT INTO training_progress VALUES ('tp1', 'Alice', '[\"s1\"]')").run();
  d.prepare("INSERT INTO training_attempts (path_id, user_name, score) VALUES ('tp1', 'Alice', 90)").run();
  return d;
}
function newDb() { const d = oldDb(); ensure062(d); seed062(d, T0); return d; }
const dumpOld = (d: Database.Database) => JSON.stringify(['training_paths', 'training_progress', 'training_attempts'].map((t) => d.prepare(`SELECT * FROM ${t}`).all()));

test('只加表加列:REQ-036 的老路径、进度、成绩原样;重复执行不出错;预置不重复建', () => {
  const d = oldDb();
  const before = dumpOld(d);
  ensure062(d); ensure062(d);
  assert.equal(dumpOld(d), before);
  const cols = (d.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name);
  for (const c of ['pm_level', 'mentor', 'novice_start']) assert.ok(cols.includes(c), c);
  assert.deepEqual(seed062(d, T0).sort(), ['biz', 'courses', 'coursesNote', 'main', 'pass', 'promo', 'rubrics']);
  assert.deepEqual(seed062(d, T0 + 1), [], '已存在就不重复建');
  const c = getConfig(d);
  assert.equal(c.main.length, 2);
  assert.deepEqual(Object.keys(c.biz).sort(), [...TRAIN_BIZ_KEYS].sort());
  for (const b of TRAIN_BIZ_KEYS) assert.deepEqual(c.biz[b].map((s) => s.id), ['s2', 's3', 's4']);
  assert.equal(c.courses.length, 7);
  assert.deepEqual(c.promo.map((p) => p.id), ['coord-pm', 'pm-senior', 'senior-director']);
  assert.equal(gateOn(d), false, '派项目限制默认关');
});

test('PM 级别按「职位」预填一次:只给 PM、只填空的、认不出来留空', () => {
  assert.equal(pmLevelFromPosition('Senior PM'), 'senior');
  assert.equal(pmLevelFromPosition('PM Director'), 'director');
  assert.equal(pmLevelFromPosition('Project Coordinator'), 'coord');
  assert.equal(pmLevelFromPosition('PM'), 'pm');
  assert.equal(pmLevelFromPosition('项目经理'), 'pm');
  assert.equal(pmLevelFromPosition('3D Artist'), '');
  assert.equal(pmLevelFromPosition(''), '');
  const d = newDb();
  d.prepare("UPDATE users SET pm_level = 'pm' WHERE name = 'Ken'").run();   // 已经有的不动
  const out = prefillPmLevels(d, T0)!;
  const lv = Object.fromEntries((d.prepare('SELECT name, pm_level FROM users').all() as { name: string; pm_level: string }[]).map((r) => [r.name, r.pm_level]));
  assert.deepEqual(lv, { PD: '', Skye: 'senior', Alice: '', Jason: 'coord', Ken: 'pm', Candy: '', Kevin: '' });
  assert.deepEqual(out.map((x) => x.name).sort(), ['Alice', 'Jason', 'Skye']);
  assert.equal(prefillPmLevels(d, T0 + 1), null, '只做一次');
  assert.equal((d.prepare("SELECT position FROM users WHERE name = 'Skye'").get() as { position: string }).position, 'Senior PM', '职位不动');
});

test('解锁:开始新人期后只有关 0 能做;关 1 要关 0 过;业务关 2 要关 1 过;业务之间互不卡', () => {
  let v = personView(cfg, empty(), {}, {}, null, T0);
  assert.equal(st(v, 's0').status, 'open');
  assert.equal(st(v, 's1').status, 'locked');
  assert.equal(canAct(v, 's1.map').ok, false);
  assert.match(canAct(v, 's1.map').why, /还没解锁/);
  assert.equal(personView(cfg, empty({ noviceStart: null }), {}, {}, null, T0).stages.length, 0, '没开始新人期 = 没有关卡');
  /* 关 0 过了、定级选 3 个业务;实体模型定「了解」 */
  const tracks = ['persp', 'anim', 'model'].map((biz) => ({ biz, openedAt: T0, openedBy: 'Skye', source: 'placement' }));
  const base = empty({ tracks, passes: { s0: { at: T0, via: 'pass' } }, levels: { model: { level: 1, source: 'placement', at: T0 } },
    placement: { self: {}, bizs: ['persp', 'anim', 'model'], levels: { model: 1 }, comment: '', at: T0, by: 'Skye' } });
  v = personView(cfg, base, {}, {}, null, T0);
  assert.equal(st(v, 's1').status, 'open');
  assert.equal(st(v, 'persp.s2').status, 'locked');
  assert.equal(st(v, 'model.s2').status, 'exempt');
  assert.equal(st(v, 'model.s2').exemptBy, 'placement', '定级免修');
  assert.equal(st(v, 'model.s3').status, 'locked', '免修的关也要前一关(关 1)过了,后面才解锁');
  /* 关 1 过了:三个业务的关 2(实体模型是免修后的关 3)同时解锁 */
  v = personView(cfg, { ...base, passes: { ...base.passes, s1: { at: T0, via: 'pass' } } }, {}, {}, null, T0);
  assert.equal(st(v, 'persp.s2').status, 'open');
  assert.equal(st(v, 'anim.s2').status, 'open');
  assert.equal(st(v, 'model.s3').status, 'open', '效果图还在关 2,实体模型可以去跟项目');
  assert.equal(canAct(v, 'model.s3.shadow').ok, true);
  assert.equal(st(v, 'persp.s3').status, 'locked');
});

test('一关之内:学习步骤没做完不能约评估 / 开始测验;板块文档都打开过才算完成;空板块算完成', () => {
  const kb = { overview: { A: [{ id: 'd1', title: '架构' }], F: [] } };
  const d = empty({ passes: { s0: { at: T0, via: 'pass' } } });
  let v = personView(cfg, d, kb, { 's1.quiz': { n: 3, passScore: null } }, 'map1', T0);
  const s1 = st(v, 's1');
  assert.equal(s1.steps.find((x) => x.key === 's1.F')!.state, 'empty');
  assert.equal(s1.steps.find((x) => x.key === 's1.A')!.state, 'todo');
  assert.match(canAct(v, 's1.talk').why, /学习步骤/);
  assert.match(canAct(v, 's1.quiz').why, /学习步骤/);
  /* 勾了但文档没打开过 → 还不算 */
  v = personView(cfg, { ...d, marks: { 's1.A': { data: null, at: T0 } } }, kb, {}, 'map1', T0);
  assert.equal(st(v, 's1').steps.find((x) => x.key === 's1.A')!.state, 'todo');
  v = personView(cfg, { ...d, reads: { d1: T0, map1: T0 }, marks: { 's1.A': { data: null, at: T0 }, 's1.map': { data: null, at: T0 } },
    assess: [{ id: 1, user: 'Alice', key: 's1.meet', kind: 'task', status: 'approved', scores: null, score: null, comment: '', note: '', project: '', at: T0, by: 'Alice', doneAt: T0, doneBy: 'Skye' }] }, kb, { 's1.quiz': { n: 3, passScore: null } }, 'map1', T0);
  assert.equal(st(v, 's1').learnDone, true);
  assert.equal(canAct(v, 's1.quiz').ok, true);
  assert.equal(st(v, 's1').gate.find((x) => x.key === 's1.quiz')!.state, 'todo');
  /* 测验还没出题:这一关过不了 */
  v = personView(cfg, { ...d }, kb, {}, 'map1', T0);
  assert.equal(st(v, 's1').gate.find((x) => x.key === 's1.quiz')!.state, 'noquiz');
});

test('评分表:平均 ≥ 3.5 且没有任何一项低于 3', () => {
  const p = { avg: 3.5, min: 3 };
  const a = rubricResult([4, 4, 3, 4], p);
  assert.equal(a.passed, true); assert.equal(a.avg, 3.75);
  const b = rubricResult([4, 4, 2, 4], p);
  assert.equal(b.avg, 3.5); assert.equal(b.passed, false, '平均够了但有一项低于 3');
  assert.equal(rubricResult([3, 3, 4, 4], p).passed, true, '正好 3.5');
  assert.equal(rubricResult([3, 3, 3, 4], p).passed, false);
  assert.equal(rubricResult([0, 4, 4, 4], p).valid, false);
  assert.equal(rubricResult([6, 4, 4, 4], p).valid, false);
  assert.equal(rubricResult([4.5, 4, 4, 4], p).valid, false);
});

test('过关自动升级(关 2 → 了解、关 3 → 可协助、关 4 → 可独立),不降 PD 手动给的更高级别;每次变化写日志', () => {
  const d = newDb();
  setMentor(d, 'Alice', 'Skye'); setNoviceStart(d, 'Alice', T0);
  /* 关 0:自评 + 面谈 + 定级 */
  setMark(d, 'Alice', 's0.self', true, { persp: 'none' }, T0);
  addAssess(d, { user: 'Alice', key: 's0.talk', kind: 'task', status: 'approved', by: 'Skye', at: T0, doneAt: T0, doneBy: 'Skye' });
  savePlacement(d, 'Alice', { self: {}, bizs: ['persp', 'anim'], levels: { persp: 0, anim: 0 }, comment: '' }, 'Skye', T0);
  addTrack(d, 'Alice', 'persp', 'Skye', 'placement', T0); addTrack(d, 'Alice', 'anim', 'Skye', 'placement', T0);
  assert.deepEqual(reconcile(d, 'Alice', 'Skye', T0).passed, ['s0']);
  /* 关 1:地图 + 两个空板块 + 跟会议;测验 + 讲解 */
  d.prepare("INSERT INTO meta (key, value) VALUES ('kb.mapDoc', 'map1')").run();
  markRead(d, 'Alice', 'map1', T0);
  setMark(d, 'Alice', 's1.map', true, null, T0);
  addAssess(d, { user: 'Alice', key: 's1.meet', kind: 'task', status: 'approved', by: 'Skye', at: T0, doneAt: T0, doneBy: 'Skye' });
  saveQuiz(d, 's1.quiz', [{ id: 'q1', kind: 'bool', q: '?', options: [{ key: 'T', text: '对' }, { key: 'F', text: '错' }], answer: ['T'] }], null, 'PD', T0);
  addAssess(d, { user: 'Alice', key: 's1.quiz', kind: 'quiz', status: 'passed', score: 100, by: 'Alice', at: T0 });
  const id = addAssess(d, { user: 'Alice', key: 's1.talk', kind: 'present', status: 'booked', by: 'Alice', at: T0 });
  assert.deepEqual(reconcile(d, 'Alice', 'Skye', T0).passed, [], '讲解还没打分');
  finishAssess(d, id, { status: 'passed', scores: [{ s: 4, c: '' }, { s: 4, c: '' }, { s: 3, c: '' }, { s: 4, c: '' }], by: 'Skye', at: T0 });
  assert.deepEqual(reconcile(d, 'Alice', 'Skye', T0).passed, ['s1']);
  /* PD 手动把动画调到「可独立」;之后动画关 2 过了也不会降 */
  setLevel(d, { user: 'Alice', biz: 'anim', level: 3, source: 'manual', reason: '有经验', by: 'PD', at: T0 });
  /* 效果图关 2:三个空板块 + 测验 + 讲解 */
  saveQuiz(d, 'persp.s2.quiz', [{ id: 'q1', kind: 'bool', q: '?', options: [{ key: 'T', text: '对' }, { key: 'F', text: '错' }], answer: ['T'] }], null, 'PD', T0);
  addAssess(d, { user: 'Alice', key: 'persp.s2.quiz', kind: 'quiz', status: 'passed', score: 100, by: 'Alice', at: T0 });
  addAssess(d, { user: 'Alice', key: 'persp.s2.talk', kind: 'present', status: 'passed', by: 'Skye', at: T0 });
  const r = reconcile(d, 'Alice', 'Skye', T0 + DAY);
  assert.deepEqual(r.passed, ['persp.s2']);
  assert.deepEqual(levelsOf(d, 'Alice'), { persp: 1, anim: 3 });
  const v = viewOf(d, 'Alice', T0 + DAY);
  assert.equal(v.stages.find((s) => s.key === 'persp.s3')!.status, 'open', '效果图关 3 解锁');
  assert.equal(v.stages.find((s) => s.key === 'anim.s2')!.status, 'exempt');
  assert.equal(v.stages.find((s) => s.key === 'anim.s4')!.status, 'exempt');
  /* 自动升级不降:动画关 2 的「了解」不会把 3 降下来 */
  assert.equal(setLevel(d, { user: 'Alice', biz: 'anim', level: 1, source: 'auto', by: 'x', at: T0, raiseOnly: true }), false);
  assert.equal(levelsOf(d, 'Alice').anim, 3);
  const log = skillLog(d, 'Alice');
  assert.deepEqual(log.map((x) => `${x.biz}:${x.from_level}->${x.to_level}:${x.source}`).sort(), ['anim:0->3:manual', 'persp:0->1:auto']);
  assert.equal(log.find((x) => x.source === 'manual')!.reason, '有经验');
  /* 过关之后板块新加了文档,不影响已经过了的关 */
  d.prepare("INSERT INTO kb_docs (id, title, biz, sec) VALUES ('new', '新文档', 'persp', 'B')").run();
  assert.equal(viewOf(d, 'Alice', T0 + DAY).stages.find((s) => s.key === 'persp.s2')!.status, 'passed');
});

test('新人期完成:所选业务都到「可协助」且至少 1 个「可独立」;超过建议时间只提醒', () => {
  const pl = { self: {}, bizs: ['persp', 'anim', 'model'], levels: {}, comment: '', at: T0, by: 'Skye' };
  const lv = (a: number, b: number, c: number) => ({ persp: { level: a, source: 'auto', at: T0 }, anim: { level: b, source: 'auto', at: T0 }, model: { level: c, source: 'auto', at: T0 } });
  assert.equal(personView(cfg, empty({ placement: pl, levels: lv(2, 2, 2) }), {}, {}, null, T0).noviceDone, false);
  assert.equal(personView(cfg, empty({ placement: pl, levels: lv(2, 2, 3) }), {}, {}, null, T0).noviceDone, true);
  assert.equal(personView(cfg, empty({ placement: pl, levels: lv(1, 3, 3) }), {}, {}, null, T0).noviceDone, false);
  const v = personView(cfg, empty(), {}, {}, null, T0 + 5 * DAY);
  assert.equal(st(v, 's0').overdueDays, 4, '关 0 建议第 2 天');
  assert.equal(st(v, 's0').status, 'open', '超时不会判不通过');
  assert.equal(readyToPass(v).length, 0);
});

test('派项目限制:没到「可协助」开关开着拦、关着只提醒;只到可协助建议加一位可独立;PD / BD、其他业务、售前不查', () => {
  const svcs = ['ani'];
  const below = ownerGate({ name: 'Alice', role: 'pm', svcs, levels: {}, on: false });
  assert.equal(below.block, ''); assert.equal(below.warns.length, 1); assert.equal(below.kind, 'below');
  assert.match(below.warns[0], /还没到「可协助」.*跟项目/);
  const blocked = ownerGate({ name: 'Alice', role: 'pm', svcs, levels: {}, on: true });
  assert.match(blocked.block, /不能指定为负责 PM/);
  const assist = ownerGate({ name: 'Alice', role: 'pm', svcs, levels: { anim: ASSIST }, on: true });
  assert.equal(assist.block, ''); assert.equal(assist.kind, 'assistOnly'); assert.match(assist.warns[0], /可独立/);
  assert.equal(ownerGate({ name: 'Ken', role: 'pm', svcs, levels: { anim: INDEPENDENT }, on: true }).kind, 'ok');
  assert.equal(ownerGate({ name: 'Alice', role: 'pm', svcs: ['cgi', 'led'], levels: { persp: 2 }, on: true }).block, '', '多个业务:至少一个到可协助');
  assert.equal(ownerGate({ name: 'PD', role: 'director', svcs, levels: {}, on: true }).kind, 'skip');
  assert.equal(ownerGate({ name: 'Alice', role: 'pm', svcs: ['website'], levels: {}, on: true }).kind, 'skip', '只有「其他业务」');
  assert.equal(ownerGate({ name: 'Alice', role: 'pm', svcs, levels: {}, on: true, approach: true }).kind, 'skip');
  /* 服务包负责人:是 PM 时看这个服务包的业务 */
  assert.match(pkgOwnerGate({ name: 'Alice', role: 'pm', svc: 'led', levels: { persp: 3 }, on: true }).block, /LED/);
  assert.equal(pkgOwnerGate({ name: 'Kevin', role: 'member', svc: 'led', levels: {}, on: true }).kind, 'skip');
  /* 项目里哪个业务没有到可协助的负责 PM(PD / BD 当负责人的算有) */
  assert.deepEqual(coverageGaps(['cgi', 'led'], [{ name: 'Alice', role: 'pm', levels: { persp: 2 } }]), ['led']);
  assert.deepEqual(coverageGaps(['cgi', 'led'], [{ name: 'PD', role: 'director', levels: {} }]), []);
  assert.deepEqual(coverageGaps(['website'], []), []);
});

test('晋级条件:能力矩阵和带教自动判断,手动项 PD / BD 勾,KPI 待接入', () => {
  const p = defaultConfig().promo.find((x) => x.id === 'coord-pm')!;
  const lv = { persp: 3, anim: 3, model: 3, digital: 3, led: 2 };
  let items = promoChecklist(p, { levels: lv, menteesDone: 0, manual: {} });
  assert.deepEqual(items.filter((i) => i.auto && i.met !== null).map((i) => i.met), [true, true, true, true, false]);
  assert.equal(items.find((i) => i.id === 'kpi')!.met, null);
  items = promoChecklist(p, { levels: { ...lv, control: 3 }, menteesDone: 0, manual: {} });
  assert.ok(items.filter((i) => i.id.startsWith('m')).every((i) => i.met));
  const s = defaultConfig().promo.find((x) => x.id === 'pm-senior')!;
  items = promoChecklist(s, { levels: { persp: 4, anim: 4 }, menteesDone: 1, manual: { meet3: true } });
  assert.deepEqual(items.map((i) => [i.id, i.met]), [['m0', true], ['mentees', true], ['x.meet3', true], ['kpi', null]]);
});

test('配置保存会清洗:评分表必须 4 项;步骤 id 不能重复;及格线范围', () => {
  const d = newDb();
  assert.throws(() => setConfigPart(d, 'rubrics', { present: { zh: 'x', items: [{ zh: 'a' }] } }, 'PD', T0), /4 项/);
  const main = getConfig(d).main;
  main[1].steps.push({ ...main[1].steps[0] });
  assert.throws(() => setConfigPart(d, 'main', main, 'PD', T0), /重复/);
  assert.throws(() => setConfigPart(d, 'pass', { avg: 6, min: 3, quiz: 80 }, 'PD', T0), /及格线/);
  assert.deepEqual(setConfigPart(d, 'pass', { avg: 3.8, min: 3, quiz: 85 }, 'PD', T0), { avg: 3.8, min: 3, quiz: 85 });
  /* 把关 1 的测验从关卡里去掉 */
  const m2 = getConfig(d).main;
  m2[1].gate = m2[1].gate.filter((g) => g.kind !== 'quiz');
  setConfigPart(d, 'main', m2, 'PD', T0);
  assert.deepEqual(getConfig(d).main[1].gate.map((g) => g.id), ['talk']);
});

test('权限:老路径只有 PD / BD 能建 / 改;Senior PM / PM Director 只改题目;带教人资格', () => {
  const PD = { name: 'PD', role: 'director' as const }, BD = { name: 'BD', role: 'bd' as const }, PM = { name: 'Alice', role: 'pm' as const };
  assert.ok(canEditTraining(PD) && canEditTraining(BD) && !canEditTraining(PM));
  assert.ok(canSeeAllTraining(PD) && !canSeeAllTraining(PM));
  assert.equal(canEditQuizOnly({ ...PM, pmLevel: 'senior' }), true);
  assert.equal(canEditQuizOnly({ ...PM, pmLevel: 'director' }), true);
  assert.equal(canEditQuizOnly({ ...PM, pmLevel: 'pm' }), false);
  assert.equal(canEditQuizOnly({ ...PD, pmLevel: 'senior' }), false, 'PD / BD 是全权,不走「只改题目」');
  assert.ok(mentorEligible({ role: 'bd' }) && mentorEligible({ role: 'director' }) && mentorEligible({ role: 'pm', pmLevel: 'senior' }) && mentorEligible({ role: 'pm', pmLevel: 'director' }));
  assert.ok(!mentorEligible({ role: 'pm', pmLevel: 'coord' }) && !mentorEligible({ role: 'pm', pmLevel: '' }) && !mentorEligible({ role: 'sales', pmLevel: 'senior' }));
  assert.equal(canEditQuizOnly({ name: 'C', role: 'sales', pmLevel: 'senior' }), false);
});

test('跟项目 / 协助成员:跟项目能看不能改,协助能改;都不是负责 PM', () => {
  const p = { id: 'p1', owners: ['Ken'], perm: [], packages: [], trainees: [{ name: 'Alice', mode: 'shadow' }, { name: 'Jason', mode: 'assist' }] } as unknown as Project;
  const A = { name: 'Alice', role: 'pm' as const }, J = { name: 'Jason', role: 'pm' as const }, X = { name: 'Other', role: 'pm' as const };
  assert.ok(isOnProject(A, p) && canSeeProject(A, p));
  assert.equal(canEdit(A, p), false, '跟项目只读');
  assert.equal(canEdit(J, p), true, '协助能改');
  assert.equal(canSeeProject(X, p), false);
  assert.ok(!(p.owners || []).includes('Alice') && !(p.owners || []).includes('Jason'), '不进 owners → KPI / 积分都不算');
});

test('loadData:把一个人的数据读全(给 personView 算)', () => {
  const d = newDb();
  setMentor(d, 'Alice', 'Skye'); setNoviceStart(d, 'Alice', T0);
  addTrack(d, 'Alice', 'persp', 'Skye', 'placement', T0);
  setLevel(d, { user: 'Alice', biz: 'persp', level: 1, source: 'init', reason: '上线', by: 'PD', at: T0 });
  setMark(d, 'Alice', 's0.self', true, { persp: 'done' }, T0);
  const x = loadData(d, 'Alice');
  assert.equal(x.mentor, 'Skye'); assert.equal(x.noviceStart, T0);
  assert.deepEqual(x.tracks.map((t) => t.biz), ['persp']);
  assert.equal(x.levels.persp.level, 1);
  assert.deepEqual(x.marks['s0.self'].data, { persp: 'done' });
});
