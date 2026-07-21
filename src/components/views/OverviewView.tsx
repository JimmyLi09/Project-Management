'use client';

import React, { useMemo } from 'react';
import { useStore } from '../store';
import {
  fmtDate, overdueItems, pkgStart, planDates, projectHealth, projStage,
  schedProgress, staleInfo, todayMid,
} from '@/lib/project';
import { teamLoads } from '@/lib/alloc';
import { svcColor } from '@/lib/templates';
import { useLang } from '@/lib/i18n';
import { Avatar, HM, Icon, Pill, ProgressBar, healthColor } from '../ui';
import type { Project } from '@/lib/types';

export default function OverviewView() {
  const { projects, users, me, setView, go, openProject } = useStore();
  const { lang, t } = useLang();
  const t0 = todayMid();

  const active = useMemo(
    () => projects.filter((p) => { if (p.archived) return false; const s = projStage(p); return s !== 'complete' && s !== 'invoice'; }),
    [projects],
  );
  const monthStart = new Date(t0.getFullYear(), t0.getMonth(), 1).getTime();
  const newThisMonth = projects.filter((p) => p.created >= monthStart).length;

  const healths = active.map((p) => projectHealth(p));
  const onTimeRate = active.length ? Math.round((healths.filter((h) => h === 'ok').length / active.length) * 100) : 100;
  const needAttention = healths.filter((h) => h !== 'ok').length;

  const weekAhead = new Date(t0); weekAhead.setDate(weekAhead.getDate() + 7);
  let openRisks = 0, dueThisWeek = 0;
  active.forEach((p) => {
    openRisks += overdueItems(p).length;
    p.packages.forEach((pk) => {
      const pd = planDates(pk, pkgStart(p, pk));
      pk.schedule.forEach((r, i) => {
        if (r.status === 'block') openRisks++;
        const d = pd[i];
        if (r.status !== 'done' && d && d.end >= t0 && d.end <= weekAhead) dueThisWeek++;
      });
    });
  });

  const myTasks = useMemo(() => {
    const out: { title: string; titleEn: string; project: string; due: Date | null; over: boolean; status: string }[] = [];
    projects.forEach((p) => {
      if (p.archived) return;
      const isOwner = (p.owners || []).includes(me.name);
      p.packages.forEach((pk) => {
        const pd = planDates(pk, pkgStart(p, pk));
        pk.schedule.forEach((r, i) => {
          if (r.status === 'done') return;
          let mine: boolean;
          if (me.role === 'director' || me.role === 'bd' || me.role === 'sales') mine = true;
          else if (me.role === 'member') mine = r.assignee === me.name;
          else if (me.role === 'viewer') mine = false;
          else mine = isOwner || r.assignee === me.name;
          if (mine) out.push({ title: r.task, titleEn: r.taskEn || r.task, project: p.name, due: pd[i]?.end || null, over: !!(pd[i] && pd[i]!.end < t0), status: r.status });
        });
      });
    });
    return out.sort((a, b) => (a.due?.getTime() || 9e15) - (b.due?.getTime() || 9e15)).slice(0, 5);
  }, [projects, me, t0]);

  const directorItems = useMemo(() => {
    const items: { icon: string; color: string; title: string; detail: string; pid: string }[] = [];
    projects.forEach((p) => {
      if (p.archived) return;
      const u = p.update;
      if (u?.needDirector && u.dStatus === 'pending') {
        items.push({
          icon: 'flag', color: 'var(--bronze)',
          title: u.needDirector.split('\n')[0],
          detail: `${p.name} — ${t('待 Director 决定', 'awaiting Director decision')}`, pid: p.id,
        });
      }
      const od = overdueItems(p);
      if (od.length) {
        items.push({
          icon: 'alert', color: 'var(--danger)',
          title: t(`${od.length} 个阶段逾期`, `${od.length} phases overdue`),
          detail: `${p.name} — ${t(`最长逾期 ${od[0].days} 天`, `worst ${od[0].days}d late`)}`, pid: p.id,
        });
      }
      const st = staleInfo(u, lang);
      if (st.cls === 'stale-bad' && (p.owners || []).length) {
        items.push({
          icon: 'clock', color: 'var(--warning)',
          title: t(`周报${st.txt}`, `Weekly update ${st.txt}`),
          detail: `${p.name} — ${t('负责', 'PM')} ${(p.owners || []).join(', ')}`, pid: p.id,
        });
      }
    });
    return items.slice(0, 5);
  }, [projects, lang, t]);

  const loads = useMemo(() => teamLoads(projects, users).slice(0, 5), [projects, users]);
  const boardList = [...active].sort((a, b) => b.created - a.created).slice(0, 6);

  return (
    <>
      <div className="kpi-grid">
        <Kpi label={t('进行中项目', 'Active Projects')} value={String(active.length)} icon="layers" tint="#2E63B7" tintBg="#e7eefb"
          delta={newThisMonth ? t(`本月新增 ${newThisMonth}`, `+${newThisMonth} this month`) : t('本月无新增', 'none new this month')} deltaColor="var(--text2)" />
        <Kpi label={t('按期率', 'On-time Rate')} value={`${onTimeRate}%`} icon="target" tint="#16865B" tintBg="#e6f2ec"
          delta={needAttention ? t(`${needAttention} 个需关注`, `${needAttention} need attention`) : t('全部按期', 'All on track')} deltaColor={needAttention ? 'var(--warning)' : 'var(--success)'} />
        <Kpi label={t('未解决风险', 'Open Risks')} value={String(openRisks)} icon="alert" tint="#D4483F" tintBg="#fbe9e7"
          delta={t(`本周到期 ${dueThisWeek} 项`, `${dueThisWeek} due this week`)} deltaColor={openRisks ? 'var(--danger)' : 'var(--text2)'} />
      </div>

      <div className="grid-2col" style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <div className="panel clip">
            <div className="panel-head">
              <span className="panel-title">{t('总览看板', 'Master Board')}</span>
              <a className="panel-link" onClick={() => go('projects')}>{t('查看全部 →', 'View all →')}</a>
            </div>
            {boardList.length === 0 && (
              <div style={{ padding: 30, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
                {t('暂无进行中的项目 — 点右上角「新建项目」创建。', 'No active projects yet — use New Project to create one.')}
              </div>
            )}
            {boardList.map((p) => <BoardRow key={p.id} p={p} onOpen={() => openProject(p.id)} />)}
          </div>

          <div className="panel">
            <div className="panel-head">
              <span className="panel-title"><Icon name="users" style={{ color: 'var(--navy700)' }} />{t('团队负载', 'Team Allocation')}</span>
              <a className="panel-link" onClick={() => go('team')}>{t('管理 →', 'Manage →')}</a>
            </div>
            <div style={{ padding: '8px 22px 16px' }}>
              {loads.length === 0 && <div style={{ padding: 18, color: 'var(--text2)', fontSize: 13 }}>{t('暂无 PM / 成员数据。', 'No PM / member data yet.')}</div>}
              {loads.map((a) => (
                <div key={a.name} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 66px', gap: 14, alignItems: 'center', padding: '11px 0', borderBottom: '1px solid var(--row-line2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <Avatar name={a.name} size={30} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text2)' }}>{a.isPM ? t('项目经理', 'Project Manager') : t('制作', 'Production')}</div>
                    </div>
                  </div>
                  <ProgressBar pct={a.load} color={healthColor(a.load)} />
                  <div className="tnum" style={{ fontSize: 12, color: 'var(--text2)', textAlign: 'right' }}>{a.activeProjects.length} {t('项目', 'proj')}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <div className="panel clip">
            <div className="panel-head">
              <span className="panel-title">{t('我的待办', 'My Tasks')}</span>
              <a className="panel-link" onClick={() => go('mytasks')}>{t('全部 →', 'All →')}</a>
            </div>
            {myTasks.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>✓ {t('暂无待办', 'Nothing open')}</div>}
            {myTasks.map((tk, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 22px', borderBottom: '1px solid var(--row-line2)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: tk.over ? 'var(--danger)' : tk.status === 'wip' ? 'var(--info)' : '#c4d0dd' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lang === 'zh' ? tk.title : tk.titleEn}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tk.project}</div>
                </div>
                <span className="tnum" style={{ fontSize: 12, fontWeight: 600, color: tk.over ? 'var(--danger)' : 'var(--text2)' }}>
                  {tk.due ? fmtDate(tk.due).slice(0, 6) : '—'}
                </span>
              </div>
            ))}
          </div>

          <div className="panel" style={{ padding: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span className="panel-title">{t('向上汇报', 'Director Update')}</span>
              <a className="panel-link" onClick={() => go('dupdate')}>{t('打开 →', 'Open →')}</a>
            </div>
            {directorItems.length === 0 && <div style={{ padding: '14px 0', color: 'var(--text2)', fontSize: 13 }}>✓ {t('无待决策事项或风险提示', 'No pending decisions or alerts')}</div>}
            {directorItems.map((d, i) => (
              <div key={i} style={{ display: 'flex', gap: 11, padding: '11px 0', borderTop: i ? '1px solid var(--row-line2)' : 'none', cursor: 'pointer' }}
                onClick={() => setView({ name: 'project', pid: d.pid, tab: 'overview', pkg: 0 })}>
                <span style={{ color: d.color, flexShrink: 0, marginTop: 1, display: 'flex' }}><Icon name={d.icon} size={16} /></span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 1 }}>{d.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function Kpi({ label, value, icon, tint, tintBg, delta, deltaColor }: {
  label: string; value: string; icon: string; tint: string; tintBg: string; delta: string; deltaColor: string;
}) {
  return (
    <div className="kpi">
      <div className="kpi-top">
        <div className="kpi-label">{label}</div>
        <span className="kpi-icon" style={{ background: tintBg, color: tint }}><Icon name={icon} size={18} /></span>
      </div>
      <div className="kpi-value tnum">{value}</div>
      <div className="kpi-delta" style={{ color: deltaColor }}>{delta}</div>
    </div>
  );
}

function BoardRow({ p, onOpen }: { p: Project; onOpen: () => void }) {
  const { t } = useLang();
  const sp = schedProgress(p);
  const h = projectHealth(p);
  const pm = (p.owners || [])[0];
  const stage = projStage(p);
  const stageLabel = {
    presales: t('售前', 'Presales'), handover: t('交接', 'Handover'), progress: t('进行中', 'Production'),
    complete: t('完成', 'Complete'), invoice: t('收尾', 'Invoice'),
  }[stage];
  return (
    <div
      className="row-hover"
      onClick={onOpen}
      style={{ display: 'grid', gridTemplateColumns: 'minmax(150px,1.7fr) 34px minmax(90px,1.1fr) 108px', gap: 16, alignItems: 'center', padding: '15px 22px', borderBottom: '1px solid var(--row-line)', cursor: 'pointer' }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--navy900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
        <div style={{ fontSize: 12.5, color: 'var(--text2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {p.client || '—'} · {stageLabel} · {t('交付', 'Del')} {p.delivery ? fmtDate(new Date(p.delivery + 'T00:00:00')).slice(0, 6) : '—'}
        </div>
      </div>
      <div>{pm ? <Avatar name={pm} size={30} /> : <span style={{ color: 'var(--text2)', fontSize: 12 }}>—</span>}</div>
      <ProgressBar pct={sp.pct} color={svcColor(p.services[0])} />
      <div style={{ justifySelf: 'end' }}><Pill m={HM[h]} /></div>
    </div>
  );
}
