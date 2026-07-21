'use client';

import React, { useState } from 'react';
import { useStore } from '../store';
import { canEdit } from '@/lib/permissions';
import { svcColor, svcName } from '@/lib/templates';
import { useLang } from '@/lib/i18n';
import { CM, Icon, Pill } from '../ui';
import type { ChecklistStatus, Project } from '@/lib/types';

const CYCLE: Record<ChecklistStatus, ChecklistStatus> = {
  pending: 'received', received: 'confirmed', confirmed: 'na', na: 'revision', revision: 'rejected', rejected: 'pending',
};
const CL_OPTIONS: [ChecklistStatus, string, string][] = [
  ['pending', '未收到', 'Pending'], ['received', '已收到', 'Received'], ['confirmed', '已确认', 'Approved'],
  ['na', '不适用 N/A', 'N/A'], ['revision', '需修订', 'Revision'], ['rejected', '退回', 'Rejected'],
];

export default function ChecklistTab({ p, pkgIdx, onExport, onPkg }: {
  p: Project; pkgIdx: number; onExport: () => void; onPkg: (i: number) => void;
}) {
  const { me, dispatch } = useStore();
  const { lang, t } = useLang();
  const [editMode, setEditMode] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const ed = canEdit(me, p);
  const pkg = p.packages[pkgIdx];

  let doneN = 0, totalN = 0;
  pkg.checklist.forEach((g) => g.items.forEach((it) => { if (it.status === 'na') return; totalN++; if (it.status === 'confirmed') doneN++; }));

  function attachShot(gi: number, ii: number, input: HTMLInputElement) {
    const f = input.files && input.files[0];
    if (!f) return;
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
    input.value = '';
  }

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

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'var(--text2)' }}>
          {t('点状态徽章向前推进(右键选择指定状态) — ', 'Click a status badge to advance it (right-click to pick) — ')}
          <b style={{ color: 'var(--navy900)' }} className="tnum">{doneN}/{totalN}</b> {t('项已确认(N/A 不计入)', 'items approved (N/A excluded)')}
        </div>
        <div style={{ flex: 1 }} />
        {ed && <button className="btn-line sm" onClick={() => setEditMode(!editMode)}>{editMode ? t('完成编辑', 'Done editing') : t('增减信息项', 'Edit items')}</button>}
        <button className="btn-line sm" onClick={onExport}><Icon name="download" size={13} />{t('导出', 'Export')}</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {pkg.checklist.map((g, gi) => {
          const applicable = g.items.filter((i) => i.status !== 'na');
          const conf = applicable.filter((i) => i.status === 'confirmed').length;
          return (
            <div key={gi} className="panel clip">
              <div className="panel-head" style={{ padding: '14px 22px' }}>
                <span className="panel-title" style={{ fontSize: 15 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: g.color, display: 'inline-block' }} />
                  {lang === 'zh' ? g.group : g.groupEn}
                  <span style={{ fontWeight: 400, color: 'var(--text2)', fontSize: 12.5 }}>{lang === 'zh' ? g.groupEn : g.group}</span>
                </span>
                <span className="tnum" style={{ fontSize: 12, color: 'var(--text2)' }}>{conf}/{applicable.length}</span>
              </div>
              {g.items.map((it, ii) => (
                <div key={ii} style={{
                  display: 'grid', gridTemplateColumns: editMode && ed ? '132px minmax(160px,1.8fr) 128px 1.3fr 28px' : '132px minmax(160px,1.8fr) 128px 1.3fr', gap: 14,
                  alignItems: 'center', padding: '13px 22px', borderBottom: '1px solid var(--row-line)',
                }}>
                  <div>
                    {ed ? (
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
                    <div style={{ marginTop: 5, display: 'flex', gap: 8, alignItems: 'center' }}>
                      {it.shot ? (
                        <>
                          <img src={it.shot} alt="" title={t('点击放大', 'Click to enlarge')}
                            style={{ width: 62, height: 42, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer' }}
                            onClick={() => setLightbox(it.shot!)} />
                          {ed && (
                            <button style={{ color: 'var(--danger)', fontSize: 11.5, fontWeight: 600 }}
                              onClick={() => dispatch(p.id, { type: 'removeShot', pkg: pkgIdx, gi, ii })}>✕ {t('图', 'img')}</button>
                          )}
                        </>
                      ) : ed ? (
                        <label style={{ fontSize: 11, color: '#234f97', background: '#e7eefb', borderRadius: 6, padding: '3px 9px', cursor: 'pointer' }}>
                          📎 {t('上传截图', 'Attach screenshot')}
                          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => attachShot(gi, ii, e.target)} />
                        </label>
                      ) : null}
                    </div>
                  </div>
                  <div>
                    <input type="date" className="in sm" style={{ width: '100%' }} defaultValue={it.date} key={`d${it.date}`} disabled={!ed}
                      onChange={(e) => dispatch(p.id, { type: 'editCl', pkg: pkgIdx, gi, ii, field: 'date', value: e.target.value })} />
                  </div>
                  <div>
                    <input className="in sm" style={{ width: '100%' }} placeholder={t('下一步 / 备注…', 'Next step / note…')} defaultValue={it.remark} readOnly={!ed}
                      onBlur={(e) => { if (ed && e.target.value !== it.remark) dispatch(p.id, { type: 'editCl', pkg: pkgIdx, gi, ii, field: 'remark', value: e.target.value }); }} />
                  </div>
                  {editMode && ed && (
                    <button style={{ color: 'var(--danger)', fontWeight: 700 }} title={t('删除', 'Delete')}
                      onClick={() => dispatch(p.id, { type: 'removeItem', pkg: pkgIdx, gi, ii })}>✕</button>
                  )}
                </div>
              ))}
              {editMode && ed && (
                <div style={{ padding: '12px 22px' }}>
                  <button className="btn-line sm" onClick={() => dispatch(p.id, { type: 'addItem', pkg: pkgIdx, gi })}>+ {t('添加信息项', 'Add item')}</button>
                </div>
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

      {lightbox && (
        <div className="overlay" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: 8, boxShadow: '0 12px 48px rgba(0,0,0,.55)' }} />
        </div>
      )}
    </>
  );
}
