/* 跨业务线去重草案 xline@0.1-draft */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CostLine } from '../pricing.ts';
import { GST_RATE, quoteChecks, quoteTotals, toSection } from '../quote.ts';
import { dedupe, dedupTotals, sharedRows, XLINE_PACK } from '../xline.ts';

const row = (name: string, qty: number, unitCost: number, unitList: number, shared?: CostLine['shared']): CostLine => ({
  key: name, name, qty, unit: '项', qtySource: '人工', itemId: 1, itemLabel: '', unitCost, unitList, ...(shared ? { shared } : {}),
});

const led = [row('LED 显示屏', 10, 1200, 1500), row('进场与吊装', 1, 2000, 3000, 'mobilisation'), row('LED 调试', 2, 300, 500, 'commissioning'),
  row('控制机柜', 1, 600, 900, 'rack')];
const prj = [row('投影机', 2, 4000, 5000), row('投影调试', 3, 300, 500, 'commissioning'), row('信号桥架', 20, 10, 15, 'containment')];
const elv = [row('交换机', 2, 1600, 2300), row('机柜 42U', 2, 700, 1050, 'rack'), row('进场', 1, 1500, 2000, 'mobilisation')];
const pv = [row('组件', 100, 160, 230), row('进场与吊装', 1, 700, 1000, 'mobilisation')];

test('只取有共用类别的行，金额 = 单价 × 数量', () => {
  assert.deepEqual(sharedRows('led', led).map((r) => [r.tag, r.cost, r.list]),
    [['mobilisation', 2000, 3000], ['commissioning', 600, 1000], ['rack', 600, 900]]);
});

test('去重：保留售价最大的一条业务线，其余按比例扣减；只出现在一条线的类别不扣', () => {
  const d = dedupe([...sharedRows('led', led), ...sharedRows('projector', prj), ...sharedRows('elv', elv), ...sharedRows('pv', pv)]);
  const by = Object.fromEntries(d.map((x) => [x.tag, x]));
  /* 进场：LED 3,000 最大，保留；弱电 2,000 + 光伏 1,000 全部扣除 */
  assert.equal(by.mobilisation.kept, 'led');
  assert.deepEqual([by.mobilisation.cost, by.mobilisation.list], [2200, 3000]);
  /* 机柜：弱电 2,100 > LED 900，LED 的控制机柜并入弱电机柜 */
  assert.equal(by.rack.kept, 'elv');
  assert.deepEqual([by.rack.cost, by.rack.list], [600, 900]);
  /* 调试：投影 1,500 > LED 1,000，LED 调试扣 20% */
  assert.equal(by.commissioning.kept, 'projector');
  assert.deepEqual([by.commissioning.cost, by.commissioning.list], [120, 200]);
  assert.equal(by.containment, undefined, '只有投影有桥架');
  assert.deepEqual(dedupTotals(d), { cost: 2920, list: 4100 });
  assert.deepEqual(dedupe(sharedRows('led', led)), [], '单条业务线不去重');
});

test('报价：扣减在折扣之前，成本同步扣减；草案规则提示审批人', () => {
  const secs = [toSection('led', { id: 1, cost: 15200, list: 19900, lines: led }), toSection('elv', { id: 2, cost: 6100, list: 8700, lines: elv })];
  const d = dedupe([...sharedRows('led', led), ...sharedRows('elv', elv)]);
  /* 进场：LED 3,000 > 弱电 2,000 → 扣 2,000 / 1,500；机柜：弱电 2,100 > LED 900 → 扣 900 / 600 */
  assert.deepEqual(dedupTotals(d), { cost: 2100, list: 2900 });
  const t = quoteTotals(secs, 10, GST_RATE, d);
  assert.equal(t.list, 28600);
  assert.equal(t.shared, 2900);
  assert.equal(t.discount, 2570);
  assert.equal(t.subtotal, 23130);
  assert.equal(t.cost, 21300 - 2100);
  const checks = quoteChecks(secs, 10, t, 0.18, '', d);
  assert.equal(XLINE_PACK.calibrated, false);
  assert.ok(checks.some((c) => c.code === 'QUOTE-XLINE' && c.severity === 'warn'));
  assert.ok(!quoteChecks(secs, 10, quoteTotals(secs, 10, GST_RATE), 0.18, '').some((c) => c.code === 'QUOTE-XLINE'));
});
