/* ===== Projection · projector and lens library (AV-020 §3.5) =====
   The device library lives in the price library (line「投影」): one row per
   projector (category projector, spec = lumens, resolution, power, lens shift,
   its standard lens) and one per optional lens (category lens, spec = throw
   range, shift, which projectors it fits). prjLibraryFrom() turns those rows
   into the PrjLibrary the engine takes; PD / BD edit the rows and the next
   calculation follows. PRJ_DEVICE_SEED is the first batch written into the
   price library on deployment: the spec sheets of 2026-10-06 plus JM's
   equipment list (填写表「四、常用设备清单」rev 1, 2026-10-07). Prices are not
   seeded — 06 shows「待报价」until they are entered. */

export interface PrjLens {
  code: string;
  name: string;        // 中文名
  nameEn: string;
  throwMin: number;    // throw ratio = throw distance ÷ image width
  throwMax: number;
  ust?: boolean;       // ultra-short-throw: sits just above the image, no lens shift
  /* a lens with its own vertical shift (the domestic fixed lenses: ±40%) overrides the projector's */
  shiftUp?: number;
  shiftDown?: number;
}

export interface PrjProjector {
  code: string;
  name: string;
  lumens: number;
  resW: number;
  resH: number;
  watts: number | null;  // spec-sheet power draw; null = not entered yet
  kg: number | null;
  db: number | null;     // fan noise, normal mode
  shiftUp: number;       // vertical lens shift, fraction of image height
  shiftDown: number;
  lenses: PrjLens[];     // the standard lens first; empty = no lens data yet
  note?: string;
}

export type PrjLibrary = Record<string, PrjProjector>;

/* ===== price-library rows (spec column) ===== */
export interface PrjStdLens { name: string; nameEn: string; throwMin: number; throwMax: number; ust?: boolean }
export interface PrjProjectorSpec {
  kind: 'projector';
  code: string;
  brand: string;
  lumens: number;
  resW: number;
  resH: number;
  watts: number | null;
  kg: number | null;
  db: number | null;
  shiftUp: number;
  shiftDown: number;
  std: PrjStdLens | null;      // the lens it ships with; null = not entered yet
  note?: string;
}
export interface PrjLensSpec {
  kind: 'lens';
  code: string;
  nameEn: string;
  throwMin: number;
  throwMax: number;
  ust?: boolean;
  shiftUp?: number | null;
  shiftDown?: number | null;
  fits: string[];              // projector codes
}
/* 06 配置模板(§3.6)里除投影机以外的行:每一行在价格库里有一条,spec.role 说是哪一行 */
export type PrjPartRole = 'mount' | 'blend' | 'box' | 'pc' | 'cable' | 'radar' | 'switch' | 'control' | 'install' | 'trip';
export interface PrjPartSpec { kind: 'part'; role: PrjPartRole }
export type PrjDeviceSpec = PrjProjectorSpec | PrjLensSpec | PrjPartSpec;

export const PRJ_PROJECTOR_CATEGORY = 'projector';
export const PRJ_LENS_CATEGORY = 'lens';
export const PRJ_PART_CATEGORY = 'prj_part';

/* rows as the price library holds them (the fields prjLibraryFrom reads) */
export interface PrjDeviceRow { model: string; active: boolean; spec?: unknown }

export function prjLibraryFrom(rows: PrjDeviceRow[]): PrjLibrary {
  const spec = <K extends PrjDeviceSpec['kind']>(r: PrjDeviceRow, kind: K) =>
    (r.active && r.spec && typeof r.spec === 'object' && (r.spec as PrjDeviceSpec).kind === kind ? r.spec as Extract<PrjDeviceSpec, { kind: K }> : null);
  const lenses = rows.map((r) => ({ r, s: spec(r, 'lens') })).filter((x): x is { r: PrjDeviceRow; s: PrjLensSpec } => !!x.s);
  const lib: PrjLibrary = {};
  for (const r of rows) {
    const s = spec(r, 'projector');
    if (!s || !s.code) continue;
    const own: PrjLens[] = s.std ? [{ code: 'std', name: s.std.name, nameEn: s.std.nameEn, throwMin: s.std.throwMin, throwMax: s.std.throwMax, ...(s.std.ust ? { ust: true } : {}) }] : [];
    const extra = lenses.filter((l) => l.s.fits.includes(s.code)).map(({ r: lr, s: ls }): PrjLens => ({
      code: ls.code, name: lr.model, nameEn: ls.nameEn, throwMin: ls.throwMin, throwMax: ls.throwMax,
      ...(ls.ust ? { ust: true } : {}),
      ...(ls.shiftUp != null ? { shiftUp: ls.shiftUp } : {}), ...(ls.shiftDown != null ? { shiftDown: ls.shiftDown } : {}),
    }));
    lib[s.code] = {
      code: s.code, name: r.model, lumens: s.lumens, resW: s.resW, resH: s.resH, watts: s.watts, kg: s.kg, db: s.db,
      shiftUp: s.shiftUp, shiftDown: s.shiftDown, lenses: [...own, ...extra], ...(s.note ? { note: s.note } : {}),
    };
  }
  return lib;
}

/* ===== first batch ===== */
export interface PrjSeedRow { model: string; categoryLabel: string; category: string; unit: string; pitch: string; listPrice: number | null; source: string; spec: PrjDeviceSpec }

const SHEET = '规格书 2026-10-06';
const LIST = 'JM 设备清单 rev 1（2026-10-07）';
const WUXGA = { resW: 1920, resH: 1200 };
const projector = (model: string, s: Omit<PrjProjectorSpec, 'kind'>, source: string): PrjSeedRow => ({
  model, categoryLabel: '投影机', category: PRJ_PROJECTOR_CATEGORY, unit: '台', pitch: `${s.lumens} lm`, listPrice: null, source, spec: { kind: 'projector', ...s },
});
const lens = (model: string, s: Omit<PrjLensSpec, 'kind'>, source: string): PrjSeedRow => ({
  model, categoryLabel: '镜头', category: PRJ_LENS_CATEGORY, unit: '支',
  pitch: s.throwMin === s.throwMax ? String(s.throwMin) : `${s.throwMin}–${s.throwMax}`, listPrice: null, source, spec: { kind: 'lens', ...s },
});
/* MY014 报价里的单价(§3.6):写在售价栏,币种 SGD(JM 2026-10-07 确认);成本价由 BD 在价格库手动填 */
const part = (model: string, role: PrjPartRole, unit: string, listPrice: number | null): PrjSeedRow => ({
  model, categoryLabel: '投影配套', category: PRJ_PART_CATEGORY, unit, pitch: '', listPrice,
  source: listPrice == null ? 'AV-020 §3.6 配置模板（待报价）' : 'MY014 报价单价（SGD，成本价由 BD 填）', spec: { kind: 'part', role },
});

const SEEMILE = ['PU800', 'PU900'];
const domestic = (r: number) => lens(`国产定焦 ${r}`, {
  code: `f0${Math.round(r * 100)}`, nameEn: `Fixed ${r} (domestic)`, throwMin: r, throwMax: r, shiftUp: 0.4, shiftDown: 0.4, fits: SEEMILE,
}, `${LIST}：国产定焦，位移上下 40% / 左右 15%`);

export const PRJ_DEVICE_SEED: PrjSeedRow[] = [
  projector('Panasonic PT-GMZ501C', {
    code: 'GMZ501C', brand: '松下', lumens: 5000, ...WUXGA, watts: 385, kg: 11, db: 41, shiftUp: 0, shiftDown: 0,
    std: { name: '超短焦固定 0.235', nameEn: 'Fixed ultra-short throw 0.235', throwMin: 0.235, throwMax: 0.235, ust: true },
    note: '设备清单写 PT-GMZ501CB（同一机型）',
  }, `${SHEET} · ${LIST}`),
  projector('Panasonic PT-BHZ611C', {
    code: 'BHZ611C', brand: '松下', lumens: 6200, ...WUXGA, watts: 370, kg: 6.9, db: 36, shiftUp: 0.44, shiftDown: 0,
    std: { name: '标配 1.09–1.77', nameEn: 'Standard 1.09–1.77', throwMin: 1.09, throwMax: 1.77 },
    note: '中心亮度 6600 lm；水平位移 ±20%；114 用的机型',
  }, SHEET),
  projector('Seemile SML-PU800', {
    code: 'PU800', brand: '视美乐', lumens: 8000, ...WUXGA, watts: 530, kg: 14, db: 38, shiftUp: 0.5, shiftDown: 0.5,
    std: { name: '原装标配 1.07–1.7', nameEn: 'Standard 1.07–1.7 (original)', throwMin: 1.07, throwMax: 1.7 },
    note: '水平位移 ±10%；原装镜头贵，多半选装国产镜头',
  }, `${SHEET} · ${LIST}`),
  projector('Seemile SML-PU900', {
    code: 'PU900', brand: '视美乐', lumens: 9000, ...WUXGA, watts: 580, kg: 14, db: 38, shiftUp: 0.5, shiftDown: 0.5,
    std: { name: '原装标配 1.07–1.7', nameEn: 'Standard 1.07–1.7 (original)', throwMin: 1.07, throwMax: 1.7 },
    note: '水平位移 ±10%；原装镜头贵，多半选装国产镜头',
  }, `${SHEET} · ${LIST}`),
  /* rev 1 新增:只有流明和分辨率;功耗、重量、噪音、镜头待补(补齐前 05 选了会提示) */
  projector('Panasonic PT-BAZ722', { code: 'BAZ722', brand: '松下', lumens: 7300, ...WUXGA, watts: null, kg: null, db: null, shiftUp: 0, shiftDown: 0, std: null, note: '功耗、镜头、位移待补' }, LIST),
  projector('Epson CB-L695SE', { code: 'L695SE', brand: '爱普生', lumens: 6000, ...WUXGA, watts: null, kg: null, db: null, shiftUp: 0, shiftDown: 0, std: null, note: '功耗、镜头、位移待补' }, LIST),
  projector('Epson CB-C15KU', { code: 'C15KU', brand: '爱普生', lumens: 10000, ...WUXGA, watts: null, kg: null, db: null, shiftUp: 0, shiftDown: 0, std: null, note: '功耗、镜头、位移待补' }, LIST),
  lens('选配 0.57–1.0', { code: 'z057', nameEn: 'Optional 0.57–1.0', throwMin: 0.57, throwMax: 1.0, fits: SEEMILE }, `${SHEET}（型号待补）`),
  domestic(0.46),
  domestic(0.5),
  domestic(0.6),
  domestic(0.8),
  part('投影固定支架（工程专用，承重 20 kg）', 'mount', '个', 500),
  part('软件融合服务器', 'blend', '套', 2000),
  part('多屏宝（融合软件跨屏硬件）', 'box', '套', 960),
  part('PC 主机（i7 / RTX 级显卡）', 'pc', '台', 7500),
  part('线材辅材（20 m HDMI 光纤 + 六类网线）', 'cable', '批', 600),
  part('雷达（墙面互动）', 'radar', '颗', 4500),
  part('路由器 / 交换机', 'switch', '台', null),
  part('中控系统（开关机 + 程序）', 'control', '套', 3000),
  part('安装调试', 'install', '人天', null),
  part('出差费', 'trip', '项', 8000),
];

/* the library before the price library has any projector rows (and for the unit tests) */
export const PRJ_LIBRARY_SEED: PrjLibrary = prjLibraryFrom(PRJ_DEVICE_SEED.map((r) => ({ model: r.model, active: true, spec: r.spec })));

export const lensOf = (p: PrjProjector, code: string): PrjLens => p.lenses.find((l) => l.code === code) ?? p.lenses[0];
