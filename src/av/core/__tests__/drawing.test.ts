/* §8 出图规格 · A6 待校准拦截导出 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bomCsv, bomRows } from '../bom.ts';
import { compute } from '../compute.ts';
import { assertExportable, buildDrawing, LAYERS } from '../drawing.ts';
import { FIXTURES, fixtureConfig } from '../fixtures.ts';
import { toSvg } from '../svg.ts';

const r144 = compute(fixtureConfig(FIXTURES[0]), 'led@1.0');
const d144 = buildDrawing(r144, { project: '144-Chuan Grove' })!;

test('§8.1 · 八个图层齐全、ACI 色号正确、各自有内容', () => {
  assert.deepEqual(d144.layers.map((l) => l.name), [
    'LED-01-屏体轮廓', 'LED-02-箱体', 'LED-02B-定制箱体', 'LED-03-模组',
    'LED-04-电源回路', 'LED-05-数据线', 'LED-06-标注', 'LED-07-文字',
  ]);
  assert.deepEqual(d144.layers.map((l) => l.aci), [7, 1, 6, 8, 2, 3, 4, 7]);
  /* 144 has no custom cabinets, so LED-02B is legitimately empty. */
  for (const l of d144.layers) {
    if (l.name === 'LED-02B-定制箱体') assert.equal(l.entities.length, 0);
    else assert.ok(l.entities.length > 0, `${l.name} 不应为空`);
  }
});

test('§8.2 · 原点位于屏体左下角，模型坐标不平移', () => {
  const outline = d144.layers[0].entities[0];
  assert.deepEqual(outline, { k: 'rect', x: 0, y: 0, w: 4480, h: 2560 });
});

test('§8.1 · 定制箱体单独成层，便于筛选', () => {
  const custom = compute({ ...fixtureConfig(FIXTURES[1]) }, 'led@1.0'); // 143 produces 320×640
  const d = buildDrawing(custom, { project: '143-Royal Plaza' })!;
  const std = d.layers.find((l) => l.name === 'LED-02-箱体')!;
  const cus = d.layers.find((l) => l.name === 'LED-02B-定制箱体')!;
  assert.ok(cus.entities.length > 0, '库外规格必须落在 LED-02B');
  const rects = (es: typeof cus.entities) => es.filter((e) => e.k === 'rect').length;
  assert.equal(rects(std.entities) + rects(cus.entities), custom.layout!.cells.length);
});

test('§7.2 · 数据线自上而下编号，备用线单独编号并标 FOR SPARE', () => {
  const data = d144.layers.find((l) => l.name === 'LED-05-数据线')!;
  const circles = data.entities.filter((e) => e.k === 'circle');
  assert.equal(circles.length, r144.wiring!.nDataRun + 1, '每条线一个编号圈，另加备用');
  /* Numbered runs, excluding the spare, must descend in Y as the number grows. */
  const numbered = data.entities.filter((e) => e.k === 'text' && /^\d+$/.test(e.s)) as Extract<typeof data.entities[number], { k: 'text' }>[];
  const runs = numbered.filter((e) => Number(e.s) <= r144.wiring!.nDataRun).sort((a, b) => Number(a.s) - Number(b.s));
  for (let i = 1; i < runs.length; i++) assert.ok(runs[i].y < runs[i - 1].y, '编号越大位置越低');
  assert.ok(data.entities.some((e) => e.k === 'text' && e.s === 'FOR SPARE'));
  assert.ok(numbered.some((e) => e.s === String(r144.wiring!.nDataRun + 1)), '备用线编号 = 总条数 + 1');
});

test('§8.2 · 信息栏字段齐全并含免责说明', () => {
  const info = d144.layers.find((l) => l.name === 'LED-07-文字')!.entities
    .filter((e) => e.k === 'text').map((e) => (e as { s: string }).s).join('\n');
  for (const must of ['144-Chuan Grove', '4480 × 2560', '11.47 ㎡', 'P2', '模组 320×160',
    '640×480 × 28', '合计 35 只', '2240 × 1280', '5.73 kW', '3 回路', '6 条']) {
    assert.ok(info.includes(must), `信息栏缺少「${must}」`);
  }
  assert.match(info, /本图为方案阶段示意，箱体规格与回路分组需现场复核后方可施工。/);
});

test('SVG · 分组名与图层名一致，Y 轴翻转且文字不镜像', () => {
  const svg = toSvg(d144);
  for (const l of LAYERS) {
    if (l.name === 'LED-02B-定制箱体') continue;
    assert.ok(svg.includes(`<g id="${l.name}"`), `SVG 缺少分组 ${l.name}`);
  }
  assert.ok(!svg.includes('scale(1,-1)'), '不得用镜像变换翻转，否则文字会反');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.ok(svg.trimEnd().endsWith('</svg>'));
  /* The bottom of the screen must render below its top. */
  const outline = /<g id="LED-01-屏体轮廓"[^>]*>\s*<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(svg)!;
  assert.equal(Number(outline[3]), 4480);
  assert.equal(Number(outline[4]), 2560);
});

test('SVG · 文本转义，不产生非法 XML', () => {
  const d = buildDrawing(r144, { project: 'A & B <test> "x"' })!;
  const svg = toSvg(d);
  assert.ok(svg.includes('A &amp; B &lt;test&gt; &quot;x&quot;'));
  for (const m of svg.matchAll(/<(?:text|title)[^>]*>([^<]*)</g)) {
    assert.ok(!/[<>]/.test(m[1]), `文本节点含裸尖括号：${m[1]}`);
    assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(m[1]), `文本节点含裸 & ：${m[1]}`);
  }
});

test('§8.2 · 箱体清单可导出，含规格/数量/模组数/库内状态', () => {
  assert.deepEqual(bomRows(r144.layout!), [
    ['640×480', '28', '6', '库内标准'],
    ['640×640', '7', '8', '库内标准'],
  ]);
  const csv = bomCsv(r144.layout!);
  assert.ok(csv.startsWith('﻿规格,数量（只）,模组数/只,状态'), 'Excel 需要 UTF-8 BOM');
  assert.ok(csv.includes('合计,35'));
});

test('A6 · 待校准参数组可预览但不得导出正式文件', () => {
  const p = compute({
    ...fixtureConfig(FIXTURES[0]), led_screen_type: 'rental',
    led_opening_w: 2000, led_opening_h: 1500, led_cabinet: [500, 500],
  }, 'led@1.0');
  const d = buildDrawing(p, { project: '试算' })!;
  assert.ok(d, '预览图仍可生成');
  const info = d.layers.find((l) => l.name === 'LED-07-文字')!.entities
    .map((e) => (e as { s: string }).s).join('\n');
  assert.match(info, /待校准/);
  assert.match(info, /不得用于正式报价或施工/);
  assert.throws(() => assertExportable(p), /禁止导出正式文件[\s\S]*LED-TYPE-01/);
  assert.doesNotThrow(() => assertExportable(r144));
});

test('排布无解时不出图', () => {
  const blocked = compute(fixtureConfig(FIXTURES[7]), 'led@1.0'); // 131-Guoco
  assert.equal(buildDrawing(blocked, { project: '131' }), null);
});
