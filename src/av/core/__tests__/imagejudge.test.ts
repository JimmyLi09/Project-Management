/* AV-015 图片智能判读 · 确定性部分 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  arcFromRadius, arcFromRise, asks, C_GRADE_CAP, defaultPitch, emptyReview, ESTIMATE_CAP, gate, manualResult, normalise,
  ocrNumbers, parseLength, parsePitch, pitchOptions, settle, similarCases, snapOptions, toConfirm,
  type JudgeRaw, type JudgeReview, type PriceLike, type RawReading,
} from '../imagejudge.ts';

const none: RawReading = { text: '', confidence: 0, source: '', estimated: false };
const rd = (text: string, confidence = 0.9, source = 'x', estimated = false): RawReading => ({ text, confidence, source, estimated });

/* What a model would return for the 0930 arc-screen photo (hand-written 2400m m × 2000mm). */
const PHOTO: JudgeRaw = {
  image_type: 'site_photo', image_type_confidence: 0.93, environment: 'indoor', space: '接待区',
  description: '屏嵌在弧形墙的凹位里', intent_guess: 'ref', intent_reason: '屏已装好',
  shape: 'concave', shape_confidence: 0.78, shape_source: '看图判断：屏面向内弯',
  mount: 'recessed', mount_confidence: 0.72, mount_source: '四周有墙面包边',
  width: rd('2400m m', 0.8, '读自手写标注'), height: rd('2000mm', 0.86, '读自手写标注'),
  mount_height: rd('600mm', 0.6, '按门高推算', true), control_distance: none, power_distance: none,
  viewing_distance: rd('2.5m', 0.5, '按走道宽度推算', true), pitch: none, aspect_ratio: none, other_text: [],
};

const DWG: JudgeRaw = {
  ...PHOTO, image_type: 'drawing_screenshot', shape: 'flat', mount: 'wall', intent_guess: 'site',
  width: rd('5760', 0.97), height: rd('3240', 0.97), mount_height: rd('FFL+900', 0.9),
  control_distance: rd('APPROX. 12m', 0.8), viewing_distance: none, pitch: rd('LED-01 P1.86', 0.9),
};

const RENDER: JudgeRaw = {
  ...PHOTO, image_type: 'render', shape: 'flat', mount: 'unknown', intent_guess: 'ref',
  width: rd('4000', 0.3, '按画面估', true), height: rd('2250', 0.5), mount_height: none, viewing_distance: none,
  aspect_ratio: rd('16:9', 0.7, '按外框估'),
};

test('单位容错：手写「2400m m」、千分位、米、厘米、FFL 标注都换算到 mm / m', () => {
  assert.equal(parseLength('2400m m', 'mm'), 2400);
  assert.equal(parseLength('2,400', 'mm'), 2400);
  assert.equal(parseLength('2.4m', 'mm'), 2400);
  assert.equal(parseLength('2.4 米', 'mm'), 2400);
  assert.equal(parseLength('240cm', 'mm'), 2400);
  assert.equal(parseLength('FFL+900', 'mm'), 900);
  assert.equal(parseLength('APPROX. 12m', 'm'), 12);
  assert.equal(parseLength('约 12 米', 'm'), 12);
  assert.equal(parseLength('2500', 'm'), 2.5, '距离写成 mm 的裸数');
  assert.equal(parseLength('', 'mm'), null);
  assert.equal(parseLength('看不清', 'mm'), null);
  assert.equal(parsePitch('LED-01 P1.86 (BY AV)'), 1.86);
  assert.equal(parsePitch('2.5mm'), 2.5);
  assert.equal(parsePitch('型号未知'), null);
});

test('现场照片：宽 2400、高 2000、弧形；估算值带「估」且把握度 ≤ 0.4；整体 ≤ 0.75', () => {
  const r = normalise(PHOTO);
  const get = (k: string) => r.items.find((i) => i.key === k)!;
  assert.equal(r.kind, 'site_photo');
  assert.equal(get('led_opening_w').value, 2400);
  assert.equal(get('led_opening_h').value, 2000);
  assert.equal(get('shape').value, 'concave');
  assert.ok(r.items.every((i) => i.confidence <= C_GRADE_CAP));
  assert.ok(r.kindConfidence <= C_GRADE_CAP);
  assert.equal(get('led_mount_h').estimated, true);
  assert.ok(get('led_mount_h').confidence <= ESTIMATE_CAP);
  assert.ok(get('led_view_min').confidence <= ESTIMATE_CAP);
  assert.equal(get('led_ctrl_dist').value, null);

  const ids = asks(r, { ...emptyReview(), intent: 'site' }).map((a) => a.id);
  assert.ok(ids.includes('arc'), '弧长还是弦长');
  assert.ok(ids.includes('rad'), '弧半径 / 弧高');
  assert.ok(ids.includes('maint'), '前 / 后维护');
  assert.ok(ids.includes('dist'));
  /* the viewing distance was only estimated: still asked (the pitch rests on it), until answered or corrected */
  assert.ok(ids.includes('view'), '最近观看距离（估的也要问）');
  assert.ok(!asks(r, { ...emptyReview(), intent: 'site', answers: { view: '3' } }).some((a) => a.id === 'view'));
  assert.ok(!asks(r, { ...emptyReview(), intent: 'site', values: { led_view_min: 3 } }).some((a) => a.id === 'view'));
});

test('施工图截图：读出宽高与图注距离，提示要 DXF / PDF，带出图上点间距', () => {
  const r = normalise(DWG);
  const v = (k: string) => r.items.find((i) => i.key === k)?.value;
  assert.equal(v('led_opening_w'), 5760);
  assert.equal(v('led_opening_h'), 3240);
  assert.equal(v('led_mount_h'), 900);
  assert.equal(v('led_ctrl_dist'), 12);
  assert.equal(v('pitch_hint'), 1.86);
  const a = asks(r, { ...emptyReview(), intent: 'site' });
  assert.ok(a.some((x) => x.id === 'dxf' && x.zh.includes('DXF / PDF 原件')));
  assert.ok(a.some((x) => x.id === 'view'));
});

test('效果图：不出现任何编造的尺寸，只给比例，并要求补尺寸', () => {
  const r = normalise(RENDER);
  const w = r.items.find((i) => i.key === 'led_opening_w')!;
  const h = r.items.find((i) => i.key === 'led_opening_h')!;
  assert.equal(w.value, null);
  assert.ok(w.dropped, '估出来的宽丢弃');
  assert.equal(h.value, null);
  assert.ok(h.dropped, '没有单位的裸数字丢弃');
  assert.equal(r.items.find((i) => i.key === 'ratio')?.value, '16:9');
  assert.ok(asks(r, { ...emptyReview(), intent: 'ref' }).some((a) => a.id === 'size'));
  /* one side given → the other follows from the ratio and says so */
  const s = settle(r, { ...emptyReview(), intent: 'ref', answers: { size_w: '3200' } });
  assert.equal(s.height, 1800);
  assert.match(s.derived.height!, /按比例推算/);
});

test('超出合理范围的读数丢弃而不是截断', () => {
  const r = normalise({ ...DWG, width: rd('120', 0.9), height: rd('80000', 0.9) });
  assert.equal(r.items.find((i) => i.key === 'led_opening_w')!.value, null);
  assert.match(r.items.find((i) => i.key === 'led_opening_h')!.dropped!, /超出合理范围/);
});

test('模型乱答也不会崩：未知字段一律忽略', () => {
  const r = normalise({ image_type: 'selfie', width: 'abc', shape: 42 });
  assert.equal(r.kind, null);
  assert.ok(r.items.every((i) => i.value === null));
  assert.equal(normalise(null).items.length, 8, '六要素 + 形状 + 安装方式');
});

test('弦长 + 弧高 / 半径 → 弧长（确定性换算）', () => {
  const a = arcFromRise(2400, 300)!;
  assert.ok(Math.abs(a.radius - 2550) < 1e-6);
  assert.ok(Math.abs(a.arc - 2498.6) < 0.5, `${a.arc}`);
  const b = arcFromRadius(2400, 2550)!;
  assert.ok(Math.abs(b.arc - a.arc) < 1e-6);
  assert.ok(Math.abs(b.rise - 300) < 1e-6);
  assert.equal(arcFromRise(2400, 1300), null, '超过半圆');
  assert.equal(arcFromRadius(2400, 1000), null, '半径小于半弦');
});

const LIB: PriceLike[] = [
  { id: 1, category: 'hard_smd', categoryLabel: 'Hard module SMD', model: '', pitch: 'P1.25', unit: '㎡', costPrice: 2420, active: true },
  { id: 2, category: 'hard_smd', categoryLabel: 'Hard module SMD', model: '', pitch: 'P1.86', unit: '㎡', costPrice: 1500, active: true },
  { id: 3, category: 'hard_smd', categoryLabel: 'Hard module SMD', model: '', pitch: 'P2.5', unit: '㎡', costPrice: 1100, active: true },
  { id: 4, category: 'gob', categoryLabel: 'GOB Screen', model: '', pitch: 'P1.86', unit: '㎡', costPrice: 1700, active: true },
  { id: 5, category: 'hard_smd', categoryLabel: 'Hard module SMD', model: '', pitch: 'P3', unit: '㎡', costPrice: 900, active: true },
  { id: 6, category: 'hologram', categoryLabel: 'Hologram', model: '', pitch: 'P3.9', unit: '㎡', costPrice: 100, active: true },
  { id: 7, category: 'poster', categoryLabel: 'Poster', model: '', pitch: 'P2', unit: '台', costPrice: 50, active: true },
];

test('点间距候选：只出 LED-VD-01 满足的型号，默认最省；图上写明的点间距优先', () => {
  const opts = pitchOptions(LIB, 'indoor');
  assert.deepEqual(opts.map((o) => o.pitch), [1.25, 1.86, 2.5, 3], '全息 / 海报不算墙面候选');
  assert.equal(opts.find((o) => o.pitch === 1.86)!.items, 2);
  assert.equal(defaultPitch(opts, 2.5, null), 2.5, '≤ 2.5 m 里最省的是 P2.5');
  assert.equal(defaultPitch(opts, 2, null), 1.86);
  assert.equal(defaultPitch(opts, null, null), null, '没有观看距离不给默认');
  assert.equal(defaultPitch(opts, 1.5, 1.86), 1.86, '以图为准（是否满足另行告警）');
  assert.deepEqual(pitchOptions(LIB, 'outdoor'), [], '价格库里没有室外型号');
});

test('类似案例：面积 ±50%，弧形优先', () => {
  const c = (name: string, w: number, h: number, pitch: number, remarks = '') =>
    ({ name, client: null, widthMm: w, heightMm: h, sqm: (w * h) / 1e6, pitch, product: null, remarks, status: 'completed' });
  const list = [c('Flat A', 2400, 2000, 1.86), c('Curve Wall', 2560, 1920, 2.5), c('Huge', 22000, 4800, 1.86), c('Arc lobby', 2240, 2240, 1.86, '弧形')];
  const got = similarCases(list, { sqm: 4.8, pitch: 1.86, curved: true }).map((x) => x.name);
  assert.deepEqual(got, ['Arc lobby', 'Curve Wall', 'Flat A']);
});

test('模组取整：给出上下两个整数倍', () => {
  assert.deepEqual(snapOptions(2400, 320), [2240, 2560]);
  assert.deepEqual(snapOptions(1920, 160), []);
});

test('闸门：逐项确认 + 用途 + 宽高 + 弧长回答 + 点间距，缺一不可', () => {
  const r = normalise(PHOTO);
  let rv: JudgeReview = { ...emptyReview(), intent: 'site' };
  assert.equal(gate(r, rv).ok, false);
  assert.ok(gate(r, rv).pending > 0);
  rv = { ...rv, confirmed: Object.fromEntries(toConfirm(r).map((k) => [k, true])) };
  assert.ok(gate(r, rv).reasons.some((x) => x.includes('弧长还是弦长')));
  rv = { ...rv, answers: { arc: 'chord' } };
  assert.ok(gate(r, rv).reasons.some((x) => x.includes('半径或弧高')));
  rv = { ...rv, answers: { arc: 'chord', radKind: 'rise', rad: '300' } };
  assert.ok(gate(r, rv).reasons.some((x) => x.includes('点间距')));
  rv = { ...rv, pitch: 2.5 };
  assert.deepEqual(gate(r, rv), { ok: true, pending: 0, reasons: [] });
  const s = settle(r, rv);
  assert.equal(s.curve!.arc, 2499);
  assert.equal(s.tileWidth, 2499);
  /* 05 tiles whole 320 × 160 modules: 2499 and 2000 need rounding, and the gate says so */
  const mod: [number, number] = [320, 160];
  const g = gate(r, rv, null, mod);
  assert.ok(g.reasons.some((x) => x.includes('2240 或 2560')), g.reasons.join('|'));
  assert.ok(g.reasons.some((x) => x.includes('1920 或 2080')));
  rv = { ...rv, answers: { ...rv.answers, snapW: '2560', snapH: '1920' } };
  assert.equal(gate(r, rv, null, mod).ok, true);
  const snapped = settle(r, rv, null, mod);
  assert.equal(snapped.tileWidth, 2560);
  assert.equal(snapped.height, 1920);
  assert.match(snapped.derived.width!, /取整/);
  assert.equal(gate(r, { ...rv, intent: 'other' }).ok, false, '只是资料不进入方案');
  /* reference picture: sizes stay empty until someone enters our site's */
  const ref = settle(r, { ...rv, intent: 'ref' });
  assert.equal(ref.width, null);
});

test('兜底：OCR 只列出数字让人指定，手填时六项全空', () => {
  const n = ocrNumbers([{ text: '2400m m', confidence: 0.99 }, { text: 'EXIT', confidence: 0.9 }, { text: '12', confidence: 0.8 }]);
  assert.deepEqual(n.map((x) => [x.text, x.mm]), [['2400m m', 2400], ['12', null]]);
  assert.ok(n.every((x) => x.confidence <= C_GRADE_CAP));
  const m = manualResult('manual');
  assert.equal(m.items.length, 8);
  assert.ok(m.items.every((i) => i.value === null));
  assert.deepEqual(toConfirm(m), []);
});
