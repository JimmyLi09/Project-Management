/* ===== Projection · rule pack prj@0.1-draft =====

   A DRAFT drawn from industry practice, not from company records: every
   constant here is uncalibrated and the pack as a whole is marked so, which
   blocks formal export and cost confirmation (PRJ-TYPE-01) until engineering
   calibrates it against real projects. Sources and rationale per constant are
   in docs/requirements/014.

   Same principles as LED (§3, §5): parameters in separate layers, formulas
   stored as expressions, the whole thing frozen under one version so a project
   keeps the numbers it was opened with. */

import type { Formula } from '../rulepack.ts';

export type PrjProfileCode = 'laser_wuxga' | 'laser_4k';
export type PrjContent = 'passive' | 'basic' | 'analytical' | 'video';

export interface PrjProfile {
  code: PrjProfileCode;
  label: string;
  nativePxW: number;
  nativePxH: number;
  overlap: number;        // minimum edge-blend overlap, fraction of one raster width
  utilMin: number;        // blend another projector when less than this share of the raster lands on the image
  derate: number;         // light left after ageing, lens and calibration losses
  minNits: number;        // luminance floor in a dark room, cd/㎡
  wPerKlm: number;        // electrical W per 1000 lm
  lensMin: number;        // standard lens throw-ratio range
  lensMax: number;
  maxLm: number;          // above this a single projector is unusual
}

export interface PrjContentClass {
  code: PrjContent;
  label: string;
  contrast: number;       // ANSI/INFOCOMM 3M-2011 minimum system contrast ratio
  viewFactor: number;     // farthest viewer ≤ factor × image height (4-6-8 rule)
}

export interface PrjRulePack {
  line: 'projector';
  version: string;
  issued: string;
  calibrated: boolean;
  note: string;
  company: { circuitKw: number };
  profiles: Record<PrjProfileCode, PrjProfile>;
  content: Record<PrjContent, PrjContentClass>;
  thresholds: { ustThrow: number; ambientMax: number; arcminFactor: number };
  formulas: Formula[];
}

const PRJ_FORMULAS: Formula[] = [
  { id: 'P1', name: '画面比例与面积', unit: '㎡', source: '几何', kind: 'expr',
    exprs: { aspect: 'W / H', area: 'W * H / 1000000' } },
  { id: 'P2', name: '投影机台数（水平融合）', unit: '台', source: '行业常规（草案）', kind: 'expr',
    exprs: { n_proj: 'max(1, ceil((util_min * aspect / native_aspect - overlap) / (1 - overlap) - 0.000001))' } },
  { id: 'P3', name: '单机投射画面', unit: 'mm', source: '几何', kind: 'expr',
    exprs: { w_proj: 'max(W / (n_proj * (1 - overlap) + overlap), H * native_aspect)', h_proj: 'w_proj / native_aspect' } },
  { id: 'P4', name: '投射比', unit: '—', source: '几何', kind: 'expr',
    exprs: { throw_ratio: 'throw_dist * 1000 / w_proj' } },
  { id: 'P5', name: '所需屏面照度', unit: 'lx', source: 'ANSI/INFOCOMM 3M-2011 对比度 + 亮度下限（草案）', kind: 'expr',
    exprs: { e_req: 'max((contrast - 1) * ambient, 3.14159265 * min_nits / gain)' } },
  { id: 'P6', name: '单机所需亮度', unit: 'lm', source: '光通量 = 照度 × 面积 ÷ 折减', kind: 'expr',
    exprs: { lm_proj: 'e_req * w_proj * h_proj / 1000000 / derate' } },
  { id: 'P7', name: '有效分辨率', unit: 'px', source: '几何', kind: 'expr',
    exprs: { px_w: 'round(native_px_w * W / w_proj)', px_h: 'round(native_px_h * H / h_proj)', pixel_mm: 'w_proj / native_px_w' } },
  { id: 'P8', name: '用电功率', unit: 'kW', source: '单位功耗（草案）', kind: 'expr',
    exprs: { kw: 'n_proj * lm_proj * w_per_klm / 1000000' } },
  { id: 'P9', name: '电源回路数', unit: '路', source: '公司常量', kind: 'expr',
    exprs: { n_circuit: 'ceil(kw / circuit_kw)' } },
  { id: 'P10', name: '信号线报价数', unit: '根', source: '每台 1 根 + 1 备用', kind: 'expr',
    exprs: { n_signal_cable: 'n_proj + 1' } },
];

const PRJ_V01: PrjRulePack = {
  line: 'projector',
  version: 'prj@0.1-draft',
  issued: '2026-09-25',
  calibrated: false,
  note: '按行业常规编制的草案，全部常量待用公司实际投影项目校准，校准前不得用于正式报价。',
  company: { circuitKw: 2.5 },
  profiles: {
    laser_wuxga: {
      code: 'laser_wuxga', label: '激光工程机 WUXGA 1920×1200', nativePxW: 1920, nativePxH: 1200,
      overlap: 0.15, utilMin: 0.8, derate: 0.8, minNits: 50, wPerKlm: 80, lensMin: 1.2, lensMax: 2.2, maxLm: 30000,
    },
    laser_4k: {
      code: 'laser_4k', label: '激光工程机 4K UHD 3840×2160', nativePxW: 3840, nativePxH: 2160,
      overlap: 0.15, utilMin: 0.8, derate: 0.8, minNits: 50, wPerKlm: 80, lensMin: 1.2, lensMax: 2.2, maxLm: 30000,
    },
  },
  content: {
    passive: { code: 'passive', label: '被动观看（标识、氛围）', contrast: 7, viewFactor: 8 },
    basic: { code: 'basic', label: '基本决策（演示、展示）', contrast: 15, viewFactor: 6 },
    analytical: { code: 'analytical', label: '分析决策（细节、数据）', contrast: 50, viewFactor: 4 },
    video: { code: 'video', label: '动态视频', contrast: 80, viewFactor: 6 },
  },
  thresholds: { ustThrow: 0.4, ambientMax: 500, arcminFactor: 3.438 },
  formulas: PRJ_FORMULAS,
};

const PACKS: Record<string, PrjRulePack> = { [PRJ_V01.version]: PRJ_V01 };

export const LATEST_PRJ_PACK = PRJ_V01.version;

export function getPrjPack(version: string): PrjRulePack {
  const p = PACKS[version];
  if (!p) throw new Error(`unknown projection rule pack "${version}"`);
  return p;
}

export function registerPrjPack(p: PrjRulePack): void {
  if (PACKS[p.version]) throw new Error(`rule pack "${p.version}" already exists — bump the version`);
  PACKS[p.version] = p;
}
