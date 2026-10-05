/* ===== §8 drawing model =====

   One geometry source, two renderers. Everything here is model space in
   millimetres with the origin at the screen's bottom-left corner and Y pointing
   up (§8.2), so the DXF renderer can emit these coordinates unchanged and the
   SVG renderer only has to flip Y.

   Layer names and ACI colours are §8.1 verbatim; §8.2 requires the SVG to carry
   the same grouping so a non-CAD user edits the same structure. */

import type { ComputeResult } from './compute.ts';
import { cabLetter, calcBasis } from './calc.ts';
import { manualLabel } from './override.ts';
import { overlap, textBox, textWidth, type Box } from './textfit.ts';

/* c = 单个图元的颜色(回路 / 网线各一色;DXF 写成 true colour,SVG 直接用);
   fill = 矩形 / 圆的底色(只给 SVG,DXF 里不填充) */
export type Entity =
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number; c?: string; sw?: number }
  | { k: 'rect'; x: number; y: number; w: number; h: number; c?: string; fill?: string; sw?: number }
  | { k: 'circle'; cx: number; cy: number; r: number; c?: string; fill?: string }
  | { k: 'text'; x: number; y: number; h: number; s: string; anchor: 'start' | 'middle' | 'end'; c?: string; bold?: boolean };

export interface Layer {
  name: string;
  aci: number;      // AutoCAD colour index (§8.1)
  rgb: string;      // screen equivalent for the SVG renderer
  entities: Entity[];
}

export interface Drawing {
  title: string;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  layers: Layer[];
}

/* §8.1 的 8 层 + AV-019 拆出来的两层(箱体编号、箱体尺寸),05 的图层开关和 DXF 里都能单独开关 */
export const LAYERS = [
  { name: 'LED-01-屏体轮廓', aci: 7, rgb: '#FFFFFF' },
  { name: 'LED-02-箱体', aci: 1, rgb: '#E4443C' },
  { name: 'LED-02B-定制箱体', aci: 6, rgb: '#C77DE8' },
  { name: 'LED-03-模组', aci: 8, rgb: '#5B6168' },
  { name: 'LED-04-电源回路', aci: 2, rgb: '#F2C230' },
  { name: 'LED-05-数据线', aci: 3, rgb: '#3FBF6A' },
  { name: 'LED-06-标注', aci: 4, rgb: '#3FC7D4' },
  { name: 'LED-07-文字', aci: 7, rgb: '#FFFFFF' },
  { name: 'LED-08-箱体编号', aci: 8, rgb: '#8B8F99' },
  { name: 'LED-09-箱体尺寸', aci: 7, rgb: '#E8E8E8' },
] as const;

export type LayerName = (typeof LAYERS)[number]['name'];

/* 05 的图层开关 → 图层 */
export const LAYER_TOGGLES: { key: string; zh: string; en: string; layers: LayerName[] }[] = [
  { key: 'id', zh: '箱体编号', en: 'Cabinet IDs', layers: ['LED-08-箱体编号'] },
  { key: 'size', zh: '箱体尺寸', en: 'Cabinet sizes', layers: ['LED-09-箱体尺寸'] },
  { key: 'pow', zh: '电源', en: 'Power', layers: ['LED-04-电源回路'] },
  { key: 'dat', zh: '网线', en: 'Data', layers: ['LED-05-数据线'] },
  { key: 'dim', zh: '尺寸线', en: 'Dimensions', layers: ['LED-06-标注'] },
  { key: 'info', zh: '说明栏', en: 'Notes', layers: ['LED-07-文字'] },
];

/* 回路 / 网线配色(和 05 的回路色板一致) */
export const CIRCUIT_COLORS = ['#F5B83D', '#4FB3FF', '#FF7A59', '#B48CFF', '#5AD18F', '#FF5FA2', '#E3E36A', '#7FD6D6'];
export const RUN_COLORS = ['#3DDC84', '#36C5F0', '#FFD166', '#EF476F', '#C77DFF', '#06D6A0', '#F78C6B', '#A0C4FF', '#FFADAD', '#CAFFBF'];
/* 混合尺寸时各种箱体的底纹(SVG 半透明底色) */
const TYPE_FILLS = ['', '#4FB3FF22', '#FF7A5922', '#B48CFF22', '#5AD18F22'];

export interface DrawingMeta {
  project: string;
  /* Whether the profile is calibrated; an uncalibrated draft is stamped. */
  draft?: boolean;
  /* AV-019 §2.3:人工调整过电源 / 网线时写「人工调整 · 谁 · 何时」 */
  manual?: string;
}

/* ===== AV-019 §2.1 分区布局 =====
   ① 屏体区(箱体、箱体标注、电源链、网线)② 尺寸区(上方列宽、右侧行高、总尺寸)
   ③ 配电区(屏体下方的母线、回路标注错开排列)④⑤ 图例 + 说明栏(屏体右侧单独一栏)。
   每个区各占各的位置,文字按实际字宽排;最后做一次碰撞检查,能挪的(回路标注、说明栏)
   往下挪,画框跟着内容走 —— 不裁切。 */
export function buildDrawing(r: ComputeResult, meta0: DrawingMeta): Drawing | null {
  const { layout, wiring, cfg, trace, profile } = r;
  if (!layout || !wiring) return null;
  /* 人工调整过就在说明栏、计算依据里写「人工调整 · 谁 · 何时」 */
  const meta = { ...meta0, manual: meta0.manual ?? (manualLabel(r.manual) || undefined) };

  const L = cfg.led_opening_w;
  const H = cfg.led_opening_h;
  const modW = trace.mod_w.value;
  const modH = trace.mod_h.value;
  const minCab = Math.min(...layout.cells.map((c) => Math.min(c.w, c.h)));
  const fs = clamp(minCab * 0.17, 45, 160);          // 基准字高 mm

  const lay = new Map<LayerName, Entity[]>(LAYERS.map((l) => [l.name, [] as Entity[]]));
  const put = (name: LayerName, ...e: Entity[]) => { lay.get(name)!.push(...e); };
  /* 碰撞检查用:fixed = 位置有含义不能挪(箱体里、尺寸),movable = 可以往下挪 */
  const placed: { e: Extract<Entity, { k: 'text' }>; movable: boolean; group?: string }[] = [];
  const text = (name: LayerName, e: Extract<Entity, { k: 'text' }>, movable = false, group?: string) => { put(name, e); placed.push({ e, movable, group }); };

  /* LED-03 module grid */
  for (let i = 1; i * modW < L - 1e-6; i++) put('LED-03-模组', { k: 'line', x1: i * modW, y1: 0, x2: i * modW, y2: H });
  for (let i = 1; i * modH < H - 1e-6; i++) put('LED-03-模组', { k: 'line', x1: 0, y1: i * modH, x2: L, y2: i * modH });

  /* ① 箱体 + 箱体标注:尺寸写在中心(大字),编号在左上角(小字) */
  const typeOf = new Map(layout.bom.map((b, i) => [`${b.w}x${b.h}`, i]));
  const multi = layout.bom.length > 1;
  for (const c of layout.cells) {
    const ti = typeOf.get(`${c.w}x${c.h}`) ?? 0;
    const target: LayerName = c.custom ? 'LED-02B-定制箱体' : 'LED-02-箱体';
    put(target, { k: 'rect', x: c.x, y: c.y, w: c.w, h: c.h, ...(multi && TYPE_FILLS[ti] ? { fill: TYPE_FILLS[ti] } : {}) });
    const label = `${multi ? cabLetter(ti) + ' ' : ''}${c.w}×${c.h}`;
    const sh = Math.min(fs, (c.w * 0.62) / Math.max(1, textWidth(label, 1)), c.h * 0.2);
    text('LED-09-箱体尺寸', { k: 'text', x: c.x + c.w / 2, y: c.y + c.h * 0.5 - sh * 0.3, h: sh, s: label, anchor: 'middle', bold: true });
    const id = `R${c.r}C${c.c}`;
    const ih = Math.min(fs * 0.55, (c.w * 0.4) / Math.max(1, textWidth(id, 1)), c.h * 0.12);
    text('LED-08-箱体编号', { k: 'text', x: c.x + c.w * 0.16, y: c.y + c.h * 0.97 - ih * 1.25, h: ih, s: id, anchor: 'start' });
  }

  /* LED-01 screen outline */
  put('LED-01-屏体轮廓', { k: 'rect', x: 0, y: 0, w: L, h: H });

  /* ① 电源链:每只箱体左侧一条竖线(按回路着色),链在列与列之间沿上 / 下边走;
     每路的起点有一个圆点,起点引线沿箱体最左侧落到下方母线 —— 都不经过中间的尺寸字 */
  const cell = layout.cells;
  const px = (i: number) => cell[i].x + cell[i].w * 0.08;
  const py = (i: number) => cell[i].y + cell[i].h * 0.5;
  const busY = -fs * 1.6;
  wiring.power.forEach((pc, k) => {
    const col = CIRCUIT_COLORS[k % CIRCUIT_COLORS.length];
    for (let t = 1; t < pc.cells.length; t++) {
      const a = pc.cells[t - 1], b = pc.cells[t];
      if (cell[a].c === cell[b].c) {
        put('LED-04-电源回路', { k: 'line', x1: px(a), y1: py(a), x2: px(b), y2: py(b), c: col, sw: 22 });
      } else {
        /* 换列:沿这一行的上沿或下沿过去 */
        const top = cell[a].r === layout.heights.length;
        const ey = top ? cell[a].y + cell[a].h * 0.975 : cell[a].y + cell[a].h * 0.025;
        put('LED-04-电源回路',
          { k: 'line', x1: px(a), y1: py(a), x2: px(a), y2: ey, c: col, sw: 22 },
          { k: 'line', x1: px(a), y1: ey, x2: px(b), y2: ey, c: col, sw: 22 },
          { k: 'line', x1: px(b), y1: ey, x2: px(b), y2: py(b), c: col, sw: 22 });
      }
    }
    if (!pc.cells.length) return;
    const s0 = pc.cells[0];
    const fx = cell[s0].x + cell[s0].w * 0.03;
    put('LED-04-电源回路',
      { k: 'circle', cx: px(s0), cy: py(s0), r: Math.min(cell[s0].w, cell[s0].h) * 0.05, c: col, fill: col },
      { k: 'line', x1: px(s0), y1: py(s0), x2: fx, y2: py(s0), c: col, sw: 14 },
      { k: 'line', x1: fx, y1: py(s0), x2: fx, y2: busY, c: col, sw: 14 });
  });
  put('LED-04-电源回路', { k: 'line', x1: 0, y1: busY, x2: L, y2: busY, sw: 22 });

  /* ③ 配电区:回路标注在母线下方,按各路起点的位置错开排列(一行放不下就换下一行) */
  const lh = fs * 0.85;
  const rowsEnd: number[] = [];
  const labels = wiring.power.map((pc, k) => {
    const x = Math.min(...pc.cells.map((i) => cell[i].x));
    const amps = pc.amps !== null ? ` · ${(Math.round(pc.amps * 10) / 10).toFixed(1)} A` : '';
    const over = pc.w > wiring.limitW + 1e-6;
    return { x, s: `回路 ${k + 1} · ${pc.cells.length} 箱 · ${Math.round(pc.w)} W${amps}${over ? ' ✕超限' : ''}`, c: over ? '#FF6B6B' : CIRCUIT_COLORS[k % CIRCUIT_COLORS.length] };
  });
  labels.push({ x: 0, s: `备用回路 ${wiring.nCircuit + 1}（预留） · ${cfg.led_power_cable}`, c: '#D4A72C' });
  labels.forEach((lb) => {
    const w = textWidth(lb.s, lh);
    let row = 0;
    while (rowsEnd[row] !== undefined && rowsEnd[row] > lb.x - fs * 0.6) row++;
    rowsEnd[row] = lb.x + w;
    text('LED-04-电源回路', { k: 'text', x: lb.x, y: busY - fs * 1.4 - row * lh * 1.7, h: lh, s: lb.s, anchor: 'start', c: lb.c }, true, 'circuits');
  });

  /* ① 网线:每条经过的箱体连成折线,走箱体下部(尺寸字下面);左侧起点圈写编号(接控制器网口 1、2…)和带载。
     同一行有几条线时各占一条「车道」;左侧的圈按从上到下排成一列,挤不下就往下错开,
     引线用折线接过去(越靠下的折点越靠右,引线之间不交叉) */
  const dx = (i: number) => cell[i].x + cell[i].w * 0.5;
  const dy = (i: number, lane: number) => cell[i].y + cell[i].h * (0.26 - 0.07 * Math.min(lane, 3));
  const startX = -fs * 3.2;
  const nMark = wiring.runs.length + 1;
  const markR = Math.max(fs * 0.4, Math.min(fs * 0.75, (H * 1.15) / (nMark * 2.5)));
  const laneUse = new Map<number, number>();
  const runPts = wiring.runs.map((run) => {
    if (!run.cells.length) return null;
    const rows = [...new Set(run.cells.map((i) => cell[i].r))];
    const lane = Math.max(...rows.map((r) => laneUse.get(r) ?? 0));
    rows.forEach((r) => laneUse.set(r, lane + 1));
    return run.cells.map((i) => [dx(i), dy(i, lane)] as const);
  });
  /* 圈的位置:按起点高度从上到下,间距不够就往下推 */
  const order = runPts.map((p, k) => ({ k, sy: p ? p[0][1] : -Infinity })).filter((o) => o.sy > -Infinity).sort((a, b) => b.sy - a.sy || a.k - b.k);
  const markY = new Map<number, number>();
  let prevY = Infinity;
  order.forEach((o) => { const y = Math.min(o.sy, prevY - markR * 2.5); markY.set(o.k, y); prevY = y; });
  const jogSpan = -(startX + markR) - fs * 0.3;
  order.forEach((o, idx) => {
    const k = o.k, pts = runPts[k]!, run = wiring.runs[k];
    const col = RUN_COLORS[k % RUN_COLORS.length];
    const sy = pts[0][1], my = markY.get(k)!;
    if (Math.abs(my - sy) < 1e-6) put('LED-05-数据线', { k: 'line', x1: startX + markR, y1: sy, x2: pts[0][0], y2: sy, c: col, sw: 14 });
    else {
      const jx = startX + markR + jogSpan * ((idx + 1) / (order.length + 1));
      put('LED-05-数据线',
        { k: 'line', x1: startX + markR, y1: my, x2: jx, y2: my, c: col, sw: 14 },
        { k: 'line', x1: jx, y1: my, x2: jx, y2: sy, c: col, sw: 14 },
        { k: 'line', x1: jx, y1: sy, x2: pts[0][0], y2: sy, c: col, sw: 14 });
    }
    for (let t = 1; t < pts.length; t++) {
      const [x1, y1] = pts[t - 1], [x2, y2] = pts[t];
      if (y1 === y2) put('LED-05-数据线', { k: 'line', x1, y1, x2, y2, c: col, sw: 14 });
      else {
        /* 换行(蛇形):在最右 / 最左那列沿箱体侧边竖着走,不穿过中间的尺寸字 */
        const cb = cell[run.cells[t]];
        const ex = cb.c === layout.widths.length ? cb.x + cb.w * 0.93 : cb.x + cb.w * 0.13;
        put('LED-05-数据线',
          { k: 'line', x1, y1, x2: ex, y2: y1, c: col, sw: 14 },
          { k: 'line', x1: ex, y1, x2: ex, y2, c: col, sw: 14 },
          { k: 'line', x1: ex, y1: y2, x2, y2, c: col, sw: 14 });
      }
    }
    pts.forEach(([x, y]) => put('LED-05-数据线', { k: 'circle', cx: x, cy: y, r: fs * 0.18, c: col, fill: col }));
    put('LED-05-数据线', { k: 'circle', cx: startX, cy: my, r: markR, c: col });
    text('LED-05-数据线', { k: 'text', x: startX, y: my - markR * 0.45, h: markR * 1.13, s: String(wiring.ports[k] ?? k + 1), anchor: 'middle', c: col });
    text('LED-05-数据线', { k: 'text', x: startX - markR * 1.4, y: my - markR * 0.4, h: Math.min(fs * 0.6, markR * 0.9), s: `${(run.px / 1e4).toFixed(1)}万`, anchor: 'end', c: col }, true, 'runs');
  });
  /* 备用网线:最下面一个圈的下方 */
  const spareY = Math.min(prevY === Infinity ? 0 : prevY - markR * 3, busY + markR);
  put('LED-05-数据线', { k: 'circle', cx: startX, cy: spareY, r: markR });
  text('LED-05-数据线', { k: 'text', x: startX, y: spareY - markR * 0.45, h: markR * 1.13, s: String(Math.max(wiring.nDataRun, ...wiring.ports) + 1), anchor: 'middle' });
  /* 人工调整时还没分配的箱体:回路 / 网线层各画一圈红框 */
  const miss = (layer: LayerName, list: number[]) => list.forEach((i) => {
    const c = cell[i], m = Math.min(c.w, c.h) * 0.05;
    put(layer, { k: 'rect', x: c.x + m, y: c.y + m, w: c.w - 2 * m, h: c.h - 2 * m, c: '#FF6B6B', sw: 18 });
  });
  miss('LED-04-电源回路', wiring.unassigned.power);
  miss('LED-05-数据线', wiring.unassigned.data);
  text('LED-05-数据线', { k: 'text', x: startX - markR * 1.4, y: spareY - markR * 0.4, h: Math.min(fs * 0.6, markR * 0.9), s: 'FOR SPARE', anchor: 'end' }, true, 'runs');

  /* ② 尺寸区:上方逐列宽 + 总宽,右侧逐行高 + 总高 */
  const dh = fs * 0.9;
  let x = 0;
  const colTop = H + fs * 0.5;
  for (const w of layout.widths) {
    const s = String(w);
    const h = Math.min(dh, (w * 0.8) / Math.max(1, textWidth(s, 1)));
    put('LED-06-标注', { k: 'line', x1: x, y1: H + fs * 0.2, x2: x, y2: H + fs * 2.2 });
    text('LED-06-标注', { k: 'text', x: x + w / 2, y: colTop, h, s, anchor: 'middle' });
    x += w;
  }
  put('LED-06-标注', { k: 'line', x1: L, y1: H + fs * 0.2, x2: L, y2: H + fs * 3.6 });
  const totY = H + fs * 2.8;
  put('LED-06-标注', { k: 'line', x1: 0, y1: totY, x2: L, y2: totY }, { k: 'line', x1: 0, y1: H + fs * 2.2, x2: 0, y2: H + fs * 3.6 });
  text('LED-06-标注', { k: 'text', x: L / 2, y: totY + fs * 0.35, h: fs * 1.2, s: String(L), anchor: 'middle' });
  let y = 0;
  const rowX = L + fs * 0.6;
  const rowW = Math.max(...layout.heights.map((h) => textWidth(String(h), dh)));
  for (const h of layout.heights) {
    const s = String(h);
    const th = Math.min(dh, h * 0.5);
    put('LED-06-标注', { k: 'line', x1: L + fs * 0.2, y1: y, x2: rowX + rowW + fs * 1.6, y2: y });
    text('LED-06-标注', { k: 'text', x: rowX, y: y + h / 2 - th * 0.3, h: th, s, anchor: 'start' });
    y += h;
  }
  put('LED-06-标注', { k: 'line', x1: L + fs * 0.2, y1: H, x2: rowX + rowW + fs * 1.6, y2: H });
  const totX = rowX + rowW + fs * 1.2;
  put('LED-06-标注', { k: 'line', x1: totX, y1: 0, x2: totX, y2: H });
  const hs = String(H);
  text('LED-06-标注', { k: 'text', x: totX + fs * 0.4, y: H / 2 - fs * 0.4, h: fs * 1.2, s: hs, anchor: 'start' });
  const dimRight = totX + fs * 0.4 + textWidth(hs, fs * 1.2);

  /* ④⑤ 图例 + 说明栏 + 计算依据:屏体右侧单独一栏,按实际字宽定栏宽 */
  const bomTxt = layout.bom.map((b, i) => `${multi ? cabLetter(i) + ' ' : ''}${b.w}×${b.h} × ${b.count}`).join('   ');
  const lines: { s: string; h: number; c?: string; bold?: boolean }[] = [];
  const add = (s: string, k = 0.78, c?: string, bold?: boolean) => lines.push({ s, h: fs * k, c, bold });
  add(`项目：${meta.project}`, 1.05, '#FFFFFF', true);
  add(`屏体 ${L} × ${H} mm   ${trace.sqm.value.toFixed(2)} ㎡   P${cfg.led_pitch}   模组 ${modW}×${modH} 共 ${trace.mods.value} 块`);
  add(`箱体：${bomTxt}   合计 ${layout.cells.length} 只${layout.custom ? '   含库外定制规格' : ''}`);
  add(`分辨率 ${trace.px_w.value} × ${trace.px_h.value} = ${(trace.px.value / 1e6).toFixed(2)} MPx   功耗 ${trace.kw.value.toFixed(2)} kW @ ${profile.wSqm} W/㎡`
    + (trace.kw_max ? `（最大 ${trace.kw_max.value.toFixed(2)} kW @ ${Math.round(trace.w_sqm_max.value * 100) / 100} W/㎡，回路按最大）` : ''));
  add(`电源 ${wiring.nCircuit} 回路 + 1 备用（单回路 ≤ ${trace.circuit_kw.value} kW，报价 ${wiring.nPowerCable} 根）   数据线 ${wiring.nDataRun} 条 + 1 备用（${wiring.manual.data ? '人工串接' : wiring.dataMode === 'snake' ? '蛇形按带载' : '每行一条'}，报价 ${wiring.nDataCable} 根）`);
  add(`规则包 ${r.pack.version}   参数组 ${profile.label}${profile.calibrated ? '' : '（待校准）'}${meta.manual ? `   人工调整 · ${meta.manual}` : ''}`);
  add('图例', 0.85, '#FFFFFF', true);
  layout.bom.forEach((b, i) => add(`${cabLetter(i)} ${b.w} × ${b.h} × ${b.count} 只${b.inLib ? '' : '（库外定制）'}`, 0.72));
  add(`━  电源回路（每路一色，圆点 = 起点）   ━  网线（左侧圈号 = 控制器网口）   ━  尺寸线`, 0.72);
  add('计算依据', 0.85, '#FFFFFF', true);
  for (const row of calcBasis(r, 'zh', { manual: meta.manual })) {
    add(`${row.item}：${row.formula} → ${row.result}`, 0.72, row.ok === false ? '#FF6B6B' : undefined);
  }
  for (const f of r.findings.filter((x) => x.code === 'LED-PWR-09' || x.code === 'LED-PWR-10' || x.code === 'LED-DATA-01')) add(`⚠ ${f.message}`, 0.72, '#FF6B6B');
  add('本图为方案阶段示意，箱体规格与回路分组需现场复核后方可施工。', 0.72);
  if (meta.draft || !profile.calibrated) add('草图 · 参数组未校准，不得用于正式报价或施工。', 0.72, '#FF6B6B');
  /* 太长的行(多路负载、告警)按标点折行,说明栏不会比屏体还宽;续行缩进两格 */
  const maxLine = Math.max(L * 0.6, fs * 0.78 * 46);
  const wrapped = lines.flatMap((l) => wrapText(l.s, l.h, maxLine).map((s, i) => ({ ...l, s: i ? `  ${s}` : s })));
  lines.splice(0, lines.length, ...wrapped);
  const infoX = dimRight + fs * 2;
  const pad = fs * 0.8;
  const infoW = Math.max(...lines.map((l) => textWidth(l.s, l.h))) + pad * 2;
  let iy = H + fs * 3.6 - pad;
  lines.forEach((l) => {
    iy -= l.h * 1.45;
    text('LED-07-文字', { k: 'text', x: infoX + pad, y: iy, h: l.h, s: l.s, anchor: 'start', ...(l.c ? { c: l.c } : {}), ...(l.bold ? { bold: true } : {}) }, false);
  });
  put('LED-07-文字', { k: 'rect', x: infoX, y: iy - pad, w: infoW, h: H + fs * 3.6 - (iy - pad) });

  /* 碰撞检查:能挪的往下挪,直到和谁都不相交(fixed 的不动) */
  resolveCollisions(placed, fs * 0.2);

  const layers = LAYERS.map((l) => ({ ...l, entities: lay.get(l.name)! }));
  return { title: meta.project, bbox: bboxOf(layers), layers };
}

/* 在「；，、 → 空格」后断行,每行不超过 maxW(单个片段本身太长就让它独占一行) */
export function wrapText(s: string, h: number, maxW: number): string[] {
  if (textWidth(s, h) <= maxW) return [s];
  const parts = s.split(/(?<=[；，、])|(?= → )|(?<=\s{3})/);
  const out: string[] = [];
  let cur = '';
  for (const p of parts) {
    if (cur && textWidth(cur + p, h) > maxW) { out.push(cur.trimEnd()); cur = p.trimStart(); }
    else cur += p;
  }
  if (cur) out.push(cur.trimEnd());
  return out;
}

function resolveCollisions(list: { e: Extract<Entity, { k: 'text' }>; movable: boolean; group?: string }[], gap: number) {
  for (let pass = 0; pass < 50; pass++) {
    let moved = false;
    for (let i = 0; i < list.length; i++) {
      if (!list[i].movable) continue;
      const bi = textBox(list[i].e);
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const bj = textBox(list[j].e);
        if (!overlap(bi, bj, gap)) continue;
        if (list[j].movable && j > i) continue;   // 两个都能挪:后面那个挪
        list[i].e.y -= (bi.y1 - bj.y0) + gap;
        moved = true;
        break;
      }
    }
    if (!moved) return;
  }
}

/* 所有文字的外框(测试和 05 的自检用) */
export function textBoxes(d: Drawing): { layer: string; s: string; box: Box }[] {
  return d.layers.flatMap((l) => l.entities.filter((e): e is Extract<Entity, { k: 'text' }> => e.k === 'text').map((e) => ({ layer: l.name, s: e.s, box: textBox(e) })));
}

function bboxOf(layers: { entities: Entity[] }[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const hit = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  for (const l of layers) for (const e of l.entities) {
    if (e.k === 'line') { hit(e.x1, e.y1); hit(e.x2, e.y2); }
    else if (e.k === 'rect') { hit(e.x, e.y); hit(e.x + e.w, e.y + e.h); }
    else if (e.k === 'circle') { hit(e.cx - e.r, e.cy - e.r); hit(e.cx + e.r, e.cy + e.r); }
    /* AV-019:文字按实际字宽算外框,画布跟着内容走,不裁切 */
    else { const b = textBox(e); hit(b.x0, b.y0); hit(b.x1, b.y1); }
  }
  return { minX, minY, maxX, maxY };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/* A6 — a formal deliverable may not be produced while a blocking finding stands
   (LED-TYPE-01 for an uncalibrated profile). On-screen preview is unaffected. */
export function assertExportable(r: ComputeResult): void {
  if (r.exportable) return;
  const why = r.findings.filter((f) => f.severity === 'block').map((f) => `${f.code} ${f.message}`).join('\n');
  throw new Error(`禁止导出正式文件：\n${why}`);
}
