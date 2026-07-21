'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import {
  allOverdue, fmtDate, nextFreeze, overdueItems, pkgProgress, pkgStart,
  planDates, projectHealth, projPoints, schedProgress, statusPct, todayMid,
} from '@/lib/project';
import { canEdit, canRowEdit } from '@/lib/permissions';
import { DIFF, svcColor, svcLabel } from '@/lib/templates';
import { HealthTag, StageTag, SvcTag, STATUS_PILL_CLS, STATUS_TXT } from './parts';
import type { Project } from '@/lib/types';

export default function BoardView() {
  const { projects, me, dispatch, openProject } = useStore();
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expandAll, setExpandAll] = useState(false);

  const pms = useMemo(() => {
    const s = new Set<string>();
    projects.forEach((p) => { (p.owners || []).forEach((n) => s.add(n)); (p.perm || []).forEach((n) => s.add(n)); });
    return [...s];
  }, [projects]);

  const list = filter ? projects.filter((p) => (p.owners || []).includes(filter)) : projects;
  const od = allOverdue(list);

  const isCol = (p: Project) => (collapsed[p.id] !== undefined ? collapsed[p.id] : !expandAll);

  return (
    <>
      <div className="page-head">
        <h1>总览看板</h1><span className="en">MASTER BOARD</span>
        <div style={{ flex: 1 }} />
        <button className="btn ghost sm" onClick={() => { setExpandAll(!expandAll); setCollapsed({}); }}>
          {expandAll ? '全部收起' : '全部展开'}
        </button>
      </div>
      <div className="toolbar">
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>只看负责人:</span>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">全部负责人 All</option>
          {pms.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      {od.length > 0 && (
        <div className="overdue-banner">
          ⚠ 当前有 <b style={{ margin: '0 3px' }}>{od.length}</b> 个逾期阶段(未勾选且已过期),点右上角铃铛查看。
        </div>
      )}
      <div className="legend">
        <div className="grp">
          <b style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--faint)' }}>进展 HEALTH</b>
          <span className="grp"><span className="dt" style={{ background: 'var(--green)' }} />正常</span>
          <span className="grp"><span className="dt" style={{ background: 'var(--amber)' }} />预警</span>
          <span className="grp"><span className="dt" style={{ background: 'var(--red)' }} />逾期</span>
        </div>
        <div className="grp" style={{ color: 'var(--faint)' }}>默认折叠为摘要 · 点项目标题展开 · ☑勾选=完成 · ★=冻结点</div>
      </div>
      <div className="board">
        <div className="bhead">
          <div>✓</div><div>任务/阶段</div><div>负责</div><div>状态</div><div>开始</div><div>到期</div><div>进度</div><div>时长</div>
        </div>
        {list.length === 0 && (
          <div style={{ padding: 50, textAlign: 'center', color: 'var(--muted)' }}>没有匹配的项目。</div>
        )}
        {list.map((p) => (
          <ProjectGroup
            key={p.id}
            p={p}
            filter={filter}
            collapsed={isCol(p)}
            onToggle={() => setCollapsed((c) => ({ ...c, [p.id]: !isCol(p) }))}
            onOpen={() => openProject(p.id)}
            canEditP={canEdit(me, p)}
            rowEditable={(r) => canRowEdit(me, p, r)}
            onToggleDone={(pi, i) => dispatch(p.id, { type: 'toggleDone', pkg: pi, idx: i })}
          />
        ))}
      </div>
    </>
  );
}

function ProjectGroup({
  p, filter, collapsed, onToggle, onOpen, canEditP, rowEditable, onToggleDone,
}: {
  p: Project;
  filter: string;
  collapsed: boolean;
  onToggle: () => void;
  onOpen: () => void;
  canEditP: boolean;
  rowEditable: (r: Project['packages'][0]['schedule'][0]) => boolean;
  onToggleDone: (pi: number, i: number) => void;
}) {
  const sp = schedProgress(p);
  const h = projectHealth(p);
  const primary = svcColor(p.services[0]);
  const t = todayMid();
  const nf = nextFreeze(p);
  const odc = overdueItems(p).length;

  return (
    <>
      <div className={`pgroup-head ${collapsed ? 'collapsed' : ''}`} onClick={onToggle}>
        <span className="caret">▼</span>
        <span className="stripe" style={{ background: primary }} />
        <span className="pn" onClick={(e) => { e.stopPropagation(); onOpen(); }}>{p.name}</span>
        {p.services.slice(0, 4).map((k) => <SvcTag key={k} k={k} />)}
        <StageTag p={p} />
        <span className="diff">{DIFF[p.difficulty][0].split(' ')[0]}·{projPoints(p)}分</span>
        <span className="own">
          负责{' '}
          {(p.owners || []).length
            ? p.owners.map((n, i) => (
                <React.Fragment key={n}>
                  {i > 0 && ', '}
                  <b className={filter === n ? 'hl' : ''}>{n}</b>
                </React.Fragment>
              ))
            : '—'}
          {canEditP ? '' : ' · 只读'}
        </span>
        <div style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>{sp.done}/{sp.total}·{sp.pct}%</span>
        <HealthTag h={h} />
      </div>
      {collapsed ? (
        <div className="bsum">
          <span>阶段 <b>{sp.done}/{sp.total}</b> · {sp.pct}%</span>
          <span>下一冻结点 <b>{nf ? nf.row.phase + (nf.date ? ' · ' + fmtDate(nf.date) : '') : '—'}</b></span>
          {odc ? <span className="over">逾期 {odc}</span> : <span style={{ color: 'var(--green)' }}>按期</span>}
          <span style={{ marginLeft: 'auto', color: 'var(--faint)' }}>点标题展开 ▾</span>
        </div>
      ) : (
        p.packages.map((pk, pi) => {
          const pd = planDates(pk, pkgStart(p, pk));
          const scol = svcColor(pk.svc);
          return (
            <React.Fragment key={pi}>
              {p.packages.length > 1 && (
                <div className="svc-seg" style={{ borderLeft: `3px solid ${scol}` }}>
                  <span style={{ color: scol, fontWeight: 700 }}>{svcLabel(pk.svc)}</span>
                  <span className="mono" style={{ color: 'var(--faint)', fontSize: 10.5 }}>{pkgProgress(pk).pct}%</span>
                </div>
              )}
              {pk.schedule.map((r, i) => {
                const d = pd[i];
                const over = r.status !== 'done' && d && d.end < t;
                const rowEd = rowEditable(r);
                const done = r.status === 'done';
                const pct = statusPct(r.status);
                const barColor = over ? 'var(--red)' : done ? 'var(--green)' : r.status === 'block' ? 'var(--amber)' : scol;
                return (
                  <div key={i} className={`brow ${r.freeze ? 'freeze' : ''}`}>
                    <div>
                      <button
                        className={`ckbox ${done ? 'on' : ''} ${rowEd ? '' : 'locked'}`}
                        onClick={rowEd ? () => onToggleDone(pi, i) : undefined}
                      >
                        {done ? '✓' : ''}
                      </button>
                    </div>
                    <div className="tk">
                      <span className="pno">{r.no}</span>
                      {r.freeze && <span className="fstar">★</span>}
                      <span>{r.task}</span>
                      {r.assignee && <span className="assignee" style={{ marginTop: 0 }}>👤 {r.assignee}</span>}
                    </div>
                    <div className="own">{r.owner}</div>
                    <div>
                      {!done && (
                        <span className={`stat-pill ${STATUS_PILL_CLS[r.status]}`}>
                          <span className="cd" />{STATUS_TXT[r.status]}
                        </span>
                      )}
                    </div>
                    <div className="dt2 start">{d ? fmtDate(d.start) : '—'}</div>
                    <div className={`dt2 due ${over ? 'over' : ''}`}>{d ? fmtDate(d.end) : '—'}</div>
                    <div className="prog">
                      <div className="miniprog"><i style={{ width: `${pct}%`, background: barColor }} /></div>
                    </div>
                    <div className="dur">{r.weeks > 0 ? Math.round(r.weeks * 7) + '天' : '—'}</div>
                  </div>
                );
              })}
            </React.Fragment>
          );
        })
      )}
    </>
  );
}
