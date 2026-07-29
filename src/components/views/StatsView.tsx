'use client';

import React, { useMemo } from 'react';
import { useStore } from '../store';
import { allOverdue, projPoints, projStage } from '@/lib/project';
import { workflowMetrics } from '@/lib/metrics';
import { STAGES } from '@/lib/templates';
import { useLang } from '@/lib/i18n';
import { Avatar } from '../ui';

export default function StatsView() {
  const { projects } = useStore();
  const { lang, t } = useLang();
  const wf = useMemo(() => workflowMetrics(projects), [projects]);
  const pct = (r: number | null) => (r == null ? '—' : `${Math.round(r * 100)}%`);
  const rateColor = (r: number | null) => (r == null ? 'var(--text2)' : r >= 0.9 ? 'var(--success)' : r >= 0.7 ? 'var(--warning)' : 'var(--danger)');
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

      {/* v2.2 §8 — post-sales workflow turnaround & SLA on-time rate */}
      <div className="panel clip" style={{ marginTop: 20 }}>
        <div className="panel-head" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="panel-title">{t('售后工作流 · 耗时与 SLA 达标率', 'Workflow turnaround & SLA')}</span>
          <div style={{ flex: 1 }} />
          {wf.overallSamples > 0 && (
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>
              {t('总体达标率', 'Overall on-time')}
              <b className="tnum" style={{ marginLeft: 6, fontSize: 15, color: rateColor(wf.overallRate) }}>{pct(wf.overallRate)}</b>
              <span className="tnum" style={{ marginLeft: 5, color: 'var(--text2)' }}>({wf.overallOnTime}/{wf.overallSamples})</span>
            </span>
          )}
        </div>
        {wf.overallSamples === 0 && wf.steps.every((s) => s.samples === 0) ? (
          <div style={{ padding: 26, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
            {t('暂无工作流数据 — 有项目走完交接/审批/开票后即会统计。', 'No workflow data yet — appears once projects move through handover / review / invoicing.')}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <th style={th}>{t('步骤', 'Step')}</th>
                <th style={{ ...th, textAlign: 'right' }}>{t('样本', 'Samples')}</th>
                <th style={{ ...th, textAlign: 'right' }}>{t('平均耗时', 'Avg')}</th>
                <th style={{ ...th, textAlign: 'right' }}>{t('最长', 'Max')}</th>
                <th style={{ ...th, textAlign: 'right' }}>{t('SLA 目标', 'Target')}</th>
                <th style={{ ...th, width: 180 }}>{t('达标率', 'On-time')}</th>
              </tr>
              {wf.steps.map((s) => (
                <tr key={s.key}>
                  <td style={cell}>{lang === 'zh' ? s.zh : s.en}</td>
                  <td style={{ ...cell, textAlign: 'right' }} className="tnum">{s.samples || '—'}</td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 600 }} className="tnum">
                    {s.avgDays == null ? '—' : t(`${s.avgDays.toFixed(1)} 天`, `${s.avgDays.toFixed(1)}d`)}
                  </td>
                  <td style={{ ...cell, textAlign: 'right', color: 'var(--text2)' }} className="tnum">
                    {s.maxDays == null ? '—' : t(`${s.maxDays} 天`, `${s.maxDays}d`)}
                  </td>
                  <td style={{ ...cell, textAlign: 'right', color: 'var(--text2)' }} className="tnum">
                    {s.target == null ? t('参考', 'ref') : t(`${s.target} 天`, `${s.target}d`)}
                  </td>
                  <td style={cell}>
                    {s.onTimeRate == null ? (
                      <span style={{ fontSize: 12, color: 'var(--text2)' }}>{t('不计 SLA', 'no SLA')}</span>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <div style={{ flex: 1, height: 7, borderRadius: 4, background: 'var(--row-line)', overflow: 'hidden', minWidth: 60 }}>
                          <div style={{ width: `${Math.round(s.onTimeRate * 100)}%`, height: '100%', background: rateColor(s.onTimeRate), borderRadius: 4 }} />
                        </div>
                        <span className="tnum" style={{ fontSize: 12.5, fontWeight: 600, color: rateColor(s.onTimeRate), minWidth: 34, textAlign: 'right' }}>{pct(s.onTimeRate)}</span>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ padding: '10px 22px', fontSize: 11, color: 'var(--text2)', borderTop: '1px solid var(--row-line)' }}>
          {t('耗时按新加坡工作日计(跳周末与 MOM 公共假期)。SLA 目标可在 src/lib/metrics.ts 调整。生产制作耗时因范围而异,仅作参考不计达标。',
             'Durations count Singapore working days (skipping weekends & MOM holidays). SLA targets are set in src/lib/metrics.ts. Production time varies by scope — shown for reference, not scored.')}
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
