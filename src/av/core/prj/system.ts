/* ===== Projection · system devices (AV-020 §2「配置模板」, §3.4 ④) =====
   What each blend group needs around its projectors — PC, blending software,
   多屏宝, radars — by the company's rules. The schematic, the proposal and
   (next) the 06 cost rows all count from here, so they cannot disagree. */

import type { PrjSummary } from '../pricing.ts';
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

/* ===== the summary 05 saves for 06 (prj@0.2 and later) =====
   The prj@0.1 fields are kept filled so older readers still make sense of it;
   groups + system are what 06 builds the §3.6 rows from. */
export function prjSummaryOf(r: PrjGroupsResult): PrjSummary {
  const g0 = r.groups[0];
  const sys = prjSystem(r);
  return {
    width: Math.round(Math.max(...r.groups.map((g) => g.L)) * 1000), height: Math.round(Math.max(...r.groups.map((g) => g.H)) * 1000),
    area: r.groups.reduce((a, g) => a + g.L * g.H, 0), nProj: r.nProj, lmProj: Math.max(...r.groups.map((g) => g.projector.lumens)),
    throwRatio: g0.d / g0.w, pxW: Math.round((g0.projector.resW * g0.L) / g0.w), pxH: Math.round((g0.projector.resH * g0.H) / g0.h),
    kw: r.kw, nCircuit: r.nCircuit, nSignalCable: r.nProj + 1,
    profile: [...new Set(r.groups.map((g) => g.projector.code))].join(' / '), content: r.cfg.prj_env,
    groups: r.groups.map((g) => ({ name: g.group.name, projector: g.projector.code, model: g.projector.name, lens: g.lens.code, n: g.n, faces: g.group.faces.length })),
    interact: r.cfg.prj_interact,
    system: { pcs: sys.pcs, blends: sys.blends, boxes: sys.boxes, radars: sys.radars, boxPerSet: r.pack.constants.boxPerSet.value },
    exportable: r.exportable, blocking: r.findings.filter((f) => f.severity === 'block').map((f) => f.code),
  };
}
