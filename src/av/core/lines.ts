/* ===== AV platform · business lines (spec §2.2, §4) =====
   One platform, several lines. LED runs on a calibrated rule pack; projection
   and ELV on draft packs (prj@0.1-draft, elv@0.1-draft, 2026-09-25 decisions)
   that can be configured and costed but not quoted formally; solar is still
   reserved, so 01 shows it but cannot open a project on it yet. */

import { LATEST_ELV_PACK } from './elv/rulepack.ts';
import { LATEST_PRJ_PACK } from './prj/rulepack.ts';
import { LATEST_LED_PACK } from './rulepack.ts';
import type { BusinessLine } from './types.ts';

export interface LineInfo {
  line: BusinessLine;
  label: string;
  en: string;
  prefix: string;          // field prefix, never shared across lines (§4)
  svc: string | null;      // service package it creates in the project, if any
  pack: string | null;     // latest published rule pack; null = not available yet
  draft: boolean;          // pack is uncalibrated: configure and cost, never quote formally
}

export const LINES: LineInfo[] = [
  { line: 'led', label: 'LED 显示屏', en: 'LED display', prefix: 'led_', svc: 'led', pack: LATEST_LED_PACK, draft: false },
  { line: 'projector', label: '投影系统', en: 'Projection', prefix: 'prj_', svc: 'projector', pack: LATEST_PRJ_PACK, draft: true },
  { line: 'elv', label: '弱电系统', en: 'ELV systems', prefix: 'elv_', svc: 'elv', pack: LATEST_ELV_PACK, draft: true },
  { line: 'pv', label: '太阳能光伏', en: 'Solar PV', prefix: 'pv_', svc: null, pack: null, draft: false },
];

export const lineInfo = (line: BusinessLine) => LINES.find((l) => l.line === line)!;
export const isAvailable = (l: LineInfo) => l.pack !== null && l.svc !== null;
