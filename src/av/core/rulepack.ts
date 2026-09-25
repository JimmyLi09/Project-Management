/* ===== Rule pack — the three-layer parameter model (§3) + formula library (§5) =====

   §3 is the spec's most important structural decision: the three parameter
   layers change at different rates and have different owners, so they are
   stored apart and never merged into one config table.

   A pack is an immutable, versioned snapshot of all three layers plus the
   formula library. A project stores only the pack version; reopening it
   re-resolves the same snapshot, so an engineer editing a coefficient (§11)
   can never change a historical project's result — that is acceptance A8. */

import type { BusinessLine, ScreenType, Size } from './types.ts';

export interface Formula {
  id: string;                          // F1 … F10
  name: string;
  unit: string;
  source: string;                      // 现有表格 / 新增 / 图纸反推 …
  /* 'expr' formulas are evaluated by expr.ts in declaration order, each output
     binding a variable for the formulas after it. 'algorithm' formulas are the
     three the spec defines procedurally; `ref` points at the section. */
  kind: 'expr' | 'algorithm';
  exprs?: Record<string, string>;      // output name -> expression
  scope?: 'screen' | 'row';            // F8 is evaluated once per cabinet row
  ref?: string;
}

export interface ScreenProfile {
  code: ScreenType;
  label: string;
  wSqm: number;                        // 功耗密度 W/㎡
  modW: number;
  modH: number;
  cabLib: Size[];
  primary: Size;
  /* §3.1: 室外与租赁为行业常规占位值。false blocks formal export (LED-TYPE-01). */
  calibrated: boolean;
  note: string;
}

export interface RulePack {
  line: BusinessLine;
  version: string;
  issued: string;
  company: { circuitKw: number };                                  // 公司级电气常量
  control: { brand: string; model: string; dataPx: number };       // 控制系统参数
  profiles: Record<ScreenType, ScreenProfile>;                     // 屏体类型参数组
  formulas: Formula[];
}

const LED_FORMULAS: Formula[] = [
  { id: 'F1', name: '屏体面积', unit: '㎡', source: '现有表格', kind: 'expr',
    exprs: { sqm: 'L * H / 1000000' } },
  { id: 'F2', name: '模组数量', unit: '块', source: '现有表格（已加取整）', kind: 'expr',
    exprs: { mods: 'floor(L / mod_w) * floor(H / mod_h)' } },
  { id: 'F3', name: '箱体排布', unit: '—', source: '新增', kind: 'algorithm', ref: '§6 DP 求解' },
  { id: 'F4', name: '分辨率', unit: 'px', source: '新增', kind: 'expr',
    exprs: { px_w: 'round(L / p)', px_h: 'round(H / p)', px: 'px_w * px_h' } },
  { id: 'F5', name: '功耗', unit: 'kW', source: '现有表格', kind: 'expr',
    exprs: { kw: 'sqm * w_sqm / 1000' } },
  { id: 'F6', name: '电源回路数', unit: '路', source: '新增（图纸反推）', kind: 'expr',
    exprs: { n_circuit: 'ceil(kw / circuit_kw)' } },
  { id: 'F7', name: '电源线报价数', unit: '根', source: '新增（含 1 备用）', kind: 'expr',
    exprs: { n_power_cable: 'n_circuit + 1' } },
  { id: 'F8', name: '数据线条数', unit: '条', source: '新增（记录反推）', kind: 'expr', scope: 'row',
    exprs: { row_runs: 'max(1, ceil(px_w * round(row_h / p) / data_px))' } },
  { id: 'F9', name: '数据线报价数', unit: '根', source: '新增（含 1 备用）', kind: 'expr',
    exprs: { n_data_cable: 'n_data_run + 1' } },
  { id: 'F10', name: '箱体清单', unit: '只', source: '新增', kind: 'algorithm', ref: '§6 按 (宽,高) 聚合计数' },
];

const LED_V1: RulePack = {
  line: 'led',
  version: 'led@1.0',
  issued: '2026-09-25',
  company: { circuitKw: 2.5 },
  control: { brand: 'novastar', model: '—', dataPx: 560_000 },
  profiles: {
    in_fixed: {
      code: 'in_fixed', label: '室内固装', wSqm: 500, modW: 320, modH: 160,
      cabLib: [[640, 640], [640, 480], [320, 480], [320, 320], [640, 320]],
      primary: [640, 480], calibrated: true,
      note: '功耗密度 500 W/㎡ 来自现有统计表主流取值，依据较强，定期复核。',
    },
    out_fixed: {
      code: 'out_fixed', label: '室外固装', wSqm: 800, modW: 320, modH: 320,
      cabLib: [[960, 960], [960, 640], [640, 960], [480, 960]],
      primary: [960, 960], calibrated: false,
      note: '800 W/㎡ 为行业常规占位值，146 个完工项目中无可用于校准的室外功耗记录，须实测后方可用于正式报价。',
    },
    rental: {
      code: 'rental', label: '租赁屏', wSqm: 600, modW: 250, modH: 250,
      cabLib: [[500, 500], [500, 1000], [1000, 1000]],
      primary: [500, 500], calibrated: false,
      note: '600 W/㎡ 为行业常规占位值，待实测租赁项目校准。',
    },
  },
  formulas: LED_FORMULAS,
};

const PACKS: Record<string, RulePack> = { [LED_V1.version]: LED_V1 };

export const LATEST_LED_PACK = LED_V1.version;

export function getRulePack(version: string): RulePack {
  const pack = PACKS[version];
  if (!pack) throw new Error(`unknown rule pack "${version}"`);
  return pack;
}

export const listRulePacks = (): RulePack[] => Object.values(PACKS);

/* Registering a pack is how an engineer's edit ships: it creates a NEW version
   and leaves every existing one untouched (§11, A8). */
export function registerRulePack(pack: RulePack): void {
  if (PACKS[pack.version]) throw new Error(`rule pack "${pack.version}" already exists — bump the version`);
  PACKS[pack.version] = pack;
}

export function formulaOf(pack: RulePack, id: string): Formula {
  const f = pack.formulas.find((x) => x.id === id);
  if (!f) throw new Error(`formula "${id}" not in pack ${pack.version}`);
  return f;
}
