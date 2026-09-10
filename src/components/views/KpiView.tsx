'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { useLang } from '@/lib/i18n';
import { ROLE_LABEL } from '@/lib/permissions';
import { SVC, svcColor } from '@/lib/templates';
import { fmtDate, parseISO, projCode, projPoints } from '@/lib/project';
import { Avatar, Icon, ProgressBar } from '../ui';
import type { Role } from '@/lib/types';
import {
  DIMENSIONS, actualFinish, computeKpi, dimName, firstPassOf, onTimeOf,
  periodOf, ruleSetFor, weightSum,
  type Dimension, type PeriodKey, type PersonKpi,
} from '@/lib/kpi';
import type { KbDoc } from '@/lib/kb';

/* ===== REQ-037A: KPI 看板 =====
   四维加权,数据全部来自平台已有机制,没有一处人工录入。
   点开一个人能看到四维明细 —— 每一维的原始值、折成几分、由哪些项目算来的。
   KPI 最怕「这分怎么来的说不清」,所以明细里把口径和项目清单都摊开。 */
export default function KpiView() {
  const { projects, users, kpiRules, rulesFor, go } = useStore();
  const { lang, t } = useLang();

  const [pk, setPk] = useState<PeriodKey>('quarter');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [svc, setSvc] = useState('');
  const [roleF, setRoleF] = useState('');
  const [sort, setSort] = useState<Dimension | 'total'>('total');
  const [openName, setOpenName] = useState<string | null>(null);
  const [kbDoc, setKbDoc] = useState<KbDoc | null>(null);

  /* 看板页链接到知识库里的「KPI 标准说明」—— 按标题找,找不到就不显示 */
  useEffect(() => {
    fetch('/api/kb').then((r) => (r.ok ? r.json() : null)).then((j) => {
      const d = (j?.docs as KbDoc[] | undefined)?.find((x) => /KPI/i.test(x.title + x.titleEn));
      if (d) setKbDoc(d);
    }).catch(() => {});
  }, []);

  const period = useMemo(
    () => periodOf(pk, new Date(), custom.from && custom.to ? custom : undefined),
    [pk, custom],
  );

  const people = useMemo(() => {
    const pool = users.filter((u) => u.role !== 'viewer' && (!roleF || u.role === roleF));
    return computeKpi({ projects, users: pool, rules: kpiRules, period, svc, pointRulesFor: rulesFor });
  }, [projects, users, kpiRules, period, svc, roleF, rulesFor]);

  /* 本期一个项目都没有的人不上榜 —— 一排 0 分只会让看板变噪音 */
  const rows = useMemo(() => {
    const shown = people.filter((p) => p.projects.length > 0);
    return [...shown].sort((a, b) => {
      const va = sort === 'total' ? a.total : a.scores[sort];
      const vb = sort === 'total' ? b.total : b.scores[sort];
      return (vb ?? -1) - (va ?? -1);
    });
  }, [people, sort]);

  const open = rows.find((r) => r.name === openName) || null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel" style={{ padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>{t('周期', 'Period')}</span>
        {([['month', t('本月', 'This month')], ['quarter', t('本季', 'This quarter')], ['year', t('本年', 'This year')], ['custom', t('自定义', 'Custom')]] as [PeriodKey, string][])
          .map(([k, label]) => (
            <button key={k} className="btn-line sm" style={pk === k ? { borderColor: 'var(--navy900)', color: 'var(--navy900)', fontWeight: 700 } : undefined}
              onClick={() => setPk(k)}>{label}</button>
          ))}
        {pk === 'custom' && (
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input className="in sm" type="date" style={{ width: 148 }} value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            <span style={{ color: 'var(--text2)' }}>→</span>
            <input className="in sm" type="date" style={{ width: 148 }} value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
          </span>
        )}
        <div style={{ flex: 1 }} />
        <select className="in sm" style={{ width: 'auto' }} value={roleF} onChange={(e) => setRoleF(e.target.value)}>
          <option value="">{t('全部角色', 'All roles')}</option>
          {Object.entries(ROLE_LABEL).filter(([k]) => k !== 'viewer').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="in sm" style={{ width: 'auto' }} value={svc} onChange={(e) => setSvc(e.target.value)}
          title={t('按业务筛选,同时会套用这个业务自己的 KPI 规则', 'Filters by service and applies that service’s own rule set')}>
          <option value="">{t('全部业务', 'All services')}</option>
          {Object.keys(SVC).map((k) => <option key={k} value={k}>{lang === 'zh' ? SVC[k].label : SVC[k].en}</option>)}
        </select>
      </div>

      <div className="panel" style={{ padding: '10px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 11.5, color: 'var(--text2)' }}>
        <span>
          {t(`本期 ${period.from} → ${period.to} · 计入本期的项目按「实际完工日 > 交付日 > 创建日」归期`,
             `${period.from} → ${period.to} · projects fall into a period by actual finish date, else delivery date, else creation date`)}
        </span>
        <div style={{ flex: 1 }} />
        {kbDoc
          ? <button className="btn-line sm" onClick={() => go('knowledge')}>📘 {t('KPI 标准说明', 'KPI standard')}</button>
          : <span title={t('在知识库里建一篇标题含「KPI」的文档,这里就会出现入口', 'Create a knowledge-base doc with "KPI" in the title and a link appears here')}>
              {t('（知识库里还没有 KPI 标准说明）', '(no KPI standard doc in the knowledge base yet)')}
            </span>}
        <button className="btn-line sm" onClick={() => go('rules')}><Icon name="settings" size={12} />{t('KPI 规则', 'KPI rules')}</button>
      </div>

      {open && <Detail p={open} onClose={() => setOpenName(null)} svc={svc} />}

      {rows.length === 0 ? (
        <div className="panel" style={{ padding: 34, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
          {t('本期没有可统计的项目 —— 换个周期,或先把项目的交付日 / 排期完成情况填上。',
             'No projects in this period — try another period, or fill in delivery dates and schedule progress first.')}
        </div>
      ) : (
        <div className="panel clip">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: '22%' }}>{t('成员', 'Member')}</th>
                {DIMENSIONS.map(([d, zh, en]) => (
                  <th key={d} style={{ ...th, cursor: 'pointer' }} onClick={() => setSort(d)} title={t('点击按这一维排序', 'Sort by this dimension')}>
                    {lang === 'zh' ? zh : en}{sort === d ? ' ↓' : ''}
                  </th>
                ))}
                <th style={{ ...th, width: 150, cursor: 'pointer' }} onClick={() => setSort('total')}>
                  {t('加权总分', 'Weighted total')}{sort === 'total' ? ' ↓' : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} style={{ cursor: 'pointer', background: openName === r.name ? 'var(--hover-bg)' : undefined }}
                  onClick={() => setOpenName(openName === r.name ? null : r.name)}>
                  <td style={cell}>
                    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                      <Avatar name={r.name} size={26} />
                      <span>
                        <span style={{ fontWeight: 600 }}>{r.name}</span>
                        <span style={{ display: 'block', fontSize: 11, color: 'var(--text2)' }}>
                          {ROLE_LABEL[r.role as Role] || r.role} · {r.projects.length} {t('个项目', 'projects')}
                        </span>
                      </span>
                    </span>
                  </td>
                  {DIMENSIONS.map(([d]) => (
                    <td key={d} style={cell}>
                      <span className="tnum" style={{ fontWeight: 600, color: scoreColor(r.scores[d]) }}>
                        {r.scores[d] == null ? '—' : r.scores[d]}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text2)', marginLeft: 6 }}>{rawText(r, d, lang, t)}</span>
                    </td>
                  ))}
                  <td style={cell}>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ flex: 1 }}><ProgressBar pct={r.total ?? 0} showPct={false} /></span>
                      <span className="tnum" style={{ fontSize: 15, fontWeight: 700, color: scoreColor(r.total) }}>{r.total ?? '—'}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* 某人的四维明细 —— 每一维怎么来的、由哪些项目算出来的 */
function Detail({ p, onClose, svc }: { p: PersonKpi; onClose: () => void; svc: string }) {
  const { kpiRules, rulesFor, openProject } = useStore();
  const { lang, t } = useLang();
  const set = ruleSetFor(kpiRules, p.role, svc);
  const ws = weightSum(set);

  return (
    <div className="panel clip">
      <div className="panel-head" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Avatar name={p.name} size={26} />
        <span className="panel-title">{p.name} · {t('四维明细', 'Breakdown')}</span>
        <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>
          {t(`用的是「${set.role ? ROLE_LABEL[set.role as Role] : '不限角色'} / ${set.svc ? SVC[set.svc]?.label : '不限业务'}」那套规则,权重合计 ${ws}%`,
             `Rule set: ${set.role || 'any role'} / ${set.svc || 'any service'}, weights total ${ws}%`)}
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn-line sm" onClick={onClose}>{t('收起', 'Close')}</button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: '20%' }}>{t('维度', 'Dimension')}</th>
            <th style={{ ...th, width: '20%' }}>{t('原始值', 'Raw')}</th>
            <th style={{ ...th, width: '28%' }}>{t('怎么折成分数', 'How it scores')}</th>
            <th style={{ ...th, width: 90 }}>{t('得分', 'Score')}</th>
            <th style={{ ...th, width: 90 }}>{t('权重', 'Weight')}</th>
          </tr>
        </thead>
        <tbody>
          {DIMENSIONS.map(([d, zh, en]) => {
            const r = set.dims[d];
            const s = p.scores[d];
            return (
              <tr key={d} style={{ opacity: r.on ? 1 : 0.45 }}>
                <td style={cell}>{lang === 'zh' ? zh : en}{!r.on && <span style={{ color: 'var(--text2)' }}> ({t('未计入', 'off')})</span>}</td>
                <td style={cell}><b className="tnum">{rawFull(p, d, lang, t)}</b></td>
                <td style={{ ...cell, color: 'var(--text2)', fontSize: 12 }}>{modeText(r, lang)}</td>
                <td style={cell}><b className="tnum" style={{ color: scoreColor(s) }}>{s == null ? '—' : s}</b></td>
                <td style={cell}><span className="tnum">{r.on ? r.weight + '%' : '—'}</span></td>
              </tr>
            );
          })}
          <tr>
            <td style={{ ...cell, fontWeight: 700 }} colSpan={3}>
              {t('加权总分(只算有数据的维度,按实际权重归一)', 'Weighted total — only dimensions with data, normalised by their weights')}
            </td>
            <td style={cell}><b className="tnum" style={{ fontSize: 15, color: scoreColor(p.total) }}>{p.total ?? '—'}</b></td>
            <td style={cell} />
          </tr>
        </tbody>
      </table>

      <div style={{ padding: '12px 18px', borderTop: '1px solid var(--row-line)' }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>
          {t(`本期计入的项目(${p.projects.length})`, `Projects in this period (${p.projects.length})`)}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {p.projects.map((pr) => {
              const ot = onTimeOf(pr);
              const fp = firstPassOf(pr);
              const fin = actualFinish(pr);
              return (
                <tr key={pr.id}>
                  <td style={{ ...cell, width: '34%' }}>
                    <button style={{ color: 'var(--info)', textAlign: 'left' }} onClick={() => openProject(pr.id)}>
                      {projCode(pr) ? projCode(pr) + ' · ' : ''}{pr.name}
                    </button>
                  </td>
                  <td style={cell}>
                    {(pr.packages || []).map((pkg, i) => (
                      <span key={i} className="badge" style={{ background: 'var(--hover-bg)', color: svcColor(pkg.svc), marginRight: 4 }}>
                        {lang === 'zh' ? SVC[pkg.svc]?.label : SVC[pkg.svc]?.en}
                      </span>
                    ))}
                  </td>
                  <td style={{ ...cell, width: 90 }}><span className="tnum">{projPoints(pr, rulesFor(pr.created))} {t('分', 'pts')}</span></td>
                  <td style={{ ...cell, width: 190, fontSize: 12 }}>
                    {ot == null
                      ? <span style={{ color: 'var(--text2)' }}>{t('未完工,不计准时', 'not finished — excluded')}</span>
                      : <span style={{ color: ot ? 'var(--success)' : 'var(--danger)' }}>
                          {ot ? t('✓ 准时', '✓ on time') : t('✗ 逾期', '✗ late')}
                          {fin ? ` (${fmtDate(parseISO(fin))})` : ''}
                        </span>}
                  </td>
                  <td style={{ ...cell, width: 150, fontSize: 12 }}>
                    {fp == null
                      ? <span style={{ color: 'var(--text2)' }}>{t('未提审,不计质量', 'no review — excluded')}</span>
                      : <span style={{ color: fp ? 'var(--success)' : 'var(--danger)' }}>{fp ? t('✓ 一次通过', '✓ first pass') : t('✗ 有返工', '✗ reworked')}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const scoreColor = (s: number | null) =>
  s == null ? 'var(--text2)' : s >= 85 ? 'var(--success)' : s >= 60 ? 'var(--navy900)' : 'var(--danger)';

/* 分数旁边那一小行是**原始值** —— 带上单位和括号,免得「10 2」看着像一个数 */
function rawText(p: PersonKpi, d: Dimension, lang: 'zh' | 'en', t: (zh: string, en: string) => string): string {
  if (d === 'points') return t(`(${p.raw.points} 分)`, `(${p.raw.points} pts)`);
  if (d === 'load') return t(`(${p.raw.load} 个)`, `(${p.raw.load})`);
  if (d === 'onTime') return p.raw.onTime == null ? '' : `(${p.raw.onTime}%)`;
  return p.raw.quality == null ? '' : `(${p.raw.quality}%)`;
}

function rawFull(p: PersonKpi, d: Dimension, lang: 'zh' | 'en', t: (zh: string, en: string) => string): string {
  if (d === 'points') return t(`${p.raw.points} 分`, `${p.raw.points} pts`);
  if (d === 'load') return t(`${p.raw.load} 个项目`, `${p.raw.load} projects`);
  if (d === 'onTime') {
    return p.raw.onTime == null
      ? t('本期没有完工的项目', 'no finished project this period')
      : `${p.raw.onTime}% (${p.detail.onTimeHit}/${p.detail.onTimeAll})`;
  }
  return p.raw.quality == null
    ? t('本期没有提交过完工审批', 'no completion review this period')
    : `${p.raw.quality}% (${p.detail.qualityHit}/${p.detail.qualityAll})`;
}

function modeText(r: { mode: string; target: number; floor: number; bands: { at: number; score: number }[] }, lang: 'zh' | 'en'): string {
  if (r.mode === 'threshold') return lang === 'zh' ? `达到 ${r.target} 即 100 分,否则 0 分` : `≥ ${r.target} scores 100, else 0`;
  if (r.mode === 'banded') return [...r.bands].sort((a, b) => b.at - a.at).map((b) => `≥${b.at}→${b.score}`).join(' · ');
  return lang === 'zh' ? `${r.floor} 分=0,${r.target} 分=100,中间按比例` : `${r.floor}=0, ${r.target}=100, linear between`;
}

const th: React.CSSProperties = { textAlign: 'left', padding: '10px 16px', fontSize: 11.5, fontWeight: 700, color: 'var(--text2)', borderBottom: '1px solid var(--row-line)' };
const cell: React.CSSProperties = { padding: '10px 16px', fontSize: 12.5, borderTop: '1px solid var(--row-line)', verticalAlign: 'middle' };
