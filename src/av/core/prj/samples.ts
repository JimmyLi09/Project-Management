/* ===== Projection · finished-project samples (AV-020 §3.3) =====
   The inputs of the three finished projects the prj@0.2 constants were derived
   from, plus two plain scenes. 05 loads them as presets; the unit tests use
   them as back-tests. MY016 follows its drawing (PU900 × 5, 0.46 lens). */

import type { PrjGroupsConfig } from './groups.ts';

export interface PrjSample {
  key: string;
  label: string;
  labelEn: string;
  cfg: PrjGroupsConfig;
}

export const PRJ_SAMPLES: PrjSample[] = [
  {
    key: 'MY016', label: 'MY016 · U 形', labelEn: 'MY016 · U-shape',
    cfg: {
      prj_ceiling: 4.3, prj_env: 'window', prj_view_near: 1.0, prj_interact: 'none',
      prj_groups: [{
        name: 'U 形连续', projector: 'PU900', lens: 'f046', dmax: 3.5, bottom: 0,
        faces: [{ kind: 'wall', w: 6810, h: 4300, turn: 0 }, { kind: 'wall', w: 13645, h: 4300, turn: 90 }, { kind: 'wall', w: 6810, h: 4300, turn: 90 }],
      }],
    },
  },
  {
    key: 'MY014', label: 'MY014 · L 形 + 互动', labelEn: 'MY014 · L-shape + interaction',
    cfg: {
      prj_ceiling: 2.6, prj_env: 'window', prj_view_near: 0.8, prj_interact: 'wall',
      prj_groups: [
        { name: '左墙', projector: 'GMZ501C', lens: 'std', dmax: 1.0, bottom: 0.17, faces: [{ kind: 'wall', w: 4212, h: 1900, turn: 0 }] },
        { name: '右墙', projector: 'GMZ501C', lens: 'std', dmax: 1.0, bottom: 0.17, faces: [{ kind: 'wall', w: 4212, h: 1900, turn: 90 }] },
      ],
    },
  },
  {
    key: '114', label: '114 · 两块平面', labelEn: '114 · two flat areas',
    cfg: {
      prj_ceiling: 3.3, prj_env: 'window', prj_view_near: 1.0, prj_interact: 'none',
      prj_groups: [
        { name: '左区', projector: 'BHZ611C', lens: 'std', dmax: 2.34, bottom: 0, faces: [{ kind: 'wall', w: 10200, h: 2700, turn: 0 }] },
        { name: '右区', projector: 'BHZ611C', lens: 'std', dmax: 2.34, bottom: 0, faces: [{ kind: 'wall', w: 8125, h: 2700, turn: 0 }] },
      ],
    },
  },
  {
    key: 'single', label: '展厅单面墙', labelEn: 'Single wall',
    cfg: {
      prj_ceiling: 3.5, prj_env: 'window', prj_view_near: 1.5, prj_interact: 'none',
      prj_groups: [{ name: '主墙', projector: 'PU800', lens: 'std', dmax: 6, bottom: 0.3, faces: [{ kind: 'wall', w: 8000, h: 2800, turn: 0 }] }],
    },
  },
  {
    key: 'floor', label: '地面互动', labelEn: 'Floor interaction',
    cfg: {
      prj_ceiling: 3.3, prj_env: 'window', prj_view_near: 0, prj_interact: 'floor',
      prj_groups: [{ name: '地面', projector: 'PU800', lens: 'z057', dmax: 3.3, bottom: 0, faces: [{ kind: 'floor', w: 6000, h: 3000, turn: 0 }] }],
    },
  },
];

export const prjSample = (key: string): PrjGroupsConfig => {
  const s = PRJ_SAMPLES.find((x) => x.key === key);
  if (!s) throw new Error(`unknown projection sample "${key}"`);
  return JSON.parse(JSON.stringify(s.cfg)) as PrjGroupsConfig;
};
