/* 光伏草案规则包 pv@0.1-draft · 计算、校验、单线图、成本 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildPvLines, checkSheet, pvChecks, totals, type PriceItem, type PvSummary, type SavedConfig } from '../pricing.ts';
import { computePv, type PvConfig } from '../pv/compute.ts';
import { buildPvDrawing } from '../pv/drawing.ts';
import { getPvPack, LATEST_PV_PACK, registerPvPack } from '../pv/rulepack.ts';
import { toSvg } from '../svg.ts';

const base: PvConfig = { pv_area: 1000, pv_mount: 'metal', pv_module: 'm550', pv_inverter: 'inv50', pv_dc_run: 30, pv_ac_run: 20 };
const V = (r: ReturnType<typeof computePv>, k: string) => r.trace[k].value;
const codes = (c: Partial<PvConfig>) => computePv({ ...base, ...c }, LATEST_PV_PACK).findings.map((f) => f.code);

test('1000 ㎡ 金属屋面铺满（手算核对）', () => {
  const r = computePv(base, LATEST_PV_PACK);
  /* 组件 2.278 × 1.134 = 2.583 ㎡；1000 × 0.85 ÷ 2.583 = 329.0 → 329 块 = 180.95 kWp */
  assert.equal(V(r, 'n_max'), 329);
  assert.equal(V(r, 'n_mod'), 329);
  assert.ok(Math.abs(V(r, 'kwp') - 180.95) < 1e-9);
  /* 180.95 ÷ (50 × 1.2) = 3.02 → 4 台，容配比 180.95 ÷ 200 */
  assert.equal(V(r, 'n_inv'), 4);
  assert.ok(Math.abs(V(r, 'dc_ac_real') - 0.90475) < 1e-9);
  /* Voc 49.9 × (1 + 0.0027 × 5) = 50.57 V → 1100 ÷ 50.57 = 21 块；Vmp 42.1 × (1 − 0.0035 × 45) = 35.47 V → 200 ÷ 35.47 → 6 块 */
  assert.equal(V(r, 'str_max'), 21);
  assert.equal(V(r, 'str_min'), 6);
  assert.equal(V(r, 'n_str'), 16);
  assert.equal(V(r, 'str_short'), 20);
  /* 1580 × 0.8 = 1264 kWh/kWp */
  assert.ok(Math.abs(V(r, 'yield_kwh') - 180.95 * 1264) < 1e-6);
  /* 16 串 × 2 × 30 m × 1.1 = 1056 m；4 台 × 20 m × 1.1 = 88 m */
  assert.deepEqual(['dc_m', 'ac_m', 'n_mc4'].map((k) => V(r, k)), [1056, 88, 32]);
  assert.ok(Math.abs(V(r, 'load_kg') - (28 / 2.583252 + 3)) < 1e-9);
  assert.equal(r.ok, true);
  assert.equal(r.exportable, false);
  assert.ok(Object.values(r.trace).every((n) => n.prov.source && n.prov.method && n.prov.confidence !== undefined));
});

test('目标容量：取目标，超过屋面时按铺满并告警', () => {
  const r = computePv({ ...base, pv_target_kwp: 50 }, LATEST_PV_PACK);
  /* 50,000 ÷ 550 = 90.9 → 91 块 = 50.05 kWp，1 台 50 kW */
  assert.equal(V(r, 'n_mod'), 91);
  assert.equal(V(r, 'n_inv'), 1);
  assert.ok(!r.findings.some((f) => f.code === 'PV-FIT-03'));
  const big = computePv({ ...base, pv_target_kwp: 500 }, LATEST_PV_PACK);
  assert.equal(V(big, 'n_mod'), 329);
  assert.ok(big.findings.some((f) => f.code === 'PV-FIT-03'));
});

test('安装方式改变覆盖率：平屋面倾角支架放得少、支架更重', () => {
  const r = computePv({ ...base, pv_mount: 'flat' }, LATEST_PV_PACK);
  assert.equal(V(r, 'n_mod'), Math.floor(600 / 2.583252));
  assert.ok(V(r, 'load_kg') > V(computePv(base, LATEST_PV_PACK), 'load_kg'));
});

test('校验：必填、放不下、组串过短、逆变器偏大、1 MW 许可、荷载提示；草案拦导出', () => {
  assert.ok(codes({ pv_area: 0 }).includes('PV-FIT-01'));
  assert.ok(codes({ pv_dc_run: 0 }).includes('PV-FIT-01'));
  assert.ok(codes({ pv_area: 2 }).includes('PV-FIT-02'));
  /* 10 ㎡ → 3 块：50 kW 逆变器需每串 ≥ 6 块，拦；5 kW 单相 ≥ 3 块，通过 */
  assert.ok(codes({ pv_area: 10 }).includes('PV-STR-01'));
  assert.equal(computePv({ ...base, pv_area: 10 }, LATEST_PV_PACK).ok, false);
  assert.ok(!codes({ pv_area: 10, pv_inverter: 'inv5' }).includes('PV-STR-01'));
  assert.ok(codes({ pv_area: 60 }).includes('PV-INV-01'), '10.45 kWp 配 50 kW');
  assert.ok(codes({ pv_area: 6000, pv_inverter: 'inv100' }).includes('PV-GRID-01'));
  assert.ok(codes({}).includes('PV-STRUCT-01'));
  const r = computePv(base, LATEST_PV_PACK);
  assert.equal(r.findings.find((f) => f.code === 'PV-TYPE-01')!.gate, 'export');
  assert.equal(buildPvDrawing(computePv({ ...base, pv_area: 0 }, LATEST_PV_PACK), { project: 'x' }), null);
});

test('版本锁定', () => {
  const v = getPvPack(LATEST_PV_PACK);
  registerPvPack({ ...v, version: 'pv@0.2-test', eng: { ...v.eng, pr: 0.75 } });
  assert.equal(V(computePv(base, LATEST_PV_PACK), 'spec_yield'), 1264);
  assert.equal(V(computePv(base, 'pv@0.2-test'), 'spec_yield'), 1185);
});

test('单线图：阵列 → 逆变器 → 配电箱 → 电网，草图标记', () => {
  const d = buildPvDrawing(computePv(base, LATEST_PV_PACK), { project: '测试' })!;
  assert.deepEqual(d.layers.map((l) => l.name), ['PV-01-阵列', 'PV-02-直流', 'PV-03-交流', 'PV-04-并网', 'PV-07-文字']);
  const text = d.layers.flatMap((l) => l.entities).filter((e) => e.k === 'text').map((e) => (e as { s: string }).s).join('\n');
  assert.match(text, /光伏阵列 180\.95 kWp/);
  assert.match(text, /逆变器 × 4/);
  assert.match(text, /直流光伏线 1,056 m/);
  assert.match(text, /草案，不得用于正式报价/);
  assert.ok(toSvg(d).includes('<g id="PV-02-直流"'));
});

test('光伏成本：数量来自 S2–S7；组件功率不符、逆变器偏小阻断', () => {
  const r = computePv(base, LATEST_PV_PACK);
  const v = (k: string) => r.trace[k].value;
  const cfg: SavedConfig<PvSummary> = {
    id: 1, projectId: 'p', line: 'pv', packVersion: LATEST_PV_PACK, drawingId: null, createdBy: 'PM', createdAt: 0,
    summary: { area: 1000, mount: 'metal', module: 'm550', modW: 550, nMod: v('n_mod'), kwp: v('kwp'), invKw: 50, nInv: v('n_inv'),
      acKw: v('ac_kw'), nStr: v('n_str'), dcM: v('dc_m'), acM: v('ac_m'), nMc4: v('n_mc4'), yieldKwh: v('yield_kwh'),
      exportable: r.exportable, blocking: ['PV-TYPE-01'] },
  };
  const it = (id: number, spec: string, unit: string, cost: number): PriceItem => ({
    id, line: 'pv', category: 'x', categoryLabel: '光伏', model: `m${id}`, pitch: spec, moduleSize: '', cabinetSize: '', unit,
    costPrice: cost, listPrice: cost * 1.3, currency: 'SGD', source: '', validUntil: '', active: true, updatedBy: '', updatedAt: 0,
  });
  const items = [it(1, '550 Wp', '块', 160), it(2, '440 Wp', '块', 130), it(3, '50 kW', '台', 4200), it(4, '20 kW', '台', 2100),
    it(5, '', '套', 45), it(6, '', 'm', 2.2), it(7, '', 'm', 18), it(8, '', '对', 4), it(9, '', '套', 3500), it(10, '', '套', 900)];
  const picks = { module: 1, inverter: 3, mount: 5, dc_cable: 6, ac_cable: 7, connector: 8, acdb: 9, monitor: 10 };
  let lines = buildPvLines(cfg, picks, [], items);
  assert.deepEqual(lines.map((l) => [l.key, l.qty]), [['module', 329], ['inverter', 4], ['mount', 329], ['dc_cable', 1056], ['ac_cable', 88],
    ['connector', 32], ['acdb', 1], ['monitor', 1]]);
  assert.deepEqual(pvChecks(lines, cfg, items), []);
  assert.ok(Math.abs(totals(lines).cost - (329 * 160 + 4 * 4200 + 329 * 45 + 1056 * 2.2 + 88 * 18 + 32 * 4 + 3500 + 900)) < 1e-6);
  lines = buildPvLines(cfg, { ...picks, module: 2, inverter: 4 }, [], items);
  assert.deepEqual(pvChecks(lines, cfg, items).map((c) => c.code + ':' + c.severity), ['PV-COST-MOD:block', 'PV-COST-INV:block']);
  assert.ok(checkSheet(lines, cfg, items, 0.18, '2026-09-26').some((c) => c.code === 'COST-CFG' && /PV-TYPE-01/.test(c.message)));
});
