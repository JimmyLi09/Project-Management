'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { useLang } from '@/lib/i18n';
import { ROLE_LABEL } from '@/lib/permissions';
import { roleTerm } from '@/lib/terms';
import { SVC } from '@/lib/templates';
import type { Role } from '@/lib/types';
import {
  DEFAULT_KPI_RULES, DIMENSIONS, LOWER_BETTER, NEW_DIMS_063, PM_LEVEL_NAME, PM_LEVEL_ORDER, SCORE_MODES, dimName, weightSum,
  type Dimension, type DimRule, type KpiRuleSet, type KpiRules, type PmLevelKey,
} from '@/lib/kpi';
import type { CardTargets, RevRules } from '@/lib/revisions';
import { localDay } from '@/lib/localDate';

/* ===== REQ-037B: KPI 规则设置 =====
   一套规则 = 适用范围(角色 / 业务)+ 四个维度各自的 开关 / 权重 / 阈值 / 评分方式。
   「不限角色 / 不限业务」那一套是兜底,不能删。
   挑规则时按 角色+业务 > 业务 > 角色 > 默认,所以给某个业务单配一套,
   就只影响那个业务,别的照走默认。
   保存写新版本 + 生效日,老版本留着 —— 和积分规则同一套做法。 */
export default function KpiRulesTab() {
  const { me, kpiRules, kpiRuleVersions, refreshKpiRules, setToast, since063 } = useStore();
  const { lang, t } = useLang();
  const isAdmin = me.role === 'director' || me.role === 'bd';

  const [draft, setDraft] = useState<KpiRules>(() => clone(kpiRules));
  const [eff, setEff] = useState(() => localDay());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [seed, setSeed] = useState(0);

  React.useEffect(() => { setDraft(clone(kpiRules)); }, [kpiRules]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(kpiRules), [draft, kpiRules]);

  const patchDim = (si: number, d: Dimension, up: Partial<DimRule>) =>
    setDraft((x) => ({
      ...x,
      sets: x.sets.map((s, k) => (k === si ? { ...s, dims: { ...s.dims, [d]: { ...s.dims[d], ...up } } } : s)),
    }));

  async function save() {
    setBusy(true);
    const r = await fetch('/api/kpi-rules', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: draft, effectiveFrom: eff, note }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setToast(j.error || t('保存失败', 'Save failed')); return; }
    await refreshKpiRules();
    setNote('');
    setToast(t(`已存为第 ${j.version} 版 — ${eff} 起生效`, `Saved as version ${j.version}, effective ${eff}`));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel" style={{ padding: '14px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="panel-title" style={{ fontSize: 15 }}>{t('KPI 规则', 'KPI rules')}</span>
          <span className="badge" style={{ background: 'var(--hover-bg)', color: 'var(--text2)' }}>
            {kpiRuleVersions.length
              ? t(`当前第 ${kpiRuleVersions[kpiRuleVersions.length - 1].version} 版`, `v${kpiRuleVersions[kpiRuleVersions.length - 1].version}`)
              : t('出厂默认(还没存过)', 'built-in default (never saved)')}
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn-line sm" onClick={() => setHistOpen(!histOpen)}>{t('版本历史', 'History')} ({kpiRuleVersions.length})</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8, lineHeight: 1.7 }}>
          {t('各维度的原始值都从平台已有数据算出来,不需要人工录入;这里定的是「原始值怎么折成分数」和「各占多少权重」。',
             'All raw metrics come from data the platform already has; these rules decide how a raw value becomes a score and how the dimensions are weighted.')}
          <br />
          {t('「平均修改轮数」「修改费回收率」(REQ-063)默认不计入总分;打开并分配权重、存为新版本后,从生效日起的周期才按新规则算。',
             '“Avg revision rounds” and “Revision fee recovery” (REQ-063) are off by default; turn them on, give them a weight and save a new version — periods from its effective date use it.')}
          <br />
          {t('挑规则的顺序:角色+业务 > 业务 > 角色 > 默认。给某个业务单配一套,就只影响那个业务。',
             'Most specific wins: role+service > service > role > default.')}
          {!isAdmin && <><br /><b>{t('只有总监 / BD 能改这里,你现在是只读。', 'Read-only — only the director / BD can change these rules.')}</b></>}
        </div>
      </div>

      {histOpen && (
        <div className="panel clip">
          <div className="panel-head"><span className="panel-title">{t('版本历史', 'Version history')}</span></div>
          {kpiRuleVersions.length === 0 && (
            <div style={{ padding: 18, fontSize: 12.5, color: 'var(--text2)' }}>{t('还没保存过任何版本 —— 现在用的是出厂默认。', 'No version saved yet.')}</div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {[...kpiRuleVersions].reverse().map((v) => (
                <tr key={v.version}>
                  <td style={cell}><b>v{v.version}</b></td>
                  <td style={cell}>{t('生效日', 'Effective')} {v.effectiveFrom || '—'}</td>
                  <td style={cell}>{v.createdBy} · {new Date(v.createdAt).toLocaleDateString()}</td>
                  <td style={{ ...cell, color: 'var(--text2)' }}>{v.note || '—'}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>
                    <button className="btn-line sm" onClick={() => { setDraft(clone(v.rules)); setSeed((s) => s + 1); setToast(t(`已载入 v${v.version} 作为草稿`, `Loaded v${v.version} as a draft`)); }}>
                      {t('载入为草稿', 'Load as draft')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft.sets.map((s, si) => {
        const isDefault = !s.role && !s.svc;
        const ws = weightSum(s);
        return (
          <div key={`${s.role}|${s.svc}|${seed}`} className="panel clip">
            <div className="panel-head" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className="panel-title">
                {isDefault
                  ? t('默认规则(其他都没配到时走这套)', 'Default (fallback for everything else)')
                  : `${s.role ? roleTerm(s.role, lang) : t('不限角色', 'any role')} · ${s.svc ? (lang === 'zh' ? SVC[s.svc]?.label : SVC[s.svc]?.en) || s.svc : t('不限业务', 'any service')}`}
              </span>
              <span className="badge" style={{ background: ws === 100 ? '#e6f2ec' : '#fbf0dc', color: ws === 100 ? '#0f6a48' : '#a8690b' }}
                title={t('建议合计 100%,不强制 —— 不到 100% 时按实际权重归一', 'Suggested total is 100%; anything else is normalised by actual weights')}>
                {t('权重合计', 'Weights')} {ws}%
              </span>
              <div style={{ flex: 1 }} />
              {!isDefault && isAdmin && (
                <button className="btn-line sm danger" onClick={() => { setDraft((x) => ({ ...x, sets: x.sets.filter((_, k) => k !== si) })); setSeed((n) => n + 1); }}>✕</button>
              )}
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: '26%' }}>{t('维度', 'Dimension')}</th>
                  <th style={{ ...th, width: 88 }}>{t('计入', 'On')}</th>
                  <th style={{ ...th, width: 96 }}>{t('权重 %', 'Weight %')}</th>
                  <th style={{ ...th, width: 128 }}>{t('评分方式', 'Scoring')}</th>
                  <th style={th}>{t('阈值', 'Thresholds')}</th>
                </tr>
              </thead>
              <tbody>
                {DIMENSIONS.map(([d, zh, en, desc]) => {
                  const r = s.dims[d];
                  if (!r) return null;
                  const lower = LOWER_BETTER.has(d);
                  return (
                    <tr key={d} style={{ opacity: r.on ? 1 : 0.5 }} data-testid={`rule-${si}-${d}`}>
                      <td style={cell}>
                        <div style={{ fontWeight: 600 }}>
                          {lang === 'zh' ? zh : en}
                          {NEW_DIMS_063.includes(d) && <span className="badge" style={{ marginLeft: 6, background: '#e8eff9', color: '#2c5aa0', fontSize: 10.5 }}>{t('新', 'New')}</span>}
                          {lower && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 400, color: 'var(--text2)' }}>{t('越低越好', 'lower is better')}</span>}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{lang === 'zh' ? desc : DESC_EN[d]}</div>
                      </td>
                      <td style={cell}>
                        <input type="checkbox" data-testid="rule-on" checked={r.on} disabled={!isAdmin} onChange={(e) => patchDim(si, d, { on: e.target.checked })} />
                      </td>
                      <td style={cell}>
                        <input className="in sm" type="number" min={0} max={100} style={{ width: 74 }} data-testid="rule-weight" disabled={!isAdmin || !r.on}
                          defaultValue={r.weight} onBlur={(e) => patchDim(si, d, { weight: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
                      </td>
                      <td style={cell}>
                        <select className="in sm" style={{ width: 'auto' }} disabled={!isAdmin || !r.on} value={r.mode}
                          onChange={(e) => patchDim(si, d, {
                            mode: e.target.value as DimRule['mode'],
                            bands: e.target.value === 'banded' && !r.bands.length
                              ? [{ at: r.target, score: 100 }, { at: r.floor, score: 60 }] : r.bands,
                          })}>
                          {SCORE_MODES.map((m) => <option key={m[0]} value={m[0]}>{lang === 'zh' ? m[1] : m[2]}</option>)}
                        </select>
                      </td>
                      <td style={cell}>
                        {r.mode === 'threshold' && (
                          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                            {lower ? t('不超过', '≤') : t('达到', '≥')}
                            <input className="in sm" type="number" style={{ width: 84 }} disabled={!isAdmin || !r.on}
                              defaultValue={r.target} onBlur={(e) => patchDim(si, d, { target: Number(e.target.value) || 0 })} />
                            {t('即满分,否则 0 分', 'scores 100, else 0')}
                          </span>
                        )}
                        {r.mode === 'linear' && lower && (
                          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, flexWrap: 'wrap' }}>
                            <input className="in sm" type="number" style={{ width: 78 }} disabled={!isAdmin || !r.on} data-testid="rule-target"
                              defaultValue={r.target} onBlur={(e) => patchDim(si, d, { target: Number(e.target.value) || 0 })} />
                            {t('及以下 = 100 分,', 'or less = 100 pts,')}
                            <input className="in sm" type="number" style={{ width: 78 }} disabled={!isAdmin || !r.on} data-testid="rule-floor"
                              defaultValue={r.floor} onBlur={(e) => patchDim(si, d, { floor: Number(e.target.value) || 0 })} />
                            {t('及以上 = 0 分,中间按比例', 'or more = 0 pts, linear between')}
                          </span>
                        )}
                        {r.mode === 'linear' && !lower && (
                          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, flexWrap: 'wrap' }}>
                            <input className="in sm" type="number" style={{ width: 78 }} disabled={!isAdmin || !r.on}
                              defaultValue={r.floor} onBlur={(e) => patchDim(si, d, { floor: Number(e.target.value) || 0 })} />
                            {t('分 = 0,', '= 0 pts,')}
                            <input className="in sm" type="number" style={{ width: 78 }} disabled={!isAdmin || !r.on}
                              defaultValue={r.target} onBlur={(e) => patchDim(si, d, { target: Number(e.target.value) || 0 })} />
                            {t('分 = 100,中间按比例', '= 100 pts, linear between')}
                          </span>
                        )}
                        {r.mode === 'banded' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                            {r.bands.map((b, bi) => (
                              <span key={bi} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                                {lower ? t('不超过', '≤') : t('达到', '≥')}
                                <input className="in sm" type="number" style={{ width: 74 }} disabled={!isAdmin || !r.on}
                                  defaultValue={b.at} onBlur={(e) => patchDim(si, d, { bands: r.bands.map((x, k) => (k === bi ? { ...x, at: Number(e.target.value) || 0 } : x)) })} />
                                {t('给', 'scores')}
                                <input className="in sm" type="number" min={0} max={100} style={{ width: 70 }} disabled={!isAdmin || !r.on}
                                  defaultValue={b.score} onBlur={(e) => patchDim(si, d, { bands: r.bands.map((x, k) => (k === bi ? { ...x, score: Number(e.target.value) || 0 } : x)) })} />
                                {t('分', 'pts')}
                                {isAdmin && r.bands.length > 1 && (
                                  <button className="btn-line sm danger" onClick={() => patchDim(si, d, { bands: r.bands.filter((_, k) => k !== bi) })}>✕</button>
                                )}
                              </span>
                            ))}
                            {isAdmin && r.bands.length < 10 && (
                              <button className="btn-line sm" style={{ alignSelf: 'flex-start', borderStyle: 'dashed' }}
                                onClick={() => patchDim(si, d, { bands: [...r.bands, { at: 0, score: 0 }] })}>＋ {t('加一段', 'Add band')}</button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      <Rev063 key={`r063-${seed}`} draft={draft} setDraft={setDraft} isAdmin={isAdmin} since={since063} onSince={refreshKpiRules} />

      {isAdmin && <AddSet existing={draft.sets} onAdd={(role, svc) => {
        setDraft((x) => ({ ...x, sets: [...x.sets, { role, svc, dims: clone(x.sets.find((s) => !s.role && !s.svc)!.dims) }] }));
        setSeed((n) => n + 1);
      }} />}

      {isAdmin && (
        <div className="panel" style={{ padding: '12px 18px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', position: 'sticky', bottom: 0, zIndex: 5 }}>
          <span style={{ fontSize: 12.5 }}>{t('生效日', 'Effective from')}
            <input className="in sm" type="date" data-testid="kpi-rules-eff" style={{ width: 152, marginLeft: 8 }} value={eff} onChange={(e) => setEff(e.target.value)} />
          </span>
          <input className="in sm" style={{ flex: 1, minWidth: 180 }} value={note} maxLength={200}
            placeholder={t('这版改了什么(可空)', 'What changed (optional)')} onChange={(e) => setNote(e.target.value)} />
          <button className="btn-line sm" disabled={busy}
            onClick={() => { if (confirm(t('把草稿恢复成出厂默认?还没保存,不影响已有版本。', 'Reset the draft to the built-in defaults?'))) { setDraft(clone(DEFAULT_KPI_RULES)); setSeed((s) => s + 1); } }}>
            ↺ {t('恢复出厂值', 'Reset')}
          </button>
          <button className="btn-line sm" disabled={busy || !dirty} onClick={() => { setDraft(clone(kpiRules)); setSeed((s) => s + 1); }}>{t('放弃修改', 'Discard')}</button>
          <button className="btn-navy sm" data-testid="kpi-rules-save" disabled={busy || !dirty} onClick={save}>{busy ? t('保存中…', 'Saving…') : t('存为新版本', 'Save as new version')}</button>
        </div>
      )}
    </div>
  );
}

/* ===== REQ-063:级别区间、修改轮次规则、三个数的目标(全公司一份,跟着规则版本走)+ 上线日 ===== */
function Rev063({ draft, setDraft, isAdmin, since, onSince }: {
  draft: KpiRules; setDraft: React.Dispatch<React.SetStateAction<KpiRules>>; isAdmin: boolean; since: string; onSince: () => Promise<void>;
}) {
  const { t } = useLang();
  const { setToast } = useStore();
  const [day, setDay] = useState(since);
  React.useEffect(() => { setDay(since); }, [since]);
  const setBand = (lv: PmLevelKey, v: { lo: number; hi: number } | null) => setDraft((x) => ({ ...x, bands: { ...x.bands, [lv]: v } }));
  const setRev = (k: keyof RevRules, v: number) => setDraft((x) => ({ ...x, rev: { ...x.rev, [k]: v } }));
  const setTg = (k: keyof CardTargets, v: number) => setDraft((x) => ({ ...x, targets: { ...x.targets, [k]: v } }));
  const n = (v: string) => Number(v) || 0;
  async function saveSince() {
    const r = await fetch('/api/kpi-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ since063: day }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setToast(`⚠ ${j.error || t('保存失败', 'Save failed')}`); return; }
    await onSince();
    setToast(t(`上线日改为 ${day}`, `Go-live date set to ${day}`));
  }
  const rv = draft.rev, tg = draft.targets;
  return (
    <div className="panel clip" data-testid="rules-063">
      <div className="panel-head"><span className="panel-title">{t('PM 级别区间 · 修改记录 · 每月看 3 个数', 'PM level ranges · Revisions · Three monthly numbers')}</span></div>
      <div style={{ padding: '12px 18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 18, fontSize: 12.5 }}>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{t('每季度项目分值区间', 'Project score range per quarter')}</div>
          {PM_LEVEL_ORDER.map((lv) => {
            const b = draft.bands[lv];
            return (
              <div key={lv} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                <span style={{ width: 150 }}>{PM_LEVEL_NAME[lv]}</span>
                {b ? (
                  <>
                    <input className="in sm" type="number" style={{ width: 70 }} disabled={!isAdmin} data-testid={`band-${lv}-lo`} defaultValue={b.lo} onBlur={(e) => setBand(lv, { lo: n(e.target.value), hi: b.hi })} />
                    –
                    <input className="in sm" type="number" style={{ width: 70 }} disabled={!isAdmin} data-testid={`band-${lv}-hi`} defaultValue={b.hi} onBlur={(e) => setBand(lv, { lo: b.lo, hi: n(e.target.value) })} />
                  </>
                ) : !isAdmin && <span style={{ color: 'var(--text2)' }}>{t('不设', 'none')}</span>}
                {isAdmin && (
                  <label style={{ fontSize: 11.5, color: 'var(--text2)', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                    <input type="checkbox" checked={!b} onChange={(e) => setBand(lv, e.target.checked ? null : { lo: 0, hi: 100 })} />{t('不设', 'none')}
                  </label>
                )}
              </div>
            );
          })}
          <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.6 }}>
            {t('只用来在看板上提示,系统不会自动改级别。', 'Used for hints on the board only — the system never changes anyone’s level.')}
          </div>
        </div>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{t('修改轮次', 'Revision rounds')}</div>
          {([['e5Round', '第几轮提醒发 E5 邮件', 'Round that triggers the E5 email'], ['chargeFrom', '第几轮起应收费', 'Chargeable from round'],
            ['reasonAt', '累计几轮提醒开原因会', 'Review meeting after rounds'], ['quoteHours', 'Sales 出报价时限(小时)', 'Sales quote deadline (hours)']] as [keyof RevRules, string, string][]).map(([k, zh, en]) => (
            <div key={k} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
              <span style={{ flex: 1 }}>{t(zh, en)}</span>
              <input className="in sm" type="number" min={1} style={{ width: 70 }} disabled={!isAdmin} data-testid={`rev-rule-${k}`} defaultValue={rv[k]} onBlur={(e) => setRev(k, Math.max(1, Math.round(n(e.target.value))))} />
            </div>
          ))}
          <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.6 }}>
            {t('改了之后,已出报价 / 已确认 / 免收的轮不动;其他的轮在这个服务包下次记 / 改 / 删修改时按新规则重排。',
               'Quoted / confirmed / waived rounds never change; other rounds are re-evaluated with the new numbers the next time that service’s revisions are edited.')}
          </div>
        </div>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{t('每月看 3 个数 · 目标', 'Three monthly numbers · targets')}</div>
          {([['onTime', '按时交付率 ≥ (%)', 'On-time delivery ≥ (%)'], ['rounds', '平均修改轮数 ≤ (轮)', 'Avg revision rounds ≤'], ['recover', '修改费回收率 ≥ (%)', 'Fee recovery ≥ (%)']] as [keyof CardTargets, string, string][]).map(([k, zh, en]) => (
            <div key={k} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
              <span style={{ flex: 1 }}>{t(zh, en)}</span>
              <input className="in sm" type="number" min={0} style={{ width: 70 }} disabled={!isAdmin} data-testid={`target-${k}`} defaultValue={tg[k]} onBlur={(e) => setTg(k, n(e.target.value))} />
            </div>
          ))}
          <div style={{ fontWeight: 700, margin: '12px 0 6px' }}>{t('修改记录上线日', 'Revisions go-live date')}</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="in sm" type="date" style={{ width: 150 }} disabled={!isAdmin} data-testid="since063" value={day} onChange={(e) => setDay(e.target.value)} />
            {isAdmin && <button className="btn-line sm" disabled={!day || day === since} onClick={saveSince}>{t('保存', 'Save')}</button>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.6, marginTop: 4 }}>
            {t('上线时自动记一次。平均修改轮数:这天(含)之后交接的项目 0 轮也算;之前交接的老项目要记过至少一轮才算。周期结束日在这天之后的,按周期结束那天生效的规则版本算。改这里立即生效,不是规则版本。',
               'Recorded automatically at go-live. Avg revision rounds: projects handed over on or after this date count even with 0 rounds; older projects count only once they have a round. Periods ending after this date use the rule version effective on their end date. Takes effect immediately; not versioned.')}
          </div>
        </div>
      </div>
    </div>
  );
}

function AddSet({ existing, onAdd }: { existing: KpiRuleSet[]; onAdd: (role: string, svc: string) => void }) {
  const { lang, t } = useLang();
  const [role, setRole] = useState('');
  const [svc, setSvc] = useState('');
  const dup = existing.some((s) => s.role === role && s.svc === svc);
  return (
    <div className="panel" style={{ padding: '12px 16px', borderStyle: 'dashed', display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--navy900)' }}>＋ {t('给某个角色 / 业务单配一套', 'Add a rule set')}</span>
      <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{t('不配的照走默认', 'anything not configured falls back to the default')}</span>
      <div style={{ flex: 1 }} />
      <select className="in sm" style={{ width: 'auto' }} value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="">{t('不限角色', 'Any role')}</option>
        {Object.keys(ROLE_LABEL).map((k) => <option key={k} value={k}>{roleTerm(k, lang)}</option>)}
      </select>
      <select className="in sm" style={{ width: 'auto' }} value={svc} onChange={(e) => setSvc(e.target.value)}>
        <option value="">{t('不限业务', 'Any service')}</option>
        {Object.keys(SVC).map((k) => <option key={k} value={k}>{lang === 'zh' ? SVC[k].label : SVC[k].en}</option>)}
      </select>
      <button className="btn-navy sm" disabled={(!role && !svc) || dup} onClick={() => { onAdd(role, svc); setRole(''); setSvc(''); }}
        title={dup ? t('这套范围已经配过了', 'Already configured') : undefined}>
        {t('加入', 'Add')}
      </button>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '9px 18px', fontSize: 11.5, fontWeight: 700, color: 'var(--text2)', borderBottom: '1px solid var(--row-line)' };
const cell: React.CSSProperties = { textAlign: 'left', padding: '9px 18px', fontSize: 12.5, borderTop: '1px solid var(--row-line)', verticalAlign: 'top' };
/* 维度说明的英文(中文在 lib/kpi.ts 的 DIMENSIONS 里) */
const DESC_EN: Record<Dimension, string> = {
  points: 'Sum of points (REQ-038 rules) of this period’s projects',
  onTime: 'Share of projects finished this period whose actual finish is on or before delivery (incl. buffer)',
  quality: 'Share of projects submitted for completion review that passed first time (not returned / no changes requested)',
  load: 'Number of projects handled this period',
  revRounds: 'Average client revision rounds per counted service of projects finished this period (lower is better)',
  revRecover: 'Share of chargeable rounds dated this period that the client confirmed (waived counts as not recovered)',
};
const clone = <X,>(x: X): X => JSON.parse(JSON.stringify(x)) as X;
