/* ===== LED technical proposal (技术方案书) · data =====
   Everything the Word template needs, taken from one computation; the Python
   side (services/drawing/avdrawing/proposal.py) only fills slots and picks
   pre-written paragraphs. Template ported from avcost-phase1 (2026-09-28). */

import type { ComputeResult } from './compute.ts';
import type { CtrlBrand } from './types.ts';

const CTRL_NAME: Record<CtrlBrand, string> = { novastar: '诺瓦', colorlight: '卡莱特', other: '其他' };

export interface ProposalPayload {
  title: string;
  client: string;
  packVersion: string;
  profile: string;                 // 参数组名称
  L: number; H: number; pitch: number;
  sqm: number; pxW: number; pxH: number; mods: number; cabinets: number; kw: number;
  nCircuit: number; nPowerCable: number; nDataRun: number; nDataCable: number;
  bom: { w: number; h: number; count: number; inLib: boolean }[];
  custom: boolean;
  circuitKw: number;
  circuitsW: number[];             // load per circuit, W
  control: { name: string; dataPx: number };
  viewMin: number | null;
  pwrDist: number | null;
  findings: { code: string; severity: string; message: string }[];
}

export function proposalPayload(r: ComputeResult, meta: { title: string; client?: string }): ProposalPayload | null {
  if (!r.layout || !r.wiring) return null;
  const v = (k: string) => r.trace[k].value;
  return {
    title: meta.title, client: meta.client ?? '', packVersion: r.pack.version, profile: r.profile.label,
    L: r.cfg.led_opening_w, H: r.cfg.led_opening_h, pitch: r.cfg.led_pitch,
    sqm: v('sqm'), pxW: v('px_w'), pxH: v('px_h'), mods: v('mods'), cabinets: r.layout.cells.length, kw: v('kw'),
    nCircuit: r.wiring.nCircuit, nPowerCable: r.wiring.nPowerCable, nDataRun: r.wiring.nDataRun, nDataCable: r.wiring.nDataCable,
    bom: r.layout.bom.map((b) => ({ w: b.w, h: b.h, count: b.count, inLib: b.inLib })),
    custom: r.layout.custom,
    circuitKw: r.pack.company.circuitKw,
    circuitsW: r.wiring.circuits.map((c) => Math.round(c.kw * 1000)),
    control: { name: CTRL_NAME[r.cfg.led_ctrl_brand], dataPx: r.pack.control.dataPx },
    viewMin: r.cfg.led_view_min ?? null,
    pwrDist: r.cfg.led_pwr_dist ?? null,
    findings: r.findings.map((f) => ({ code: f.code, severity: f.severity, message: f.message })),
  };
}
