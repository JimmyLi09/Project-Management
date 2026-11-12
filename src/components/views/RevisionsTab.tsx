'use client';

/* ===== REQ-063 · 项目详情 · 修改记录 =====
   每个服务包一张:PM 每收到一轮客户修改记一条。轮次只数「客户」的;「内部」的只留记录。
   第 1、2 轮免费;第 3 轮提醒发 E5 邮件(带知识库模板链接);第 4 轮起应收费,给 Sales 一条
   「48 小时内出 revised quotation」的待办。数字都在「规则设置 · KPI 规则」里,跟着规则版本走。
   不记金额(金额仍以报价 / Finance 为准);和 Variation、完工审批互不影响。
   谁能做什么见 lib/permissions.ts 的 canRecordRev 等 —— 按钮按它显示,后端按它拦。 */
import React, { useEffect, useState } from 'react';
import { useStore, useWho } from '../store';
import { useLang } from '@/lib/i18n';
import { canEditRev, canQuoteRev, canRecordRev, canWaiveRev, pmLocked } from '@/lib/permissions';
import {
  FEE_TEXT, clientRounds, needsReasonMeeting, quoteOverdue, revsOf, roundMap,
  type RevFee, type RevRules, type RevSrc,
} from '@/lib/revisions';
import { svcColor, svcName } from '@/lib/templates';
import { pkgSuffix } from '@/lib/project';
import { localDay } from '@/lib/localDate';
import type { Project, ServicePackage } from '@/lib/types';
import type { KbDoc } from '@/lib/kb';

/* 知识库里的 E5 邮件模板:标题里带「E5」的那篇。找不到就不给链接,提示一句 */
let kbCache: Promise<KbDoc[]> | null = null;
export function useKbDocMatching(re: RegExp): KbDoc | null {
  const [doc, setDoc] = useState<KbDoc | null>(null);
  useEffect(() => {
    kbCache ||= fetch('/api/kb').then((r) => (r.ok ? r.json() : { docs: [] })).then((j) => (j.docs || []) as KbDoc[]).catch(() => []);
    let alive = true;
    kbCache.then((docs) => { if (alive) setDoc(docs.find((d) => re.test(`${d.title} ${d.titleEn || ''}`)) || null); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [re.source]);
  return doc;
}
export const E5_RE = /\bE5\b/i;

export const FEE_STYLE: Record<RevFee, { bg: string; color: string }> = {
  free: { bg: '#e6f2ec', color: '#0f6a48' },
  due: { bg: '#fbf0dc', color: '#a8690b' },
  quoted: { bg: '#e8eff9', color: '#2c5aa0' },
  confirmed: { bg: '#e6f2ec', color: '#0f6a48' },
  waived: { bg: 'var(--hover-bg)', color: 'var(--text2)' },
};

export default function RevisionsTab({ p }: { p: Project }) {
  const { me, kpiRules } = useStore();
  const { t } = useLang();
  const rules = kpiRules.rev;
  const e5 = useKbDocMatching(E5_RE);
  const locked = pmLocked(me, p);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} data-testid="rev-tab">
      <div className="panel" style={{ padding: '12px 18px', fontSize: 12, color: 'var(--text2)', lineHeight: 1.75 }}>
        {t(`每收到一轮客户修改记一条。第 1 – ${rules.chargeFrom - 1} 轮免费;第 ${rules.e5Round} 轮提醒发 E5 邮件;第 ${rules.chargeFrom} 轮起应收费,自动给 Sales 一条「${rules.quoteHours} 小时内出 revised quotation」的待办。`,
           `Record each round of client changes. Rounds 1 – ${rules.chargeFrom - 1} are free; round ${rules.e5Round} triggers the E5 email reminder; from round ${rules.chargeFrom} the round is chargeable and Sales gets a to-do to send a revised quotation within ${rules.quoteHours} hours.`)}
        <br />
        {t('来源选「内部」的(内审、自己发现的错)不算轮次,只留记录。这里不记金额 —— 金额以报价和 Finance 为准;记修改不会触发 Variation 或重新审批。',
           'Internal entries (internal review, own mistakes) are not rounds — they are kept for the record only. No amounts here — the quotation and Finance remain the source; recording a revision does not trigger a Variation or re-approval.')}
        {locked && <><br /><b>{t('项目已进入开票 / 收尾,PM 端只读。', 'This project is in invoicing / close-out — read-only for PM.')}</b></>}
      </div>
      {p.packages.map((pk, pi) => <PkgRevisions key={pk.id || pi} p={p} pk={pk} pi={pi} rules={rules} e5={e5} />)}
    </div>
  );
}

function PkgRevisions({ p, pk, pi, rules, e5 }: { p: Project; pk: ServicePackage; pi: number; rules: RevRules; e5: KbDoc | null }) {
  const { me, dispatch, setToast, setView } = useStore();
  const { lang, t } = useLang();
  const who = useWho();
  const revs = revsOf(pk);
  const rm = roundMap(pk);
  const n = clientRounds(pk);
  const charged = revs.filter((r) => r.fee && r.fee !== 'free');
  const confirmed = charged.filter((r) => r.fee === 'confirmed').length;
  const canAdd = canRecordRev(me, p);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{ date: string; src: RevSrc; note: string }>({ date: localDay(), src: 'client', note: '' });
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ date: string; src: RevSrc; note: string }>({ date: '', src: 'client', note: '' });
  const [waiveId, setWaiveId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const now = Date.now();
  const name = `${svcName(pk.svc, lang)}${pkgSuffix(p, pi) ? ` · ${pkgSuffix(p, pi)}` : ''}`;

  const act = async (a: Parameters<typeof dispatch>[1], ok?: string) => {
    setBusy(true);
    const done = await dispatch(p.id, a, { onError: (m) => setToast(`⚠ ${m}`) });
    setBusy(false);
    if (done && ok) setToast(ok);
    return done;
  };

  async function add() {
    const next = form.src === 'client' ? n + 1 : 0;
    const ok = next >= rules.chargeFrom
      ? t(`第 ${next} 轮:已标为应收费,并给 Sales 一条 ${rules.quoteHours} 小时内报价的待办`, `Round ${next}: marked chargeable; Sales has a to-do to quote within ${rules.quoteHours} h`)
      : next === rules.e5Round ? t(`第 ${next} 轮:请发 E5 提醒邮件`, `Round ${next}: please send the E5 reminder email`)
      : next ? t(`已记第 ${next} 轮(免费)`, `Round ${next} recorded (free)`) : t('已记一条内部修改', 'Internal entry recorded');
    if (await act({ type: 'addRevision', pkg: pi, src: form.src, date: form.date, note: form.note }, ok)) {
      setAdding(false); setForm({ date: localDay(), src: 'client', note: '' });
    }
  }

  return (
    <div className="panel clip" data-testid={`rev-pkg-${pi}`}>
      <div className="panel-head" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ width: 9, height: 9, borderRadius: 3, background: svcColor(pk.svc) }} />
        <span className="panel-title">{name}</span>
        <span className="badge" data-testid="rev-count" style={{ background: 'var(--hover-bg)', color: 'var(--text2)' }}>{t(`客户修改 ${n} 轮`, `${n} client round(s)`)}</span>
        {charged.length > 0 && (
          <span className="badge" style={{ background: '#fbf0dc', color: '#a8690b' }}>
            {t(`应收费 ${charged.length} 轮 · 已确认 ${confirmed}`, `${charged.length} chargeable · ${confirmed} confirmed`)}
          </span>
        )}
        {pk.reasonMeeting && (
          <span className="badge" data-testid="rev-meeting-done" style={{ background: '#e6f2ec', color: '#0f6a48' }}
            title={`${pk.reasonMeeting.note} — ${who(pk.reasonMeeting.by)} ${localDay(new Date(pk.reasonMeeting.at))}`}>
            {t('已开原因会', 'Review meeting held')}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {canAdd && !adding && (
          <button className="btn-navy sm" data-testid={`rev-add-${pi}`} onClick={() => setAdding(true)}>＋ {t('记一轮修改', 'Record a revision')}</button>
        )}
      </div>

      {needsReasonMeeting(pk, rules) && (
        <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--row-line)', background: '#fdf6ea' }}>
          <ReasonMeeting p={p} pi={pi} pk={pk} rules={rules} />
        </div>
      )}

      {adding && (
        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--row-line)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start', background: 'var(--hover-bg)' }}>
          <input className="in sm" type="date" style={{ width: 150 }} value={form.date} data-testid="rev-date" aria-label={t('日期', 'Date')}
            onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <select className="in sm" style={{ width: 'auto' }} value={form.src} data-testid="rev-src" aria-label={t('来源', 'Source')}
            onChange={(e) => setForm({ ...form, src: e.target.value as RevSrc })}>
            <option value="client">{t('客户', 'Client')}</option>
            <option value="internal">{t('内部(不算轮次)', 'Internal (not a round)')}</option>
          </select>
          <textarea className="in" style={{ flex: 1, minWidth: 260, minHeight: 56 }} value={form.note} data-testid="rev-note"
            placeholder={t('这一轮改了什么(必填)', 'What changed in this round (required)')} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <span style={{ display: 'flex', gap: 6 }}>
            <button className="btn-navy sm" data-testid="rev-save" disabled={busy || !form.note.trim() || !form.date} onClick={add}>{t('保存', 'Save')}</button>
            <button className="btn-line sm" onClick={() => setAdding(false)}>{t('取消', 'Cancel')}</button>
          </span>
        </div>
      )}

      {revs.length === 0 ? (
        <div style={{ padding: 18, fontSize: 12.5, color: 'var(--text2)' }}>{t('还没有修改记录。', 'No revisions recorded yet.')}</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 64 }}>{t('轮次', 'Round')}</th>
                <th style={{ ...th, width: 110 }}>{t('日期', 'Date')}</th>
                <th style={{ ...th, width: 70 }}>{t('来源', 'Source')}</th>
                <th style={th}>{t('修改内容', 'What changed')}</th>
                <th style={{ ...th, width: 250 }}>{t('收费', 'Charge')}</th>
                <th style={{ ...th, width: 210 }} />
              </tr>
            </thead>
            <tbody>
              {revs.map((r) => {
                const round = rm.get(r.id);
                const over = quoteOverdue(r, rules, now);
                const editing = editId === r.id;
                return (
                  <React.Fragment key={r.id}>
                    <tr data-testid="rev-row" data-round={round ?? ''} data-fee={r.fee || ''} data-src={r.src}>
                      <td style={cell}><b className="tnum">{round ? `R${round}` : '—'}</b></td>
                      <td style={cell}>
                        {editing ? <input className="in sm" type="date" style={{ width: 140 }} value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} /> : <span className="tnum">{r.date}</span>}
                      </td>
                      <td style={cell}>
                        {editing ? (
                          <select className="in sm" style={{ width: 'auto' }} value={edit.src} onChange={(e) => setEdit({ ...edit, src: e.target.value as RevSrc })}>
                            <option value="client">{t('客户', 'Client')}</option>
                            <option value="internal">{t('内部', 'Internal')}</option>
                          </select>
                        ) : r.src === 'client' ? t('客户', 'Client') : <span style={{ color: 'var(--text2)' }}>{t('内部', 'Internal')}</span>}
                      </td>
                      <td style={cell}>
                        {editing
                          ? <textarea className="in" style={{ width: '100%', minHeight: 48 }} value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
                          : <span style={{ whiteSpace: 'pre-wrap' }}>{r.note}</span>}
                        {!editing && round === rules.e5Round && (
                          <div data-testid="rev-e5" style={{ fontSize: 11.5, color: '#a8690b', marginTop: 4 }}>
                            ⚠ {t(`第 ${rules.e5Round} 轮:请发 E5「第 ${rules.e5Round} 轮提醒」邮件,请客户一次汇总意见`, `Round ${rules.e5Round}: send the E5 “round ${rules.e5Round} reminder” email asking the client to consolidate all comments`)}
                            {' '}
                            {e5
                              ? <button data-testid="rev-e5-link" style={{ color: 'var(--info)', textDecoration: 'underline' }} onClick={() => setView({ name: 'knowledge', sub: `doc:${e5.id}` })}>{t('看模板', 'Open template')}</button>
                              : <span style={{ color: 'var(--text2)' }}>{t('(知识库里还没有标题含「E5」的邮件模板)', '(no knowledge-base doc with “E5” in its title yet)')}</span>}
                          </div>
                        )}
                        <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 3 }}>
                          {who(r.by)} · {localDay(new Date(r.at))}{r.editedBy ? ` · ${t('改过', 'edited')} ${who(r.editedBy)}` : ''}
                        </div>
                      </td>
                      <td style={cell}>
                        {r.fee ? (
                          <>
                            <span className="badge" data-testid="rev-fee" style={{ background: FEE_STYLE[r.fee].bg, color: FEE_STYLE[r.fee].color }}>
                              {lang === 'zh' ? FEE_TEXT[r.fee][0] : FEE_TEXT[r.fee][1]}
                            </span>
                            {over && <div data-testid="rev-overdue" style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 3, fontWeight: 600 }}>{t(`已超过 ${rules.quoteHours} 小时`, `Over ${rules.quoteHours} h`)}</div>}
                            {r.fee === 'waived' && r.waiveReason && <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 3 }}>{t('原因', 'Reason')}:{r.waiveReason}</div>}
                          </>
                        ) : <span style={{ color: 'var(--text2)' }}>—</span>}
                      </td>
                      <td style={{ ...cell, textAlign: 'right' }}>
                        <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          {editing ? (
                            <>
                              <button className="btn-navy sm" disabled={busy || !edit.note.trim() || !edit.date}
                                onClick={async () => { if (await act({ type: 'editRevision', pkg: pi, id: r.id, ...edit }, t('已保存', 'Saved'))) setEditId(null); }}>{t('保存', 'Save')}</button>
                              <button className="btn-line sm" onClick={() => setEditId(null)}>{t('取消', 'Cancel')}</button>
                            </>
                          ) : (
                            <>
                              {r.fee === 'due' && canQuoteRev(me, p) && (
                                <button className="btn-line sm" data-testid="rev-quote" disabled={busy}
                                  onClick={() => act({ type: 'setRevFee', pkg: pi, id: r.id, fee: 'quoted' }, t('已标「已出报价」', 'Marked as quoted'))}>{t('已出报价', 'Quoted')}</button>
                              )}
                              {r.fee === 'quoted' && canQuoteRev(me, p) && (
                                <button className="btn-line sm" data-testid="rev-confirm" disabled={busy}
                                  onClick={() => act({ type: 'setRevFee', pkg: pi, id: r.id, fee: 'confirmed' }, t('已标「客户已确认」', 'Marked as confirmed'))}>{t('客户已确认', 'Client confirmed')}</button>
                              )}
                              {r.fee && r.fee !== 'free' && r.fee !== 'waived' && canWaiveRev(me, p) && (
                                <button className="btn-line sm" data-testid="rev-waive" onClick={() => { setWaiveId(waiveId === r.id ? null : r.id); setReason(''); }}>{t('免收', 'Waive')}</button>
                              )}
                              {canEditRev(me, p, r) && (
                                <>
                                  <button className="btn-line sm" data-testid="rev-edit" onClick={() => { setEditId(r.id); setEdit({ date: r.date, src: r.src, note: r.note }); }}>{t('改', 'Edit')}</button>
                                  <button className="btn-line sm danger" data-testid="rev-del" disabled={busy}
                                    onClick={() => {
                                      if (!confirm(round
                                        ? t(`删除第 ${round} 轮?后面的轮次会前移,收费状态按新轮次重算(已出报价 / 已确认 / 免收的不动)。`, `Delete round ${round}? Later rounds move up and their charge status is recalculated (quoted / confirmed / waived rounds are not changed).`)
                                        : t('删除这条内部修改?', 'Delete this internal entry?'))) return;
                                      act({ type: 'deleteRevision', pkg: pi, id: r.id }, t('已删除', 'Deleted'));
                                    }}>✕</button>
                                </>
                              )}
                            </>
                          )}
                        </span>
                      </td>
                    </tr>
                    {waiveId === r.id && (
                      <tr>
                        <td style={cell} colSpan={6}>
                          <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 12, color: 'var(--text2)' }}>{t('免收原因(必填)', 'Reason for waiving (required)')}</span>
                            <input className="in sm" style={{ flex: 1, minWidth: 240 }} value={reason} data-testid="rev-waive-reason" onChange={(e) => setReason(e.target.value)} />
                            <button className="btn-navy sm" data-testid="rev-waive-ok" disabled={busy || !reason.trim()}
                              onClick={async () => { if (await act({ type: 'setRevFee', pkg: pi, id: r.id, fee: 'waived', reason }, t('已批准免收', 'Charge waived'))) setWaiveId(null); }}>
                              {t('确认免收', 'Waive')}
                            </button>
                            <button className="btn-line sm" onClick={() => setWaiveId(null)}>{t('取消', 'Cancel')}</button>
                          </span>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* 「修改已 N 轮 → 开原因会」:项目 PM 或 PD / BD 写一句结论后登记,同一个服务包只提醒一次。
   项目详情「概览 · 风险与受阻」和修改记录页签都用这一个。 */
export function ReasonMeeting({ p, pi, pk, rules, compact }: { p: Project; pi: number; pk: ServicePackage; rules: RevRules; compact?: boolean }) {
  const { me, dispatch, setToast } = useStore();
  const { lang, t } = useLang();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const can = canRecordRev(me, p);
  const n = clientRounds(pk);
  return (
    <div data-testid={`rev-meeting-${pi}`} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {!compact && (
        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#a8690b' }}>
          {t(`${svcName(pk.svc, 'zh')}修改已 ${n} 轮 → 开原因会`, `${svcName(pk.svc, lang)}: ${n} revision rounds → hold a review meeting`)}
        </span>
      )}
      {can && !open && (
        <span><button className="btn-line sm" data-testid="rev-meeting-btn" onClick={() => setOpen(true)}>✓ {t('已开原因会', 'Meeting held')}</button></span>
      )}
      {can && open && (
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="in sm" style={{ flex: 1, minWidth: 220 }} value={note} data-testid="rev-meeting-note"
            placeholder={t('一句结论(必填)', 'One-line conclusion (required)')} onChange={(e) => setNote(e.target.value)} />
          <button className="btn-navy sm" data-testid="rev-meeting-ok" disabled={busy || !note.trim()}
            onClick={async () => {
              setBusy(true);
              const ok = await dispatch(p.id, { type: 'reasonMeeting', pkg: pi, note }, { onError: (m) => setToast(`⚠ ${m}`) });
              setBusy(false);
              if (ok) { setOpen(false); setToast(t('已登记原因会', 'Review meeting logged')); }
            }}>{t('保存', 'Save')}</button>
          <button className="btn-line sm" onClick={() => setOpen(false)}>{t('取消', 'Cancel')}</button>
        </span>
      )}
    </div>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '9px 14px', fontSize: 11.5, fontWeight: 700, color: 'var(--text2)', borderBottom: '1px solid var(--row-line)' };
const cell: React.CSSProperties = { padding: '9px 14px', fontSize: 12.5, borderTop: '1px solid var(--row-line)', verticalAlign: 'top' };
