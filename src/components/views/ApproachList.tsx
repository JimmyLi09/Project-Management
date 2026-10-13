'use client';

/* ===== REQ-054 售前接洽(Approach)=====
   AV「立项询价」建的是售前记录:没有项目编号,不算进总览、待办、统计。客户确认后由 Sales / PD / BD
   「转为正式项目」才拿编号 —— 新建一个正式项目,或者并入已有的正式项目(AV 方案、成本、报价跟着过去)。
   这里是:售前接洽 / 已关闭两张表、转正式弹窗、未成交弹窗、项目页 / AV 01 顶部的那一条提示。 */

import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { useLang } from '@/lib/i18n';
import { APPROACH_BADGE, approachTag, isApproach, isOpenApproach } from '@/lib/approach';
import { canAssign, canCreate } from '@/lib/permissions';
import { fmtDate, projCode } from '@/lib/project';
import { svcName } from '@/lib/templates';
import type { Project } from '@/lib/types';
import { Ell } from '../ui';
import { avStageText } from './AvHomeView';


const code = (p: Pick<Project, 'serial'>) => projCode(p);
const svcsOf = (p: Project, lang: 'zh' | 'en') => [...new Set(p.packages.map((x) => x.svc))].map((s) => svcName(s, lang)).join(lang === 'zh' ? '、' : ', ');
const day = (ms?: number) => (ms ? fmtDate(new Date(ms)) : '—');
/* 从哪来:AV 立项询价那条日志(谁、什么时候) */
function sourceOf(p: Project) {
  const e = (p.log || []).find((l) => (l as { k?: string }).k === 'proj.createAv');
  return { at: e?.at || p.approach?.createdAt || p.created, by: e?.by || '' };
}

/* AV 进度:工作台同一份阶段 */
function useAvStages(on: boolean) {
  const [m, setM] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!on) return;
    let live = true;
    fetch('/api/av/overview').then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (live && d?.projects) setM(Object.fromEntries((d.projects as { id: string; stage: string }[]).map((x) => [x.id, x.stage])));
    }).catch(() => undefined);
    return () => { live = false; };
  }, [on]);
  return m;
}

/* ---------- 售前接洽 / 已关闭 两张表 ---------- */
export function ApproachTable({ rows, mode }: { rows: Project[]; mode: 'open' | 'closed' }) {
  const { me, openProject, setView, setLedProjectId, allProjects, approachOp, setToast } = useStore();
  const { lang, t } = useLang();
  const stages = useAvStages(mode === 'open' && rows.length > 0);
  const [conv, setConv] = useState<Project | null>(null);
  const [lose, setLose] = useState<Project | null>(null);
  const can = canCreate(me);
  const nameOf = (id?: string) => { const x = allProjects.find((p) => p.id === id); return x ? `${code(x) ? code(x) + ' · ' : ''}${x.name}` : '—'; };
  const th: React.CSSProperties = { padding: '9px 10px', fontSize: 11, fontWeight: 700, color: 'var(--text2)', background: 'var(--hover-bg)', textAlign: 'left', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '9px 10px', borderTop: '1px solid var(--row-line)', fontSize: 13, verticalAlign: 'top' };
  return (
    <div className="panel clip" data-testid={mode === 'open' ? 'approach-table' : 'approach-closed'}>
      <div className="panel-head" style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span className="panel-title">{mode === 'open' ? t('售前接洽', 'Approach') : t('已关闭', 'Closed')}</span>
        <span style={{ fontSize: 12, color: 'var(--text2)' }}>
          {mode === 'open'
            ? t('AV 立项询价建的售前记录 · 没有编号 · 不算进总览、待办和统计;客户确认后「转为正式项目」才编号',
              'Pre-sales records opened from an AV inquiry · no project number · not counted in overview, tasks or reports; “Convert to project” assigns the number')
            : t('未成交 / 已并入别的项目 —— 只读,可查历史', 'Lost / merged into another project — read-only, kept for history')}
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          {(mode === 'open'
            ? [t('编号', 'No.'), t('名称', 'Name'), t('客户', 'Client'), t('业务', 'Services'), t('来源', 'Source'), t('AV 进度', 'AV progress'), '']
            : [t('名称', 'Name'), t('结果', 'Outcome'), t('客户', 'Client'), t('关闭时间', 'Closed'), '']).map((h, i) => <th key={i} style={th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} style={{ ...td, color: 'var(--text2)', textAlign: 'center' }}>{mode === 'open' ? t('没有售前记录', 'No approach records') : t('没有已关闭的售前记录', 'No closed approach records')}</td></tr>}
          {mode === 'open' && rows.map((p) => {
            const src = sourceOf(p);
            return (
              <tr key={p.id} data-testid="approach-row" data-id={p.id}>
                <td style={td}>
                  <span className="badge" style={APPROACH_BADGE}>{approachTag(lang)}</span>
                  {p.approach?.legacySerial ? <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 3 }}>{t(`原 ${String(p.approach.legacySerial).padStart(3, '0')},上线时去掉`, `was ${String(p.approach.legacySerial).padStart(3, '0')}, removed at go-live`)}</div> : null}
                </td>
                <td style={td}><button className="link-button" style={{ fontWeight: 600, color: 'var(--navy900)', textAlign: 'left' }} onClick={() => openProject(p.id)} data-testid="approach-open">{p.name}</button></td>
                <td style={td}>{p.client || '—'}</td>
                <td style={td}>{svcsOf(p, lang) || '—'}</td>
                <td style={{ ...td, fontSize: 12, color: 'var(--text2)' }}>{t('AV 立项询价', 'AV inquiry')}<br />{day(src.at)}{src.by ? ` · ${src.by}` : ''}</td>
                <td style={{ ...td, fontSize: 12.5 }} data-testid="approach-av">{stages[p.id] ? avStageText(stages[p.id], lang) : '—'}</td>
                <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button className="btn-line sm" onClick={() => { setLedProjectId(p.id); setView({ name: 'avinquiry' }); }} data-testid="approach-av-go">{t('AV 方案', 'AV design')}</button>{' '}
                  {can && <button className="btn-navy sm" onClick={() => setConv(p)} data-testid="approach-convert">{t('转为正式项目', 'Convert to project')}</button>}{' '}
                  {can && <button className="btn-line sm" onClick={() => setLose(p)} data-testid="approach-lose">{t('未成交', 'Lost')}</button>}
                </td>
              </tr>
            );
          })}
          {mode === 'closed' && rows.map((p) => {
            const ap = p.approach!;
            return (
              <tr key={p.id} data-testid="approach-closed-row" data-id={p.id}>
                <td style={td}><button className="link-button" style={{ fontWeight: 600, color: 'var(--navy900)', textAlign: 'left' }} onClick={() => openProject(p.id)}>{p.name}</button></td>
                <td style={td}>
                  {ap.status === 'lost'
                    ? <><span className="badge" style={{ background: '#FDECEA', color: '#B42318' }}>{t('未成交', 'Lost')}</span>{ap.lostReason ? <span style={{ fontSize: 12, color: 'var(--text2)', marginLeft: 6 }}>{ap.lostReason}</span> : null}</>
                    : <span className="badge" style={{ background: '#EAF3EE', color: '#2F7A5B' }}>{t(`已并入 ${nameOf(ap.mergedInto)}`, `Merged into ${nameOf(ap.mergedInto)}`)}</span>}
                </td>
                <td style={td}>{p.client || '—'}</td>
                <td style={{ ...td, fontSize: 12.5, color: 'var(--text2)' }}>{day(ap.status === 'lost' ? ap.lostAt : ap.mergedAt)}{(ap.lostBy || ap.mergedBy) ? ` · ${ap.status === 'lost' ? ap.lostBy : ap.mergedBy}` : ''}</td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {ap.status === 'merged' && ap.mergedInto && <button className="btn-line sm" onClick={() => openProject(ap.mergedInto!)}>{t('打开并入的项目', 'Open target project')}</button>}
                  {ap.status === 'lost' && can && <button className="btn-line sm" data-testid="approach-reopen"
                    onClick={async () => { if (await approachOp({ op: 'reopen', id: p.id })) setToast(t('已重新打开,回到「售前接洽」', 'Reopened — back in Approach')); }}>{t('重新打开', 'Reopen')}</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {conv && <ConvertModal p={conv} onClose={() => setConv(null)} />}
      {lose && <LostModal p={lose} onClose={() => setLose(null)} />}
    </div>
  );
}

/* ---------- 未成交 ---------- */
function LostModal({ p, onClose }: { p: Project; onClose: () => void }) {
  const { approachOp, setToast } = useStore();
  const { t } = useLang();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 460 }} data-testid="lost-modal">
        <h2>{t('标为未成交', 'Mark as lost')} · {p.name}</h2>
        <div className="msub">{t('移到「已关闭」,只读;数据一条都不删。之后可以「重新打开」。', 'Moves to “Closed”, read-only; nothing is deleted. You can reopen it later.')}</div>
        <textarea className="in" style={{ width: '100%', minHeight: 70 }} placeholder={t('原因(选填)', 'Reason (optional)')} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="lost-reason" />
        <div className="modal-actions">
          <button className="btn-line" onClick={onClose}>{t('取消', 'Cancel')}</button>
          <button className="btn-navy" disabled={busy} data-testid="lost-go"
            onClick={async () => { setBusy(true); const ok = await approachOp({ op: 'lost', id: p.id, reason }); setBusy(false); if (ok) { setToast(t('已标为未成交(不删除,在「已关闭」里)', 'Marked as lost (kept under “Closed”)')); onClose(); } }}>
            {t('标为未成交', 'Mark as lost')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- 转为正式项目:① 新建 / ② 并入已有 ---------- */
interface MergeSvc { svc: string; line?: string; targetHas: boolean; moves: number; conflict: string }
interface MergePlan { ok: boolean; svcs: MergeSvc[]; quotes: number; quoteConflict: boolean; reason: string }

export function ConvertModal({ p, onClose }: { p: Project; onClose: () => void }) {
  const { me, users, allProjects, projects, approachOp, setToast, openProject } = useStore();
  const { lang, t } = useLang();
  /* 同名的正式项目排最前,标「同名,建议」;默认就是并入它 */
  const targets = useMemo(() => {
    const live = projects.filter((x) => !x.archived);
    const same = (x: Project) => x.name.trim().toLowerCase() === p.name.trim().toLowerCase();
    return [...live.filter(same), ...live.filter((x) => !same(x)).sort((a, b) => (b.serial || 0) - (a.serial || 0))];
  }, [projects, p.name]);
  const sameName = targets.length > 0 && targets[0].name.trim().toLowerCase() === p.name.trim().toLowerCase();
  const [mode, setMode] = useState<'new' | 'merge'>(sameName ? 'merge' : 'new');
  const [target, setTarget] = useState(targets[0]?.id || '');
  const [quotationNo, setQuotationNo] = useState(p.quotationNo || '');
  const [pm, setPm] = useState('');
  const [plan, setPlan] = useState<MergePlan | null>(null);
  const [planErr, setPlanErr] = useState('');
  const [busy, setBusy] = useState(false);
  /* 预计编号 = 现在最大编号 + 1(Sales / PD / BD 看得到全部项目,和服务端算的一样;以服务端为准) */
  const nextNo = String(allProjects.reduce((m, x) => Math.max(m, x.serial || 0), 0) + 1).padStart(3, '0');

  useEffect(() => {
    if (mode !== 'merge' || !target) { setPlan(null); return; }
    let live = true;
    setPlan(null); setPlanErr('');
    fetch(`/api/approach?id=${encodeURIComponent(p.id)}&target=${encodeURIComponent(target)}`)
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!live) return; if (r.ok) setPlan(d.plan); else setPlanErr(d.error || t('读取失败', 'Could not load')); })
      .catch(() => live && setPlanErr(t('读取失败', 'Could not load')));
    return () => { live = false; };
  }, [mode, target, p.id, t]);

  const tgt = targets.find((x) => x.id === target);
  async function go() {
    setBusy(true);
    const ok = mode === 'new'
      ? await approachOp({ op: 'convert', id: p.id, quotationNo, pm })
      : await approachOp({ op: 'merge', id: p.id, target });
    setBusy(false);
    if (!ok) return;
    if (mode === 'new') setToast(t('已转为正式项目', 'Converted to a formal project'));
    else { setToast(t(`已并入 ${tgt ? (code(tgt) ? code(tgt) + ' · ' : '') + tgt.name : ''}(AV 方案 / 成本 / 报价已挂过去)`, `Merged into ${tgt?.name || ''} (AV design / costing / quotes moved)`)); openProject(target); }
    onClose();
  }
  const pill = (on: boolean): React.CSSProperties => ({ border: '1px solid var(--row-line)', borderRadius: 16, padding: '5px 13px', fontSize: 13, cursor: 'pointer', background: on ? 'var(--navy900)' : '#fff', color: on ? '#fff' : 'var(--text)', borderColor: on ? 'var(--navy900)' : undefined });
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 680 }} data-testid="convert-modal">
        <h2>{t('转为正式项目', 'Convert to a formal project')} · {p.name}</h2>
        <div style={{ display: 'flex', gap: 8, margin: '6px 0 12px' }}>
          <button style={pill(mode === 'new')} onClick={() => setMode('new')} data-testid="convert-mode-new">① {t('新建正式项目', 'New formal project')}</button>
          <button style={pill(mode === 'merge')} onClick={() => setMode('merge')} data-testid="convert-mode-merge" disabled={!targets.length}>② {t('并入已有项目', 'Merge into an existing project')}</button>
        </div>
        {mode === 'new' ? (
          <div style={{ fontSize: 13 }}>
            <div>{t('将获得编号', 'Will get project no.')} <b style={{ fontSize: 16, color: 'var(--navy900)' }} data-testid="convert-next-no">{nextNo}</b> <span style={{ color: 'var(--text2)', fontSize: 12 }}>{t('(当前最大编号 + 1)', '(highest number + 1)')}</span></div>
            <div style={{ color: 'var(--text2)', fontSize: 12.5, margin: '6px 0 10px' }}>{t('这条记录本身变成正式项目:名称、客户、业务、AV 方案 / 成本 / 报价都原样留着。可以顺便填报价号和 PM。', 'This record itself becomes the formal project: name, client, services and the AV design / costing / quotes all stay. You can fill in the quotation no. and PM now.')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 10px', alignItems: 'center', maxWidth: 460 }}>
              <span>{t('报价号', 'Quotation no.')}</span>
              <input className="in" placeholder={t('如 Q-2026-118', 'e.g. Q-2026-118')} value={quotationNo} onChange={(e) => setQuotationNo(e.target.value)} data-testid="convert-quote" />
              {canAssign(me) && <>
                <span>PM</span>
                <select className="in" value={pm} onChange={(e) => setPm(e.target.value)} data-testid="convert-pm">
                  <option value="">{t('— 之后再指派 —', '— assign later —')}</option>
                  {users.filter((u) => u.role !== 'viewer').map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
                </select>
              </>}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span>{t('并入', 'Merge into')}</span>
              <select className="in" style={{ flex: 1 }} value={target} onChange={(e) => setTarget(e.target.value)} data-testid="convert-target">
                {targets.map((x, i) => (
                  <option key={x.id} value={x.id}>{code(x) ? code(x) + ' · ' : ''}{x.name}{i === 0 && sameName ? t('(同名,建议)', ' (same name, suggested)') : ''}</option>
                ))}
              </select>
            </div>
            {planErr && <div style={{ color: 'var(--danger)', marginTop: 8 }}>{planErr}</div>}
            {!plan && !planErr && <div style={{ color: 'var(--text2)', marginTop: 8 }}>{t('正在检查…', 'Checking…')}</div>}
            {plan && (
              <>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }} data-testid="convert-plan">
                  <thead><tr>{[t('售前里的业务', 'Service in the approach'), t('已有项目里', 'In the target'), t('怎么并', 'How'), t('AV 数据', 'AV data')].map((h, i) => <th key={i} style={{ textAlign: 'left', fontSize: 11, color: 'var(--text2)', padding: '6px 8px', background: 'var(--hover-bg)' }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {plan.svcs.map((x) => (
                      <tr key={x.svc} data-testid="convert-plan-row">
                        <td style={{ padding: '6px 8px', borderTop: '1px solid var(--row-line)' }}>{svcName(x.svc, lang)}</td>
                        <td style={{ padding: '6px 8px', borderTop: '1px solid var(--row-line)' }}>{x.targetHas ? t(`已有 ${svcName(x.svc, lang)}`, `Has ${svcName(x.svc, lang)}`) : t('没有', 'None')}</td>
                        <td style={{ padding: '6px 8px', borderTop: '1px solid var(--row-line)' }}>{x.targetHas ? t(`并入已有的 ${svcName(x.svc, lang)} 服务包`, `Into the existing ${svcName(x.svc, lang)} package`) : t(`新增一个 ${svcName(x.svc, lang)} 服务包`, `Add a ${svcName(x.svc, lang)} package`)}</td>
                        <td style={{ padding: '6px 8px', borderTop: '1px solid var(--row-line)', color: x.conflict ? 'var(--danger)' : 'var(--text2)' }}>
                          {x.conflict ? t('冲突:目标这条线已有 AV 方案', 'Conflict: the target already has an AV design on this line') : x.line ? t(`搬 ${x.moves} 条`, `${x.moves} rows move`) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!plan.ok && <div style={{ color: 'var(--danger)', marginTop: 8 }} data-testid="convert-conflict">
                  {t('不能并入:一个项目的一条业务线只能有一套 AV 方案。', 'Cannot merge: a project can hold only one AV design per business line.')}
                  {plan.quoteConflict ? t('两边都已经有 AV 报价。', ' Both already have AV quotations.') : ''}
                  {t('请改用「新建正式项目」。', ' Use “New formal project” instead.')}
                </div>}
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8 }}>
                  {t('跟着搬过去的:AV 立项记录(合并)、图纸 / 判读、05 方案(含规则包版本)、06 成本、07 报价、目标没有的联系人。已有项目原来的内容一个不动;冲突的字段(客户、交付日、报价号)以已有项目为准,售前的值记进日志。售前记录不删除,标为「已并入」,留在「已关闭」里。',
                    'What moves: the AV inquiry (merged), drawings / judgements, 05 designs (with their rule pack), 06 costing, 07 quotations and contacts the target lacks. Nothing already in the target changes; on conflicts (client, delivery, quotation no.) the target wins and the approach’s value goes to the log. The approach record is kept as “merged” under “Closed”.')}
                </div>
              </>
            )}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn-line" onClick={onClose}>{t('取消', 'Cancel')}</button>
          <button className="btn-navy" disabled={busy || (mode === 'merge' && (!plan || !plan.ok))} onClick={go} data-testid="convert-go">
            {mode === 'new' ? t(`确认,编号 ${nextNo}`, `Confirm, no. ${nextNo}`) : t('确认并入', 'Confirm merge')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- 项目页 / AV 01 顶部:「售前记录 · 未编号」+ 转为正式项目;已关闭的写清楚去向 ---------- */
export function ApproachBanner({ p }: { p: Project }) {
  const { me, allProjects, openProject, approachOp, setToast } = useStore();
  const { t } = useLang();
  const [conv, setConv] = useState(false);
  if (!isApproach(p)) return null;
  const ap = p.approach!;
  const can = canCreate(me);
  const tgt = ap.mergedInto ? allProjects.find((x) => x.id === ap.mergedInto) : undefined;
  return (
    <div className="panel" data-testid="approach-banner" style={{ padding: '10px 16px', marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: '#F6F7F9', borderColor: '#D8DCE2' }}>
      <span className="badge" style={APPROACH_BADGE}>{t('售前', 'Approach')}</span>
      {isOpenApproach(p) ? (
        <>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{t('售前记录 · 未编号', 'Approach record · no project number')}</span>
          <span style={{ fontSize: 12, color: 'var(--text2)', flex: 1, minWidth: 220 }}>{t('不算进总览、待办和统计;不能指派 PM、交接、开 Invoice —— 客户确认后先转为正式项目。', 'Not counted in overview, tasks or reports; PM assignment, handover and invoicing open once it is converted.')}</span>
          {can && <button className="btn-navy sm" onClick={() => setConv(true)} data-testid="banner-convert">{t('转为正式项目', 'Convert to project')}</button>}
        </>
      ) : ap.status === 'merged' ? (
        <>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{t('已并入', 'Merged into')}</span>
          {tgt ? <button className="link-button" style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy700)' }} onClick={() => openProject(tgt.id)} data-testid="banner-merged-link">{code(tgt) ? code(tgt) + ' · ' : ''}{tgt.name}</button> : <span>—</span>}
          <span style={{ fontSize: 12, color: 'var(--text2)', flex: 1 }}>{t('只读;AV 方案、成本、报价已经在并入的项目里。', 'Read-only; the AV design, costing and quotes now live in that project.')}</span>
        </>
      ) : (
        <>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{t('未成交', 'Lost')}</span>
          <Ell style={{ fontSize: 12, color: 'var(--text2)', flex: 1 }}>{ap.lostReason || t('只读', 'Read-only')}</Ell>
          {can && <button className="btn-line sm" data-testid="banner-reopen" onClick={async () => { if (await approachOp({ op: 'reopen', id: p.id })) setToast(t('已重新打开', 'Reopened')); }}>{t('重新打开', 'Reopen')}</button>}
        </>
      )}
      {conv && <ConvertModal p={p} onClose={() => setConv(false)} />}
    </div>
  );
}
