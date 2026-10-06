/* 投影 prj@0.2（AV-020 第 2 部分）· 机位人工调整、四个视图、DXF 分图层、技术方案 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { textBoxes } from '../drawing.ts';
import { overlap } from '../textfit.ts';
import { prjCalcBasis } from '../prj/calc.ts';
import { computePrjGroups, type PrjGroupsConfig, type PrjManual } from '../prj/groups.ts';
import { prjProposalDoc } from '../prj/proposal.ts';
import { PRJ_SAMPLES, prjSample } from '../prj/samples.ts';
import { prjSystem } from '../prj/system.ts';
import { buildPrjDxf, buildPrjView, PRJ_LAYERS, PRJ_VIEWS } from '../prj/views.ts';

const V2 = 'prj@0.2';
const run = (cfg: PrjGroupsConfig) => computePrjGroups(cfg, V2);
const codes = (r: ReturnType<typeof run>) => r.findings.map((f) => f.code);
const AT = new Date(2026, 9, 6, 15, 30).getTime();
const withManual = (key: Parameters<typeof prjSample>[0], m: Omit<PrjManual, 'by' | 'at'>, gi = 0) => {
  const cfg = prjSample(key);
  cfg.prj_groups[gi].manual = { ...m, by: 'JM', at: AT };
  return cfg;
};

test('人工调整投射距离：在镜头范围和可用距离内照用，遮挡跟着重算，标「人工调整 · 谁 · 何时」', () => {
  const r = run(withManual('single', { d: 5.2 }));
  const g = r.groups[0];
  assert.equal(g.d, 5.2);
  assert.ok(g.dOk);
  assert.equal(g.manual, 'JM · 2026-10-06 15:30');
  assert.ok(Math.abs((g.shadowY ?? 0) - (0.3 + (g.lensH - 0.3) * 1.5 / 5.2)) < 1e-9);
  assert.ok(codes(r).includes('PRJ-MAN-01'));
  assert.ok(!r.findings.some((f) => f.severity === 'block'));
  const cell = prjCalcBasis(r).rows.find((x) => x.key === 'throw')!.cells[0];
  assert.match(cell.text, /人工调整 · JM · 2026-10-06 15:30/);
  assert.match(prjCalcBasis(r, 'en').rows.find((x) => x.key === 'throw')!.cells[0].text, /adjusted by hand/);
});

test('人工调整投射距离超出镜头范围或可用距离 → 标红 PRJ-MAN-02（不重复报 PRJ-THROW-01）', () => {
  for (const d of [4.5, 6.5]) {
    const r = run(withManual('single', { d }));
    assert.ok(!r.groups[0].dOk, `d = ${d}`);
    assert.ok(codes(r).includes('PRJ-MAN-02'));
    assert.ok(!r.exportable);
  }
  const r114 = run(withManual('114', { d: 4.8 }));
  assert.equal(codes(r114).filter((c) => c === 'PRJ-THROW-01').length, 1, '只有没调整的那组还报 THROW-01');
  assert.equal(codes(r114).filter((c) => c === 'PRJ-MAN-02').length, 1);
});

test('人工调整镜头离地：位移在机器能力内照用；超出位移或高于天花 → 标红 PRJ-MAN-02', () => {
  const ok = run(withManual('single', { lensH: 2.6 }));
  assert.equal(ok.groups[0].lensH, 2.6);
  assert.ok(Math.abs((ok.groups[0].shift ?? 0) - 0.9 / 2.8) < 1e-9);
  assert.ok(ok.groups[0].ceilOk);
  assert.ok(!codes(ok).includes('PRJ-MAN-02'));
  assert.match(prjCalcBasis(ok).rows.find((x) => x.key === 'lens_h')!.cells[0].text, /人工调整/);

  const bad = run(withManual('single', { lensH: 3.4 }));
  assert.ok(!bad.groups[0].ceilOk);
  assert.ok(codes(bad).includes('PRJ-MAN-02'));
  assert.ok(!codes(bad).includes('PRJ-CEIL-01'), '人工调整的不再报 CEIL-01');
  assert.match(bad.findings.find((f) => f.code === 'PRJ-MAN-02')!.messageEn ?? '', /lens shift/);
});

test('地面组人工调整吊装高度：在镜头范围内照用，高于天花标红；只有 by / at 没有数值时不算调整', () => {
  const ok = run(withManual('floor', { d: 3.0 }));
  assert.equal(ok.groups[0].lensH, 3.0);
  assert.ok(ok.groups[0].dOk);
  const bad = run(withManual('floor', { d: 3.5 }));
  assert.ok(codes(bad).includes('PRJ-MAN-02'));
  const none = run(withManual('single', {}));
  assert.equal(none.groups[0].manual, null);
  assert.ok(!codes(none).includes('PRJ-MAN-01'));
});

test('系统配置：MY014 两组 → 2 台 PC、2 套融合软件、2 套多屏宝、雷达 2 颗；MY016 5 台 → 多屏宝 3 套；地面互动雷达待定', () => {
  const my014 = prjSystem(run(prjSample('MY014')));
  assert.deepEqual({ pcs: my014.pcs, blends: my014.blends, boxes: my014.boxes, radars: my014.radars, projectors: my014.projectors },
    { pcs: 2, blends: 2, boxes: 2, radars: 2, projectors: 4 });
  const my016 = prjSystem(run(prjSample('MY016')));
  assert.deepEqual({ pcs: my016.pcs, blends: my016.blends, boxes: my016.boxes, radars: my016.radars }, { pcs: 1, blends: 1, boxes: 3, radars: 0 });
  assert.equal(prjSystem(run(prjSample('floor'))).radars, null);
});

const texts = (d: { layers: { name: string; entities: { k: string; s?: string; c?: string }[] }[] }, layer?: string) =>
  d.layers.filter((l) => !layer || l.name === layer).flatMap((l) => l.entities.filter((e) => e.k === 'text').map((e) => e.s!));

test('四个视图：每个样本都能生成，文字互不重叠（中英文）', () => {
  for (const { key } of PRJ_SAMPLES) {
    const r = run(prjSample(key));
    for (const lang of ['zh', 'en'] as const) {
      for (const v of PRJ_VIEWS) {
        const out = buildPrjView(v.key, r, lang);
        assert.ok(out, `${key} ${v.key}`);
        const tb = textBoxes(out.drawing);
        assert.ok(tb.length > 0);
        for (let i = 0; i < tb.length; i++) for (let j = i + 1; j < tb.length; j++) {
          assert.ok(!overlap(tb[i].box, tb[j].box), `${key} ${v.key} ${lang}：「${tb[i].s}」压到「${tb[j].s}」`);
        }
      }
    }
  }
});

test('平面图 / 立面图：每台投影机一个编号（跨组连续）；立面有融合带斜线和转角；无效输入不出图', () => {
  const r = run(prjSample('MY014'));
  const plan = buildPrjView('plan', r)!.drawing;
  assert.deepEqual(texts(plan, 'PRJ-02-机位'), ['P1', 'P2', 'P3', 'P4']);
  assert.ok(texts(plan).some((s) => s.includes('投射 0.71 m')));
  const elev = buildPrjView('elev', run(prjSample('MY016')))!.drawing;
  assert.deepEqual(texts(elev, 'PRJ-02-机位'), ['P1', 'P2', 'P3', 'P4', 'P5']);
  assert.ok(elev.layers.find((l) => l.name === 'PRJ-04-融合区')!.entities.length > 20, '4 条融合带的斜线');
  assert.equal(texts(elev).filter((s) => s === '转角 90°').length, 2);
  const bad = prjSample('single');
  bad.prj_ceiling = 0;
  assert.equal(buildPrjView('plan', run(bad)), null);
});

test('剖面图：光线低于人头的观众标红、否则标绿；拖动把手在投影机位置', () => {
  const r = run(prjSample('MY016'));
  const out = buildPrjView('sect', r)!;
  const shadow = out.drawing.layers.find((l) => l.name === 'PRJ-06-遮挡检查')!.entities;
  assert.ok(shadow.some((e) => e.k === 'line' && e.c === '#FF6B6B'), 'MY016 人站 1 m 处会挡光 → 红');
  assert.ok(texts(out.drawing).includes('光线 1.23 m'));
  const h = out.handles[0];
  assert.equal(h.kind, 'sect');
  if (h.kind === 'sect') {
    assert.ok(Math.abs((h.wallX - h.x) / 1000 - r.groups[0].d) < 1e-9);
    assert.ok(Math.abs(h.y / 1000 - r.groups[0].lensH) < 1e-9);
  }
  const ok = run({ ...prjSample('MY016'), prj_view_near: 2.0 });   // 光线 3.9 × 2 ÷ 3.165 ≈ 2.46 m，高过人头
  const okShadow = buildPrjView('sect', ok)!.drawing.layers.find((l) => l.name === 'PRJ-06-遮挡检查')!.entities;
  assert.ok(okShadow.some((e) => e.k === 'line' && e.c === '#5AD18F'));
  /* plan handles: one per wall group, on the room side of the wall at the throw distance */
  const ph = buildPrjView('plan', run(prjSample('MY014')))!.handles;
  assert.equal(ph.length, 2);
  for (const p of ph) if (p.kind === 'plan') assert.ok(Math.abs(Math.hypot(p.x - p.wx, p.y - p.wy) / 1000 - 0.714) < 0.01);
});

test('人工调整写在图上：平面图、剖面图标「人工调整」', () => {
  const r = run(withManual('single', { d: 5.2 }));
  assert.ok(texts(buildPrjView('plan', r)!.drawing).some((s) => s.includes('人工调整')));
  assert.ok(texts(buildPrjView('sect', r, 'en')!.drawing).some((s) => s.includes('adjusted by hand')));
});

test('DXF：平面 / 立面 / 剖面分图层（投影面、机位、投射锥、融合区、尺寸、遮挡检查、文字），说明栏有计算依据和「部分常数待校准」', () => {
  const r = run(prjSample('MY016'));
  const d = buildPrjDxf(r, { project: 'MY016' })!;
  assert.deepEqual(d.layers.map((l) => l.name), PRJ_LAYERS.map((l) => l.name).filter((n) => n !== 'PRJ-08-系统'));
  for (const l of d.layers) assert.ok(l.entities.length > 0, `${l.name} 不能是空层`);
  const notes = texts(d, 'PRJ-07-文字');
  for (const s of ['平面机位图', '展开立面 · 融合区', '剖面 · 遮挡检查', '计算依据']) assert.ok(notes.includes(s), s);
  assert.ok(notes.some((s) => s.startsWith('部分常数待校准')));
  assert.ok(notes.some((s) => s.startsWith('台数：5 台')));
  const tb = textBoxes(d);
  for (let i = 0; i < tb.length; i++) for (let j = i + 1; j < tb.length; j++) assert.ok(!overlap(tb[i].box, tb[j].box), `「${tb[i].s}」压到「${tb[j].s}」`);
  const en = texts(buildPrjDxf(r, { project: 'MY016', lang: 'en' })!, 'PRJ-07-文字');
  assert.ok(en.includes('Calculation basis') && en.some((s) => s.startsWith('Some constants not yet calibrated')));
  assert.equal(buildPrjDxf(run({ ...prjSample('MY016'), prj_groups: [] }), { project: 'x' }), null);
});

test('技术方案（中 / 英）：配置表、系统配置、计算依据（与 05 同一份）、检查结果、常见坑；封面标「部分常数待校准」', () => {
  const r = run(prjSample('MY014'));
  const zh = prjProposalDoc(r, { title: 'MY014', client: 'Chin Hin', lang: 'zh', date: '2026-10-06' })!;
  assert.equal(zh.title, '投影系统技术方案');
  assert.deepEqual(zh.sections.map((s) => s.heading), ['一、方案概述', '二、投影配置', '三、系统配置', '四、计算依据', '五、检查结果', '六、常见坑提示', '七、说明与限制']);
  assert.ok(zh.cover.some((c) => c.value === '部分常数待校准'));
  assert.equal(zh.sections[1].table!.rows.length, 2);
  const sysRows = zh.sections[2].table!.rows;
  assert.deepEqual(sysRows.find((x) => x[0] === '雷达')!.slice(0, 2), ['雷达', '2']);
  assert.deepEqual(sysRows.find((x) => x[0] === 'PC 主机')!.slice(0, 2), ['PC 主机', '2']);
  const calc = prjCalcBasis(r, 'zh');
  assert.deepEqual(zh.sections[3].table!.header, ['项目', ...calc.groups, '公式 / 来源']);
  assert.equal(zh.sections[3].table!.rows.length, calc.rows.length);
  assert.ok(zh.sections[4].items!.some((x) => x.text.startsWith('[PRJ-PX-01]')));
  assert.ok(!zh.sections[4].items!.some((x) => x.text.includes('PRJ-CAL-01')));
  assert.ok(zh.sections[5].notes!.some((x) => x.includes('雷达标定')));

  const en = prjProposalDoc(r, { title: 'MY014', lang: 'en', date: '2026-10-06' })!;
  assert.equal(en.title, 'Projection System Technical Proposal');
  assert.ok(en.sections.every((s) => !/[\u4e00-\u9fff]/.test(s.heading)), '英文版章节标题没有中文');
  assert.ok(en.sections[4].items!.every((x) => !/[\u4e00-\u9fff]/.test(x.text.replace(/左墙|右墙/g, ''))), '英文版检查结果用英文');
  assert.ok(en.cover.some((c) => c.value === 'Some constants not yet calibrated'));

  const man = prjProposalDoc(run(withManual('single', { d: 5.2 })), { title: 'x', lang: 'zh', date: '2026-10-06' })!;
  assert.ok(man.sections.at(-1)!.notes!.some((x) => x.includes('人工调整（JM · 2026-10-06 15:30）')));
});
