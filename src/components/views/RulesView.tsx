'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { useLang } from '@/lib/i18n';
import { SVC, svcColor } from '@/lib/templates';
import { registerDef, fieldsOf } from '@/lib/records';
import {
  DEFAULT_POINT_RULES, isRangeTier,
  type PointRule, type PointRules, type PointTier,
} from '@/lib/points';
import KpiRulesTab from './KpiRulesTab';

/* ===== REQ-038: 规则设置 · 积分规则 =====
   出厂值来自《项目积分算法》,但这里改的那一版才是准的。
   保存 = 写一个**新版本**(带生效日),老版本一律不动 —— 历史项目按它创建时
   生效的那一版计分,所以旧版本不能被覆盖掉。
   REQ-037 的 KPI 规则是本页第二个标签页。 */
export default function RulesView() {
  const { t } = useLang();
  const [tab, setTab] = useState<'points' | 'kpi'>('points');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="detail-tabs" style={{ borderTop: 'none' }}>
        <button className={`detail-tab${tab === 'points' ? ' active' : ''}`} onClick={() => setTab('points')}>{t('积分规则', 'Points rules')}</button>
        <button className={`detail-tab${tab === 'kpi' ? ' active' : ''}`} onClick={() => setTab('kpi')}>{t('KPI 规则', 'KPI rules')}</button>
      </div>
      {tab === 'points' ? <PointRulesTab /> : <KpiRulesTab />}
    </div>
  );
}

function PointRulesTab() {
  const { me, pointRuleVersions, pointRules, refreshPointRules, setToast } = useStore();
  const { lang, t } = useLang();
  const isAdmin = me.role === 'director' || me.role === 'bd';

  const [draft, setDraft] = useState<PointRules>(() => clone(pointRules));
  const [eff, setEff] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [seed, setSeed] = useState(0);   // 换基线(切版本 / 恢复默认)时强制重挂

  /* 服务器上那份规则变了(别人存了新版本)就把草稿拉回来 */
  React.useEffect(() => { setDraft(clone(pointRules)); }, [pointRules]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(pointRules), [draft, pointRules]);

  const patchSvc = (i: number, up: Partial<PointRule>) =>
    setDraft((d) => ({ ...d, services: d.services.map((s, k) => (k === i ? { ...s, ...up } : s)) }));
  const patchTier = (si: number, ti: number, up: Partial<PointTier>) =>
    setDraft((d) => ({
      ...d,
      services: d.services.map((s, k) => (k === si ? { ...s, tiers: s.tiers.map((x, j) => (j === ti ? { ...x, ...up } : x)) } : s)),
    }));

  async function save() {
    setBusy(true);
    const res = await fetch('/api/point-rules', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: draft, effectiveFrom: eff, note }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setToast(d.error || t('保存失败', 'Save failed')); return; }
    await refreshPointRules();
    setNote('');
    setToast(t(`已存为第 ${d.version} 版 — ${eff} 起生效`, `Saved as version ${d.version}, effective ${eff}`));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel" style={{ padding: '14px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="panel-title" style={{ fontSize: 15 }}>{t('积分规则', 'Points rules')}</span>
          <span className="badge" style={{ background: 'var(--hover-bg)', color: 'var(--text2)' }}>
            {pointRuleVersions.length
              ? t(`当前第 ${pointRuleVersions[pointRuleVersions.length - 1].version} 版`, `v${pointRuleVersions[pointRuleVersions.length - 1].version}`)
              : t('出厂默认(还没存过)', 'built-in default (never saved)')}
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn-line sm" onClick={() => setHistOpen(!histOpen)}>
            {t('版本历史', 'History')} ({pointRuleVersions.length})
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8, lineHeight: 1.7 }}>
          {t('出厂值来自《项目积分算法》。改动保存成新版本、带生效日,老版本留着 —— 历史项目按它创建时生效的那一版计分,所以改规则不会把过去的分算乱。',
             'Seeded from the studio points algorithm. Saving writes a NEW version with an effective date; old versions are kept, and each project is scored with the version in force when it was created.')}
          <br />
          {t('项目里那份业务能从资料卡读到「判档字段」的数,就自动落档;读不到、或落到区间档(如 LED 3–7)上,由 PM 在项目里选。',
             'A package is auto-tiered when its record has the metric field; otherwise (or for range tiers like LED 3–7) the PM picks in the project.')}
          {!isAdmin && <><br /><b>{t('只有总监 / BD 能改这里,你现在是只读。', 'Read-only — only the director / BD can change these rules.')}</b></>}
        </div>
      </div>

      {histOpen && (
        <div className="panel clip">
          <div className="panel-head"><span className="panel-title">{t('版本历史', 'Version history')}</span></div>
          {pointRuleVersions.length === 0 && (
            <div style={{ padding: 18, fontSize: 12.5, color: 'var(--text2)' }}>
              {t('还没保存过任何版本 —— 现在用的是出厂默认。', 'No version saved yet — the built-in default is in force.')}
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {[...pointRuleVersions].reverse().map((v) => (
                <tr key={v.version}>
                  <td style={cell}><b>v{v.version}</b></td>
                  <td style={cell}>{t('生效日', 'Effective')} {v.effectiveFrom || '—'}</td>
                  <td style={cell}>{v.createdBy} · {new Date(v.createdAt).toLocaleDateString()}</td>
                  <td style={{ ...cell, color: 'var(--text2)' }}>{v.note || '—'}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>
                    <button className="btn-line sm" onClick={() => { setDraft(clone(v.rules)); setSeed((s) => s + 1); setToast(t(`已载入 v${v.version} 作为草稿 —— 保存后会成为新的一版`, `Loaded v${v.version} as a draft — saving creates a new version`)); }}>
                      {t('载入为草稿', 'Load as draft')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft.services.map((s, si) => (
        <ServiceCard key={s.svc + ':' + seed} rule={s} lang={lang} readOnly={!isAdmin}
          onPatch={(up) => patchSvc(si, up)}
          onPatchTier={(ti, up) => patchTier(si, ti, up)}
          onRemoveTier={(ti) => patchSvc(si, { tiers: s.tiers.filter((_, k) => k !== ti) })}
          onAddTier={() => patchSvc(si, { tiers: [...s.tiers, { id: freshId(s), zh: t('新档位', 'New tier'), en: 'New tier', points: 1 }] })}
          onRemove={() => {
            if (!confirm(t(`删除业务「${s.zh}」的整套档位?`, `Remove all tiers for "${s.zh}"?`))) return;
            setDraft((d) => ({ ...d, services: d.services.filter((_, k) => k !== si) }));
            setSeed((x) => x + 1);
          }} />
      ))}

      {isAdmin && (
        <div className="panel" style={{ padding: '12px 16px', borderStyle: 'dashed' }}>
          <AddServiceRule existing={draft.services.map((s) => s.svc)}
            onAdd={(svc, zh, en) => {
              setDraft((d) => ({ ...d, services: [...d.services, { svc, zh, en, tiers: [{ id: svc + '1', zh: t('默认档', 'Default'), en: 'Default', points: 1 }] }] }));
              setSeed((x) => x + 1);
            }} />
        </div>
      )}

      {/* 附加规则 —— 《项目积分算法》里没有,用户确认默认关闭 */}
      <div className="panel" style={{ padding: '14px 18px' }}>
        <div className="panel-title" style={{ fontSize: 14, marginBottom: 6 }}>{t('附加规则(默认关闭)', 'Extra rules (off by default)')}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text2)', marginBottom: 10 }}>
          {t('《项目积分算法》里没有这两条,关着的时候完全不参与计算。', 'Neither is part of the studio points algorithm; while off they do not affect any score.')}
        </div>
        <label style={{ display: 'inline-flex', gap: 7, alignItems: 'center', fontSize: 12.5 }}>
          <input type="checkbox" disabled={!isAdmin} checked={draft.bonus.enabled}
            onChange={(e) => setDraft((d) => ({ ...d, bonus: { ...d.bonus, enabled: e.target.checked } }))} />
          {t('准时交付加成 / 逾期扣减', 'On-time bonus / late penalty')}
        </label>
        {draft.bonus.enabled && (
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 10, flexWrap: 'wrap', fontSize: 12.5 }}>
            <span>{t('准时 +', 'On time +')}
              <input className="in sm" type="number" min={0} max={100} step={0.5} style={{ width: 76, marginLeft: 6 }} disabled={!isAdmin}
                value={draft.bonus.onTime} onChange={(e) => setDraft((d) => ({ ...d, bonus: { ...d.bonus, onTime: Number(e.target.value) || 0 } }))} />
            </span>
            <span>{t('逾期 −', 'Late −')}
              <input className="in sm" type="number" min={0} max={100} step={0.5} style={{ width: 76, marginLeft: 6 }} disabled={!isAdmin}
                value={draft.bonus.late} onChange={(e) => setDraft((d) => ({ ...d, bonus: { ...d.bonus, late: Number(e.target.value) || 0 } }))} />
            </span>
          </div>
        )}
        <div style={{ marginTop: 12, fontSize: 12.5 }}>
          {t('积分归属', 'Attribution')}:
          <select className="in sm" style={{ width: 'auto', marginLeft: 8 }} disabled={!isAdmin} value={draft.attribution.mode}
            onChange={(e) => setDraft((d) => ({ ...d, attribution: { ...d.attribution, mode: e.target.value as 'pm' | 'split' } }))}>
            <option value="pm">{t('全归 PM(默认)', 'All to the PM (default)')}</option>
            <option value="split">{t('按角色分配', 'Split by role')}</option>
          </select>
          {draft.attribution.mode === 'split' && (
            <span style={{ marginLeft: 12, display: 'inline-flex', gap: 10, alignItems: 'center' }}>
              {(['pm', 'production', 'sales'] as const).map((k) => (
                <span key={k}>{k.toUpperCase()}
                  <input className="in sm" type="number" min={0} max={100} style={{ width: 68, marginLeft: 5 }} disabled={!isAdmin}
                    value={draft.attribution[k]}
                    onChange={(e) => setDraft((d) => ({ ...d, attribution: { ...d.attribution, [k]: Number(e.target.value) || 0 } }))} />%
                </span>
              ))}
            </span>
          )}
        </div>
      </div>

      {isAdmin && (
        <div className="panel" style={{ padding: '12px 18px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', position: 'sticky', bottom: 0, zIndex: 5 }}>
          <span style={{ fontSize: 12.5 }}>{t('生效日', 'Effective from')}
            <input className="in sm" type="date" style={{ width: 152, marginLeft: 8 }} value={eff} onChange={(e) => setEff(e.target.value)} />
          </span>
          <input className="in sm" style={{ flex: 1, minWidth: 200 }} value={note} maxLength={200}
            placeholder={t('这版改了什么(可空)', 'What changed in this version (optional)')}
            onChange={(e) => setNote(e.target.value)} />
          <button className="btn-line sm" disabled={busy}
            onClick={() => { if (confirm(t('把草稿恢复成出厂默认(《项目积分算法》)?还没保存,不影响已有版本。', 'Reset the draft to the built-in algorithm? Nothing is saved yet.'))) { setDraft(clone(DEFAULT_POINT_RULES)); setSeed((s) => s + 1); } }}>
            ↺ {t('恢复出厂值', 'Reset to built-in')}
          </button>
          <button className="btn-line sm" disabled={busy || !dirty} onClick={() => { setDraft(clone(pointRules)); setSeed((s) => s + 1); }}>
            {t('放弃修改', 'Discard')}
          </button>
          <button className="btn-navy sm" disabled={busy || !dirty} onClick={save}>
            {busy ? t('保存中…', 'Saving…') : t('存为新版本', 'Save as new version')}
          </button>
        </div>
      )}
    </div>
  );
}

function ServiceCard({ rule, lang, readOnly, onPatch, onPatchTier, onRemoveTier, onAddTier, onRemove }: {
  rule: PointRule; lang: 'zh' | 'en'; readOnly: boolean;
  onPatch: (up: Partial<PointRule>) => void;
  onPatchTier: (ti: number, up: Partial<PointTier>) => void;
  onRemoveTier: (ti: number) => void;
  onAddTier: () => void;
  onRemove: () => void;
}) {
  const { t } = useLang();
  const { recordFields } = useStore();
  /* 判档字段的候选:这个业务的资料卡里所有数字 / 公式列(REQ-023 同源) */
  const def = registerDef(rule.svc);
  const candidates = def
    ? fieldsOf(def, recordFields).filter((f) => f.type === 'number' || f.type === 'formula' || f.type === 'text')
    : [];

  return (
    <div className="panel clip">
      <div className="panel-head" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: svcColor(rule.svc) }} />
        <span className="panel-title">{lang === 'zh' ? rule.zh : rule.en}</span>
        <span style={{ fontSize: 11, color: 'var(--text2)' }}>{rule.svc}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{t('判档字段', 'Metric field')}</span>
        <select className="in sm" style={{ width: 'auto' }} disabled={readOnly} value={rule.metric?.field || ''}
          title={t('从这份业务的资料卡里读这个字段的数来自动落档;选「不自动判」就一律由 PM 选档。',
                   'Read this record field to auto-pick a tier; "manual only" always asks the PM.')}
          onChange={(e) => {
            const field = e.target.value;
            if (!field) { onPatch({ metric: undefined }); return; }
            const f = candidates.find((c) => c.key === field);
            onPatch({ metric: { field, zh: f?.zh || field, en: f?.en || field } });
          }}>
          <option value="">{t('不自动判(PM 选档)', 'Manual only (PM picks)')}</option>
          {candidates.map((f) => <option key={f.key} value={f.key}>{lang === 'zh' ? f.zh : f.en}</option>)}
          {/* 资料卡里没有这个字段(比如效果图的「张数」还没建列)也要显示得出来 */}
          {rule.metric?.field && !candidates.some((c) => c.key === rule.metric!.field) && (
            <option value={rule.metric.field}>{rule.metric.zh}（{t('资料卡里暂无此列', 'no such column yet')}）</option>
          )}
        </select>
        {!readOnly && <button className="btn-line sm danger" onClick={onRemove}>✕</button>}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...cell, width: '38%', color: 'var(--text2)', fontSize: 11.5 }}>{t('档位', 'Tier')}</th>
            <th style={{ ...cell, color: 'var(--text2)', fontSize: 11.5 }}>{t('分值', 'Points')}</th>
            <th style={{ ...cell, color: 'var(--text2)', fontSize: 11.5 }}>{t('自动落档条件', 'Auto-match')}</th>
            <th style={{ ...cell, width: 40 }} />
          </tr>
        </thead>
        <tbody>
          {rule.tiers.map((tr, ti) => (
            <tr key={tr.id}>
              <td style={cell}>
                <input className="in sm" disabled={readOnly} defaultValue={tr.zh} maxLength={80}
                  onBlur={(e) => onPatchTier(ti, { zh: e.target.value, en: tr.en || e.target.value })} />
              </td>
              <td style={cell}>
                {isRangeTier(tr) ? (
                  <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 12.5 }}>
                    <input className="in sm" type="number" step={0.5} min={0} style={{ width: 68 }} disabled={readOnly}
                      defaultValue={tr.min} onBlur={(e) => onPatchTier(ti, { min: Number(e.target.value) || 0 })} />
                    –
                    <input className="in sm" type="number" step={0.5} min={0} style={{ width: 68 }} disabled={readOnly}
                      defaultValue={tr.max} onBlur={(e) => onPatchTier(ti, { max: Number(e.target.value) || 0 })} />
                    <span className="badge" style={{ background: '#fbf0dc', color: '#a8690b' }}
                      title={t('区间档:区间内具体几分由 PM 在项目里选(用户确认的默认口径)', 'Range tier: the PM picks the exact value in the project')}>
                      {t('区间 · PM 选值', 'range · PM picks')}
                    </span>
                    {!readOnly && <button className="btn-line sm" title={t('改成固定分值', 'Make it a fixed value')}
                      onClick={() => onPatchTier(ti, { min: undefined, max: undefined, points: tr.min ?? 1 })}>→ {t('固定', 'fixed')}</button>}
                  </span>
                ) : (
                  <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    <input className="in sm" type="number" step={0.5} min={0} style={{ width: 84 }} disabled={readOnly}
                      defaultValue={tr.points} onBlur={(e) => onPatchTier(ti, { points: Number(e.target.value) || 0 })} />
                    {!readOnly && <button className="btn-line sm" title={t('改成区间档,由 PM 在区间内选值', 'Make it a range the PM picks from')}
                      onClick={() => onPatchTier(ti, { min: tr.points, max: tr.points + 2 })}>→ {t('区间', 'range')}</button>}
                  </span>
                )}
              </td>
              <td style={cell}>
                <MatchEditor tier={tr} readOnly={readOnly || !rule.metric} unit={rule.metric ? (lang === 'zh' ? rule.metric.zh : rule.metric.en) : ''}
                  onChange={(m) => onPatchTier(ti, { match: m })} />
              </td>
              <td style={{ ...cell, textAlign: 'right' }}>
                {!readOnly && rule.tiers.length > 1 && <button className="btn-line sm danger" onClick={() => onRemoveTier(ti)}>✕</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly && (
        <div style={{ padding: '10px 18px' }}>
          <button className="btn-line sm" style={{ borderStyle: 'dashed' }} onClick={onAddTier}>＋ {t('加一档', 'Add tier')}</button>
        </div>
      )}
    </div>
  );
}

function MatchEditor({ tier, readOnly, unit, onChange }: {
  tier: PointTier; readOnly: boolean; unit: string; onChange: (m: PointTier['match']) => void;
}) {
  const { t } = useLang();
  const m = tier.match;
  if (readOnly && !m) return <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{t('由 PM 选', 'PM picks')}</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 12 }}>
      <select className="in sm" style={{ width: 'auto' }} disabled={readOnly} value={m?.op || ''}
        onChange={(e) => {
          const op = e.target.value as 'lte' | 'gte' | 'range' | '';
          if (!op) { onChange(undefined); return; }
          onChange({ op, from: m?.from, to: m?.to });
        }}>
        <option value="">{t('— 不自动 —', '— none —')}</option>
        <option value="lte">≤</option>
        <option value="gte">≥</option>
        <option value="range">{t('区间内', 'between')}</option>
      </select>
      {m?.op === 'lte' && <input className="in sm" type="number" style={{ width: 74 }} disabled={readOnly}
        defaultValue={m.to ?? ''} onBlur={(e) => onChange({ op: 'lte', to: Number(e.target.value) || 0 })} />}
      {m?.op === 'gte' && <input className="in sm" type="number" style={{ width: 74 }} disabled={readOnly}
        defaultValue={m.from ?? ''} onBlur={(e) => onChange({ op: 'gte', from: Number(e.target.value) || 0 })} />}
      {m?.op === 'range' && (
        <>
          <input className="in sm" type="number" style={{ width: 68 }} disabled={readOnly}
            defaultValue={m.from ?? ''} onBlur={(e) => onChange({ op: 'range', from: Number(e.target.value) || 0, to: m.to })} />
          –
          <input className="in sm" type="number" style={{ width: 68 }} disabled={readOnly}
            defaultValue={m.to ?? ''} onBlur={(e) => onChange({ op: 'range', from: m.from, to: Number(e.target.value) || 0 })} />
        </>
      )}
      {m && unit && <span style={{ color: 'var(--text2)' }}>{unit}</span>}
    </span>
  );
}

function AddServiceRule({ existing, onAdd }: { existing: string[]; onAdd: (svc: string, zh: string, en: string) => void }) {
  const { lang, t } = useLang();
  const [svc, setSvc] = useState('');
  const left = Object.keys(SVC).filter((k) => !existing.includes(k));
  return (
    <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--navy900)' }}>＋ {t('新增业务', 'Add service')}</span>
      <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{t('给这个业务定一套自己的积分档位', 'Give this service its own tier table')}</span>
      <div style={{ flex: 1 }} />
      <select className="in sm" style={{ width: 'auto' }} value={svc} onChange={(e) => setSvc(e.target.value)}>
        <option value="">{t('— 选择业务 —', '— select service —')}</option>
        {left.map((k) => <option key={k} value={k}>{lang === 'zh' ? SVC[k].label : SVC[k].en}</option>)}
      </select>
      <button className="btn-navy sm" disabled={!svc} onClick={() => { onAdd(svc, SVC[svc].label, SVC[svc].en); setSvc(''); }}>
        {t('加入', 'Add')}
      </button>
    </div>
  );
}

const cell: React.CSSProperties = { textAlign: 'left', padding: '8px 18px', fontSize: 12.5, borderTop: '1px solid var(--row-line)', verticalAlign: 'middle' };
const clone = <X,>(x: X): X => JSON.parse(JSON.stringify(x)) as X;
function freshId(s: PointRule): string {
  const used = new Set(s.tiers.map((x) => x.id));
  let n = s.tiers.length + 1;
  while (used.has(s.svc + n)) n++;
  return s.svc + n;
}
