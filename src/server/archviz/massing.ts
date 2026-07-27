/* ===== Seeded building massing — server-authoritative version of the logic
   validated in this session's design-draft artifact. Used ONLY by the stub
   renderer (stubRender.ts): once a real DCC render node reports real
   geometry (Phase 2), this generator is bypassed entirely for that model. */

import type { Vec3 } from './geometry';

export interface MassingBox { cx: number; cz: number; w: number; d: number; h: number }
export interface Massing { boxes: MassingBox[]; mainHeight: number }

export function buildMassing(rnd: () => number, floors: number): Massing {
  const floorH = 1.35;
  const mainH = Math.max(4, floors * floorH);
  const mainW = 8 + rnd() * 7, mainD = 8 + rnd() * 7;
  const boxes: MassingBox[] = [{ cx: 0, cz: 0, w: mainW, d: mainD, h: mainH }];
  const wings = 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < wings; i++) {
    const side = rnd() < 0.5 ? -1 : 1;
    const w = 5 + rnd() * 6, d = 5 + rnd() * 6, h = mainH * (0.3 + rnd() * 0.35);
    boxes.push({ cx: side * (mainW / 2 + w / 2 + 0.6 + rnd() * 1.6), cz: (rnd() - 0.5) * mainD * 0.6, w, d, h });
  }
  return { boxes, mainHeight: mainH };
}

export function boxCorners(b: MassingBox) {
  const x0 = b.cx - b.w / 2, x1 = b.cx + b.w / 2, z0 = b.cz - b.d / 2, z1 = b.cz + b.d / 2;
  return {
    bl: [x0, 0, z0] as Vec3, br: [x1, 0, z0] as Vec3, tl: [x0, b.h, z0] as Vec3, tr: [x1, b.h, z0] as Vec3,
    bl2: [x0, 0, z1] as Vec3, br2: [x1, 0, z1] as Vec3, tl2: [x0, b.h, z1] as Vec3, tr2: [x1, b.h, z1] as Vec3,
  };
}

export interface Face { key: string; pts: [Vec3, Vec3, Vec3, Vec3]; normal: Vec3 }

export function boxFaces(b: MassingBox): Face[] {
  const c = boxCorners(b);
  return [
    { key: 'front', pts: [c.bl, c.br, c.tr, c.tl], normal: [0, 0, -1] },
    { key: 'back', pts: [c.br2, c.bl2, c.tl2, c.tr2], normal: [0, 0, 1] },
    { key: 'left', pts: [c.bl2, c.bl, c.tl, c.tl2], normal: [-1, 0, 0] },
    { key: 'right', pts: [c.br, c.br2, c.tr2, c.tr], normal: [1, 0, 0] },
    { key: 'top', pts: [c.tl, c.tr, c.tr2, c.tl2], normal: [0, 1, 0] },
  ];
}
