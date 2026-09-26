/* ===== 07 报价审批 · quotation maths =====
   A quotation bundles the confirmed cost sheets of some of a project's business
   lines (2026-09-26 decision: draft or outdated sheets never enter a quote),
   takes off the cross-line shared-resource savings (xline.ts), applies one
   discount to what is left and adds GST on top — library sell prices are
   exclusive of GST. Every quotation needs PD / BD approval; one
   whose discounted margin falls below the company floor needs a reason. */

import { round2, type CostCheck, type CostLine } from './pricing.ts';
import type { BusinessLine } from './types.ts';
import { dedupTotals, XLINE_PACK, type Deduction } from './xline.ts';

export const GST_RATE = 0.09; // Singapore GST from 2024-01-01

/* Where a line stands for quoting. */
export type LineState = 'none' | 'draft' | 'outdated' | 'confirmed';

export function lineState(sheet: { status: string; configId: number } | null, configId: number | null): LineState {
  if (!sheet) return 'none';
  if (configId !== null && sheet.configId !== configId) return 'outdated';
  return sheet.status === 'confirmed' ? 'confirmed' : 'draft';
}

/* One business line inside a quotation: the sheet it came from, with sell
   prices only on the rows (the customer document never shows cost). */
export interface QuoteSection {
  line: BusinessLine;
  sheetId: number;
  cost: number;
  list: number;
  rows: { name: string; itemLabel: string; qty: number; unit: string; unitList: number }[];
}

export const toSection = (line: BusinessLine, sheet: { id: number; cost: number; list: number; lines: CostLine[] }): QuoteSection => ({
  line, sheetId: sheet.id, cost: sheet.cost, list: sheet.list,
  rows: sheet.lines.map((l) => ({ name: l.name, itemLabel: l.itemLabel, qty: l.qty, unit: l.unit, unitList: l.unitList ?? 0 })),
});

export interface QuoteTotals {
  list: number;       // sell total of the sections
  shared: number;     // cross-line savings taken off the sell total
  discount: number;   // on list − shared
  subtotal: number;   // after savings and discount, before GST
  gst: number;
  total: number;      // incl. GST
  cost: number;
  margin: number | null; // on the discounted subtotal
}

export function quoteTotals(sections: QuoteSection[], discountPct: number, gstRate: number, dedup: Deduction[] = []): QuoteTotals {
  const saved = dedupTotals(dedup);
  const list = round2(sections.reduce((a, s) => a + s.list, 0));
  const cost = round2(sections.reduce((a, s) => a + s.cost, 0) - saved.cost);
  const discount = round2((list - saved.list) * discountPct / 100);
  const subtotal = round2(list - saved.list - discount);
  const gst = round2(subtotal * gstRate);
  return { list, shared: saved.list, discount, subtotal, gst, total: round2(subtotal + gst), cost, margin: subtotal > 0 ? (subtotal - cost) / subtotal : null };
}

/* What stops a quotation from being submitted, and what the approver should see. */
export function quoteChecks(sections: QuoteSection[], discountPct: number, t: QuoteTotals, marginFloor: number, reason: string, dedup: Deduction[] = []): CostCheck[] {
  const out: CostCheck[] = [];
  if (dedup.length && !XLINE_PACK.calibrated) {
    out.push({ code: 'QUOTE-XLINE', severity: 'warn', message: `已按跨业务线去重草案 ${XLINE_PACK.version} 扣减共用资源 S$${t.shared.toLocaleString('en-US')}，扣减比例未经校准，请审批人核对。` });
  }
  if (!sections.length) out.push({ code: 'QUOTE-EMPTY', severity: 'block', message: '至少选择一条已确认成本的业务线。' });
  if (!(discountPct >= 0 && discountPct < 100)) out.push({ code: 'QUOTE-DISC', severity: 'block', message: '折扣须在 0–100% 之间。' });
  if (sections.length && t.margin !== null && t.margin < marginFloor) {
    out.push(reason.trim()
      ? { code: 'QUOTE-MARGIN', severity: 'warn', message: `折后毛利 ${(t.margin * 100).toFixed(1)}% 低于公司下限 ${(marginFloor * 100).toFixed(0)}%，已填写理由，由审批人决定。` }
      : { code: 'QUOTE-MARGIN', severity: 'block', message: `折后毛利 ${(t.margin * 100).toFixed(1)}% 低于公司下限 ${(marginFloor * 100).toFixed(0)}%，须填写理由。` });
  }
  return out;
}

export const quoteNo = (id: number) => `AVQ-${String(id).padStart(4, '0')}`;
