'use client';

import React, { useState } from 'react';
import { useStore } from '../store';
import {
  fmtDate, MACRO, macroStage, parseISO, pkgStart, planDates, todayMid,
} from '@/lib/project';
import { canEdit, canRowEdit } from '@/lib/permissions';
import type { Project } from '@/lib/types';
import { STATUS_PILL_CLS, STATUS_TXT_FULL } from './parts';

export default function ScheduleTab({ p, pkgIdx, onExport }: { p: Project; pkgIdx: number; onExport: () => void }) {
  const { me, dispatch } = useStore();
  const [editMode, setEditMode] = useState(false);
  const ed = canEdit(me, p);
  const pkg = p.packages[pkgIdx];
  const pd = planDates(pkg, pkgStart(p, pkg));
  const t = todayMid();

  /* slack for this package */
  const del = parseISO(pkg.delivery);
  let fin: Date | null = null;
  for (let i = pd.length - 1; i >= 0; i--) { if (pd[i]) { fin = pd[i]!.end; break; } }
  let slackNode: React.ReactNode = <span style={{ color: 'var(--faint)', fontSize: 11.5 }}>填交付日核算</span>;
  if (del && fin) {
    const fb = new Date(fin);
    fb.setDate(fb.getDate() + (pkg.buffer || 0));
    const sl = Math.round((del.getTime() - fb.getTime()) / 86400000);
    slackNode = sl >= 0
      ? <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: 12 }}>✓ 富余 {sl} 天</span>
      : <span style={{ color: 'var(--red)', fontWeight: 700, fontSize: 12 }}>⚠ 超 {-sl} 天</span>;
  }

  let lastMacro = -1;
  const rows: React.ReactNode[] = [];
  pkg.schedule.forEach((r, i) => {
    const d = pd[i];
    const over = r.status !== 'done' && d && d.end < t;
    const done = r.status === 'done';
    const rowEd = canRowEdit(me, p, r);
    const m = macroStage(r, i);
    if (m !== lastMacro) {
      rows.push(
        <div key={`m${i}`} className="macro-h" style={{ borderLeft: `4px solid ${MACRO[m][2]}` }}>
          <b style={{ color: MACRO[m][2] }}>{['①', '②', '③'][m]} {MACRO[m][0]}</b> <span>{MACRO[m][1]}</span>
        </div>
      );
      lastMacro = m;
    }
    if (editMode && ed) {
      rows.push(
        <div key={i} className={`srow ${r.freeze ? 'freeze' : ''}`}>
          <div>
            <button className={`ckbox ${done ? 'on' : ''}`} onClick={() => dispatch(p.id, { type: 'toggleDone', pkg: pkgIdx, idx: i })}>
              {done ? '✓' : ''}
            </button>
          </div>
          <div><div className="phnum">{r.no}</div></div>
          <div className="row-edit">
            <input className="edit-in" defaultValue={r.task} placeholder="任务名 (中)"
              onBlur={(e) => e.target.value !== r.task && dispatch(p.id, { type: 'editSched', pkg: pkgIdx, idx: i, field: 'task', value: e.target.value })} />
            <input className="edit-in" defaultValue={r.taskEn} placeholder="Task (EN)"
              onBlur={(e) => e.target.value !== r.taskEn && dispatch(p.id, { type: 'editSched', pkg: pkgIdx, idx: i, field: 'taskEn', value: e.target.value })} />
            <div className="r">
              <input className="edit-in" defaultValue={r.owner} placeholder="角色"
                onBlur={(e) => e.target.value !== r.owner && dispatch(p.id, { type: 'editSched', pkg: pkgIdx, idx: i, field: 'owner', value: e.target.value })} />
              <input className="edit-in wk-in" type="number" step={0.5} min={0} defaultValue={r.weeks} title="周数"
                onBlur={(e) => (parseFloat(e.target.value) || 0) !== r.weeks && dispatch(p.id, { type: 'editSchedNum', pkg: pkgIdx, idx: i, field: 'weeks', value: parseFloat(e.target.value) || 0 })} />
            </div>
            <input className="edit-in" defaultValue={r.assignee} placeholder="👤 指派给(个人)"
              onBlur={(e) => e.target.value !== r.assignee && dispatch(p.id, { type: 'editSched', pkg: pkgIdx, idx: i, field: 'assignee', value: e.target.value })} />
            <button className="rm-btn" onClick={() => { if (confirm('删除此阶段?')) dispatch(p.id, { type: 'removeRow', pkg: pkgIdx, idx: i }); }}>✕ 删除此阶段</button>
          </div>
          <div className="owner">{r.owner}</div>
          <div className="row-edit">
            <input type="date" className="edit-in" defaultValue={r.s} title="开始(覆盖)"
              onChange={(e) => dispatch(p.id, { type: 'editSched', pkg: pkgIdx, idx: i, field: 's', value: e.target.value })} />
            <input type="date" className="edit-in" defaultValue={r.e} title="结束(覆盖)"
              onChange={(e) => dispatch(p.id, { type: 'editSched', pkg: pkgIdx, idx: i, field: 'e', value: e.target.value })} />
          </div>
          <div>
            <button className={`chip ${STATUS_PILL_CLS[r.status]}`} onClick={() => dispatch(p.id, { type: 'cycleStatus', pkg: pkgIdx, idx: i })}>
              <span className="cd" />{STATUS_TXT_FULL[r.status]}
            </button>
          </div>
        </div>
      );
    } else {
      const gateTxt = r.gate && r.gate.trim() ? r.gate.replace(/★\s*/, '') : '';
      rows.push(
        <div key={i} className={`srow ${r.freeze ? 'freeze' : ''}`}>
          <div>
            <button
              className={`ckbox ${done ? 'on' : ''} ${rowEd ? '' : 'locked'}`}
              onClick={rowEd ? () => dispatch(p.id, { type: 'toggleDone', pkg: pkgIdx, idx: i }) : undefined}
            >
              {done ? '✓' : ''}
            </button>
          </div>
          <div><div className="phnum">{r.no}</div><div className="phname">{r.phase}</div></div>
          <div className="task">
            <b>{r.task}</b><span className="en">{r.taskEn}</span>
            {r.assignee && <span className="assignee">👤 {r.assignee}</span>}
            {gateTxt && <div className={`gate ${r.freeze ? '' : 'plain'}`}>{r.freeze ? '★' : '›'} {gateTxt}</div>}
            <div className="task-note-wrap">
              <input
                className="note-in" placeholder="批注 / 实际情况…" defaultValue={r.note} readOnly={!ed}
                onBlur={(e) => { if (ed && e.target.value !== r.note) dispatch(p.id, { type: 'editSched', pkg: pkgIdx, idx: i, field: 'note', value: e.target.value }); }}
              />
            </div>
          </div>
          <div className="owner">{r.owner}</div>
          <div className="dates">
            {d ? (
              <>
                <span className="d">{fmtDate(d.start)}</span>
                <span className="arrow">→</span>
                <span className={`d ${over ? 'over' : ''}`}>{fmtDate(d.end)}</span>
                <div className="typ">{r.typical}</div>
              </>
            ) : (
              <><span className="gate-dash">—</span><div className="typ">{r.typical}</div></>
            )}
          </div>
          <div>
            {!done && (
              <button
                className={`chip ${STATUS_PILL_CLS[r.status]} ${rowEd ? '' : 'locked'}`}
                onClick={rowEd ? () => dispatch(p.id, { type: 'cycleStatus', pkg: pkgIdx, idx: i }) : undefined}
              >
                <span className="cd" />{STATUS_TXT_FULL[r.status]}
              </button>
            )}
          </div>
        </div>
      );
    }
  });

  return (
    <>
      <div className="subbar">
        {ed && (
          <button className="btn ghost sm" onClick={() => setEditMode(!editMode)}>
            {editMode ? '完成编辑' : '编辑阶段 / 加减行'}
          </button>
        )}
        <button className="btn ghost sm" onClick={onExport}>导出 Export</button>
      </div>
      <div className="pkg-bar">
        <div>
          <span className="k">本服务起始 Start</span>
          {ed ? (
            <input type="date" defaultValue={pkg.start || ''} key={`s${pkg.start}`}
              onChange={(e) => dispatch(p.id, { type: 'setPkgField', pkg: pkgIdx, field: 'start', value: e.target.value })} />
          ) : (
            <b>{pkg.start ? fmtDate(parseISO(pkg.start)) : p.start ? fmtDate(parseISO(p.start)) + ' (项目)' : '—'}</b>
          )}
        </div>
        <div>
          <span className="k">交付 Delivery</span>
          {ed ? (
            <input type="date" defaultValue={pkg.delivery || ''} key={`d${pkg.delivery}`}
              onChange={(e) => dispatch(p.id, { type: 'setPkgField', pkg: pkgIdx, field: 'delivery', value: e.target.value })} />
          ) : (
            <b>{pkg.delivery ? fmtDate(parseISO(pkg.delivery)) : '—'}</b>
          )}
        </div>
        <div>
          <span className="k">Buffer</span>
          {ed ? (
            <input type="number" min={0} style={{ width: 60 }} defaultValue={pkg.buffer || 0} key={`b${pkg.buffer}`}
              onBlur={(e) => (parseInt(e.target.value) || 0) !== (pkg.buffer || 0) && dispatch(p.id, { type: 'setPkgBuffer', pkg: pkgIdx, value: parseInt(e.target.value) || 0 })} />
          ) : (
            <b>{pkg.buffer || 0}</b>
          )}
        </div>
        <div>
          <span className="k">本服务负责</span>
          {ed ? (
            <input defaultValue={pkg.owner || ''} key={`o${pkg.owner}`} placeholder="人"
              onBlur={(e) => e.target.value !== (pkg.owner || '') && dispatch(p.id, { type: 'setPkgField', pkg: pkgIdx, field: 'owner', value: e.target.value })} />
          ) : (
            <b>{pkg.owner || '—'}</b>
          )}
        </div>
        <div style={{ flex: 1 }} />
        {slackNode}
        {ed && <button className="btn ghost sm" onClick={() => dispatch(p.id, { type: 'reversePkg', pkg: pkgIdx })}>↩ 按交付日倒排</button>}
      </div>
      <div className="sched">{rows}</div>
      {editMode && ed && (
        <button className="add-row" onClick={() => dispatch(p.id, { type: 'addRow', pkg: pkgIdx })}>+ 添加阶段 Add phase</button>
      )}
      <p className="sub" style={{ marginTop: 12 }}>
        每个服务有自己的起始/交付/buffer。勾选=完成;未勾且过期=逾期。团队成员只能勾选指派给自己(👤)的任务。
      </p>
    </>
  );
}
