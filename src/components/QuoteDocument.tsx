/* ===== 07 · customer quotation document =====
   Sell prices only; cross-line savings and the discount come off the total,
   library sell prices exclude GST, which is added at the end. Anything not yet
   approved carries a banner so it cannot go out by mistake. Rendered by the
   print page (app/av/quote/[id]) and anywhere a quotation is previewed. */

import React from 'react';
import { lineInfo } from '@/av/core/lines';
import { quoteNo, quoteTotals } from '@/av/core/quote';
import type { Quote } from '@/server/avdb';

const money = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (ms: number) => new Date(ms).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });

export default function QuoteDocument({ quote, project, actions }: {
  quote: Quote; project: { name: string; client: string }; actions?: React.ReactNode;
}) {
  const t = quoteTotals(quote.sections, quote.discountPct, quote.gstRate, quote.dedup);
  const approved = quote.status === 'approved';
  const status = { submitted: '待审批', rejected: '已退回', superseded: '已被新版本取代', approved: '' }[quote.status];

  return (
    <main className="quote-doc">
      <style>{`
        .quote-doc { max-width: 820px; margin: 24px auto; background: #fff; color: #16293B; padding: 44px 48px; font-size: 13px; line-height: 1.6; box-shadow: 0 1px 4px rgba(0,0,0,.12); }
        .quote-doc table { width: 100%; border-collapse: collapse; }
        .quote-doc th { text-align: left; font-size: 11px; color: #5B6168; font-weight: 600; border-bottom: 1px solid #16293B; padding: 6px 8px; }
        .quote-doc td { padding: 7px 8px; border-bottom: 1px solid #E4E2DC; vertical-align: top; }
        .quote-doc .r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .quote-doc h2 { font-size: 14px; margin: 26px 0 6px; }
        @media print {
          @page { size: A4; margin: 14mm; }
          body { background: #fff; }
          .quote-doc, .quote-doc * { visibility: visible; } /* globals.css hides all but export pages in print */
          .quote-doc { margin: 0; padding: 0; box-shadow: none; max-width: none; }
          .no-print { display: none !important; }
        }
      `}</style>
      {actions && <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 18 }}>{actions}</div>}

      {!approved && (
        <div style={{ border: '2px solid #C0392B', color: '#C0392B', padding: '8px 12px', marginBottom: 20, fontWeight: 700 }}>
          {status} · 未经审批，不得对外发出 — NOT APPROVED, NOT FOR ISSUE
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #16293B', paddingBottom: 14 }}>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 2 }}>AUDAX</div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>报价单 QUOTATION</div>
          <div>No. {quoteNo(quote.id)}</div>
          <div>Date {day(approved ? quote.decidedAt : quote.submittedAt)}</div>
        </div>
      </div>

      <table style={{ marginTop: 16 }}>
        <tbody>
          <tr><td style={{ width: 150, color: '#5B6168', border: 0, padding: '2px 0' }}>客户 Client</td><td style={{ border: 0, padding: '2px 0', fontWeight: 600 }}>{project.client || '—'}</td></tr>
          <tr><td style={{ color: '#5B6168', border: 0, padding: '2px 0' }}>项目 Project</td><td style={{ border: 0, padding: '2px 0', fontWeight: 600 }}>{project.name}</td></tr>
        </tbody>
      </table>

      {quote.sections.map((s) => (
        <section key={s.line}>
          <h2>{lineInfo(s.line).label} · {lineInfo(s.line).en}</h2>
          <table>
            <thead>
              <tr><th style={{ width: 28 }}>#</th><th>项目 Description</th><th className="r">数量 Qty</th><th>单位 Unit</th><th className="r">单价 Unit price</th><th className="r">金额 Amount</th></tr>
            </thead>
            <tbody>
              {s.rows.map((r, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{r.name}{r.itemLabel && <div style={{ fontSize: 11, color: '#5B6168' }}>{r.itemLabel}</div>}</td>
                  <td className="r">{r.qty.toLocaleString('en-US')}</td>
                  <td>{r.unit}</td>
                  <td className="r">{money(r.unitList)}</td>
                  <td className="r">{money(r.unitList * r.qty)}</td>
                </tr>
              ))}
              <tr><td colSpan={5} style={{ fontWeight: 600 }}>小计 Section total</td><td className="r" style={{ fontWeight: 600 }}>{money(s.list)}</td></tr>
            </tbody>
          </table>
        </section>
      ))}

      <table style={{ marginTop: 26, width: 360, marginLeft: 'auto' }}>
        <tbody>
          <tr><td>合计 Total</td><td className="r">{money(t.list)}</td></tr>
          {quote.dedup.map((d) => (
            <tr key={d.tag}><td>跨系统共用：{d.label} Shared across systems</td><td className="r">− {money(d.list)}</td></tr>
          ))}
          {t.discount > 0 && <tr><td>折扣 Discount ({quote.discountPct}%)</td><td className="r">− {money(t.discount)}</td></tr>}
          <tr><td>不含税小计 Subtotal (excl. GST)</td><td className="r">{money(t.subtotal)}</td></tr>
          <tr><td>GST {Math.round(quote.gstRate * 100)}%</td><td className="r">{money(t.gst)}</td></tr>
          <tr style={{ fontWeight: 800, fontSize: 15 }}><td style={{ borderBottom: '3px double #16293B' }}>含税总计 Total (incl. GST)</td><td className="r" style={{ borderBottom: '3px double #16293B' }}>S$ {money(t.total)}</td></tr>
        </tbody>
      </table>

      <p style={{ marginTop: 30, fontSize: 11, color: '#5B6168' }}>
        金额单位：新加坡元（SGD）。All amounts in Singapore dollars.
        {approved && ` 审批 Approved by ${quote.decidedBy} · ${day(quote.decidedAt)}`}
      </p>
    </main>
  );
}
