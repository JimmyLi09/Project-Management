/* ===== AV platform · business lines (spec §2.2, §4) =====
   One platform, several lines. Only LED is implemented in phase 1; the others
   are architecturally reserved (§2.2: 投影、弱电、太阳能三条业务线 —— 架构预留，
   本期不实现), so 01 shows them but cannot open a project on them yet. */

import { LATEST_LED_PACK } from './rulepack.ts';
import type { BusinessLine } from './types.ts';

export interface LineInfo {
  line: BusinessLine;
  label: string;
  en: string;
  prefix: string;          // field prefix, never shared across lines (§4)
  svc: string | null;      // service package it creates in the project, if any
  pack: string | null;     // latest published rule pack; null = not available yet
}

export const LINES: LineInfo[] = [
  { line: 'led', label: 'LED 显示屏', en: 'LED display', prefix: 'led_', svc: 'led', pack: LATEST_LED_PACK },
  { line: 'projector', label: '投影系统', en: 'Projection', prefix: 'prj_', svc: 'projector', pack: null },
  { line: 'elv', label: '弱电系统', en: 'ELV systems', prefix: 'elv_', svc: null, pack: null },
  { line: 'pv', label: '太阳能光伏', en: 'Solar PV', prefix: 'pv_', svc: null, pack: null },
];

export const lineInfo = (line: BusinessLine) => LINES.find((l) => l.line === line)!;
export const isAvailable = (l: LineInfo) => l.pack !== null && l.svc !== null;
