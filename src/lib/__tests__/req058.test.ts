/* REQ-058 · 信息清单去重:分组按「谁提供」统一、效果图 = 动画共用 27 项、室内资料可选、只改模板(覆盖过的先预演) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { infoProgress, newProject } from '../project.ts';
import { clStats } from '../sharedChecklist.ts';
import { clGroupHidden, hasInteriorGroup, interiorOn, visibleGroups } from '../interior.ts';
import { CGI_ANI_CHECKLIST, TPL, getBuiltinTemplate, type Template } from '../templates.ts';
import { DEFAULT_SYNONYMS, groupKeys, mergeChecklists } from '../checklistMerge.ts';
import { apply058, changed058, plan058, report058 } from '../mig058.ts';
import { applyAction, PermissionError } from '../../server/actions.ts';
import type { Project } from '../types.ts';

const mk = (services: string[], extra: Record<string, unknown> = {}) =>
  newProject({ name: 'T', client: 'C', services, start: '', owners: ['JM'], ...extra } as never);
const items = (p: Project) => (p.checklist || []).flatMap((g) => g.items);
const shape = (p: Project) => visibleGroups(p).map((g) => [g.key || '', g.group, g.items.length]);
const PD = { name: 'PD', role: 'director' } as never;
const JM = { name: 'JM', role: 'pm' } as never;
const DYLAN = { name: 'Dylan', role: 'member' } as never;
const SALES = { name: 'Candy', role: 'sales' } as never;
const act = (u: unknown, p: Project, a: unknown) => applyAction(u as never, p, a as never, { tplForSvc: getBuiltinTemplate });

test('REQ-058 §2.2 · 效果图和动画的模板清单完全相同:27 项,建筑 6 / 景观 8 / 室内 11 / 销售·需求 2', () => {
  assert.equal(TPL.cgi.checklist, CGI_ANI_CHECKLIST);
  assert.equal(TPL.ani.checklist, CGI_ANI_CHECKLIST);
  assert.deepEqual(CGI_ANI_CHECKLIST.map((g) => [g[4], g[0], g[1], g[3].length]),
    [['arch', '建筑资料', 'From Architect', 6], ['land', '景观资料', 'From Landscape', 8], ['int', '室内资料', 'From Interior', 11], ['brief', '销售 / 需求', 'From Sales / Brief', 2]]);
  assert.equal(CGI_ANI_CHECKLIST.reduce((n, g) => n + g[3].length, 0), 27);
});

test('REQ-058 §3 · 新建「效果图 + 动画」不勾室内:3 组(建筑 6 / 景观 8 / 销售·需求 2),每项都标两个业务,没有重复', () => {
  const p = mk(['cgi', 'ani']);
  assert.deepEqual(shape(p), [['arch', '建筑资料', 6], ['land', '景观资料', 8], ['brief', '销售 / 需求', 2]]);
  assert.ok(items(p).every((it) => (it.svcs || []).join() === 'cgi,ani'), '每项同时标效果图、动画');
  const names = items(p).map((it) => it.zh);
  assert.equal(new Set(names).size, names.length, '没有重复项');
  assert.equal((p.checklist || []).length, 4, '室内资料照样生成、存在项目里');
  assert.equal(p.includeInterior, undefined);
  assert.equal(clStats(p).total, 16, '完成率 / 待处理只算看得见的 16 项');
  assert.equal(infoProgress(p).total, 16);
});

test('REQ-058 §3 · 勾上「包含室内部分」:多出室内资料 11 项、两段小标题;建好后关掉,隐藏、不计数,再打开状态还在', () => {
  const p = mk(['cgi', 'ani'], { includeInterior: true });
  assert.equal(p.includeInterior, true);
  assert.deepEqual(shape(p).map((x) => x[0]), ['arch', 'land', 'int', 'brief']);
  const int = (p.checklist || []).find((g) => g.key === 'int')!;
  assert.equal(int.items.length, 11);
  assert.deepEqual([...new Set(int.items.map((it) => it.sec))], ['单元 · 建筑方提供', '设计 · ID 方提供']);
  assert.deepEqual([...new Set(int.items.map((it) => it.secEn))], ['Unit · from Architect', 'Design · from ID']);
  assert.equal(int.items.filter((it) => it.sec === '单元 · 建筑方提供').length, 9);
  assert.equal(clStats(p).total, 27);
  /* 收到一项,然后关掉 */
  int.items[0].status = 'received';
  int.items[0].receipts = [{ id: 'r1', date: '2026-10-23', fileName: 'unit.pdf', from: '', via: 'Email', path: '', status: 'received', remark: '' } as never];
  act(JM, p, { type: 'setIncludeInterior', value: false });
  assert.equal(p.includeInterior, undefined);
  assert.ok(clGroupHidden(p, int) && !visibleGroups(p).includes(int));
  assert.equal(clStats(p).total, 16, '关掉后完成率不算它');
  assert.ok(p.log.some((l) => l.k === 'cl.interiorOff'), '写了日志');
  act(PD, p, { type: 'setIncludeInterior', value: true });
  assert.equal(int.items[0].status, 'received', '再打开,原来的状态还在');
  assert.equal(int.items[0].receipts!.length, 1, '收料记录也在');
  assert.ok(p.log.some((l) => l.k === 'cl.interiorOn'));
  /* 只有 PM / PD / BD 能开关 */
  p.engineer = 'Dylan';
  assert.throws(() => act(DYLAN, p, { type: 'setIncludeInterior', value: false }), PermissionError);
  assert.throws(() => act(SALES, p, { type: 'setIncludeInterior', value: false }), PermissionError);
});

test('REQ-058 §3 · 「效果图 + 动画 + 其他」:销售 / 需求里截止日只有一条;需求 / 规格、素材 / 参考只标「其他」', () => {
  const p = mk(['cgi', 'ani', 'others']);
  assert.deepEqual(shape(p).map((x) => x[0]), ['arch', 'land', 'brief']);
  assert.equal((p.checklist || []).length, 4, '存着的是 4 组(室内资料不勾时隐藏)');
  const brief = (p.checklist || []).find((g) => g.key === 'brief')!;
  assert.deepEqual(brief.items.map((it) => [it.zh, (it.svcs || []).join('/')]), [
    ['确认视角数量(外观 / 室内)/ 动画时长', 'cgi/ani'],
    ['最终截止日', 'cgi/ani/others'],
    ['需求 / 规格', 'others'],
    ['素材 / 参考', 'others'],
  ]);
  const q = mk(['cgi', 'ani', 'others'], { includeInterior: true });
  assert.deepEqual(shape(q).map((x) => x[0]), ['arch', 'land', 'int', 'brief'], '勾上室内就是 4 组');
});

test('REQ-058 §3 · 「效果图 + 沙盘」:建筑资料、景观资料各一组,同义项合成一条;沙盘的「场地/市场/需求」单独一组', () => {
  const p = mk(['cgi', 'scale']);
  assert.deepEqual(shape(p).map((x) => x[1]), ['建筑资料', '景观资料', '销售 / 需求', '场地/市场/需求']);
  const svcsOf = (zh: string) => (items(p).find((it) => it.zh === zh)?.svcs || []).join('/');
  assert.equal(svcsOf('最终 CAD + 3D 模型(至少 WP 审批版)'), 'cgi/scale', '「最终 CAD + 3D 模型」和沙盘的「最终 CAD + SKP…」合成一条');
  assert.ok(!items(p).some((it) => it.zh === '最终 CAD + SKP + 平面/立面/屋顶'));
  for (const zh of ['种植布局 + 参考', '景观铺地材质 + 参考', '灯光布局 + 灯具 + 参考', '场地竖向(详细标高图)', '彩色总平(标注设施名)']) assert.equal(svcsOf(zh), 'cgi/scale', zh);
  assert.equal(svcsOf('门窗表'), 'scale');
  assert.equal(svcsOf('其他软装(家具/设备)'), 'scale', '宁少勿多:不确定的不合');
});

test('REQ-058 §3 · 3D VR/720、单元模型:自动包含室内资料;没有「建筑 / ID」组', () => {
  for (const svc of ['vrar', 'unitmodel']) {
    const p = mk([svc]);
    assert.ok(interiorOn(p) && hasInteriorGroup(p), svc);
    assert.deepEqual(shape(p).map((x) => x[0]), ['arch', 'int', 'brief'], svc);
    assert.ok(!(p.checklist || []).some((g) => g.group === '建筑 / ID'), svc);
  }
  const v = mk(['vrar']);
  assert.deepEqual((v.checklist || []).find((g) => g.key === 'arch')!.items.map((it) => it.zh), ['立面信息 Façade', '立面图 Elevations']);
  const u = mk(['unitmodel']);
  assert.deepEqual((u.checklist || []).find((g) => g.key === 'arch')!.items.map((it) => it.zh), ['立面图', '玻璃色 / 墙色']);
  /* 效果图 + 3D VR/720:室内也自动包含(VR 本来就做室内) */
  assert.ok(interiorOn(mk(['cgi', 'vrar'])));
});

test('REQ-058 §2.2 · 分项(sub)中英两套,只是显示用;REQ-050 的范围照旧', () => {
  const p = mk(['cgi']);
  const plant = items(p).find((it) => it.zh === '种植布局 + 参考')!;
  assert.deepEqual([plant.sub, plant.subEn], ['a. 灌木参考图 b. 乔木参考图', 'a. Shrubs reference images b. Trees reference images']);
  assert.equal(items(p).filter((it) => it.sub).length, 6, '立面分色 / 景观平面图 / 种植布局 / 景观铺地 / 详图 / 天花平面');
  assert.equal(items(p).find((it) => it.zh === '总平 / Google 地图(周边建筑)')!.sub, undefined, '没有分项的不写');
  assert.ok(items(p).every((it) => it.scope === 'proj'));
});

test('REQ-058 §2.1 · 分组先按 key、再按名字:改名不影响合并;老模板没有 key 照旧按名字', () => {
  assert.deepEqual(groupKeys({ group: '建筑资料', groupEn: 'From Architect', key: 'arch' }), ['key:arch', 'zh:建筑资料', 'en:fromarchitect']);
  const pk = (svc: string, groups: { group: string; groupEn: string; color: string; key?: string }[]) =>
    ({ svc, checklist: groups.map((g) => ({ ...g, items: [{ id: svc + g.group, zh: svc + '-' + g.group, en: '', status: 'pending', date: '', remark: '' }] })) }) as never;
  const m = mergeChecklists([
    pk('cgi', [{ group: '建筑资料', groupEn: 'From Architect', color: '#D98A2B', key: 'arch' }]),
    pk('scale', [{ group: '建筑资料(改过名)', groupEn: 'Architect docs', color: '#000', key: 'arch' }]),
    pk('ani', [{ group: '建筑方', groupEn: 'From Architect', color: '#111' }]),
  ], { tagOf: (s) => s });
  assert.equal(m.checklist.length, 1, '同 key 的合成一组;没 key 的按英文名也并进来');
  assert.equal(m.checklist[0].key, 'arch');
  assert.equal(m.checklist[0].items.length, 3);
});

test('REQ-058 §2.4 · 同义项:新名字并进原来的组,原来的名字不删;补了三组新的', () => {
  const flat = DEFAULT_SYNONYMS.flat();
  for (const n of ['确认 3D 模型 & CAD', '最终 CAD + 3D 模型', '景观图 + 详图', '家具与设备']) assert.ok(flat.includes(n), n);
  const grp = (n: string) => DEFAULT_SYNONYMS.find((g) => g.includes(n))!;
  assert.ok(grp('最终 CAD + 3D 模型(至少 WP 审批版)').includes('最终 CAD + SKP + 平面/立面/屋顶'));
  assert.deepEqual(grp('截止日'), ['截止日', '最终截止日']);
  assert.ok(grp('景观平面图').includes('景观平面(材料/种植/家具)') && grp('景观平面图').includes('景观图 + 详图'));
  assert.ok(grp('室外家具 / 健身 / 儿童设施布置 + 参考').includes('户外家具/健身/儿童设施 + 参考'));
});

test('REQ-058 §2.5 · 已有项目一个字都不改:老分组没有 key,室内开关不起作用', () => {
  const old = mk(['cgi', 'ani']);
  /* 模拟上线前建的项目:老的分组名、没有 key */
  old.checklist = [
    { group: '建筑方 · 室内/单元', groupEn: 'From Architect (Interior/Unit)', color: '#B26A2E', items: [{ id: 'a', zh: '木作立面', en: 'Carpentry', status: 'received', date: '', remark: '' }] },
    { group: 'ID 方 · 室内', groupEn: 'From ID (Interior)', color: '#6B4E9E', items: [{ id: 'b', zh: '设计概念/方案提报', en: 'Design concept', status: 'pending', date: '', remark: '' }] },
  ] as never;
  const before = JSON.stringify(old.checklist);
  assert.equal(hasInteriorGroup(old), false);
  assert.equal(visibleGroups(old).length, 2, '老项目的「室内」分组照常显示');
  assert.equal(clStats(old).total, 2);
  assert.equal(JSON.stringify(old.checklist), before);
});

const oldCgi: Template = { schedule: [['A', 'x', 'y', 'z', 'PM', 2, '2 周', ' ', false]], checklist: [['建筑方 · 外观', 'From Architect (Exterior)', '#D98A2B', [['Siteplan / google map', '建周边建筑'], ['我自己加的', 'Mine']]]] };
test('REQ-058 §2.5 · 模板覆盖预演:覆盖过的只换清单、排期保留;没受影响的(LED)不动;已经是新的不重复改', () => {
  assert.ok(changed058('cgi') && changed058('scale') && changed058('drone') && !changed058('led') && !changed058('projector'));
  const led: Template = { schedule: [], checklist: [['客户', 'Client', '#000', [['地址', 'Address']]]] };
  const plan = plan058([
    { svc: 'cgi', data: oldCgi },
    { svc: 'led', data: led },
    { svc: 'ani', data: { schedule: [], checklist: structuredClone(CGI_ANI_CHECKLIST) } },
  ], null);
  assert.deepEqual(plan.templates.map((e) => e.svc), ['cgi']);
  assert.equal(plan.synonyms, null, '同义项没存过:默认那份已经含新的');
  const after = apply058(oldCgi, plan.templates[0]);
  assert.deepEqual(after.schedule, oldCgi.schedule, '排期保留覆盖值');
  assert.deepEqual(after.checklist, CGI_ANI_CHECKLIST);
  const md = report058(plan, { title: 'T', when: 'now' });
  assert.match(md, /1 个业务要换清单/);
  assert.match(md, /我自己加的/, '换之前列出原来的项');
  assert.match(md, /\*\*建筑资料\*\* From Architect `arch`\(6 项\)/);
  assert.match(report058(plan058([{ svc: 'led', data: led }], null), { title: 'T', when: 'now' }), /无覆盖,直接生效/);
});

test('REQ-058 §2.5 · PD 存过同义项:把新加的并进去,原来的一条不删', () => {
  const saved = [['最终 CAD + 3D 模型', '确认 3D 模型 & CAD'], ['PD 自己加的', '自己的同义']];
  const plan = plan058([], saved);
  assert.ok(plan.synonyms);
  const after = plan.synonyms!.after;
  assert.ok(after.find((g) => g.includes('确认 3D 模型 & CAD'))!.includes('最终 CAD + 3D 模型(至少 WP 审批版)'));
  assert.ok(after.some((g) => g.join() === 'PD 自己加的,自己的同义'), '原来的一条不删');
  assert.ok(after.some((g) => g.includes('截止日') && g.includes('最终截止日')));
  assert.ok(plan.synonyms!.added.includes('最终 CAD + 3D 模型(至少 WP 审批版)'));
  assert.equal(plan058([], plan.synonyms!.after).synonyms, null, '再跑一次没有要补的');
});
