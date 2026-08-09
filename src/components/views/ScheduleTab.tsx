'use client';

import React, { useState } from 'react';
import { useStore } from '../store';
import { fmtDate, isoDate, MACRO, macroStage, parseISO, pkgStart, planDates, todayMid } from '@/lib/project';
import { canEdit, canRowEdit } from '@/lib/permissions';
import { svcColor, svcName } from '@/lib/templates';
import { useLang } from '@/lib/i18n';
import { Avatar, Icon, Pill, TM } from '../ui';
import FragmentBar from '../FragmentBar';
import type { PlanDate } from '@/lib/project';
import type { Project, ScheduleStatus } from '@/lib/types';

const NEXT: Record<ScheduleStatus, ScheduleStatus> = { todo: 'wip', wip: 'done', done: 'block', block: 'todo' };

export default function ScheduleTab({ p, pkgIdx, onExport, onPkg }: {
  p: Project; pkgIdx: number; onExport: () => void; onPkg: (i: number) => void;
}) {
  const { me, dispatch, users, setToast } = useStore();
  const { lang, t } = useLang();
  const [editMode, setEditMode] = useState(false);
  const [showCal, setShowCal] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  /* REQ-018: template style (stored on the project) + its edit toggle */
  const style = p.schedStyle || 'classic';
  const [tplEdit, setTplEdit] = useState(false);
  const ed = canEdit(me, p);
  const pkg = p.packages[pkgIdx];
  const assigneeNames = users.filter((u) => u.role === 'pm' || u.role === 'member' || u.role === 'director' || u.role === 'bd').map((u) => u.name);
  const pd = planDates(pkg, pkgStart(p, pkg));
  const t0 = todayMid();

  /* package slack */
  const del = parseISO(pkg.delivery);
  let fin: Date | null = null;
  for (let i = pd.length - 1; i >= 0; i--) { if (pd[i]) { fin = pd[i]!.end; break; } }
  let slackNode: React.ReactNode = <span style={{ color: 'var(--text2)', fontSize: 12 }}>{t('填交付日核算', 'Set delivery to check')}</span>;
  if (del && fin) {
    const fb = new Date(fin);
    fb.setDate(fb.getDate() + (pkg.buffer || 0));
    const sl = Math.round((del.getTime() - fb.getTime()) / 86400000);
    slackNode = sl >= 0
      ? <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: 12.5 }}>✓ {t(`富余 ${sl} 天`, `${sl} days slack`)}</span>
      : <span style={{ color: 'var(--danger)', fontWeight: 600, fontSize: 12.5 }}>⚠ {t(`超 ${-sl} 天`, `${-sl} days over`)}</span>;
  }

  /* group rows by macro stage */
  const groups: { m: number; rows: { r: Project['packages'][0]['schedule'][0]; i: number }[] }[] = [];
  pkg.schedule.forEach((r, i) => {
    const m = macroStage(r, i);
    const last = groups[groups.length - 1];
    if (!last || last.m !== m) groups.push({ m, rows: [{ r, i }] });
    else last.rows.push({ r, i });
  });

  return (
    <>
      {p.packages.length > 1 && (
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 16 }}>
          {p.packages.map((pk, i) => (
            <button key={i} className={`chip ${i === pkgIdx ? 'active' : ''}`}
              style={i === pkgIdx ? { background: svcColor(pk.svc), borderColor: svcColor(pk.svc) } : undefined}
              onClick={() => onPkg(i)}>
              {svcName(pk.svc, lang)}
            </button>
          ))}
        </div>
      )}

      {/* package bar */}
      <div className="panel" style={{ padding: '14px 20px', marginBottom: 16, display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <Field label={t('起始', 'Start')}>
          {/* controlled (no value-based key) so picking month/day doesn't remount
              and close the native picker mid-selection (A3) */}
          {ed ? <input type="date" className="in sm" value={pkg.start || ''}
            onChange={(e) => dispatch(p.id, { type: 'setPkgField', pkg: pkgIdx, field: 'start', value: e.target.value })} />
            : <b className="tnum">{pkgStart(p, pkg) ? fmtDate(parseISO(pkgStart(p, pkg))) : '—'}</b>}
        </Field>
        <Field label={t('交付', 'Delivery')}>
          {ed ? <input type="date" className="in sm" value={pkg.delivery || ''}
            onChange={(e) => {
              const v = e.target.value; const startIso = pkgStart(p, pkg);
              // REQ-001: 交付日不能早于开始日
              if (v && startIso && v < startIso) { setToast(t('交付日不能早于开始日', 'Delivery cannot be before the start date')); return; }
              dispatch(p.id, { type: 'setPkgField', pkg: pkgIdx, field: 'delivery', value: v });
            }} />
            : <b className="tnum">{pkg.delivery ? fmtDate(parseISO(pkg.delivery)) : '—'}</b>}
        </Field>
        <Field label="Buffer">
          {ed ? <input type="number" min={0} className="in sm" style={{ width: 64 }} defaultValue={pkg.buffer || 0} key={`b${pkg.buffer}`}
            onBlur={(e) => (parseInt(e.target.value) || 0) !== (pkg.buffer || 0) && dispatch(p.id, { type: 'setPkgBuffer', pkg: pkgIdx, value: parseInt(e.target.value) || 0 })} />
            : <b className="tnum">{pkg.buffer || 0}</b>}
        </Field>
        <Field label={t('本服务负责', 'Owner')}>
          {ed ? <input className="in sm" style={{ width: 100 }} defaultValue={pkg.owner || ''} key={`o${pkg.owner}`} placeholder={t('人', 'name')}
            onBlur={(e) => e.target.value !== (pkg.owner || '') && dispatch(p.id, { type: 'setPkgField', pkg: pkgIdx, field: 'owner', value: e.target.value })} />
            : <b>{pkg.owner || '—'}</b>}
        </Field>
        <div style={{ flex: 1 }} />
        {slackNode}
        {ed && <button className="btn-line sm" onClick={() => dispatch(p.id, { type: 'reversePkg', pkg: pkgIdx })}>↩ {t('按交付日倒排', 'Back-plan from delivery')}</button>}
        {ed && <button className="btn-line sm" onClick={() => setEditMode(!editMode)}>{editMode ? t('完成编辑', 'Done editing') : t('编辑阶段', 'Edit phases')}</button>}
        <button className={`btn-line sm ${showCal ? 'active' : ''}`} onClick={() => setShowCal((v) => !v)} style={showCal ? { borderColor: 'var(--navy700)', color: 'var(--navy900)' } : undefined}>📅 {t('交付日历', 'Calendar')}</button>
        <button className="btn-line sm" onClick={onExport}><Icon name="download" size={13} />{t('导出排期', 'Export Schedule')}</button>
      </div>

      {/* REQ-018: schedule template switcher */}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <span className="mini-label" style={{ fontWeight: 700, color: 'var(--navy900)' }}>{t('排期样式', 'Template')}:</span>
        {([['classic', '经典编辑', 'Classic'], ['weeks', '按服务分组(周)', 'By service (weeks)'], ['dates', '按日期(Scale Model)', 'By date (Scale Model)']] as const).map(([k, zh, en]) => (
          <button key={k} className={`chip ${style === k ? 'active' : ''}`}
            onClick={() => ed ? dispatch(p.id, { type: 'setSchedStyle', value: k }) : setToast(t('无编辑权限', 'No edit permission'))}>
            {t(zh, en)}
          </button>
        ))}
        {style !== 'classic' && ed && (
          <button className="btn-line sm" style={tplEdit ? { borderColor: 'var(--navy700)', color: 'var(--navy900)', fontWeight: 600 } : undefined}
            onClick={() => setTplEdit(!tplEdit)}>{tplEdit ? t('完成', 'Done') : t('编辑', 'Edit')}</button>
        )}
      </div>

      {/* REQ-012: import this package's schedule from another project / a saved template */}
      {ed && <FragmentBar p={p} pkgIdx={pkgIdx} kind="schedule" />}

      {/* REQ-002: delivery calendar (Gantt-style timeline) — time-linked to weeks */}
      {showCal && <DeliveryCalendar p={p} pkg={pkg} pd={pd} t0={t0} lang={lang} t={t} />}

      {/* REQ-018 style A/B templates — replace the classic table when selected */}
      {style === 'weeks' && <WeeksTemplate p={p} ed={ed && tplEdit} dispatch={dispatch} lang={lang} t={t} />}
      {style === 'dates' && <DatesTemplate p={p} pkg={pkg} pkgIdx={pkgIdx} pd={pd} ed={ed && tplEdit} dispatch={dispatch} lang={lang} t={t} />}
      {style !== 'classic' && (
        <p style={{ marginTop: 12, fontSize: 12.5, color: 'var(--text2)' }}>
          {t('日期与「交付日历」「导出」同源:改周期或日期,日历与导出即时跟随。切回「经典编辑」可用完整的阶段编辑工具。',
             'Dates feed the delivery calendar and the export from the same source — change weeks or dates and both follow. Switch to Classic for the full phase editor.')}
        </p>
      )}

      {/* datalist shared by the assignee inputs (B4) */}
      <datalist id="assignee-names">{assigneeNames.map((n) => <option key={n} value={n} />)}</datalist>

      {/* C5: resource links — web links / network paths to renders, VR, drone, models */}
      <div className="panel" style={{ padding: '12px 16px', marginBottom: 14 }}>
        <div className="mini-label" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: 'var(--navy900)' }}>
          🔗 {t('资料链接(效果图 / VR / 航拍 / 模型 的网盘或路径)', 'Resource links (cloud/paths to renders, VR, drone, models)')}
        </div>
        {ed ? (
          <textarea className="in" style={{ width: '100%', minHeight: 44, fontSize: 12.5 }}
            defaultValue={pkg.resourceLinks || ''} placeholder={t('每行一个链接或路径,例如 \\\\NAS\\Project\\renders 或 https://drive...', 'One link/path per line, e.g. \\\\NAS\\Project\\renders or https://drive...')}
            onBlur={(e) => e.target.value !== (pkg.resourceLinks || '') && dispatch(p.id, { type: 'setPkgField', pkg: pkgIdx, field: 'resourceLinks', value: e.target.value })} />
        ) : (
          <div style={{ fontSize: 12.5, color: pkg.resourceLinks ? 'var(--text)' : 'var(--text2)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {pkg.resourceLinks || t('（未填写）', '(none)')}
          </div>
        )}
      </div>

      {/* R5-3: service scope / deliverables (like the sales job record: item · qty · notes) */}
      <div className="panel" style={{ padding: '12px 16px', marginBottom: 14 }}>
        <div className="mini-label" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: 'var(--navy900)' }}>
          📋 {t('服务内容 / 交付清单', 'Service scope / deliverables')}
          <span style={{ fontWeight: 400, color: 'var(--text2)' }}>{t('（项目 · 数量 · 说明）', '(item · qty · notes)')}</span>
        </div>
        {(pkg.scopeItems && pkg.scopeItems.length > 0) || ed ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: ed ? 'minmax(160px,1.6fr) 90px minmax(200px,2.4fr) 28px' : 'minmax(160px,1.6fr) 90px minmax(200px,2.4fr)', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--row-line)', fontSize: 11, fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase', color: 'var(--text2)' }}>
              <div>{t('服务项', 'Service item')}</div><div>{t('数量', 'Detail')}</div><div>{t('特别说明', 'Special notes')}</div>{ed && <div />}
            </div>
            {(pkg.scopeItems || []).map((s, si) => (
              <div key={si} style={{ display: 'grid', gridTemplateColumns: ed ? 'minmax(160px,1.6fr) 90px minmax(200px,2.4fr) 28px' : 'minmax(160px,1.6fr) 90px minmax(200px,2.4fr)', gap: 10, alignItems: 'start', padding: '8px 0', borderBottom: '1px solid var(--row-line)' }}>
                {ed ? <>
                  <input className="in sm" defaultValue={s.item} placeholder={t('如 Hero Shot', 'e.g. Hero Shot')}
                    onBlur={(e) => e.target.value !== s.item && dispatch(p.id, { type: 'editScopeItem', pkg: pkgIdx, idx: si, field: 'item', value: e.target.value })} />
                  <input className="in sm" defaultValue={s.qty} placeholder={t('数量', 'qty')}
                    onBlur={(e) => e.target.value !== s.qty && dispatch(p.id, { type: 'editScopeItem', pkg: pkgIdx, idx: si, field: 'qty', value: e.target.value })} />
                  <textarea className="in sm" rows={1} defaultValue={s.note} placeholder={t('分辨率 / 包含项 / 备注…', 'resolution / inclusions / notes…')} style={{ minHeight: 30, resize: 'vertical', lineHeight: 1.5 }}
                    onBlur={(e) => e.target.value !== s.note && dispatch(p.id, { type: 'editScopeItem', pkg: pkgIdx, idx: si, field: 'note', value: e.target.value })} />
                  <button style={{ color: 'var(--danger)', fontWeight: 700 }} title={t('删除', 'Delete')} onClick={() => dispatch(p.id, { type: 'removeScopeItem', pkg: pkgIdx, idx: si })}>✕</button>
                </> : <>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{s.item || '—'}</div>
                  <div className="tnum" style={{ fontSize: 13 }}>{s.qty || '—'}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text2)', whiteSpace: 'pre-wrap' }}>{s.note || '—'}</div>
                </>}
              </div>
            ))}
            {ed && (
              <button className="btn-line sm" style={{ marginTop: 10, alignSelf: 'flex-start', borderStyle: 'dashed' }}
                onClick={() => dispatch(p.id, { type: 'addScopeItem', pkg: pkgIdx })}>+ {t('添加服务项', 'Add item')}</button>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>{t('（未填写）', '(none)')}</div>
        )}
      </div>

      {style === 'classic' && (<>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, fontSize: 12.5, color: 'var(--text2)', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="lock" size={14} style={{ color: 'var(--navy700)' }} /> {t('冻结点 — 确认后锁定,改动影响下游', 'Freeze point — locked once confirmed; changes ripple downstream')}</span>
        {ed && !editMode && <span style={{ color: 'var(--navy700)' }}>⠿ {t('拖动左侧手柄即可调整阶段顺序(无需进入编辑)', 'Drag the ⠿ handle to reorder phases — no edit mode needed')}</span>}
      </div>

      <div className="panel clip">
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 720 }}>
            {groups.map((g, gi) => (
              <div key={gi}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '15px 24px', background: 'var(--hover-bg)', borderBottom: '1px solid var(--border)', borderTop: gi ? '1px solid var(--border)' : 'none' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: MACRO[g.m][2] }} />
                  <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '.03em', color: 'var(--navy900)', textTransform: 'uppercase' }}>
                    {lang === 'zh' ? MACRO[g.m][0] : MACRO[g.m][1]}
                  </span>
                  <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{g.rows.filter((x) => x.r.status === 'done').length}/{g.rows.length} {t('已完成', 'done')}</span>
                </div>
                {g.rows.map(({ r, i }) => {
                  const d = pd[i];
                  const over = r.status !== 'done' && d && d.end < t0;
                  const done = r.status === 'done';
                  const rowEd = canRowEdit(me, p, r);
                  const gateTxt = r.gate && r.gate.trim() ? r.gate.replace(/★\s*/, '') : '';
                  const taskMain = lang === 'zh' ? r.task : r.taskEn || r.task;
                  const taskSub = lang === 'zh' ? r.taskEn : r.task;
                  return (
                    <div key={r.id || i} className="row-hover"
                      onDragOver={ed && !editMode ? (e) => { e.preventDefault(); if (overIdx !== i) setOverIdx(i); } : undefined}
                      onDrop={ed && !editMode ? (e) => { e.preventDefault(); if (dragIdx != null && dragIdx !== i) dispatch(p.id, { type: 'reorderRow', pkg: pkgIdx, from: dragIdx, to: i }); setDragIdx(null); setOverIdx(null); } : undefined}
                      style={{
                        display: 'grid', gridTemplateColumns: '26px 26px minmax(220px,2fr) 40px 1.15fr 120px', gap: 15, alignItems: 'center',
                        padding: '18px 24px', borderBottom: '1px solid var(--row-line)',
                        borderLeft: `3px solid ${over ? 'var(--danger)' : r.custom ? '#7c5bd6' : r.freeze ? 'var(--bronze)' : 'transparent'}`,
                        boxShadow: overIdx === i && dragIdx != null && dragIdx !== i ? 'inset 0 2px 0 var(--navy700)' : undefined,
                        opacity: dragIdx === i ? 0.45 : 1,
                      }}>
                      <button className={`ckbox ${done ? 'on' : ''} ${rowEd ? '' : 'locked'}`}
                        onClick={rowEd ? () => dispatch(p.id, { type: 'toggleDone', pkg: pkgIdx, idx: i }) : undefined}>
                        {done && <Icon name="checkSm" size={13} style={{ color: '#fff' }} />}
                      </button>
                      {ed && !editMode ? (
                        <span
                          draggable
                          onDragStart={(e) => { setDragIdx(i); e.dataTransfer.effectAllowed = 'move'; }}
                          onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
                          title={t('拖动调整顺序', 'Drag to reorder')}
                          style={{ cursor: 'grab', color: 'var(--text2)', display: 'flex', justifyContent: 'center', userSelect: 'none', fontSize: 14, lineHeight: 1 }}
                        >⠿</span>
                      ) : (
                        <span style={{ color: 'var(--navy700)', display: 'flex', justifyContent: 'center' }}>
                          {/* REQ-017: number by position so deletions renumber */}
                          {r.freeze ? <Icon name="lock" size={14} /> : <span className="tnum" style={{ fontSize: 11, color: 'var(--text2)' }}>{i}</span>}
                        </span>
                      )}
                      <div style={{ minWidth: 0 }}>
                        {editMode && ed ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <input className="in sm" defaultValue={r.task} placeholder={t('任务名(中)', 'Task (ZH)')}
                              onBlur={(e) => e.target.value !== r.task && dispatch(p.id, { type: 'editSched', pkg: pkgIdx, idx: i, field: 'task', value: e.target.value })} />
                            <input className="in sm" defaultValue={r.taskEn} placeholder="Task (EN)"
                              onBlur={(e) => e.target.value !== r.taskEn && dispatch(p.id, { type: 'editSched', pkg: pkgIdx, idx: i, field: 'taskEn', value: e.target.value })} />
                            <div style={{ display: 'flex', gap: 6 }}>
                              <input className="in sm" style={{ flex: 1 }} defaultValue={r.owner} placeholder={t('角色', 'Owner role')}
                                onBlur={(e) => e.target.value !== r.owner && dispatch(p.id, { type: 'editSched', pkg: pkgIdx, idx: i, field: 'owner', value: e.target.value })} />
                              <input className="in sm" type="number" step={0.5} min={0} style={{ width: 66 }} defaultValue={r.weeks} title={t('周数', 'weeks')}
                                onBlur={(e) => {
                                  const raw = e.target.value.trim(); const v = parseFloat(raw);
                                  // REQ-001: 周期须为 ≥ 0 的数字;非法则拦截并还原
                                  if (raw !== '' && (isNaN(v) || v < 0)) { setToast(t('周期需为 ≥ 0 的数字', 'Weeks must be a number ≥ 0')); e.target.value = String(r.weeks); return; }
                                  const nv = isNaN(v) ? 0 : v;
                                  if (nv !== r.weeks) dispatch(p.id, { type: 'editSchedNum', pkg: pkgIdx, idx: i, field: 'weeks', value: nv });
                                }} />
                            </div>
                            {/* B4: pick assignee from accounts (still allows a free-typed name) */}
                            <input className="in sm" list="assignee-names" defaultValue={r.assignee} placeholder={t('👤 指派给(可选账号)', '👤 Assignee (pick account)')}
                              onBlur={(e) => e.target.value !== r.assignee && dispatch(p.id, { type: 'editSched', pkg: pkgIdx, idx: i, field: 'assignee', value: e.target.value })} />
                            <div style={{ display: 'flex', gap: 6 }}>
                              <input type="date" className="in sm" style={{ flex: 1 }} value={r.s} title={t('开始(覆盖)', 'Start override')}
                                onChange={(e) => dispatch(p.id, { type: 'editSched', pkg: pkgIdx, idx: i, field: 's', value: e.target.value })} />
                              <input type="date" className="in sm" style={{ flex: 1 }} value={r.e} title={t('结束(覆盖)', 'End override')}
                                onChange={(e) => dispatch(p.id, { type: 'editSched', pkg: pkgIdx, idx: i, field: 'e', value: e.target.value })} />
                            </div>
                            {/* C4: delay reason — shows a red 延期 mark on the row when set */}
                            <input className="in sm" defaultValue={r.delayNote || ''} placeholder={t('延期原因(可空,填了显示红色标记)', 'Delay reason (optional, shows a red mark)')}
                              onBlur={(e) => e.target.value !== (r.delayNote || '') && dispatch(p.id, { type: 'editSched', pkg: pkgIdx, idx: i, field: 'delayNote', value: e.target.value })} />
                            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                              <span style={{ display: 'flex', gap: 4 }}>
                                <button className="btn-line sm" title={t('上移', 'Move up')} disabled={i === 0}
                                  onClick={() => dispatch(p.id, { type: 'moveRow', pkg: pkgIdx, idx: i, dir: -1 })}>↑</button>
                                <button className="btn-line sm" title={t('下移', 'Move down')} disabled={i === pkg.schedule.length - 1}
                                  onClick={() => dispatch(p.id, { type: 'moveRow', pkg: pkgIdx, idx: i, dir: 1 })}>↓</button>
                              </span>
                              <button style={{ color: 'var(--danger)', fontSize: 12, fontWeight: 600 }}
                                onClick={() => { if (confirm(t('删除此阶段?', 'Delete this phase?'))) dispatch(p.id, { type: 'removeRow', pkg: pkgIdx, idx: i }); }}>✕ {t('删除此阶段', 'Delete phase')}</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div style={{ fontSize: 13.5, fontWeight: 500, textDecoration: done ? 'line-through' : 'none', color: done ? 'var(--text2)' : 'var(--text)', display: 'flex', alignItems: 'center', gap: 7 }}>
                              {r.custom && <span style={{ fontSize: 10, fontWeight: 700, color: '#7c5bd6', background: '#efe9fb', borderRadius: 5, padding: '1px 6px', letterSpacing: '.02em' }}>＋{t('自定义', 'Custom')}</span>}
                              {taskMain}
                            </div>
                            <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>{taskSub}{r.owner ? ` · ${r.owner}` : ''}{r.assignee && r.custom ? ` · ${r.assignee}` : ''}</div>
                            {gateTxt && (
                              <div style={{ display: 'inline-flex', gap: 5, marginTop: 5, fontSize: 11.5, color: r.freeze ? '#8f5b1d' : 'var(--text2)', background: r.freeze ? '#f6ecdd' : 'var(--row-line2)', borderRadius: 6, padding: '3px 8px' }}>
                                {r.freeze ? '★' : '›'} {gateTxt}
                              </div>
                            )}
                            {r.delayNote && (
                              <div style={{ display: 'inline-flex', gap: 5, marginTop: 5, marginLeft: gateTxt ? 6 : 0, fontSize: 11.5, color: '#b23a32', background: '#fbe9e7', borderRadius: 6, padding: '3px 8px', fontWeight: 600 }}>
                                ⚠ {t('延期', 'Delayed')} · {r.delayNote}
                              </div>
                            )}
                            <input
                              className="in sm" placeholder={t('批注 / 实际情况…', 'Note / actual status…')} defaultValue={r.note} readOnly={!ed}
                              style={{ marginTop: 9, width: '100%', background: 'var(--hover-bg)', border: '1px solid var(--row-line)' }}
                              onBlur={(e) => { if (ed && e.target.value !== r.note) dispatch(p.id, { type: 'editSched', pkg: pkgIdx, idx: i, field: 'note', value: e.target.value }); }}
                            />
                          </>
                        )}
                      </div>
                      <div>{r.assignee ? <Avatar name={r.assignee} size={26} /> : null}</div>
                      {/* D6: dates editable inline (not only in edit mode). Editing sets
                          a start/end override; blank falls back to the planned date. */}
                      {ed && !editMode ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <input type="date" className="in sm" style={{ fontSize: 11, padding: '2px 5px', ...(over ? { borderColor: '#e7a19b', color: '#b23a32' } : {}) }}
                            title={t('开始(可改)', 'Start (editable)')} value={r.s || (d ? isoDate(d.start) : '')}
                            onChange={(e) => dispatch(p.id, { type: 'editSched', pkg: pkgIdx, idx: i, field: 's', value: e.target.value })} />
                          <input type="date" className="in sm" style={{ fontSize: 11, padding: '2px 5px', ...(over ? { borderColor: '#e7a19b', color: '#b23a32' } : {}) }}
                            title={t('结束(可改)', 'End (editable)')} value={r.e || (d ? isoDate(d.end) : '')}
                            onChange={(e) => dispatch(p.id, { type: 'editSched', pkg: pkgIdx, idx: i, field: 'e', value: e.target.value })} />
                          <div style={{ fontSize: 10.5, color: 'var(--text2)' }}>{r.typical}</div>
                        </div>
                      ) : (
                        <div className="tnum" style={{ fontSize: 12, color: over ? 'var(--danger)' : 'var(--text2)', fontWeight: over ? 600 : 400 }}>
                          {d ? <>{fmtDate(d.start).slice(0, 6)} → {fmtDate(d.end).slice(0, 6)}</> : '—'}
                          <div style={{ fontSize: 10.5, color: 'var(--text2)', fontWeight: 400 }}>{r.typical}</div>
                        </div>
                      )}
                      <div style={{ justifySelf: 'end' }}>
                        <button
                          style={{ cursor: rowEd ? 'pointer' : 'not-allowed', opacity: rowEd ? 1 : .6, background: 'none', padding: 0 }}
                          title={rowEd ? t('点击切换状态', 'Click to change status') : t('无编辑权限', 'No edit permission')}
                          onClick={rowEd ? () => dispatch(p.id, { type: 'setRowStatus', pkg: pkgIdx, idx: i, status: NEXT[r.status] }) : undefined}
                        >
                          <Pill m={TM[r.status]} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      {editMode && ed && (
        <button className="btn-line" style={{ width: '100%', marginTop: 12, justifyContent: 'center', borderStyle: 'dashed' }}
          onClick={() => dispatch(p.id, { type: 'addRow', pkg: pkgIdx })}>+ {t('添加阶段', 'Add phase')}</button>
      )}
      </>)}
      {ed && <AddNodeBar pid={p.id} pkgIdx={pkgIdx} />}
      {/* REQ-018 style B: add red milestone / holiday band rows */}
      {ed && style === 'dates' && <SpecialRowBar pid={p.id} pkgIdx={pkgIdx} />}
      {style === 'classic' && (
        <p style={{ marginTop: 12, fontSize: 12.5, color: 'var(--text2)' }}>
          {t('勾选=完成;未勾且过期=逾期(红边)。点状态徽章切换 未开始→进行中→已完成→受阻。团队成员只能操作指派给自己(👤)的任务。',
            'Tick = done; unticked past due = overdue (red edge). Click the status pill to cycle To Do → In Progress → Done → Blocked. Members can only act on tasks assigned 👤 to them.')}
        </p>
      )}
    </>
  );
}

/* ===== REQ-018 style A: per-service grouped weeks table =====
   One section per service package (service name as sub-heading), columns
   # / Phase-Task / dates / Duration, a Subtotal per service and an overall
   Sum at the very bottom. No week brackets on the right. */
export function WeeksTemplate({ p, ed, dispatch, lang, t }: {
  p: Project; ed: boolean; lang: 'zh' | 'en';
  dispatch: (pid: string, a: import('@/server/actions').ProjectAction) => Promise<boolean>;
  t: (zh: string, en: string) => string;
}) {
  let overall = 0;
  return (
    <div className="panel clip">
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 640 }}>
          {p.packages.map((pkg, pi) => {
            const pd = planDates(pkg, pkgStart(p, pkg));
            const rows = pkg.schedule.filter((r) => !r.kind);
            const sub = rows.reduce((n, r) => n + (Number(r.weeks) || 0), 0);
            overall += sub;
            return (
              <div key={pi}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '14px 20px', background: 'var(--hover-bg)', borderBottom: '1px solid var(--border)', borderTop: pi ? '1px solid var(--border)' : 'none' }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: svcColor(pkg.svc) }} />
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--navy900)' }}>{svcName(pkg.svc, lang)}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '46px 1fr 190px 110px', gap: 12, padding: '9px 20px', fontSize: 11, fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase', color: 'var(--text2)', borderBottom: '1px solid var(--row-line)' }}>
                  <div>#</div><div>{t('阶段 / 任务', 'Phase / Task')}</div><div>{t('日期', 'Dates')}</div><div>{t('时长', 'Duration')}</div>
                </div>
                {pkg.schedule.map((r, i) => {
                  if (r.kind) return null;
                  const d = pd[i];
                  return (
                    <div key={r.id || i} style={{ display: 'grid', gridTemplateColumns: '46px 1fr 190px 110px', gap: 12, alignItems: 'center', padding: '11px 20px', borderBottom: '1px solid var(--row-line)' }}>
                      <div className="tnum" style={{ fontSize: 12, color: 'var(--text2)' }}>{i}</div>
                      <div style={{ minWidth: 0 }}>
                        {ed ? (
                          <input className="in sm" defaultValue={lang === 'zh' ? r.task : r.taskEn || r.task} key={`tk-${r.id || i}`}
                            onBlur={(e) => { const f = lang === 'zh' ? 'task' : 'taskEn'; const cur = lang === 'zh' ? r.task : r.taskEn; if (e.target.value !== cur) dispatch(p.id, { type: 'editSched', pkg: pi, idx: i, field: f, value: e.target.value }); }} />
                        ) : (
                          <>
                            <div style={{ fontSize: 13, fontWeight: 500, textDecoration: r.status === 'done' ? 'line-through' : 'none', color: r.status === 'done' ? 'var(--text2)' : 'var(--text)' }}>
                              {r.freeze ? '★ ' : ''}{lang === 'zh' ? r.task : r.taskEn || r.task}
                            </div>
                            {r.owner && <div style={{ fontSize: 11, color: 'var(--text2)' }}>{r.owner}</div>}
                          </>
                        )}
                      </div>
                      {ed ? (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <input type="date" className="in sm" style={{ fontSize: 11, padding: '2px 4px' }} value={r.s || (d ? isoDate(d.start) : '')}
                            onChange={(e) => dispatch(p.id, { type: 'editSched', pkg: pi, idx: i, field: 's', value: e.target.value })} />
                          <input type="date" className="in sm" style={{ fontSize: 11, padding: '2px 4px' }} value={r.e || (d ? isoDate(d.end) : '')}
                            onChange={(e) => dispatch(p.id, { type: 'editSched', pkg: pi, idx: i, field: 'e', value: e.target.value })} />
                        </div>
                      ) : (
                        <div className="tnum" style={{ fontSize: 12, color: 'var(--text2)' }}>{d ? `${fmtDate(d.start)} – ${fmtDate(d.end)}` : '—'}</div>
                      )}
                      {ed ? (
                        <input type="number" step={0.5} min={0} className="in sm" style={{ width: 76 }} defaultValue={r.weeks} key={`wk-${r.id || i}-${r.weeks}`}
                          onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v !== r.weeks) dispatch(p.id, { type: 'editSchedNum', pkg: pi, idx: i, field: 'weeks', value: v }); }} />
                      ) : (
                        <div className="tnum" style={{ fontSize: 12.5 }}>{r.weeks ? t(`${r.weeks} 周`, `${r.weeks} week${r.weeks > 1 ? 's' : ''}`) : '—'}</div>
                      )}
                    </div>
                  );
                })}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, padding: '10px 20px', borderBottom: '1px solid var(--row-line)', background: '#fbfcfd' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>{t('小计 Subtotal', 'Subtotal')}</span>
                  <span className="tnum" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--navy900)', minWidth: 96, textAlign: 'right' }}>{t(`${sub} 周`, `${sub} weeks`)}</span>
                </div>
              </div>
            );
          })}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, padding: '13px 20px', background: 'var(--navy900)' }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#fff' }}>{t('Sum · 合计 Overall duration', 'Sum · Overall duration')}</span>
            <span className="tnum" style={{ fontSize: 13.5, fontWeight: 700, color: '#fff', minWidth: 96, textAlign: 'right' }}>{t(`${overall} 周`, `${overall} weeks`)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===== REQ-018 style B: date-based (Scale Model) template =====
   Date Range / Task / Duration, with full-width red milestone rows, a centred
   CNY-HOLIDAY band and right-side stage grouping 1.Production 2.Delivery
   3.Handover. */
const BANDS: [string, string][] = [['制作 Production', 'Production'], ['交付 Delivery', 'Delivery'], ['交接 Handover', 'Handover']];
function bandOf(r: { phase: string; task: string; taskEn: string }): number {
  const s = `${r.phase} ${r.task} ${r.taskEn}`.toLowerCase();
  if (/交接|移交|签收|handover|sign-?off/.test(s)) return 2;
  if (/交付|deliver|出图|提交|final|高清/.test(s)) return 1;
  return 0;
}

export function DatesTemplate({ p, pkg, pkgIdx, pd, ed, dispatch, lang, t }: {
  p: Project; pkg: Project['packages'][0]; pkgIdx: number; pd: (PlanDate | null)[]; ed: boolean; lang: 'zh' | 'en';
  dispatch: (pid: string, a: import('@/server/actions').ProjectAction) => Promise<boolean>;
  t: (zh: string, en: string) => string;
}) {
  let lastBand = -1;
  const GRID = '210px 1fr 96px 150px';
  return (
    <div className="panel clip">
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 680 }}>
          <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, padding: '11px 20px', background: 'var(--hover-bg)', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase', color: 'var(--text2)' }}>
            <div>{t('日期区间 Date Range', 'Date Range')}</div><div>{t('任务 Task', 'Task')}</div><div>{t('时长', 'Duration')}</div><div>{t('阶段', 'Stage')}</div>
          </div>
          {pkg.schedule.map((r, i) => {
            /* full-width annotation rows */
            if (r.kind === 'holiday') {
              return (
                <div key={r.id || i} style={{ padding: '9px 20px', borderBottom: '1px solid var(--row-line)', background: '#fdecec', textAlign: 'center', color: '#b23a32', fontWeight: 800, letterSpacing: '.06em', fontSize: 12.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                  <span>{(lang === 'zh' ? r.task : r.taskEn || r.task).toUpperCase()}</span>
                  {ed && <button style={{ color: 'var(--danger)', fontWeight: 700, background: 'none' }} title={t('删除', 'Delete')} onClick={() => dispatch(p.id, { type: 'removeRow', pkg: pkgIdx, idx: i })}>✕</button>}
                </div>
              );
            }
            if (r.kind === 'milestone') {
              return (
                <div key={r.id || i} style={{ padding: '9px 20px', borderBottom: '1px solid var(--row-line)', background: '#fff5f5', color: '#b23a32', fontWeight: 700, fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span>⚑ {lang === 'zh' ? r.task : r.taskEn || r.task}</span>
                  {r.s && <span className="tnum" style={{ fontWeight: 600 }}>· {r.s}</span>}
                  <div style={{ flex: 1 }} />
                  {ed && <button style={{ color: 'var(--danger)', fontWeight: 700, background: 'none' }} title={t('删除', 'Delete')} onClick={() => dispatch(p.id, { type: 'removeRow', pkg: pkgIdx, idx: i })}>✕</button>}
                </div>
              );
            }
            const d = pd[i];
            const b = bandOf(r);
            const showBand = b !== lastBand;
            lastBand = b;
            return (
              <div key={r.id || i} style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, alignItems: 'center', padding: '11px 20px', borderBottom: '1px solid var(--row-line)' }}>
                {ed ? (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input type="date" className="in sm" style={{ fontSize: 11, padding: '2px 4px' }} value={r.s || (d ? isoDate(d.start) : '')}
                      onChange={(e) => dispatch(p.id, { type: 'editSched', pkg: pkgIdx, idx: i, field: 's', value: e.target.value })} />
                    <input type="date" className="in sm" style={{ fontSize: 11, padding: '2px 4px' }} value={r.e || (d ? isoDate(d.end) : '')}
                      onChange={(e) => dispatch(p.id, { type: 'editSched', pkg: pkgIdx, idx: i, field: 'e', value: e.target.value })} />
                  </div>
                ) : (
                  <div className="tnum" style={{ fontSize: 12, fontWeight: 500 }}>{d ? `${fmtDate(d.start)} – ${fmtDate(d.end)}` : '—'}</div>
                )}
                <div style={{ minWidth: 0 }}>
                  {ed ? (
                    <input className="in sm" defaultValue={lang === 'zh' ? r.task : r.taskEn || r.task} key={`dt-${r.id || i}`}
                      onBlur={(e) => { const f = lang === 'zh' ? 'task' : 'taskEn'; const cur = lang === 'zh' ? r.task : r.taskEn; if (e.target.value !== cur) dispatch(p.id, { type: 'editSched', pkg: pkgIdx, idx: i, field: f, value: e.target.value }); }} />
                  ) : (
                    <div style={{ fontSize: 13, fontWeight: 500, textDecoration: r.status === 'done' ? 'line-through' : 'none', color: r.status === 'done' ? 'var(--text2)' : 'var(--text)' }}>
                      {r.freeze ? '★ ' : ''}{lang === 'zh' ? r.task : r.taskEn || r.task}
                    </div>
                  )}
                </div>
                {ed ? (
                  <input type="number" step={0.5} min={0} className="in sm" style={{ width: 72 }} defaultValue={r.weeks} key={`dw-${r.id || i}-${r.weeks}`}
                    onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v !== r.weeks) dispatch(p.id, { type: 'editSchedNum', pkg: pkgIdx, idx: i, field: 'weeks', value: v }); }} />
                ) : (
                  <div className="tnum" style={{ fontSize: 12.5 }}>{r.weeks ? t(`${r.weeks} 周`, `${r.weeks}w`) : '—'}</div>
                )}
                <div>
                  {showBand && (
                    <span className="badge" style={{ background: 'var(--hover-bg)', color: MACRO[Math.min(b + 1, 2)][2], fontWeight: 700 }}>
                      {b + 1}. {lang === 'zh' ? BANDS[b][0] : BANDS[b][1]}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* REQ-018 style B: add a red milestone row or a holiday band */
function SpecialRowBar({ pid, pkgIdx }: { pid: string; pkgIdx: number }) {
  const { dispatch } = useStore();
  const { t } = useLang();
  const [kind, setKind] = useState<'milestone' | 'holiday'>('milestone');
  const [text, setText] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="panel" style={{ marginTop: 10, padding: '12px 16px', borderColor: '#e7b3ae' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#b23a32' }}>⚑ {t('添加提示行', 'Add annotation row')}</span>
        <select className="in sm" value={kind} onChange={(e) => setKind(e.target.value as 'milestone' | 'holiday')} style={{ width: 'auto' }}>
          <option value="milestone">{t('卡点行(红)', 'Milestone (red)')}</option>
          <option value="holiday">{t('假期行(如 CNY HOLIDAY)', 'Holiday band')}</option>
        </select>
        <input className="in sm" placeholder={kind === 'holiday' ? 'CNY HOLIDAY' : t('如:资料需在 3 月 1 日前提供', 'e.g. Info required before 1 Mar')}
          value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
        {kind === 'milestone' && <input type="date" className="in sm" value={date} onChange={(e) => setDate(e.target.value)} />}
        <button className="btn-navy sm" disabled={busy || !text.trim()}
          onClick={async () => { setBusy(true); const ok = await dispatch(pid, { type: 'addSpecialRow', pkg: pkgIdx, kind, text: text.trim(), date }); setBusy(false); if (ok) { setText(''); setDate(''); } }}>
          {busy ? t('添加中…', 'Adding…') : t('添加', 'Add')}
        </button>
      </div>
    </div>
  );
}

/* REQ-002: delivery calendar — a Gantt-style timeline derived from planDates,
   so it stays time-linked (change a phase's weeks → its bar span moves). The
   computed delivery = the last phase's end (#8). */
function DeliveryCalendar({ p, pkg, pd, t0, lang, t }: {
  p: Project; pkg: Project['packages'][0]; pd: (import('@/lib/project').PlanDate | null)[];
  t0: Date; lang: 'zh' | 'en'; t: (zh: string, en: string) => string;
}) {
  const DAY = 86400000;
  const rows = pkg.schedule.map((r, i) => ({ r, i, d: pd[i] })).filter((x): x is { r: typeof pkg.schedule[0]; i: number; d: import('@/lib/project').PlanDate } => !!x.d);
  if (!rows.length) {
    return <div className="panel" style={{ padding: 16, marginBottom: 14, fontSize: 12.5, color: 'var(--text2)' }}>{t('暂无可显示日期的阶段(填了周期/开始日后自动生成日历)。', 'No dated phases yet — set start & weeks to build the calendar.')}</div>;
  }
  const starts = rows.map((x) => x.d.start.getTime());
  const ends = rows.map((x) => x.d.end.getTime());
  const del = parseISO(pkg.delivery);
  const finish = Math.max(...ends); // computed delivery = last phase end
  let min = Math.min(...starts, t0.getTime());
  let max = Math.max(...ends, del ? del.getTime() : 0);
  min -= 2 * DAY; max += 4 * DAY;
  const total = max - min || 1;
  const pct = (ms: number) => ((ms - min) / total) * 100;
  const ticks: Date[] = [];
  const cur = new Date(min); cur.setDate(1);
  while (cur.getTime() < max) { ticks.push(new Date(cur)); cur.setMonth(cur.getMonth() + 1); }
  const monthLbl = (d: Date) => `${d.getFullYear()}/${d.getMonth() + 1}`;
  const lines = [
    { at: t0.getTime(), color: 'var(--info)', label: t('今天', 'Today') },
    { at: finish, color: 'var(--bronze)', label: t('交付(最后阶段)', 'Delivery') },
  ];

  return (
    <div className="panel" style={{ padding: '14px 16px', marginBottom: 14 }}>
      <div className="mini-label" style={{ fontWeight: 700, color: 'var(--navy900)', marginBottom: 4 }}>📅 {t('交付日历', 'Delivery calendar')}
        <span style={{ fontWeight: 400, color: 'var(--text2)', marginLeft: 8 }}>{t('交付日 = 最后阶段结束', 'Delivery = last phase end')}: <b className="tnum" style={{ color: 'var(--bronze)' }}>{fmtDate(new Date(finish))}</b></span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 620 }}>
          {/* header: months + line labels */}
          <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', columnGap: 10 }}>
            <div />
            <div style={{ position: 'relative', height: 22, borderBottom: '1px solid var(--row-line)', marginBottom: 6 }}>
              {ticks.map((d, k) => (
                <span key={k} className="tnum" style={{ position: 'absolute', left: `${pct(d.getTime())}%`, fontSize: 10, color: 'var(--text2)', borderLeft: '1px solid var(--row-line)', paddingLeft: 3, height: 22 }}>{monthLbl(d)}</span>
              ))}
              {lines.map((ln, k) => (
                <span key={`l${k}`} style={{ position: 'absolute', left: `${pct(ln.at)}%`, top: -2, fontSize: 9.5, color: ln.color, fontWeight: 700, transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}>{ln.label}</span>
              ))}
            </div>
          </div>
          {/* one row per phase */}
          {rows.map(({ r, i, d }) => {
            const m = macroStage(r, i);
            const color = r.custom ? '#7c5bd6' : MACRO[m][2];
            const over = r.status !== 'done' && d.end < t0;
            return (
              <div key={r.id || i} style={{ display: 'grid', gridTemplateColumns: '150px 1fr', columnGap: 10, alignItems: 'center', padding: '3px 0' }}>
                <div style={{ fontSize: 11.5, color: r.status === 'done' ? 'var(--text2)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={lang === 'zh' ? r.task : r.taskEn}>
                  {r.freeze ? '🔒 ' : ''}{lang === 'zh' ? r.task : r.taskEn || r.task}
                </div>
                <div style={{ position: 'relative', height: 20 }}>
                  {lines.map((ln, k) => <span key={`v${k}`} style={{ position: 'absolute', left: `${pct(ln.at)}%`, top: 0, bottom: 0, width: 1, background: ln.color, opacity: 0.5 }} />)}
                  <div title={`${fmtDate(d.start)} → ${fmtDate(d.end)}`}
                    style={{
                      position: 'absolute', left: `${pct(d.start.getTime())}%`, width: `${Math.max(0.8, pct(d.end.getTime()) - pct(d.start.getTime()))}%`,
                      top: 3, height: 14, background: color, borderRadius: 4, opacity: r.status === 'done' ? 0.5 : 1,
                      border: over ? '1.5px solid var(--danger)' : 'none', boxSizing: 'border-box',
                    }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* §5: add an ad-hoc custom node (sample / extra request) to the schedule */
function AddNodeBar({ pid, pkgIdx }: { pid: string; pkgIdx: number }) {
  const { dispatch, users } = useStore();
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [owner, setOwner] = useState('');
  const [busy, setBusy] = useState(false);
  const names = users.filter((u) => u.role === 'pm' || u.role === 'member' || u.role === 'director' || u.role === 'bd').map((u) => u.name);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    const ok = await dispatch(pid, { type: 'addCustomNode', pkg: pkgIdx, name: name.trim(), date, owner });
    setBusy(false);
    if (ok) { setName(''); setDate(''); setOwner(''); setOpen(false); }
  }

  if (!open) {
    return (
      <button className="btn-line" style={{ width: '100%', marginTop: 10, justifyContent: 'center', borderStyle: 'dashed', color: '#6b4bc9', borderColor: '#c9bcee' }}
        onClick={() => setOpen(true)}>＋ {t('添加自定义节点(小样 / 临时需求)', 'Add custom node (sample / extra request)')}</button>
    );
  }
  return (
    <div className="panel" style={{ marginTop: 10, padding: '12px 16px', borderColor: '#c9bcee' }}>
      <div className="mini-label" style={{ fontWeight: 700, color: '#6b4bc9', marginBottom: 8 }}>＋ {t('自定义节点', 'Custom node')}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="in sm" placeholder={t('节点名称,如「客户临时加一版小样」', 'Node name, e.g. "extra sample round"')} value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 200 }} autoFocus />
        <input type="date" className="in sm" value={date} onChange={(e) => setDate(e.target.value)} title={t('日期', 'Date')} />
        <input className="in sm" list="assignee-names" placeholder={t('负责人', 'Owner')} value={owner} onChange={(e) => setOwner(e.target.value)} style={{ width: 130 }} />
        <datalist id="assignee-names-node">{names.map((n) => <option key={n} value={n} />)}</datalist>
        <button className="btn-navy sm" onClick={add} disabled={busy || !name.trim()}>{busy ? t('添加中…', 'Adding…') : t('添加', 'Add')}</button>
        <button className="btn-line sm" onClick={() => setOpen(false)} disabled={busy}>{t('取消', 'Cancel')}</button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 7 }}>
        {t('添加后出现在排期末尾,可在「编辑阶段」里用 ↑↓ 移到合适位置。照常计入进度与逾期。',
           'Appears at the end of the schedule; use ↑↓ in "Edit phases" to reposition. Counts toward progress and overdue as usual.')}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* D5: bolder / darker header labels */}
      <span className="mini-label" style={{ fontWeight: 700, color: 'var(--navy900)', letterSpacing: '.02em' }}>{label}</span>
      <span style={{ fontSize: 13 }}>{children}</span>
    </div>
  );
}
