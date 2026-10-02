import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChecklistGroup, ChecklistItem, ReceiptRecord } from '../types.ts';
import { mergeChecklists, mergeStatus, migrateProjectChecklist, normName, verifyMerge, DEFAULT_SYNONYMS } from '../checklistMerge.ts';

const rc = (date: string, fileName: string, status: ReceiptRecord['status'], at = 1): ReceiptRecord =>
  ({ id: 'r' + date + fileName, date, fileName, from: '', via: '', path: '', status, remark: '', at, by: 'x' });
const item = (id: string, zh: string, o: Partial<ChecklistItem> = {}): ChecklistItem =>
  ({ id, zh, en: '', status: 'pending', date: '', remark: '', owner: '', shots: [], receipts: [], ...o });
const grp = (group: string, items: ChecklistItem[]): ChecklistGroup => ({ group, groupEn: '', color: '#000', items });
const tagOf = (svc: string, label?: string) => svc + (label ? ' · ' + label : '');

test('REQ-044 同名判断:去空格、标点、大小写', () => {
  assert.equal(normName(' Siteplan / Google Map '), normName('siteplan google-map'));
  assert.equal(normName('场地竖向（详细标高）'), normName('场地竖向(详细标高)'));
});

test('REQ-044 状态取最靠后的,N/A 只在全是 N/A 时保留', () => {
  assert.equal(mergeStatus(['received', 'confirmed', 'pending']), 'confirmed');
  assert.equal(mergeStatus(['na', 'pending']), 'pending');
  assert.equal(mergeStatus(['na', 'na']), 'na');
  assert.equal(mergeStatus(['revision', 'received']), 'received');
  assert.equal(mergeStatus(['rejected', 'pending']), 'rejected');
});

test('REQ-044 CGI + 沙盘:同义项合成一条,已确认不降级,备注都留,记录合并去重', () => {
  const shared = rc('2026-09-10', 'CAD_v01.dwg', 'received');
  const pkgs = [
    { svc: 'cgi', checklist: [grp('建筑方', [
      item('a1', '最终 CAD + 3D 模型', { status: 'confirmed', date: '2026-09-10', remark: 'CGI 用 v01', receipts: [shared], shots: ['data:image/png;base64,AA'] }),
      item('a2', 'Siteplan / google map'),
    ])] },
    { svc: 'scale', checklist: [grp('建筑方', [
      item('b1', '最终 CAD + SKP + 平面/立面/屋顶', { status: 'received', date: '2026-09-20', remark: '沙盘以 SKP 为准', owner: '李四', receipts: [{ ...shared, id: 'other' }, rc('2026-09-20', 'CAD_v02.dwg', 'received', 2)] }),
      item('b2', '比例 Scale'),
    ])] },
  ];
  const r = mergeChecklists(pkgs, { tagOf });
  assert.equal(r.sourceItems, 4);
  assert.equal(r.items, 3);
  assert.equal(r.checklist.length, 1, '同名分组合成一组');
  const cad = r.checklist[0].items[0];
  assert.equal(cad.id, 'a1', '保留第一份的 id');
  assert.deepEqual(cad.svcs, ['cgi', 'scale']);
  assert.equal(cad.status, 'confirmed');
  assert.equal(cad.date, '2026-09-20');
  assert.equal(cad.owner, '李四');
  assert.match(cad.remark, /^\[cgi\] CGI 用 v01\n\[scale\] 沙盘以 SKP 为准$/);
  assert.equal(cad.receipts!.length, 2, '完全相同的那条只留一份');
  assert.equal(cad.receipts![0].fileName, 'CAD_v02.dwg', '按时间倒序');
  assert.equal(cad.received, 'CAD_v02.dwg', '收到内容跟最新一条记录(否则下次改状态会把文件名写进别人的记录)');
  assert.equal(cad.shots!.length, 1);
  assert.deepEqual(r.merged.map((m) => m.name), ['最终 CAD + 3D 模型']);
  assert.deepEqual(verifyMerge(pkgs, r.checklist), []);
});

test('REQ-044 同一种服务两份(两块 LED):不合,第二份重名项名字后加实例名', () => {
  const led = () => [grp('现场', [item('x' + Math.random(), '电源规格与位置')])];
  const r = mergeChecklists([{ svc: 'led', checklist: led() }, { svc: 'led', label: '户外 LED', checklist: led() }], { tagOf });
  assert.deepEqual(r.checklist[0].items.map((i) => i.zh), ['电源规格与位置', '电源规格与位置(户外 LED)']);
  assert.equal(r.merged.length, 0);
});

test('REQ-044 迁移:checklistLegacy 原样备份,服务包上的清单移走,已是新结构的不再动', () => {
  const p: any = {
    id: 'p1', name: 'P', packages: [
      { svc: 'cgi', checklist: [grp('A', [item('i1', '项 1', { status: 'confirmed' })])], noCategories: true },
      { svc: 'ani', checklist: [grp('A', [item('i2', '项 1')])], noCategories: true },
    ],
  };
  const before = JSON.stringify(p.packages.map((k: any) => k.checklist));
  const m = migrateProjectChecklist(p, { tagOf, synonyms: DEFAULT_SYNONYMS });
  assert.ok(m);
  assert.equal(JSON.stringify(p.checklistLegacy.map((k: any) => k.checklist)), before);
  assert.ok(p.packages.every((k: any) => k.checklist === undefined && k.noCategories === undefined));
  assert.equal(p.noCategories, true);
  assert.equal(p.checklist[0].items.length, 1);
  assert.deepEqual(m!.problems, []);
  assert.equal(migrateProjectChecklist(p, { tagOf }), null);
});
