'use client';

import React from 'react';
import { useStore } from '../store';
import { allOverdue, projPoints, projStage } from '@/lib/project';
import { STAGES } from '@/lib/templates';
import { useLang } from '@/lib/i18n';
import { Avatar } from '../ui';

export default function StatsView() {
  const { projects } = useStore();
  const { lang, t } = useLang();
  const byPM: Record<string, { count: number; pts: number; active: number }> = {};
  let totalPts = 0;
  projects.forEach((p) => {
    const pts = projPoints(p);
    totalPts += pts;
    const owners = p.owners && p.owners.length ? p.owners : [t('(未指派)', '(unassigned)')];
    owners.forEach((n) => {
      byPM[n] = byPM[n] || { count: 0, pts: 0, active: 0 };
      byPM[n].count++;
      byPM[n].pts += pts;
      const st = projStage(p);
      if (st !== 'invoice' && st !== 'complete') byPM[n].active++;
    });
  });
  const rows = Object.entries(byPM).sort((a, b) => b[1].pts - a[1].pts);
  const byStage = STAGES.map((s) => [lang === 'zh' ? s[1] : s[2], projects.filter((p) => projStage(p) === s[0]).length] as const);
  const activeCount = projects.filter((p) => { const st = projStage(p); return st !== 'invoice' && st !== 'complete'; }).length;
  const overdue = allOverdue(projects).length;

  const cell: React.CSSProperties = { padding: '12px 22px', borderTop: '1px solid var(--row-line)', fontSize: 13 };
  const th: React.CSSProperties = { padding: '12px 22px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text2)', background: 'var(--hover-bg)', textAlign: 'left' };

  return (
    <>
      <div className="kpi-grid four">
        <MiniKpi label={t('项目总数', 'Projects')} value={String(projects.length)} />
        <MiniKpi label={t('总积分', 'Total points')} value={String(totalPts)} />
        <MiniKpi label={t('进行中', 'Active')} value={String(activeCount)} />
        <MiniKpi label={t('逾期阶段', 'Overdue phases')} value={String(overdue)} color={overdue ? 'var(--danger)' : 'var(--success)'} />
      </div>

      <div className="grid-2col" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 20, alignItems: 'start' }}>
        <div className="panel clip">
          <div className="panel-head"><span className="panel-title">{t('按负责人', 'By PM')}</span></div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr><th style={th}>PM</th><th style={{ ...th, textAlign: 'right' }}>{t('项目数', 'Projects')}</th><th style={{ ...th, textAlign: 'right' }}>{t('进行中', 'Active')}</th><th style={{ ...th, textAlign: 'right' }}>{t('积分', 'Points')}</th></tr>
              {rows.length === 0 && <tr><td style={{ ...cell, color: 'var(--text2)' }} colSpan={4}>{t('暂无数据', 'No data yet')}</td></tr>}
              {rows.map(([n, v]) => (
                <tr key={n}>
                  <td style={cell}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}><Avatar name={n} size={24} />{n}</span></td>
                  <td style={{ ...cell, textAlign: 'right' }} className="tnum">{v.count}</td>
                  <td style={{ ...cell, textAlign: 'right' }} className="tnum">{v.active}</td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 600 }} className="tnum">{v.pts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel clip">
          <div className="panel-head"><span className="panel-title">{t('按阶段', 'By stage')}</span></div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {byStage.map(([label, n]) => (
                <tr key={label}>
                  <td style={cell}>{label}</td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 600 }} className="tnum">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function MiniKpi({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="kpi" style={{ padding: '20px 22px' }}>
      <div className="kpi-label">{label}</div>
      <div className="tnum" style={{ fontSize: 32, fontWeight: 600, color: color || 'var(--navy900)', marginTop: 8, lineHeight: 1 }}>{value}</div>
    </div>
  );
}
