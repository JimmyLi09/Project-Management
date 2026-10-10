import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPackage, newId, newProject } from '../project.ts';
import { migrateProject050, pkgLabel, report050, stripInst } from '../mig050.ts';
import { scopeOf, tplNamesFrom } from '../checklistScope.ts';
import type { ChecklistItem, Project, ReceiptRecord } from '../types.ts';

const PD = { name: 'PD', role: 'director' } as never;
/* 上线前(REQ-044 那一版)加第二份同类业务的样子:模板整份再并一次,重名的项另起一条、
   名字后加「(#2)」或实例名,打上 inst。服务包也还没有 id。 */
const addPkg = (p: Project, svc: string, label = '') => {
  p.packages.push({ svc, label: label || undefined, start: '', delivery: '', buffer: 0, owner: '', status: 'active', schedule: [] });
  const nth = p.packages.filter((x) => x.svc === svc).length;
  const inst = label || `#${nth}`;
  for (const tg of buildPackage(svc, '').checklist!) {
    const g = p.checklist!.find((x) => x.group === tg.group) || (p.checklist!.push({ ...tg, items: [] }), p.checklist![p.checklist!.length - 1]);
    for (const src of tg.items) {
      const clash = items(p).some((x) => x.zh === src.zh || x.zh.startsWith(src.zh + '('));
      g.items.push({ ...src, id: newId(), svcs: [svc], inst, receipts: [], zh: clash ? `${src.zh}(${inst})` : src.zh, en: clash && src.en ? `${src.en} (${inst})` : src.en, scope: undefined });
    }
  }
  p.packages.forEach((pk) => { delete pk.id; });
};
const items = (p: Project) => p.checklist!.flatMap((g) => g.items);
const find = (p: Project, zh: string) => items(p).find((x) => x.zh.startsWith(zh))!;
const rc = (id: string, date: string, status: ReceiptRecord['status'], fileName: string): ReceiptRecord =>
  ({ id, date, fileName, from: '', via: 'email', path: '', status, remark: '', at: Date.parse(date), by: 'PM' });
const fill = (it: ChecklistItem, status: ChecklistItem['status'], receipts: ReceiptRecord[] = [], remark = '') => {
  it.status = status; it.receipts = receipts; it.remark = remark;
  if (receipts[0]) { it.date = receipts[0].date; it.received = receipts[0].fileName; }
};

/* 143-Royal Plaza LED 那种:先一块 LED,再加第二块 → 模板整份再并一次,出现 11 条「(#2)」 */
function royalPlaza() {
  const p = newProject({ name: '143-Royal Plaza LED', client: 'X', services: ['led'], start: '' } as never);
  addPkg(p, 'led');
  assert.equal(items(p).filter((x) => x.inst === '#2').length, 11, '迁移前:第二块 LED 的 11 项都是 (#2)');
  return p;
}

test('REQ-050 迁移:143-Royal Plaza 没有任何 (#2) 项;规格项各两格,项目级只有一条', () => {
  const p = royalPlaza();
  const size1 = find(p, '屏幕尺寸'), size2 = items(p).find((x) => x.zh.startsWith('屏幕尺寸') && x.inst)!;
  fill(size1, 'confirmed', [rc('r1', '2026-09-01', 'confirmed', 'P2.5 4x3m.pdf')]);
  fill(size2, 'received', [rc('r2', '2026-09-05', 'received', 'P3 6x2m.pdf'), rc('r3', '2026-09-02', 'revision', 'P3 v0.pdf')]);
  const addr1 = find(p, '项目地址'), addr2 = items(p).find((x) => x.zh.startsWith('项目地址') && x.inst)!;
  fill(addr1, 'pending', [], '等 Main Con');
  fill(addr2, 'received', [rc('r4', '2026-09-03', 'received', 'site address.docx')], '1 Marina Blvd');
  const before = JSON.stringify(p.checklist);

  const m = migrateProject050(p)!;
  assert.deepEqual(m.problems, [], '自检通过');
  assert.equal(items(p).filter((x) => x.inst || /\(#\d+\)$/.test(x.zh)).length, 0, '没有任何 (#2) 项');
  assert.equal(items(p).length, 11);
  const ids = p.packages.map((x) => x.id!);
  assert.ok(ids.every(Boolean) && new Set(ids).size === 2, '两份服务包都有 id');

  for (const n of ['屏幕尺寸', '是否含铁架', 'LED/DB Box/电脑 放置位置']) {
    const it = find(p, n);
    assert.deepEqual(Object.keys(it.cells || {}), ids, `${n}:LED-1 / LED-2 两格,按服务包 id`);
    assert.equal(it.scope, 'inst');
  }
  const size = find(p, '屏幕尺寸');
  assert.equal(size.cells![ids[0]].status, 'confirmed');
  assert.equal(size.cells![ids[1]].status, 'received', '第 2 格是原来 (#2) 那条的状态');
  assert.deepEqual(size.cells![ids[1]].receipts!.map((r) => r.id), ['r2', 'r3'], '第 2 格的收料记录原样');
  assert.equal(size.id, size1.id, '原项的 id 留下(链接不变)');

  for (const n of ['项目地址', 'Showflat 图纸', '时间节点']) {
    const hits = items(p).filter((x) => x.zh.startsWith(n));
    assert.equal(hits.length, 1, `${n} 只有一条`);
    assert.ok(!hits[0].cells && hits[0].scope === 'proj');
  }
  const addr = find(p, '项目地址');
  assert.equal(addr.status, 'received', '项目级保留最靠后的状态(第二份已收到 > 第一份待处理)');
  assert.equal(addr.remark, '1 Marina Blvd');
  assert.deepEqual(addr.receipts!.map((r) => r.id), ['r4']);
  assert.equal(addr.history!.length, 1, '没被采用的那份进修改记录');
  assert.equal(addr.history![0].data!.remark, '等 Main Con');
  assert.equal(addr.history![0].cell, 'LED-1');

  assert.equal(m.receiptsBefore, 4);
  assert.equal(m.receiptsAfter, 4, '收料记录一条不少');
  assert.equal(JSON.stringify(p.checklistLegacy050), before, '迁移前原样备份');
  assert.equal(migrateProject050(p), null, '只跑一次');
  assert.match(report050([m], { title: 'T', when: 'now' }), /一行分格:LED-1 已确认 \/ LED-2 已收到/);
});

test('REQ-050 迁移:项目级合并不降级 —— 第一份已确认、第二份待处理时留第一份,第二份空的不进修改记录', () => {
  const p = royalPlaza();
  fill(find(p, 'Showflat 图纸'), 'confirmed', [rc('a', '2026-08-01', 'confirmed', 'SF.pdf')]);
  const m = migrateProject050(p)!;
  const sf = find(p, 'Showflat 图纸');
  assert.equal(sf.status, 'confirmed');
  assert.equal((sf.history || []).length, 0);
  assert.deepEqual(m.problems, []);
});

test('REQ-050 迁移:实例名后来改过、#N 和名字混用都对得上;对不上的不动', () => {
  const p = newProject({ name: 'Twin', client: '', services: ['led'], start: '' } as never);
  addPkg(p, 'led', '户外 LED');
  addPkg(p, 'led');
  assert.ok(items(p).some((x) => x.inst === '户外 LED') && items(p).some((x) => x.inst === '#3'));
  p.packages[1].label = '户外大屏';   // 改了实例名:inst 还是旧名字
  const stray = { ...find(p, '下单确认'), id: 'stray', zh: '下单确认(#9)', inst: '#9', svcs: ['led'] };
  p.checklist![p.checklist!.length - 1].items.push(stray as ChecklistItem);
  const m = migrateProject050(p)!;
  const size = find(p, '屏幕尺寸');
  assert.equal(Object.keys(size.cells!).length, 3, '三块屏三格');
  assert.deepEqual(p.packages.map((pk) => pkgLabel(p, pk)), ['LED-1', '户外大屏', 'LED-3'], '标签:有实例名用实例名,否则 LED-n');
  assert.deepEqual(m.unresolved.map((u) => u.inst), ['#9'], '对不上服务包的列出来');
  assert.ok(items(p).some((x) => x.id === 'stray'), '对不上的不动');
  assert.deepEqual(m.problems, []);
});

test('REQ-050 迁移:第一块屏删掉后只剩一份,规格项也合成一条;多份业务里没有 (#N) 的规格项补空格', () => {
  const p = royalPlaza();
  p.packages.splice(0, 1);   // 只剩第二块(它的项还是 #2)
  const m1 = migrateProject050(p)!;
  assert.ok(items(p).every((x) => !x.cells), '只剩一份:不分格');
  assert.ok(m1.families.some((f) => f.note && /只剩一份/.test(f.note)));

  const q = newProject({ name: 'Q', client: '', services: ['led'], start: '' } as never);
  q.packages.push({ ...JSON.parse(JSON.stringify(q.packages[0])), label: 'Lobby' });   // 老数据:第二份没带 (#N) 项
  q.packages.forEach((pk) => { delete pk.id; });   // 上线前的服务包没有 id
  const m2 = migrateProject050(q)!;
  assert.equal(Object.keys(find(q, '屏幕尺寸').cells!).length, 2);
  assert.equal(m2.blank.filter((b) => b.label === 'Lobby').length, 6, '6 个规格项各补一格空的');
  assert.equal(find(q, '项目地址').cells, undefined);

  const plain = newProject({ name: 'Plain', client: '', services: ['cgi', 'ani'], start: '' } as never);
  const m3 = migrateProject050(plain)!;
  assert.equal(m3.families.length + m3.blank.length, 0);
  assert.equal(plain.checklistLegacy050, undefined, '清单没动的项目不另存备份');
  assert.ok(plain.mig050 && plain.packages.every((pk) => pk.id), '但也记了跑过、补了服务包 id');
});

test('REQ-050 范围:模板规格项表、PD 存过的模板、按名字猜、默认项目级', () => {
  assert.equal(scopeOf({ zh: '屏幕尺寸与类型(P3/P2.5等)', en: '' }, ['led']).why, 'template');
  assert.equal(scopeOf({ zh: '时间节点(装架/装屏/开盘)', en: '' }, ['led']).scope, 'proj');
  assert.equal(scopeOf({ zh: '需求 / 规格', en: '' }, ['tv']).scope, 'inst', '没有专属模板的业务用通用模板');
  assert.deepEqual(scopeOf({ zh: '箱体尺寸', en: '' }, ['led']), { scope: 'inst', why: 'hint' });
  assert.deepEqual(scopeOf({ zh: '项目地址图纸规格', en: '' }, ['led']), { scope: 'proj', why: 'hint' }, '地址 / 图纸优先算项目级');
  assert.deepEqual(scopeOf({ zh: '客户喜好', en: '' }, ['led']), { scope: 'proj', why: 'default' });
  assert.equal(scopeOf({ zh: '客户喜好', en: '', scope: 'inst' }, ['led']).why, 'item');
  const saved = tplNamesFrom({ led: { checklist: [['A', 'A', '#000', [['箱体尺寸', 'Cabinet']]]] } });
  assert.deepEqual(scopeOf({ zh: '箱体尺寸', en: '' }, ['led'], saved), { scope: 'proj', why: 'template' }, 'PD 存过的模板里有、规格项表里没有 = 项目级');
  assert.equal(stripInst('电源规格与位置(户外 LED)', '户外 LED'), '电源规格与位置');
  assert.equal(stripInst('Power (#2)', '#2'), 'Power');
});

import { applyAction } from '../../server/actions.ts';
import { getBuiltinTemplate } from '../templates.ts';
import { clStats } from '../sharedChecklist.ts';
import { applyChecklist, extractChecklist } from '../../server/fragments.ts';
import { renameInProject } from '../peopleRefs.ts';

const act = (p: Project, a: unknown) => applyAction(PD, p, a as never, { tplForSvc: getBuiltinTemplate });
const asNew = (p: Project, svc: string, label = '') => act(p, { type: 'addServicePackage', svc, patch: {}, asNew: true, label });

test('REQ-050 验收:再加一块 LED → 规格项多一格 LED-3、不新增行;删掉 LED-2 → 只少那一格', () => {
  const p = royalPlaza();
  migrateProject050(p);
  const rows = items(p).length;
  asNew(p, 'led');
  assert.equal(items(p).length, rows, '不新增行');
  const size = find(p, '屏幕尺寸');
  assert.deepEqual(Object.keys(size.cells!).map((k) => pkgLabel(p, p.packages.find((x) => x.id === k)!)), ['LED-1', 'LED-2', 'LED-3']);
  assert.equal(find(p, '项目地址').cells, undefined, '项目级仍是一条');
  const k2 = p.packages[1].id!;
  act(p, { type: 'setClStatus', item: size.id, cell: k2, value: 'received' });
  act(p, { type: 'removeServicePackage', pkg: 1 });
  const after = find(p, '屏幕尺寸');
  assert.equal(Object.keys(after.cells!).length, 2, '只少那一格');
  assert.ok(!after.cells![k2]);
  assert.equal(after.history![0].cell, 'LED-2', '有内容的那一格进修改记录,标明是哪一份');
  assert.equal(after.history![0].data!.status, 'received');
  assert.deepEqual(Object.keys(after.cells!).map((k) => pkgLabel(p, p.packages.find((x) => x.id === k)!)), ['LED-1', 'LED-2'], '标签跟着服务包走(原来的 LED-3 现在是 LED-2)');
  act(p, { type: 'removeServicePackage', pkg: 1 });
  assert.equal(find(p, '屏幕尺寸').cells, undefined, '只剩一份:收回成一条');
});

test('REQ-050 验收:分格的项按格改 —— 不带格会被拒;收料记录记在那一格;统计按格算', () => {
  const p = newProject({ name: 'Two', client: '', services: ['led', 'led'], start: '' } as never);
  assert.equal(items(p).filter((x) => /\(#\d\)/.test(x.zh)).length, 0, '新建两块 LED 的项目也不出 (#2)');
  const size = find(p, '屏幕尺寸');
  const [k1, k2] = p.packages.map((x) => x.id!);
  assert.throws(() => act(p, { type: 'setClStatus', item: size.id, value: 'received' }), /分格了/);
  act(p, { type: 'addReceipt', item: size.id, cell: k2, rec: { date: '2026-10-01', fileName: 'LED2.pdf', status: 'received' } });
  assert.equal(size.cells![k2].status, 'received');
  assert.equal(size.cells![k2].receipts!.length, 1);
  assert.equal(size.cells![k1].receipts!.length, 0);
  assert.equal(size.status, 'pending', '行上跟第一格');
  const st = clStats(p, 'led');
  assert.equal(st.total, 11 + 6, '11 项里 6 项是规格项,各两格');
  act(p, { type: 'editCl', item: size.id, cell: k1, field: 'remark', value: 'P2.5 4x3m' });
  assert.equal(size.cells![k1].remark, 'P2.5 4x3m');
  assert.equal(size.remark, 'P2.5 4x3m');
  act(p, { type: 'editCl', item: size.id, field: 'zh', value: '屏幕尺寸与类型' });
  assert.equal(size.zh, '屏幕尺寸与类型', '名字是整行的,不用带格');
});

test('REQ-050 验收:171-50JHS「景观平面」切成单独填 → 三格各自改状态;改回同步以 CGI 为准,其余进修改记录', () => {
  const p = newProject({ name: '171-50JHS', client: '', services: ['cgi', 'ani', 'scale'], start: '' } as never);
  const it = find(p, '景观平面');
  act(p, { type: 'setItemSvcs', item: it.id, svcs: ['cgi', 'ani', 'scale'] });
  act(p, { type: 'setClStatus', item: it.id, value: 'received' });
  /* 同步(默认):在任一标签下改,各标签看到同一份 */
  for (const s of ['cgi', 'ani', 'scale']) assert.equal(clStats(p, s).total >= 1 && unitsStatus(p, it.id!, s), 'received');
  act(p, { type: 'setClMode', item: it.id, mode: 'sep' });
  assert.deepEqual(Object.keys(it.cells!), ['cgi', 'ani', 'scale'], '每个业务一格');
  assert.ok(Object.values(it.cells!).every((c) => c.status === 'received'), '切换时每个业务先复制一份当前内容');
  act(p, { type: 'setClStatus', item: it.id, cell: 'cgi', value: 'confirmed' });
  act(p, { type: 'editCl', item: it.id, cell: 'cgi', field: 'remark', value: 'CGI 用总平' });
  act(p, { type: 'setClStatus', item: it.id, cell: 'scale', value: 'revision' });
  act(p, { type: 'editCl', item: it.id, cell: 'scale', field: 'remark', value: '沙盘只要主干树位置' });
  assert.deepEqual(['cgi', 'ani', 'scale'].map((s) => unitsStatus(p, it.id!, s)), ['confirmed', 'received', 'revision'], '三格各自的状态');
  act(p, { type: 'setClMode', item: it.id, mode: 'sync', from: 'cgi' });
  assert.equal(it.cells, undefined);
  assert.equal(it.status, 'confirmed');
  assert.equal(it.remark, 'CGI 用总平', '内容变成 CGI 那份');
  assert.ok(it.history!.some((h) => h.k === 'mode.sync' && h.data?.remark === '沙盘只要主干树位置'), '沙盘那份在修改记录里');
  assert.ok(it.history!.some((h) => h.k === 'mode.sync' && h.cell === '动画'));
  assert.ok(p.log!.some((l) => (l as { k?: string }).k === 'cl.modeSync'));
  assert.throws(() => act(p, { type: 'setClMode', item: find(p, '立面材料分区').id, mode: 'sep' }), /只适用于一个业务/);
});
const unitsStatus = (p: Project, id: string, scope: string) => {
  const it = items(p).find((x) => x.id === id)!;
  return it.cells ? Object.entries(it.cells).find(([k]) => k === scope)?.[1].status : it.status;
};

test('REQ-050 从别的项目导入清单:规格项的格按「第几份」对过去;负责人改名每格都改', () => {
  const a = newProject({ name: 'A', client: '', services: ['led', 'led'], start: '' } as never);
  const size = find(a, '屏幕尺寸');
  act(a, { type: 'editCl', item: size.id, cell: a.packages[1].id, field: 'remark', value: '第二块' });
  act(a, { type: 'editCl', item: size.id, cell: a.packages[1].id, field: 'owner', value: 'Kevin' });
  const frag = extractChecklist(a, 'led', true);
  const fragSize = frag.checklist.flatMap((g) => g.items).find((x) => x.zh.startsWith('屏幕尺寸'))!;
  assert.deepEqual(Object.keys(fragSize.cells!), ['@1', '@2']);
  const b = newProject({ name: 'B', client: '', services: ['led', 'led'], start: '' } as never);
  applyChecklist(b, 'led', frag, 'replace', true, 'PD');
  const bSize = find(b, '屏幕尺寸');
  assert.deepEqual(Object.keys(bSize.cells!), b.packages.map((x) => x.id));
  assert.equal(bSize.cells![b.packages[1].id!].remark, '第二块');
  renameInProject(b, 'Kevin', 'Kevin Lee');
  assert.equal(bSize.cells![b.packages[1].id!].owner, 'Kevin Lee');
});
