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
  led_redundancy: Redundancy;
  led_ctrl_brand: CtrlBrand;
  led_power_cable: string;         // e.g. "3*2.5"

  /* Project-level overrides of the profile defaults (§3.1). A product with a
     different module pitch — 128-C&K T1 runs 300×168.75 — needs these; without
     an override the profile's values apply. */
  led_cab_lib?: Size[];
  led_mod?: Size;
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
