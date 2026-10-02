/* ===== 文字实际宽度(AV-019 §2.1)=====
   以前用「字数 × 字高 × 0.62」估算,中文、窄字母都不准,标注一长就压到别的东西上。
   这里按 Arial 的字宽表(ASCII)和全角 1 em(中文、全角符号)来量 —— 线路图在浏览器和
   服务端用的是同一份代码,所以不依赖画布或字体文件。 */

/* Arial 字宽,单位 em(千分之一),从空格(32)到 ~(126) */
const ARIAL = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

export function charEm(ch: string): number {
  const c = ch.codePointAt(0) ?? 0;
  if (c >= 32 && c <= 126) return ARIAL[c - 32] / 1000;
  if (c === 0xd7 || c === 0xf7) return 0.584;               // × ÷
  if (c === 0xb7) return 0.278;                            // ·
  if (c >= 0x2010 && c <= 0x2027) return 0.6;              // 破折号、引号、省略号
  if (c >= 0x2190 && c <= 0x22ff) return 0.75;             // 箭头、数学符号 ≤ ≥ ✓
  if (c >= 0x2700 && c <= 0x27bf) return 0.8;              // ✓ ✕
  return 1;                                                // 中文、全角
}

export const textWidth = (s: string, h: number) => [...s].reduce((a, ch) => a + charEm(ch), 0) * h;

export interface Box { x0: number; y0: number; x1: number; y1: number }

/* 文字外框(模型空间,Y 向上;基线在 y,上沿约 0.8h、下沿约 0.25h) */
export function textBox(t: { x: number; y: number; h: number; s: string; anchor: 'start' | 'middle' | 'end' }): Box {
  const w = textWidth(t.s, t.h);
  const x0 = t.anchor === 'start' ? t.x : t.anchor === 'middle' ? t.x - w / 2 : t.x - w;
  return { x0, x1: x0 + w, y0: t.y - t.h * 0.25, y1: t.y + t.h * 0.85 };
}

export const overlap = (a: Box, b: Box, gap = 0) =>
  a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;

/* 线段和框相交吗(端点在框内也算) */
export function segHitsBox(x1: number, y1: number, x2: number, y2: number, b: Box): boolean {
  const inside = (x: number, y: number) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1;
  if (inside(x1, y1) || inside(x2, y2)) return true;
  const edges: [number, number, number, number][] = [
    [b.x0, b.y0, b.x1, b.y0], [b.x1, b.y0, b.x1, b.y1], [b.x1, b.y1, b.x0, b.y1], [b.x0, b.y1, b.x0, b.y0],
  ];
  return edges.some(([a, c, d, e]) => segCross(x1, y1, x2, y2, a, c, d, e));
}
function segCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  const o1 = o(ax, ay, bx, by, cx, cy), o2 = o(ax, ay, bx, by, dx, dy), o3 = o(cx, cy, dx, dy, ax, ay), o4 = o(cx, cy, dx, dy, bx, by);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}
