'use client';

import React, { useState } from 'react';
import { useStore } from '../store';
import { canEdit } from '@/lib/permissions';
import type { ChecklistStatus, Project } from '@/lib/types';

export const CL_STATUS: [ChecklistStatus, string][] = [
  ['pending', '未收到 Pending'],
  ['received', '已收到 Received'],
  ['confirmed', '已确认 Confirmed'],
  ['na', '不适用 N/A'],
  ['revision', '需修订 Revision'],
  ['rejected', '不符/退回 Rejected'],
];

export default function ChecklistTab({ p, pkgIdx, onExport }: { p: Project; pkgIdx: number; onExport: () => void }) {
  const { me, dispatch } = useStore();
  const [editMode, setEditMode] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const ed = canEdit(me, p);
  const pkg = p.packages[pkgIdx];

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
        try { data = c.toDataURL('image/jpeg', 0.6); } catch { alert('图片处理失败'); return; }
        dispatch(p.id, { type: 'attachShot', pkg: pkgIdx, gi, ii, data });
      };
      img.onerror = () => alert('无法读取图片');
      img.src = e.target!.result as string;
    };
    rd.readAsDataURL(f);
    input.value = '';
  }

  return (
    <>
      <div className="subbar">
        {ed && (
          <button className="btn ghost sm" onClick={() => setEditMode(!editMode)}>
            {editMode ? '完成编辑' : '增减信息项'}
          </button>
        )}
        <button className="btn ghost sm" onClick={onExport}>导出 Export</button>
      </div>
      {pkg.checklist.map((g, gi) => {
        const applicable = g.items.filter((i) => i.status !== 'na');
        const conf = applicable.filter((i) => i.status === 'confirmed').length;
        const naCount = g.items.length - applicable.length;
        return (
          <div key={gi} className="cl-group">
            <div className="cl-gh" style={{ background: g.color }}>
              <span>{g.group}</span>
              <span style={{ opacity: 0.75, fontWeight: 500, fontSize: 11.5 }}>{g.groupEn}</span>
              <span className="cnt">{conf}/{applicable.length} 已确认{naCount ? ` · ${naCount} N/A` : ''}</span>
            </div>
            {g.items.map((it, ii) => (
              <div key={ii} className="clrow">
                <div>
                  <select
                    className={`cl-sel cl-${it.status} ${ed ? '' : 'locked'}`}
                    disabled={!ed}
                    value={it.status}
                    onChange={(e) => dispatch(p.id, { type: 'setClStatus', pkg: pkgIdx, gi, ii, value: e.target.value as ChecklistStatus })}
                  >
                    {CL_STATUS.map((o) => <option key={o[0]} value={o[0]}>{o[1]}</option>)}
                  </select>
                </div>
                <div>
                  {editMode && ed ? (
                    <div className="row-edit">
                      <input className="edit-in" defaultValue={it.zh}
                        onBlur={(e) => e.target.value !== it.zh && dispatch(p.id, { type: 'editCl', pkg: pkgIdx, gi, ii, field: 'zh', value: e.target.value })} />
                      <input className="edit-in" defaultValue={it.en}
                        onBlur={(e) => e.target.value !== it.en && dispatch(p.id, { type: 'editCl', pkg: pkgIdx, gi, ii, field: 'en', value: e.target.value })} />
                    </div>
                  ) : (
                    <div className="item">{it.zh}<div className="en">{it.en}</div></div>
                  )}
                  <div style={{ marginTop: 5 }}>
                    {it.shot ? (
                      <span className="cl-shot">
                        <img src={it.shot} className="cl-thumb" title="点击放大" onClick={() => setLightbox(it.shot!)} />
                        {ed && (
                          <button className="rm-btn" title="移除截图"
                            onClick={() => dispatch(p.id, { type: 'removeShot', pkg: pkgIdx, gi, ii })}>✕图</button>
                        )}
                      </span>
                    ) : ed ? (
                      <label className="shot-btn">
                        📎 上传截图
                        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => attachShot(gi, ii, e.target)} />
                      </label>
                    ) : null}
                  </div>
                </div>
                <div>
                  <input type="date" className="date-in" defaultValue={it.date} key={`d${it.date}`} disabled={!ed}
                    onChange={(e) => dispatch(p.id, { type: 'editCl', pkg: pkgIdx, gi, ii, field: 'date', value: e.target.value })} />
                </div>
                <div>
                  <input className="remark-in" placeholder="下一步 / 备注…" defaultValue={it.remark} readOnly={!ed}
                    onBlur={(e) => { if (ed && e.target.value !== it.remark) dispatch(p.id, { type: 'editCl', pkg: pkgIdx, gi, ii, field: 'remark', value: e.target.value }); }} />
                </div>
                {editMode && ed ? (
                  <button className="rm-btn" title="删除" onClick={() => dispatch(p.id, { type: 'removeItem', pkg: pkgIdx, gi, ii })}>✕</button>
                ) : (
                  <span />
                )}
              </div>
            ))}
            {editMode && ed && (
              <div style={{ padding: '10px 15px' }}>
                <button className="add-row" style={{ margin: 0 }} onClick={() => dispatch(p.id, { type: 'addItem', pkg: pkgIdx, gi })}>
                  + 添加信息项 Add item
                </button>
              </div>
            )}
          </div>
        );
      })}
      {editMode && ed && (
        <button
          className="add-row"
          onClick={() => {
            const nm = prompt('新栏目名称(中文):', '特殊需求');
            if (nm) dispatch(p.id, { type: 'addGroup', pkg: pkgIdx, name: nm });
          }}
        >
          + 添加新栏目 Add section
        </button>
      )}
      <div className="cl-note">
        状态含 N/A(不计入完成率)、需修订、退回。可在信息项下「📎 上传截图」记录收到的资料(自动压缩为缩略图)。
      </div>
      {lightbox && (
        <div className="overlay" onClick={() => setLightbox(null)}>
          <img src={lightbox} style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: 8, boxShadow: '0 12px 48px rgba(0,0,0,.55)' }} />
        </div>
      )}
    </>
  );
}
