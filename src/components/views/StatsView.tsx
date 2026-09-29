'use client';

import React, { useMemo } from 'react';
import { useStore } from '../store';
import { allOverdue, overdueItems, projPoints, projStage } from '@/lib/project';
import { workflowMetrics } from '@/lib/metrics';
import { STAGES } from '@/lib/templates';
import { useLang } from '@/lib/i18n';
import { Avatar, Drill } from '../ui';
import { isUnassignedName, UNASSIGNED_PM, type Focus } from '@/lib/focus';

/* 「(未指派)」那一行在 byPM 里用这个内部标记当 key,渲染时再换成译文 */
const UNASSIGNED = UNASSIGNED_PM;

const idsFocus = (ids: string[], label: string, labelEn: string): Focus => ({ kind: 'ids', ids, label, labelEn });

export default function StatsView() {
  const { projects, rulesFor, drillTo } = useStore();
  const { lang, t } = useLang();
  const wf = useMemo(() => workflowMetrics(projects), [projects]);
  /* 0922 变更单:统计只数在册项目。以前把归档的也算进「项目总数 / 进行中」,
     而项目列表默认不显示归档 —— 点开数字看到的条数会比数字少,一眼就像坏了。
     归档项目本来也不该算作「进行中」。要看归档的,列表上有专门的开关。 */
  const live = useMemo(() => projects.filter((p) => !p.archived), [projects]);
  const pct = (r: number | null) => (r == null ? '—' : `${Math.round(r * 100)}%`);
  const rateColor = (r: number | null) => (r == null ? 'var(--text2)' : r >= 0.9 ? 'var(--success)' : r >= 0.7 ? 'var(--warning)' : 'var(--danger)');
  const byPM: Record<string, { count: number; pts: number; active: number }> = {};
  let totalPts = 0;
  live.forEach((p) => {
    const pts = projPoints(p, rulesFor(p.created));   // REQ-038
    totalPts += pts;
    /* 0922 变更单:「(未指派)」这一行点开也得过滤得出来,所以存内部标记而不是
       译好的文字 —— 文字会跟着语言变,当 key 用迟早对不上。 */
    const owners = p.owners && p.owners.length ? p.owners : [UNASSIGNED];
    owners.forEach((n) => {
      byPM[n] = byPM[n] || { count: 0, pts: 0, active: 0 };
      byPM[n].count++;
      byPM[n].pts += pts;
      const st = projStage(p);
      if (st !== 'invoice' && st !== 'complete') byPM[n].active++;
    });
  });
  const rows = Object.entries(byPM).sort((a, b) => b[1].pts - a[1].pts);
  const byStage = STAGES.map((s) => [s[0], lang === 'zh' ? s[1] : s[2], live.filter((p) => projStage(p) === s[0]).length] as const);
  const activeCount = live.filter((p) => { const st = projStage(p); return st !== 'invoice' && st !== 'complete'; }).length;
  /* 逾期阶段数是「条」,点开看的是「个项目」—— 两个数不一样,所以下钻的可点性
     按有逾期的项目数算,标签也写清楚是项目。 */
  const overdue = allOverdue(live).length;
  const overdueProjects = live.filter((p) => overdueItems(p).length > 0).length;

  /* 0922 变更单:每个数字点开 = 按这个口径过滤后的项目列表 */
  const drill = (f: Focus) => () => drillTo(f);
  const zhOf = (s: { zh: string }) => s.zh;
  const enOf = (s: { en: string }) => s.en;
  const seeList = t('查看这些项目', 'See these projects');
  const pmFocus = (name: string, active?: boolean): Focus => ({ kind: 'pm', name, active });
  const pmName = (n: string) => (isUnassignedName(n) ? t('(未指派)', '(unassigned)') : n);

  const cell: React.CSSProperties = { padding: '12px 22px', borderTop: '1px solid var(--row-line)', fontSize: 13 };
  const th: React.CSSProperties = { padding: '12px 22px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text2)', background: 'var(--hover-bg)', textAlign: 'left' };

  return (
    <>
      <div className="kpi-grid four">
        <MiniKpi label={t('项目总数', 'Projects')} value={String(live.length)} n={live.length} title={seeList} onDrill={drill({ kind: 'all' })} />
        <MiniKpi label={t('总积分', 'Total points')} value={String(totalPts)} n={live.length}
          title={t('按积分从高到低看这些项目', 'See these projects, highest points first')} onDrill={drill({ kind: 'points' })} />
        <MiniKpi label={t('进行中', 'Active')} value={String(activeCount)} n={activeCount} title={seeList} onDrill={drill({ kind: 'active' })} />
        <MiniKpi label={t('逾期阶段', 'Overdue phases')} value={String(overdue)} n={overdueProjects} title={t('查看有逾期阶段的项目', 'See projects with overdue phases')}
          onDrill={drill({ kind: 'overdue' })} color={overdue ? 'var(--danger)' : 'var(--success)'} />
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
                  <td style={cell}>
                    <Drill enabled={v.count > 0} title={seeList} onClick={drill(pmFocus(n))} style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                      <Avatar name={pmName(n)} size={24} />{pmName(n)}
                    </Drill>
                  </td>
                  <td style={{ ...cell, textAlign: 'right' }} className="tnum">
                    <Drill enabled={v.count > 0} title={seeList} onClick={drill(pmFocus(n))}>{v.count}</Drill>
                  </td>
                  <td style={{ ...cell, textAlign: 'right' }} className="tnum">
                    <Drill enabled={v.active > 0} title={seeList} onClick={drill(pmFocus(n, true))}>{v.active}</Drill>
                  </td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 600 }} className="tnum">
                    <Drill enabled={v.count > 0} title={seeList} onClick={drill(pmFocus(n))}>{v.pts}</Drill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel clip">
          <div className="panel-head"><span className="panel-title">{t('按阶段', 'By stage')}</span></div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {byStage.map(([key, label, n]) => (
                <tr key={key}>
                  <td style={cell}>{label}</td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 600 }} className="tnum">
                    <Drill enabled={n > 0} title={seeList} onClick={drill({ kind: 'stage', stage: key })}>{n}</Drill>
                  </td>
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
              <Drill enabled={wf.overallLateIds.length > 0} title={t('查看未达标的项目', 'See the projects that missed the target')}
                onClick={drill(idsFocus(wf.overallLateIds, '售后 SLA · 未达标', 'Workflow SLA · missed'))}>
                <b className="tnum" style={{ marginLeft: 6, fontSize: 15, color: rateColor(wf.overallRate) }}>{pct(wf.overallRate)}</b>
              </Drill>
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
                  <td style={{ ...cell, textAlign: 'right' }} className="tnum">
                    {s.samples ? <Drill title={seeList} onClick={drill(idsFocus(s.ids, `${zhOf(s)} · 样本`, `${enOf(s)} · samples`))}>{s.samples}</Drill> : '—'}
                  </td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 600 }} className="tnum">
                    {s.avgDays == null ? '—' : (
                      <Drill title={seeList} onClick={drill(idsFocus(s.ids, `${zhOf(s)} · 样本`, `${enOf(s)} · samples`))}>
                        {t(`${s.avgDays.toFixed(1)} 天`, `${s.avgDays.toFixed(1)}d`)}
                      </Drill>
                    )}
                  </td>
                  <td style={{ ...cell, textAlign: 'right', color: 'var(--text2)' }} className="tnum">
                    {s.maxDays == null ? '—' : (
                      <Drill title={seeList} onClick={drill(idsFocus(s.ids, `${zhOf(s)} · 样本`, `${enOf(s)} · samples`))}>
                        {t(`${s.maxDays} 天`, `${s.maxDays}d`)}
                      </Drill>
                    )}
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
                        {/* 达标率点开看的是**没达标**的那几个 —— 点一个不及格的百分比,
                            想知道的是谁拖的,不是全部样本 */}
                        <Drill enabled={s.lateIds.length > 0} title={t('查看未达标的项目', 'See the projects that missed the target')}
                          onClick={drill(idsFocus(s.lateIds, `${zhOf(s)} · 未达标`, `${enOf(s)} · missed SLA`))}>
                          <span className="tnum" style={{ fontSize: 12.5, fontWeight: 600, color: rateColor(s.onTimeRate), minWidth: 34, textAlign: 'right' }}>{pct(s.onTimeRate)}</span>
                        </Drill>
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

function MiniKpi({ label, value, color, n, title, onDrill }: {
  label: string; value: string; color?: string;
  /* n = 这个数字背后有几个项目。为 0 就不做成可点的(点开是空列表)。
     注意它不一定等于 value —— 「总积分」显示的是分数,背后是全部项目。 */
  n?: number; title?: string; onDrill?: () => void;
}) {
  const num = <div className="tnum" style={{ fontSize: 32, fontWeight: 600, color: color || 'var(--navy900)', marginTop: 8, lineHeight: 1 }}>{value}</div>;
  return (
    <div className="kpi" style={{ padding: '20px 22px' }}>
      <div className="kpi-label">{label}</div>
      {onDrill
        ? <Drill enabled={(n ?? 0) > 0} title={title} onClick={onDrill} style={{ display: 'block' }}>{num}</Drill>
        : num}
    </div>
  );
}
