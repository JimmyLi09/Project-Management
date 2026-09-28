/* ===== Projection · front-view drawing =====
   Same drawing model as LED (§8.2): model space in mm, origin at the image's
   bottom-left, Y up, so the SVG renderer and the Python DXF renderer both take
   it unchanged. Shows the image, each projector's raster, the blend zones and
   the information panel. */

import type { Drawing, Entity } from '../drawing.ts';
import type { PrjResult } from './compute.ts';

const LAYERS = [
  { name: 'PRJ-01-画面', aci: 7, rgb: '#FFFFFF' },
  { name: 'PRJ-02-投影覆盖', aci: 3, rgb: '#3FBF6A' },
  { name: 'PRJ-03-融合带', aci: 6, rgb: '#C77DE8' },
  { name: 'PRJ-06-标注', aci: 4, rgb: '#3FC7D4' },
  { name: 'PRJ-07-文字', aci: 7, rgb: '#FFFFFF' },
] as const;
type Name = (typeof LAYERS)[number]['name'];

/* Raster positions: evenly spread so the outer edges meet the image edges; a
   single projector is centred (pillar- or letter-boxed). */
export function rasters(W: number, H: number, n: number, w: number, h: number) {
  const step = n > 1 ? (W - w) / (n - 1) : 0;
  const x0 = n > 1 ? 0 : (W - w) / 2;
  return Array.from({ length: n }, (_, i) => ({ x: x0 + i * step, y: (H - h) / 2, w, h }));
}

export function buildPrjDrawing(r: PrjResult, meta: { project: string }): Drawing | null {
  if (!r.ok) return null;
  const t = r.trace;
  const W = t.W.value, H = t.H.value, n = t.n_proj.value, w = t.w_proj.value, h = t.h_proj.value;
  const lay = new Map<Name, Entity[]>(LAYERS.map((l) => [l.name, []]));
  const put = (k: Name, ...e: Entity[]) => { lay.get(k)!.push(...e); };
  const txt = (x: number, y: number, s: string, hgt = 90, anchor: 'start' | 'middle' | 'end' = 'middle'): Entity => ({ k: 'text', x, y, h: hgt, s, anchor });

  put('PRJ-01-画面', { k: 'rect', x: 0, y: 0, w: W, h: H });
  const rs = rasters(W, H, n, w, h);
  rs.forEach((q, i) => {
    put('PRJ-02-投影覆盖', { k: 'rect', x: q.x, y: q.y, w: q.w, h: q.h },
      txt(q.x + q.w / 2, H / 2 + (i % 2 ? -140 : 140), `投影机 ${i + 1} · ${Math.round(t.lm_proj.value).toLocaleString('en-US')} lm`));
  });
  for (let i = 0; i + 1 < rs.length; i++) {
    const a = Math.max(0, rs[i + 1].x), b = Math.min(W, rs[i].x + rs[i].w);
    if (b > a) {
      put('PRJ-03-融合带', { k: 'rect', x: a, y: 0, w: b - a, h: H }, txt((a + b) / 2, -150, `融合 ${Math.round(b - a)}`, 80));
    }
  }
  put('PRJ-06-标注',
    { k: 'line', x1: 0, y1: H + 260, x2: W, y2: H + 260 }, txt(W / 2, H + 350, String(W), 110),
    { k: 'line', x1: W + 400, y1: 0, x2: W + 400, y2: H }, txt(W + 520, H / 2, String(H), 110, 'start'));

  const info = [
    `项目：${meta.project}`,
    `画面 ${W} × ${H} mm   ${t.area.value.toFixed(2)} ㎡   投影机 ${n} 台（${r.profile.label}）`,
    `单机需 ${Math.round(t.lm_proj.value).toLocaleString('en-US')} lm · 投射比 ${t.throw_ratio.value.toFixed(2)} · 投射距离 ${r.cfg.prj_throw_dist} m`,
    `有效分辨率 ${t.px_w.value} × ${t.px_h.value} · 屏面照度 ${Math.round(t.e_req.value)} lx · 功耗 ${t.kw.value.toFixed(2)} kW / ${t.n_circuit.value} 回路`,
    `规则包 ${r.pack.version}   内容类别 ${r.pack.content[r.cfg.prj_content].label}`,
    '本图为方案阶段示意，投影机位置、镜头与融合带需现场复核后方可施工。',
  ];
  if (!r.pack.calibrated) info.push('草图 · 投影规则包为草案，不得用于正式报价或施工。');
  info.forEach((s, i) => put('PRJ-07-文字', txt(0, -500 - i * 160, s, 100, 'start')));

  const layers = LAYERS.map((l) => ({ ...l, entities: lay.get(l.name)! }));
  let minX = 0, minY = 0, maxX = 0, maxY = 0;
  for (const l of layers) for (const e of l.entities) {
    const pts: [number, number][] = e.k === 'line' ? [[e.x1, e.y1], [e.x2, e.y2]]
      : e.k === 'rect' ? [[e.x, e.y], [e.x + e.w, e.y + e.h]]
      : e.k === 'circle' ? [[e.cx - e.r, e.cy - e.r], [e.cx + e.r, e.cy + e.r]]
      : [[e.x, e.y - e.h], [e.x + (e.anchor === 'start' ? e.s.length * e.h * 0.62 : 0), e.y + e.h]];
    for (const [x, y] of pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  }
  return { title: meta.project, bbox: { minX, minY, maxX, maxY }, layers };
}
