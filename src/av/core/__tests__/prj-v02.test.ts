/* 投影规则包 prj@0.2（AV-020）· 融合组 × 投影面、样本回测、检查规则、计算依据、旧配置迁移 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { prjCalcBasis } from '../prj/calc.ts';
import { computePrjGroups, demotePrjV02, migratePrjV01, type PrjGroupsConfig } from '../prj/groups.ts';
import { computePrj } from '../prj/compute.ts';
import { PRJ_LIBRARY_SEED } from '../prj/library.ts';
import { getPrjGroupsPack, isGroupsPack, LATEST_PRJ_PACK, PRJ_V01_PACK, prjPackUpgradable, registerPrjGroupsPack } from '../prj/rulepack.ts';
import { prjSample } from '../prj/samples.ts';

const V2 = 'prj@0.2';
const run = (cfg: PrjGroupsConfig, pack = V2, lib = PRJ_LIBRARY_SEED) => computePrjGroups(cfg, pack, lib);
const codes = (r: ReturnType<typeof run>) => r.findings.map((f) => f.code);
const near = (a: number, b: number, eps = 0.005) => Math.abs(a - b) <= eps;

test('新项目绑定 prj@0.2；prj@0.1-draft 可升级、0.2 不再提示升级', () => {
  assert.equal(LATEST_PRJ_PACK, V2);
  assert.ok(isGroupsPack(V2));
  assert.ok(!isGroupsPack(PRJ_V01_PACK));
  assert.ok(prjPackUpgradable(PRJ_V01_PACK));
  assert.ok(!prjPackUpgradable(V2));
});

test('回测 MY016（U 形 6810 + 13645 + 6810 × 4300，PU900 + 0.46）：5 台、投射约 3.16 m、镜头离地 3.9 m、≥ 250 lx', () => {
  const r = run(prjSample('MY016'));
  assert.ok(r.ok);
  const g = r.groups[0];
  assert.equal(r.nProj, 5);
  assert.equal(g.reason, 'height');
  assert.equal(Math.round(g.w * 1000), 6880);
  assert.equal(Math.round(g.h * 1000), 4300);
  assert.ok(near(g.d, 3.165), `投射 ${g.d}`);
  /* 设备清单 rev 1（2026-10-07）：0.46 是国产定焦，位移上下 40%（规格书原装 ±50%）→ 镜头最高 2.15 + 0.4 × 4.3 = 3.87 m，
     按一位小数仍是验收的 3.9 m；实际图纸画面 7200 × 4500、镜头 3.9 m 时位移约 37%，也在 40% 内 */
  assert.ok(near(g.lensH, 3.87), `镜头离地 ${g.lensH}`);
  assert.equal(g.lensH.toFixed(1), '3.9');
  assert.equal(Math.round(g.lux), 304);
  assert.ok(g.lux >= 250);
  assert.equal(Math.round((g.shift ?? 0) * 100), 40);
  assert.ok(g.ceilOk, '位移用满 40%，不报天花太矮');
  assert.equal(Math.round(g.blend * 1000), 1720);
  assert.ok(codes(r).includes('PRJ-BLEND-01'), '5 台融合 → 需要融合器');
  assert.ok(!r.findings.some((f) => f.severity === 'block'), 'MY016 没有红项');
  assert.ok(r.exportable);
});

test('回测 MY014（两组各 4212 × 1900，GMZ501C 超短焦，墙面互动）：每组 2 台、共 4 台、866 lx', () => {
  const r = run(prjSample('MY014'));
  assert.deepEqual(r.groups.map((g) => g.n), [2, 2]);
  assert.equal(r.nProj, 4);
  for (const g of r.groups) {
    assert.equal(Math.round(g.w * 1000), 3040);
    assert.equal(Math.round(g.lux), 866);
    assert.ok(near(g.d, 0.714), '投射距离按 0.235 × 3.04 m（填写表写 400 mm，待核对）');
    assert.equal(g.shift, null, '超短焦不用镜头位移');
    assert.equal(g.shadowY, null, '超短焦贴墙投，不做遮挡计算');
  }
  assert.ok(codes(r).includes('PRJ-INT-01'));
  assert.ok(!r.findings.some((f) => f.severity === 'block'));
});

test('114 的输入：标配镜头在 2.34 m 盖不住 2.7 m 高 → 标红并建议换短焦镜头或加台数（仍可保存）', () => {
  const r = run(prjSample('114'));
  const red = r.findings.filter((f) => f.code === 'PRJ-THROW-01');
  assert.equal(red.length, 2);
  assert.ok(red.every((f) => f.severity === 'block' && f.gate === 'export'));
  assert.match(red[0].message, /换短焦镜头或加台数/);
  assert.match(red[0].messageEn ?? '', /shorter-throw lens or more projectors/);
  assert.ok(r.ok, '红项只拦导出，方案仍可保存');
  assert.ok(!r.exportable);
});

test('检查：单像素超过最近观看距离标黄；光线低于人头标黄，有墙面互动时建议背投或超短焦', () => {
  const cfg = prjSample('MY016');
  const r = run(cfg);
  const px = r.findings.find((f) => f.code === 'PRJ-PX-01');
  assert.equal(px?.severity, 'warn');
  assert.match(px!.message, /3\.6 mm/);
  const sh = r.findings.find((f) => f.code === 'PRJ-SHADOW-01');
  assert.equal(sh?.severity, 'warn');
  assert.ok(r.groups[0].shadowY! < 1.8);
  assert.doesNotMatch(sh!.message, /背投/);
  const withInteract = run({ ...cfg, prj_interact: 'wall' });
  assert.match(withInteract.findings.find((f) => f.code === 'PRJ-SHADOW-01')!.message, /背投或超短焦/);
  /* 观众站远一点就不挡光，也看不出像素 */
  const far = run({ ...cfg, prj_view_near: 4 });
  assert.ok(!codes(far).includes('PRJ-PX-01'));
  assert.ok(!codes(far).includes('PRJ-SHADOW-01'));
});

test('检查：天花不够标红 —— 镜头位移不够（BHZ611C 不能向下位移）、超短焦装不下', () => {
  const low: PrjGroupsConfig = {
    prj_ceiling: 2.0, prj_env: 'window', prj_view_near: 0, prj_interact: 'none',
    prj_groups: [{ name: '会议室', projector: 'BHZ611C', lens: 'std', dmax: 6, bottom: 0.5, faces: [{ kind: 'wall', w: 4000, h: 2500, turn: 0 }] }],
  };
  const r = run(low);
  const f = r.findings.find((x) => x.code === 'PRJ-CEIL-01');
  assert.equal(f?.severity, 'block');
  assert.match(f!.message, /天花太矮/);
  assert.ok(!run({ ...low, prj_ceiling: 2.6 }).findings.some((x) => x.code === 'PRJ-CEIL-01'));
  const ust = run({ ...prjSample('MY014'), prj_ceiling: 2.2 });
  assert.ok(codes(ust).includes('PRJ-CEIL-01'), '超短焦：画面顶 2.07 m + 0.2 m 超过天花 2.2 m');
});

test('地面：吊顶向下投；投射距离超出镜头范围标红；地面互动提示人影', () => {
  const fl = run(prjSample('floor'));
  const g = fl.groups[0];
  assert.ok(g.floor);
  assert.ok(near(g.d, 2.9));
  assert.ok(g.dOk);
  assert.ok(codes(fl).includes('PRJ-SHADOW-02'));
  const cfg = prjSample('floor');
  cfg.prj_groups[0].lens = 'std';
  assert.ok(codes(run(cfg)).includes('PRJ-THROW-02'), '标配 1.07 镜头在 2.9 m 投不出 4.8 m 宽');
});

test('检查：单机流明超过 9000 lm 标黄；设备库改机型后计算跟着变', () => {
  const lib = { ...PRJ_LIBRARY_SEED, X12K: { ...PRJ_LIBRARY_SEED.PU900, code: 'X12K', name: 'Test 12K', lumens: 12000 } };
  const cfg = prjSample('single');
  cfg.prj_groups[0].projector = 'X12K';
  const r = run(cfg, V2, lib);
  assert.equal(r.findings.find((f) => f.code === 'PRJ-LM-01')?.severity, 'warn');
  assert.ok(r.groups[0].lux > run(prjSample('single')).groups[0].lux, '流明更高，照度跟着变');
});

test('版本锁定：新常数只影响新版本；融合带占比小于 15% 标黄', () => {
  const base = getPrjGroupsPack(V2);
  registerPrjGroupsPack({ ...base, version: 'prj@0.2-test', constants: { ...base.constants, overlap: { ...base.constants.overlap, value: 0.1 } } });
  const cfg = prjSample('MY016');
  assert.equal(run(cfg).groups[0].overlap, 0.25);
  const t = run(cfg, 'prj@0.2-test');
  assert.equal(t.groups[0].overlap, 0.1);
  assert.equal(t.findings.find((f) => f.code === 'PRJ-BLEND-02')?.severity, 'warn');
  assert.ok(!codes(run(cfg)).includes('PRJ-BLEND-02'));
});

test('常数待校准：可以导出（PRJ-CAL-01 只是提示）；用电按规格书功耗、2.5 kW 一路', () => {
  const r = run(prjSample('MY016'));
  const cal = r.findings.find((f) => f.code === 'PRJ-CAL-01');
  assert.equal(cal?.severity, 'info');
  assert.equal(cal?.gate, 'export');
  assert.ok(near(r.kw, 2.9));
  assert.equal(r.nCircuit, 2);
});

test('输入无效时不计算（PRJ-FIT-01）', () => {
  const cfg = prjSample('single');
  cfg.prj_groups[0].faces[0].w = 0;
  const r = run(cfg);
  assert.ok(!r.ok);
  assert.equal(r.findings[0].code, 'PRJ-FIT-01');
  const mixed = prjSample('single');
  mixed.prj_groups[0].faces.push({ kind: 'floor', w: 3000, h: 2000, turn: 0 });
  assert.match(run(mixed).findings[0].message, /不能同时有墙和地面/);
});

test('所有检查都有中英两套文字', () => {
  for (const key of ['MY016', 'MY014', '114', 'single', 'floor']) {
    for (const f of run({ ...prjSample(key), prj_interact: 'wall' }).findings) {
      /* group names are the user's own text; everything else must be English */
      const text = (f.messageEn ?? '').replace(/左墙|右墙|左区|右区|主墙|地面|U 形连续/g, '');
      assert.ok(f.messageEn, `${f.code} 缺英文`);
      assert.doesNotMatch(text, /[一-鿿]/, `${f.code} 英文`);
    }
  }
});

test('计算依据：每组一列；常数显示来源与确认状态；中英两套', () => {
  const r = run(prjSample('MY014'));
  const zh = prjCalcBasis(r, 'zh');
  assert.deepEqual(zh.groups, ['左墙', '右墙']);
  assert.ok(zh.rows.every((row) => row.cells.length === 2));
  const keys = zh.rows.map((x) => x.key);
  assert.deepEqual(keys, ['faces', 'model', 'n', 'image', 'blend', 'lux', 'lux_ind', 'throw', 'lens_h', 'shadow', 'pixel', 'power']);
  const blend = zh.rows.find((x) => x.key === 'blend')!;
  assert.match(blend.basis, /0\.25（样本反推 · 待确认）/);
  assert.match(zh.rows.find((x) => x.key === 'lux')!.basis, /暗室 150 \/ 有窗 250 \/ 明亮 500 lx/);
  assert.equal(zh.rows.find((x) => x.key === 'lux')!.cells[0].ok, true);
  assert.match(zh.total, /4 台 · 1\.54 kW → ceil\(1\.54 ÷ 2\.5\) = 1 路/);
  const en = prjCalcBasis(r, 'en');
  for (const row of en.rows) {
    assert.doesNotMatch(row.item + row.basis, /[一-鿿]/, `${row.key} 英文`);
  }
  assert.match(en.rows.find((x) => x.key === 'blend')!.basis, /From finished projects · to confirm/);
});

test('旧配置（prj@0.1 单画面）迁移成 1 组 1 面，可直接计算', () => {
  const m = migratePrjV01({
    prj_image_w: 6000, prj_image_h: 3375, prj_throw_dist: 6.5, prj_ambient_lux: 150, prj_screen_gain: 1,
    prj_content: 'basic', prj_profile: 'laser_wuxga', prj_view_far: 15, prj_view_near: 3,
  });
  assert.equal(m.prj_groups.length, 1);
  assert.deepEqual(m.prj_groups[0].faces, [{ kind: 'wall', w: 6000, h: 3375, turn: 0 }]);
  assert.equal(m.prj_groups[0].dmax, 6.5);
  assert.equal(m.prj_env, 'dark');
  assert.equal(m.prj_view_near, 3);
  assert.ok(m.prj_ceiling >= 3.375 + 0.4, '迁移时天花至少容得下画面和吊装');
  assert.ok(run(m).ok);
});

test('回退用：prj@0.2 方案能改回 prj@0.1 的单画面并照旧计算', () => {
  const d = demotePrjV02(prjSample('MY016'));
  assert.equal(d.prj_image_w, 6810 + 13645 + 6810);
  assert.equal(d.prj_image_h, 4300);
  assert.equal(d.prj_throw_dist, 3.5);
  assert.equal(d.prj_ambient_lux, 250);
  assert.ok(computePrj(d, PRJ_V01_PACK).ok);
  const f = demotePrjV02(prjSample('floor'));
  assert.ok(Math.abs(f.prj_throw_dist - 2.9) < 1e-9);
  assert.equal(f.prj_view_near, undefined);
});
