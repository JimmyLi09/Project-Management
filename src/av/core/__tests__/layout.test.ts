/* A1 箱体排布正确性 · A4 非整除处理 · A5 箱体库校验 (§12) */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compute } from '../compute.ts';
import { layout, solveAxis } from '../layout.ts';
import { getRulePack } from '../rulepack.ts';
import type { LedConfig, Size } from '../types.ts';

const IN = getRulePack('led@1.0').profiles.in_fixed;

const base: LedConfig = {
  led_opening_w: 4480, led_opening_h: 2560, led_screen_type: 'in_fixed', led_pitch: 2,
  led_cabinet: [640, 480], led_refresh: 3840, led_nits: 800, led_install: 'steel',
  led_maintain: 'front', led_redundancy: 'sender_1plus1', led_ctrl_brand: 'novastar',
  led_power_cable: '3*2.5',
};

test('A1 · 144-Chuan Grove 排布与 §6.3 完全一致', () => {
  const lo = layout(4480, 2560, 320, 160, IN.cabLib, [640, 480]);
  assert.ok(lo, '144-Chuan Grove 必须有解');
  assert.deepEqual(lo.widths, Array(7).fill(640), '列宽 = 640 × 7');
  assert.deepEqual(lo.heights, [480, 480, 480, 480, 640], '行高 = 480 × 4 + 640 × 1');
  assert.deepEqual(
    lo.bom.map((b) => [b.w, b.h, b.count, b.mods]),
    [[640, 480, 28, 6], [640, 640, 7, 8]],
    '箱体清单 = 640×480 × 28，640×640 × 7',
  );
  assert.equal(lo.cells.length, 35, '合计 35 只');
  assert.equal(lo.custom, false, '无定制件');
});

test('A1 · 异形箱体落在顶行与右列 (§6.2)', () => {
  const lo = layout(4480, 2560, 320, 160, IN.cabLib, [640, 480])!;
  /* heights are ordered bottom -> top, so the odd 640 row is the last one. */
  assert.equal(lo.heights[lo.heights.length - 1], 640);
  const top = lo.cells.filter((c) => c.r === lo.heights.length);
  assert.ok(top.every((c) => c.h === 640), '640 高箱体全部落在顶行');

  /* Width that needs one odd column: 4480 - 640 + 320 = 4160 = 640×6 + 320. */
  const odd = layout(4160, 2560, 320, 160, IN.cabLib, [640, 480])!;
  assert.deepEqual(odd.widths, [640, 640, 640, 640, 640, 640, 320]);
  assert.ok(odd.cells.filter((c) => c.w === 320).every((c) => c.c === odd.widths.length),
    '320 宽箱体全部落在右列');
});

test('A1 · 求解优先级：先最少非主力，再最少总数 (§6.1)', () => {
  /* 1280 with unit 160: 640×2 (2 pieces, 0 non-primary) beats 320×4. */
  assert.deepEqual(solveAxis(1280, [640, 320], 640, 160), [640, 640]);
  /* 960 with primary 640: 640 + 320 (1 non-primary) beats 320×3 (3). */
  assert.deepEqual(solveAxis(960, [640, 320], 640, 160), [640, 320]);
  /* Tie on non-primary count -> fewest pieces: 480+480 not 480+320+160. */
  assert.deepEqual(solveAxis(960, [480, 320, 160], 999, 160), [480, 480]);
});

test('A4 · 非模组整数倍时阻断，且不产出结果', () => {
  const r = compute({ ...base, led_opening_w: 4500 }, 'led@1.0');
  assert.equal(r.layout, null, '排布无解时不得给出箱体结果');
  assert.equal(r.wiring, null, '线路不得基于无效排布计算');
  const codes = r.findings.filter((f) => f.severity === 'block').map((f) => f.code);
  assert.deepEqual(codes, ['LED-FIT-01'], '宽度非整数倍 -> LED-FIT-01 阻断');
  assert.match(r.findings[0].message, /4500 mm/);

  const h = compute({ ...base, led_opening_h: 2500 }, 'led@1.0');
  assert.deepEqual(h.findings.filter((f) => f.severity === 'block').map((f) => f.code), ['LED-FIT-02']);
});

test('A5 · 箱体库中非模组整数倍的规格被忽略并告警', () => {
  const lib: Size[] = [[640, 480], [500, 480], [640, 640]];
  const r = compute({ ...base, led_cab_lib: lib }, 'led@1.0');
  const f = r.findings.find((x) => x.code === 'LED-FIT-03');
  assert.ok(f, 'LED-FIT-03 必须告警');
  assert.equal(f.severity, 'warn');
  assert.match(f.message, /500×480/);
  assert.ok(r.layout!.widths.every((w) => w !== 500), '被忽略的规格不得出现在排布中');
});

test('LED-CAB-01 · 库外组合标记为需定制', () => {
  /* 640×480 and 320×320 in the library, but the solve yields 320×480 pairs. */
  const lib: Size[] = [[640, 480], [320, 320]];
  const r = compute({ ...base, led_opening_w: 4160, led_cab_lib: lib }, 'led@1.0');
  assert.ok(r.layout!.custom, '出现库外组合');
  assert.ok(r.findings.some((f) => f.code === 'LED-CAB-01'));
  assert.ok(r.layout!.bom.some((b) => !b.inLib), '清单标出库外规格');
});
