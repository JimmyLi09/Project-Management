/* led@1.2 · 回路按单箱最大功率校核,不能超载(AV-019 补充,2026-10-03) */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calcBasis } from '../calc.ts';
import { compute } from '../compute.ts';
import { buildDrawing } from '../drawing.ts';
import { FIXTURES, fixtureConfig } from '../fixtures.ts';
import { proposalDoc } from '../proposal.ts';
import { getRulePack } from '../rulepack.ts';

const BOC = fixtureConfig(FIXTURES.find((f) => f.id === '148')!);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

test('最大功耗密度按 W/㎡ 的公式:640 × 640 实测 240 W → 585.9375 W/㎡;640 × 480 = 180 W', () => {
  const p = getRulePack('led@1.2').profiles.in_fixed;
  assert.equal(p.wSqm, 500, '平均值不变');
  assert.ok(near(p.wSqmMax! * 0.64 * 0.64, 240));
  assert.ok(near(p.wSqmMax! * 0.64 * 0.48, 180));
  /* 1.0 / 1.1 不变 */
  assert.equal(getRulePack('led@1.1').profiles.in_fixed.wSqmMax, undefined);
  assert.equal(getRulePack('led@1.0').profiles.in_fixed.wSqmMax, undefined);
});

test('BOC 按单箱最大功率:8640 W → 4 路 × 12 箱 = 2160 W / 9.4 A,每路都不超载', () => {
  const r = compute(BOC, 'led@1.2');
  const w = r.wiring!;
  assert.ok(near(w.cellW[0], 180));
  assert.ok(near(r.trace.kw.value, 7.3728), '整屏平均功耗照旧 7.37 kW');
  assert.ok(near(r.trace.kw_max.value, 8.64), '整屏最大功耗 8.64 kW');
  assert.equal(w.nCircuit, 4);
  assert.equal(r.trace.n_power_cable.value, 5, '06 电源线 4 + 1');
  for (const pc of w.power) {
    assert.equal(pc.cells.length, 12);
    assert.ok(near(pc.w, 2160));
    assert.ok(pc.w <= 2500);
    assert.ok(Math.abs(pc.amps! - 9.391) < 0.01);
  }
  assert.ok(!r.findings.some((f) => f.code === 'LED-PWR-09' || f.code === 'LED-PWR-12'));
  /* 1.1 照旧 3 路 */
  assert.equal(compute(BOC, 'led@1.1').wiring!.nCircuit, 3);
});

test('全部历史项目在 1.2 下:按最大功率每路 ≤ 上限', () => {
  for (const f of FIXTURES) {
    const r = compute(fixtureConfig(f), 'led@1.2');
    if (!r.wiring) continue;
    for (const pc of r.wiring.power) assert.ok(pc.w <= r.wiring.limitW + 1e-6, `${f.name} ${pc.w}`);
    const dens = r.profile.wSqmMax ?? r.profile.wSqm;
    r.layout!.cells.forEach((c, i) => assert.ok(near(r.wiring!.cellW[i], (c.w * c.h / 1e6) * dens)));
  }
});

test('计算依据表 / 说明栏 / 技术方案:写「单箱最大功率」和平均 / 最大两个功耗,中英两套', () => {
  const r = compute(BOC, 'led@1.2');
  const rows = calcBasis(r, 'zh');
  const cab = rows.find((x) => x.key === 'cab_w')!;
  assert.equal(cab.item, '单箱最大功率');
  assert.equal(cab.formula, '0.64 × 0.48 × 585.94');
  assert.equal(cab.result, '180 W');
  assert.ok(cab.params!.some((p) => /按 640 × 640 实测 240 W 折算/.test(p)));
  assert.ok(cab.params!.some((p) => /平均功耗密度 500 W\/㎡/.test(p)));
  const total = rows.find((x) => x.key === 'total')!;
  assert.equal(total.result, '8640 W（平均 7372.8 W）');
  assert.match(rows.find((x) => x.key === 'circuits')!.formula, /ceil\(8640 ÷ 2500\)/);
  assert.match(rows.find((x) => x.key === 'load')!.result, /2160 W \/ 9\.4 A ✓/);
  const en = calcBasis(r, 'en');
  assert.equal(en.find((x) => x.key === 'cab_w')!.item, 'Max power per cabinet');
  for (const row of en) assert.ok(!/[一-鿿]/.test(`${row.item}${row.formula}${row.result}${row.source}${(row.params ?? []).join('')}`), row.key);
  const info = buildDrawing(r, { project: 'BOC' })!.layers.find((l) => l.name === 'LED-07-文字')!.entities.map((e) => (e as { s?: string }).s ?? '').join('\n');
  assert.match(info, /最大 8\.64 kW @ 585\.94 W\/㎡，回路按最大/);
  const zh = proposalDoc(r, { title: 'BOC', lang: 'zh', date: '2026-10-03' })!;
  assert.match(zh.sections[0].paragraphs!.join(''), /整屏平均功耗 7\.37 kW、最大功耗 8\.64 kW，按单箱最大功率、单回路 2\.5 kW 配置，共需 4 个供电回路/);
  assert.deepEqual(zh.sections[1].table!.rows.filter((x) => /功耗/.test(x[0])).map((x) => x.slice(0, 2)), [['平均功耗', '7.37 kW'], ['最大功耗', '8.64 kW']]);
  const enDoc = proposalDoc(r, { title: 'BOC', lang: 'en', date: '2026-10-03' })!;
  assert.match(enDoc.sections[0].paragraphs!.join(''), /Average power consumption is 7\.37 kW and maximum 8\.64 kW/);
});

test('最大功耗密度待填的参数组(室外 / 租赁):暂按平均值,告警可能超载', () => {
  const cfg = { ...fixtureConfig(FIXTURES[0]), led_screen_type: 'out_fixed' as const, led_opening_w: 3840, led_opening_h: 1920, led_cabinet: [960, 960] as [number, number] };
  const r = compute(cfg, 'led@1.2');
  assert.ok(r.wiring);
  const f = r.findings.find((x) => x.code === 'LED-PWR-12');
  assert.ok(f);
  assert.match(f!.message, /最大功耗密度待填：回路暂按平均 800 W\/㎡ 校核，实际可能超载/);
  const cab = calcBasis(r).find((x) => x.key === 'cab_w')!;
  assert.equal(cab.ok, false);
  assert.match(cab.result, /最大功耗密度待填，暂按平均/);
  assert.ok(near(r.trace.kw_max.value, r.trace.kw.value));
});
