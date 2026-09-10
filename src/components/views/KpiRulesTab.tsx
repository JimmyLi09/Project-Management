'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { useLang } from '@/lib/i18n';
import { ROLE_LABEL } from '@/lib/permissions';
import { SVC } from '@/lib/templates';
import type { Role } from '@/lib/types';
import {
  DEFAULT_KPI_RULES, DIMENSIONS, SCORE_MODES, dimName, weightSum,
  type Dimension, type DimRule, type KpiRuleSet, type KpiRules,
} from '@/lib/kpi';

/* ===== REQ-037B: KPI 规则设置 =====
   一套规则 = 适用范围(角色 / 业务)+ 四个维度各自的 开关 / 权重 / 阈值 / 评分方式。
   「不限角色 / 不限业务」那一套是兜底,不能删。
   挑规则时按 角色+业务 > 业务 > 角色 > 默认,所以给某个业务单配一套,
   就只影响那个业务,别的照走默认。
   保存写新版本 + 生效日,老版本留着 —— 和积分规则同一套做法。 */
export default function KpiRulesTab() {
  const { me, kpiRules, kpiRuleVersions, refreshKpiRules, setToast } = useStore();
  const { lang, t } = useLang();
  const isAdmin = me.role === 'director' || me.role === 'bd';

  const [draft, setDraft] = useState<KpiRules>(() => clone(kpiRules));
  const [eff, setEff] = useState(() => new Date().toISOString().slice(0, 10));
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
          {t('四个维度的原始值都从平台已有数据算出来,不需要人工录入;这里定的是「原始值怎么折成分数」和「各占多少权重」。',
             'All four raw metrics come from data the platform already has; these rules decide how a raw value becomes a score and how the four are weighted.')}
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
                  : `${s.role ? ROLE_LABEL[s.role as Role] || s.role : t('不限角色', 'any role')} · ${s.svc ? (lang === 'zh' ? SVC[s.svc]?.label : SVC[s.svc]?.en) || s.svc : t('不限业务', 'any service')}`}
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
                  return (
                    <tr key={d} style={{ opacity: r.on ? 1 : 0.5 }}>
                      <td style={cell}>
                        <div style={{ fontWeight: 600 }}>{lang === 'zh' ? zh : en}</div>
                        <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{desc}</div>
                      </td>
                      <td style={cell}>
                        <input type="checkbox" checked={r.on} disabled={!isAdmin} onChange={(e) => patchDim(si, d, { on: e.target.checked })} />
                      </td>
                      <td style={cell}>
                        <input className="in sm" type="number" min={0} max={100} style={{ width: 74 }} disabled={!isAdmin || !r.on}
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
                            {t('达到', '≥')}
                            <input className="in sm" type="number" style={{ width: 84 }} disabled={!isAdmin || !r.on}
                              defaultValue={r.target} onBlur={(e) => patchDim(si, d, { target: Number(e.target.value) || 0 })} />
                            {t('即满分,否则 0 分', 'scores 100, else 0')}
                          </span>
                        )}
                        {r.mode === 'linear' && (
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
                                {t('达到', '≥')}
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

      {isAdmin && <AddSet existing={draft.sets} onAdd={(role, svc) => {
        setDraft((x) => ({ ...x, sets: [...x.sets, { role, svc, dims: clone(x.sets.find((s) => !s.role && !s.svc)!.dims) }] }));
        setSeed((n) => n + 1);
      }} />}

      {isAdmin && (
        <div className="panel" style={{ padding: '12px 18px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', position: 'sticky', bottom: 0, zIndex: 5 }}>
          <span style={{ fontSize: 12.5 }}>{t('生效日', 'Effective from')}
            <input className="in sm" type="date" style={{ width: 152, marginLeft: 8 }} value={eff} onChange={(e) => setEff(e.target.value)} />
          </span>
          <input className="in sm" style={{ flex: 1, minWidth: 180 }} value={note} maxLength={200}
            placeholder={t('这版改了什么(可空)', 'What changed (optional)')} onChange={(e) => setNote(e.target.value)} />
          <button className="btn-line sm" disabled={busy}
            onClick={() => { if (confirm(t('把草稿恢复成出厂默认?还没保存,不影响已有版本。', 'Reset the draft to the built-in defaults?'))) { setDraft(clone(DEFAULT_KPI_RULES)); setSeed((s) => s + 1); } }}>
            ↺ {t('恢复出厂值', 'Reset')}
          </button>
          <button className="btn-line sm" disabled={busy || !dirty} onClick={() => { setDraft(clone(kpiRules)); setSeed((s) => s + 1); }}>{t('放弃修改', 'Discard')}</button>
          <button className="btn-navy sm" disabled={busy || !dirty} onClick={save}>{busy ? t('保存中…', 'Saving…') : t('存为新版本', 'Save as new version')}</button>
        </div>
      )}
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
        {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
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
const clone = <X,>(x: X): X => JSON.parse(JSON.stringify(x)) as X;
