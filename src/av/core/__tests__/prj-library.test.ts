/* 投影 prj@0.2（AV-020 第 3 部分）· 设备库（价格库「投影」）、prj@1.0、06 配置模板 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildPrjLines, checkSheet, type PriceItem, type PrjSummary, type SavedConfig } from '../pricing.ts';
import { prjCalcBasis } from '../prj/calc.ts';
import { computePrjGroups, type PrjGroupsConfig } from '../prj/groups.ts';
import { PRJ_DEVICE_SEED, PRJ_LIBRARY_SEED, prjLibraryFrom, type PrjDeviceRow } from '../prj/library.ts';
import { getPrjGroupsPack, LATEST_PRJ_PACK, PRJ_CONST_LABEL, PRJ_RELEASE_PACK, prjPackUpgradable } from '../prj/rulepack.ts';
import { prjSample } from '../prj/samples.ts';
import { prjSummaryOf } from '../prj/system.ts';
import { prjAnswersOf, prjPrefill } from '../prj/inquiry.ts';

const V2 = 'prj@0.2';
const rows = (): PrjDeviceRow[] => PRJ_DEVICE_SEED.map((r) => ({ model: r.model, active: true, spec: JSON.parse(JSON.stringify(r.spec)) }));
const items = (): PriceItem[] => PRJ_DEVICE_SEED.map((r, i) => ({
  id: i + 1, line: 'projector', category: r.category, categoryLabel: r.categoryLabel, model: r.model, pitch: r.pitch, moduleSize: '', cabinetSize: '',
  unit: r.unit, costPrice: null, listPrice: r.listPrice, currency: 'SGD', source: r.source, validUntil: '', active: true, updatedBy: '', updatedAt: 0,
  spec: JSON.parse(JSON.stringify(r.spec)),
}));
const saved = (cfg: PrjGroupsConfig, pack = V2): SavedConfig<PrjSummary> =>
  ({ id: 1, projectId: 'p', line: 'projector', packVersion: pack, drawingId: null, summary: prjSummaryOf(computePrjGroups(cfg, pack)), createdBy: 'JM', createdAt: 0 });

test('设备库（填写表四 rev 1）：7 款投影机；Seemile 带原装标配 + 选配 0.57–1.0 + 国产定焦 0.46 / 0.5 / 0.6 / 0.8（位移 ±40%）', () => {
  const lib = prjLibraryFrom(rows());
  assert.deepEqual(Object.keys(lib), ['GMZ501C', 'BHZ611C', 'PU800', 'PU900', 'BAZ722', 'L695SE', 'C15KU']);
  assert.deepEqual(lib.PU900.lenses.map((l) => l.code), ['std', 'z057', 'f046', 'f050', 'f060', 'f080']);
  const f046 = lib.PU900.lenses.find((l) => l.code === 'f046')!;
  assert.deepEqual([f046.throwMin, f046.throwMax, f046.shiftUp, f046.shiftDown], [0.46, 0.46, 0.4, 0.4]);
  assert.equal(lib.PU900.lenses[0].shiftUp, undefined, '原装镜头用机器的位移 ±50%');
  assert.equal(lib.C15KU.lumens, 10000);
  assert.equal(lib.BAZ722.watts, null);
  assert.deepEqual(lib.BAZ722.lenses, [], '新机型的镜头待补');
  assert.deepEqual(prjLibraryFrom(rows()), PRJ_LIBRARY_SEED);
});

test('设备库可增改：停用的机型不出现；改镜头适配、投射比、功耗后计算跟着变', () => {
  const r = rows();
  (r.find((x) => x.model === 'Panasonic PT-BAZ722')!).active = false;
  assert.ok(!prjLibraryFrom(r).BAZ722);
  /* 把国产 0.5 镜头也适配给 C15KU、补上功耗：C15KU 就能算了 */
  const r2 = rows();
  const c15 = r2.find((x) => x.model === 'Epson CB-C15KU')!.spec as { watts: number | null };
  c15.watts = 700;
  (r2.find((x) => x.model === '国产定焦 0.5')!.spec as { fits: string[] }).fits.push('C15KU');
  const lib = prjLibraryFrom(r2);
  const cfg = prjSample('single');
  cfg.prj_groups[0] = { ...cfg.prj_groups[0], projector: 'C15KU', lens: 'f050' };
  const out = computePrjGroups(cfg, V2, lib);
  assert.ok(out.ok);
  assert.equal(out.groups[0].lens.code, 'f050');
  assert.ok(out.findings.some((f) => f.code === 'PRJ-LM-01'), '10000 lm 超过 9000 标黄');
  assert.ok(Math.abs(out.kw - out.nProj * 0.7) < 1e-9);
  /* 没有镜头数据的机型：不能算（PRJ-FIT-01），提示去价格库补 */
  const noLens = prjSample('single');
  noLens.prj_groups[0].projector = 'BAZ722';
  const bad = computePrjGroups(noLens, V2, prjLibraryFrom(rows()));
  assert.ok(!bad.ok);
  assert.match(bad.findings[0].message, /还没有镜头数据/);
  /* 有镜头、没功耗：照算，标黄 PRJ-SPEC-01，计算依据「功耗待录入」 */
  const r3 = rows();
  (r3.find((x) => x.model === '国产定焦 0.6')!.spec as { fits: string[] }).fits.push('BAZ722');
  const cfg3 = prjSample('single');
  cfg3.prj_groups[0] = { ...cfg3.prj_groups[0], projector: 'BAZ722', lens: 'f060' };
  const out3 = computePrjGroups(cfg3, V2, prjLibraryFrom(r3));
  assert.ok(out3.ok);
  assert.ok(out3.findings.some((f) => f.code === 'PRJ-SPEC-01' && f.severity === 'warn'));
  assert.equal(prjCalcBasis(out3).rows.find((x) => x.key === 'power')!.cells[0].text, '功耗待录入');
});

test('prj@1.0：常数和 0.2 一样、全部已确认；数字不变，不再提示「待校准」；0.2 项目在发布后可升级', () => {
  const v10 = getPrjGroupsPack(PRJ_RELEASE_PACK);
  const v02 = getPrjGroupsPack(V2);
  assert.ok(v10.calibrated && !v02.calibrated);
  for (const k of Object.keys(PRJ_CONST_LABEL) as (keyof typeof v02.constants)[]) {
    assert.deepEqual(v10.constants[k].value, v02.constants[k].value, k);
    assert.ok(v10.constants[k].confirmed);
  }
  assert.equal(Object.keys(PRJ_CONST_LABEL).length, Object.keys(v02.constants).length, '确认页列出每个常数');
  const a = computePrjGroups(prjSample('MY016'), V2), b = computePrjGroups(prjSample('MY016'), PRJ_RELEASE_PACK);
  assert.equal(b.nProj, a.nProj);
  assert.equal(b.groups[0].lux, a.groups[0].lux);
  assert.ok(a.findings.some((f) => f.code === 'PRJ-CAL-01') && !b.findings.some((f) => f.code === 'PRJ-CAL-01'));
  assert.match(prjCalcBasis(b).rows.find((x) => x.key === 'blend')!.basis, /已确认/);
  assert.equal(LATEST_PRJ_PACK, V2, '发布之前新项目仍用 0.2');
  assert.ok(!prjPackUpgradable(V2), '没发布 1.0 时 0.2 不提示升级');
  assert.ok(prjPackUpgradable(V2, PRJ_RELEASE_PACK));
  assert.ok(prjPackUpgradable('prj@0.1-draft', PRJ_RELEASE_PACK));
  assert.ok(!prjPackUpgradable(PRJ_RELEASE_PACK, PRJ_RELEASE_PACK));
});

test('06 配置模板（MY014）：投影机 4、支架 4、融合软件 2、多屏宝 2、PC 2、线材 4、雷达 2、交换机 1、中控 1、安装 3 人 × 2 天、出差 1', () => {
  const cfg = saved(prjSample('MY014'));
  const lines = buildPrjLines(cfg, {}, [], items());
  const q = Object.fromEntries(lines.map((l) => [l.key, l.qty]));
  assert.deepEqual(q, { 'projector:GMZ501C': 4, p_mount: 4, p_blend: 2, p_box: 2, p_pc: 2, p_cable: 4, p_radar: 2, p_switch: 1, p_control: 1, p_install: 6, p_trip: 1 });
  assert.equal(lines.find((l) => l.key === 'p_install')!.name, '安装调试（3 人 × 2 天，含融合调试）');
  /* 缺省挑了价格库里的对应条目；MY014 的单价在售价栏 */
  assert.equal(lines.find((l) => l.key === 'p_pc')!.unitList, 7500);
  assert.equal(lines.find((l) => l.key === 'projector:GMZ501C')!.itemLabel, '投影机 · Panasonic PT-GMZ501C · 5000 lm');
  /* 投影机、交换机、安装没价格、成本价都待填：只提示「待报价」，不阻断确认成本 */
  const checks = checkSheet(lines, cfg, items(), 0.18, '2026-10-07');
  assert.ok(!checks.some((c) => c.severity === 'block'), JSON.stringify(checks.filter((c) => c.severity === 'block')));
  assert.equal(checks.filter((c) => c.code === 'COST-CTRL-QUOTE').length, lines.length);
});

test('06 配置模板：台数变了数量跟着变（MY016 5 台 → 多屏宝 3、安装 3 人 × 3 天、无雷达）；人工挑的条目优先；prj@0.1 方案照旧', () => {
  const lines = buildPrjLines(saved(prjSample('MY016')), {}, [], items());
  const q = Object.fromEntries(lines.map((l) => [l.key, l.qty]));
  assert.equal(q['projector:PU900'], 5);
  assert.equal(q.p_box, 3);
  assert.equal(q.p_install, 9);
  assert.ok(!('p_radar' in q));
  /* 两种机型两行 */
  const two = prjSample('MY014');
  two.prj_groups[1] = { ...prjSample('single').prj_groups[0], name: '主墙' };
  assert.deepEqual(buildPrjLines(saved(two), {}, [], items()).filter((l) => l.key.startsWith('projector:')).map((l) => [l.key, l.qty]),
    [['projector:GMZ501C', 2], ['projector:PU800', 3]]);
  /* 人工改选：null = 不挑 */
  const picked = buildPrjLines(saved(prjSample('MY016')), { p_trip: null }, [], items());
  assert.equal(picked.find((l) => l.key === 'p_trip')!.itemId, null);
  /* 老的单画面方案（没有 groups / system）还是原来那几行 */
  const old = saved(prjSample('single'));
  delete old.summary.system;
  assert.deepEqual(buildPrjLines(old, { projector: null, screen: null, signal_cable: null, mount: null, blend: null }, [], items()).map((l) => l.key),
    ['projector', 'screen', 'signal_cable', 'mount', 'blend']);
});

test('01 投影五项：只收认得的值；05 新开方案按它预填，没答的不动', () => {
  const a = prjAnswersOf({ prj_scene: 'immersive', prj_interact: 'wall', prj_env: 'nope', prj_ceiling: '4.3', prj_near: '' }, { play_use: 'ads' } as never);
  assert.deepEqual(a, { play_use: 'ads', prj_scene: 'immersive', prj_interact: 'wall', prj_env: null, prj_ceiling: 4.3, prj_near: null });
  assert.equal(prjAnswersOf({ prj_ceiling: '0.2' }, {}).prj_ceiling, null, '天花太小不收');
  assert.deepEqual(prjAnswersOf({}, { prj_env: 'dark' }), { prj_env: 'dark' }, '没传的键保持原样');
  const cfg = prjPrefill(prjSample('single'), { prj_ceiling: 4.3, prj_env: 'dark', prj_near: 0, prj_interact: null });
  assert.deepEqual([cfg.prj_ceiling, cfg.prj_env, cfg.prj_view_near, cfg.prj_interact], [4.3, 'dark', 0, 'none']);
  assert.deepEqual(prjPrefill(prjSample('single'), null), prjSample('single'));
});
