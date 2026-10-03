/* AV-019 · led@1.1 回路算法修正 + 计算依据表 + 线路图版式 (§3 自测) */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calcBasis } from '../calc.ts';
import { compute } from '../compute.ts';
import { buildDrawing, LAYER_TOGGLES, textBoxes } from '../drawing.ts';
import { FIXTURES, fixtureConfig } from '../fixtures.ts';
import { getRulePack, LATEST_LED_PACK, ledPackUpgradable } from '../rulepack.ts';
import { overlap, segHitsBox } from '../textfit.ts';
import { wiring } from '../wiring.ts';

const BOC = FIXTURES.find((f) => f.id === '148')!;
const boc = (mode: 'row' | 'snake' = 'row', v = 'led@1.1') => compute({ ...fixtureConfig(BOC), led_data_mode: mode }, v);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/* 一块 n 列 × 6 行、640 × 480 箱体、500 W/㎡ 的屏:每箱 153.6 W,单列 921.6 W */
function grid(nc: number, nr = 6, limitKw = 2.5, wSqm = 500) {
  const widths = Array(nc).fill(640), heights = Array(nr).fill(480);
  const cells = heights.flatMap((h, r) => widths.map((w, c) => ({ r: r + 1, c: c + 1, w, h })));
  return wiring({
    widths, heights, cells, algo: 'chain', dataMode: 'row', voltage: 230,
    H: nr * 480, pitch: 2.5, wSqm, circuitKw: limitKw, dataPx: 560000, pxW: nc * 256,
    kw: (nc * nr * 0.64 * 0.48 * wSqm) / 1000, rowRunOf: () => 1,
  });
}

test('AV-019 · 单列 921.6 W、上限 2.5 kW:任何回路都不超过上限', () => {
  for (let nc = 1; nc <= 24; nc++) {
    const w = grid(nc);
    assert.ok(near(w.cellW[0], 153.6), '每箱 153.6 W');
    const colW = w.cellW.slice(0, 6).reduce((a, b) => a + b, 0);
    assert.ok(near(colW, 921.6), '单列 921.6 W');
    for (const pc of w.power) assert.ok(pc.w <= 2500 + 1e-6, `${nc} 列:回路 ${Math.round(pc.w)} W 超过 2500 W`);
    /* 每只箱体恰好在一个回路里 */
    const seen = w.power.flatMap((pc) => pc.cells).sort((a, b) => a - b);
    assert.deepEqual(seen, w.cellW.map((_, i) => i), `${nc} 列:箱体不重不漏`);
    /* 回路数 = 理论下限,或者下限放不下时 +1(不会多加) */
    const lower = Math.ceil((nc * 921.6) / 2500 - 1e-9);
    assert.ok(w.nCircuit >= lower && w.nCircuit <= lower + 1, `${nc} 列:${w.nCircuit} 路(下限 ${lower})`);
    assert.equal(w.nPowerCable, w.nCircuit + 1);
  }
});

test('AV-019 · 上限再紧也逐路校核(随机尺寸 / 功耗 / 上限)', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let t = 0; t < 200; t++) {
    const nc = 1 + Math.floor(rnd() * 14), nr = 1 + Math.floor(rnd() * 8);
    const wSqm = 200 + Math.floor(rnd() * 600);
    const limitKw = 0.6 + rnd() * 3;
    const w = grid(nc, nr, limitKw, wSqm);
    const maxCell = Math.max(...w.cellW);
    if (maxCell > limitKw * 1000) continue;  // 单只箱体就超限:另有提示
    for (const pc of w.power) assert.ok(pc.w <= limitKw * 1000 + 1e-6, `case ${t}: ${pc.w} > ${limitKw * 1000}`);
  }
});

test('AV-019 · BOC 5120 × 2880(640 × 480,500 W/㎡):3 路 × 16 箱 = 2457.6 W', () => {
  const r = boc();
  assert.equal(r.pack.version, 'led@1.1');
  const w = r.wiring!;
  assert.equal(w.algo, 'chain');
  assert.equal(w.nCircuit, 3);
  assert.equal(r.trace.n_circuit.value, 3);
  assert.equal(r.trace.n_power_cable.value, 4, '报价 3 + 1 备用');
  for (const pc of w.power) {
    assert.equal(pc.cells.length, 16);
    assert.ok(near(pc.w, 2457.6), `回路 ${pc.w} W`);
    assert.ok(Math.abs(pc.amps! - 10.685) < 0.01, '230 V 下约 10.7 A');
  }
  /* 第 1 路:第 1 列自下而上、第 2 列自上而下,再进第 3 列下面 4 只 —— 允许一列中途换回路 */
  const cells = r.layout!.cells;
  const first = w.power[0].cells.map((i) => `R${cells[i].r}C${cells[i].c}`);
  assert.deepEqual(first.slice(0, 6), ['R1C1', 'R2C1', 'R3C1', 'R4C1', 'R5C1', 'R6C1']);
  assert.deepEqual(first.slice(6, 12), ['R6C2', 'R5C2', 'R4C2', 'R3C2', 'R2C2', 'R1C2']);
  assert.deepEqual(first.slice(12), ['R1C3', 'R2C3', 'R3C3', 'R4C3']);
  assert.ok(!r.findings.some((f) => f.code === 'LED-PWR-09'), '1.1 不再有超限');
});

test('AV-019 · BOC 网线:每行一条 6 条,蛇形按带载 5 条,每条带载都不超', () => {
  const row = boc('row').wiring!, snake = boc('snake').wiring!;
  assert.equal(row.nDataRun, 6);
  assert.equal(row.nDataCable, 7);
  assert.ok(row.runs.every((x) => x.px === 393216), '每行 8 × 49,152 = 393,216');
  assert.equal(snake.nDataRun, 5);
  assert.equal(snake.nDataCable, 6);
  for (const w of [row, snake]) {
    assert.ok(w.runs.every((x) => x.px <= 560000), '每条 ≤ 560,000 px');
    assert.deepEqual(w.runs.flatMap((x) => x.cells).sort((a, b) => a - b), w.cellPx.map((_, i) => i), '箱体不重不漏');
  }
  /* 每行一条:一条线不跨行 */
  const cells = boc().layout!.cells;
  for (const run of row.runs) assert.equal(new Set(run.cells.map((i) => cells[i].r)).size, 1);
});

test('AV-019 · led@1.0 不改:BOC 仍是 2765 / 2765 / 1843 W,但标出超限并提示升级', () => {
  const r = boc('row', 'led@1.0');
  assert.equal(r.wiring!.algo, 'columns');
  assert.deepEqual(r.wiring!.power.map((p) => Math.round(p.w * 10) / 10), [2764.8, 2764.8, 1843.2]);
  const f = r.findings.find((x) => x.code === 'LED-PWR-09');
  assert.ok(f, '超限要标出来');
  assert.match(f!.message, /升级到新版规则包/);
  assert.equal(LATEST_LED_PACK, 'led@1.2');
  assert.ok(ledPackUpgradable('led@1.0'));
  assert.ok(ledPackUpgradable('led@1.1'), '1.1 也可以升级到 1.2');
  assert.ok(!ledPackUpgradable('led@1.2'));
  assert.ok(!ledPackUpgradable(undefined));
  /* led@1.0 的公式表原样 */
  assert.equal(getRulePack('led@1.0').formulas.find((x) => x.id === 'F6')!.source.includes('AV-019'), false);
});

test('AV-019 · 全部历史项目在 1.1 下:回路逐路 ≤ 上限,网线逐条 ≤ 带载', () => {
  for (const f of FIXTURES) for (const mode of ['row', 'snake'] as const) {
    const r = compute({ ...fixtureConfig(f), led_data_mode: mode }, 'led@1.1');
    if (!r.wiring) continue;
    for (const pc of r.wiring.power) assert.ok(pc.w <= r.wiring.limitW + 1e-6, `${f.name} 回路 ${pc.w}`);
    for (const run of r.wiring.runs) assert.ok(run.px <= r.pack.control.dataPx, `${f.name} 网线 ${run.px}`);
  }
});

test('AV-019 · 计算依据表:BOC 每一步都写清楚,中英两套', () => {
  const rows = calcBasis(boc(), 'zh');
  const get = (k: string) => rows.find((x) => x.key === k)!;
  assert.deepEqual(rows.map((x) => x.key), ['cab_w', 'total', 'circuits', 'load', 'cable', 'cascade', 'cab_px', 'data']);
  assert.equal(get('cab_w').result, '153.6 W');
  assert.equal(get('cab_w').formula, '0.64 × 0.48 × 500');
  assert.equal(get('total').result, '7372.8 W');
  assert.equal(get('circuits').result, '3 路 + 1 备用');
  assert.match(get('load').formula, /^16 × 153\.6 ÷ 230 V$/);
  assert.match(get('load').result, /2457\.6 W \/ 10\.7 A ✓/);
  assert.equal(get('load').ok, true);
  assert.match(get('cable').result, /✓ 10\.7 A ≤ 16 A/);
  assert.equal(get('cascade').ok, null, '级联上限待填');
  assert.match(get('cab_px').result, /256 × 192 = 49,152/);
  assert.match(get('data').formula, /8 × 49,152 = 393,216 ≤ 560,000/);
  assert.match(get('data').result, /6 条 \+ 1 备用/);
  const snake = calcBasis(boc('snake'), 'zh').find((x) => x.key === 'data')!;
  assert.match(snake.formula, /floor\(560,000 ÷ 49,152\) = 11/);
  assert.match(snake.result, /5 条/);
  const en = calcBasis(boc(), 'en');
  assert.equal(en.find((x) => x.key === 'circuits')!.result, '3 + 1 spare');
  for (const row of en) assert.ok(!/[一-鿿]/.test(`${row.item}${row.formula}${row.result}${row.source}`), `英文版混入中文:${row.item}`);
  /* 1.0:超限要在表里显示 ✕ */
  const old = calcBasis(boc('row', 'led@1.0'), 'zh').find((x) => x.key === 'load')!;
  assert.equal(old.ok, false);
  assert.match(old.result, /✕ 超限/);
});

test('AV-019 · DXF 说明栏 = 计算依据表(同一份数据)', () => {
  const r = boc();
  const d = buildDrawing(r, { project: 'BOC Lobby LED' })!;
  const info = d.layers.find((l) => l.name === 'LED-07-文字')!.entities.filter((e) => e.k === 'text').map((e) => (e as { s: string }).s);
  /* 长行会折行(续行缩进两格):拼回去再比 */
  const joined = info.reduce<string[]>((acc, x) => (x.startsWith('  ') && acc.length ? [...acc.slice(0, -1), acc[acc.length - 1] + ' ' + x.trim()] : [...acc, x]), []).map((x) => x.replace(/\s+/g, ' '));
  for (const row of calcBasis(r, 'zh')) assert.ok(joined.includes(`${row.item}：${row.formula} → ${row.result}`.replace(/\s+/g, ' ')), `说明栏缺:${row.item}`);
  /* 说明栏不比屏体宽太多 */
  const w = Math.max(...textBoxes(d).filter((t) => t.layer === 'LED-07-文字').map((t) => t.box.x1 - t.box.x0));
  assert.ok(w <= Math.max(5120 * 0.6, 1000), `说明栏最长一行 ${Math.round(w)} mm`);
  assert.ok(info.some((s) => s.includes('单回路 ≤ 2.5 kW')));
  assert.ok(info.some((s) => s.includes('每行一条')));
});

test('AV-019 · 线路图:文字不重叠,电源 / 网线不穿过箱体编号与尺寸(全部项目 × 两版 × 两种走法)', () => {
  let drawn = 0;
  for (const f of FIXTURES) for (const v of ['led@1.0', 'led@1.1', 'led@1.2']) for (const mode of ['row', 'snake'] as const) {
    if (v === 'led@1.0' && mode === 'snake') continue;
    const r = compute({ ...fixtureConfig(f), led_data_mode: mode }, v);
    const d = buildDrawing(r, { project: f.name });
    if (!d) continue;
    drawn++;
    const tb = textBoxes(d);
    for (let i = 0; i < tb.length; i++) for (let j = i + 1; j < tb.length; j++) {
      assert.ok(!overlap(tb[i].box, tb[j].box), `${f.name} ${v} ${mode}:「${tb[i].s}」压到「${tb[j].s}」`);
    }
    const labels = tb.filter((t) => t.layer === 'LED-08-箱体编号' || t.layer === 'LED-09-箱体尺寸');
    for (const l of d.layers.filter((x) => x.name === 'LED-04-电源回路' || x.name === 'LED-05-数据线')) for (const e of l.entities) {
      if (e.k !== 'line') continue;
      for (const t of labels) assert.ok(!segHitsBox(e.x1, e.y1, e.x2, e.y2, t.box), `${f.name} ${v} ${mode}:${l.name} 穿过「${t.s}」`);
    }
    /* 不裁切:所有文字都在画布范围内 */
    for (const t of tb) assert.ok(t.box.x0 >= d.bbox.minX - 1e-6 && t.box.x1 <= d.bbox.maxX + 1e-6 && t.box.y0 >= d.bbox.minY - 1e-6 && t.box.y1 <= d.bbox.maxY + 1e-6, `${f.name}:「${t.s}」出画布`);
  }
  assert.ok(drawn >= 15);
});

test('AV-019 · 箱体中心标尺寸、左上角标编号;混合尺寸带种类字母和图例', () => {
  const r = compute(fixtureConfig(FIXTURES[1]), 'led@1.1'); // 143:640×480 / 640×640 / 320×480 / 320×640
  const d = buildDrawing(r, { project: '143' })!;
  const size = d.layers.find((l) => l.name === 'LED-09-箱体尺寸')!.entities.filter((e) => e.k === 'text');
  const ids = d.layers.find((l) => l.name === 'LED-08-箱体编号')!.entities.filter((e) => e.k === 'text');
  assert.equal(size.length, r.layout!.cells.length);
  assert.equal(ids.length, r.layout!.cells.length);
  r.layout!.cells.forEach((c, i) => {
    const s = size[i] as { x: number; s: string };
    assert.ok(near(s.x, c.x + c.w / 2), '尺寸在箱体中心');
    assert.match(s.s, new RegExp(`^[A-Z] ${c.w}×${c.h}$`));
    assert.equal((ids[i] as { s: string }).s, `R${c.r}C${c.c}`);
  });
  const info = d.layers.find((l) => l.name === 'LED-07-文字')!.entities.map((e) => (e as { s?: string }).s ?? '');
  assert.ok(info.includes('图例'));
  for (const [i, b] of r.layout!.bom.entries()) assert.ok(info.some((s) => s.startsWith(`${String.fromCharCode(65 + i)} ${b.w} × ${b.h} × ${b.count} 只`)));
});

test('AV-019 · 图例逐类计数:BOC「A 640 × 480 × 48 只」,144 混合尺寸 28 + 7', () => {
  const legend = (r: ReturnType<typeof compute>) => buildDrawing(r, { project: 'x' })!.layers.find((l) => l.name === 'LED-07-文字')!.entities
    .map((e) => (e as { s?: string }).s ?? '').filter((s) => /^[A-Z] \d+ × \d+ × \d+ 只/.test(s));
  assert.deepEqual(legend(boc()), ['A 640 × 480 × 48 只']);
  const r144 = compute(fixtureConfig(FIXTURES[0]), 'led@1.1');
  assert.deepEqual(legend(r144), ['A 640 × 480 × 28 只', 'B 640 × 640 × 7 只']);
  const sizes = buildDrawing(r144, { project: 'x' })!.layers.find((l) => l.name === 'LED-09-箱体尺寸')!.entities.map((e) => (e as { s: string }).s);
  assert.equal(sizes.filter((s) => s === 'A 640×480').length, 28);
  assert.equal(sizes.filter((s) => s === 'B 640×640').length, 7);
});

test('AV-019 · 图层开关覆盖箱体编号 / 尺寸 / 电源 / 网线 / 标注 / 说明', () => {
  assert.deepEqual(LAYER_TOGGLES.map((t) => t.key), ['id', 'size', 'pow', 'dat', 'dim', 'info']);
  for (const t of LAYER_TOGGLES) assert.ok(t.zh && t.en && t.layers.length > 0);
});
