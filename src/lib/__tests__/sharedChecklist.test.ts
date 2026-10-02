import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPackage, infoProgress, migrate, newProject } from '../project.ts';
import { ALL, clStats, dropSvc, mergeIntoProject, replaceSection, restoreRemoved } from '../sharedChecklist.ts';
import type { Project } from '../types.ts';

const names = (p: Project) => (p.checklist || []).flatMap((g) => g.items.map((i) => i.zh));
const find = (p: Project, zh: string) => (p.checklist || []).flatMap((g) => g.items).find((i) => i.zh === zh)!;

test('REQ-044 新建 CGI + 动画:一张清单,同义项只出现一次并挂两个服务', () => {
  const p = newProject({ name: 'T', client: '', services: ['cgi', 'ani'], start: '' } as any);
  assert.ok(p.packages.every((k) => k.checklist === undefined), '服务包上不再有清单');
  const cad = find(p, '最终 CAD + 3D 模型');
  assert.deepEqual(cad.svcs, ['cgi', 'ani']);
  assert.ok(!names(p).includes('确认 3D 模型 & CAD'), '动画那一项并进来了');
  const cgiOnly = (p.checklist || []).flatMap((g) => g.items).filter((i) => i.svcs!.length === 1 && i.svcs![0] === 'cgi').length;
  assert.ok(cgiOnly > 10);
});

test('REQ-044 加服务包:同名项不重复只加标签;删服务包只去标签,专属项进「已移除的项」可恢复', () => {
  const p = newProject({ name: 'T', client: '', services: ['cgi'], start: '' } as any);
  const before = names(p).length;
  p.packages.push({ svc: 'scale', start: '', delivery: '', buffer: 0, owner: '', status: 'active', schedule: [] });
  const r = mergeIntoProject(p, buildPackage('scale', '').checklist!, () => ['scale']);
  assert.ok(r.tagged >= 5 && r.added > 10, JSON.stringify(r));
  assert.equal(names(p).length, before + r.added);
  assert.deepEqual(find(p, '最终 CAD + 3D 模型').svcs, ['cgi', 'scale']);
  /* 在沙盘里把 CAD 确认 —— CGI 看到的是同一条 */
  find(p, '最终 CAD + 3D 模型').status = 'confirmed';
  assert.equal(clStats(p, 'cgi').done, 1);
  assert.equal(clStats(p, 'scale').done, 1);
  assert.equal(infoProgress(p).done, 1, '整张清单每项只算一次');
  /* 删沙盘 */
  p.packages.pop();
  const moved = dropSvc(p, 'scale', { by: 'pd', reason: 'svc:scale' });
  assert.equal(moved, r.added);
  assert.equal(names(p).length, before);
  assert.deepEqual(find(p, '最终 CAD + 3D 模型').svcs, ['cgi']);
  assert.equal(find(p, '最终 CAD + 3D 模型').status, 'confirmed', '共用项的内容不丢');
  assert.equal(p.checklistRemoved!.length, r.added);
  const restored = restoreRemoved(p, 0, ALL)!;
  assert.ok(names(p).includes(restored.zh));
  assert.deepEqual(find(p, restored.zh).svcs, ['cgi'], '原服务已经没了 → 挂当前项目的服务');
});

test('REQ-044 第二块 LED:重名项单独一条、名字后加实例名;删掉它只移走它自己的', () => {
  const p = newProject({ name: 'T', client: '', services: ['led'], start: '' } as any);
  const before = names(p).length;
  p.packages.push({ svc: 'led', label: '户外 LED', start: '', delivery: '', buffer: 0, owner: '', status: 'active', schedule: [] });
  const r = mergeIntoProject(p, buildPackage('led', '').checklist!, () => ['led'], { inst: '户外 LED' });
  assert.equal(r.added, before);
  assert.ok(names(p).includes('电源规格与位置(户外 LED)'));
  assert.equal(find(p, '电源规格与位置(户外 LED)').inst, '户外 LED');
  p.packages.pop();
  const moved = dropSvc(p, 'led', { by: 'pd', reason: 'svc:led', keepSvc: true, inst: '户外 LED' });
  assert.equal(moved, before);
  assert.equal(names(p).length, before);
});

test('REQ-044 套用模板(某个服务):只换这个服务的专属项,共用项保留内容', () => {
  const p = newProject({ name: 'T', client: '', services: ['cgi', 'scale'], start: '' } as any);
  const cad = find(p, '最终 CAD + 3D 模型');
  cad.status = 'received'; cad.remark = '保留我';
  const custom = (p.checklist || [])[0].items.find((i) => i.svcs!.join() === 'scale');
  const r = replaceSection(p, 'scale', buildPackage('scale', '').checklist!, () => ['scale'], { by: 'pd', reason: 'reset' });
  assert.ok(r.moved > 0);
  assert.equal(find(p, '最终 CAD + 3D 模型').remark, '保留我');
  assert.deepEqual(find(p, '最终 CAD + 3D 模型').svcs, ['cgi', 'scale']);
  void custom;
});

test('REQ-044 读老数据时兜底合并:checklistLegacy 原样在', () => {
  const old: any = {
    id: 'x', name: 'Old', services: ['cgi', 'scale'], packages: [buildPackage('cgi', ''), buildPackage('scale', '')],
  };
  old.packages[0].checklist[0].items[0].status = 'confirmed';
  let reported = 0;
  const p = migrate(old, { onChecklistMigrated: () => { reported++; } });
  assert.equal(reported, 1);
  assert.ok(Array.isArray(p.checklist) && p.checklist.length);
  assert.equal(p.checklistLegacy!.length, 2);
  assert.ok(p.packages.every((k) => k.checklist === undefined));
  assert.ok((p.checklist || []).every((g) => g.items.every((i) => Array.isArray(i.svcs) && i.id)));
  assert.equal(migrate(p).checklist!.length, p.checklist!.length, '第二次读不再动');
});
