'use client';

/* ===== 07 报价审批 =====
   Put a quotation together from the lines whose cost is confirmed on their
   latest configuration, apply a discount, see GST and the discounted margin
   against the company floor, and submit it. PD / BD approve or send back; the
   approved quotation prints from its own page. Decisions of 2026-09-26. */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { lineInfo, LINES } from '@/av/core/lines';
import { quoteChecks, quoteNo, quoteTotals, type LineState, type QuoteSection } from '@/av/core/quote';
import type { BusinessLine } from '@/av/core/types';
import { canViewPrices } from '@/lib/permissions';
import { fmtDate } from '@/lib/project';
import { useLang } from '@/lib/i18n';
import { useStore } from '../store';
import AvSteps from './AvSteps';

interface LineRow { line: BusinessLine; state: LineState; cost: number | null; list: number | null }
interface Quote {
  id: number; sections: QuoteSection[]; discountPct: number; gstRate: number; marginFloor: number; reason: string;
  status: 'submitted' | 'approved' | 'rejected' | 'superseded';
  submittedBy: string; submittedAt: number; decidedBy: string; decidedAt: number; decisionNote: string;
}
interface State { lines: LineRow[]; quotes: Quote[]; marginFloor: number; gstRate: number; canSubmit: boolean; canApprove: boolean }

const money = (v: number) => `S$ ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
const AV_SVCS = LINES.map((l) => l.svc).filter(Boolean) as string[];

export default function AvQuoteView() {
  const { me, projects, ledProjectId, setLedProjectId, go } = useStore();
  const { t } = useLang();
  const [state, setState] = useState<State | null>(null);
  const [picked, setPicked] = useState<BusinessLine[]>([]);
  const [discount, setDiscount] = useState('0');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const avProjects = useMemo(() => projects.filter((p) => !p.archived && p.packages.some((k) => AV_SVCS.includes(k.svc))), [projects]);
  const project = avProjects.find((p) => p.id === ledProjectId);

  const load = useCallback(async () => {
    setState(null); setError('');
    if (!project) return;
    const res = await fetch(`/api/av/quote?project=${encodeURIComponent(project.id)}`).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : { error: '网络错误' };
    if (!res?.ok || body.error) { setError(body.error || '加载失败'); return; }
    setState(body as State);
    setPicked((body as State).lines.filter((l) => l.state === 'confirmed').map((l) => l.line));
  }, [project]);
  useEffect(() => { setMsg(''); setDiscount('0'); setReason(''); load(); }, [load]);

  /* the preview uses totals only; the server rebuilds the sections from the sheets */
  const preview = useMemo(() => {
    if (!state) return null;
    const sections = state.lines.filter((l) => picked.includes(l.line) && l.state === 'confirmed')
      .map((l) => ({ line: l.line, sheetId: 0, cost: l.cost!, list: l.list!, rows: [] }));
    const d = Number(discount);
    const totals = quoteTotals(sections, d, state.gstRate);
    return { totals, checks: quoteChecks(sections, d, totals, state.marginFloor, reason) };
  }, [state, picked, discount, reason]);

  if (!canViewPrices(me)) {
    return <><AvSteps /><div className="panel" style={{ padding: '18px 20px', fontSize: 13, color: 'var(--text2)' }}>{t('当前角色无权查看报价。', 'Your role cannot see quotations.')}</div></>;
  }

  async function post(url: string, data: unknown, done: string) {
    setBusy(true); setError(''); setMsg('');
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : { error: '网络错误' };
    setBusy(false);
    if (!res?.ok || body.error) { setError(body.error || '操作失败'); return; }
    await load();
    setMsg(done);
  }

  const STATE: Record<LineState, [string, string, string]> = {
    confirmed: ['可报价', 'Ready', 'var(--success)'],
    draft: ['成本未确认', 'Cost not confirmed', 'var(--warning)'],
    outdated: ['方案已改，需重算', 'Recalculate', 'var(--warning)'],
    none: ['未核算', 'Not costed', 'var(--text2)'],
  };
  const STATUS: Record<Quote['status'], [string, string, string]> = {
    submitted: ['待审批', 'Pending', 'var(--warning)'],
    approved: ['已批准', 'Approved', 'var(--success)'],
    rejected: ['已退回', 'Sent back', 'var(--danger)'],
    superseded: ['已被新版本取代', 'Superseded', 'var(--text2)'],
  };
  const blocks = preview?.checks.filter((c) => c.severity === 'block') ?? [];
  const below = !!preview && preview.totals.margin !== null && preview.totals.margin < state!.marginFloor;

  return (
    <>
      <AvSteps />
      <div style={{ display: 'grid', gap: 20 }}>
        <div className="panel" style={{ padding: 0 }}>
          <div className="panel-head"><span className="panel-title">{t('项目', 'Project')}</span></div>
          <div style={{ padding: '14px 18px', display: 'grid', gap: 10 }}>
            <div className="field" style={{ marginBottom: 0, maxWidth: 520 }}>
              <label htmlFor="quote-project">{t('项目', 'Project')}</label>
              <select id="quote-project" value={project ? project.id : ''} onChange={(e) => setLedProjectId(e.target.value)}>
                <option value="">{t('— 选择项目 —', '— choose a project —')}</option>
                {avProjects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.client ? ` · ${p.client}` : ''}</option>)}
              </select>
            </div>
            {error && <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>{error}</div>}
            {msg && <div style={{ fontSize: 12.5, color: 'var(--success)' }}>{msg}</div>}
          </div>
        </div>

        {state && preview && (
          <div className="panel clip" style={{ padding: 0 }}>
            <div className="panel-head">
              <span className="panel-title">{t('新建报价', 'New quotation')}</span>
              <span style={{ fontSize: 11, color: 'var(--text2)' }}>{t('只收成本已确认的业务线；售价不含税，另加 GST', 'Confirmed lines only; GST added on top')}</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
                <tbody>
                  <tr>{['', t('业务线', 'Line'), t('状态', 'Status'), t('成本', 'Cost'), t('售价', 'Sell'), t('毛利率', 'Margin')].map((h, i) => <th key={i} style={i >= 3 ? { ...th, textAlign: 'right' } : th}>{h}</th>)}</tr>
                  {state.lines.map((l) => {
                    const ok = l.state === 'confirmed';
                    const [zh, en, color] = STATE[l.state];
                    return (
                      <tr key={l.line}>
                        <td style={{ ...td, width: 36 }}>
                          <input type="checkbox" aria-label={lineInfo(l.line).label} disabled={!ok || !state.canSubmit} checked={ok && picked.includes(l.line)}
                            onChange={(e) => setPicked(e.target.checked ? [...picked, l.line] : picked.filter((x) => x !== l.line))} />
                        </td>
                        <td style={{ ...td, fontWeight: 600 }}>{t(lineInfo(l.line).label, lineInfo(l.line).en)}</td>
                        <td style={{ ...td, color }}>
                          {t(zh, en)}
                          {!ok && l.state !== 'none' && (
                            <button style={{ marginLeft: 8, fontSize: 12, textDecoration: 'underline', color: 'var(--navy700)' }} onClick={() => go('avcost')}>{t('去 06', 'Open 06')}</button>
                          )}
                        </td>
                        <td style={{ ...td, textAlign: 'right' }} className="tnum">{l.cost === null ? '—' : money(l.cost)}</td>
                        <td style={{ ...td, textAlign: 'right' }} className="tnum">{l.list === null ? '—' : money(l.list)}</td>
                        <td style={{ ...td, textAlign: 'right' }} className="tnum">{pct(l.cost !== null && l.list ? (l.list - l.cost) / l.list : null)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,340px)', gap: 20, alignItems: 'start' }}>
              <div style={{ display: 'grid', gap: 12 }}>
                <div className="field" style={{ marginBottom: 0, maxWidth: 200 }}>
                  <label htmlFor="quote-discount">{t('折扣 %（作用于售价合计）', 'Discount %')}</label>
                  <input id="quote-discount" type="number" min={0} max={99} step="0.5" value={discount} disabled={!state.canSubmit} onChange={(e) => setDiscount(e.target.value)} />
                </div>
                {below && (
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor="quote-reason">{t(`折后毛利低于公司下限 ${(state.marginFloor * 100).toFixed(0)}%，请填写理由`, 'Reason for margin below floor')}</label>
                    <textarea id="quote-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
                  </div>
                )}
                {preview.checks.map((c) => (
                  <div key={c.code} style={{ fontSize: 12.5, color: c.severity === 'block' ? 'var(--danger)' : 'var(--warning)' }}>● {c.message}</div>
                ))}
                {state.canSubmit ? (
                  <button className="btn-navy" style={{ justifySelf: 'start', ...(busy || blocks.length ? { opacity: 0.45, cursor: 'not-allowed' } : {}) }}
                    disabled={busy || blocks.length > 0}
                    onClick={() => post('/api/av/quote', { projectId: project!.id, lines: picked, discountPct: Number(discount), reason }, t('已提交，等待 PD / BD 审批。', 'Submitted for approval.'))}>
                    {t('提交审批', 'Submit for approval')}
                  </button>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--text2)' }}>{t('报价由销售、PD / BD 或该项目的 PM 提交。', 'Sales, PD / BD or the project PM submit quotations.')}</div>
                )}
                {state.quotes.some((q) => q.status === 'submitted') && (
                  <div style={{ fontSize: 12, color: 'var(--text2)' }}>{t('已有一份待审批的报价；再次提交会取代它。', 'A pending quotation exists; submitting replaces it.')}</div>
                )}
              </div>
              <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
                <tbody>
                  {([
                    [t('售价合计', 'Sell total'), money(preview.totals.list)],
                    [t('折扣', 'Discount'), `− ${money(preview.totals.discount)}`],
                    [t('不含税小计', 'Subtotal excl. GST'), money(preview.totals.subtotal)],
                    [`GST ${Math.round(state.gstRate * 100)}%`, money(preview.totals.gst)],
                    [t('含税总计', 'Total incl. GST'), money(preview.totals.total)],
                    [t('成本', 'Cost'), money(preview.totals.cost)],
                    [t('折后毛利率', 'Margin after discount'), pct(preview.totals.margin)],
                  ] as const).map(([k, v], i) => (
                    <tr key={k} style={i === 4 ? { fontWeight: 700 } : undefined}>
                      <td style={{ ...td, color: i >= 5 ? 'var(--text2)' : undefined }}>{k}</td>
                      <td style={{ ...td, textAlign: 'right', color: i === 6 && below ? 'var(--danger)' : undefined }} className="tnum">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {state && (
          <div className="panel clip" style={{ padding: 0 }}>
            <div className="panel-head"><span className="panel-title">{t('报价记录', 'Quotations')}</span></div>
            {state.quotes.length === 0 ? (
              <p style={{ padding: '14px 18px', fontSize: 13, color: 'var(--text2)' }}>{t('该项目还没有报价。', 'No quotations yet.')}</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}>
                  <tbody>
                    <tr>{[t('编号', 'No.'), t('业务线', 'Lines'), t('含税总计', 'Total'), t('折后毛利', 'Margin'), t('提交', 'Submitted'), t('状态', 'Status'), ''].map((h, i) => <th key={i} style={i === 2 || i === 3 ? { ...th, textAlign: 'right' } : th}>{h}</th>)}</tr>
                    {state.quotes.map((q) => {
                      const tt = quoteTotals(q.sections, q.discountPct, q.gstRate);
                      const [zh, en, color] = STATUS[q.status];
                      return (
                        <tr key={q.id}>
                          <td style={{ ...td, fontWeight: 600 }}>{quoteNo(q.id)}</td>
                          <td style={td}>{q.sections.map((s) => t(lineInfo(s.line).label, lineInfo(s.line).en)).join(' + ')}
                            {q.discountPct > 0 && <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>{t('折扣', 'discount')} {q.discountPct}%</div>}
                          </td>
                          <td style={{ ...td, textAlign: 'right' }} className="tnum">{money(tt.total)}</td>
                          <td style={{ ...td, textAlign: 'right', color: tt.margin !== null && tt.margin < q.marginFloor ? 'var(--danger)' : undefined }} className="tnum">{pct(tt.margin)}</td>
                          <td style={td}>{q.submittedBy}<div style={{ fontSize: 11.5, color: 'var(--text2)' }}>{fmtDate(new Date(q.submittedAt))}</div></td>
                          <td style={td}>
                            <span style={{ color, fontWeight: 600 }}>{t(zh, en)}</span>
                            {q.decidedBy && <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>{q.decidedBy} · {fmtDate(new Date(q.decidedAt))}</div>}
                            {q.reason && <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>{t('理由：', 'Reason: ')}{q.reason}</div>}
                            {q.decisionNote && <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>{t('意见：', 'Note: ')}{q.decisionNote}</div>}
                          </td>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}>
                            <a href={`/av/quote/${q.id}`} target="_blank" rel="noreferrer" style={{ color: 'var(--navy700)', textDecoration: 'underline', fontSize: 12.5 }}>
                              {q.status === 'approved' ? t('报价单', 'Quotation') : t('预览', 'Preview')}
                            </a>
                            {q.status === 'submitted' && state.canApprove && (
                              <div style={{ display: 'grid', gap: 6, marginTop: 8, minWidth: 200 }}>
                                <input className="in sm" placeholder={t('审批意见（退回必填）', 'Note (required to send back)')} value={notes[q.id] ?? ''}
                                  onChange={(e) => setNotes({ ...notes, [q.id]: e.target.value })} />
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button className="btn-navy" style={{ height: 32 }} disabled={busy}
                                    onClick={() => post(`/api/av/quote/${q.id}`, { action: 'approve', note: notes[q.id] ?? '' }, t('已批准。', 'Approved.'))}>{t('批准', 'Approve')}</button>
                                  <button className="btn-line" style={{ height: 32 }} disabled={busy}
                                    onClick={() => post(`/api/av/quote/${q.id}`, { action: 'reject', note: notes[q.id] ?? '' }, t('已退回。', 'Sent back.'))}>{t('退回', 'Send back')}</button>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p style={{ padding: '12px 18px 16px', fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
              {t('报价锁定提交时的成本表、折扣、GST 税率与毛利下限；之后改价或改方案不影响已提交的报价，需要时重新提交。',
                'A quotation freezes the sheets, discount, GST rate and margin floor at submission.')}
            </p>
          </div>
        )}
      </div>
    </>
  );
}

const th: React.CSSProperties = {
  padding: '10px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
  color: 'var(--text2)', background: 'var(--hover-bg)', textAlign: 'left', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { padding: '9px 14px', borderTop: '1px solid var(--row-line)', verticalAlign: 'top' };
