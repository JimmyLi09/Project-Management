import test from 'node:test';
import assert from 'node:assert/strict';
import { blankRow, ensureJobRows, isHeaderRow, jobGroups, jobHeaderMap, parseTsv, rowsFromPaste, serviceItemOf } from '../jobRecord.ts';
import { newProject } from '../project.ts';
import type { Project } from '../types.ts';

const proj = (services: string[]): Project => newProject({ name: 'T', client: 'C', services, start: '' } as never);

test('REQ-049 每种业务至少 1 行,Service Item 预填英文业务名;同类两份 = 一组「× 2」', () => {
  const p = proj(['cgi', 'ani', 'led', 'led', 'drone']);
  delete p.jobRecord;
  ensureJobRows(p);
  const g = jobGroups(p);
  assert.deepEqual(g.map((x) => [x.svc, x.count, x.rows.length]), [['cgi', 1, 1], ['ani', 1, 1], ['led', 2, 1], ['drone', 1, 1]]);
  assert.deepEqual(g.map((x) => x.rows[0].item), ['Perspectives', 'Animation', 'LED Display', 'Drone & 360 IPM']);
  assert.equal(ensureJobRows(p), 0, '已经有了不再加');
  assert.equal(serviceItemOf('scale'), 'Scale Model');
});

test('REQ-049 粘贴:Excel 4 栏 / 3 栏、表头跳过、合并格接上一行、带引号的换行', () => {
  const p = proj(['cgi', 'ani']);
  ensureJobRows(p);
  const tsv = [
    'Service Item\tDetail\tQuantity\tSpecial Notes',
    'Perspectives\tHero - with surrounding\t2\tat least 5,000 px or suitable for hoarding up to 5 m height',
    '\tFacilities\t6\t',
    'Animation\t3-minutes animation (HD 1920 x 1080)\t180s\t"15s, 30s,\n60s cut-downs"',
    'Website\tLanding page\t1\t',
  ].join('\r\n');
  const rows = rowsFromPaste(tsv, p);
  assert.deepEqual(rows.map((r) => [r.svc, r.item, r.detail, r.qty]), [
    ['cgi', 'Perspectives', 'Hero - with surrounding', '2'],
    ['cgi', 'Perspectives', 'Facilities', '6'],
    ['ani', 'Animation', '3-minutes animation (HD 1920 x 1080)', '180s'],
    ['', 'Website', 'Landing page', '1'],
  ]);
  assert.equal(rows[2].note, '15s, 30s,\n60s cut-downs');
  const three = rowsFromPaste('Perspectives\tHero\tsee brief', p);
  assert.deepEqual([three[0].qty, three[0].note], ['', 'see brief'], '3 栏 = 没有 Quantity');
  assert.ok(isHeaderRow(['服务项目', '明细', '数量', '特别说明']));
  assert.ok(!isHeaderRow(['Perspectives', 'Hero', '2']));
  assert.deepEqual(parseTsv('a\t"b ""x"""\n\n c \t d'), [['a', 'b "x"'], ['c', 'd']]);
});

test('REQ-049 登记表导入认 4 栏表头(中英)', () => {
  assert.deepEqual(jobHeaderMap(['项目', 'Service Item', 'Detail', 'Quantity', 'Special Notes']), { item: 1, detail: 2, qty: 3, note: 4 });
  assert.deepEqual(jobHeaderMap(['项目名称', '服务项目', '明细', '数量', '特别说明']), { item: 1, detail: 2, qty: 3, note: 4 });
  assert.equal(jobHeaderMap(['项目', '尺寸', '点间距']), null);
  assert.equal(blankRow('drone').item, 'Drone & 360 IPM');
});

import { migrateProject049 } from '../mig049.ts';
import { baseDefOf, fieldsOf } from '../records.ts';

test('REQ-049 上线迁移:有值的旧字段一个字段一行,数量进 Quantity,其余进 Special Notes;原数据不动', () => {
  const p = proj(['led', 'led', 'drone', 'cgi']);
  delete p.jobRecord;
  p.packages[0].record = { status: 'installed', updatedAt: 1, siteAddress: '1 Marina Blvd', dimL: '6400', ledType: 'indoor', handoverDate: 'x' } as never;
  p.packages[1].label = 'Showflat LED';
  p.packages[1].record = { siteAddress: 'Showflat', removedCol: '3 sets' } as never;
  p.packages[3].scopeItems = [{ item: 'Hero - with surrounding', qty: '2', note: 'at least 5,000 px' }];
  const before = JSON.stringify(p.packages.map((pk) => [pk.record, pk.scopeItems]));
  const r = migrateProject049(p, (svc) => fieldsOf(baseDefOf(svc), {}), 5)!;
  const rows = p.jobRecord!;
  const led = rows.filter((x) => x.svc === 'led');
  assert.ok(led.every((x) => x.item === 'LED Display'));
  assert.ok(led.some((x) => /^LED Display ① · /.test(x.detail) && x.note === '1 Marina Blvd'), JSON.stringify(led));
  assert.ok(led.some((x) => /6400/.test(x.qty)), '数字进 Quantity');
  assert.ok(led.some((x) => x.detail.startsWith('Showflat LED · ') && x.note === 'Showflat'), '有实例名的用实例名');
  assert.ok(led.some((x) => /removedCol/.test(x.detail) && x.qty === '3 sets'), '定义里没有了的列照样转');
  assert.ok(!rows.some((x) => /handover|交付|状态|status/i.test(x.detail)), '项目上的字段 / 状态不转');
  assert.deepEqual(rows.filter((x) => x.svc === 'cgi').map((x) => [x.item, x.detail, x.qty, x.note]), [['Perspectives', 'Hero - with surrounding', '2', 'at least 5,000 px']], '服务内容一条一行');
  assert.deepEqual(rows.filter((x) => x.svc === 'drone').map((x) => [x.item, x.detail]), [['Drone & 360 IPM', '']], '没值的业务给 1 行');
  assert.equal(JSON.stringify(p.packages.map((pk) => [pk.record, pk.scopeItems])), before, '原数据一个不动');
  assert.equal(r.rows, rows.length - 1);
  assert.equal(p.mig049!.rows, r.rows);
  assert.equal(migrateProject049(p, () => [], 6), null, '只跑一次');
});

import { applyAction } from '../../server/actions.ts';
import { svcFromName, jobImportCols } from '../jobRecord.ts';

const PD = { name: 'PD', role: 'director' } as never;
const act = (p: Project, a: unknown) => applyAction(PD, p, a as never);

test('REQ-049 验收:171-50JHS 录入、无人机 1 行加到 7 行、删最后一行提示、粘贴追加归组', () => {
  const p = proj(['cgi', 'ani']);
  /* Perspectives / Hero - with surrounding / 2 / at least 5,000 px… */
  const cgi = p.jobRecord!.find((r) => r.svc === 'cgi')!;
  act(p, { type: 'editJobRow', id: cgi.id, field: 'detail', value: 'Hero - with surrounding' });
  act(p, { type: 'editJobRow', id: cgi.id, field: 'qty', value: '2' });
  act(p, { type: 'editJobRow', id: cgi.id, field: 'note', value: 'at least 5,000 px or suitable for hoarding up to 5 m height' });
  const ani = p.jobRecord!.find((r) => r.svc === 'ani')!;
  act(p, { type: 'editJobRow', id: ani.id, field: 'detail', value: '3-minutes animation' });
  act(p, { type: 'editJobRow', id: ani.id, field: 'qty', value: '180s' });
  assert.deepEqual(p.jobRecord!.map((r) => [r.item, r.detail, r.qty]), [['Perspectives', 'Hero - with surrounding', '2'], ['Animation', '3-minutes animation', '180s']]);
  assert.ok(p.log!.some((l) => (l as { k?: string }).k === 'job.edit'));

  /* 无人机:新增业务 → 1 行 Drone & 360 IPM,加到 7 行 */
  act(p, { type: 'addServicePackage', svc: 'drone', patch: {}, asNew: true, label: '' });
  let drone = () => p.jobRecord!.filter((r) => r.svc === 'drone');
  assert.deepEqual(drone().map((r) => r.item), ['Drone & 360 IPM']);
  for (let i = 0; i < 6; i++) act(p, { type: 'addJobRow', svc: 'drone' });
  assert.equal(drone().length, 7);
  assert.ok(drone().every((r) => r.item === 'Drone & 360 IPM'), '同组新行沿用上一行的 Service Item');

  /* 删到最后一行 */
  drone().slice(1).forEach((r) => act(p, { type: 'removeJobRow', id: r.id }));
  assert.equal(drone().length, 1);
  assert.throws(() => act(p, { type: 'removeJobRow', id: drone()[0].id }), /每个业务至少保留一行/);

  /* Excel 粘贴:追加到各自那一组末尾;空白预填行被顶掉 */
  act(p, { type: 'pasteJobRows', text: 'Perspectives\tFacilities\t6\t\nDrone & 360 IPM\tAerial 360\t5 spots\tclear day\nUnknown\tX\t1\t' });
  assert.deepEqual(p.jobRecord!.map((r) => [r.svc, r.detail]), [
    ['cgi', 'Hero - with surrounding'], ['cgi', 'Facilities'], ['ani', '3-minutes animation'], ['drone', 'Aerial 360'], ['', 'X'],
  ]);
  /* 没对上的那行:归到业务后它原来那组可以清空(不在项目里的组不受至少 1 行限制) */
  const loose = p.jobRecord!.find((r) => !r.svc)!;
  act(p, { type: 'editJobRow', id: loose.id, field: 'svc', value: 'ani' });
  assert.equal(loose.svc, 'ani');
  assert.throws(() => act(p, { type: 'editJobRow', id: p.jobRecord!.find((r) => r.svc === 'drone')!.id, field: 'svc', value: 'cgi' }), /至少保留一行/);
});

test('REQ-049 项目档案「新增一行」带 4 栏的值:空白预填行直接填进去,否则追加', () => {
  const p = proj(['led']);
  act(p, { type: 'addJobRow', svc: 'led', values: { item: 'LED Display', detail: 'Lobby wall', qty: '1 set', note: 'P2.5' } });
  assert.deepEqual(p.jobRecord!.map((r) => [r.detail, r.qty, r.note]), [['Lobby wall', '1 set', 'P2.5']]);
  act(p, { type: 'addJobRow', svc: 'led', values: { item: '', detail: 'Showflat', qty: '', note: '' } });
  assert.deepEqual(p.jobRecord!.map((r) => [r.item, r.detail]), [['LED Display', 'Lobby wall'], ['LED Display', 'Showflat']]);
  assert.throws(() => act(p, { type: 'addJobRow', svc: 'drone' }), /没有这项业务/);
  assert.equal(svcFromName('Drone & 360 IPM'), 'drone');
  assert.equal(svcFromName('led'), 'led');
  assert.deepEqual(jobImportCols(['﻿项目', '业务', 'Service Item']), { project: 0, no: -1, svc: 1 });
});
