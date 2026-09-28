/* 07 报价审批 · 报价计算与提交检查 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { projectLines } from '../lines.ts';
import { GST_RATE, lineState, quoteChecks, quoteNo, quoteTotals, toSection } from '../quote.ts';
import type { CostLine } from '../pricing.ts';

const row = (name: string, qty: number, unitCost: number, unitList: number): CostLine => ({
  key: name, name, qty, unit: '项', qtySource: 'F1', itemId: 1, itemLabel: `${name} · M`, unitCost, unitList,
});
const led = toSection('led', { id: 7, cost: 14451.5, list: 17395, lines: [row('LED 显示屏', 10, 1200, 1500), row('电源线', 5, 10, 20)] });
const prj = toSection('projector', { id: 9, cost: 8000, list: 10000, lines: [row('投影机', 2, 4000, 5000)] });

test('业务线状态：无成本表 / 草稿 / 需重算 / 已确认', () => {
  assert.equal(lineState(null, 3), 'none');
  assert.equal(lineState({ status: 'draft', configId: 3 }, 3), 'draft');
  assert.equal(lineState({ status: 'confirmed', configId: 2 }, 3), 'outdated');
  assert.equal(lineState({ status: 'confirmed', configId: 3 }, 3), 'confirmed');
});

test('报价单只带售价', () => {
  assert.deepEqual(led.rows[0], { name: 'LED 显示屏', itemLabel: 'LED 显示屏 · M', qty: 10, unit: '项', unitList: 1500 });
  assert.ok(!('unitCost' in led.rows[0]));
});

test('合计：折扣作用于售价合计，GST 9% 加在折后小计上', () => {
  const t = quoteTotals([led, prj], 5, GST_RATE);
  /* 27,395 × 5% = 1,369.75 → 26,025.25；GST 2,342.27（四舍五入到分）；成本 22,451.50 */
  assert.deepEqual({ ...t, margin: undefined }, { list: 27395, shared: 0, discount: 1369.75, subtotal: 26025.25, gst: 2342.27, total: 28367.52, cost: 22451.5, margin: undefined });
  assert.ok(Math.abs(t.margin! - (26025.25 - 22451.5) / 26025.25) < 1e-12);
  assert.equal(quoteTotals([], 0, GST_RATE).margin, null);
});

test('提交检查：未选业务线、折扣越界、低于毛利下限须填理由', () => {
  const codes = (secs = [led, prj], d = 0, reason = '') => quoteChecks(secs, d, quoteTotals(secs, d, GST_RATE), 0.18, reason).map((c) => `${c.code}:${c.severity}`);
  assert.deepEqual(codes([]), ['QUOTE-EMPTY:block']);
  assert.deepEqual(codes(undefined, 100), ['QUOTE-DISC:block']);
  assert.deepEqual(codes(undefined, -1), ['QUOTE-DISC:block']);
  /* 不打折毛利 18.0%（4,943.5 ÷ 27,395）刚好达标；打 1% 折后低于 18% */
  assert.deepEqual(codes(), []);
  assert.deepEqual(codes(undefined, 1), ['QUOTE-MARGIN:block']);
  assert.deepEqual(codes(undefined, 1, '战略客户，首单'), ['QUOTE-MARGIN:warn']);
});

test('项目业务线与报价编号', () => {
  assert.deepEqual(projectLines(['led', 'design']).map((l) => l.line), ['led']);
  assert.deepEqual(projectLines(['led'], ['pv']).map((l) => l.line), ['led', 'pv']);
  assert.equal(quoteNo(7), 'AVQ-0007');
});

test('低于下限的毛利向下取整显示，不会出现「18.0% 低于 18%」', () => {
  const s = toSection('led', { id: 1, cost: 8204, list: 10000, lines: [] });
  /* 5% 折后 9,500，毛利 1,296 ÷ 9,500 = 13.64%；这里用 17.96% 的场景 */
  const t = { ...quoteTotals([s], 0, GST_RATE), margin: 0.1796 };
  assert.match(quoteChecks([s], 0, t, 0.18, '')[0].message, /17\.9%/);
});
