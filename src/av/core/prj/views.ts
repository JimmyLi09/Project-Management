/* ===== Projection · four views + DXF (AV-020 §3.4) =====
   ① 平面机位图  ② 展开立面 · 融合区  ③ 剖面 · 遮挡检查  ④ 系统示意图.
   Same drawing model as LED (§8.2: mm, Y up), so toSvg() draws them on 05 and
   the Python service writes ①–③ into one DXF, one layer per kind of element.
   Labels are laid out by measured text width and moved apart by the same
   collision pass as the LED drawing (AV-019 §2.1). The prototype's plan(),
   elev(), sect() and sch() are the reference. */

import { bboxOf, resolveCollisions, wrapText, type Drawing, type Entity } from '../drawing.ts';
import { textWidth } from '../textfit.ts';
import { prjCalcBasis } from './calc.ts';
import type { PrjGroupResult, PrjGroupsResult } from './groups.ts';
import { prjSystem } from './system.ts';

export const PRJ_LAYERS = [
  { name: 'PRJ-01-投影面', aci: 7, rgb: '#E8E2D6' },
  { name: 'PRJ-02-机位', aci: 5, rgb: '#4FB3FF' },
  { name: 'PRJ-03-投射锥', aci: 4, rgb: '#3FC7D4' },
  { name: 'PRJ-04-融合区', aci: 6, rgb: '#C77DE8' },
  { name: 'PRJ-05-尺寸', aci: 2, rgb: '#F2C230' },
  { name: 'PRJ-06-遮挡检查', aci: 3, rgb: '#5AD18F' },
  { name: 'PRJ-07-文字', aci: 7, rgb: '#FFFFFF' },
  { name: 'PRJ-08-系统', aci: 8, rgb: '#CFD3DA' },
] as const;
export type PrjLayer = (typeof PRJ_LAYERS)[number]['name'];

export type PrjView = 'plan' | 'elev' | 'sect' | 'sch';
export const PRJ_VIEWS: { key: PrjView; zh: string; en: string; noteZh: string; noteEn: string }[] = [
  { key: 'plan', zh: '平面机位图', en: 'Plan', noteZh: '俯视；投射锥到画面左右边，可拖动机位改投射距离', noteEn: 'Top view; cones run to the image edges — drag a projector to change the throw' },
  { key: 'elev', zh: '展开立面 · 融合区', en: 'Unfolded elevation', noteZh: '各面展开成一条；色框 = 每台画面，斜线 = 融合带', noteEn: 'Faces unfolded into one strip; outlines = each image, hatching = blend bands' },
  { key: 'sect', zh: '剖面 · 遮挡检查', en: 'Section', noteZh: '每组一张；红色 = 光线低于人头会挡光，可拖动机位改投射距离和离地高度', noteEn: 'One per group; red = the ray is below head height — drag the projector to change throw and height' },
  { key: 'sch', zh: '系统示意图', en: 'Schematic', noteZh: '信号与控制连接', noteEn: 'Signal and control connections' },
];

/* 每台投影机一色(画面框、投射锥、编号) */
export const PRJ_COLORS = ['#4FB3FF', '#F5B83D', '#5AD18F', '#FF7A59', '#B48CFF', '#36C5F0', '#FF5FA2', '#E3E36A', '#7FD6D6'];
const RED = '#FF6B6B';
const GREEN = '#5AD18F';

/* 拖动机位用:模型坐标(mm)里的把手 */
export type PrjHandle =
  | { kind: 'plan'; gi: number; x: number; y: number; wx: number; wy: number; nx: number; ny: number }   // drag along the normal → throw
  | { kind: 'sect'; gi: number; x: number; y: number; wallX: number; floor: boolean };                  // drag → throw (x) and lens height (y)

export interface PrjViewOut { drawing: Drawing; handles: PrjHandle[] }

type Lang = 'zh' | 'en';
type Text = Extract<Entity, { k: 'text' }>;

/* one view under construction: layers, the labels the collision pass may move, and the drag handles */
class Sheet {
  lay = new Map<PrjLayer, Entity[]>(PRJ_LAYERS.map((l) => [l.name, []]));
  placed: { e: Text; movable: boolean }[] = [];
  handles: PrjHandle[] = [];
  fs: number;
  constructor(fs: number) { this.fs = fs; }
  put(name: PrjLayer, ...e: Entity[]) { this.lay.get(name)!.push(...e); }
  text(name: PrjLayer, x: number, y: number, s: string, o: { h?: number; anchor?: Text['anchor']; c?: string; bold?: boolean; fixed?: boolean } = {}) {
    const e: Text = { k: 'text', x, y, h: o.h ?? this.fs, s, anchor: o.anchor ?? 'start', ...(o.c ? { c: o.c } : {}), ...(o.bold ? { bold: true } : {}) };
    this.put(name, e);
    this.placed.push({ e, movable: !o.fixed });
    return e;
  }
  line(name: PrjLayer, x1: number, y1: number, x2: number, y2: number, c?: string, sw?: number) {
    this.put(name, { k: 'line', x1, y1, x2, y2, ...(c ? { c } : {}), ...(sw ? { sw } : {}) });
  }
  done(title: string): PrjViewOut {
    resolveCollisions(this.placed, this.fs * 0.2);
    const layers = PRJ_LAYERS.map((l) => ({ ...l, entities: this.lay.get(l.name)! }));
    return { drawing: { title, bbox: bboxOf(layers), layers }, handles: this.handles };
  }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const f2 = (x: number) => x.toFixed(2);
const mm = (m: number) => Math.round(m * 1000);
const T = (lang: Lang) => (zh: string, en: string) => (lang === 'en' ? en : zh);
/* projector numbers run on across groups: P1…Pn */
const firstNo = (r: PrjGroupsResult, gi: number) => r.groups.slice(0, gi).reduce((a, g) => a + g.n, 0) + 1;
/* image positions along the unfolded width (mm): outer edges meet the ends; one projector is centred */
function imageXs(g: PrjGroupResult): number[] {
  const L = g.L * 1000, w = g.w * 1000;
  const step = g.n > 1 ? (L - w) / (g.n - 1) : 0;
  return Array.from({ length: g.n }, (_, i) => (g.n > 1 ? i * step : (L - w) / 2));
}
const manTag = (g: PrjGroupResult, t: ReturnType<typeof T>) => (g.manual ? t(' · 人工调整', ' · adjusted by hand') : '');

/* ① 平面机位图:墙按转角连成一条折线(第一组最宽的面放水平),投影机在墙的法线方向上
   离墙一个投射距离,投射锥连到它画面的两端;地面组画在下方 */
export function buildPrjPlan(r: PrjGroupsResult, lang: Lang = 'zh'): PrjViewOut {
  const t = T(lang);
  const walls = r.groups.map((g, gi) => ({ g, gi })).filter((x) => !x.g.floor);
  const span = Math.max(4000, ...r.groups.map((g) => g.L * 1000));
  const s = new Sheet(clamp(span / 55, 110, 320));
  const fs = s.fs;
  /* start angle: the widest face of the first wall group lies horizontal */
  let a = 0;
  if (walls.length) {
    const faces = walls[0].g.group.faces;
    let acc = 0, best = -1, bestTurn = 0;
    faces.forEach((f) => { acc += f.turn; if (f.w > best) { best = f.w; bestTurn = acc; } });
    a = -bestTurn;
  }
  let ox = 0, oy = 0;
  let wallMinY = 0;
  for (const { g, gi } of walls) {
    /* the chain of faces, in model space (Y up): direction (cos, −sin), room side (−sin, −cos) */
    const segs = g.group.faces.map((f) => {
      a += f.turn;
      const r0 = (a * Math.PI) / 180;
      const dx = Math.cos(r0), dy = -Math.sin(r0);
      const seg = { x1: ox, y1: oy, x2: ox + dx * f.w, y2: oy + dy * f.w, L: f.w, dx, dy, nx: -Math.sin(r0), ny: -Math.cos(r0) };
      ox = seg.x2; oy = seg.y2;
      return seg;
    });
    const at = (u: number) => {
      let acc = 0;
      for (const sg of segs) {
        if (u <= acc + sg.L + 1e-6) { const k = u - acc; return { x: sg.x1 + sg.dx * k, y: sg.y1 + sg.dy * k, sg }; }
        acc += sg.L;
      }
      const sg = segs[segs.length - 1];
      return { x: sg.x2, y: sg.y2, sg };
    };
    /* walls + face widths outside the room */
    segs.forEach((sg) => {
      s.line('PRJ-01-投影面', sg.x1, sg.y1, sg.x2, sg.y2, undefined, 60);
      const mx = (sg.x1 + sg.x2) / 2 - sg.nx * fs * 1.1, my = (sg.y1 + sg.y2) / 2 - sg.ny * fs * 1.1;
      s.text('PRJ-05-尺寸', mx, my - fs * 0.35, String(sg.L), { anchor: anchorFor(-sg.nx), h: fs * 0.85 });
      wallMinY = Math.min(wallMinY, sg.y1, sg.y2);
    });
    const L = g.L * 1000, w = g.w * 1000, d = g.d * 1000;
    const no = firstNo(r, gi);
    imageXs(g).forEach((x0, i) => {
      const col = PRJ_COLORS[(no - 1 + i) % PRJ_COLORS.length];
      const c = at(x0 + w / 2), A = at(Math.max(0, x0)), B = at(Math.min(L, x0 + w));
      const px = c.x + c.sg.nx * d, py = c.y + c.sg.ny * d;
      s.line('PRJ-03-投射锥', px, py, A.x, A.y, col, 14);
      s.line('PRJ-03-投射锥', px, py, B.x, B.y, col, 14);
      /* projector body: a box turned to face its wall */
      const hw = fs * 1.3, hd = fs * 0.9, { dx, dy, nx, ny } = c.sg;
      const k = [[-hw, 0], [hw, 0], [hw, hd * 2], [-hw, hd * 2]].map(([u, v]) => [px + dx * u + nx * v, py + dy * u + ny * v]);
      for (let j = 0; j < 4; j++) s.line('PRJ-02-机位', k[j][0], k[j][1], k[(j + 1) % 4][0], k[(j + 1) % 4][1], col, 24);
      const lx = px + nx * (hd * 2 + fs * 1.4), ly = py + ny * (hd * 2 + fs * 1.4);
      s.text('PRJ-02-机位', lx, ly - fs * 0.35, `P${no + i}`, { anchor: 'middle', c: col, bold: true });
      wallMinY = Math.min(wallMinY, ly - fs);
      if (i === 0) s.handles.push({ kind: 'plan', gi, x: px, y: py, wx: c.x, wy: c.y, nx, ny });
    });
    /* group label beyond the face-width figures */
    const mid = at(L / 2);
    s.text('PRJ-07-文字', mid.x - mid.sg.nx * fs * 2.8, mid.y - mid.sg.ny * fs * 2.8 - fs * 0.35,
      `${g.group.name} · ${mm(g.L)} mm · ${t('投射', 'throw')} ${f2(g.d)} m${manTag(g, t)}`, { anchor: anchorFor(-mid.sg.nx), c: '#9AA3AD' });
  }
  /* floor groups below the walls, seen from above: the area and each image */
  let fx = 0;
  const fy = (walls.length ? wallMinY : 0) - fs * 4;
  r.groups.forEach((g, gi) => {
    if (!g.floor) return;
    const L = g.L * 1000, H = g.H * 1000, w = g.w * 1000, h = Math.min(g.h * 1000, H);
    const no = firstNo(r, gi);
    s.put('PRJ-01-投影面', { k: 'rect', x: fx, y: fy - H, w: L, h: H, sw: 40 });
    imageXs(g).forEach((x0, i) => {
      const col = PRJ_COLORS[(no - 1 + i) % PRJ_COLORS.length];
      s.put('PRJ-03-投射锥', { k: 'rect', x: fx + x0, y: fy - H + (H - h) / 2, w, h, c: col });
      s.put('PRJ-02-机位', { k: 'rect', x: fx + x0 + w / 2 - fs * 1.3, y: fy - H / 2 - fs * 0.9, w: fs * 2.6, h: fs * 1.8, c: col, fill: `${col}55` });
      s.text('PRJ-02-机位', fx + x0 + w / 2, fy - H / 2 - fs * 2.4, `P${no + i}`, { anchor: 'middle', c: col, bold: true });
    });
    s.text('PRJ-07-文字', fx, fy + fs * 0.8, `${g.group.name} · ${t('吊顶俯投', 'hung facing down')} · ${mm(g.L)} × ${mm(g.H)} mm · ${t('吊装', 'hung at')} ${f2(g.lensH)} m${manTag(g, t)}`, { c: '#9AA3AD' });
    fx += L + fs * 6;
  });
  return s.done(t('平面机位图', 'Plan'));
}

/* label anchored away from its wall: outward to the left → end, to the right → start */
const anchorFor = (outX: number): Text['anchor'] => (outX < -0.5 ? 'end' : outX > 0.5 ? 'start' : 'middle');

/* ② 展开立面:每组一条,各面展开排开;每台画面一个色框,相邻画面重叠处画斜线 = 融合带 */
export function buildPrjElev(r: PrjGroupsResult, lang: Lang = 'zh'): PrjViewOut {
  const t = T(lang);
  const span = Math.max(4000, ...r.groups.map((g) => g.L * 1000));
  const s = new Sheet(clamp(span / 60, 100, 300));
  const fs = s.fs;
  let top = 0;
  r.groups.forEach((g, gi) => {
    const L = g.L * 1000, H = g.H * 1000, w = g.w * 1000, hc = Math.min(g.h * 1000, H);
    const no = firstNo(r, gi);
    s.text('PRJ-07-文字', 0, top + fs * 2.3,
      `${g.group.name}${g.floor ? t('（地面）', ' (floor)') : ''} · ${t(`${g.n} 台`, `${g.n} projector${g.n > 1 ? 's' : ''}`)} · ${t('单台', 'each')} ${mm(g.w)} × ${mm(g.h)} · ${t('融合带', 'blend')} ${g.n > 1 ? `${mm(g.blend)} mm` : '—'}`,
      { bold: true, fixed: true });
    /* faces, corners and the width of each face above it */
    let acc = 0;
    g.group.faces.forEach((f, fi) => {
      s.put('PRJ-01-投影面', { k: 'rect', x: acc, y: top - H, w: f.w, h: H, sw: 30 });
      s.line('PRJ-05-尺寸', acc, top + fs * 0.2, acc, top + fs * 1.1);
      s.text('PRJ-05-尺寸', acc + f.w / 2, top + fs * 0.45, String(f.w), { anchor: 'middle', h: fs * 0.85 });
      if (fi > 0 && !g.floor) {
        s.line('PRJ-05-尺寸', acc, top - H - fs * 0.3, acc, top + fs * 0.2, '#FFD166', 18);
        s.text('PRJ-05-尺寸', acc + fs * 0.3, top - H - fs * 1.3, `${t('转角', 'turn')} ${f.turn}°`, { c: '#FFD166', h: fs * 0.8 });
      }
      acc += f.w;
    });
    s.line('PRJ-05-尺寸', L, top + fs * 0.2, L, top + fs * 1.1);
    /* images (top-aligned, as hung) and blend bands */
    const xs = imageXs(g);
    xs.forEach((x0, i) => {
      const col = PRJ_COLORS[(no - 1 + i) % PRJ_COLORS.length];
      s.put('PRJ-02-机位', { k: 'rect', x: x0, y: top - hc, w, h: hc, c: col, sw: 22 });
      s.text('PRJ-02-机位', x0 + w / 2, top - fs * 1.4, `P${no + i}`, { anchor: 'middle', c: col, bold: true });
      if (i > 0) hatch(s, x0, top - H, xs[i - 1] + w - x0, H, fs * 0.9);
    });
    /* overall size below */
    s.text('PRJ-05-尺寸', L / 2, top - H - fs * 2.7, `${mm(g.L)} × ${mm(g.H)} mm`, { anchor: 'middle' });
    top -= H + fs * 6.5;
  });
  return s.done(t('展开立面 · 融合区', 'Unfolded elevation'));
}

/* 45° hatching clipped to a rectangle */
function hatch(s: Sheet, x: number, y: number, w: number, h: number, gap: number) {
  if (w <= 0) return;
  for (let k = gap; k < w + h; k += gap) {
    /* line x − x0 + (y − y0) = k inside the box */
    const x1 = x + Math.max(0, k - h), y1 = y + Math.min(h, k);
    const x2 = x + Math.min(w, k), y2 = y + Math.max(0, k - w);
    s.line('PRJ-04-融合区', x1, y1, x2, y2, undefined, 10);
  }
  s.put('PRJ-04-融合区', { k: 'rect', x, y, w, h, sw: 14 });
}

/* ③ 剖面:每组一张。天花、墙、画面、吊装的投影机、投射光线;最近观众和人头高,
   光线低于人头标红。地面组画吊顶向下投 */
export function buildPrjSection(r: PrjGroupsResult, lang: Lang = 'zh'): PrjViewOut {
  const t = T(lang);
  const C = r.cfg.prj_ceiling * 1000;
  const head = r.pack.constants.head.value * 1000;
  const near = r.cfg.prj_view_near * 1000;
  const s = new Sheet(clamp(C / 24, 100, 220));
  const fs = s.fs;
  let x0 = 0;
  r.groups.forEach((g, gi) => {
    const d = g.d * 1000, lensH = g.lensH * 1000, w = g.w * 1000;
    const col = PRJ_COLORS[(firstNo(r, gi) - 1) % PRJ_COLORS.length];
    const box = (cx: number, cy: number) => s.put('PRJ-02-机位', { k: 'rect', x: cx - fs * 2, y: cy - fs * 0.9, w: fs * 4, h: fs * 1.8, c: col, fill: `${col}55` });
    if (g.floor) {
      const right = x0 + w + fs * 4;
      s.line('PRJ-01-投影面', x0, 0, right, 0, undefined, 40);
      s.line('PRJ-01-投影面', x0, C, right, C, undefined, 40);
      const cx = x0 + fs * 2 + w / 2;
      s.line('PRJ-01-投影面', cx - w / 2, 30, cx + w / 2, 30, col, 80);
      s.line('PRJ-02-机位', cx, C, cx, lensH + fs * 0.9, '#888888', 16);
      box(cx, lensH);
      s.line('PRJ-03-投射锥', cx, lensH, cx - w / 2, 0, col, 14);
      s.line('PRJ-03-投射锥', cx, lensH, cx + w / 2, 0, col, 14);
      s.handles.push({ kind: 'sect', gi, x: cx, y: lensH, wallX: cx, floor: true });
      s.text('PRJ-07-文字', x0, C + fs * 1.4, `${g.group.name} · ${t('吊顶俯投', 'hung facing down')} · ${t('天花', 'ceiling')} ${r.cfg.prj_ceiling} m · ${t('吊装', 'hung at')} ${f2(g.lensH)} m${manTag(g, t)}`, { bold: true, fixed: true });
      dimH(s, cx - w / 2, cx + w / 2, -fs * 1.6, `${t('画面', 'image')} ${mm(g.w)} mm`);
      if (g.shadow) s.text('PRJ-06-遮挡检查', cx, fs * 1.2, t('地面互动会有人影', 'Floor interaction casts shadows'), { anchor: 'middle', c: RED });
      x0 = right + fs * 6;
      return;
    }
    const D = Math.max(d, near) + Math.max(1200, fs * 8);
    const wallX = x0 + D;
    const bot = g.group.bottom * 1000, top = Math.min(bot + g.h * 1000, C);
    s.line('PRJ-01-投影面', x0, 0, wallX + 300, 0, undefined, 40);
    s.line('PRJ-01-投影面', x0, C, wallX + 300, C, undefined, 40);
    s.line('PRJ-01-投影面', wallX, 0, wallX, C, undefined, 60);
    s.line('PRJ-01-投影面', wallX - 40, bot, wallX - 40, top, col, 90);
    const px = wallX - d;
    s.line('PRJ-02-机位', px, C, px, lensH + fs * 0.9, '#888888', 16);
    box(px, lensH);
    s.line('PRJ-03-投射锥', px, lensH, wallX, top, col, 14);
    s.line('PRJ-03-投射锥', px, lensH, wallX, bot, col, 14);
    s.handles.push({ kind: 'sect', gi, x: px, y: lensH, wallX, floor: false });
    if (near > 0) {
      const hx = wallX - near, c = g.shadow ? RED : GREEN;
      s.line('PRJ-06-遮挡检查', hx, 0, hx, head - fs * 0.8, c, 40);
      s.put('PRJ-06-遮挡检查', { k: 'circle', cx: hx, cy: head - fs * 0.4, r: fs * 0.4, c, fill: c });
      s.line('PRJ-06-遮挡检查', hx - fs * 1.2, head, hx + fs * 1.2, head, c, 12);
      s.text('PRJ-06-遮挡检查', hx + fs * 1.5, head - fs * 0.3, `${t('人头', 'head')} ${r.pack.constants.head.value} m`, { c, h: fs * 0.8 });
      if (g.shadowY != null) {
        s.put('PRJ-06-遮挡检查', { k: 'circle', cx: hx, cy: g.shadowY * 1000, r: fs * 0.25, c: '#FFFFFF', fill: '#FFFFFF' });
        s.text('PRJ-06-遮挡检查', hx - fs * 0.6, g.shadowY * 1000 - fs * 0.3, `${t('光线', 'ray')} ${f2(g.shadowY)} m`, { anchor: 'end', c, h: fs * 0.85 });
      }
    }
    s.text('PRJ-07-文字', x0, C + fs * 1.4,
      `${g.group.name} · ${t('天花', 'ceiling')} ${r.cfg.prj_ceiling} m · ${t('镜头离地', 'lens at')} ${f2(g.lensH)} m · ${t('投射', 'throw')} ${f2(g.d)} m${manTag(g, t)}`, { bold: true, fixed: true });
    const imgLabel = `${t('画面', 'image')} ${f2(g.group.bottom)}–${f2(top / 1000)} m`;
    s.text('PRJ-01-投影面', wallX + fs * 0.6, (bot + top) / 2 - fs * 0.35, imgLabel, { c: col, h: fs * 0.85 });
    dimH(s, px, wallX, -fs * 1.6, `${t('投射', 'throw')} ${f2(g.d)} m`);
    dimV(s, px - fs * 3, 0, lensH, `${f2(g.lensH)} m`);
    x0 = wallX + fs * 0.6 + textWidth(imgLabel, fs * 0.85) + fs * 4;
  });
  return s.done(t('剖面 · 遮挡检查', 'Section'));
}

function dimH(s: Sheet, xa: number, xb: number, y: number, label: string) {
  const fs = s.fs;
  s.line('PRJ-05-尺寸', xa, y, xb, y);
  s.line('PRJ-05-尺寸', xa, y - fs * 0.4, xa, y + fs * 0.4);
  s.line('PRJ-05-尺寸', xb, y - fs * 0.4, xb, y + fs * 0.4);
  s.text('PRJ-05-尺寸', (xa + xb) / 2, y - fs * 1.3, label, { anchor: 'middle', h: fs * 0.85 });
}
function dimV(s: Sheet, x: number, ya: number, yb: number, label: string) {
  const fs = s.fs;
  s.line('PRJ-05-尺寸', x, ya, x, yb);
  s.line('PRJ-05-尺寸', x - fs * 0.4, ya, x + fs * 0.4, ya);
  s.line('PRJ-05-尺寸', x - fs * 0.4, yb, x + fs * 0.4, yb);
  s.text('PRJ-05-尺寸', x - fs * 0.5, (ya + yb) / 2 - fs * 0.3, label, { anchor: 'end', h: fs * 0.85 });
}

/* ④ 系统示意图:PC 主机 → 融合软件 → 多屏宝 → HDMI 光纤线 → 各投影机;交换机 / 中控连所有设备;
   有互动时雷达 → 交换机 → PC(CJ-Sync 交互)。按原型的版式,单位 mm,Y 向下画完再翻过来 */
export function buildPrjSchematic(r: PrjGroupsResult, lang: Lang = 'zh'): PrjViewOut {
  const t = T(lang);
  const sys = prjSystem(r);
  const s = new Sheet(160);
  const Y = (y: number) => -y;
  const box = (x: number, y: number, w: number, h: number, label: string, c: string, sub = '') => {
    s.put('PRJ-08-系统', { k: 'rect', x, y: Y(y + h), w, h, c, sw: 22 });
    s.text('PRJ-08-系统', x + w / 2, Y(y + h / 2 + (sub ? -10 : 70)), label, { anchor: 'middle', h: 190, c, fixed: true });
    if (sub) s.text('PRJ-08-系统', x + w / 2, Y(y + h / 2 + 200), sub, { anchor: 'middle', h: 130, c: '#8B8F99', fixed: true });
  };
  const wire = (x1: number, y1: number, x2: number, y2: number, c = '#8B8F99') => {
    const mx = (x1 + x2) / 2;
    s.line('PRJ-08-系统', x1, Y(y1), mx, Y(y1), c, 18);
    s.line('PRJ-08-系统', mx, Y(y1), mx, Y(y2), c, 18);
    s.line('PRJ-08-系统', mx, Y(y2), x2, Y(y2), c, 18);
  };
  const model = (g: PrjGroupResult) => g.projector.name.split(' ').pop() ?? g.projector.name;
  let y = 300;
  r.groups.forEach((g, gi) => {
    const no = firstNo(r, gi);
    const h = Math.max(1000, g.n * 520);
    const cy = y + h / 2;
    box(0, cy - 300, 1500, 600, t('PC 主机', 'Media PC'), '#CFD3DA', g.group.name);
    if (g.n >= 2) {
      box(2000, cy - 300, 1700, 600, t('融合软件', 'Blending software'), GREEN, t('几何校正 / 融合', 'warp / blend'));
      wire(1500, cy, 2000, cy);
      const nb = sys.groups[gi].boxes;
      for (let b = 0; b < nb; b++) {
        const by = y + ((b + 0.5) * h) / nb;
        box(4200, by - 250, 1400, 500, t('多屏宝', 'Multi-output box'), '#F5B83D');
        wire(3700, cy, 4200, by);
      }
      for (let i = 0; i < g.n; i++) {
        const py = y + ((i + 0.5) * h) / g.n;
        const b = Math.min(nb - 1, Math.floor(i / r.pack.constants.boxPerSet.value));
        const by = y + ((b + 0.5) * h) / nb;
        wire(5600, by, 6400, py, '#4FB3FF');
        box(6400, py - 200, 2400, 400, `P${no + i} ${model(g)}`, '#4FB3FF');
      }
      s.text('PRJ-08-系统', 5650, Y(y - 60), t('HDMI 光纤线（> 50 m 用光纤延长）', 'HDMI fibre (fibre extender beyond 50 m)'), { h: 130, c: '#4FB3FF' });
    } else {
      wire(1500, cy, 6400, cy, '#4FB3FF');
      box(6400, cy - 200, 2400, 400, `P${no} ${model(g)}`, '#4FB3FF');
    }
    y += h + 520;
  });
  const ny = y + 200;
  box(0, ny, 1500, 600, t('交换机', 'Network switch'), '#C77DFF', t('IP / 中控', 'IP / control'));
  box(2000, ny, 1700, 600, t('中控系统', 'Control system'), '#C77DFF', t('开关机', 'power on / off'));
  wire(1500, ny + 300, 2000, ny + 300, '#C77DFF');
  s.text('PRJ-08-系统', 3900, Y(ny + 350), t('网络 → 所有 PC / 投影机（RJ45）', 'Network → every PC and projector (RJ45)'), { h: 150, c: '#C77DFF' });
  if (r.cfg.prj_interact !== 'none') {
    const wall = r.cfg.prj_interact === 'wall';
    const n = sys.radars;
    box(0, ny + 900, 1500, 600, n == null ? t('雷达', 'Radar') : t(`雷达 × ${n}`, `Radar × ${n}`), '#FF7A59', wall ? t('墙面互动', 'wall interaction') : t('地面互动', 'floor interaction'));
    s.text('PRJ-08-系统', 1700, Y(ny + 1250), t('→ 交换机 → PC（CJ-Sync 交互）', '→ switch → PC (CJ-Sync interaction)'), { h: 150, c: '#FF7A59' });
  }
  return s.done(t('系统示意图', 'Schematic'));
}

export function buildPrjView(view: PrjView, r: PrjGroupsResult, lang: Lang = 'zh'): PrjViewOut | null {
  if (!r.ok) return null;
  return view === 'plan' ? buildPrjPlan(r, lang) : view === 'elev' ? buildPrjElev(r, lang) : view === 'sect' ? buildPrjSection(r, lang) : buildPrjSchematic(r, lang);
}

/* ⑤ DXF:①–③ 左右排开(顶对齐),各元素按种类分图层;右侧说明栏 = 计算依据(和 05、技术方案同一份)
   + 检查结果 + 「部分常数待校准」 */
export function buildPrjDxf(r: PrjGroupsResult, meta: { project: string; lang?: Lang }): Drawing | null {
  if (!r.ok) return null;
  const lang = meta.lang ?? 'zh';
  const t = T(lang);
  const views = [buildPrjPlan(r, lang), buildPrjElev(r, lang), buildPrjSection(r, lang)].map((v) => v.drawing);
  const fs = Math.max(...views.map((d) => (d.bbox.maxX - d.bbox.minX) / 60), 150);
  const lay = new Map<string, Entity[]>(PRJ_LAYERS.map((l) => [l.name, []]));
  let cx = 0;
  const shift = (e: Entity, dx: number, dy: number): Entity => {
    switch (e.k) {
      case 'line': return { ...e, x1: e.x1 + dx, y1: e.y1 + dy, x2: e.x2 + dx, y2: e.y2 + dy };
      case 'rect': return { ...e, x: e.x + dx, y: e.y + dy };
      case 'circle': return { ...e, cx: e.cx + dx, cy: e.cy + dy };
      case 'text': return { ...e, x: e.x + dx, y: e.y + dy };
    }
  };
  for (const d of views) {
    const dx = cx - d.bbox.minX, dy = -d.bbox.maxY;
    lay.get('PRJ-07-文字')!.push({ k: 'text', x: cx, y: fs * 2, h: fs * 1.3, s: d.title, anchor: 'start', bold: true });
    for (const l of d.layers) lay.get(l.name)!.push(...l.entities.map((e) => shift(e, dx, dy)));
    cx += d.bbox.maxX - d.bbox.minX + fs * 8;
  }
  /* notes column */
  const lines: { s: string; c?: string; bold?: boolean }[] = [];
  lines.push({ s: `${t('项目', 'Project')}：${meta.project}`, bold: true });
  lines.push({ s: `${t('规则包', 'Rule pack')} ${r.pack.version} · ${t(`投影机 ${r.nProj} 台 · ${r.groups.length} 组`, `${r.nProj} projectors · ${r.groups.length} groups`)}` });
  if (!r.pack.calibrated) lines.push({ s: t('部分常数待校准：数值为样本反推的初值，待 PD 确认。', 'Some constants not yet calibrated: initial values from finished projects, awaiting PD confirmation.'), c: RED });
  lines.push({ s: t('计算依据', 'Calculation basis'), bold: true });
  const calc = prjCalcBasis(r, lang);
  for (const row of calc.rows) {
    const cells = row.cells.map((c, i) => `${calc.groups.length > 1 ? `${calc.groups[i]} ` : ''}${c.text}`).join(' / ');
    lines.push({ s: `${row.item}：${cells}`, c: row.cells.some((c) => c.ok === false && !c.warn) ? RED : undefined });
  }
  lines.push({ s: calc.total });
  const issues = r.findings.filter((f) => f.severity !== 'info');
  if (issues.length) {
    lines.push({ s: t('检查结果', 'Checks'), bold: true });
    for (const f of issues) lines.push({ s: `${f.severity === 'block' ? '✕' : '!'} ${f.code} ${lang === 'en' ? f.messageEn ?? f.message : f.message}`, c: f.severity === 'block' ? RED : '#F5B83D' });
  }
  lines.push({ s: t('本图为方案阶段示意，机位、镜头与融合带需现场复核后方可施工。', 'Design-stage drawing: projector positions, lenses and blend bands must be verified on site before installation.') });
  const h = fs * 0.9;
  const maxW = h * 48;
  let y = 0;
  for (const l of lines) for (const [i, seg] of wrapText(l.s, h, maxW).entries()) {
    y -= h * 1.5;
    lay.get('PRJ-07-文字')!.push({ k: 'text', x: cx, y, h, s: i ? `  ${seg}` : seg, anchor: 'start', ...(l.c ? { c: l.c } : {}), ...(l.bold ? { bold: true } : {}) });
  }
  /* the schematic is a diagram, not geometry — it stays out of the DXF (§3.4 ⑤: views ①–③) */
  const layers = PRJ_LAYERS.filter((l) => l.name !== 'PRJ-08-系统').map((l) => ({ ...l, entities: lay.get(l.name)! }));
  return { title: meta.project, bbox: bboxOf(layers), layers };
}
