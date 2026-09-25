/* 投影草案规则包 prj@0.1-draft · 计算、校验、出图、成本 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { toSvg } from '../svg.ts';
import { buildPrjLines, checkSheet, prjChecks, totals, type PriceItem, type PrjSummary, type SavedConfig } from '../pricing.ts';
import { computePrj, type PrjConfig } from '../prj/compute.ts';
import { buildPrjDrawing, rasters } from '../prj/drawing.ts';
import { getPrjPack, LATEST_PRJ_PACK, registerPrjPack } from '../prj/rulepack.ts';

const base: PrjConfig = {
  prj_image_w: 4000, prj_image_h: 2250, prj_throw_dist: 5, prj_ambient_lux: 100, prj_screen_gain: 1,
  prj_content: 'basic', prj_profile: 'laser_wuxga', prj_view_far: 12,
};
const V = (r: ReturnType<typeof computePrj>, k: string) => r.trace[k].value;

test('单机 16:9 画面：1 台、1920×1080、17,500 lm（手算核对）', () => {
  const r = computePrj(base, LATEST_PRJ_PACK);
  /* 16:9 on a 16:10 WUXGA raster: width-filling, letterboxed; 90% of the raster used. */
  assert.equal(V(r, 'n_proj'), 1);
  assert.equal(V(r, 'w_proj'), 4000);
  assert.equal(V(r, 'h_proj'), 2500);
  assert.equal(V(r, 'throw_ratio'), 1.25);
  /* basic decision making needs 15:1 at 100 lx ambient → 1,400 lx on screen;
     1,400 lx × 4.0 m × 2.5 m ÷ 0.8 derate = 17,500 lm */
  assert.equal(V(r, 'e_req'), 1400);
  assert.ok(Math.abs(V(r, 'lm_proj') - 17500) < 1e-6);
  assert.deepEqual([V(r, 'px_w'), V(r, 'px_h')], [1920, 1080]);
  assert.ok(Math.abs(V(r, 'kw') - 1.4) < 1e-9);
  assert.equal(V(r, 'n_circuit'), 1);
  assert.equal(V(r, 'n_signal_cable'), 2);
});

test('3:1 宽幅画面：2 台融合，有效横向像素 = 2×1920 − 15% 重叠', () => {
  const r = computePrj({ ...base, prj_image_w: 9000, prj_image_h: 3000 }, LATEST_PRJ_PACK);
  assert.equal(V(r, 'n_proj'), 2);
  assert.equal(V(r, 'px_w'), 2 * 1920 - Math.round(0.15 * 1920));
  assert.ok(V(r, 'h_proj') >= 3000, '单机画面高度必须覆盖画面');
  const rs = rasters(9000, 3000, 2, V(r, 'w_proj'), V(r, 'h_proj'));
  assert.equal(rs[0].x, 0);
  assert.ok(Math.abs(rs[1].x + rs[1].w - 9000) < 1e-6, '两端对齐画面边缘');
  const overlap = rs[0].x + rs[0].w - rs[1].x;
  assert.ok(overlap >= 0.15 * V(r, 'w_proj') - 1e-6, '融合带不小于 15%');
});

test('窄画面（4:3）在 16:10 机上按高度铺满、左右留边，不多加投影机', () => {
  const r = computePrj({ ...base, prj_image_w: 3000, prj_image_h: 2250 }, LATEST_PRJ_PACK);
  assert.equal(V(r, 'n_proj'), 1);
  assert.equal(V(r, 'h_proj'), 2250);
  assert.equal(V(r, 'w_proj'), 3600);
});

test('暗室时亮度按下限，不因环境光为 0 而得出 0 lm', () => {
  const r = computePrj({ ...base, prj_ambient_lux: 0 }, LATEST_PRJ_PACK);
  assert.ok(Math.abs(V(r, 'e_req') - Math.PI * 50) < 0.01);
  assert.ok(V(r, 'lm_proj') > 0);
});

test('对比度按内容类别（ANSI/INFOCOMM 3M-2011）：7 / 15 / 50 / 80', () => {
  const lx = (c: PrjConfig['prj_content']) => V(computePrj({ ...base, prj_content: c }, LATEST_PRJ_PACK), 'e_req');
  assert.deepEqual([lx('passive'), lx('basic'), lx('analytical'), lx('video')], [600, 1400, 4900, 7900]);
});

test('校验：投射比、可视距离、亮度上限、环境光；草案规则包拦导出', () => {
  const codes = (c: Partial<PrjConfig>) => computePrj({ ...base, ...c }, LATEST_PRJ_PACK).findings.map((f) => f.code);
  assert.ok(codes({ prj_throw_dist: 1 }).includes('PRJ-TR-01'), '投射比 0.25 需超短焦');
  assert.ok(codes({ prj_throw_dist: 12 }).includes('PRJ-TR-02'), '投射比 3.0 需选配镜头');
  assert.ok(codes({ prj_view_far: 20 }).includes('PRJ-VD-01'), '20 m > 6 × 2.25 m');
  assert.ok(codes({ prj_view_near: 1 }).includes('PRJ-VD-02'), '像素 2.08 mm 可见距离约 7.2 m');
  assert.ok(codes({ prj_ambient_lux: 600 }).includes('PRJ-AMB-01'));
  assert.ok(codes({ prj_ambient_lux: 600 }).includes('PRJ-BR-01'), '600 lx 需 10 万 lm 以上');
  const r = computePrj(base, LATEST_PRJ_PACK);
  const type = r.findings.find((f) => f.code === 'PRJ-TYPE-01')!;
  assert.equal(type.gate, 'export');
  assert.equal(r.ok, true, '草案仍可试算');
  assert.equal(r.exportable, false);
  assert.ok(Object.values(r.trace).every((n) => n.prov.source && n.prov.method && n.prov.confidence !== undefined), '三标签齐全');
});

test('无效输入阻断计算', () => {
  const r = computePrj({ ...base, prj_image_w: 0 }, LATEST_PRJ_PACK);
  assert.equal(r.ok, false);
  assert.ok(r.findings.some((f) => f.code === 'PRJ-FIT-01'));
  assert.equal(buildPrjDrawing(r, { project: 'x' }), null);
});

test('版本锁定：新规则包不改变按旧版本计算的结果', () => {
  const v = getPrjPack(LATEST_PRJ_PACK);
  registerPrjPack({ ...v, version: 'prj@0.2-test', profiles: { ...v.profiles, laser_wuxga: { ...v.profiles.laser_wuxga, derate: 0.7 } } });
  assert.ok(Math.abs(V(computePrj(base, LATEST_PRJ_PACK), 'lm_proj') - 17500) < 1e-6);
  assert.ok(V(computePrj(base, 'prj@0.2-test'), 'lm_proj') > 17500);
});

test('出图：五个图层，融合带单独成层，草图标记', () => {
  const r = computePrj({ ...base, prj_image_w: 9000, prj_image_h: 3000 }, LATEST_PRJ_PACK);
  const d = buildPrjDrawing(r, { project: '宽幅测试' })!;
  assert.deepEqual(d.layers.map((l) => l.name), ['PRJ-01-画面', 'PRJ-02-投影覆盖', 'PRJ-03-融合带', 'PRJ-06-标注', 'PRJ-07-文字']);
  assert.equal(d.layers[1].entities.filter((e) => e.k === 'rect').length, 2);
  assert.equal(d.layers[2].entities.filter((e) => e.k === 'rect').length, 1);
  const info = d.layers[4].entities.map((e) => (e as { s: string }).s).join('\n');
  assert.match(info, /现场复核后方可施工/);
  assert.match(info, /草案，不得用于正式报价/);
  assert.ok(toSvg(d).includes('<g id="PRJ-03-融合带"'));
});

test('投影成本：台数、面积、信号线来自 P2 / P1 / P10；亮度不足阻断', () => {
  const r = computePrj({ ...base, prj_image_w: 9000, prj_image_h: 3000 }, LATEST_PRJ_PACK);
  const t = r.trace;
  const cfg: SavedConfig<PrjSummary> = {
    id: 1, projectId: 'p', line: 'projector', packVersion: LATEST_PRJ_PACK, drawingId: null, createdBy: 'PM', createdAt: 0,
    summary: { width: 9000, height: 3000, area: t.area.value, nProj: t.n_proj.value, lmProj: t.lm_proj.value, throwRatio: t.throw_ratio.value,
      pxW: t.px_w.value, pxH: t.px_h.value, kw: t.kw.value, nCircuit: t.n_circuit.value, nSignalCable: t.n_signal_cable.value,
      profile: 'laser_wuxga', content: 'basic', exportable: r.exportable, blocking: ['PRJ-TYPE-01'] },
  };
  const item = (id: number, model: string, spec: string, unit: string, cost: number, list: number): PriceItem => ({
    id, line: 'projector', category: 'x', categoryLabel: '投影', model, pitch: spec, moduleSize: '', cabinetSize: '', unit,
    costPrice: cost, listPrice: list, currency: 'SGD', source: '', validUntil: '', active: true, updatedBy: '', updatedAt: 0,
  });
  const items = [item(1, '20K 激光机', '20,000 lm', '台', 30000, 38000), item(2, '30K 激光机', '30,000 lm', '台', 52000, 65000),
    item(3, '硬幕', '', '㎡', 300, 450), item(4, 'HDBaseT', '', '根', 80, 120), item(5, '吊架', '', '套', 400, 600), item(6, '融合器', '', '套', 9000, 12000)];
  let lines = buildPrjLines(cfg, { projector: 1, screen: 3, signal_cable: 4, mount: 5, blend: 6 }, [], items);
  assert.deepEqual(lines.map((l) => [l.key, l.qty]), [['projector', 2], ['screen', 27], ['signal_cable', 3], ['mount', 2], ['blend', 1]]);
  assert.ok(prjChecks(lines, cfg, items).some((c) => c.severity === 'block'), '20,000 lm < 25,886 lm');
  lines = buildPrjLines(cfg, { projector: 2, screen: 3, signal_cable: 4, mount: 5, blend: 6 }, [], items);
  assert.deepEqual(prjChecks(lines, cfg, items), []);
  assert.equal(totals(lines).cost, 2 * 52000 + 27 * 300 + 3 * 80 + 2 * 400 + 9000);
  const checks = checkSheet(lines, cfg, items, 0.18, '2026-09-25', prjChecks(lines, cfg, items));
  assert.ok(checks.some((c) => c.code === 'COST-CFG' && c.severity === 'block' && /PRJ-TYPE-01/.test(c.message)), '草案规则包不能确认正式成本');
});
