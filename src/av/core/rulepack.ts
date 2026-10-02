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

/* AV-019(led@1.1)起的配电公司参数。led@1.0 只有 circuitKw。 */
export interface CompanyPower {
  circuitKw: number;                    // 单回路上限 kW
  voltage?: number;                     // V,每路电流 = 功率 ÷ 电压
  /* 电源线规格 → 载流上限 A(按线径表)。表里没有的规格:算电流照算,载流核对标「待填」 */
  cableAmps?: Record<string, number>;
  /* 一条箱体电源链最多串几只(按箱体规格书)。null = 还没填,提示「待填,按厂家规格」 */
  cascadeMax?: number | null;
}

export interface RulePack {
  line: BusinessLine;
  version: string;
  issued: string;
  company: CompanyPower;                                           // 公司级电气常量
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

/* ===== led@1.1(AV-019,2026-10-02)=====
   只改电源回路和数据线两步,其它参数、公式与 led@1.0 一致:
   - F6 改为算法:按列竖向蛇形成链(第 1 列自下而上、第 2 列自上而下……),按箱体逐只分给
     回路、允许一列中途换回路,每路负载尽量相等;**逐路校核**,任何一路超过单回路上限就
     n + 1 重新分配。led@1.0 先按整列均衡分组、分完不校核,BOC 5120 × 2880 会分成
     2765 / 2765 / 1843 W,前两路超过 2.5 kW。
   - F8 改为算法:数据线按项目选的走法(每行一条 / 蛇形按带载),逐只箱体累加像素,
     到单线带载上限就换下一条 —— 网线不能把一只箱体拆开。
   - 公司参数加电压、电源线载流上限、箱体电源级联上限。
   已有项目绑定的仍是 led@1.0,结果不变;重新保存时提示可升级。 */
const LED_V11_FORMULAS: Formula[] = LED_FORMULAS.map((f) => {
  if (f.id === 'F6') return { id: 'F6', name: '电源回路', unit: '路', source: 'AV-019（按箱体逐路校核）', kind: 'algorithm', ref: 'AV-019 §2.2 按列蛇形成链 · 逐路校核' };
  if (f.id === 'F8') return { id: 'F8', name: '数据线条数', unit: '条', source: 'AV-019（按走法逐只累加带载）', kind: 'algorithm', ref: 'AV-019 §2.2 每行一条 / 蛇形按带载' };
  return f;
});

const LED_V11: RulePack = {
  ...LED_V1,
  version: 'led@1.1',
  issued: '2026-10-02',
  company: {
    circuitKw: 2.5,
    voltage: 230,
    /* 公司参数(线径表):3 × 2.5 mm² 按 16 A 开关计。其它规格待填 */
    cableAmps: { '3*2.5': 16 },
    cascadeMax: null,
  },
  formulas: LED_V11_FORMULAS,
};

const PACKS: Record<string, RulePack> = { [LED_V1.version]: LED_V1, [LED_V11.version]: LED_V11 };

export const LATEST_LED_PACK = LED_V11.version;

/* 比 latest 旧的 LED 包 —— 05 提示「可升级」 */
export const ledPackUpgradable = (version: string | null | undefined) => !!version && version !== LATEST_LED_PACK && version.startsWith('led@');

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
