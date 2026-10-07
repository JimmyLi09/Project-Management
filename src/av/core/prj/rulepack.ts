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

export const PRJ_V01_PACK = PRJ_V01.version;

/* ===== prj@0.2 (AV-020) =====
   Blend groups × projection faces, a projector / lens library and the company's
   own brightness rule (lumens ÷ one projector's image area), drawn from three
   finished projects (MY014, 114, MY016) and JM's questionnaire. Each constant
   carries where it came from; PD confirms them one by one, and when all are
   confirmed the pack is reissued as prj@1.0. Until then export is allowed but
   marked「部分常数待校准」. Projects opened on prj@0.1-draft stay on it. */

export type PrjConstSource = 'company' | 'sample' | 'draft' | 'industry' | 'const';
export const PRJ_SOURCE_LABEL: Record<PrjConstSource, [string, string]> = {
  company: ['公司填写', 'Company input'],
  sample: ['样本反推', 'From finished projects'],
  draft: ['草案', 'Draft'],
  industry: ['行业常规', 'Industry practice'],
  const: ['公司常量', 'Company constant'],
};

export interface PrjConst<T = number> {
  value: T;
  src: PrjConstSource;
  confirmed: boolean;
  note: string;        // 中文依据
  noteEn: string;
}

export type PrjEnv = 'dark' | 'window' | 'bright';

export interface PrjRulePack2 {
  line: 'projector';
  model: 'groups';
  version: string;
  issued: string;
  calibrated: boolean;
  note: string;
  noteEn: string;
  constants: {
    overlap: PrjConst;               // blend band as a share of one projector's image width
    drop: PrjConst;                  // m, ceiling to lens when hung
    lux: PrjConst<Record<PrjEnv, number>>;  // target illuminance, company rule
    maxLm: PrjConst;                 // single projector above this → yellow
    blendMin: PrjConst;              // blend band share below this → yellow
    head: PrjConst;                  // m, head height for the shadow check
    ustTop: PrjConst;                // m, UST lens sits this far above the image top
    circuitKw: PrjConst;
    industryDerate: PrjConst;        // reference only: light left after ageing / lens losses
    radarWall: PrjConst;             // m of wall per radar (wall interaction) — used by 06 (PR3)
    boxPerSet: PrjConst;             // projectors per 多屏宝 — used by 06 (PR3)
  };
}

const c = <T,>(value: T, src: PrjConstSource, note: string, noteEn: string): PrjConst<T> => ({ value, src, confirmed: false, note, noteEn });

const PRJ_V02: PrjRulePack2 = {
  line: 'projector',
  model: 'groups',
  version: 'prj@0.2',
  issued: '2026-10-06',
  calibrated: false,
  note: '用 3 个完工样本（MY014 / 114 / MY016）反推的初值；标「待校准」的常数由 PD 逐项确认，全部确认后发布 prj@1.0。确认前可导出，文件上标「部分常数待校准」。',
  noteEn: 'Initial values derived from three finished projects (MY014, 114, MY016). PD confirms each constant; once all are confirmed the pack is reissued as prj@1.0. Until then files can be exported but are marked "some constants not yet calibrated".',
  constants: {
    overlap: c(0.25, 'sample', '样本融合带 1000–3000 mm，约占单台画面 25–40%（草案 0.15 偏小）', 'Blend bands in the samples are 1000–3000 mm, about 25–40% of one image (the draft 0.15 was too small)'),
    drop: c(0.4, 'sample', 'MY016 天花 4.3 / 机 3.9；114 天花 3.3 / 机 2.7（范围 0.4–0.65）', 'MY016 ceiling 4.3 / lens 3.9; 114 ceiling 3.3 / lens 2.7 (range 0.4–0.65)'),
    lux: c({ dark: 150, window: 250, bright: 500 }, 'sample', 'MY016 有窗、277 lx 验收通过；暗室与明亮为草案', 'MY016 (windows, 277 lx) passed handover; dark and bright are draft values'),
    maxLm: c(9000, 'company', '填写表 5500–8500 lm；MY016 实际用到 9000 lm', 'Questionnaire 5,500–8,500 lm; MY016 used 9,000 lm'),
    blendMin: c(0.15, 'sample', '三个样本都有融合缝，融合带过窄最明显', 'All three samples show blend seams, worst where the band is narrow'),
    head: c(1.8, 'industry', '人头高', 'Head height'),
    ustTop: c(0.2, 'draft', '超短焦机装在画面顶上方 0.2 m', 'Ultra-short-throw unit sits 0.2 m above the image top'),
    circuitKw: c(2.5, 'const', '单回路容量（与 LED 相同）', 'Capacity of one circuit (same as LED)'),
    industryDerate: c(0.8, 'draft', '老化、镜头与校正损失（prj@0.1 草案值），仅作行业参考', 'Ageing, lens and calibration losses (prj@0.1 draft), reference only'),
    radarWall: c(4.5, 'sample', 'MY014：4.2 m 墙 1 颗雷达', 'MY014: one radar for a 4.2 m wall'),
    boxPerSet: c(2, 'sample', 'MY014 报价：每 2 台 1 套多屏宝（待确认）', 'MY014 quotation: one 多屏宝 per two projectors (to be confirmed)'),
  },
};

/* prj@1.0:同一组常数,PD 在「投影常数」页逐项确认完、点「发布」后才启用(发布记在数据库里,
   服务端据此把新项目绑到 1.0)。1.0 不标「部分常数待校准」,也不出 PRJ-CAL-01。
   要改某个常数的值不在这里改 —— 改值要出新版本(prj@0.3 / 1.1),旧项目结果不变。 */
const PRJ_V10: PrjRulePack2 = {
  ...PRJ_V02,
  version: 'prj@1.0',
  issued: 'PD 确认全部常数后发布',
  calibrated: true,
  note: '全部常数已由 PD 确认（数值同 prj@0.2）。',
  noteEn: 'Every constant confirmed by PD (same values as prj@0.2).',
  constants: Object.fromEntries(Object.entries(PRJ_V02.constants).map(([k, v]) => [k, { ...v, confirmed: true }])) as PrjRulePack2['constants'],
};

const PACKS2: Record<string, PrjRulePack2> = { [PRJ_V02.version]: PRJ_V02, [PRJ_V10.version]: PRJ_V10 };

/* the latest pack before prj@1.0 is published; after that the server says so (latestPrjPack) */
export const LATEST_PRJ_PACK = PRJ_V02.version;
export const PRJ_RELEASE_PACK = PRJ_V10.version;
/* the pack whose constants PD confirms on the 投影常数 page */
export const PRJ_CONFIRM_PACK = PRJ_V02.version;

export const isGroupsPack = (version: string | null | undefined): boolean => !!version && !!PACKS2[version];
/* 05 offers「升级」from the older single-image pack, and from prj@0.2 once prj@1.0 is published */
export const prjPackUpgradable = (version: string | null | undefined, latest: string = LATEST_PRJ_PACK): boolean =>
  !!version && version !== latest && (isGroupsPack(version) ? latest === PRJ_RELEASE_PACK : !!PACKS[version]);

/* the constants as the confirmation page lists them */
export type PrjConstKey = keyof PrjRulePack2['constants'];
export const PRJ_CONST_LABEL: Record<PrjConstKey, { zh: string; en: string; unit: string }> = {
  overlap: { zh: '融合带占比', en: 'Blend band share', unit: '' },
  drop: { zh: '吊装下沉', en: 'Hanging drop', unit: 'm' },
  lux: { zh: '目标照度 暗室 / 有窗 / 明亮', en: 'Target illuminance dark / windows / bright', unit: 'lx' },
  maxLm: { zh: '单机流明上限', en: 'Max lumens per projector', unit: 'lm' },
  blendMin: { zh: '融合带最小占比', en: 'Minimum blend share', unit: '' },
  head: { zh: '人头高', en: 'Head height', unit: 'm' },
  ustTop: { zh: '超短焦装在画面顶上方', en: 'UST above the image top', unit: 'm' },
  circuitKw: { zh: '单回路容量', en: 'Circuit capacity', unit: 'kW' },
  industryDerate: { zh: '行业折减（只作参考）', en: 'Industry derate (reference only)', unit: '' },
  radarWall: { zh: '每颗雷达覆盖墙宽', en: 'Wall width per radar', unit: 'm' },
  boxPerSet: { zh: '多屏宝每套带几台', en: 'Projectors per multi-output box', unit: '' },
};
export const prjConstValue = (v: unknown): string =>
  (typeof v === 'object' && v ? Object.values(v as Record<string, number>).join(' / ') : String(v));

export function getPrjGroupsPack(version: string): PrjRulePack2 {
  const p = PACKS2[version];
  if (!p) throw new Error(`unknown projection rule pack "${version}"`);
  return p;
}

export function registerPrjGroupsPack(p: PrjRulePack2): void {
  if (PACKS2[p.version] || PACKS[p.version]) throw new Error(`rule pack "${p.version}" already exists — bump the version`);
  PACKS2[p.version] = p;
}

export function getPrjPack(version: string): PrjRulePack {
  const p = PACKS[version];
  if (!p) throw new Error(`unknown projection rule pack "${version}"`);
  return p;
}

export function registerPrjPack(p: PrjRulePack): void {
  if (PACKS[p.version]) throw new Error(`rule pack "${p.version}" already exists — bump the version`);
  PACKS[p.version] = p;
}
