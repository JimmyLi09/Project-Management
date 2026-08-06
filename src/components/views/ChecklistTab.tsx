'use client';

import React, { useState } from 'react';
import { useStore } from '../store';
import { canEdit } from '@/lib/permissions';
import { getBuiltinTemplate, svcColor, svcName } from '@/lib/templates';
import { parseISO, todayMid } from '@/lib/project';
import { useLang } from '@/lib/i18n';
import { Avatar, CM, Icon, Pill } from '../ui';
import type { ChecklistStatus, Project } from '@/lib/types';

const CYCLE: Record<ChecklistStatus, ChecklistStatus> = {
  pending: 'received', received: 'confirmed', confirmed: 'na', na: 'revision', revision: 'rejected', rejected: 'pending',
};
const CL_OPTIONS: [ChecklistStatus, string, string][] = [
  ['pending', '未收到', 'Pending'], ['received', '已收到', 'Received'], ['confirmed', '已确认', 'Approved'],
  ['na', '不适用 N/A', 'N/A'], ['revision', '需修订', 'Revision'], ['rejected', '退回', 'Rejected'],
];

/* relative "time ago" for the Last Update column */
function relTime(ts: number | undefined, zh: boolean): string {
  if (!ts) return '—';
  const d = Math.max(0, Date.now() - ts);
  const m = Math.floor(d / 60000), h = Math.floor(d / 3600000), day = Math.floor(d / 86400000);
  if (m < 1) return zh ? '刚刚' : 'just now';
  if (h < 1) return zh ? `${m} 分钟前` : `${m} min ago`;
  if (day < 1) return zh ? `${h} 小时前` : `${h}h ago`;
  if (day < 30) return zh ? `${day} 天前` : `${day}d ago`;
  return zh ? `${Math.floor(day / 30)} 个月前` : `${Math.floor(day / 30)}mo ago`;
}

export default function ChecklistTab({ p, pkgIdx, onExport, onPkg }: {
  p: Project; pkgIdx: number; onExport: () => void; onPkg: (i: number) => void;
}) {
  const { me, dispatch, users } = useStore();
  const { lang, t } = useLang();
  const [editMode, setEditMode] = useState(false);
  /* REQ-005: 信息清单默认只读,点「编辑」才可改字段(状态/日期/备注/图片) */
  const [fieldEdit, setFieldEdit] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const ed = canEdit(me, p);
  const fe = ed && fieldEdit;
  const pkg = p.packages[pkgIdx];
  const assigneeNames = users.filter((u) => u.role !== 'viewer').map((u) => u.name);
  const today = todayMid();

  let doneN = 0, totalN = 0, pendingN = 0, overdueN = 0;
  pkg.checklist.forEach((g) => g.items.forEach((it) => {
    if (it.status === 'na') return;
    totalN++;
    if (it.status === 'confirmed') doneN++;
    if (it.status === 'pending') pendingN++;
    const due = parseISO(it.date);
    // REQ-003: overdue = 未收到(pending) 且已过截止日。已收到/需修改/已确认等
    // 都不算逾期(资料已到位或已在处理),避免把「已收到」误报成逾期。
    if (due && due < today && it.status === 'pending') overdueN++;
  }));
  const pct = totalN ? Math.round((doneN / totalN) * 100) : 0;

  const tpl = getBuiltinTemplate(pkg.svc);
  function defaultsForGroup(group: string, groupEn: string): { zh: string; en: string }[] {
    const tg = tpl.checklist.find((g) => g[0] === group || g[1] === groupEn);
    if (!tg) return [];
    return tg[3].map(([zh, en]) => ({ zh, en }));
  }

  /* shared image pipeline: compress to <=560px JPEG and attach (multi-image). */
  function processImageFile(gi: number, ii: number, f: File | null | undefined) {
    if (!f) return;
    if (!f.type.startsWith('image/')) { alert(t('只支持图片文件', 'Only image files are supported')); return; }
    const rd = new FileReader();
    rd.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const mx = 560;
        let w = img.width, h = img.height;
        if (w > mx) { h = Math.round((h * mx) / w); w = mx; }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d')!.drawImage(img, 0, 0, w, h);
        let data: string;
        try { data = c.toDataURL('image/jpeg', 0.6); } catch { alert(t('图片处理失败', 'Failed to process image')); return; }
        dispatch(p.id, { type: 'attachShot', pkg: pkgIdx, gi, ii, data });
      };
      img.onerror = () => alert(t('无法读取图片', 'Could not read image'));
      img.src = e.target!.result as string;
    };
    rd.readAsDataURL(f);
  }
  function attachShot(gi: number, ii: number, input: HTMLInputElement) {
    const files = input.files ? Array.from(input.files) : [];
    files.forEach((f) => processImageFile(gi, ii, f));
    input.value = '';
  }
  function imageFromDataTransfer(dt: DataTransfer | null): File | null {
    if (!dt) return null;
    if (dt.files && dt.files.length) { for (let i = 0; i < dt.files.length; i++) if (dt.files[i].type.startsWith('image/')) return dt.files[i]; }
    if (dt.items && dt.items.length) {
      for (let i = 0; i < dt.items.length; i++) { const it = dt.items[i]; if (it.kind === 'file' && it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) return f; } }
    }
    return null;
  }

  const cols = editMode && ed
    ? 'minmax(280px,2.4fr) 160px 132px 116px 118px 30px'
    : 'minmax(280px,2.4fr) 160px 132px 116px 118px';

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

      {/* KPI cards (image7) */}
      <div className="kpi-grid" style={{ marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
        <div className="kpi" style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div className="kpi-label">{t('完成率', 'Completion rate')}</div>
            <div className="tnum" style={{ fontSize: 30, fontWeight: 600, color: 'var(--navy900)', marginTop: 4, lineHeight: 1 }}>{pct}%</div>
            <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 5 }}>{t(`${doneN} / ${totalN} 项已确认`, `${doneN} / ${totalN} confirmed`)}</div>
          </div>
          <Ring pct={pct} />
        </div>
        <div className="kpi" style={{ padding: '18px 20px' }}>
          <div className="kpi-label">{t('待处理项', 'Pending items')}</div>
          <div className="tnum" style={{ fontSize: 30, fontWeight: 600, color: pendingN ? 'var(--warning)' : 'var(--navy900)', marginTop: 4, lineHeight: 1 }}>{pendingN}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 5 }}>{t('全部栏目合计', 'across all sections')}</div>
        </div>
        <div className="kpi" style={{ padding: '18px 20px' }}>
          <div className="kpi-label">{t('已逾期项', 'Overdue items')}</div>
          <div className="tnum" style={{ fontSize: 30, fontWeight: 600, color: overdueN ? 'var(--danger)' : 'var(--navy900)', marginTop: 4, lineHeight: 1 }}>{overdueN}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 5 }}>{t('需要跟进', 'require action')}</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'var(--text2)' }}>
          {t('点状态徽章向前推进(右键选择指定状态)', 'Click a status badge to advance it (right-click to pick)')}
        </div>
        <div style={{ flex: 1 }} />
        {ed && editMode && (
          <button className="btn-line sm" style={{ color: 'var(--danger)' }}
            title={t('用默认模板恢复本业务的清单(会清空当前信息项)', 'Reset this package’s checklist from the template (clears current items)')}
            onClick={() => { if (confirm(t('确定用默认模板恢复本业务的清单吗?当前的信息项、状态和备注将被清空。', 'Restore this package’s checklist from the default template? Current items, statuses and notes will be cleared.'))) dispatch(p.id, { type: 'resetChecklist', pkg: pkgIdx }); }}>
            ↺ {t('恢复默认', 'Reset')}
          </button>
        )}
        {ed && (
          <button className={`btn-line sm ${fieldEdit ? '' : ''}`} style={fieldEdit ? { borderColor: 'var(--navy700)', color: 'var(--navy900)', fontWeight: 600 } : undefined}
            onClick={() => setFieldEdit(!fieldEdit)}>
            {fieldEdit ? t('完成', 'Done') : t('编辑', 'Edit')}
          </button>
        )}
        {ed && <button className="btn-line sm" onClick={() => setEditMode(!editMode)}>{editMode ? t('完成编辑', 'Done editing') : t('增减信息项', 'Edit items')}</button>}
        <button className="btn-line sm" onClick={onExport}><Icon name="download" size={13} />{t('导出清单', 'Export Checklist')}</button>
      </div>

      <div className="panel clip">
        {/* column headers (image7) */}
        <div style={{
          display: 'grid', gridTemplateColumns: cols, gap: 16, padding: '14px 24px',
          background: 'var(--hover-bg)', borderBottom: '1px solid var(--row-line)',
          fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text2)',
        }}>
          <div>{t('信息项', 'Item')}</div>
          <div>{t('负责人', 'Owner')}</div>
          <div>{t('截止日期', 'Due date')}</div>
          <div>{t('最后更新', 'Last update')}</div>
          <div>{t('状态', 'Status')}</div>
          {editMode && ed && <div />}
        </div>

        {pkg.checklist.map((g, gi) => {
          const applicable = g.items.filter((i) => i.status !== 'na');
          const conf = applicable.filter((i) => i.status === 'confirmed').length;
          const gpct = applicable.length ? Math.round((conf / applicable.length) * 100) : 0;
          const isCol = !!collapsed[gi];
          return (
            <div key={gi}>
              {/* collapsible bold section header */}
              <button onClick={() => setCollapsed((s) => ({ ...s, [gi]: !s[gi] }))}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '16px 24px',
                  background: 'var(--card-bg, #fff)', borderBottom: '1px solid var(--row-line)', textAlign: 'left',
                }}>
                <span style={{ transform: isCol ? 'rotate(-90deg)' : 'none', transition: 'transform .15s', color: 'var(--text2)', fontSize: 12 }}>▾</span>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: g.color, flexShrink: 0 }} />
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--navy900)' }}>{lang === 'zh' ? g.group : g.groupEn}</span>
                <span style={{ fontWeight: 400, color: 'var(--text2)', fontSize: 12 }}>{lang === 'zh' ? g.groupEn : g.group}</span>
                <span className="badge" style={{ background: 'var(--hover-bg)', color: 'var(--text2)' }}>{applicable.length}</span>
                <div style={{ flex: 1 }} />
                <span className="tnum" style={{ fontSize: 12.5, fontWeight: 600, color: gpct >= 100 ? 'var(--success)' : 'var(--text2)' }}>{gpct}%</span>
              </button>

              {!isCol && g.items.map((it, ii) => {
                const due = parseISO(it.date);
                // REQ-003: 仅「未收到 pending」且过期才标逾期(已收到不算)
                const overdue = due && due < today && it.status === 'pending';
                const shots = it.shots && it.shots.length ? it.shots : (it.shot ? [it.shot] : []);
                return (
                  <div key={it.id || ii} style={{
                    display: 'grid', gridTemplateColumns: cols, gap: 16,
                    alignItems: 'start', padding: '18px 24px', borderBottom: '1px solid var(--row-line)',
                  }}>
                    {/* ── Item: name, thumbnails, remark ── */}
                    <div style={{ minWidth: 0 }}>
                      {editMode && ed ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                          <input className="in sm" defaultValue={it.zh}
                            onBlur={(e) => e.target.value !== it.zh && dispatch(p.id, { type: 'editCl', pkg: pkgIdx, gi, ii, field: 'zh', value: e.target.value })} />
                          <input className="in sm" defaultValue={it.en}
                            onBlur={(e) => e.target.value !== it.en && dispatch(p.id, { type: 'editCl', pkg: pkgIdx, gi, ii, field: 'en', value: e.target.value })} />
                        </div>
                      ) : (
                        <>
                          <div style={{ fontSize: 13.5, fontWeight: 500 }}>{lang === 'zh' ? it.zh : it.en || it.zh}</div>
                          <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>{lang === 'zh' ? it.en : it.zh}</div>
                        </>
                      )}

                      {/* thumbnails (multi-image) + uploader */}
                      <div style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        {shots.map((s, si) => (
                          <span key={si} style={{ position: 'relative', display: 'inline-flex' }}>
                            <img src={s} alt="" title={t('点击放大', 'Click to enlarge')}
                              style={{ width: 54, height: 38, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer' }}
                              onClick={() => setLightbox(s)} />
                            {fe && (
                              <button title={t('删除此图', 'Remove image')}
                                onClick={() => dispatch(p.id, { type: 'removeShot', pkg: pkgIdx, gi, ii, shotIdx: si })}
                                style={{ position: 'absolute', top: -6, right: -6, width: 16, height: 16, borderRadius: 8, background: 'var(--danger)', color: '#fff', fontSize: 10, lineHeight: '16px', textAlign: 'center' }}>✕</button>
                            )}
                          </span>
                        ))}
                        {fe && (
                          <label
                            tabIndex={0}
                            title={t('点击选择,或拖入 / 粘贴图片(可多张)', 'Click to select, or drag / paste images (multiple)')}
                            style={{ fontSize: 11, color: '#234f97', background: '#e7eefb', borderRadius: 6, padding: '4px 9px', cursor: 'pointer', outline: 'none' }}
                            onDragOver={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).style.background = '#c9dcff'; }}
                            onDragLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '#e7eefb'; }}
                            onDrop={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).style.background = '#e7eefb'; processImageFile(gi, ii, imageFromDataTransfer(e.dataTransfer)); }}
                            onPaste={(e) => { const f = imageFromDataTransfer(e.clipboardData); if (f) { e.preventDefault(); processImageFile(gi, ii, f); } }}>
                            📎 {shots.length ? t('加图', 'Add image') : t('上传 / 拖入 / 粘贴', 'Upload / drag / paste')}
                            <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => attachShot(gi, ii, e.target)} />
                          </label>
                        )}
                      </div>

                      {/* remark — wrapping textarea (D3), with highlight star (C3) */}
                      <div style={{ marginTop: 10, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                        {fe && (
                          <button title={it.highlight ? t('取消重点', 'Unmark important') : t('标为重点', 'Mark important')}
                            onClick={() => dispatch(p.id, { type: 'toggleHighlight', pkg: pkgIdx, gi, ii })}
                            style={{ flex: '0 0 auto', fontSize: 15, lineHeight: 1, padding: '3px 3px', background: 'none', color: it.highlight ? '#D98A12' : '#c2cad3' }}>
                            {it.highlight ? '★' : '☆'}
                          </button>
                        )}
                        <textarea className="in sm" rows={1}
                          placeholder={t('下一步 / 备注…(可换行)', 'Next step / note… (multi-line)')}
                          defaultValue={it.remark} readOnly={!fe}
                          style={{
                            width: '100%', minHeight: 30, resize: 'vertical', lineHeight: 1.5, whiteSpace: 'pre-wrap',
                            ...(it.highlight ? { background: '#fff6e2', borderColor: '#e6b657', color: '#8a5a0f', fontWeight: 600 } : {}),
                          }}
                          onBlur={(e) => { if (fe && e.target.value !== it.remark) dispatch(p.id, { type: 'editCl', pkg: pkgIdx, gi, ii, field: 'remark', value: e.target.value }); }} />
                      </div>
                    </div>

                    {/* ── Owner (avatar + name); highlight the person ── */}
                    <div style={{ minWidth: 0 }}>
                      {editMode && ed ? (
                        <input className="in sm" list="cl-owner-names" defaultValue={it.owner || ''} placeholder={t('负责人', 'Owner')}
                          onBlur={(e) => e.target.value !== (it.owner || '') && dispatch(p.id, { type: 'editCl', pkg: pkgIdx, gi, ii, field: 'owner', value: e.target.value })} />
                      ) : it.owner ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, color: 'var(--navy900)' }}>
                          <Avatar name={it.owner} size={24} />{it.owner}
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, color: '#b6bfc9' }}>{t('未指派', 'Unassigned')}</span>
                      )}
                    </div>

                    {/* ── Due date ── */}
                    <div>
                      <input type="date" className="in sm" style={{ width: '100%', ...(overdue ? { borderColor: '#e7a19b', color: '#b23a32' } : {}) }} value={it.date} disabled={!fe}
                        onChange={(e) => dispatch(p.id, { type: 'editCl', pkg: pkgIdx, gi, ii, field: 'date', value: e.target.value })} />
                    </div>

                    {/* ── Last update ── */}
                    <div style={{ fontSize: 12, color: 'var(--text2)', paddingTop: 6 }}>{relTime(it.updatedAt, lang === 'zh')}</div>

                    {/* ── Status ── */}
                    <div style={{ paddingTop: 2 }}>
                      {fe ? (
                        <button title={t('点击推进状态,右键选择', 'Click to advance, right-click to pick')} style={{ padding: 0, background: 'none' }}
                          onClick={() => dispatch(p.id, { type: 'setClStatus', pkg: pkgIdx, gi, ii, value: CYCLE[it.status] })}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            const pick = prompt(
                              t(`状态(输入编号):\n${CL_OPTIONS.map((o, k) => `${k + 1}. ${o[1]}`).join('\n')}`,
                                `Status (enter number):\n${CL_OPTIONS.map((o, k) => `${k + 1}. ${o[2]}`).join('\n')}`),
                              String(CL_OPTIONS.findIndex((o) => o[0] === it.status) + 1));
                            const k = parseInt(pick || '') - 1;
                            if (k >= 0 && k < CL_OPTIONS.length) dispatch(p.id, { type: 'setClStatus', pkg: pkgIdx, gi, ii, value: CL_OPTIONS[k][0] });
                          }}>
                          <Pill m={CM[it.status]} />
                        </button>
                      ) : (
                        <Pill m={CM[it.status]} />
                      )}
                    </div>

                    {/* ── edit actions: reorder + delete ── */}
                    {editMode && ed && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                        <button title={t('上移', 'Move up')} disabled={ii === 0} style={{ opacity: ii === 0 ? 0.3 : 1, fontSize: 12, lineHeight: 1 }}
                          onClick={() => dispatch(p.id, { type: 'moveItem', pkg: pkgIdx, gi, ii, dir: -1 })}>▲</button>
                        <button style={{ color: 'var(--danger)', fontWeight: 700 }} title={t('删除', 'Delete')}
                          onClick={() => dispatch(p.id, { type: 'removeItem', pkg: pkgIdx, gi, ii })}>✕</button>
                        <button title={t('下移', 'Move down')} disabled={ii === g.items.length - 1} style={{ opacity: ii === g.items.length - 1 ? 0.3 : 1, fontSize: 12, lineHeight: 1 }}
                          onClick={() => dispatch(p.id, { type: 'moveItem', pkg: pkgIdx, gi, ii, dir: 1 })}>▼</button>
                      </div>
                    )}
                  </div>
                );
              })}

              {!isCol && editMode && ed && (
                <AddItemPanel
                  defaults={defaultsForGroup(g.group, g.groupEn)}
                  present={g.items.map((it) => it.zh)}
                  onAdd={(items) => dispatch(p.id, { type: 'addItem', pkg: pkgIdx, gi, items })}
                  onBlank={() => dispatch(p.id, { type: 'addItem', pkg: pkgIdx, gi })}
                />
              )}
            </div>
          );
        })}
      </div>

      {editMode && ed && (
        <button className="btn-line" style={{ width: '100%', marginTop: 16, justifyContent: 'center', borderStyle: 'dashed' }}
          onClick={() => {
            const nm = prompt(t('新栏目名称(中文):', 'New section name:'), t('特殊需求', 'Special requirements'));
            if (nm) dispatch(p.id, { type: 'addGroup', pkg: pkgIdx, name: nm });
          }}>+ {t('添加新栏目', 'Add section')}</button>
      )}

      <datalist id="cl-owner-names">{assigneeNames.map((n) => <option key={n} value={n} />)}</datalist>

      {lightbox && (
        <div className="overlay" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: 8, boxShadow: '0 12px 48px rgba(0,0,0,.55)' }} />
        </div>
      )}
    </>
  );
}

/* small completion ring for the KPI card */
function Ring({ pct }: { pct: number }) {
  const r = 22, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
  const col = pct >= 100 ? '#16865B' : pct >= 60 ? 'var(--navy700)' : '#D98A12';
  return (
    <svg width={56} height={56} viewBox="0 0 56 56" style={{ flexShrink: 0 }}>
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--row-line)" strokeWidth="6" />
      <circle cx="28" cy="28" r={r} fill="none" stroke={col} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 28 28)" />
    </svg>
  );
}

/* B3: add-item panel — pick from the service's default library, or a blank item. */
function AddItemPanel({ defaults, present, onAdd, onBlank }: {
  defaults: { zh: string; en: string }[];
  present: string[];
  onAdd: (items: { zh: string; en: string }[]) => void;
  onBlank: () => void;
}) {
  const { lang, t } = useLang();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const presentSet = new Set(present);
  const avail = defaults.filter((d) => !presentSet.has(d.zh));

  if (!open) {
    return (
      <div style={{ padding: '12px 20px' }}>
        <button className="btn-line sm" onClick={() => { setPicked({}); setOpen(true); }}>+ {t('添加信息项', 'Add item')}</button>
      </div>
    );
  }
  const chosen = avail.filter((d) => picked[d.zh]);
  return (
    <div style={{ padding: '12px 20px', background: 'var(--hover-bg)', borderTop: '1px solid var(--row-line)' }}>
      {avail.length > 0 ? (
        <>
          <div className="mini-label" style={{ marginBottom: 8, color: 'var(--text2)', fontSize: 11.5 }}>
            {t('从常用默认项勾选(可多选):', 'Tick common default items (multi-select):')}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {avail.map((d) => (
              <label key={d.zh} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer',
                border: '1px solid var(--border)', borderRadius: 7, padding: '5px 10px',
                background: picked[d.zh] ? '#e7eefb' : 'var(--card-bg, #fff)', borderColor: picked[d.zh] ? '#8fb0e8' : 'var(--border)',
              }}>
                <input type="checkbox" checked={!!picked[d.zh]} onChange={() => setPicked((s) => ({ ...s, [d.zh]: !s[d.zh] }))} />
                {lang === 'zh' ? d.zh : d.en || d.zh}
              </label>
            ))}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>{t('默认项已全部添加。', 'All default items are already added.')}</div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn-navy sm" disabled={!chosen.length}
          onClick={() => { onAdd(chosen); setOpen(false); }}>
          + {t('添加所选', 'Add selected')}{chosen.length ? ` (${chosen.length})` : ''}
        </button>
        <button className="btn-line sm" onClick={() => { onBlank(); setOpen(false); }}>+ {t('自定义空白项', 'Blank custom item')}</button>
        <button className="btn-line sm" onClick={() => setOpen(false)}>{t('取消', 'Cancel')}</button>
      </div>
    </div>
  );
}
