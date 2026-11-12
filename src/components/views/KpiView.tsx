'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { useLang } from '@/lib/i18n';
import { ROLE_LABEL } from '@/lib/permissions';
import { roleTerm } from '@/lib/terms';
import { SVC, svcColor } from '@/lib/templates';
import { fmtDate, parseISO, projPoints } from '@/lib/project';
import { Avatar, Icon, ProgressBar } from '../ui';
import {
  BAND_TEXT, DIMENSIONS, LOWER_BETTER, NEW_DIMS_063, PM_LEVEL_NAME, PM_LEVEL_ORDER,
  actualFinish, bandOf, companyCards, computeKpi, firstPassOf, kpiRulesForPeriod, onTimeOf,
  periodOf, pointsIn, quarterOf, ruleSetFor, weightSum,
  type BandState, type Dimension, type KpiRules, type LevelBands, type PeriodKey, type PersonKpi,
} from '@/lib/kpi';
import { clientRounds, type FeeCount } from '@/lib/revisions';
import { localDay } from '@/lib/localDate';
import type { KbDoc } from '@/lib/kb';

/* ===== REQ-037A: KPI 看板 =====
   多维加权,数据全部来自平台已有机制,没有一处人工录入。
   点开一个人能看到各维明细 —— 每一维的原始值、折成几分、由哪些项目算来的。
   KPI 最怕「这分怎么来的说不清」,所以明细里把口径和项目清单都摊开。

   REQ-063 加了三样:
   ① 顶部「每月看 3 个数」(全公司口径,跟着选的周期,默认本月);
   ② 每个 PM 的级别(PD / BD 可以直接改)+ 所选周期所在季度的项目分值 / 级别区间横条;
   ③ 两个新维度 平均修改轮数 / 修改费回收率(默认不计入总分)。
   一个周期用哪一版规则:周期结束日在上线日之后的,用周期结束那天生效的版本(kpiRulesForPeriod)。 */
export default function KpiView() {
  const { projects, allUsers, kpiRuleVersions, rulesFor, since063, go, setToast, me } = useStore();
  /* REQ-051: KPI 是绩效记录,停用的人照旧算(和以前一样);已删除的不再出现 */
  const users = useMemo(() => allUsers.filter((u) => !u.deletedAt), [allUsers]);
  const { lang, t } = useLang();

  /* REQ-063:卡片「跟随看板上选的周期(默认本月)」 */
  const [pk, setPk] = useState<PeriodKey>('month');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [svc, setSvc] = useState('');
  const [roleF, setRoleF] = useState('');
  const [sort, setSort] = useState<Dimension | 'total'>('total');
  const [openName, setOpenName] = useState<string | null>(null);
  const [kbDoc, setKbDoc] = useState<KbDoc | null>(null);
  const [levels, setLevels] = useState<Record<string, string>>({});
  const admin = me.role === 'director' || me.role === 'bd';

  /* 看板页链接到知识库里的「KPI 标准说明」—— 按标题找,找不到就不显示 */
  useEffect(() => {
    fetch('/api/kb').then((r) => (r.ok ? r.json() : null)).then((j) => {
      const d = (j?.docs as KbDoc[] | undefined)?.find((x) => /KPI/i.test(x.title + x.titleEn));
      if (d) setKbDoc(d);
    }).catch(() => {});
  }, []);

  /* REQ-063:PM 级别(REQ-062 的 pm_level)。只有 PD / BD 拿得到 */
  const loadLevels = useCallback(async () => {
    const r = await fetch('/api/kpi-levels').catch(() => null);
    if (r?.ok) setLevels((await r.json()).levels || {});
  }, []);
  useEffect(() => { loadLevels(); }, [loadLevels]);

  async function setLevel(name: string, level: string) {
    const r = await fetch('/api/train', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'setPmLevel', user: name, level }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setToast(`⚠ ${j.error || t('保存失败', 'Save failed')}`); return; }
    setLevels((x) => ({ ...x, [name]: level }));
    setToast(t(`已把 ${name} 的级别改为 ${level ? PM_LEVEL_NAME[level as keyof typeof PM_LEVEL_NAME] : '未设'}`, `${name}'s level set to ${level ? PM_LEVEL_NAME[level as keyof typeof PM_LEVEL_NAME] : 'not set'}`));
  }

  const period = useMemo(
    () => periodOf(pk, new Date(), custom.from && custom.to ? custom : undefined),
    [pk, custom],
  );
  const today = localDay();
  /* 这个周期用哪一版规则(REQ-063) */
  const rules = useMemo(() => kpiRulesForPeriod(kpiRuleVersions, period, since063, today), [kpiRuleVersions, period, since063, today]);
  /* 「本季度项目分值」:所选周期所在的那个季度(周期还没结束的按今天) */
  const quarter = useMemo(() => quarterOf(period.to < today ? period.to : today), [period, today]);

  const people = useMemo(() => {
    const pool = users.filter((u) => u.role !== 'viewer' && (!roleF || u.role === roleF));
    return computeKpi({ projects, users: pool, rules, period, svc, pointRulesFor: rulesFor, since063 });
  }, [projects, users, rules, period, svc, roleF, rulesFor, since063]);

  const cards = useMemo(() => companyCards(projects, period, since063), [projects, period, since063]);

  /* 本期一个项目都没有的人不上榜 —— 一排 0 分只会让看板变噪音 */
  const rows = useMemo(() => {
    const shown = people.filter((p) => p.projects.length > 0);
    return [...shown].sort((a, b) => {
      const va = sort === 'total' ? a.total : a.scores[sort];
      const vb = sort === 'total' ? b.total : b.scores[sort];
      return (vb ?? -1) - (va ?? -1);
    });
  }, [people, sort]);

  /* PM 的季度项目分值(现算,不落库)。不随业务筛选:级别区间看的是这个人整个季度的分 */
  const qPts = useMemo(() => {
    const m: Record<string, number> = {};
    rows.filter((r) => r.role === 'pm').forEach((r) => { m[r.name] = pointsIn(projects, r.name, quarter, rulesFor); });
    return m;
  }, [rows, projects, quarter, rulesFor]);

  const open = rows.find((r) => r.name === openName) || null;
  const word = pk === 'month' ? t('本月', 'This month') : pk === 'quarter' ? t('本季', 'This quarter') : pk === 'year' ? t('本年', 'This year') : t('本期', 'This period');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel" style={{ padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>{t('周期', 'Period')}</span>
        {([['month', t('本月', 'This month')], ['quarter', t('本季', 'This quarter')], ['year', t('本年', 'This year')], ['custom', t('自定义', 'Custom')]] as [PeriodKey, string][])
          .map(([k, label]) => (
            <button key={k} className="btn-line sm" data-testid={`kpi-period-${k}`} style={pk === k ? { borderColor: 'var(--navy900)', color: 'var(--navy900)', fontWeight: 700 } : undefined}
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
          {Object.keys(ROLE_LABEL).filter((k) => k !== 'viewer').map((k) => <option key={k} value={k}>{roleTerm(k, lang)}</option>)}
        </select>
        <select className="in sm" style={{ width: 'auto' }} value={svc} onChange={(e) => setSvc(e.target.value)}
          title={t('按业务筛选,同时会套用这个业务自己的 KPI 规则', 'Filters by service and applies that service’s own rule set')}>
          <option value="">{t('全部业务', 'All services')}</option>
          {Object.keys(SVC).map((k) => <option key={k} value={k}>{lang === 'zh' ? SVC[k].label : SVC[k].en}</option>)}
        </select>
      </div>

      <Cards cards={cards} rules={rules} word={word} />

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

      {open && <Detail p={open} rules={rules} onClose={() => setOpenName(null)} svc={svc} />}

      {rows.length === 0 ? (
        <div className="panel" style={{ padding: 34, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
          {t('本期没有可统计的项目 —— 换个周期,或先把项目的交付日 / 排期完成情况填上。',
             'No projects in this period — try another period, or fill in delivery dates and schedule progress first.')}
        </div>
      ) : (
        <div className="panel clip" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }} data-testid="kpi-table">
            <thead>
              <tr>
                <th style={{ ...th, width: 170 }}>{t('成员', 'Member')}</th>
                <th style={{ ...th, width: 160 }}>{t('级别', 'Level')}</th>
                <th style={{ ...th, width: 200 }}>
                  {t('本季度项目分值 / 级别区间', 'Quarter project score / level range')}
                  <span style={{ display: 'block', fontWeight: 400 }}>{quarter.label}</span>
                </th>
                {DIMENSIONS.map(([d, zh, en]) => (
                  <th key={d} style={{ ...th, cursor: 'pointer' }} onClick={() => setSort(d)} title={t('点击按这一维排序', 'Sort by this dimension')}>
                    {lang === 'zh' ? zh : en}{sort === d ? ' ↓' : ''}
                  </th>
                ))}
                <th style={{ ...th, width: 120, cursor: 'pointer' }} onClick={() => setSort('total')}>
                  {t('加权总分', 'Weighted total')}{sort === 'total' ? ' ↓' : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} data-testid="kpi-row" data-name={r.name} style={{ cursor: 'pointer', background: openName === r.name ? 'var(--hover-bg)' : undefined }}
                  onClick={() => setOpenName(openName === r.name ? null : r.name)}>
                  <td style={cell}>
                    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                      <Avatar name={r.name} size={26} />
                      <span>
                        <span style={{ fontWeight: 600 }}>{r.name}</span>
                        <span style={{ display: 'block', fontSize: 11, color: 'var(--text2)' }}>
                          {roleTerm(r.role, lang)} · {r.projects.length} {t('个项目', 'projects')}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td style={cell} onClick={(e) => e.stopPropagation()}>
                    {r.role !== 'pm' ? <span style={{ color: 'var(--text2)' }}>—</span>
                      : admin ? (
                        <select className="in sm" style={{ width: 'auto', maxWidth: 160 }} data-testid="kpi-level" value={levels[r.name] || ''} onChange={(e) => setLevel(r.name, e.target.value)}>
                          <option value="">{t('未设级别', 'Not set')}</option>
                          {PM_LEVEL_ORDER.map((l) => <option key={l} value={l}>{PM_LEVEL_NAME[l]}</option>)}
                        </select>
                      ) : <span>{levels[r.name] ? PM_LEVEL_NAME[levels[r.name] as keyof typeof PM_LEVEL_NAME] : t('未设级别', 'Not set')}</span>}
                  </td>
                  <td style={cell} data-testid="kpi-band">
                    {r.role !== 'pm' ? <span style={{ color: 'var(--text2)' }}>—</span>
                      : <BandBar bands={rules.bands} level={levels[r.name] || ''} pts={qPts[r.name] ?? 0} />}
                  </td>
                  {DIMENSIONS.map(([d]) => (
                    <td key={d} style={{ ...cell, whiteSpace: 'nowrap' }}>
                      {NEW_DIMS_063.includes(d) ? <NewDimCell r={r} d={d} /> : (
                        <>
                          <span className="tnum" style={{ fontWeight: 600, color: scoreColor(r.scores[d]) }}>
                            {r.scores[d] == null ? '—' : r.scores[d]}
                          </span>
                          {/* REQ-063:多了几列,原始值换到分数下面一行(数字不变) */}
                          <span style={{ display: 'block', fontSize: 11, color: 'var(--text2)' }}>{rawText(r, d, lang, t)}</span>
                        </>
                      )}
                    </td>
                  ))}
                  <td style={cell}>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ flex: 1 }}><ProgressBar pct={r.total ?? 0} showPct={false} /></span>
                      <span className="tnum" data-testid="kpi-total" style={{ fontSize: 15, fontWeight: 700, color: scoreColor(r.total) }}>{r.total ?? '—'}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <BandTable bands={rules.bands} />
      <div style={{ fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.75, padding: '0 4px' }}>
        {t('· 项目分值 = 这个人在所选周期所在那个季度的积分(REQ-038 积分规则),现算不存档;不随业务筛选。级别由 PD / BD 设(上表下拉,或在「新人培训 · 能力矩阵」里),系统只提示,不自动晋级。',
           '· Project score = the person’s points for the quarter containing the selected period (REQ-038 rules), computed live and not stored; not filtered by service. Levels are set by PD / BD (dropdown above, or Training · Competency matrix); the system only hints — no automatic promotion.')}
        <br />
        {t('· 平均修改轮数越低越好;修改费回收率 = 客户已确认收费的轮数 ÷ 应收费的轮数(PD 批准免收的算没收回)。两个新维度默认不计入加权总分,PD / BD 在「规则设置 · KPI 规则」里打开并分配权重后才算。',
           '· Fewer revision rounds is better; fee recovery = rounds the client confirmed ÷ chargeable rounds (waived counts as not recovered). The two new dimensions are off by default — PD / BD turn them on and weight them in Rules · KPI rules.')}
      </div>
    </div>
  );
}

/* ===== REQ-063 ① 每月看 3 个数 ===== */
function Cards({ cards, rules, word }: { cards: ReturnType<typeof companyCards>; rules: KpiRules; word: string }) {
  const { t } = useLang();
  const tg = rules.targets;
  const ok = (v: number | null, good: boolean) => (v == null ? 'var(--text2)' : good ? 'var(--success)' : 'var(--danger)');
  const c = cards;
  const items: { key: string; title: string; value: string; color: string; sub: string; target: string }[] = [
    {
      key: 'onTime', title: t('按时交付率', 'On-time delivery'),
      value: c.onTime.pct == null ? '—' : `${c.onTime.pct}%`, color: ok(c.onTime.pct, (c.onTime.pct ?? 0) >= tg.onTime),
      sub: c.onTime.all ? t(`${word}完工 ${c.onTime.all} 个,${c.onTime.hit} 个准时`, `${word}: ${c.onTime.all} finished, ${c.onTime.hit} on time`) : t(`${word}没有完工(有交付日)的项目`, `${word}: no finished project with a delivery date`),
      target: t(`目标 ≥ ${tg.onTime}%`, `Target ≥ ${tg.onTime}%`),
    },
    {
      key: 'rounds', title: t('平均修改轮数', 'Avg revision rounds'),
      value: c.rounds.avg == null ? '—' : t(`${c.rounds.avg.toFixed(1)} 轮`, `${c.rounds.avg.toFixed(1)}`), color: ok(c.rounds.avg, (c.rounds.avg ?? 0) <= tg.rounds),
      sub: c.rounds.pkgs ? t(`${word}完工项目的 ${c.rounds.pkgs} 个服务包,客户修改共 ${c.rounds.sum} 轮`, `${word}: ${c.rounds.pkgs} services of finished projects, ${c.rounds.sum} client rounds`) : t(`${word}没有可统计的服务包`, `${word}: no service to count`),
      target: t(`目标 ≤ ${tg.rounds} 轮`, `Target ≤ ${tg.rounds}`),
    },
    {
      key: 'recover', title: t('修改费回收率', 'Revision fee recovery'),
      value: c.recover.pct == null ? t('没有应收费的', 'None chargeable') : `${c.recover.pct}%`, color: ok(c.recover.pct, (c.recover.pct ?? 0) >= tg.recover),
      sub: c.recover.total ? feeLine(c.recover, word, t) : t(`${word}没有应收费的轮`, `${word}: no chargeable round`),
      target: t(`目标 ≥ ${tg.recover}%`, `Target ≥ ${tg.recover}%`),
    },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
      {items.map((x) => (
        <div key={x.key} className="panel" data-testid={`kpi-card-${x.key}`} style={{ padding: '12px 16px' }}>
          <div style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 600 }}>{x.title} <span style={{ fontWeight: 400 }}>· {t('全公司', 'company-wide')}</span></div>
          <div className="tnum" data-testid="kpi-card-value" style={{ fontSize: 26, fontWeight: 700, color: x.color, margin: '4px 0' }}>{x.value}</div>
          <div data-testid="kpi-card-sub" style={{ fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.6 }}>{x.sub}<br />{x.target}</div>
        </div>
      ))}
    </div>
  );
}
function feeLine(f: FeeCount, word: string, t: (zh: string, en: string) => string): string {
  const parts: [number, string, string][] = [[f.confirmed, '已确认', 'confirmed'], [f.quoted, '已出报价', 'quoted'], [f.due, '待报价', 'awaiting quote'], [f.waived, '免收', 'waived']];
  const shown = parts.filter((x) => x[0] > 0);
  return t(`${word}应收费 ${f.total} 轮:${shown.map((x) => `${x[1]} ${x[0]}`).join(' · ')}`, `${word}: ${f.total} chargeable — ${shown.map((x) => `${x[0]} ${x[2]}`).join(' · ')}`);
}

/* ===== REQ-063 ② 季度项目分值 / 级别区间横条 ===== */
const BAND_COLOR: Record<BandState, string> = { below: 'var(--danger)', in: 'var(--success)', inNext: '#2c5aa0', above: '#2c5aa0', none: 'var(--text2)' };
function BandBar({ bands, level, pts }: { bands: LevelBands; level: string; pts: number }) {
  const { lang, t } = useLang();
  if (!level) {
    return <span data-testid="kpi-band-text" data-state="unset" style={{ fontSize: 12, color: 'var(--text2)' }}><b className="tnum" style={{ color: 'var(--text)' }}>{pts}</b> · {t('未设级别', 'Level not set')}</span>;
  }
  const b = bandOf(bands, level, pts);
  const maxHi = Math.max(...PM_LEVEL_ORDER.map((l) => bands[l]?.hi || 0));
  const scale = Math.max(130, maxHi * 1.1, pts * 1.05);
  const color = BAND_COLOR[b.state];
  const text = lang === 'zh' ? BAND_TEXT[b.state][0] : BAND_TEXT[b.state][1];
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b className="tnum" data-testid="kpi-qpts" style={{ width: 34 }}>{pts}</b>
        <div style={{ position: 'relative', height: 10, background: '#eee', borderRadius: 5, flex: 1 }}>
          {b.lo != null && b.hi != null && (
            <div style={{ position: 'absolute', left: `${(b.lo / scale) * 100}%`, width: `${((b.hi - b.lo) / scale) * 100}%`, top: 0, bottom: 0, background: '#cfe3d6', borderRadius: 5 }}
              title={t(`级别区间 ${b.lo} – ${b.hi}`, `Level range ${b.lo} – ${b.hi}`)} />
          )}
          <div style={{ position: 'absolute', left: `calc(${(Math.min(pts, scale) / scale) * 100}% - 2px)`, top: -3, width: 4, height: 16, background: color, borderRadius: 2 }} />
        </div>
      </div>
      <div data-testid="kpi-band-text" data-state={b.state} style={{ fontSize: 11.5, color, marginTop: 3 }}>
        {b.lo == null ? text : `${b.lo} – ${b.hi} · ${text}`}
      </div>
    </div>
  );
}

/* 级别区间说明(只读;规则设置里改) */
const LEVEL_CAN: Record<string, [string, string]> = {
  coord: ['效果图 < 10 张 · 动画 < 2 分钟 · 简单实体模型 · 简单 Sales Kit / VR', 'Renderings < 10 · animation < 2 min · simple physical models · simple Sales Kit / VR'],
  pm: ['效果图会上调相机、给角度建议 · 所有动画 · 所有实体模型 · 全 3D Sales Kit · VR / AR · 完整硬件项目', 'Adjusts cameras and suggests angles · all animation · all physical models · full 3D Sales Kit · VR / AR · complete hardware projects'],
  senior: ['掌控会议节奏 · 带新人 · 全套项目 · 开发业务', 'Runs meetings · mentors new joiners · full projects · business development'],
  director: ['带团队 · 开发业务 · 创新', 'Leads the team · business development · innovation'],
};
function BandTable({ bands }: { bands: LevelBands }) {
  const { lang, t } = useLang();
  return (
    <div className="panel clip" data-testid="kpi-band-table">
      <div className="panel-head"><span className="panel-title">{t('级别区间(规则设置里可改)', 'Level ranges (editable in KPI rules)')}</span></div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: 200 }}>{t('级别', 'Level')}</th>
            <th style={{ ...th, width: 170 }}>{t('每季度项目分值', 'Project score per quarter')}</th>
            <th style={th}>{t('能独立做的(流程地图 G)', 'Can do independently (process map G)')}</th>
          </tr>
        </thead>
        <tbody>
          {PM_LEVEL_ORDER.map((l) => (
            <tr key={l}>
              <td style={cell}>{PM_LEVEL_NAME[l]}</td>
              <td style={cell} className="tnum">{bands[l] ? `${bands[l]!.lo} – ${bands[l]!.hi}` : t('不设', 'none')}</td>
              <td style={{ ...cell, color: 'var(--text2)', fontSize: 12 }}>{lang === 'zh' ? LEVEL_CAN[l][0] : LEVEL_CAN[l][1]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ===== REQ-063 ③ 两个新维度的格子:原始值为主(默认不计分),计分时旁边带分数 ===== */
function NewDimCell({ r, d }: { r: PersonKpi; d: Dimension }) {
  const { t } = useLang();
  const s = r.scores[d];
  const score = s == null ? null : <span className="tnum" style={{ display: 'block', fontSize: 11, color: scoreColor(s) }}>({s} {t('分', 'pts')})</span>;
  if (d === 'revRounds') {
    const v = r.raw.revRounds;
    if (v == null) return <span style={{ color: 'var(--text2)' }} title={t('本期没有完工的有效服务包', 'No counted service finished this period')}>—</span>;
    return <span data-testid="kpi-revRounds"><b className="tnum" style={{ color: v > 3 ? 'var(--danger)' : undefined }}>{v}</b> {t('轮', 'rds')}{score}</span>;
  }
  const v = r.raw.revRecover;
  if (v == null) return <span data-testid="kpi-revRecover" style={{ fontSize: 11.5, color: 'var(--text2)' }}>{t('没有应收费的', 'None chargeable')}</span>;
  return <span data-testid="kpi-revRecover"><b className="tnum" style={{ color: v < 60 ? 'var(--danger)' : undefined }}>{v}%</b>{score}</span>;
}

/* 某人的各维明细 —— 每一维怎么来的、由哪些项目算出来的 */
function Detail({ p, rules, onClose, svc }: { p: PersonKpi; rules: KpiRules; onClose: () => void; svc: string }) {
  const { rulesFor, openProject } = useStore();
  const { lang, t } = useLang();
  const set = ruleSetFor(rules, p.role, svc);
  const ws = weightSum(set);

  return (
    <div className="panel clip" data-testid="kpi-detail">
      <div className="panel-head" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Avatar name={p.name} size={26} />
        <span className="panel-title">{p.name} · {t('各维明细', 'Breakdown')}</span>
        <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>
          {t(`用的是「${set.role ? roleTerm(set.role, 'zh') : '不限角色'} / ${set.svc ? SVC[set.svc]?.label : '不限业务'}」那套规则,权重合计 ${ws}%`,
             `Rule set: ${set.role || 'any role'} / ${set.svc || 'any service'}, weights total ${ws}%`)}
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn-line sm" onClick={onClose}>{t('收起', 'Close')}</button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: '20%' }}>{t('维度', 'Dimension')}</th>
            <th style={{ ...th, width: '22%' }}>{t('原始值', 'Raw')}</th>
            <th style={{ ...th, width: '28%' }}>{t('怎么折成分数', 'How it scores')}</th>
            <th style={{ ...th, width: 90 }}>{t('得分', 'Score')}</th>
            <th style={{ ...th, width: 90 }}>{t('权重', 'Weight')}</th>
          </tr>
        </thead>
        <tbody>
          {DIMENSIONS.map(([d, zh, en]) => {
            const r = set.dims[d];
            const s = p.scores[d];
            if (!r) return null;
            return (
              <tr key={d} style={{ opacity: r.on ? 1 : 0.45 }}>
                <td style={cell}>{lang === 'zh' ? zh : en}{!r.on && <span style={{ color: 'var(--text2)' }}> ({t('未计入', 'off')})</span>}</td>
                <td style={cell}><b className="tnum">{rawFull(p, d, lang, t)}</b></td>
                <td style={{ ...cell, color: 'var(--text2)', fontSize: 12 }}>{modeText(r, lang, LOWER_BETTER.has(d))}</td>
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
              const rounds = (pr.packages || []).reduce((a, pk) => a + clientRounds(pk), 0);
              return (
                <tr key={pr.id}>
                  <td style={{ ...cell, width: '30%' }}>
                    <button style={{ color: 'var(--info)', textAlign: 'left' }} onClick={() => openProject(pr.id)}>
                      {pr.name}
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
                  <td style={{ ...cell, width: 110, fontSize: 12, color: 'var(--text2)' }}>{t(`修改 ${rounds} 轮`, `${rounds} rev. rounds`)}</td>
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
  if (d === 'revRounds') {
    return p.raw.revRounds == null
      ? t('本期没有完工的有效服务包', 'no counted service finished this period')
      : t(`${p.raw.revRounds} 轮(${p.detail.revPkgs} 个服务包共 ${p.detail.revSum} 轮)`, `${p.raw.revRounds} (${p.detail.revSum} rounds / ${p.detail.revPkgs} services)`);
  }
  if (d === 'revRecover') {
    return p.raw.revRecover == null
      ? t('没有应收费的', 'none chargeable')
      : `${p.raw.revRecover}% (${p.detail.fee.confirmed}/${p.detail.fee.total})`;
  }
  return p.raw.quality == null
    ? t('本期没有提交过完工审批', 'no completion review this period')
    : `${p.raw.quality}% (${p.detail.qualityHit}/${p.detail.qualityAll})`;
}

function modeText(r: { mode: string; target: number; floor: number; bands: { at: number; score: number }[] }, lang: 'zh' | 'en', lower = false): string {
  if (lower) {
    if (r.mode === 'threshold') return lang === 'zh' ? `不超过 ${r.target} 即 100 分,否则 0 分` : `≤ ${r.target} scores 100, else 0`;
    if (r.mode === 'banded') return [...r.bands].sort((a, b) => a.at - b.at).map((b) => `≤${b.at}→${b.score}`).join(' · ');
    return lang === 'zh' ? `${r.target} 及以下=100,${r.floor} 及以上=0,中间按比例(越低越好)` : `≤${r.target}=100, ≥${r.floor}=0, linear between (lower is better)`;
  }
  if (r.mode === 'threshold') return lang === 'zh' ? `达到 ${r.target} 即 100 分,否则 0 分` : `≥ ${r.target} scores 100, else 0`;
  if (r.mode === 'banded') return [...r.bands].sort((a, b) => b.at - a.at).map((b) => `≥${b.at}→${b.score}`).join(' · ');
  return lang === 'zh' ? `${r.floor} 分=0,${r.target} 分=100,中间按比例` : `${r.floor}=0, ${r.target}=100, linear between`;
}

const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontSize: 11.5, fontWeight: 700, color: 'var(--text2)', borderBottom: '1px solid var(--row-line)' };
const cell: React.CSSProperties = { padding: '10px 12px', fontSize: 12.5, borderTop: '1px solid var(--row-line)', verticalAlign: 'middle' };
