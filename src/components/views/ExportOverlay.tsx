'use client';

import React, { useState } from 'react';
import { fmtDate, pkgStart, planDates, projCode, projStage, todayMid } from '@/lib/project';
import { useLang } from '@/lib/i18n';
import { STAGES, stageIdx, SVC, svcColor, svcLabel } from '@/lib/templates';
import type { Project } from '@/lib/types';

type Cols = { owner: boolean; start: boolean; due: boolean; status: boolean; clStatus: boolean; clDate: boolean; clRemark: boolean };
export type ExportScope = 'all' | 'schedule' | 'checklist';

/* REQ-007: scope lets the caller export only the排期 or only the信息清单. */
export default function ExportOverlay({ p, onClose, scope = 'all' }: { p: Project; onClose: () => void; scope?: ExportScope }) {
  const { lang: appLang } = useLang();
  const [lang, setLang] = useState<'en' | 'zh'>(appLang);
  const [cols, setCols] = useState<Cols>({ owner: true, start: true, due: true, status: true, clStatus: true, clDate: true, clRemark: true });
  const L = lang;
  const T = (zh: string, en: string) => (L === 'zh' ? zh : en);
  const showSched = scope !== 'checklist';
  const showCl = scope !== 'schedule';
  const scopeLabel = scope === 'schedule' ? T('生产排期', 'Schedule') : scope === 'checklist' ? T('信息清单', 'Checklist') : '';
  const svcNames = p.services.map((k) => (SVC[k] ? (L === 'zh' ? SVC[k].label : SVC[k].en) : k)).join(', ');
  const clSpan = 2 + (cols.clStatus ? 1 : 0) + (cols.clDate ? 1 : 0) + (cols.clRemark ? 1 : 0);

  const colToggle = (c: keyof Cols, zh: string, en: string) => (
    <label className="ex-col" key={c}>
      <input type="checkbox" checked={cols[c]} onChange={() => setCols({ ...cols, [c]: !cols[c] })} /> {T(zh, en)}
    </label>
  );

  return (
    <div className="ex-wrap">
      <div className="ex-actions">
        <button className="btn-line sm" style={L === 'en' ? { borderColor: 'var(--navy900)' } : undefined} onClick={() => setLang('en')}>English</button>
        <button className="btn-line sm" style={L === 'zh' ? { borderColor: 'var(--navy900)' } : undefined} onClick={() => setLang('zh')}>中文</button>
        <button className="btn-navy sm" onClick={() => window.print()}>{T('打印 / 另存 PDF', 'Print / Save PDF')}</button>
        <button className="btn-line sm" onClick={onClose}>{T('关闭', 'Close')}</button>
      </div>
      <div className="ex-colbar">
        {T('显示栏位', 'Columns')}:
        {showSched && <span className="ex-grp">排期 {colToggle('owner', '负责', 'Owner')}{colToggle('start', '开始', 'Start')}{colToggle('due', '到期', 'Due')}{colToggle('status', '状态', 'Status')}</span>}
        {showCl && <span className="ex-grp">清单 {colToggle('clStatus', '状态', 'Status')}{colToggle('clDate', '日期', 'Date')}{colToggle('clRemark', '备注', 'Remark')}</span>}
      </div>
      <div className="ex-doc">
        <h1>{projCode(p) ? projCode(p) + ' · ' : ''}{p.name}{scopeLabel ? ` — ${scopeLabel}` : ''}</h1>
        <div className="exsub">
          {T('客户', 'Client')}: {p.client || '—'} · {T('服务', 'Services')}: {svcNames} · {T('阶段', 'Stage')}:{' '}
          {L === 'zh' ? STAGES[stageIdx(projStage(p))][1] : STAGES[stageIdx(projStage(p))][2]}
        </div>
        {p.packages.map((pkg, pi) => {
          const pd = planDates(pkg, pkgStart(p, pkg));
          const svcName = SVC[pkg.svc] ? (L === 'zh' ? SVC[pkg.svc].label : SVC[pkg.svc].en) : pkg.svc;
          const clStat: Record<string, string> = {
            pending: T('未收到', 'Pending'), received: T('已收到', 'Received'), confirmed: T('已确认', 'Confirmed'),
            na: 'N/A', revision: T('需修订', 'Revision'), rejected: T('退回', 'Rejected'),
          };
          const groups = pkg.checklist
            .map((g) => ({ g, items: g.items.filter((it) => !((it.status === 'pending' || it.status === 'na') && !it.date && !it.remark)) }))
            .filter((x) => x.items.length);
          return (
            <React.Fragment key={pi}>
              <h2 style={{ color: svcColor(pkg.svc) }}>{svcName}{scope === 'all' ? ` — ${T('生产排期', 'Production Schedule')}` : ''}</h2>
              {showSched && (<>
              <table>
                <tbody>
                  <tr>
                    <th>#</th><th>{T('阶段/任务', 'Phase / Task')}</th>
                    {cols.owner && <th>{T('负责', 'Owner')}</th>}
                    {cols.start && <th>{T('开始', 'Start')}</th>}
                    {cols.due && <th>{T('到期', 'Due')}</th>}
                    {cols.status && <th>{T('状态', 'Status')}</th>}
                  </tr>
                  {pkg.schedule.map((r, i) => {
                    const d = pd[i];
                    const stt = {
                      todo: T('未开始', 'Not started'), wip: T('进行中', 'In progress'),
                      done: T('已完成', 'Done'), block: T('受阻', 'Blocked'),
                    }[r.status];
                    return (
                      <tr key={i}>
                        <td>{r.no}</td>
                        <td>{(L === 'zh' ? r.task : r.taskEn)}{r.freeze ? ' ★' : ''}</td>
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
                  <table>
                    <tbody>
                      <tr><th>{T('服务项', 'Service item')}</th><th>{T('数量', 'Detail')}</th><th>{T('特别说明', 'Special notes')}</th></tr>
                      {pkg.scopeItems.map((s, si) => (
                        <tr key={si}><td>{s.item || '—'}</td><td>{s.qty || '—'}</td><td>{s.note || '—'}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              </>)}
              {showCl && <>
              <h3 style={{ fontSize: 12.5, margin: '12px 0 6px' }}>{T('信息清单(仅含已填写)', 'Information Checklist (filled only)')}</h3>
              {groups.length === 0 ? (
                <p style={{ color: '#888' }}>{T('暂无已填写的信息项。', 'No filled-in items yet.')}</p>
              ) : groups.map(({ g, items }, gi) => (
                <table key={gi}>
                  <tbody>
                    <tr className="grp-h"><td colSpan={clSpan}>{L === 'zh' ? g.group : g.groupEn}</td></tr>
                    <tr>
                      <th>{T('信息项', 'Item')}</th>
                      <th>{T('负责人', 'Owner')}</th>
                      {cols.clStatus && <th>{T('状态', 'Status')}</th>}
                      {cols.clDate && <th>{T('收到日期', 'Date received')}</th>}
                      {cols.clRemark && <th>{T('备注', 'Remark')}</th>}
                    </tr>
                    {items.map((it, ii) => (
                      <tr key={ii}>
                        <td>{L === 'zh' ? it.zh : it.en}</td>
                        <td>{it.owner || '—'}</td>
                        {cols.clStatus && <td>{clStat[it.status] || it.status}</td>}
                        {cols.clDate && <td>{it.date || '—'}</td>}
                        {cols.clRemark && <td>{it.remark || '—'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
              </>}
            </React.Fragment>
          );
        })}
        <p style={{ color: '#999', fontSize: 11, marginTop: 24 }}>Audax Visuals · {T('导出于', 'Exported')} {fmtDate(todayMid())}</p>
      </div>
    </div>
  );
}
