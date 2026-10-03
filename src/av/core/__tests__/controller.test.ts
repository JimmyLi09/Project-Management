/* AV-019 §2.5 / §2.6 · F11 控制器与信号源选型 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { advise, checksOf, NOVASTAR_SEED, type CtrlDevice } from '../controller.ts';

const LIB: CtrlDevice[] = NOVASTAR_SEED.map(({ note: _n, ...d }) => ({ ...d, price: null }));
/* BOC:2048 × 1152 = 2,359,296 px;每行一条 6 条网线 / 蛇形 5 条 */
const BOC = { px: 2048 * 1152, pxW: 2048, pxH: 1152, runs: 6 };
const model = (a: ReturnType<typeof advise>) => a.primary?.device.model;

test('§2.5 · BOC 会议 / 演示 · 客户自备 → VX600,不报电脑', () => {
  const a = advise(LIB, BOC, { use: 'meeting', pc: 'client' });
  assert.equal(model(a), 'VX600');
  assert.equal(a.needPc, false);
  assert.equal(a.needMedia, false);
  assert.equal(a.pending, false);
  assert.deepEqual(a.primary!.checks.map((c) => c.ok), [true, true, true]);
  assert.match(a.primary!.checks[0].zh, /网口 6 ≥ 网线 6 条/);
  assert.match(a.primary!.checks[1].zh, /总带载 390 万 ≥ 236 万像素/);
  /* VX400 只有 4 个网口,不在候选里 */
  assert.ok(!a.alternates.some((x) => x.device.model === 'VX400'));
  assert.deepEqual(a.alternates.map((x) => x.device.model), ['VX1000', 'MX40 Pro']);
});

test('§2.5 · 蛇形 5 条网线结论不变;会议 + 我们报电脑 → 加一台播控电脑', () => {
  assert.equal(model(advise(LIB, { ...BOC, runs: 5 }, { use: 'meeting', pc: 'client' })), 'VX600');
  const a = advise(LIB, BOC, { use: 'meeting', pc: 'us' });
  assert.equal(a.needPc, true);
  assert.equal(a.pc?.model, '播控电脑');
  assert.match(a.signal.zh, /报一台播控电脑/);
});

test('§2.6 · 广告轮播:TB60 的 230 万不够 → VX600 + 媒体播放器', () => {
  const a = advise(LIB, BOC, { use: 'ads' });
  assert.equal(model(a), 'VX600');
  assert.equal(a.needMedia, true);
  assert.equal(a.media?.model, '媒体播放器（HDMI 输出）');
  assert.equal(a.needPc, false);
  assert.ok(a.reason.some((r) => /TB60 只有 230 万带载/.test(r.zh)));
});

test('§2.6 · 屏改小到 ≤ 230 万像素且 ≤ 4 条网线 → 广告轮播建议 TB60', () => {
  const small = { px: 1920 * 1152, pxW: 1920, pxH: 1152, runs: 4 };   // 221 万
  const a = advise(LIB, small, { use: 'ads' });
  assert.equal(model(a), 'TB60');
  assert.equal(a.needMedia, false);
  /* 再小一点(≤ 130 万、2 条)→ 带载最小的 TB40 */
  assert.equal(model(advise(LIB, { px: 1_200_000, pxW: 1500, pxH: 800, runs: 2 }, { use: 'ads' })), 'TB40');
  /* 宽超过 4096 的播放盒就不行 */
  assert.equal(advise(LIB, { px: 1_000_000, pxW: 5000, pxH: 200, runs: 2 }, { use: 'ads' }).needMedia, true);
});

test('§2.6 · 两者都有:播放盒要带 HDMI 输入;直播要 SDI;还不确定按会议并标待确认', () => {
  const small = { px: 600_000, pxW: 1000, pxH: 600, runs: 1 };
  assert.equal(model(advise(LIB, small, { use: 'ads' })), 'TB30', '只轮播:TB30 就够');
  assert.equal(model(advise(LIB, small, { use: 'both' })), 'TB40', '两者都有:TB30 没 HDMI 输入,换 TB40');
  const live = advise(LIB, BOC, { use: 'live' });
  assert.equal(model(live), 'VX600');
  assert.ok(live.primary!.device.inputs.some((x) => /SDI/.test(x)));
  const unsure = advise(LIB, BOC, { use: 'unsure' });
  assert.equal(unsure.use, 'meeting');
  assert.equal(unsure.pending, true);
  assert.equal(model(unsure), 'VX600');
  assert.equal(advise(LIB, BOC, {}).pending, true, '01 没答也算待确认');
});

test('§2.5 · 价格最低优先;改了带载或价格,选型跟着变', () => {
  const priced = LIB.map((d) => (d.model === 'VX1000' ? { ...d, price: 3000 } : d.model === 'VX600' ? { ...d, price: 3500 } : d));
  assert.equal(model(advise(priced, BOC, { use: 'meeting' })), 'VX1000', '有价格的里面选最便宜');
  const weak = LIB.map((d) => (d.model === 'VX600' ? { ...d, loadPx: 2_000_000 } : d));
  assert.equal(model(advise(weak, BOC, { use: 'meeting' })), 'VX1000', 'VX600 带载改小后不满足');
});

test('§2.5 · 超出单台能力:提示多台拼接或大型控制器', () => {
  const huge = { px: 12_000_000, pxW: 6000, pxH: 2000, runs: 24 };
  const a = advise(LIB, huge, { use: 'meeting' });
  assert.equal(a.primary, null);
  assert.match(a.fail!.zh, /超出单台能力，需多台拼接或大型控制器/);
  assert.match(a.fail!.en, /Beyond a single unit/);
});

test('§2.5 · 05 人工改选型号:标人工选择,不满足的条件标 ✕', () => {
  const a = advise(LIB, BOC, { use: 'meeting' }, 'VX400');
  assert.equal(model(a), 'VX400');
  assert.equal(a.manual, true);
  assert.equal(a.primary!.checks[0].ok, false);
  assert.match(a.primary!.checks[0].zh, /网口 4 < 网线 6 条/);
  assert.ok(a.reason.some((r) => /人工选择 VX400（不满足/.test(r.zh)));
  /* 设备库里没有的型号就不算 */
  assert.equal(advise(LIB, BOC, { use: 'meeting' }, 'XYZ').manual, false);
});

test('checksOf · 宽 / 高任一超出都不满足', () => {
  const vx = LIB.find((d) => d.model === 'VX600')!;
  assert.equal(checksOf(vx, { px: 1e6, pxW: 9000, pxH: 9000, runs: 1 })[2].ok, false);
});

/* ── 下游:技术方案「控制与信号源」、06 设备行 ── */
import { compute } from '../compute.ts';
import { FIXTURES, fixtureConfig } from '../fixtures.ts';
import { buildLedLines, checkSheet, ledChecks, type LedSummary, type PriceItem, type SavedConfig } from '../pricing.ts';
import { proposalDoc } from '../proposal.ts';

const r148 = compute(fixtureConfig(FIXTURES.find((f) => f.id === '148')!), 'led@1.1');

test('§2.6 · 技术方案新增「控制与信号源」,中英两套', () => {
  const ads = advise(LIB, BOC, { use: 'ads' });
  const zh = proposalDoc(r148, { title: 'BOC', lang: 'zh', date: '2026-10-03', ctrl: ads })!;
  const en = proposalDoc(r148, { title: 'BOC', lang: 'en', date: '2026-10-03', ctrl: ads })!;
  const s = zh.sections[4];
  assert.equal(s.heading, '五、控制与信号源');
  const rows = Object.fromEntries(s.table!.rows.map((r) => [r[0], r[1]]));
  assert.equal(rows['控制器 / 播放盒'], 'VX600（视频控制器（一体机））');
  assert.equal(rows['媒体播放器'], '1 台（HDMI 输出，接控制器）');
  assert.match(rows['满足条件'], /✓ 网口 6 ≥ 网线 6 条/);
  assert.ok(s.paragraphs!.some((p) => /播放盒能力不够/.test(p)));
  assert.equal(en.sections[4].heading, '5. Control and Signal Source');
  const enText = en.sections[4].table!.rows.flat().concat(en.sections[4].paragraphs!).join('\n');
  assert.doesNotMatch(enText, /[一-鿿]/);
  /* 设备库空着也有这一节 */
  assert.match(proposalDoc(r148, { title: 'x', lang: 'zh', date: '2026-10-03', ctrl: null })!.sections[4].paragraphs![0], /设备库里还没有控制系统型号/);
});

test('§2.6 · 06 设备行:控制器 + 媒体播放器 + 播控电脑,没价格标待报价、不阻断确认成本', () => {
  const item = (id: number, model: string, cost: number | null): PriceItem => ({
    id, line: 'led', category: 'control', categoryLabel: '控制系统', model, pitch: '', moduleSize: '', cabinetSize: '', unit: '台',
    costPrice: cost, listPrice: cost === null ? null : cost * 1.3, currency: 'SGD', source: '', validUntil: '', active: true, updatedBy: '', updatedAt: 0,
  });
  const display: PriceItem = { ...item(1, 'P2.5', 900), category: 'smd', categoryLabel: 'LED', pitch: 'P2.5', unit: '㎡' };
  const cable: PriceItem = { ...item(2, '线', 10), category: 'cable', categoryLabel: '线材', unit: '根' };
  const items = [display, cable, item(10, 'VX600', null), item(11, '媒体播放器（HDMI 输出）', null), item(12, '播控电脑', 1500)];
  const cfg = { summary: {
    sqm: 14.75, pitch: 2.5, screenType: 'in_fixed', mods: 288, cabinets: 48, nPowerCable: 4, nDataCable: 7, powerCableSpec: '3*2.5', exportable: true, blocking: [],
    ctrl: { model: 'VX600', kind: 'video', itemId: 10, needMedia: true, mediaItemId: 11, needPc: true, pcItemId: 12, pending: false, manual: false, use: 'both' },
  } } as unknown as SavedConfig<LedSummary>;
  const lines = buildLedLines(cfg, { display: 1, power_cable: 2, data_cable: 2 }, [], items);
  const ctrl = lines.filter((l) => ['controller', 'media_player', 'playback_pc'].includes(l.key));
  assert.deepEqual(ctrl.map((l) => [l.name, l.qty, l.unit, l.itemId]), [
    ['视频控制器 VX600', 1, '台', 10], ['媒体播放器（HDMI 输出）', 1, '台', 11], ['播控电脑', 1, '台', 12],
  ]);
  const checks = checkSheet(lines, cfg, items, 0.2, '2026-10-03', ledChecks(lines, cfg, items));
  assert.ok(!checks.some((c) => c.severity === 'block'), JSON.stringify(checks.filter((c) => c.severity === 'block')));
  assert.equal(checks.filter((c) => c.code === 'COST-CTRL-QUOTE').length, 2, 'VX600、媒体播放器待报价');
  assert.match(checks.find((c) => c.code === 'COST-CTRL-QUOTE')!.message, /「视频控制器 VX600」待报价.*不影响确认成本/);
  /* 06 里改选别的条目 / 清空 */
  const none = buildLedLines(cfg, { display: 1, power_cable: 2, data_cable: 2, controller: null }, [], items);
  assert.equal(none.find((l) => l.key === 'controller')!.itemId, null);
  assert.ok(!checkSheet(none, cfg, items, 0.2, '2026-10-03', ledChecks(none, cfg, items)).some((c) => c.severity === 'block'));
  /* 01 没定 → 待确认提示;旧方案没有 ctrl → 没有设备行 */
  const pend = { summary: { ...cfg.summary, ctrl: { ...cfg.summary.ctrl!, pending: true } } } as SavedConfig<LedSummary>;
  assert.ok(ledChecks(lines, pend, items).some((c) => c.code === 'LED-COST-CTRL' && /待确认/.test(c.message)));
  const old = { summary: { ...cfg.summary, ctrl: undefined } } as SavedConfig<LedSummary>;
  assert.equal(buildLedLines(old, { display: 1, power_cable: 2, data_cable: 2 }, [], items).length, 3);
});
