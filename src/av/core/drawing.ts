/* ===== §8 drawing model =====

   One geometry source, two renderers. Everything here is model space in
   millimetres with the origin at the screen's bottom-left corner and Y pointing
   up (§8.2), so the DXF renderer can emit these coordinates unchanged and the
   SVG renderer only has to flip Y.

   Layer names and ACI colours are §8.1 verbatim; §8.2 requires the SVG to carry
   the same grouping so a non-CAD user edits the same structure. */

import type { ComputeResult } from './compute.ts';

export type Entity =
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { k: 'rect'; x: number; y: number; w: number; h: number }
  | { k: 'circle'; cx: number; cy: number; r: number }
  | { k: 'text'; x: number; y: number; h: number; s: string; anchor: 'start' | 'middle' | 'end' };

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

export const LAYERS = [
  { name: 'LED-01-屏体轮廓', aci: 7, rgb: '#FFFFFF' },
  { name: 'LED-02-箱体', aci: 1, rgb: '#E4443C' },
  { name: 'LED-02B-定制箱体', aci: 6, rgb: '#C77DE8' },
  { name: 'LED-03-模组', aci: 8, rgb: '#5B6168' },
  { name: 'LED-04-电源回路', aci: 2, rgb: '#F2C230' },
  { name: 'LED-05-数据线', aci: 3, rgb: '#3FBF6A' },
  { name: 'LED-06-标注', aci: 4, rgb: '#3FC7D4' },
  { name: 'LED-07-文字', aci: 7, rgb: '#FFFFFF' },
] as const;

export type LayerName = (typeof LAYERS)[number]['name'];

/* Annotation offsets, mm from the screen edges. */
const BUS_Y = -60;        // power bus run
const DROP_Y = -360;      // where circuit drop lines end
const SPARE_Y = -300;     // spare data run marker
const DIM_Y = 260;        // horizontal dimension line, above the screen
const DIM_X = 900;        // vertical dimension line, right of the screen
const RUN_END = 170;      // data run overshoot past the right edge
const RUN_MARK = 260;     // data run number circle
const INFO_Y = -560;      // first line of the information panel

export interface DrawingMeta {
  project: string;
  /* Whether the profile is calibrated; an uncalibrated draft is stamped. */
  draft?: boolean;
}

export function buildDrawing(r: ComputeResult, meta: DrawingMeta): Drawing | null {
  const { layout, wiring, cfg, trace, profile } = r;
  if (!layout || !wiring) return null;

  const L = cfg.led_opening_w;
  const H = cfg.led_opening_h;
  const modW = trace.mod_w.value;
  const modH = trace.mod_h.value;

  const lay = new Map<LayerName, Entity[]>(LAYERS.map((l) => [l.name, [] as Entity[]]));
  const put = (name: LayerName, ...e: Entity[]) => { lay.get(name)!.push(...e); };

  /* LED-03 module grid */
  for (let i = 1; i * modW < L - 1e-6; i++) put('LED-03-模组', { k: 'line', x1: i * modW, y1: 0, x2: i * modW, y2: H });
  for (let i = 1; i * modH < H - 1e-6; i++) put('LED-03-模组', { k: 'line', x1: 0, y1: i * modH, x2: L, y2: i * modH });

  /* LED-02 / LED-02B cabinets, numbered RxCy from the bottom-left */
  for (const c of layout.cells) {
    const target: LayerName = c.custom ? 'LED-02B-定制箱体' : 'LED-02-箱体';
    put(target,
      { k: 'rect', x: c.x, y: c.y, w: c.w, h: c.h },
      { k: 'text', x: c.x + c.w / 2, y: c.y + c.h / 2 + 30, h: 60, s: `R${c.r}C${c.c}`, anchor: 'middle' },
      { k: 'text', x: c.x + c.w / 2, y: c.y + c.h / 2 - 80, h: 60, s: `${c.w}×${c.h}`, anchor: 'middle' },
    );
  }

  /* LED-01 screen outline */
  put('LED-01-屏体轮廓', { k: 'rect', x: 0, y: 0, w: L, h: H });

  /* LED-04 power circuits, grouped by cabinet column and dropped below */
  const xs = [0];
  for (const w of layout.widths) xs.push(xs[xs.length - 1] + w);
  wiring.circuits.forEach((g, i) => {
    const x0 = xs[g.cols[0]];
    const x1 = xs[g.cols[g.cols.length - 1] + 1];
    const xm = (x0 + x1) / 2;
    put('LED-04-电源回路',
      { k: 'line', x1: x0, y1: BUS_Y, x2: x1, y2: BUS_Y },
      { k: 'line', x1: xm, y1: BUS_Y, x2: xm, y2: DROP_Y },
      { k: 'text', x: xm, y: DROP_Y - 130, h: 90, s: `回路 ${i + 1} · ${Math.round(g.kw * 1000)}W`, anchor: 'middle' },
      { k: 'text', x: xm, y: DROP_Y - 250, h: 90, s: cfg.led_power_cable, anchor: 'middle' },
    );
  });
  put('LED-04-电源回路',
    { k: 'text', x: L / 2, y: DROP_Y - 400, h: 90, s: `备用回路 ${wiring.nCircuit + 1}（预留）`, anchor: 'middle' });

  /* LED-05 data runs — drawn per row, numbered top to bottom (§7.2) */
  const runs: number[] = [];
  let y = 0;
  layout.heights.forEach((rowH, ri) => {
    for (let t = 0; t < wiring.rowRuns[ri]; t++) runs.push(y + rowH * (t + 0.5) / wiring.rowRuns[ri]);
    y += rowH;
  });
  runs.slice().sort((a, b) => b - a).forEach((yc, i) => {
    put('LED-05-数据线',
      { k: 'line', x1: 60, y1: yc, x2: L + RUN_END, y2: yc },
      { k: 'circle', cx: L + RUN_MARK, cy: yc, r: 90 },
      { k: 'text', x: L + RUN_MARK, y: yc - 30, h: 70, s: String(i + 1), anchor: 'middle' },
    );
  });
  put('LED-05-数据线',
    { k: 'circle', cx: L + RUN_MARK, cy: SPARE_Y, r: 90 },
    { k: 'text', x: L + RUN_MARK, y: SPARE_Y - 30, h: 70, s: String(wiring.nDataRun + 1), anchor: 'middle' },
    { k: 'text', x: L + RUN_MARK + 320, y: SPARE_Y - 30, h: 80, s: 'FOR SPARE', anchor: 'start' });

  /* LED-06 dimensions: overall above and right, per column and per row inside */
  put('LED-06-标注',
    { k: 'line', x1: 0, y1: H + DIM_Y, x2: L, y2: H + DIM_Y },
    { k: 'text', x: L / 2, y: H + DIM_Y + 90, h: 110, s: String(L), anchor: 'middle' },
    { k: 'line', x1: L + DIM_X, y1: 0, x2: L + DIM_X, y2: H },
    { k: 'text', x: L + DIM_X + 120, y: H / 2, h: 110, s: String(H), anchor: 'start' });
  let x = 0;
  for (const w of layout.widths) {
    put('LED-06-标注', { k: 'text', x: x + w / 2, y: H + 60, h: 80, s: String(w), anchor: 'middle' });
    x += w;
  }
  y = 0;
  for (const h of layout.heights) {
    put('LED-06-标注', { k: 'text', x: L + DIM_X - 180, y: y + h / 2, h: 80, s: String(h), anchor: 'end' });
    y += h;
  }

  /* LED-07 information panel (§8.2 — fixed contents plus the disclaimer) */
  const bom = layout.bom.map((b) => `${b.w}×${b.h} × ${b.count}`).join('   ');
  const info = [
    `项目：${meta.project}`,
    `屏体 ${L} × ${H} mm   ${trace.sqm.value.toFixed(2)} ㎡   P${cfg.led_pitch}   模组 ${modW}×${modH} 共 ${trace.mods.value} 块`,
    `箱体：${bom}   合计 ${layout.cells.length} 只${layout.custom ? '   含库外定制规格' : ''}`,
    `分辨率 ${trace.px_w.value} × ${trace.px_h.value} = ${(trace.px.value / 1e6).toFixed(2)} MPx   功耗 ${trace.kw.value.toFixed(2)} kW @ ${profile.wSqm} W/㎡`,
    `电源 ${wiring.nCircuit} 回路 + 1 备用（单回路 ≤ ${trace.circuit_kw.value} kW，报价 ${wiring.nPowerCable} 根）   数据线 ${wiring.nDataRun} 条 + 1 备用（报价 ${wiring.nDataCable} 根）`,
    `规则包 ${r.pack.version}   参数组 ${profile.label}${profile.calibrated ? '' : '（待校准）'}`,
    '本图为方案阶段示意，箱体规格与回路分组需现场复核后方可施工。',
  ];
  if (meta.draft || !profile.calibrated) {
    info.push('草图 · 参数组未校准，不得用于正式报价或施工。');
  }
  info.forEach((s, i) => put('LED-07-文字', { k: 'text', x: 0, y: INFO_Y - i * 160, h: 100, s, anchor: 'start' }));

  const layers = LAYERS.map((l) => ({ ...l, entities: lay.get(l.name)! }));
  return { title: meta.project, bbox: bboxOf(layers), layers };
}

function bboxOf(layers: { entities: Entity[] }[]) {
  let minX = 0, minY = 0, maxX = 0, maxY = 0;
  const hit = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  for (const l of layers) for (const e of l.entities) {
    if (e.k === 'line') { hit(e.x1, e.y1); hit(e.x2, e.y2); }
    else if (e.k === 'rect') { hit(e.x, e.y); hit(e.x + e.w, e.y + e.h); }
    else if (e.k === 'circle') { hit(e.cx - e.r, e.cy - e.r); hit(e.cx + e.r, e.cy + e.r); }
    /* Text is anchored, not measured; widen by a rough advance so labels fit. */
    else { hit(e.x, e.y - e.h); hit(e.x + (e.anchor === 'start' ? e.s.length * e.h * 0.62 : 0), e.y + e.h); }
  }
  return { minX, minY, maxX, maxY };
}

/* A6 — a formal deliverable may not be produced while a blocking finding stands
   (LED-TYPE-01 for an uncalibrated profile). On-screen preview is unaffected. */
export function assertExportable(r: ComputeResult): void {
  if (r.exportable) return;
  const why = r.findings.filter((f) => f.severity === 'block').map((f) => `${f.code} ${f.message}`).join('\n');
  throw new Error(`禁止导出正式文件：\n${why}`);
}
