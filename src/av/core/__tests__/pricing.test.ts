/* 06 LED 单线成本 · 价格库种子 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { buildLedLines, checkSheet, displayCandidates, pitchOf, totals, type PriceItem, type SavedConfig } from '../pricing.ts';

const seed = JSON.parse(readFileSync(new URL('../../seed/led-price-2026-04.json', import.meta.url), 'utf8')).items as Record<string, unknown>[];
const ITEMS: PriceItem[] = seed.map((r, i) => ({
  id: i + 1, line: 'led', category: r.category as string, categoryLabel: r.category_label as string,
  model: r.model as string, pitch: r.pitch as string, moduleSize: r.module_size as string, cabinetSize: r.cabinet_size as string,
  unit: r.unit as string, costPrice: r.cost_price as number, listPrice: r.list_price as number, currency: 'SGD',
  source: r.source as string, validUntil: '', active: true, updatedBy: '', updatedAt: 0,
}));
const cable = (id: number, name: string, cost: number | null, list: number | null): PriceItem => ({
  ...ITEMS[0], id, category: 'cable', categoryLabel: '线材', model: name, pitch: '', cabinetSize: '', unit: '根', costPrice: cost, listPrice: list,
});

/* 144-Chuan Grove as saved from 05: 11.4688 ㎡, P2, 4 power / 7 data cables. */
const CFG: SavedConfig = {
  id: 1, projectId: 'p', packVersion: 'led@1.0', drawingId: 1, createdBy: 'PM', createdAt: 0,
  summary: { sqm: 11.4688, pitch: 2, screenType: 'in_fixed', mods: 224, cabinets: 35, nPowerCable: 4, nDataCable: 7,
    powerCableSpec: '3*2.5', exportable: true, blocking: [] },
};

test('价格库种子：47 项、8 类，与 PDF 一致', () => {
  assert.equal(ITEMS.length, 47);
  assert.equal(new Set(ITEMS.map((i) => i.category)).size, 8);
  const p2 = ITEMS.find((i) => i.category === 'hard_smd' && i.pitch === 'P2')!;
  assert.deepEqual([p2.costPrice, p2.listPrice, p2.cabinetSize], [1250, 1500, '640*480 Die casting']);
  assert.ok(ITEMS.filter((i) => i.category === 'poster').every((i) => i.unit === '台'));
});

test('pitchOf 读出点间距数值', () => {
  assert.equal(pitchOf('P1.875'), 1.875);
  assert.equal(pitchOf('2.8-5.6mm'), 2.8);
  assert.equal(pitchOf('U3 (P3.91)'), 3);   // the model string is not a pitch; the pitch column is used
  assert.equal(pitchOf(''), null);
});

test('显示屏候选：同点间距的按平方米条目排前，海报（按台）不在候选中', () => {
  const c = displayCandidates(ITEMS, 2);
  assert.deepEqual(c.slice(0, 3).map((i) => i.category), ['hard_smd', 'gob', 'soft']);
  assert.ok(c.every((i) => i.unit === '㎡'));
});

test('144-Chuan Grove 单线成本：显示屏按 F1 面积 × 单价', () => {
  const smd = ITEMS.find((i) => i.category === 'hard_smd' && i.pitch === 'P2')!;
  const lines = buildLedLines(CFG, { display: smd.id, power_cable: 901, data_cable: 902 }, [],
    [...ITEMS, cable(901, '电源线 3*2.5', 18, 30), cable(902, '网线 CAT6', 6, 10)]);
  assert.deepEqual(lines.map((l) => [l.key, l.qty, l.qtySource]), [['display', 11.47, 'F1'], ['power_cable', 4, 'F7'], ['data_cable', 7, 'F9']]);
  const t = totals(lines);
  assert.equal(t.cost, 11.47 * 1250 + 4 * 18 + 7 * 6);
  assert.equal(t.list, 11.47 * 1500 + 4 * 30 + 7 * 10);
});

test('提交前检查：缺条目、缺价、单位不符阻断；价格变动与过期提示', () => {
  const smd = ITEMS.find((i) => i.category === 'hard_smd' && i.pitch === 'P2')!;
  const poster = ITEMS.find((i) => i.category === 'poster')!;
  const empty = cable(903, '电源线（未定价）', null, null);
  const items = [...ITEMS, empty];
  let lines = buildLedLines(CFG, { display: poster.id, power_cable: 903, data_cable: null }, [], items);
  const codes = checkSheet(lines, CFG, items, 0.18, '2026-09-25').map((c) => `${c.code}:${c.severity}`);
  assert.ok(codes.includes('COST-UNIT:block'), '海报按台计价，不能用于按平方米的显示屏行');
  assert.ok(codes.includes('COST-PRICE:block'), '价格库空价格');
  assert.ok(codes.includes('COST-ITEM:block'), '数据线未选条目');
  assert.ok(!codes.some((c) => c.startsWith('COST-MARGIN')), '有阻断项时不评毛利');

  const cab = cable(904, '电源线', 18, 30);
  lines = buildLedLines(CFG, { display: smd.id, power_cable: 904, data_cable: 904 }, [], [...ITEMS, cab]);
  const moved = [...ITEMS, { ...cab, costPrice: 20, validUntil: '2026-06-30' }];
  const later = checkSheet(lines, CFG, moved, 0.18, '2026-09-25').map((c) => c.code);
  assert.ok(later.includes('COST-STALE'), '价格库改价后提示可重算');
  assert.ok(later.includes('COST-EXPIRED'));
});

test('毛利下限：按 2026 价格表 MSRP / Partner Price 计为 16.7%，低于 18% 时提示', () => {
  const smd = ITEMS.find((i) => i.category === 'hard_smd' && i.pitch === 'P2')!;
  const lines = buildLedLines(CFG, { display: smd.id, power_cable: 905, data_cable: 905 }, [], [...ITEMS, cable(905, '线', 10, 12)]);
  const m = checkSheet(lines, CFG, [...ITEMS, cable(905, '线', 10, 12)], 0.18, '2026-09-25').find((c) => c.code === 'COST-MARGIN')!;
  assert.equal(m.severity, 'warn');
  assert.match(m.message, /16\.7%.*18\.0%/);
});

test('方案有阻断项（如待校准参数组）时成本表不得确认', () => {
  const blocked = { ...CFG, summary: { ...CFG.summary, exportable: false, blocking: ['LED-TYPE-01'] } };
  const smd = ITEMS.find((i) => i.category === 'hard_smd' && i.pitch === 'P2')!;
  const lines = buildLedLines(blocked, { display: smd.id, power_cable: 906, data_cable: 906 }, [], [...ITEMS, cable(906, '线', 1, 2)]);
  const c = checkSheet(lines, blocked, [...ITEMS, cable(906, '线', 1, 2)], 0.18, '2026-09-25');
  assert.ok(c.some((x) => x.code === 'COST-CFG' && x.severity === 'block' && /LED-TYPE-01/.test(x.message)));
});
