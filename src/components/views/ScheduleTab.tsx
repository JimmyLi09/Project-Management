'use client';

import React, { useState } from 'react';
import { useStore } from '../store';
import { fmtDate, isoDate, MACRO, macroStage, parseISO, pkgStart, planDates, todayMid } from '@/lib/project';
import { canEdit, canRowEdit } from '@/lib/permissions';
import { svcColor, svcName } from '@/lib/templates';
import { useLang } from '@/lib/i18n';
import { Avatar, Icon, Pill, TM } from '../ui';
import type { Project, ScheduleStatus } from '@/lib/types';

const NEXT: Record<ScheduleStatus, ScheduleStatus> = { todo: 'wip', wip: 'done', done: 'block', block: 'todo' };

export default function ScheduleTab({ p, pkgIdx, onExport, onPkg }: {
  p: Project; pkgIdx: number; onExport: () => void; onPkg: (i: number) => void;
}) {
  const { me, dispatch, users } = useStore();
  const { lang, t } = useLang();
  const [editMode, setEditMode] = useState(false);
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
            onChange={(e) => dispatch(p.id, { type: 'setPkgField', pkg: pkgIdx, field: 'delivery', value: e.target.value })} />
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
        <button className="btn-line sm" onClick={onExport}><Icon name="download" size={13} />{t('导出', 'Export')}</button>
      </div>

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

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, fontSize: 12.5, color: 'var(--text2)' }}>
        <Icon name="lock" size={14} style={{ color: 'var(--navy700)' }} /> {t('冻结点 — 确认后锁定,改动影响下游', 'Freeze point — locked once confirmed; changes ripple downstream')}
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
                    <div key={r.id || i} className="row-hover" style={{
                      display: 'grid', gridTemplateColumns: '26px 26px minmax(220px,2fr) 40px 1.15fr 120px', gap: 15, alignItems: 'center',
                      padding: '18px 24px', borderBottom: '1px solid var(--row-line)',
                      borderLeft: `3px solid ${over ? 'var(--danger)' : r.custom ? '#7c5bd6' : r.freeze ? 'var(--bronze)' : 'transparent'}`,
                    }}>
                      <button className={`ckbox ${done ? 'on' : ''} ${rowEd ? '' : 'locked'}`}
                        onClick={rowEd ? () => dispatch(p.id, { type: 'toggleDone', pkg: pkgIdx, idx: i }) : undefined}>
                        {done && <Icon name="checkSm" size={13} style={{ color: '#fff' }} />}
                      </button>
                      <span style={{ color: 'var(--navy700)', display: 'flex', justifyContent: 'center' }}>
                        {r.freeze ? <Icon name="lock" size={14} /> : <span className="tnum" style={{ fontSize: 11, color: 'var(--text2)' }}>{r.no}</span>}
                      </span>
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
                                onBlur={(e) => (parseFloat(e.target.value) || 0) !== r.weeks && dispatch(p.id, { type: 'editSchedNum', pkg: pkgIdx, idx: i, field: 'weeks', value: parseFloat(e.target.value) || 0 })} />
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
      {ed && <AddNodeBar pid={p.id} pkgIdx={pkgIdx} />}
      <p style={{ marginTop: 12, fontSize: 12.5, color: 'var(--text2)' }}>
        {t('勾选=完成;未勾且过期=逾期(红边)。点状态徽章切换 未开始→进行中→已完成→受阻。团队成员只能操作指派给自己(👤)的任务。',
          'Tick = done; unticked past due = overdue (red edge). Click the status pill to cycle To Do → In Progress → Done → Blocked. Members can only act on tasks assigned 👤 to them.')}
      </p>
    </>
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
