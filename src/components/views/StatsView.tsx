'use client';

import React from 'react';
import { useStore } from '../store';
import { allOverdue, projPoints, projStage } from '@/lib/project';
import { STAGES } from '@/lib/templates';

export default function StatsView() {
  const { projects } = useStore();
  const byPM: Record<string, { count: number; pts: number; active: number }> = {};
  let totalPts = 0;
  projects.forEach((p) => {
    const pts = projPoints(p);
    totalPts += pts;
    const owners = p.owners && p.owners.length ? p.owners : ['(未指派)'];
    owners.forEach((n) => {
      byPM[n] = byPM[n] || { count: 0, pts: 0, active: 0 };
      byPM[n].count++;
      byPM[n].pts += pts;
      const st = projStage(p);
      if (st !== 'invoice' && st !== 'complete') byPM[n].active++;
    });
  });
  const rows = Object.entries(byPM).sort((a, b) => b[1].pts - a[1].pts);
  const byStage = STAGES.map((s) => [s[1], projects.filter((p) => projStage(p) === s[0]).length] as const);
  const activeCount = projects.filter((p) => { const st = projStage(p); return st !== 'invoice' && st !== 'complete'; }).length;
  const overdue = allOverdue(projects).length;

  return (
    <>
      <div className="page-head"><h1>统计</h1><span className="en">STATS</span></div>
      <p className="sub">按 PM 汇总项目数与积分(难度→积分:简单1/中等2/较难3/复杂5)。</p>
      <div className="kpi">
        <div className="ov"><div className="lab">项目总数</div><div className="big">{projects.length}</div></div>
        <div className="ov"><div className="lab">总积分</div><div className="big">{totalPts}</div></div>
        <div className="ov"><div className="lab">进行中(未完成/未开票)</div><div className="big">{activeCount}</div></div>
        <div className="ov">
          <div className="lab">逾期阶段</div>
          <div className="big" style={{ color: overdue ? 'var(--red)' : 'var(--green)' }}>{overdue}</div>
        </div>
      </div>
      <h3 style={{ fontSize: 14, margin: '6px 0 10px' }}>按 PM By PM</h3>
      <table className="stat-table">
        <tbody>
          <tr><th>PM</th><th style={{ textAlign: 'right' }}>项目数</th><th style={{ textAlign: 'right' }}>进行中</th><th style={{ textAlign: 'right' }}>积分</th></tr>
          {rows.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--muted)' }}>暂无数据</td></tr>}
          {rows.map(([n, v]) => (
            <tr key={n}><td>{n}</td><td className="num">{v.count}</td><td className="num">{v.active}</td><td className="num">{v.pts}</td></tr>
          ))}
        </tbody>
      </table>
      <h3 style={{ fontSize: 14, margin: '20px 0 10px' }}>按阶段 By stage</h3>
      <table className="stat-table">
        <tbody>
          <tr>{byStage.map((s) => <th key={s[0]}>{s[0]}</th>)}</tr>
          <tr>{byStage.map((s) => <td key={s[0]} className="num">{s[1]}</td>)}</tr>
        </tbody>
      </table>
    </>
  );
}
