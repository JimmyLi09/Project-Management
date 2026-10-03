/* AV-019 §2.3 · 网线走法 + 人工调整电源回路 / 网线(led@1.1) */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calcBasis } from '../calc.ts';
import { compute } from '../compute.ts';
import { buildDrawing } from '../drawing.ts';
import { FIXTURES, fixtureConfig } from '../fixtures.ts';
import { appendToRun, assignCircuit, beginEdit, circuitNumbers, clearRun, manualLabel, setPort, snapshot } from '../override.ts';
import { proposalDoc } from '../proposal.ts';
import type { LedConfig, WiringOverride } from '../types.ts';

const BASE: LedConfig = fixtureConfig(FIXTURES.find((f) => f.id === '148')!);
const AT = new Date(2026, 9, 2, 14, 30).getTime();
const run = (cfg: Partial<LedConfig> = {}) => compute({ ...BASE, ...cfg }, 'led@1.1');
const withOv = (ov: WiringOverride, cfg: Partial<LedConfig> = {}) => run({ ...cfg, led_wiring_override: ov });
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const info = (r: ReturnType<typeof run>) => buildDrawing(r, { project: 'BOC' })!.layers.find((l) => l.name === 'LED-07-文字')!.entities
  .map((e) => (e as { s?: string }).s ?? '').join('\n').replace(/\n {2}/g, '');

test('§2.2 · 05 选网线走法:每行一条 6 + 1,蛇形按带载 5 + 1,06 的根数跟着变', () => {
  const row = run(), snake = run({ led_data_mode: 'snake' });
  assert.equal(row.trace.n_data_cable.value, 7);
  assert.equal(snake.trace.n_data_cable.value, 6);
  assert.equal(snake.wiring!.dataMode, 'snake');
  assert.match(calcBasis(snake).find((x) => x.key === 'data')!.result, /5 条 \+ 1 备用/);
});

test('§2.3 · 把 2 只箱体从回路 1 改到回路 3:实时功率变化,超限标红,只能存草稿', () => {
  const auto = run();
  const ov0 = beginEdit(auto, undefined, 'power', '张三', AT)!;
  assert.equal(ov0.power, false, '还没改的时候不算人工调整');
  /* 回路 1 链尾的两只:R3C3、R4C3 */
  const ov = assignCircuit(ov0, ['R3C3', 'R4C3'], 3, '张三', AT);
  const r = withOv(ov);
  const w = r.wiring!;
  assert.deepEqual(w.power.map((p) => p.cells.length), [14, 16, 18]);
  assert.ok(near(w.power[0].w, 2150.4) && near(w.power[2].w, 2764.8));
  assert.deepEqual(r.manual, { by: '张三', at: AT, power: true, data: false });
  assert.ok(r.manualBlock, '超限 → 不能存正式版本');
  assert.match(r.manualBlock!.zh, /只能存草稿：回路 3 超过 2\.5 kW/);
  assert.match(r.manualBlock!.en, /circuit 3 over 2\.5 kW/);
  assert.ok(r.findings.some((f) => f.code === 'LED-PWR-09'));
  const load = calcBasis(r).find((x) => x.key === 'load')!;
  assert.equal(load.ok, false);
  assert.equal(load.source, `人工调整 · ${manualLabel({ by: '张三', at: AT })}`);
  assert.match(info(r), /人工调整 · 张三 · 2026-10-02 14:30/);
});

test('§2.3 · 合规的人工调整:回路 4 → 存正式版本,下游(06 根数、计算依据、DXF、方案书)按人工结果', () => {
  const ov = assignCircuit(beginEdit(run(), undefined, 'power', '张三', AT)!, ['R3C3', 'R4C3'], 4, '张三', AT);
  const r = withOv(ov);
  assert.equal(r.manualBlock, null);
  assert.equal(r.trace.n_circuit.value, 4);
  assert.equal(r.trace.n_power_cable.value, 5, '06 电源线 4 + 1');
  const c = calcBasis(r).find((x) => x.key === 'circuits')!;
  assert.equal(c.formula, '人工划分 4 路（逐路校核）');
  assert.equal(c.result, '4 路 + 1 备用');
  assert.match(c.source, /^人工调整 · 张三/);
  /* 网线没改,来源照旧 */
  assert.doesNotMatch(calcBasis(r).find((x) => x.key === 'data')!.source, /人工/);
  assert.match(info(r), /电源 4 回路 \+ 1 备用/);
  const zh = proposalDoc(r, { title: 'BOC', lang: 'zh', date: '2026-10-02' })!;
  const en = proposalDoc(r, { title: 'BOC', lang: 'en', date: '2026-10-02' })!;
  assert.ok(zh.sections.some((s) => s.notes?.some((n) => /电源回路为人工调整（张三 · 2026-10-02 14:30），已逐路校核/.test(n))));
  assert.ok(en.sections.some((s) => s.notes?.some((n) => /power circuits were adjusted by hand/.test(n))));
  const enText = en.sections.flatMap((s) => [...(s.notes ?? []), ...(s.table?.rows.flat() ?? [])]).join('\n').replace(/张三/g, '');
  assert.doesNotMatch(enText, /[一-鿿]/);
});

test('§2.3 · 回路号保持连续:一路被划空就去掉,后面的往前补', () => {
  const ov0 = beginEdit(run(), undefined, 'power', '张三', AT)!;
  const c2 = ov0.cells.filter((c) => c.circuit === 2).map((c) => c.id);
  const ov = assignCircuit(ov0, c2, 1, '张三', AT);
  assert.deepEqual(circuitNumbers(ov), [1, 2]);
  const r = withOv(ov);
  assert.equal(r.wiring!.nCircuit, 2);
  assert.match(r.manualBlock!.zh, /回路 1 超过/);
});

test('§2.3 · 调整网线:按顺序点箱体定义先后,可改网口;没接完不能存正式版本', () => {
  const auto = run();
  let ov = beginEdit(auto, undefined, 'data', '李四', AT)!;
  ov = clearRun(ov, 1, '李四', AT);
  let r = withOv(ov);
  assert.equal(r.wiring!.unassigned.data.length, 8, '第 1 条清空 → 8 只没接');
  assert.match(r.manualBlock!.zh, /R6C1、R6C2.* 等 8 只没接网线/);
  /* 最上一行从右往左点 */
  for (let c = 8; c >= 1; c--) ov = appendToRun(ov, `R6C${c}`, 1, '李四', AT);
  ov = setPort(ov, 1, 3, '李四', AT);
  ov = setPort(ov, 3, 1, '李四', AT);   // 3 号网线改接网口 1,和 1 号对调
  r = withOv(ov);
  assert.equal(r.manualBlock, null);
  const cells = r.layout!.cells;
  assert.deepEqual(r.wiring!.runs[0].cells.map((i) => `R${cells[i].r}C${cells[i].c}`), ['R6C8', 'R6C7', 'R6C6', 'R6C5', 'R6C4', 'R6C3', 'R6C2', 'R6C1']);
  assert.equal(r.wiring!.ports[0], 3);
  const data = buildDrawing(r, { project: 'x' })!.layers.find((l) => l.name === 'LED-05-数据线')!;
  assert.ok(data.entities.some((e) => e.k === 'text' && e.s === '3'), '图上起点圈写网口 3');
  assert.match(calcBasis(r).find((x) => x.key === 'data')!.formula, /人工串接 6 条/);
  /* 两条网线接同一个网口不行 */
  const dupe = withOv(setPort(ov, 2, 3, '李四', AT));
  assert.match(dupe.manualBlock!.zh, /网口 3 接了不止一条网线/);
  /* 把第 2 条的一只拉到第 1 条:从第 2 条摘下来 */
  ov = appendToRun(ov, 'R5C1', 1, '李四', AT);
  r = withOv(ov);
  assert.equal(r.wiring!.runs[0].cells.length, 9);
  assert.equal(r.wiring!.runs[1].cells.length, 7);
  assert.equal(r.manualBlock, null, '9 × 49,152 = 442,368 ≤ 560,000');
});

test('§2.3 · 网线一条串太多:超 560,000 px 标红、只能存草稿', () => {
  let ov = beginEdit(run(), undefined, 'data', '李四', AT)!;
  for (const c of [1, 2, 3, 4]) ov = appendToRun(ov, `R5C${c}`, 1, '李四', AT);   // 8 + 4 = 12 只
  const r = withOv(ov);
  assert.equal(r.wiring!.runs[0].px, 12 * 49152);
  assert.match(r.manualBlock!.zh, /网线 1 超过 560,000 px/);
  assert.equal(calcBasis(r).find((x) => x.key === 'data')!.ok, false);
});

test('§2.3 · 输入变了对不上:人工调整失效、回到自动结果并提示', () => {
  const ov = assignCircuit(beginEdit(run(), undefined, 'power', '张三', AT)!, ['R3C3', 'R4C3'], 4, '张三', AT);
  const r = withOv(ov, { led_opening_w: 4480 });
  assert.equal(r.manual, null);
  assert.deepEqual(r.manualStale, { by: '张三', at: AT });
  assert.ok(r.findings.some((f) => f.code === 'LED-MAN-01'));
  const auto = run({ led_opening_w: 4480 });
  assert.deepEqual(r.wiring!.power.map((p) => p.cells), auto.wiring!.power.map((p) => p.cells), '数字 = 自动结果');
  assert.equal(r.manualBlock, null);
  /* 功耗参数变了但排布没变:调整照旧有效,只是重新校核 */
  const same = withOv(ov, { led_pitch: 2.5 });
  assert.ok(same.manual);
});

test('§2.3 · 开始调整另一半时,用当前自动结果刷新它;快照不算人工调整', () => {
  const auto = run({ led_data_mode: 'snake' });
  const snap = snapshot(auto, '王五', AT)!;
  assert.equal(snap.power || snap.data, false);
  const r = withOv(snap, { led_data_mode: 'snake' });
  assert.equal(r.manual, null, '没改过就不标人工');
  assert.equal(r.manualStale, null);
  let ov = assignCircuit(beginEdit(auto, undefined, 'power', '王五', AT)!, ['R1C1'], 2, '王五', AT);
  ov = beginEdit(auto, ov, 'data', '王五', AT)!;
  assert.equal(ov.power, true, '电源那一半还在');
  assert.deepEqual(ov.cells.find((c) => c.id === 'R6C1')!.run, 1);
});

test('led@1.0 不支持人工调整:有这个字段也照旧按整列分组', () => {
  const ov = assignCircuit(beginEdit(run(), undefined, 'power', '张三', AT)!, ['R3C3'], 4, '张三', AT);
  const r = compute({ ...BASE, led_wiring_override: ov }, 'led@1.0');
  assert.equal(r.manual, null);
  assert.equal(r.manualStale, null);
  assert.equal(r.wiring!.nCircuit, 3);
});
