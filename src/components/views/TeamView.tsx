'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { teamLoads } from '@/lib/alloc';
import { projPoints, projStage } from '@/lib/project';
import { canAssign } from '@/lib/permissions';
import { useLang } from '@/lib/i18n';
import { Avatar, ProgressBar, healthColor } from '../ui';
import TransferModal from '../TransferModal';

export default function TeamView() {
  const { projects, users, openProject, me } = useStore();
  const { t } = useLang();
  const [transferFrom, setTransferFrom] = useState<string | null>(null);
  const loads = useMemo(() => teamLoads(projects, users), [projects, users]);
  const pms = loads.filter((l) => l.isPM);
  const prod = loads.filter((l) => !l.isPM);

  const activeProjects = projects.filter((p) => { if (p.archived) return false; const s = projStage(p); return s !== 'complete' && s !== 'invoice'; });
  const avgLoad = loads.length ? Math.round(loads.reduce((a, l) => a + l.load, 0) / loads.length) : 0;
  /* B5: overload is measured by points against each person's cap (when set) */
  const isOverCap = (l: typeof loads[number]) => l.pointCap > 0 && l.points > l.pointCap;
  const overloaded = loads.filter((l) => isOverCap(l) || l.load >= 85).length;
  const totalPts = projects.reduce((a, p) => a + projPoints(p), 0);

  const groups: [string, typeof loads][] = [
    [t('项目经理', 'Project Managers'), pms],
    [t('制作团队', 'Production'), prod],
  ];

  return (
    <>
      <div className="kpi-grid four">
        <MiniKpi label={t('团队人数', 'Team members')} value={String(loads.length)} sub={`${pms.length} PM · ${prod.length} ${t('制作', 'production')}`} />
        <MiniKpi label={t('进行中项目', 'Active projects')} value={String(activeProjects.length)} sub={t(`共 ${projects.length} 个项目`, `${projects.length} projects total`)} />
        <MiniKpi label={t('平均负载', 'Avg workload')} value={`${avgLoad}%`} color={healthColor(avgLoad)} sub={t('按项目数与未完成任务估算', 'estimated from projects & open tasks')} />
        <MiniKpi label={t('总积分', 'Total points')} value={String(totalPts)} sub={t('简单1 / 中等2 / 较难3 / 复杂5', 'easy 1 / medium 2 / hard 3 / complex 5')} color={overloaded ? 'var(--danger)' : undefined} />
      </div>

      {groups.map(([label, group]) => (
        <div key={label} style={{ marginBottom: 26 }}>
          <div className="section-label">{label}</div>
          {group.length === 0 && (
            <div className="panel" style={{ padding: 24, color: 'var(--text2)', fontSize: 13 }}>
              {t('暂无成员 — 在「用户管理」创建账号,或在项目里指派后自动出现。', 'No members yet — create accounts in Users, or assign people in a project.')}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))', gap: 18 }}>
            {group.map((m) => {
              const pts = m.points;
              const hasCap = m.pointCap > 0;
              /* D13: when a cap is set, workload % is driven by points/cap;
                 otherwise fall back to the project/task heuristic. */
              const loadPct = hasCap ? Math.round((pts / m.pointCap) * 100) : m.load;
              const overCap = hasCap && pts > m.pointCap;
              const busy = loadPct >= 85;
              const lc = overCap ? '#D4483F' : healthColor(loadPct);
              const loadLabel = overCap ? t('超载', 'Overloaded') : busy ? t('较满', 'Busy') : loadPct >= 70 ? t('较满', 'Busy') : t('可用', 'Available');
              return (
                <div key={m.name} className="panel" style={{ padding: 20, ...(overCap ? { boxShadow: 'inset 0 0 0 1.5px #e7a19b' } : {}) }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 16 }}>
                    <Avatar name={m.name} size={42} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--navy900)' }}>{m.name}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>
                        {m.position || (m.isPM ? t('项目经理', 'Project Manager') : t('制作', 'Production'))}
                      </div>
                    </div>
                    <span className="badge" style={{ background: overCap || busy ? '#fbe9e7' : loadPct >= 70 ? '#fbf0dc' : '#e6f2ec', color: overCap || busy ? '#b23a32' : loadPct >= 70 ? '#a8690b' : '#0f6a48' }}>
                      {loadLabel}
                    </span>
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--text2)', marginBottom: 6 }}>
                      <span>{hasCap ? t('积分负载', 'Points load') : t('工作量', 'Workload')}</span>
                      <span className="tnum" style={{ fontWeight: 600, color: lc }}>
                        {hasCap ? <>{pts} / {m.pointCap} {t('积分', 'pts')} · {loadPct}%</> : <>{loadPct}%</>}
                      </span>
                    </div>
                    <ProgressBar pct={Math.min(100, loadPct)} color={lc} showPct={false} />
                    {hasCap && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>{t('按积分上限计算', 'measured against point cap')}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 22, marginBottom: 16 }}>
                    <div><div className="tnum" style={{ fontSize: 20, fontWeight: 600, color: 'var(--navy900)' }}>{m.activeProjects.length}</div><div style={{ fontSize: 11, color: 'var(--text2)' }}>{t('进行中项目', 'Active projects')}</div></div>
                    <div><div className="tnum" style={{ fontSize: 20, fontWeight: 600, color: 'var(--navy900)' }}>{m.openTasks}</div><div style={{ fontSize: 11, color: 'var(--text2)' }}>{t('未完成任务', 'Open tasks')}</div></div>
                    <div><div className="tnum" style={{ fontSize: 20, fontWeight: 600, color: 'var(--navy900)' }}>{pts}</div><div style={{ fontSize: 11, color: 'var(--text2)' }}>{t('积分', 'Points')}</div></div>
                  </div>
                  <div style={{ borderTop: '1px solid var(--row-line)', paddingTop: 13 }}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                      <div className="mini-label">{t('参与项目', 'Assigned to')}</div>
                      <div style={{ flex: 1 }} />
                      {canAssign(me) && m.activeProjects.length > 0 && (
                        <button
                          style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--navy700)' }}
                          title={t('休假/离职:把此人全部项目一次性移交', 'Vacation/departure: hand over all their projects at once')}
                          onClick={() => setTransferFrom(m.name)}
                        >
                          ⇄ {t('转交全部', 'Transfer all')}
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {m.activeProjects.length === 0 && <span style={{ fontSize: 11.5, color: 'var(--text2)', padding: '4px 2px' }}>{t('可指派', 'Available for assignment')}</span>}
                      {m.activeProjects.map((p) => (
                        <span key={p.id} className="svc-chip" style={{ cursor: 'pointer', padding: '4px 9px', fontSize: 11.5 }} onClick={() => openProject(p.id)}>
                          {p.name}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {transferFrom && <TransferModal from={transferFrom} onClose={() => setTransferFrom(null)} />}
    </>
  );
}

function MiniKpi({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <div className="kpi" style={{ padding: '20px 22px' }}>
      <div className="kpi-label">{label}</div>
      <div className="tnum" style={{ fontSize: 32, fontWeight: 600, color: color || 'var(--navy900)', marginTop: 8, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6 }}>{sub}</div>
    </div>
  );
}
