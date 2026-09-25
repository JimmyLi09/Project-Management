/* A6 待校准拦截 · §5.1 校验规则 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compute } from '../compute.ts';
import { getRulePack } from '../rulepack.ts';
import type { LedConfig } from '../types.ts';

const base: LedConfig = {
  led_opening_w: 4480, led_opening_h: 2560, led_screen_type: 'in_fixed', led_pitch: 2,
  led_cabinet: [640, 480], led_refresh: 3840, led_nits: 800, led_install: 'steel',
  led_maintain: 'front', led_redundancy: 'sender_1plus1', led_ctrl_brand: 'novastar',
  led_power_cable: '3*2.5',
};

test('A6 · 待校准参数组禁止导出正式文件，但仍可试算', () => {
  const pack = getRulePack('led@1.0');
  for (const type of ['out_fixed', 'rental'] as const) {
    const p = pack.profiles[type];
    assert.equal(p.calibrated, false, `${p.label} 应标为待校准`);
    const r = compute({
      ...base,
      led_screen_type: type,
      led_opening_w: p.primary[0] * 4,
      led_opening_h: p.primary[1] * 3,
      led_cabinet: p.primary,
    }, 'led@1.0');
    assert.equal(r.exportable, false, `${p.label} 不得导出`);
    const f = r.findings.find((x) => x.code === 'LED-TYPE-01')!;
    assert.equal(f.severity, 'block');
    assert.equal(f.gate, 'export', '只拦导出，不拦计算');
    assert.ok(r.layout, '仍应给出排布供试算');
    assert.match(f.message, /占位值/);
  }
});

test('A6 · 已校准的室内固装可以导出', () => {
  const r = compute(base, 'led@1.0');
  assert.equal(r.exportable, true);
  assert.deepEqual(r.findings, []);
});

test('LED-VD-01 · 最近观看距离小于点间距对应距离时告警', () => {
  const near = compute({ ...base, led_pitch: 2, led_view_min: 1.5 }, 'led@1.0');
  const f = near.findings.find((x) => x.code === 'LED-VD-01')!;
  assert.equal(f.severity, 'warn');
  assert.equal(near.exportable, true, '警告不阻断导出');

  const ok = compute({ ...base, led_pitch: 2, led_view_min: 2 }, 'led@1.0');
  assert.ok(!ok.findings.some((x) => x.code === 'LED-VD-01'), '恰好等于点间距时不告警');

  const absent = compute(base, 'led@1.0');
  assert.ok(!absent.findings.some((x) => x.code === 'LED-VD-01'), '未录入时不告警');
});

test('LED-PWR-07 · 强电井距离超过 30 m 时提示加装分配电箱', () => {
  const far = compute({ ...base, led_pwr_dist: 45 }, 'led@1.0');
  const f = far.findings.find((x) => x.code === 'LED-PWR-07')!;
  assert.equal(f.severity, 'info');
  assert.match(f.message, /分配电箱/);
  assert.ok(!compute({ ...base, led_pwr_dist: 30 }, 'led@1.0').findings.some((x) => x.code === 'LED-PWR-07'));
});

test('阻断项按 §5.1 的级别区分 compute 与 export', () => {
  /* rental modules are 250×250: 4510 is not a whole multiple, 2500 is. */
  const blocked = compute({
    ...base, led_screen_type: 'rental', led_opening_w: 4510, led_opening_h: 2500, led_cabinet: [500, 500],
  }, 'led@1.0');
  assert.equal(blocked.layout, null);
  assert.equal(blocked.exportable, false);
  const gates = new Map(blocked.findings.map((f) => [f.code, f.gate]));
  assert.equal(gates.get('LED-FIT-01'), 'compute');
  assert.equal(gates.get('LED-TYPE-01'), 'export');
});
