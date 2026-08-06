'use client';

import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { isFull } from '@/lib/permissions';
import { fmtDate, pkgStart, planDates, projCode, projStage, todayMid } from '@/lib/project';
import { useLang } from '@/lib/i18n';
import { STAGES, stageIdx, SVC, svcColor } from '@/lib/templates';
import type { Project, ServicePackage } from '@/lib/types';

/* REQ-016: built-in fallback when no global note has been saved yet */
const DEFAULT_NOTES = '注 Note:资料不齐可能影响交付时间;确认后如需多次修改,可能酌收修改费。\nIncomplete information may affect the delivery schedule; repeated revisions after confirmation may incur additional charges.';

type Cols = { owner: boolean; start: boolean; due: boolean; status: boolean; clStatus: boolean; clDate: boolean; clRemark: boolean };
export type ExportScope = 'all' | 'schedule' | 'checklist';
type Order = 'byPkg' | 'schedFirst' | 'clFirst';

/* ===== REQ-015 / REQ-017: flexible, print-solid export =====
   - content multi-select: services + (schedule / checklist / both)
   - three ordering presets: interleaved by service / all schedules first /
     all checklists first — one unified table template throughout
   - print: A4 portrait|landscape, real margins, page numbers & header/footer
     via @page margin boxes, repeating table heads, no mid-row page breaks */
export default function ExportOverlay({ p, onClose, scope = 'all' }: { p: Project; onClose: () => void; scope?: ExportScope }) {
  const { lang: appLang } = useLang();
  const { me, setToast } = useStore();
  const [lang, setLang] = useState<'en' | 'zh'>(appLang);
  const [cols, setCols] = useState<Cols>({ owner: true, start: true, due: true, status: true, clStatus: true, clDate: true, clRemark: true });
  const [sec, setSec] = useState<ExportScope>(scope);
  const [order, setOrder] = useState<Order>('byPkg');
  const [orient, setOrient] = useState<'portrait' | 'landscape'>('portrait');
  const [pkgSel, setPkgSel] = useState<boolean[]>(() => p.packages.map(() => true));
  /* REQ-016: company notes — global default, per-export toggle + tweak */
  const [notesOn, setNotesOn] = useState(true);
  const [notes, setNotes] = useState(DEFAULT_NOTES);
  const [notesEdit, setNotesEdit] = useState(false);
  useEffect(() => {
    fetch('/api/settings?key=exportNotes').then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && d.value) setNotes(d.value); }).catch(() => {});
  }, []);
  async function saveDefaultNotes() {
    const r = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'exportNotes', value: notes }) });
    setToast(r.ok ? '已保存为全局默认说明' : '保存失败(仅 PD/BD 可存默认)');
  }

  const L = lang;
  const T = (zh: string, en: string) => (L === 'zh' ? zh : en);
  const showSched = sec !== 'checklist';
  const showCl = sec !== 'schedule';
  const scopeLabel = sec === 'schedule' ? T('生产排期', 'Schedule') : sec === 'checklist' ? T('信息清单', 'Checklist') : '';
  const svcNames = p.services.map((k) => (SVC[k] ? (L === 'zh' ? SVC[k].label : SVC[k].en) : k)).join(', ');
  const selPkgs = p.packages.map((pkg, pi) => ({ pkg, pi })).filter((x) => pkgSel[x.pi]);
  const multi = p.packages.length > 1;

  const colToggle = (c: keyof Cols, zh: string, en: string) => (
    <label className="ex-col" key={c}>
      <input type="checkbox" checked={cols[c]} onChange={() => setCols({ ...cols, [c]: !cols[c] })} /> {T(zh, en)}
    </label>
  );
  const svcName = (pkg: ServicePackage) => (SVC[pkg.svc] ? (L === 'zh' ? SVC[pkg.svc].label : SVC[pkg.svc].en) : pkg.svc);

  /* REQ-017: page header/footer + page numbers via @page margin boxes
     (Chromium 131+; older browsers just ignore). Orientation switch included. */
  const headerTxt = `${projCode(p) ? projCode(p) + ' · ' : ''}${p.name}`.replace(/"/g, '\\"');
  const pageCss = `
@page {
  size: A4 ${orient};
  margin: 16mm 12mm 18mm;
  @top-left { content: "${headerTxt}"; font-size: 9px; color: #999; }
  @bottom-left { content: "Audax Visuals"; font-size: 9px; color: #999; }
  @bottom-right { content: counter(page) " / " counter(pages); font-size: 9px; color: #999; }
}`;

  /* ── unified schedule block (per package) ── */
  function SchedBlock({ pkg, pi }: { pkg: ServicePackage; pi: number }) {
    const pd = planDates(pkg, pkgStart(p, pkg));
    return (
      <React.Fragment>
        <h2 style={{ color: svcColor(pkg.svc) }}>{svcName(pkg)} — {T('生产排期', 'Production Schedule')}</h2>
        <table className="t-fix">
          <thead>
            <tr>
              <th style={{ width: '5%' }}>#</th><th>{T('阶段/任务', 'Phase / Task')}</th>
              {cols.owner && <th style={{ width: '14%' }}>{T('负责', 'Owner')}</th>}
              {cols.start && <th style={{ width: '11%' }}>{T('开始', 'Start')}</th>}
              {cols.due && <th style={{ width: '11%' }}>{T('到期', 'Due')}</th>}
              {cols.status && <th style={{ width: '10%' }}>{T('状态', 'Status')}</th>}
            </tr>
          </thead>
          <tbody>
            {pkg.schedule.map((r, i) => {
              const d = pd[i];
              const stt = {
                todo: T('未开始', 'Not started'), wip: T('进行中', 'In progress'),
                done: T('已完成', 'Done'), block: T('受阻', 'Blocked'),
              }[r.status];
              return (
                <tr key={r.id || i}>
                  {/* REQ-017: number by current position so deletions renumber */}
                  <td>{i}</td>
                  <td>{(L === 'zh' ? r.task : r.taskEn)}{r.freeze ? ' ★' : ''}{r.custom ? ` (${T('自定义', 'custom')})` : ''}</td>
                  {cols.owner && <td>{r.owner}</td>}
                  {cols.start && <td>{d ? fmtDate(d.start) : '—'}</td>}
                  {cols.due && <td>{d ? fmtDate(d.end) : '—'}</td>}
                  {cols.status && <td>{stt}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {(pkg.scopeItems && pkg.scopeItems.length > 0) && (
          <>
            <h3 style={{ fontSize: 12.5, margin: '12px 0 6px' }}>{T('服务内容 / 交付清单', 'Service Scope / Deliverables')}</h3>
            <table className="t-fix">
              <thead>
                <tr><th style={{ width: '34%' }}>{T('服务项', 'Service item')}</th><th style={{ width: '16%' }}>{T('数量', 'Detail')}</th><th>{T('特别说明', 'Special notes')}</th></tr>
              </thead>
              <tbody>
                {pkg.scopeItems.map((s, si) => (
                  <tr key={si}><td>{s.item || '—'}</td><td>{s.qty || '—'}</td><td>{s.note || '—'}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </React.Fragment>
    );
  }

  /* ── unified checklist block (per package) ── */
  function ClBlock({ pkg, pi }: { pkg: ServicePackage; pi: number }) {
    const clStat: Record<string, string> = {
      pending: T('未收到', 'Pending'), received: T('已收到', 'Received'), confirmed: T('已确认', 'Confirmed'),
      na: 'N/A', revision: T('需修订', 'Revision'), rejected: T('退回', 'Rejected'),
    };
    const clSpan = 2 + (cols.clStatus ? 1 : 0) + (cols.clDate ? 1 : 0) + (cols.clRemark ? 1 : 0);
    const groups = pkg.checklist
      .map((g) => ({ g, items: g.items.filter((it) => !((it.status === 'pending' || it.status === 'na') && !it.date && !it.remark)) }))
      .filter((x) => x.items.length);
    return (
      <React.Fragment>
        <h2 style={{ color: svcColor(pkg.svc) }}>{svcName(pkg)} — {T('信息清单', 'Information Checklist')}</h2>
        {groups.length === 0 ? (
          <p style={{ color: '#888', fontSize: 12 }}>{T('暂无已填写的信息项。', 'No filled-in items yet.')}</p>
        ) : groups.map(({ g, items }, gi) => (
          <table key={gi} className="t-fix">
            <thead>
              <tr className="grp-h"><td colSpan={clSpan}>{L === 'zh' ? g.group : g.groupEn}</td></tr>
              <tr>
                <th>{T('信息项', 'Item')}</th>
                <th style={{ width: '14%' }}>{T('负责人', 'Owner')}</th>
                {cols.clStatus && <th style={{ width: '12%' }}>{T('状态', 'Status')}</th>}
                {cols.clDate && <th style={{ width: '13%' }}>{T('收到日期', 'Date received')}</th>}
                {cols.clRemark && <th style={{ width: '26%' }}>{T('备注', 'Remark')}</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((it, ii) => (
                <tr key={it.id || ii}>
                  <td>{L === 'zh' ? it.zh : it.en}</td>
                  <td>{it.owner || '—'}</td>
                  {cols.clStatus && <td>{clStat[it.status] || it.status}</td>}
                  {cols.clDate && <td>{it.date || '—'}</td>}
                  {cols.clRemark && <td style={{ whiteSpace: 'pre-wrap' }}>{it.remark || '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </React.Fragment>
    );
  }

  /* REQ-015: assemble blocks per ordering preset */
  const blocks: React.ReactNode[] = [];
  if (order === 'byPkg' || !(showSched && showCl)) {
    selPkgs.forEach(({ pkg, pi }) => {
      if (showSched) blocks.push(<SchedBlock key={`s${pi}`} pkg={pkg} pi={pi} />);
      if (showCl) blocks.push(<ClBlock key={`c${pi}`} pkg={pkg} pi={pi} />);
    });
  } else if (order === 'schedFirst') {
    selPkgs.forEach(({ pkg, pi }) => blocks.push(<SchedBlock key={`s${pi}`} pkg={pkg} pi={pi} />));
    selPkgs.forEach(({ pkg, pi }) => blocks.push(<ClBlock key={`c${pi}`} pkg={pkg} pi={pi} />));
  } else {
    selPkgs.forEach(({ pkg, pi }) => blocks.push(<ClBlock key={`c${pi}`} pkg={pkg} pi={pi} />));
    selPkgs.forEach(({ pkg, pi }) => blocks.push(<SchedBlock key={`s${pi}`} pkg={pkg} pi={pi} />));
  }

  return (
    <div className="ex-wrap">
      <style media="print">{pageCss}</style>
      <div className="ex-actions">
        <button className="btn-line sm" style={L === 'en' ? { borderColor: 'var(--navy900)' } : undefined} onClick={() => setLang('en')}>English</button>
        <button className="btn-line sm" style={L === 'zh' ? { borderColor: 'var(--navy900)' } : undefined} onClick={() => setLang('zh')}>中文</button>
        <button className="btn-line sm" onClick={() => setOrient(orient === 'portrait' ? 'landscape' : 'portrait')}>
          {orient === 'portrait' ? T('A4 纵向', 'A4 Portrait') : T('A4 横向', 'A4 Landscape')} ⇄
        </button>
        <button className="btn-navy sm" onClick={() => window.print()}>{T('打印 / 另存 PDF', 'Print / Save PDF')}</button>
        <button className="btn-line sm" onClick={onClose}>{T('关闭', 'Close')}</button>
      </div>

      {/* REQ-015: content picker + ordering */}
      <div className="ex-colbar">
        <span className="ex-grp">
          {T('内容', 'Content')}:
          <label className="ex-col"><input type="radio" name="exsec" checked={sec === 'all'} onChange={() => setSec('all')} /> {T('排期+清单', 'Schedule + Checklist')}</label>
          <label className="ex-col"><input type="radio" name="exsec" checked={sec === 'schedule'} onChange={() => setSec('schedule')} /> {T('仅排期', 'Schedule only')}</label>
          <label className="ex-col"><input type="radio" name="exsec" checked={sec === 'checklist'} onChange={() => setSec('checklist')} /> {T('仅清单', 'Checklist only')}</label>
        </span>
        {multi && (
          <span className="ex-grp">
            {T('服务', 'Services')}:
            {p.packages.map((pkg, pi) => (
              <label className="ex-col" key={pi}>
                <input type="checkbox" checked={pkgSel[pi]}
                  onChange={() => setPkgSel((s) => s.map((v, i) => (i === pi ? !v : v)))} /> {svcName(pkg)}
              </label>
            ))}
          </span>
        )}
        {multi && showSched && showCl && (
          <span className="ex-grp">
            {T('排列', 'Order')}:
            <select className="in sm" value={order} onChange={(e) => setOrder(e.target.value as Order)} style={{ width: 'auto', padding: '3px 6px' }}>
              <option value="byPkg">{T('按服务穿插', 'Interleaved by service')}</option>
              <option value="schedFirst">{T('所有排期集中在前', 'All schedules first')}</option>
              <option value="clFirst">{T('所有清单集中在前', 'All checklists first')}</option>
            </select>
          </span>
        )}
        {T('栏位', 'Columns')}:
        {showSched && <span className="ex-grp">排期 {colToggle('owner', '负责', 'Owner')}{colToggle('start', '开始', 'Start')}{colToggle('due', '到期', 'Due')}{colToggle('status', '状态', 'Status')}</span>}
        {showCl && <span className="ex-grp">清单 {colToggle('clStatus', '状态', 'Status')}{colToggle('clDate', '日期', 'Date')}{colToggle('clRemark', '备注', 'Remark')}</span>}
        <span className="ex-grp">
          <label className="ex-col"><input type="checkbox" checked={notesOn} onChange={() => setNotesOn(!notesOn)} /> {T('公司说明', 'Company notes')}</label>
          {notesOn && <button className="btn-line sm" onClick={() => setNotesEdit(!notesEdit)}>{notesEdit ? T('收起', 'Done') : T('编辑', 'Edit')}</button>}
        </span>
      </div>
      {notesOn && notesEdit && (
        <div className="ex-noteedit" style={{ maxWidth: 860, margin: '0 auto 10px', padding: '0 10px' }}>
          <textarea className="in" value={notes} onChange={(e) => setNotes(e.target.value)}
            style={{ width: '100%', minHeight: 64, fontSize: 12.5 }} placeholder={T('公司说明 / 免责声明…', 'Company notes / disclaimer…')} />
          {isFull(me) && <button className="btn-line sm" style={{ marginTop: 4 }} onClick={saveDefaultNotes}>{T('存为全局默认', 'Save as global default')}</button>}
        </div>
      )}

      <div className="ex-doc">
        <h1>{projCode(p) ? projCode(p) + ' · ' : ''}{p.name}{scopeLabel ? ` — ${scopeLabel}` : ''}</h1>
        <div className="exsub">
          {T('客户', 'Client')}: {p.client || '—'} · {T('服务', 'Services')}: {svcNames} · {T('阶段', 'Stage')}:{' '}
          {L === 'zh' ? STAGES[stageIdx(projStage(p))][1] : STAGES[stageIdx(projStage(p))][2]}
        </div>
        {selPkgs.length === 0 ? (
          <p style={{ color: '#888' }}>{T('请至少勾选一个服务。', 'Select at least one service.')}</p>
        ) : blocks}
        {/* REQ-016: company notes / disclaimer at the bottom of every export */}
        {notesOn && notes.trim() && (
          <div style={{ marginTop: 22, padding: '10px 12px', border: '1px solid #d9d9d9', borderLeft: '3px solid #a8690b', fontSize: 11.5, whiteSpace: 'pre-wrap', color: '#555' }}>
            {notes}
          </div>
        )}
        <p style={{ color: '#999', fontSize: 11, marginTop: 24 }}>Audax Visuals · {T('导出于', 'Exported')} {fmtDate(todayMid())}</p>
      </div>
    </div>
  );
}
