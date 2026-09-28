/* 技术方案书数据：模板所需的全部数值取自同一次计算 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compute } from '../compute.ts';
import { FIXTURES, fixtureConfig } from '../fixtures.ts';
import { proposalPayload } from '../proposal.ts';

const cfg = fixtureConfig(FIXTURES[0]);

test('144 Chuan Grove：数值与出图、验收用例一致', () => {
  const p = proposalPayload(compute(cfg, 'led@1.0'), { title: '144 Chuan Grove', client: '海晟' })!;
  assert.deepEqual([p.cabinets, p.mods, p.nCircuit, p.nPowerCable, p.nDataRun, p.nDataCable], [35, 224, 3, 4, 6, 7]);
  assert.deepEqual([p.L, p.H, p.pitch, p.pxW, p.pxH], [4480, 2560, 2, 2240, 1280]);
  assert.deepEqual(p.bom.map((b) => [b.w, b.h, b.count, b.inLib]), [[640, 480, 28, true], [640, 640, 7, true]]);
  assert.equal(p.circuitsW.length, 3);
  assert.equal(p.circuitsW.reduce((a, b) => a + b, 0), Math.round(p.kw * 1000));
  assert.deepEqual([p.control.name, p.packVersion, p.client], ['诺瓦', 'led@1.0', '海晟']);
});

test('排布无解时没有方案书数据', () => {
  assert.equal(proposalPayload(compute({ ...cfg, led_opening_w: 4500 }, 'led@1.0'), { title: 'x' }), null);
});
