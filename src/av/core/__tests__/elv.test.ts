/* 弱电草案规则包 elv@0.1-draft · 计算、校验、系统图、成本 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildElvLines, checkSheet, elvChecks, totals, type ElvSummary, type PriceItem, type SavedConfig } from '../pricing.ts';
import { computeElv, type ElvConfig } from '../elv/compute.ts';
import { buildElvDrawing } from '../elv/drawing.ts';
import { getElvPack, LATEST_ELV_PACK, registerElvPack } from '../elv/rulepack.ts';
import { toSvg } from '../svg.ts';

const base: ElvConfig = {
  elv_area: 1000, elv_floors: 1, elv_entrances: 2, elv_ceiling_h: 3, elv_avg_run: 40, elv_space: 'office',
  elv_cctv: true, elv_access: true, elv_net: true, elv_pa: true,
};
const V = (r: ReturnType<typeof computeElv>, k: string) => r.trace[k].value;

test('1000 ㎡ 办公全系统（手算核对）', () => {
  const r = computeElv(base, LATEST_ELV_PACK);
  /* 0.2 点/㎡ → 200；AP 1000÷150 → 7；摄像机 1000÷150 → 7 + 每出入口 1 → 9 */
  assert.deepEqual(['n_outlet', 'n_ap', 'n_cam', 'n_door', 'n_port'].map((k) => V(r, k)), [200, 7, 9, 2, 216]);
  /* 216 × 1.2 ÷ 48 = 5.4 → 6 台；216 × 1.2 ÷ 24 = 10.8 → 11 个 */
  assert.equal(V(r, 'n_switch'), 6);
  assert.equal(V(r, 'n_patch'), 11);
  /* PoE：7 × 30 + 9 × 15.4 */
  assert.ok(Math.abs(V(r, 'poe_w') - 348.6) < 1e-9);
  /* 216 × 40 m × 1.1 = 9,504 m → 32 箱 */
  assert.ok(Math.abs(V(r, 'cable_m') - 9504) < 1e-9);
  assert.equal(V(r, 'n_box'), 32);
  /* 间距 2 × (3 − 1.2) = 3.6 m → 1000 ÷ 12.96 → 78 只；功放 78 × 6 W × 1.25 */
  assert.ok(Math.abs(V(r, 'spk_spacing') - 3.6) < 1e-9);
  assert.equal(V(r, 'n_spk'), 78);
  assert.equal(V(r, 'amp_w'), 585);
  /* 9 台 × 4 Mbps × 30 天 = 11.664 TB */
  assert.ok(Math.abs(V(r, 'nvr_tb') - 11.664) < 1e-9);
  assert.equal(V(r, 'n_nvr'), 1);
  assert.equal(V(r, 'n_rack'), 2);
  assert.ok(Object.values(r.trace).every((n) => n.prov.source && n.prov.method && n.prov.confidence !== undefined));
});

test('子系统开关：只勾广播时没有网络与安防数量', () => {
  const r = computeElv({ ...base, elv_cctv: false, elv_access: false, elv_net: false }, LATEST_ELV_PACK);
  assert.deepEqual(['n_outlet', 'n_ap', 'n_cam', 'n_door', 'n_port', 'n_switch'].map((k) => V(r, k)), [0, 0, 0, 0, 0, 0]);
  assert.equal(V(r, 'n_spk'), 78);
  const net = computeElv({ ...base, elv_pa: false, elv_ceiling_h: 0 }, LATEST_ELV_PACK);
  assert.equal(net.ok, true, '不做广播时吊顶高度不必填');
  assert.equal(V(net, 'n_spk'), 0);
  assert.match(net.trace.spk_spacing.prov.note!, /未启用广播/);
});

test('空间类型改变密度：展厅点位少、摄像机密', () => {
  const r = computeElv({ ...base, elv_space: 'showroom' }, LATEST_ELV_PACK);
  assert.equal(V(r, 'n_outlet'), 50);
  assert.equal(V(r, 'n_cam'), 10 + 2);
});

test('校验：必填、至少一个子系统、线长、吊顶、存储；草案拦导出', () => {
  const codes = (c: Partial<ElvConfig>) => computeElv({ ...base, ...c }, LATEST_ELV_PACK).findings.map((f) => f.code);
  assert.ok(codes({ elv_area: 0 }).includes('ELV-FIT-01'));
  assert.ok(codes({ elv_ceiling_h: 1 }).includes('ELV-FIT-01'), '吊顶低于耳高');
  assert.ok(codes({ elv_cctv: false, elv_access: false, elv_net: false, elv_pa: false }).includes('ELV-SUB-01'));
  assert.ok(codes({ elv_avg_run: 95 }).includes('ELV-NET-01'), 'TIA-568 90 m');
  assert.ok(codes({ elv_ceiling_h: 8 }).includes('ELV-PA-01'));
  assert.ok(codes({ elv_area: 20000, elv_space: 'retail' }).includes('ELV-NVR-01'));
  const r = computeElv(base, LATEST_ELV_PACK);
  assert.equal(r.ok, true);
  assert.equal(r.exportable, false);
  assert.equal(r.findings.find((f) => f.code === 'ELV-TYPE-01')!.gate, 'export');
  assert.equal(buildElvDrawing(computeElv({ ...base, elv_area: 0 }, LATEST_ELV_PACK), { project: 'x' }), null);
});

test('版本锁定', () => {
  const v = getElvPack(LATEST_ELV_PACK);
  registerElvPack({ ...v, version: 'elv@0.2-test', eng: { ...v.eng, spare: 0.5 } });
  assert.equal(V(computeElv(base, LATEST_ELV_PACK), 'n_switch'), 6);
  assert.equal(V(computeElv(base, 'elv@0.2-test'), 'n_switch'), 7);
});

test('系统图：只画启用的子系统，草图标记', () => {
  const d = buildElvDrawing(computeElv({ ...base, elv_access: false }, LATEST_ELV_PACK), { project: '测试' })!;
  assert.deepEqual(d.layers.map((l) => l.name), ['ELV-01-机房', 'ELV-02-网络', 'ELV-03-安防', 'ELV-04-广播', 'ELV-07-文字']);
  const text = d.layers.flatMap((l) => l.entities).filter((e) => e.k === 'text').map((e) => (e as { s: string }).s).join('\n');
  assert.match(text, /数据点位 × 200/);
  assert.match(text, /网络摄像机 × 9/);
  assert.doesNotMatch(text, /门禁点/);
  assert.match(text, /草案，不得用于正式报价/);
  assert.ok(toSvg(d).includes('<g id="ELV-04-广播"'));
});

test('弱电成本：数量来自 E1–E13，零数量行不出现；功放功率不足阻断', () => {
  const r = computeElv({ ...base, elv_access: false }, LATEST_ELV_PACK);
  const t = r.trace;
  const cfg: SavedConfig<ElvSummary> = {
    id: 1, projectId: 'p', line: 'elv', packVersion: LATEST_ELV_PACK, drawingId: null, createdBy: 'PM', createdAt: 0,
    summary: { area: 1000, floors: 1, space: 'office', subsystems: ['cctv', 'net', 'pa'], nOutlet: t.n_outlet.value, nAp: t.n_ap.value,
      nCam: t.n_cam.value, nDoor: t.n_door.value, nPort: t.n_port.value, nSwitch: t.n_switch.value, poeW: t.poe_w.value, nBox: t.n_box.value,
      nPatch: t.n_patch.value, nSpk: t.n_spk.value, ampW: t.amp_w.value, nPaZone: t.n_pa_zone.value, nvrTb: t.nvr_tb.value, nNvr: t.n_nvr.value,
      nRack: t.n_rack.value, exportable: r.exportable, blocking: ['ELV-TYPE-01'] },
  };
  const it = (id: number, spec: string, unit: string, cost: number): PriceItem => ({
    id, line: 'elv', category: 'x', categoryLabel: '弱电', model: `m${id}`, pitch: spec, moduleSize: '', cabinetSize: '', unit,
    costPrice: cost, listPrice: cost * 1.3, currency: 'SGD', source: '', validUntil: '', active: true, updatedBy: '', updatedAt: 0,
  });
  const items = [it(1, '', '个', 25), it(2, '', '台', 400), it(3, '', '台', 250), it(4, '', '台', 1800), it(5, '', '个', 120),
    it(6, '', '箱', 180), it(7, '', '只', 45), it(8, '360 W', '台', 900), it(9, '720 W', '台', 1400), it(10, '', '台', 1500), it(11, '', 'TB', 40), it(12, '', '台', 800)];
  const picks = { outlet: 1, ap: 2, cam: 3, switch: 4, patch: 5, cable: 6, spk: 7, amp: 8, nvr: 10, hdd: 11, rack: 12 };
  let lines = buildElvLines(cfg, picks, [], items);
  assert.ok(!lines.some((l) => l.key === 'door'), '未启用门禁不出现门禁行');
  assert.deepEqual(lines.map((l) => [l.key, l.qty]), [['outlet', 200], ['ap', 7], ['cam', 9], ['switch', 6], ['patch', 11], ['cable', 32],
    ['spk', 78], ['amp', 1], ['nvr', 1], ['hdd', 12], ['rack', 2]]);
  assert.ok(elvChecks(lines, cfg, items).some((c) => c.severity === 'block'), '360 W < 585 W');
  lines = buildElvLines(cfg, { ...picks, amp: 9 }, [], items);
  assert.deepEqual(elvChecks(lines, cfg, items), []);
  assert.equal(totals(lines).cost, 200 * 25 + 7 * 400 + 9 * 250 + 6 * 1800 + 11 * 120 + 32 * 180 + 78 * 45 + 1400 + 1500 + 12 * 40 + 2 * 800);
  assert.ok(checkSheet(lines, cfg, items, 0.18, '2026-09-25').some((c) => c.code === 'COST-CFG' && /ELV-TYPE-01/.test(c.message)));
});
