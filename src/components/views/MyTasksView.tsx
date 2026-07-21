'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { fmtDate, pkgStart, planDates, todayMid } from '@/lib/project';
import { canRowEdit } from '@/lib/permissions';
import { svcName } from '@/lib/templates';
import { useLang } from '@/lib/i18n';
import { Avatar, Icon, Pill, TM } from '../ui';
import type { PlanDate } from '@/lib/project';
import type { Project, ScheduleRow } from '@/lib/types';

interface Item { p: Project; r: ScheduleRow; i: number; pi: number; svc: string; d: PlanDate | null }

export default function MyTasksView() {
  const { projects, me, dispatch, openProject } = useStore();
  const { lang, t } = useLang();
  const [filter, setFilter] = useState<'all' | 'overdue' | 'wip'>('all');
  const t0 = todayMid();
  const seesAll = me.role === 'director' || me.role === 'bd' || me.role === 'sales';

  const items = useMemo(() => {
    const out: Item[] = [];
    projects.forEach((p) => {
      if (p.archived) return;
      const isOwner = (p.owners || []).includes(me.name);
      p.packages.forEach((pk, pi) => {
        const pd = planDates(pk, pkgStart(p, pk));
        pk.schedule.forEach((r, i) => {
          if (r.status === 'done') return;
          let mine: boolean;
          if (seesAll) mine = true;
          else if (me.role === 'member') mine = r.assignee === me.name;
          else if (me.role === 'viewer') mine = false;
          else mine = isOwner || r.assignee === me.name;
          if (mine) out.push({ p, r, i, pi, svc: pk.svc, d: pd[i] });
        });
      });
    });
    return out.sort((a, b) => (a.d?.end.getTime() || 9e15) - (b.d?.end.getTime() || 9e15));
  }, [projects, me, seesAll]);

  const overdueN = items.filter((x) => x.d && x.d.end < t0).length;
  const shown = items.filter((x) => {
    if (filter === 'overdue') return x.d && x.d.end < t0;
    if (filter === 'wip') return x.r.status === 'wip';
    return true;
  });

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,240px)) 1fr', gap: 20, marginBottom: 22, alignItems: 'center' }}>
        <div className="kpi" style={{ padding: '20px 22px' }}>
          <div className="kpi-label">{t('未完成任务', 'Open Tasks')}</div>
          <div className="tnum" style={{ fontSize: 34, fontWeight: 600, color: 'var(--navy900)', marginTop: 6, lineHeight: 1 }}>{items.length}</div>
        </div>
        <div className="kpi" style={{ padding: '20px 22px' }}>
          <div className="kpi-label">{t('逾期', 'Overdue')}</div>
          <div className="tnum" style={{ fontSize: 34, fontWeight: 600, color: overdueN ? 'var(--danger)' : 'var(--success)', marginTop: 6, lineHeight: 1 }}>{overdueN}</div>
        </div>
        <div style={{ display: 'flex', gap: 7, justifySelf: 'end', flexWrap: 'wrap' }}>
          <button className={`chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>{t('全部', 'All')}</button>
          <button className={`chip ${filter === 'overdue' ? 'active' : ''}`} onClick={() => setFilter('overdue')}>{t('逾期', 'Overdue')}</button>
          <button className={`chip ${filter === 'wip' ? 'active' : ''}`} onClick={() => setFilter('wip')}>{t('进行中', 'In Progress')}</button>
        </div>
      </div>

      <div className="panel clip">
        <div className="table-head" style={{ display: 'grid', gridTemplateColumns: '26px 1fr 170px 40px 120px 118px 40px', gap: 14 }}>
          <div /><div>{t('任务', 'Task')}</div><div>{t('项目', 'Project')}</div><div /><div>{t('到期', 'Due')}</div><div>{t('状态', 'Status')}</div><div />
        </div>
        {shown.length === 0 && (
          <div style={{ padding: 36, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
            ✓ {t('没有匹配的待办。', 'No matching tasks.')}
            {me.role === 'member' ? t('(团队成员只看到被指派👤给自己的任务)', ' (Members only see tasks assigned 👤 to them.)') : ''}
          </div>
        )}
        {shown.map((x, xi) => {
          const over = x.d && x.d.end < t0;
          const rowEd = canRowEdit(me, x.p, x.r);
          return (
            <div key={xi} className="row-hover" style={{
              display: 'grid', gridTemplateColumns: '26px 1fr 170px 40px 120px 118px 40px', gap: 14, alignItems: 'center',
              padding: '15px 22px', borderBottom: '1px solid var(--row-line)',
              borderLeft: `3px solid ${over ? 'var(--danger)' : 'transparent'}`,
            }}>
              <button
                className={`ckbox ${rowEd ? '' : 'locked'}`}
                onClick={rowEd ? () => dispatch(x.p.id, { type: 'toggleDone', pkg: x.pi, idx: x.i }) : undefined}
              />
              <div style={{ minWidth: 0, cursor: 'pointer' }} onClick={() => openProject(x.p.id)}>
                <div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {lang === 'zh' ? x.r.task : x.r.taskEn || x.r.task}
                </div>
                {x.p.packages.length > 1 && <div style={{ fontSize: 11, color: 'var(--text2)' }}>{svcName(x.svc, lang)}</div>}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.p.name}</div>
              <div>{x.r.assignee ? <Avatar name={x.r.assignee} size={26} /> : null}</div>
              <div className="tnum" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 500, color: over ? 'var(--danger)' : 'var(--text2)' }}>
                {over && <Icon name="alert" size={13} />}
                {x.d ? fmtDate(x.d.end).slice(0, 6) : '—'}
              </div>
              <div><Pill m={TM[x.r.status]} /></div>
              <button
                aria-label="Open project"
                onClick={() => openProject(x.p.id)}
                style={{ width: 30, height: 30, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="edit" size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
