'use client';

import React, { useMemo } from 'react';
import { useStore } from '../store';
import { teamLoads } from '@/lib/alloc';
import { projPoints, projStage } from '@/lib/project';
import { Avatar, ProgressBar, healthColor } from '../ui';

export default function TeamView() {
  const { projects, users, openProject } = useStore();
  const loads = useMemo(() => teamLoads(projects, users), [projects, users]);
  const pms = loads.filter((l) => l.isPM);
  const prod = loads.filter((l) => !l.isPM);

  const activeProjects = projects.filter((p) => { const s = projStage(p); return s !== 'complete' && s !== 'invoice'; });
  const overloaded = loads.filter((l) => l.load >= 85).length;
  const avgLoad = loads.length ? Math.round(loads.reduce((a, l) => a + l.load, 0) / loads.length) : 0;
  const totalPts = projects.reduce((a, p) => a + projPoints(p), 0);

  return (
    <>
      <div className="kpi-grid four">
        <MiniKpi label="Team members 团队人数" value={String(loads.length)} sub={`${pms.length} PM · ${prod.length} production`} />
        <MiniKpi label="Active projects 进行中" value={String(activeProjects.length)} sub={`共 ${projects.length} 个项目`} />
        <MiniKpi label="Avg workload 平均负载" value={`${avgLoad}%`} color={healthColor(avgLoad)} sub="按项目数与未完成任务估算" />
        <MiniKpi label="Total points 总积分" value={String(totalPts)} sub="难度积分:简单1/中等2/较难3/复杂5" color={overloaded ? 'var(--danger)' : undefined} />
      </div>

      {[['Project Managers 项目经理', pms], ['Production 制作团队', prod]].map(([label, group]) => (
        <div key={label as string} style={{ marginBottom: 26 }}>
          <div className="section-label">{label as string}</div>
          {(group as typeof loads).length === 0 && (
            <div className="panel" style={{ padding: 24, color: 'var(--text2)', fontSize: 13 }}>
              暂无成员 — 在 Users 页创建账号,或在项目里指派后自动出现。
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))', gap: 18 }}>
            {(group as typeof loads).map((m) => {
              const pts = m.activeProjects.reduce((a, p) => a + projPoints(p), 0);
              const lc = healthColor(m.load);
              const loadLabel = m.load >= 85 ? 'Overloaded 超载' : m.load >= 70 ? 'Busy 较满' : 'Available 可用';
              return (
                <div key={m.name} className="panel" style={{ padding: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 16 }}>
                    <Avatar name={m.name} size={42} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--navy900)' }}>{m.name}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>{m.role}</div>
                    </div>
                    <span className="badge" style={{ background: m.load >= 85 ? '#fbe9e7' : m.load >= 70 ? '#fbf0dc' : '#e6f2ec', color: m.load >= 85 ? '#b23a32' : m.load >= 70 ? '#a8690b' : '#0f6a48' }}>
                      {loadLabel}
                    </span>
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--text2)', marginBottom: 6 }}>
                      <span>Workload 负载</span>
                      <span className="tnum" style={{ fontWeight: 600, color: lc }}>{m.load}%</span>
                    </div>
                    <ProgressBar pct={m.load} color={lc} showPct={false} />
                  </div>
                  <div style={{ display: 'flex', gap: 22, marginBottom: 16 }}>
                    <div><div className="tnum" style={{ fontSize: 20, fontWeight: 600, color: 'var(--navy900)' }}>{m.activeProjects.length}</div><div style={{ fontSize: 11, color: 'var(--text2)' }}>Active projects</div></div>
                    <div><div className="tnum" style={{ fontSize: 20, fontWeight: 600, color: 'var(--navy900)' }}>{m.openTasks}</div><div style={{ fontSize: 11, color: 'var(--text2)' }}>Open tasks</div></div>
                    <div><div className="tnum" style={{ fontSize: 20, fontWeight: 600, color: 'var(--navy900)' }}>{pts}</div><div style={{ fontSize: 11, color: 'var(--text2)' }}>Points 积分</div></div>
                  </div>
                  <div style={{ borderTop: '1px solid var(--row-line)', paddingTop: 13 }}>
                    <div className="mini-label" style={{ marginBottom: 8 }}>Assigned to 参与项目</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {m.activeProjects.length === 0 && <span style={{ fontSize: 11.5, color: 'var(--text2)', padding: '4px 2px' }}>Available for assignment 可指派</span>}
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
