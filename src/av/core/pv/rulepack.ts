/* ===== Solar PV (太阳能光伏) · rule pack pv@0.1-draft =====

   A DRAFT from industry practice for grid-tied rooftop PV in Singapore, without
   storage. Some constants come from physics or module / inverter datasheets
   (temperature coefficients, voltage windows); the rest (roof coverage, PR,
   irradiation, mounting weights) are rules of thumb. Every constant is
   uncalibrated and the pack is marked so, which blocks formal export and cost
   confirmation (PV-TYPE-01). Sources and calibration notes:
   docs/requirements/016. */

import type { Formula } from '../rulepack.ts';

export type PvMount = 'metal' | 'flat';
export type PvModuleCode = 'm550' | 'm440';
export type PvInverterCode = 'inv5' | 'inv20' | 'inv50' | 'inv100';

export interface PvMountProfile {
  code: PvMount;
  label: string;
  coverage: number;     // share of the usable roof that modules can cover
  mountKg: number;      // kg per ㎡ of module area for rails / frames
}

export interface PvModuleProfile {
  code: PvModuleCode;
  label: string;
  w: number;            // Wp at STC
  l: number; wd: number; // mm
  voc: number; vmp: number; // V at STC
  kg: number;
}

export interface PvInverterProfile {
  code: PvInverterCode;
  label: string;
  kw: number;           // rated AC output
  vmax: number;         // max DC input voltage
  mpptMin: number;      // lower end of the MPPT window
}

export interface PvRulePack {
  line: 'pv';
  version: string;
  issued: string;
  calibrated: boolean;
  note: string;
  mounts: Record<PvMount, PvMountProfile>;
  modules: Record<PvModuleCode, PvModuleProfile>;
  inverters: Record<PvInverterCode, PvInverterProfile>;
  eng: {
    tMin: number; tCellMax: number; betaVoc: number; betaVmp: number;
    dcAc: number; dcAcMin: number; ghi: number; pr: number; slack: number;
    gridLicenceKw: number;
  };
  formulas: Formula[];
}

const PV_FORMULAS: Formula[] = [
  { id: 'S1', name: '屋面可装组件', unit: '块', source: '可用面积 × 覆盖率 ÷ 组件面积', kind: 'expr',
    exprs: { mod_area: 'mod_l * mod_wd / 1000000', n_max: 'floor(area * coverage / mod_area)' } },
  { id: 'S2', name: '组件数量', unit: '块', source: '目标容量，或未设目标时铺满屋面', kind: 'expr',
    exprs: { n_mod: 'min(n_max, fill * n_max + ceil(target_kwp * 1000 / mod_w))' } },
  { id: 'S3', name: '装机容量', unit: 'kWp', source: '组件数 × 单块功率', kind: 'expr',
    exprs: { kwp: 'n_mod * mod_w / 1000' } },
  { id: 'S4', name: '逆变器', unit: '台', source: '直流 ÷ (额定 × 容配比)', kind: 'expr',
    exprs: { n_inv: 'max(1, ceil(kwp / (inv_kw * dc_ac)))', ac_kw: 'n_inv * inv_kw', dc_ac_real: 'kwp / ac_kw' } },
  { id: 'S5', name: '组串', unit: '串', source: '温度修正后的开路 / 工作电压', kind: 'expr',
    exprs: {
      voc_cold: 'voc * (1 + beta_voc * (t_min - 25))', vmp_hot: 'vmp * (1 + beta_vmp * (t_cell_max - 25))',
      str_max: 'floor(inv_vmax / voc_cold)', str_min: 'ceil(mppt_min / vmp_hot)',
      n_str: 'ceil(n_mod / str_max)', str_short: 'floor(n_mod / n_str)',
    } },
  { id: 'S6', name: '年发电量', unit: 'kWh', source: '容量 × 年水平面辐照 × 系统效率 PR', kind: 'expr',
    exprs: { spec_yield: 'ghi * pr', yield_kwh: 'kwp * spec_yield' } },
  { id: 'S7', name: '线缆与连接器', unit: 'm', source: '组串往返 / 逆变器至配电箱 × (1 + 余量)，取整到米', kind: 'expr',
    exprs: { dc_m: 'round(n_str * 2 * dc_run * (1 + slack))', ac_m: 'round(n_inv * ac_run * (1 + slack))', n_mc4: 'n_str * 2' } },
  { id: 'S8', name: '屋面附加荷载', unit: 'kg/㎡', source: '组件自重 + 支架', kind: 'expr',
    exprs: { load_kg: 'mod_kg / mod_area + mount_kg' } },
];

const PV_V01: PvRulePack = {
  line: 'pv',
  version: 'pv@0.1-draft',
  issued: '2026-09-26',
  calibrated: false,
  note: '按行业常规编制的草案（新加坡屋顶并网、无储能），覆盖率、系统效率等常量待用公司实际光伏项目校准，校准前不得用于正式报价。',
  mounts: {
    metal: { code: 'metal', label: '金属屋面 · 顺坡平铺', coverage: 0.85, mountKg: 3 },
    flat: { code: 'flat', label: '混凝土平屋面 · 倾角支架', coverage: 0.6, mountKg: 8 },
  },
  modules: {
    m550: { code: 'm550', label: '单晶 550 Wp · 2278×1134', w: 550, l: 2278, wd: 1134, voc: 49.9, vmp: 42.1, kg: 28 },
    m440: { code: 'm440', label: '单晶 440 Wp · 1722×1134', w: 440, l: 1722, wd: 1134, voc: 39.4, vmp: 33, kg: 21.5 },
  },
  inverters: {
    inv5: { code: 'inv5', label: '5 kW 单相', kw: 5, vmax: 600, mpptMin: 90 },
    inv20: { code: 'inv20', label: '20 kW 三相', kw: 20, vmax: 1100, mpptMin: 200 },
    inv50: { code: 'inv50', label: '50 kW 三相', kw: 50, vmax: 1100, mpptMin: 200 },
    inv100: { code: 'inv100', label: '100 kW 三相', kw: 100, vmax: 1100, mpptMin: 200 },
  },
  eng: {
    tMin: 20, tCellMax: 70, betaVoc: -0.0027, betaVmp: -0.0035,
    dcAc: 1.2, dcAcMin: 0.8, ghi: 1580, pr: 0.8, slack: 0.1, gridLicenceKw: 1000,
  },
  formulas: PV_FORMULAS,
};

const PACKS: Record<string, PvRulePack> = { [PV_V01.version]: PV_V01 };

export const LATEST_PV_PACK = PV_V01.version;

export function getPvPack(version: string): PvRulePack {
  const p = PACKS[version];
  if (!p) throw new Error(`unknown PV rule pack "${version}"`);
  return p;
}

export function registerPvPack(p: PvRulePack): void {
  if (PACKS[p.version]) throw new Error(`rule pack "${p.version}" already exists — bump the version`);
  PACKS[p.version] = p;
}
