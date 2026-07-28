'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { fmtDate, todayMid } from '@/lib/project';
import { canEditFinance } from '@/lib/permissions';
import { useLang } from '@/lib/i18n';
import { Icon } from '../ui';
import type { Project } from '@/lib/types';

/* Commercial-status vocabulary — same labels/colors as the workflow panel. */
const COMM: Record<string, [string, string, string]> = {
  not_ready: ['未就绪', 'Not ready', 'var(--text2)'],
  pending_invoice: ['待开票', 'Pending invoice', 'var(--warning)'],
  invoiced: ['已开票', 'Invoiced', 'var(--info)'],
  payment_pending: ['收款中', 'Payment pending', 'var(--warning)'],
  payment_received: ['已收款', 'Received', 'var(--success)'],
  overdue: ['逾期', 'Overdue', 'var(--danger)'],
};
const PAY: Record<string, [string, string]> = {
  pending: ['待收款', 'Pending'],
  partial: ['部分收款', 'Partial'],
  received: ['已收款', 'Received'],
  overdue: ['逾期', 'Overdue'],
};

const GRID = '1.7fr 1fr 130px 96px 96px 104px 150px 40px';

function daysTo(due: string, t0: Date): number | null {
  if (!due) return null;
  const d = new Date(due + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - t0.getTime()) / 86400000);
}

export default function FinanceView() {
  const { projects, me, dispatch, openProject } = useStore();
  const { lang, t } = useLang();
  const [filter, setFilter] = useState<'all' | 'pending_invoice' | 'awaiting' | 'overdue' | 'received'>('all');
  const canFin = canEditFinance(me);
  const t0 = todayMid();

  /* the collection pipeline = every project that has entered commercial flow */
  const rows = useMemo(() => {
    return projects
      .filter((p) => !p.archived && p.commercialStatus && p.commercialStatus !== 'not_ready')
      .sort((a, b) => {
        const rank = (s?: string) => (s === 'overdue' ? 0 : s === 'pending_invoice' ? 1 : s === 'payment_pending' ? 2 : s === 'invoiced' ? 3 : 4);
        const r = rank(a.commercialStatus) - rank(b.commercialStatus);
        if (r) return r;
        return (a.invoiceClose?.dueDate || '').localeCompare(b.invoiceClose?.dueDate || '');
      });
  }, [projects]);

  const count = (fn: (p: Project) => boolean) => rows.filter(fn).length;
  const kpis = {
    pending_invoice: count((p) => p.commercialStatus === 'pending_invoice'),
    awaiting: count((p) => p.commercialStatus === 'invoiced' || p.commercialStatus === 'payment_pending'),
    overdue: count((p) => p.commercialStatus === 'overdue'),
    received: count((p) => p.commercialStatus === 'payment_received'),
  };

  const shown = rows.filter((p) => {
    if (filter === 'all') return true;
    if (filter === 'awaiting') return p.commercialStatus === 'invoiced' || p.commercialStatus === 'payment_pending';
    if (filter === 'pending_invoice') return p.commercialStatus === 'pending_invoice';
    if (filter === 'overdue') return p.commercialStatus === 'overdue';
    if (filter === 'received') return p.commercialStatus === 'payment_received';
    return true;
  });

  function exportCsv() {
    const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = [t('项目', 'Project'), t('客户', 'Client'), t('发票号', 'Invoice Ref'), t('开票日', 'Issued'), t('到期日', 'Due'), t('商业状态', 'Commercial'), t('收款状态', 'Payment'), t('备注', 'Note')];
    const body = rows.map((p) => {
      const inv = p.invoiceClose;
      return [
        p.name, p.client || '', inv?.invoiceRef || '', inv?.issuedDate || '', inv?.dueDate || '',
        (lang === 'zh' ? COMM[p.commercialStatus || 'not_ready'][0] : COMM[p.commercialStatus || 'not_ready'][1]),
        inv ? (lang === 'zh' ? PAY[inv.paymentStatus][0] : PAY[inv.paymentStatus][1]) : '',
        (inv?.financeNote || '').replace(/\n/g, ' '),
      ];
    });
    const csv = [header, ...body].map((r) => r.map(esc).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `collections-${fmtDate(t0)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const chips: [typeof filter, string, string, number][] = [
    ['all', '全部', 'All', rows.length],
    ['pending_invoice', '待开票', 'Pending invoice', kpis.pending_invoice],
    ['awaiting', '已开票待收', 'Awaiting payment', kpis.awaiting],
    ['overdue', '逾期', 'Overdue', kpis.overdue],
    ['received', '已收款', 'Received', kpis.received],
  ];

  return (
    <>
      <div className="kpi-grid four">
        <Kpi label={t('待开票', 'Pending invoice')} value={kpis.pending_invoice} color={kpis.pending_invoice ? 'var(--warning)' : 'var(--navy900)'} sub={t('已核对、等 Finance 开票', 'verified, awaiting Finance')} />
        <Kpi label={t('已开票待收', 'Awaiting payment')} value={kpis.awaiting} color={kpis.awaiting ? 'var(--info)' : 'var(--navy900)'} sub={t('发票已开、款未到齐', 'invoiced, not fully paid')} />
        <Kpi label={t('逾期', 'Overdue')} value={kpis.overdue} color={kpis.overdue ? 'var(--danger)' : 'var(--success)'} sub={t('过了到期日仍未收款', 'past due date, unpaid')} />
        <Kpi label={t('已收款', 'Received')} value={kpis.received} color={'var(--success)'} sub={t('款项已全额到账', 'paid in full')} />
      </div>

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 18, alignItems: 'center' }}>
        {chips.map(([k, zh, en, n]) => (
          <button key={k} className={`chip ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>
            {t(zh, en)} <span className="tnum" style={{ opacity: 0.6 }}>{n}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="btn-line sm" onClick={exportCsv} disabled={rows.length === 0} title={t('导出收款清单', 'Export collections list')}>
          <Icon name="download" size={13} />{t('导出 Excel (CSV)', 'Export CSV')}
        </button>
      </div>

      <div className="panel clip">
        <div className="table-head" style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12 }}>
          <div>{t('项目', 'Project')}</div><div>{t('客户', 'Client')}</div><div>{t('发票号', 'Invoice')}</div>
          <div>{t('开票日', 'Issued')}</div><div>{t('到期日', 'Due')}</div><div>{t('商业状态', 'Commercial')}</div>
          <div>{t('收款', 'Payment')}</div><div />
        </div>

        {shown.length === 0 && (
          <div style={{ padding: 36, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
            ✓ {t('没有匹配的收款项。', 'No matching collections.')}
          </div>
        )}

        {shown.map((p) => {
          const inv = p.invoiceClose;
          const cs = p.commercialStatus || 'not_ready';
          const cm = COMM[cs];
          const dt = inv?.dueDate ? daysTo(inv.dueDate, t0) : null;
          const isOverdue = cs === 'overdue';
          const dueSoon = !isOverdue && cs !== 'payment_received' && dt !== null && dt >= 0 && dt <= 7;
          const issued = inv?.invoiceStatus === 'issued';
          return (
            <div key={p.id} className="row-hover" style={{
              display: 'grid', gridTemplateColumns: GRID, gap: 12, alignItems: 'center',
              padding: '14px 22px', borderBottom: '1px solid var(--row-line)',
              borderLeft: `3px solid ${isOverdue ? 'var(--danger)' : dueSoon ? 'var(--warning)' : 'transparent'}`,
            }}>
              <div style={{ minWidth: 0, cursor: 'pointer' }} onClick={() => openProject(p.id)}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--navy900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.client || '—'}</div>
              <div className="tnum" style={{ fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{inv?.invoiceRef || <span style={{ color: '#b6bfc9' }}>—</span>}</div>
              <div className="tnum" style={{ fontSize: 12, color: 'var(--text2)' }}>{inv?.issuedDate || '—'}</div>
              <div className="tnum" style={{ fontSize: 12, color: isOverdue ? 'var(--danger)' : dueSoon ? 'var(--warning)' : 'var(--text2)', fontWeight: isOverdue || dueSoon ? 600 : 400 }}>
                {inv?.dueDate || '—'}
                {dueSoon && dt !== null && <div style={{ fontSize: 10 }}>{t(`剩 ${dt} 天`, `${dt}d left`)}</div>}
              </div>
              <div>
                <span className="badge" style={{ background: 'var(--hover-bg)', color: cm[2] }}>
                  <span className="bdot" style={{ background: cm[2] }} />{lang === 'zh' ? cm[0] : cm[1]}
                </span>
              </div>
              <div style={{ minWidth: 0 }}>
                {canFin && issued && cs !== 'payment_received' ? (
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {(['partial', 'received', 'overdue'] as const).map((s) => (
                      <button key={s} className="btn-line sm" style={{ padding: '3px 8px', fontSize: 11 }}
                        onClick={() => dispatch(p.id, { type: 'setPaymentStatus', value: s })}>
                        {lang === 'zh' ? PAY[s][0] : PAY[s][1]}
                      </button>
                    ))}
                  </div>
                ) : canFin && cs === 'pending_invoice' ? (
                  <button className="btn-line sm" style={{ padding: '3px 9px', fontSize: 11 }} onClick={() => openProject(p.id)}>{t('去开票 →', 'Issue →')}</button>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--text2)' }}>{inv ? (lang === 'zh' ? PAY[inv.paymentStatus][0] : PAY[inv.paymentStatus][1]) : '—'}</span>
                )}
              </div>
              <button aria-label="Open project" onClick={() => openProject(p.id)}
                style={{ width: 30, height: 30, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="edit" size={13} />
              </button>
            </div>
          );
        })}
      </div>

      {!canFin && (
        <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 12 }}>
          {t('只读视图。开票 / 收款状态仅 Finance 角色可修改。', 'Read-only view — invoice / payment status is editable by the Finance role only.')}
        </div>
      )}
    </>
  );
}

function Kpi({ label, value, sub, color }: { label: string; value: number; sub: string; color: string }) {
  return (
    <div className="kpi" style={{ padding: '20px 22px' }}>
      <div className="kpi-label">{label}</div>
      <div className="tnum" style={{ fontSize: 34, fontWeight: 600, color, marginTop: 6, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6 }}>{sub}</div>
    </div>
  );
}
