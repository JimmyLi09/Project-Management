'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { fmtDate, overdueItems, projectHealth, projStage, staleInfo, todayMid } from '@/lib/project';
import { canDecide, canEdit } from '@/lib/permissions';
import { useLang } from '@/lib/i18n';
import { Avatar, HM, Icon, Pill } from '../ui';
import type { Project } from '@/lib/types';

const UF: [keyof UFields, string, string][] = [
  ['done', '本周完成', 'Done this week'],
  ['nextNodes', '下周关键节点', 'Next key nodes'],
  ['risks', '当前风险', 'Current risks'],
  ['needDirector', '需 Director 决定', 'Needs Director'],
  ['clientPending', '客户待确认', 'Client pending'],
  ['budget', '预算 / 变更风险', 'Budget / change'],
];
type UFields = { done: string; nextNodes: string; risks: string; needDirector: string; clientPending: string; budget: string };

export default function DirectorUpdateView() {
  const { projects, me, dispatch, openProject } = useStore();
  const { lang, t } = useLang();
  const [filter, setFilter] = useState('all');
  const [showExport, setShowExport] = useState(false);
  const isDirector = canDecide(me);

  const pms = useMemo(() => {
    const s = new Set<string>();
    projects.forEach((p) => (p.owners || []).forEach((n) => s.add(n)));
    return [...s];
  }, [projects]);

  const list = (filter === 'all' ? projects : projects.filter((p) => (p.owners || []).includes(filter))).filter((p) => !p.archived);

  const pendingDecisions = projects.filter((p) => p.update?.needDirector && p.update.dStatus === 'pending');
  const staleCount = projects.filter((p) => staleInfo(p.update).cls !== 'stale-ok' && (p.owners || []).length).length;
  const overdueProjects = projects.filter((p) => overdueItems(p).length).length;

  /* v2.2 §5.2: commercial overdue collections — production done, money not in.
     Reads derived Commercial status so PM delivery is never blamed for late payment. */
  const overdueCollections = useMemo(
    () => projects.filter((p) => !p.archived && (p.commercialStatus === 'overdue' || p.paymentRisk?.level === 'high')),
    [projects],
  );

  return (
    <>
      <div className="kpi-grid four">
        <MiniKpi label={t('待决策', 'Awaiting decision')} value={String(pendingDecisions.length)} color={pendingDecisions.length ? 'var(--bronze)' : 'var(--navy900)'} sub={t('需 Director 批复的事项', 'items needing a Director decision')} />
        <MiniKpi label={t('周报未更新', 'Stale updates')} value={String(staleCount)} color={staleCount ? 'var(--warning)' : 'var(--navy900)'} sub={t('超过 7 天未更新的项目', 'projects not updated for 7+ days')} />
        <MiniKpi label={t('有逾期的项目', 'Projects overdue')} value={String(overdueProjects)} color={overdueProjects ? 'var(--danger)' : 'var(--navy900)'} sub={t('存在逾期阶段的项目', 'projects with overdue phases')} />
        <MiniKpi label={t('逾期收款', 'Overdue collections')} value={String(overdueCollections.length)} color={overdueCollections.length ? 'var(--danger)' : 'var(--success)'} sub={t('已交付但逾期未收款 / 收款高风险', 'delivered but payment overdue / high risk')} />
      </div>

      {overdueCollections.length > 0 && (
        <div className="panel clip" style={{ marginBottom: 20, borderColor: 'var(--danger)' }}>
          <div className="panel-head" style={{ background: '#fdecec' }}>
            <span className="panel-title"><Icon name="alert" style={{ color: 'var(--danger)' }} />{t('逾期收款提醒', 'Overdue collection alerts')} <span className="badge" style={{ background: 'var(--danger)', color: '#fff', marginLeft: 6 }}>{overdueCollections.length}</span></span>
          </div>
          {overdueCollections.map((p) => {
            const inv = p.invoiceClose;
            const high = p.paymentRisk?.level === 'high';
            return (
              <div key={p.id} className="row-hover" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 22px', borderTop: '1px solid var(--row-line)', cursor: 'pointer' }} onClick={() => openProject(p.id)}>
                <span className="badge" style={{ background: '#fbe0e0', color: 'var(--danger)', flexShrink: 0 }}>
                  {p.commercialStatus === 'overdue' ? t('逾期未收款', 'Payment overdue') : t('收款高风险', 'High risk')}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--navy900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>
                    {p.client || '—'}
                    {inv?.invoiceRef ? ` · ${t('发票', 'Inv')} ${inv.invoiceRef}` : ''}
                    {inv?.dueDate ? ` · ${t('到期', 'Due')} ${inv.dueDate}` : ''}
                    {high && p.commercialStatus !== 'overdue' ? ` · ${t('需先收订金', 'deposit due')}` : ''}
                  </div>
                </div>
                <div style={{ flex: 1 }} />
                <Icon name="back" size={15} style={{ transform: 'rotate(180deg)', color: 'var(--text2)' }} />
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 20 }}>
        <button className={`chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>{t('全部负责人', 'All PMs')}</button>
        {pms.map((n) => (
          <button key={n} className={`chip ${filter === n ? 'active' : ''}`} onClick={() => setFilter(n)}>
            <Avatar name={n} size={20} />{n}
          </button>
        ))}
      </div>

      <div className="grid-2col" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 20, alignItems: 'start' }}>
        <div className="panel clip">
          <div className="panel-head">
            <span className="panel-title">{t('每周项目汇报', 'Weekly Project Updates')}</span>
            <button className="btn-line sm" onClick={() => setShowExport(true)} disabled={list.length === 0}
              title={t('导出当前筛选下所有项目的周报', 'Export the weekly report for all projects in the current filter')}>
              <Icon name="download" size={13} />{t('导出全部', 'Export all')}
            </button>
          </div>
          {list.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>{t('没有匹配的项目。', 'No matching projects.')}</div>}
          {list.map((p) => {
            const u = p.update || ({} as typeof p.update);
            const ed = canEdit(me, p);
            const st = staleInfo(u, lang);
            const stage = projStage(p);
            const h = stage === 'complete' || stage === 'invoice' ? 'completed' : projectHealth(p);
            const pm = (p.owners || [])[0];
            return (
              <div key={p.id} style={{ padding: '18px 22px', borderBottom: '1px solid var(--row-line)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    {pm ? <Avatar name={pm} size={30} /> : <Avatar name="?" size={30} />}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy900)', cursor: 'pointer' }} onClick={() => openProject(p.id)}>{p.name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>
                        {pm || t('未指派', 'unassigned')} · <span style={{ color: st.cls === 'stale-ok' ? 'var(--text2)' : st.cls === 'stale-warn' ? 'var(--warning)' : 'var(--danger)' }}>{st.txt}</span>
                      </div>
                    </div>
                  </div>
                  <Pill m={HM[h]} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px', fontSize: 12.5 }}>
                  {UF.map(([f, zh, en]) => {
                    const val = (u as unknown as UFields)[f] || '';
                    return (
                      <div key={f}>
                        <span style={{ color: 'var(--text2)' }}>{t(zh, en)}: </span>
                        {ed ? (
                          <EditableText value={val} onSave={(v) => dispatch(p.id, { type: 'editUpdate', field: f, value: v })} />
                        ) : (
                          <span style={{ color: val ? 'var(--text)' : '#b6bfc9' }}>{val || '—'}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {u.dDecision && (
                  <div style={{ marginTop: 10, fontSize: 12.5, background: 'var(--hover-bg)', border: '1px solid var(--row-line)', borderRadius: 8, padding: '8px 11px' }}>
                    <span style={{ color: 'var(--bronze)', fontWeight: 600 }}>Director:</span> {u.dDecision}
                    <span style={{ color: 'var(--text2)', fontSize: 11 }} className="tnum"> · {u.dBy} {u.dDate}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="panel clip">
          <div className="panel-head">
            <span className="panel-title"><Icon name="flag" style={{ color: 'var(--bronze)' }} />{t('待决策', 'Awaiting Decision')}</span>
          </div>
          {pendingDecisions.length === 0 && (
            <div style={{ padding: 26, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>✓ {t('暂无待决策事项', 'Nothing awaiting decision')}</div>
          )}
          {pendingDecisions.map((p) => (
            <DecisionCard key={p.id} pid={p.id} name={p.name} ask={p.update.needDirector} canAct={isDirector} />
          ))}
        </div>
      </div>

      {showExport && <WeeklyExportOverlay list={list} filter={filter} onClose={() => setShowExport(false)} />}
    </>
  );
}

function WeeklyExportOverlay({ list, filter, onClose }: { list: Project[]; filter: string; onClose: () => void }) {
  const { lang: appLang } = useLang();
  const [lang, setLang] = useState<'en' | 'zh'>(appLang);
  const L = lang;
  const T = (zh: string, en: string) => (L === 'zh' ? zh : en);
  const HLABEL: Record<string, [string, string]> = {
    ontrack: ['正常', 'On track'], watch: ['关注', 'Watch'], risk: ['风险', 'At risk'], completed: ['已完成', 'Completed'],
  };

  /* D14: export the same data as a CSV that opens in Excel / WPS */
  function downloadCsv() {
    const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = [
      T('项目', 'Project'), T('负责人', 'PM'), T('客户', 'Client'), T('健康度', 'Health'), T('更新状态', 'Update state'),
      ...UF.map(([, zh, en]) => T(zh, en)), 'Director',
    ];
    const rows = list.map((p) => {
      const u: any = p.update || {};
      const stage = projStage(p);
      const h = stage === 'complete' || stage === 'invoice' ? 'completed' : projectHealth(p);
      const pm = (p.owners || [])[0] || T('未指派', 'unassigned');
      const st = staleInfo(u, L);
      return [
        p.name, pm, p.client || '', T(HLABEL[h]?.[0] || h, HLABEL[h]?.[1] || h), st.txt,
        ...UF.map(([f]) => (u[f] || '').replace(/\n/g, ' ')),
        u.dDecision ? `${u.dDecision}${u.dBy ? ` (${u.dBy} ${u.dDate || ''})` : ''}` : '',
      ];
    });
    const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM so Excel reads UTF-8
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `weekly-updates-${fmtDate(todayMid())}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="ex-wrap">
      <div className="ex-actions">
        <button className="btn-line sm" style={L === 'en' ? { borderColor: 'var(--navy900)' } : undefined} onClick={() => setLang('en')}>English</button>
        <button className="btn-line sm" style={L === 'zh' ? { borderColor: 'var(--navy900)' } : undefined} onClick={() => setLang('zh')}>中文</button>
        <button className="btn-navy sm" onClick={() => window.print()}>{T('打印 / 另存 PDF', 'Print / Save PDF')}</button>
        <button className="btn-line sm" onClick={downloadCsv}>⬇ {T('导出 Excel (CSV)', 'Export Excel (CSV)')}</button>
        <button className="btn-line sm" onClick={onClose}>{T('关闭', 'Close')}</button>
      </div>
      <div className="ex-doc">
        <h1>{T('每周项目汇报', 'Weekly Project Updates')}</h1>
        <div className="exsub">
          {T('负责人', 'PM')}: {filter === 'all' ? T('全部', 'All') : filter} · {T('项目数', 'Projects')}: {list.length} · {T('导出于', 'Exported')} {fmtDate(todayMid())}
        </div>
        {list.map((p) => {
          const u = p.update || {};
          const stage = projStage(p);
          const h = stage === 'complete' || stage === 'invoice' ? 'completed' : projectHealth(p);
          const pm = (p.owners || [])[0] || T('未指派', 'unassigned');
          const st = staleInfo(u, L);
          return (
            <React.Fragment key={p.id}>
              <h2 style={{ marginBottom: 2 }}>{p.name}</h2>
              <div className="exsub" style={{ marginTop: 0 }}>
                {T('负责人', 'PM')}: {pm} · {T('客户', 'Client')}: {p.client || '—'} · {T('健康度', 'Health')}: {T(HLABEL[h]?.[0] || h, HLABEL[h]?.[1] || h)} · {st.txt}
              </div>
              <table>
                <tbody>
                  {UF.map(([f, zh, en]) => (
                    <tr key={f}>
                      <th style={{ width: '28%' }}>{T(zh, en)}</th>
                      <td style={{ whiteSpace: 'pre-wrap' }}>{(u as any)[f] || '—'}</td>
                    </tr>
                  ))}
                  {u.dDecision && (
                    <tr>
                      <th>Director</th>
                      <td>{u.dDecision}{u.dBy ? ` · ${u.dBy} ${u.dDate || ''}` : ''}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </React.Fragment>
          );
        })}
        <p style={{ color: '#999', fontSize: 11, marginTop: 24 }}>Audax Visuals · {T('导出于', 'Exported')} {fmtDate(todayMid())}</p>
      </div>
    </div>
  );
}

function DecisionCard({ pid, name, ask, canAct }: { pid: string; name: string; ask: string; canAct: boolean }) {
  const { dispatch, openProject } = useStore();
  const { t } = useLang();
  const [note, setNote] = useState('');

  async function decide(status: 'approved' | 'rejected' | 'needinfo') {
    if (note.trim()) await dispatch(pid, { type: 'setDecision', field: 'dDecision', value: note.trim() });
    await dispatch(pid, { type: 'setDecision', field: 'dStatus', value: status });
  }

  return (
    <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--row-line)' }}>
      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{ask.split('\n')[0]}</div>
      <div style={{ fontSize: 12, color: 'var(--text2)', margin: '4px 0 11px', cursor: 'pointer' }} onClick={() => openProject(pid)}>{name}</div>
      {canAct ? (
        <>
          <textarea className="in" placeholder={t('批复 / 指示…', 'Decision note…')} value={note} onChange={(e) => setNote(e.target.value)} style={{ marginBottom: 9, minHeight: 40 }} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-navy sm" onClick={() => decide('approved')}>{t('批准', 'Approve')}</button>
            <button className="btn-line sm" onClick={() => decide('needinfo')}>{t('需补充', 'Need info')}</button>
            <button className="btn-line sm danger" onClick={() => decide('rejected')}>{t('驳回', 'Reject')}</button>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text2)' }}>{t('等待 PD/BD 批复', 'Waiting for PD/BD decision')}</div>
      )}
    </div>
  );
}

function EditableText({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const { t } = useLang();
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <span
        style={{ color: value ? 'var(--text)' : '#b6bfc9', cursor: 'text', borderBottom: '1px dashed var(--border)' }}
        onClick={() => setEditing(true)}
        title={t('点击编辑', 'Click to edit')}
      >
        {value || t('点击填写…', 'Click to fill in…')}
      </span>
    );
  }
  return (
    <textarea
      className="in" autoFocus defaultValue={value}
      style={{ marginTop: 4, minHeight: 40, fontSize: 12.5 }}
      onBlur={(e) => { setEditing(false); if (e.target.value !== value) onSave(e.target.value); }}
    />
  );
}

function MiniKpi({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <div className="kpi" style={{ padding: '20px 22px' }}>
      <div className="kpi-label">{label}</div>
      <div className="tnum" style={{ fontSize: 34, fontWeight: 600, color: color || 'var(--navy900)', marginTop: 6, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6 }}>{sub}</div>
    </div>
  );
}
