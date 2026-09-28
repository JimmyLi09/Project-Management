/* A3 线路计算吻合度 (§7.3 / §12) */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compute } from '../compute.ts';
import { FIXTURES, fixtureConfig, wholeScreenRuns } from '../fixtures.ts';
import { getRulePack } from '../rulepack.ts';

const DATA_PX = getRulePack('led@1.0').control.dataPx;

test('§6.3 · 144-Chuan Grove 电源与数据线', () => {
  const { trace, wiring } = compute(fixtureConfig(FIXTURES[0]), 'led@1.0');
  assert.equal(trace.n_circuit.value, 3, '电源回路 3 路');
  assert.equal(trace.n_power_cable.value, 4, '报价 4 根');
  assert.deepEqual(wiring!.circuits.map((c) => c.cols.length), [3, 2, 2], '分组 3+2+2 列');
  /* rowRuns are ordered bottom -> top: four 480-high rows then the 640 row. */
  assert.deepEqual(wiring!.rowRuns, [1, 1, 1, 1, 2], '480 高行各 1 条，640 高行 2 条');
  assert.equal(trace.n_data_run.value, 6);
  assert.equal(trace.n_data_cable.value, 7, '含 1 备用');
});

test('§7.1 · 各回路功耗尽量均衡，分组连续且覆盖全部列', () => {
  for (const f of FIXTURES) {
    const { wiring, layout } = compute(fixtureConfig(f), 'led@1.0');
    if (!wiring || !layout) continue;
    const cols = wiring.circuits.flatMap((c) => c.cols);
    assert.deepEqual(cols, layout.widths.map((_, i) => i), `${f.name} 分组必须连续且无遗漏`);
    const kws = wiring.circuits.map((c) => c.kw);
    const spread = Math.max(...kws) - Math.min(...kws);
    const colMax = Math.max(...wiring.colKw);
    assert.ok(spread <= colMax + 1e-9, `${f.name} 组间功耗差不应超过单列功耗`);
  }
});

test('A3 · 电源线复现 §7.3：8 个可比项目中 5 个与表内一致', () => {
  const rows = FIXTURES.filter((f) => f.id !== '021').map((f) => {
    const { trace } = compute(fixtureConfig(f), 'led@1.0');
    return { f, got: trace.n_power_cable.value };
  });
  assert.equal(rows.length, 8);
  for (const { f, got } of rows) {
    assert.equal(got, f.doc.powerCable, `${f.name} 应复现 §7.3 的算出值`);
  }
  const agree = rows.filter(({ f, got }) => got === f.recorded.powerCable);
  assert.equal(agree.length, 5, '§12 A3：电源线 5/8 一致');
  assert.deepEqual(agree.map(({ f }) => f.id).sort(), ['131', '132', '143', '144', '148']);
});

test('数据线 · 逐行口径为准 (F8 / §7.2)，与 §7.3 的整屏口径并列留证', () => {
  const rows = FIXTURES.map((f) => {
    const r = compute(fixtureConfig(f), 'led@1.0');
    return {
      f,
      perRow: r.trace.n_data_run ? r.trace.n_data_run.value : null,
      whole: wholeScreenRuns(r.trace.px.value, DATA_PX),
    };
  });

  /* The spec's "算出" column was produced with the whole-screen reading. It
     reproduces exactly except for the two rows flagged in fixtures.ts, where the
     printed figure matches neither reading. */
  for (const { f, whole } of rows) {
    if (f.docDataInconsistent) {
      assert.notEqual(whole, f.doc.dataCable, `${f.name} 已知 §7.3 印刷值与两种口径均不符`);
    } else {
      assert.equal(whole, f.doc.dataCable, `${f.name} 整屏口径应复现 §7.3 的算出值`);
    }
  }

  /* Where the layout solves, the per-row reading is never below the whole-screen
     one — a cable cannot span rows, so rounding happens once per row. */
  for (const { f, perRow, whole } of rows) {
    if (perRow === null) continue;
    assert.ok(perRow >= whole, `${f.name} 逐行条数不应少于整屏条数`);
  }

  /* 146-OLR is where the two readings visibly part: §7.3 prints 39. */
  const olr = rows.find((r) => r.f.id === '146')!;
  assert.equal(olr.whole, 39);
  assert.equal(olr.perRow, 40);
});

test('每行至少 1 条数据线 (§7.2)', () => {
  const cfg = { ...fixtureConfig(FIXTURES[0]), led_pitch: 10 };
  const { wiring } = compute(cfg, 'led@1.0');
  assert.ok(wiring!.rowRuns.every((n) => n >= 1));
});

test('回路数多于列数时给出提示而非错误分组', () => {
  const cfg = { ...fixtureConfig(FIXTURES[0]), led_opening_w: 640, led_opening_h: 12800 };
  const r = compute(cfg, 'led@1.0');
  assert.ok(r.wiring!.circuitsExceedColumns);
  assert.equal(r.wiring!.circuits.length, 1, '分组不得多于列数');
  assert.equal(r.trace.n_circuit.value, r.wiring!.nCircuit, '回路数仍按 F6 报价');
  assert.ok(r.findings.some((f) => f.code === 'LED-PWR-08'));
});
