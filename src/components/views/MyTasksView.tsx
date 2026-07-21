'use client';

import React from 'react';
import { useStore } from '../store';
import { fmtDate, pkgStart, planDates, todayMid } from '@/lib/project';
import { canRowEdit } from '@/lib/permissions';
import { svcColor, svcLabel } from '@/lib/templates';
import { STATUS_PILL_CLS, STATUS_TXT, SvcTag } from './parts';
import type { PlanDate } from '@/lib/project';
import type { Project, ScheduleRow } from '@/lib/types';

interface OpenTask { r: ScheduleRow; i: number; pi: number; svc: string; d: PlanDate | null }

export default function MyTasksView() {
  const { projects, me, dispatch, openProject } = useStore();
  const role = me.role;
  const seesAll = role === 'director' || role === 'bd' || role === 'sales';
  const t = todayMid();
  let count = 0;

  const groups = projects.map((p) => {
    const isOwner = (p.owners || []).includes(me.name);
    const open: OpenTask[] = [];
    p.packages.forEach((pk, pi) => {
      const pd = planDates(pk, pkgStart(p, pk));
      pk.schedule.forEach((r, i) => {
        if (r.status === 'done') return;
        let mine: boolean;
        if (seesAll) mine = true;
        else if (role === 'member') mine = r.assignee === me.name;
        else if (role === 'viewer') mine = false;
        else mine = isOwner || r.assignee === me.name; // pm
        if (mine) open.push({ r, i, pi, svc: pk.svc, d: pd[i] });
      });
    });
    if (!open.length) return null;
    open.sort((a, b) => (a.d ? a.d.end.getTime() : 9e15) - (b.d ? b.d.end.getTime() : 9e15));
    count += open.length;
    return { p, open };
  }).filter(Boolean) as { p: Project; open: OpenTask[] }[];

  return (
    <>
      <div className="page-head"><h1>我的待办</h1><span className="en">MY TASKS</span></div>
      <p className="sub">
        {seesAll ? '汇总全部项目的未完成阶段。'
          : role === 'member' ? '只显示在排期里被指派👤给你的任务(按到期排序)。'
          : '你负责项目的未完成阶段 + 指派给你的任务,按到期日排序。逾期标红。'}
        勾选即完成。
      </p>
      {count === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          ✓ 没有指派给你的待办。{role === 'member' ? '（团队成员只看到被指派👤给自己的任务)' : ''}
        </div>
      )}
      {groups.map(({ p, open }) => (
        <div key={p.id} className="mt-group">
          <div className="mt-gh">
            <span className="stripe" style={{ background: svcColor(p.services[0]) }} />
            <span onClick={() => openProject(p.id)} style={{ cursor: 'pointer' }}>{p.name}</span>
            <span style={{ color: 'var(--faint)', fontWeight: 500, fontSize: 11.5, marginLeft: 6 }}>
              {p.services.map((k) => svcLabel(k)).join(', ')}
            </span>
          </div>
          {open.map((x, xi) => {
            const over = x.d && x.d.end < t;
            const rowEd = canRowEdit(me, p, x.r);
            return (
              <div key={xi} className="mt-row">
                <div>
                  <button
                    className={`ckbox ${rowEd ? '' : 'locked'}`}
                    onClick={rowEd ? () => dispatch(p.id, { type: 'toggleDone', pkg: x.pi, idx: x.i }) : undefined}
                  />
                </div>
                <div>
                  <b>{x.r.task}</b>{' '}
                  <span style={{ color: 'var(--faint)', fontSize: 11.5 }}>{x.r.owner}</span>
                  {x.r.assignee && <span className="assignee" style={{ marginTop: 0, marginLeft: 6 }}>👤 {x.r.assignee}</span>}
                  {p.packages.length > 1 && <SvcTag k={x.svc} style={{ marginLeft: 6 }} />}
                </div>
                <div className={`due ${over ? 'over' : ''}`}>{x.d ? fmtDate(x.d.end) : '—'}</div>
                <div>
                  <span className={`stat-pill ${STATUS_PILL_CLS[x.r.status] || 'st-todo'}`}>
                    <span className="cd" />{STATUS_TXT[x.r.status] || '未开始'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
