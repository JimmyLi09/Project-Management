/* 技术方案书内容：中英文同源，全部数值取自同一次计算 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compute } from '../compute.ts';
import { FIXTURES, fixtureConfig } from '../fixtures.ts';
import { proposalDoc } from '../proposal.ts';

const cfg = fixtureConfig(FIXTURES[0]);
const r = compute({ ...cfg, led_view_min: 3 }, 'led@1.0');
const meta = { title: '144 Chuan Grove', client: '海晟置业', date: '2026-09-28' };
const all = (d: NonNullable<ReturnType<typeof proposalDoc>>) =>
  d.sections.flatMap((s) => [s.heading, ...(s.paragraphs ?? []), ...(s.notes ?? []), ...(s.table?.rows.flat() ?? []), ...(s.items?.map((i) => i.text) ?? [])]).join('\n');

test('中文：数值与段落与出图、验收用例一致', () => {
  const d = proposalDoc(r, { ...meta, lang: 'zh' })!;
  const text = all(d);
  assert.equal(d.title, 'LED 显示屏系统技术方案');
  assert.match(text, /4480 × 2560 mm/);
  assert.match(text, /35 只箱体拼装而成，共计 224 块模组。箱体规格全部取自公司标准箱体库/);
  assert.match(text, /共需 3 个供电回路，另预留 1 路备用，合计电源线 4 根/);
  assert.match(text, /需数据线 6 条，另预留 1 条备用，合计 7 根/);
  assert.match(text, /与 P2 的点间距配置相匹配/);
  assert.deepEqual(d.sections[2].table!.rows, [['640 × 480', '28 只', '库内标准'], ['640 × 640', '7 只', '库内标准']]);
  assert.equal(d.sections.length, 5, '无校验提示时没有待确认事项');
  assert.deepEqual(d.cover.map((c) => c.label), ['项目', '客户', '日期']);
  assert.match(d.copyright.paragraphs[0], /© 2026 AUDAX/);
  assert.match(d.copyright.paragraphs[1], /仅供海晟置业就「144 Chuan Grove」项目评估使用/);
});

test('英文：同一组数值，章节一一对应', () => {
  const zh = proposalDoc(r, { ...meta, lang: 'zh' })!;
  const en = proposalDoc(r, { ...meta, lang: 'en' })!;
  const text = all(en);
  assert.equal(en.title, 'LED Display System Technical Proposal');
  assert.equal(en.sections.length, zh.sections.length);
  assert.match(text, /P2 indoor fixed LED display/);
  assert.match(text, /assembled from 35 cabinets with 224 modules/);
  assert.match(text, /3 power circuits are required, plus 1 spare, for a total of 4 power cables/);
  assert.match(text, /NovaStar\. At 560,000 pixels per network port, 6 data runs are required, plus 1 spare, for a total of 7 data cables/);
  assert.deepEqual(en.sections[2].table!.rows[0], ['640 × 480', '28', 'Standard (in library)']);
  assert.deepEqual(en.sections[3].table!.rows[1], zh.sections[3].table!.rows[1].map((x, i) => (i === 2 ? 'Balanced by column' : i === 0 ? 'Circuit loads' : x)));
  assert.doesNotMatch(text, /[一-鿿]/, '英文版正文不含中文');
  assert.match(en.copyright.paragraphs[1], /provided to 海晟置业 solely for evaluating the "144 Chuan Grove" project/);
});

test('叙述与待确认事项跟随校验结果', () => {
  const warn = compute({ ...cfg, led_view_min: 1.5, led_pwr_dist: 35 }, 'led@1.0');
  const zh = all(proposalDoc(warn, { ...meta, lang: 'zh' })!);
  const en = all(proposalDoc(warn, { ...meta, lang: 'en' })!);
  assert.match(zh, /小于 P2 的推荐最小观看距离/);
  assert.match(zh, /强电井距屏体 35 m/);
  assert.match(zh, /六、待确认事项/);
  assert.match(en, /\[LED-VD-01\] The nearest viewing distance of 1\.5 m is less than 2 m/);
  assert.match(en, /\[LED-PWR-07\] The electrical riser is 35 m away/);
});

test('没有客户名时封面与版权页不留空位；排布无解时没有方案书', () => {
  const d = proposalDoc(r, { title: 'X', lang: 'zh', date: '2026-09-28' })!;
  assert.deepEqual(d.cover.map((c) => c.label), ['项目', '日期']);
  assert.match(d.copyright.paragraphs[1], /仅供「X」项目评估使用/);
  assert.equal(proposalDoc(compute({ ...cfg, led_opening_w: 4500 }, 'led@1.0'), { ...meta, lang: 'zh' }), null);
});
