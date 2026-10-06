/* ===== Projection · system devices (AV-020 §2「配置模板」, §3.4 ④) =====
   What each blend group needs around its projectors — PC, blending software,
   多屏宝, radars — by the company's rules. The schematic, the proposal and
   (next) the 06 cost rows all count from here, so they cannot disagree. */

import type { PrjGroupsResult } from './groups.ts';

export interface PrjSystemGroup {
  name: string;
  n: number;              // projectors
  blend: boolean;         // two or more → blending software + 多屏宝
  boxes: number;          // 多屏宝, one per boxPerSet projectors
  radars: number | null;  // wall interaction: one per radarWall m of wall; floor: sized by area, rule pending
}
export interface PrjSystem {
  groups: PrjSystemGroup[];
  projectors: number;
  pcs: number;            // one per blend group
  blends: number;
  boxes: number;
  radars: number | null;  // null while a floor-interaction count is pending
}

export function prjSystem(r: PrjGroupsResult): PrjSystem {
  const K = r.pack.constants;
  const it = r.cfg.prj_interact;
  const groups = r.groups.map((g): PrjSystemGroup => ({
    name: g.group.name,
    n: g.n,
    blend: g.n >= 2,
    boxes: g.n >= 2 ? Math.ceil(g.n / K.boxPerSet.value - 1e-9) : 0,
    radars: it === 'wall' && !g.floor ? Math.ceil(g.L / K.radarWall.value - 1e-9)
      : it === 'floor' && g.floor ? null : 0,
  }));
  const sum = (k: 'n' | 'boxes') => groups.reduce((a, g) => a + g[k], 0);
  return {
    groups,
    projectors: sum('n'),
    pcs: groups.length,
    blends: groups.filter((g) => g.blend).length,
    boxes: sum('boxes'),
    radars: groups.some((g) => g.radars === null) ? null : groups.reduce((a, g) => a + (g.radars ?? 0), 0),
  };
}
