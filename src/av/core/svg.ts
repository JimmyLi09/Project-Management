/* ===== §8.2 SVG renderer =====
   The same drawing model the DXF renderer consumes, so both carry identical
   group names ("元素按同一套分组命名，供非 CAD 用户编辑").

   Model space is Y-up with the origin at the screen's bottom-left; SVG is
   Y-down. Coordinates are flipped per entity rather than by a group transform,
   because a scale(1,-1) on the group would mirror every label. */

import type { Drawing, Entity } from './drawing.ts';

export const PAD = 400; // mm of margin around the drawing extents

export interface SvgOptions {
  /* Rendered size, px per mm. The default keeps a 5 m screen near 1200 px. */
  pxPerMm?: number;
  background?: string;
  /* AV-019:05 页「适应宽度」—— 宽度 100%,高度按比例,不再被面板裁掉右侧 */
  fit?: boolean;
}

export function toSvg(d: Drawing, opt: SvgOptions = {}): string {
  const w = d.bbox.maxX - d.bbox.minX + PAD * 2;
  const h = d.bbox.maxY - d.bbox.minY + PAD * 2;
  const k = opt.pxPerMm ?? 0.2;
  const bg = opt.background ?? '#0E1013';

  const X = (x: number) => round(x - d.bbox.minX + PAD);
  const Y = (y: number) => round(d.bbox.maxY + PAD - y);

  const out: string[] = [
    opt.fit
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="100%" preserveAspectRatio="xMinYMin meet" style="display:block;height:auto"`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="${round(w * k)}" height="${round(h * k)}"`,
    ` viewBox="0 0 ${round(w)} ${round(h)}" font-family="Arial, 'Microsoft YaHei', 'PingFang SC', Helvetica, sans-serif">`,
    `<title>${esc(d.title)}</title>`,
    `<rect width="${round(w)}" height="${round(h)}" fill="${bg}"/>`,
  ];

  for (const layer of d.layers) {
    if (!layer.entities.length) continue;
    out.push(`<g id="${esc(layer.name)}" data-aci="${layer.aci}" fill="none" stroke="${layer.rgb}" stroke-width="12">`);
    for (const e of layer.entities) out.push(entity(e, layer.rgb, X, Y));
    out.push('</g>');
  }
  out.push('</svg>');
  return out.join('');
}

function entity(e: Entity, rgb: string, X: (n: number) => number, Y: (n: number) => number): string {
  /* AV-019:图元自带颜色(回路 / 网线各一色)时覆盖图层色 */
  const st = (e.k !== 'text' && e.c) ? ` stroke="${e.c}"` : '';
  switch (e.k) {
    case 'line':
      return `<line x1="${X(e.x1)}" y1="${Y(e.y1)}" x2="${X(e.x2)}" y2="${Y(e.y2)}"${st}${e.sw ? ` stroke-width="${e.sw}"` : ''}/>`;
    case 'rect':
      return `<rect x="${X(e.x)}" y="${Y(e.y + e.h)}" width="${round(e.w)}" height="${round(e.h)}"${st}${e.sw ? ` stroke-width="${e.sw}"` : ''}${e.fill ? ` fill="${e.fill}"` : ''}/>`;
    case 'circle':
      return `<circle cx="${X(e.cx)}" cy="${Y(e.cy)}" r="${round(e.r)}"${st}${e.fill ? ` fill="${e.fill}"` : ''}/>`;
    case 'text':
      return `<text x="${X(e.x)}" y="${Y(e.y)}" font-size="${round(e.h)}" fill="${e.c ?? rgb}" stroke="none"`
        + `${e.bold ? ' font-weight="700"' : ''} text-anchor="${e.anchor}">${esc(e.s)}</text>`;
  }
}

const round = (n: number) => Math.round(n * 10) / 10;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
