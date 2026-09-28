/* A2 公式计算正确性 · A8 公式版本锁定 (§12) */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compute } from '../compute.ts';
import { FIXTURES, fixtureConfig } from '../fixtures.ts';
import { getRulePack, registerRulePack, type RulePack } from '../rulepack.ts';

const round2 = (x: number) => Math.round(x * 100) / 100;

test('A2 · 9 个历史项目的面积与功耗误差为零', () => {
  for (const f of FIXTURES) {
    const { trace } = compute(fixtureConfig(f), 'led@1.0');
    assert.equal(round2(trace.sqm.value), f.recorded.sqm, `${f.name} 面积`);
    assert.equal(round2(trace.kw.value), f.recorded.kw, `${f.name} 功耗`);
  }
});

test('F2 · 模组数与表内一致（手填值项目除外，§7.3 注）', () => {
  const graded = FIXTURES.filter((f) => !f.modsHandEntered);
  assert.equal(graded.length, 7);
  for (const f of graded) {
    const { trace } = compute(fixtureConfig(f), 'led@1.0');
    assert.equal(trace.mods.value, f.recorded.mods, `${f.name} 模组数`);
  }
});

test('F2 · 对现有表格取整口径的修正 (§5 注)', () => {
  /* 现有表格用 L/320 与 H/160 且不取整，会把 6.75 这类小数带进模组总数。 */
  const cfg = { ...fixtureConfig(FIXTURES[0]), led_opening_w: 4500 };
  const { trace } = compute(cfg, 'led@1.0');
  assert.equal(trace.mods.value, 14 * 16, '一律向下取整');
  assert.ok(Number.isInteger(trace.mods.value));
});

test('A8 · 修改系数生成新版本，历史项目结果不变', () => {
  const f = FIXTURES[0];
  const before = compute(fixtureConfig(f), 'led@1.0').trace.kw.value;

  const v1 = getRulePack('led@1.0');
  const bumped: RulePack = {
    ...v1,
    version: 'led@1.1',
    profiles: { ...v1.profiles, in_fixed: { ...v1.profiles.in_fixed, wSqm: 560 } },
  };
  registerRulePack(bumped);

  assert.equal(compute(fixtureConfig(f), 'led@1.0').trace.kw.value, before, '锁定 v1.0 的项目结果不变');
  assert.ok(compute(fixtureConfig(f), 'led@1.1').trace.kw.value > before, '新版本按新系数计算');
  assert.throws(() => registerRulePack(bumped), /already exists/, '同版本号不得覆盖');
  assert.throws(() => getRulePack('led@9.9'), /unknown rule pack/);
});

test('公式以配置存储，改表达式即改结果 (§5 / §14 禁止硬编码)', () => {
  const v1 = getRulePack('led@1.0');
  const f5 = v1.formulas.find((x) => x.id === 'F5')!;
  assert.equal(f5.exprs!.kw, 'sqm * w_sqm / 1000');

  const patched: RulePack = {
    ...v1,
    version: 'led@1.0-derate',
    formulas: v1.formulas.map((x) => (x.id === 'F5' ? { ...x, exprs: { kw: 'sqm * w_sqm / 1000 * 1.1' } } : x)),
  };
  registerRulePack(patched);
  const a = compute(fixtureConfig(FIXTURES[0]), 'led@1.0').trace.kw.value;
  const b = compute(fixtureConfig(FIXTURES[0]), 'led@1.0-derate').trace.kw.value;
  assert.ok(Math.abs(b - a * 1.1) < 1e-9, '表达式改动直接反映在结果上，无需改代码');
});

test('§9 · 每个输出值都带齐三标签，并可展开到原始来源', () => {
  const { trace } = compute(fixtureConfig(FIXTURES[0]), 'led@1.0');
  for (const node of Object.values(trace)) {
    assert.ok(node.prov.source, `${node.key} 缺来源`);
    assert.ok(node.prov.method, `${node.key} 缺方法`);
    assert.ok(node.prov.confidence !== undefined, `${node.key} 缺置信`);
    for (const dep of node.inputs) assert.ok(trace[dep], `${node.key} 的输入 ${dep} 不在计算链中`);
  }
  assert.deepEqual(trace.kw.inputs.sort(), ['sqm', 'w_sqm']);
  assert.equal(trace.kw.prov.rule, 'F5');
  assert.equal(trace.kw.prov.confidence, 'deterministic');
  assert.equal(trace.L.prov.method, 'manual');
});
