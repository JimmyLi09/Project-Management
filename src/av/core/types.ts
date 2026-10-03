/* ===== AV platform — shared domain types =====
   The platform is multi-business-line by design (§2.2: 投影 / 弱电 / 太阳能 are
   architecturally reserved, not implemented). Field names carry a per-line
   prefix and must never be reused across lines (§4). */

export type BusinessLine = 'led' | 'projector' | 'elv' | 'pv';

export type ScreenType = 'in_fixed' | 'out_fixed' | 'rental';

/* Cabinet / module footprint, mm. */
export type Size = readonly [w: number, h: number];

/* ===== §4 LED field dictionary ===== */

export type Install = 'steel' | 'wall' | 'hoist';
export type Maintain = 'front' | 'rear';
export type Redundancy = 'none' | 'sender_1plus1';
export type CtrlBrand = 'novastar' | 'colorlight' | 'other';

/* AV-019 §2.3 人工调整:每只箱体的回路号、网线号和网线上的序号。
   sig = 排布指纹(箱体行列和尺寸),输入变了对不上就失效、回到自动结果。
   power / data 表示哪一部分是人改的(另一部分照旧自动)。 */
export interface WiringOverride {
  sig: string;
  power: boolean;
  data: boolean;
  cells: { id: string; circuit: number | null; run: number | null; seq: number | null }[];
  /* 网线号 → 控制器网口号(没写就等于网线号) */
  ports?: Record<string, number>;
  by: string;
  at: number;
}

export interface LedConfig {
  /* 4.1 carried in from 04 校核 — read-only downstream */
  led_opening_w: number;   // mm, must be a whole multiple of mod_w
  led_opening_h: number;   // mm, must be a whole multiple of mod_h
  led_mount_h?: number;    // mm  ≥ 0
  led_ctrl_dist?: number;  // m   > 0
  led_pwr_dist?: number;   // m   > 0
  led_view_min?: number;   // m   > 0

  /* 4.2 chosen by the PM */
  led_screen_type: ScreenType;
  led_pitch: number;               // mm
  led_cabinet: Size;               // primary cabinet, referenced from the library
  led_refresh: 1920 | 3840;        // Hz
  led_nits: number;
  led_install: Install;
  led_maintain: Maintain;
  /* AV-019:不做控制器备份,05 去掉了「冗余策略」;旧方案里的值忽略 */
  led_redundancy?: Redundancy;
  led_ctrl_brand: CtrlBrand;
  led_power_cable: string;         // e.g. "3*2.5"
  /* AV-019(led@1.1):网线走法,按项目定义。缺省 = 每行一条 */
  led_data_mode?: 'row' | 'snake';
  /* AV-019 §2.5:05 里人工改选的控制器 / 播放盒型号(设备库里的型号);不填 = 按 F11 推荐 */
  led_ctrl_model?: string;
  /* AV-019 §2.3:人工调整电源回路 / 网线,随版本保存。只在 led@1.1 生效 */
  led_wiring_override?: WiringOverride;

  /* Project-level overrides of the profile defaults (§3.1). A product with a
     different module pitch — 128-C&K T1 runs 300×168.75 — needs these; without
     an override the profile's values apply. */
  led_cab_lib?: Size[];
  led_mod?: Size;

  /* AV-015: a curved screen read from a picture. The core has no curvature, so
     05 tiles along the arc length (led_opening_w) and 06 lists the curved
     cabinets / flexible modules / curved steel as a line to be quoted. Set only
     from a reviewed image judgement, never typed. */
  led_curve?: LedCurve;
}

export interface LedCurve {
  shape: 'concave' | 'convex';
  given: 'arc' | 'chord' | 'unknown';   // what the annotated width measured
  width: number;                         // as annotated, mm
  arc: number;                           // tiled length, mm
  radius: number | null;
  rise: number | null;
}

/* ===== §9 Provenance — every computed value carries all three labels ===== */

export type Method = 'ai_vision' | 'ai_ocr' | 'rule' | 'manual' | 'lookup';
export type Confidence = number | 'deterministic' | 'confirmed';

export interface Provenance {
  /* 图纸(文件/图层/坐标) | 人工输入(用户) | 公司参数 | 参数组 | 公式输出 */
  source: string;
  method: Method;
  rule?: string;        // formula or rule id when method === 'rule', e.g. "F5"
  confidence: Confidence;
  note?: string;
}

export const provLabel = (p: Provenance): string =>
  p.method === 'rule' && p.rule ? `rule · ${p.rule}` : p.method;

/* One node of the calculation chain. `inputs` names the trace keys this value
   was derived from, which is what the 追溯视图 expands (A9). */
export interface TraceNode {
  key: string;
  value: number;
  unit: string;
  prov: Provenance;
  inputs: string[];
}

/* ===== §5.1 validation findings ===== */

export type Severity = 'block' | 'warn' | 'info';

export interface Finding {
  code: string;         // LED-FIT-01 …
  severity: Severity;
  message: string;
  /* 'compute' blocks the calculation itself; 'export' only bars producing a
     formal deliverable (LED-TYPE-01). */
  gate: 'compute' | 'export';
}
