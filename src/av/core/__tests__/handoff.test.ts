/* 04 → 05 交接 · A9 计算链延伸到图纸 · A10 待确认判定 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compute } from '../compute.ts';
import { FIXTURES, fixtureConfig } from '../fixtures.ts';
import { finalValue, isPending, toHandoff, type IngestRecord, type IngestResult } from '../handoff.ts';

const rec = (over: Partial<IngestRecord>): IngestRecord => ({
  drawing: '01_平面图.dxf', element: 'led_opening_w', value: 4480, unit: 'mm',
  prov: { source: '01_平面图.dxf / A-LED-DISPLAY / (0, 1200)', method: 'rule', confidence: 0.94, rule: 'A级-DXF-实体范围', note: null },
  confirmed: false, corrected: null, corrected_by: '', corrected_at: '', needs_review: false, ...over,
});

const ingest = (extractions: IngestRecord[]): IngestResult => ({
  drawing: '01_平面图.dxf', grade: 'A', scale_mm_per_unit: 1, threshold: 0.85, notes: [],
  may_enter_configuration: false, extractions,
});

test('isPending 跟随 Python 标出的 needs_review，确认后解除', () => {
  assert.equal(isPending(rec({ needs_review: true })), true);
  assert.equal(isPending(rec({ needs_review: true, confirmed: true })), false);
  assert.equal(isPending(rec({ needs_review: false })), false);
});

test('必填要素确认为空仍算待办（未识别项补录）', () => {
  assert.equal(isPending(rec({ value: null, needs_review: true, confirmed: true })), true);
  assert.equal(isPending(rec({ value: null, needs_review: true, confirmed: true, corrected: 4480 })), false);
  assert.equal(isPending(rec({ element: 'led_view_min', value: null, unit: 'm', needs_review: true, confirmed: true })), false,
    '非必填项允许确认暂缺');
});

test('交接取修正值，并把来源带进 05 的计算链', () => {
  const h = toHandoff(ingest([
    rec({ confirmed: true }),
    rec({ element: 'led_opening_h', value: 2500, confirmed: true, corrected: 2560, corrected_by: 'PM-Jimmy' }),
    rec({ element: 'led_view_min', value: null, unit: 'm', confirmed: true }),
  ]));
  assert.deepEqual(h.fields, { led_opening_w: 4480, led_opening_h: 2560 });
  assert.equal(h.prov.led_opening_w!.confidence, 'confirmed');
  assert.equal(h.prov.led_opening_w!.rule, 'A级-DXF-实体范围');
  assert.equal(h.prov.led_opening_h!.method, 'manual');
  assert.match(h.prov.led_opening_h!.note!, /原值 2500.*PM-Jimmy/);
  assert.ok(!('led_view_min' in h.fields), '暂缺项不写入配置');

  const r = compute({ ...fixtureConfig(FIXTURES[0]), ...h.fields }, 'led@1.0', h.prov);
  assert.equal(r.trace.L.prov.source, '01_平面图.dxf / A-LED-DISPLAY / (0, 1200)');
  assert.equal(r.trace.H.prov.method, 'manual');
  assert.equal(r.layout!.cells.length, 35, '带入 144 的尺寸后排布与 §6.3 一致');
});

test('finalValue 优先修正值', () => {
  assert.equal(finalValue(rec({ corrected: 1 })), 1);
  assert.equal(finalValue(rec({})), 4480);
});
