'use client';

import React, { useState } from 'react';
import { useStore } from './store';
import { useLang } from '@/lib/i18n';
import { fmtDate, isoDate, parseISO } from '@/lib/project';
import type { Project } from '@/lib/types';

/* ===== REQ-045 「已开 Invoice」弹窗 =====
   项目详情阶段 5 的卡片、项目列表顶部的「缺 Invoice 号」清单共用。
   必填 Invoice 号 + 开票日期(默认今天);选填到期日、备注。确认 = 写进 invoiceClose
   + 自动归档(服务端做,这里只收集和校验)。不记金额 —— 和 Finance 开票区一样,
   金额以 Finance 系统为准。 */
export default function InvoiceModal({ p, onClose, onDone }: { p: Project; onClose: () => void; onDone?: (ref: string) => void }) {
  const { dispatch } = useStore();
  const { t } = useLang();
  const [ref, setRef] = useState('');
  const [day, setDay] = useState(() => isoDate(new Date()));
  const [due, setDue] = useState(p.invoiceClose?.dueDate || '');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function confirm() {
    const r = ref.trim();
    if (!r || !day) { setErr(t('请填 Invoice 号和开票日期', 'Please enter the invoice number and date')); return; }
    if (due && due < day) { setErr(t('到期日不能早于开票日期', 'The due date cannot be before the invoice date')); return; }
    setBusy(true);
    const ok = await dispatch(p.id, { type: 'markInvoiced', invoiceRef: r, issuedDate: day, dueDate: due || undefined, note: note.trim() || undefined });
    setBusy(false);
    if (ok) { onDone?.(r); onClose(); }
  }

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal" style={{ maxWidth: 460 }} data-testid="invoice-modal" role="dialog" aria-label={t('已开 Invoice', 'Invoice issued')}>
        <h2>{t('已开 Invoice', 'Invoice issued')}</h2>
        <div className="msub">{p.name}</div>
        <div className="field">
          <label>{t('Invoice 号', 'Invoice number')} *</label>
          <input className="in" data-testid="invoice-ref" value={ref} autoFocus maxLength={60}
            placeholder={t('如 INV-26-1001', 'e.g. INV-26-1001')}
            onChange={(e) => { setRef(e.target.value); setErr(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') confirm(); }} />
        </div>
        <div className="field">
          <label>{t('开票日期', 'Invoice date')} *</label>
          <input className="in" type="date" data-testid="invoice-date" value={day} onChange={(e) => { setDay(e.target.value); setErr(''); }} />
        </div>
        <div className="field">
          <label>{t('到期日(选填)', 'Payment due (optional)')}</label>
          <input className="in" type="date" data-testid="invoice-due" value={due} onChange={(e) => { setDue(e.target.value); setErr(''); }} />
        </div>
        <div className="field">
          <label>{t('备注(选填)', 'Note (optional)')}</label>
          <input className="in" data-testid="invoice-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
          {t('确认后项目自动归档:项目列表不再显示,「已归档」里能查;财务页继续显示到收款为止。',
            'Once confirmed the project is archived automatically: it leaves the project list (still under “Archived”), and stays on the Finance page until paid.')}
        </div>
        {err && <div data-testid="invoice-err" style={{ fontSize: 12.5, color: 'var(--danger)', marginTop: 8 }}>{err}</div>}
        <div className="modal-actions">
          <button className="btn-line" onClick={onClose} disabled={busy}>{t('取消', 'Cancel')}</button>
          <button className="btn-navy" data-testid="invoice-ok" disabled={busy || !ref.trim() || !day} onClick={confirm}>{t('确认并归档', 'Confirm & archive')}</button>
        </div>
      </div>
    </div>
  );
}

/* 卡片 / 列表行上那句「已开 Invoice · INV-xxxx · 01-Oct」 */
export function invoiceTag(p: Project, lang: 'zh' | 'en'): string | null {
  const inv = p.invoiceClose;
  if (inv?.invoiceStatus !== 'issued' || !inv.invoiceRef) return null;
  const d = parseISO(inv.issuedDate);
  const day = d ? fmtDate(d).slice(0, 6) : '';
  return [lang === 'zh' ? '已开 Invoice' : 'Invoiced', inv.invoiceRef, day].filter(Boolean).join(' · ');
}
