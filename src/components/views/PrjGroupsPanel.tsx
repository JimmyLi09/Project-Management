'use client';

/* ===== 05 方案配置 · 投影 prj@0.2（AV-020） =====
   Left: space inputs and blend groups × faces, with the finished-project
   samples as presets. Right: totals, the rule findings (red / yellow / green)
   and the calculation basis table that the proposal and DXF will share. */

import React from 'react';

import { prjCalcBasis } from '@/av/core/prj/calc';
import type { PrjFace, PrjGroup, PrjGroupsConfig, PrjGroupsResult, PrjInteract } from '@/av/core/prj/groups';
import { lensOf, type PrjLibrary } from '@/av/core/prj/library';
import type { PrjEnv } from '@/av/core/prj/rulepack';
import { PRJ_SAMPLES, prjSample } from '@/av/core/prj/samples';
import type { Severity } from '@/av/core/types';
import { useLang } from '@/lib/i18n';
import { Field, Two } from './LedStudioView';

const TONE: Record<Severity, { bg: string; fg: string; mark: string; zh: string; en: string }> = {
  block: { bg: 'var(--danger-bg, #FDF0EC)', fg: 'var(--danger)', mark: '✕', zh: '红', en: 'red' },
  warn: { bg: 'var(--warning-bg, #FDF7F1)', fg: 'var(--warning)', mark: '!', zh: '黄', en: 'yellow' },
  info: { bg: 'var(--success-bg, #EEF6F1)', fg: 'var(--success)', mark: '✓', zh: '提示', en: 'note' },
};

const box: React.CSSProperties = { border: '1px solid var(--row-line)', borderRadius: 8, padding: '10px 11px', display: 'grid', gap: 9, background: 'var(--hover-bg)' };
const small: React.CSSProperties = { fontSize: 12, padding: '4px 6px' };
const linkBtn: React.CSSProperties = { fontSize: 12, textDecoration: 'underline', color: 'var(--navy700)' };

export function PrjGroupsEditor({ cfg, onChange, lib }: { cfg: PrjGroupsConfig; onChange: (c: PrjGroupsConfig) => void; lib: PrjLibrary }) {
  const { t, lang } = useLang();
  const en = lang === 'en';
  const set = <K extends keyof PrjGroupsConfig>(k: K, v: PrjGroupsConfig[K]) => onChange({ ...cfg, [k]: v });
  const setGroup = (gi: number, patch: Partial<PrjGroup>) =>
    set('prj_groups', cfg.prj_groups.map((g, i) => (i === gi ? { ...g, ...patch } : g)));
  const setFace = (gi: number, fi: number, patch: Partial<PrjFace>) =>
    setGroup(gi, { faces: cfg.prj_groups[gi].faces.map((f, i) => (i === fi ? { ...f, ...patch } : f)) });
  const num = (v: string) => (v === '' ? NaN : Number(v));

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Field label={t('载入样本（会替换当前输入）', 'Load a sample (replaces current inputs)')}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PRJ_SAMPLES.map((s) => (
            <button key={s.key} className="btn-line" style={{ fontSize: 12, padding: '4px 10px' }} data-testid={`prj-sample-${s.key}`}
              onClick={() => onChange(prjSample(s.key))}>{en ? s.labelEn : s.label}</button>
          ))}
        </div>
      </Field>
      <div className="section-label" style={{ marginBottom: -4 }}>{t('空间', 'Space')}</div>
      <Two>
        <Field label={t('天花高 m', 'Ceiling m')}><input type="number" step="0.1" value={cfg.prj_ceiling} data-testid="prj-ceiling" onChange={(e) => set('prj_ceiling', num(e.target.value))} /></Field>
        <Field label={t('环境光', 'Ambient light')}>
          <select value={cfg.prj_env} onChange={(e) => set('prj_env', e.target.value as PrjEnv)}>
            <option value="dark">{t('暗室', 'Dark room')}</option>
            <option value="window">{t('有窗', 'Windows')}</option>
            <option value="bright">{t('明亮', 'Bright')}</option>
          </select>
        </Field>
        <Field label={t('最近观众离墙 m（0 = 不检查）', 'Nearest viewer m (0 = skip)')}><input type="number" step="0.1" value={cfg.prj_view_near} data-testid="prj-near" onChange={(e) => set('prj_view_near', num(e.target.value))} /></Field>
        <Field label={t('互动', 'Interaction')}>
          <select value={cfg.prj_interact} onChange={(e) => set('prj_interact', e.target.value as PrjInteract)}>
            <option value="none">{t('无', 'None')}</option>
            <option value="wall">{t('墙面互动', 'Wall')}</option>
            <option value="floor">{t('地面互动', 'Floor')}</option>
          </select>
        </Field>
      </Two>
      <div className="section-label" style={{ marginBottom: -4 }}>{t('投影面（按融合组）', 'Faces by blend group')}</div>
      {cfg.prj_groups.map((g, gi) => {
        const p = lib[g.projector];
        const floor = g.faces[0]?.kind === 'floor';
        return (
          <div key={gi} style={box} data-testid={`prj-group-${gi}`}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input value={g.name} aria-label={t('融合组名称', 'Group name')} onChange={(e) => setGroup(gi, { name: e.target.value })} style={{ flex: 1, fontWeight: 700, ...small }} />
              {cfg.prj_groups.length > 1 && <button style={{ ...linkBtn, color: 'var(--danger)' }} onClick={() => set('prj_groups', cfg.prj_groups.filter((_, i) => i !== gi))}>{t('删组', 'Remove')}</button>}
            </div>
            <Two>
              <Field label={t('投影机', 'Projector')}>
                <select value={g.projector} onChange={(e) => { const np = lib[e.target.value]; setGroup(gi, { projector: e.target.value, lens: np && np.lenses.some((l) => l.code === g.lens) ? g.lens : 'std' }); }}>
                  {Object.values(lib).map((x) => <option key={x.code} value={x.code}>{x.name} · {x.lumens.toLocaleString('en-US')} lm</option>)}
                </select>
              </Field>
              <Field label={t('镜头', 'Lens')}>
                <select value={p ? lensOf(p, g.lens).code : g.lens} onChange={(e) => setGroup(gi, { lens: e.target.value })}>
                  {p?.lenses.map((l) => <option key={l.code} value={l.code}>{en ? l.nameEn : l.name}</option>)}
                </select>
              </Field>
              {!floor && <Field label={t('可用投射距离 m', 'Available throw m')}><input type="number" step="0.1" value={g.dmax} onChange={(e) => setGroup(gi, { dmax: num(e.target.value) })} /></Field>}
              {!floor && <Field label={t('画面离地 m', 'Image bottom m')}><input type="number" step="0.05" value={g.bottom} onChange={(e) => setGroup(gi, { bottom: num(e.target.value) })} /></Field>}
            </Two>
            <div style={{ display: 'grid', gridTemplateColumns: '64px repeat(3,minmax(0,1fr)) 18px', gap: 5, fontSize: 11, color: 'var(--text2)' }}>
              <span>{t('类型', 'Type')}</span><span>{floor ? t('长 mm', 'Length mm') : t('宽 mm', 'Width mm')}</span><span>{floor ? t('宽 mm', 'Width mm') : t('高 mm', 'Height mm')}</span><span>{t('转角°', 'Turn °')}</span><span />
              {g.faces.map((f, fi) => (
                <React.Fragment key={fi}>
                  <select value={f.kind} style={small} aria-label={t('投影面类型', 'Face type')} onChange={(e) => setFace(gi, fi, { kind: e.target.value as PrjFace['kind'] })}>
                    <option value="wall">{t('墙', 'Wall')}</option>
                    <option value="floor">{t('地面', 'Floor')}</option>
                  </select>
                  <input type="number" value={f.w} style={small} aria-label={t('宽', 'Width')} onChange={(e) => setFace(gi, fi, { w: num(e.target.value) })} />
                  <input type="number" value={f.h} style={small} aria-label={t('高', 'Height')} onChange={(e) => setFace(gi, fi, { h: num(e.target.value) })} />
                  <input type="number" value={f.turn} style={small} aria-label={t('转角', 'Turn')} disabled={floor} onChange={(e) => setFace(gi, fi, { turn: num(e.target.value) })} />
                  <button style={{ color: 'var(--danger)', fontSize: 14, visibility: g.faces.length > 1 ? 'visible' : 'hidden' }} aria-label={t('删除投影面', 'Remove face')}
                    onClick={() => setGroup(gi, { faces: g.faces.filter((_, i) => i !== fi) })}>×</button>
                </React.Fragment>
              ))}
            </div>
            {!floor && <button style={{ ...linkBtn, justifySelf: 'start' }} onClick={() => setGroup(gi, { faces: [...g.faces, { kind: 'wall', w: 4000, h: g.faces[0]?.h ?? 2500, turn: 90 }] })}>
              {t('＋ 加一面（转角连续融合）', '+ Add a face (continues round the corner)')}
            </button>}
          </div>
        );
      })}
      <button className="btn-line" style={{ justifySelf: 'start', fontSize: 12 }} data-testid="prj-add-group"
        onClick={() => set('prj_groups', [...cfg.prj_groups, { name: t(`融合组 ${cfg.prj_groups.length + 1}`, `Group ${cfg.prj_groups.length + 1}`), projector: 'PU800', lens: 'std', dmax: 5, bottom: 0.3, faces: [{ kind: 'wall', w: 6000, h: 2500, turn: 0 }] }])}>
        {t('＋ 新融合组', '+ New blend group')}
      </button>
    </div>
  );
}

export function PrjGroupsResults({ result }: { result: PrjGroupsResult }) {
  const { t, lang } = useLang();
  const en = lang === 'en';
  const reds = result.findings.filter((f) => f.severity === 'block' && f.gate === 'export').length;
  const yellows = result.findings.filter((f) => f.severity === 'warn').length;
  const kpi = (label: string, value: string, testid: string) => (
    <div className="kpi" style={{ padding: '14px 16px' }} data-testid={testid}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value tnum" style={{ fontSize: value.length > 9 ? 20 : 26, whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  );
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {result.ok && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
          {kpi(t('投影机', 'Projectors'), t(`${result.nProj} 台`, `${result.nProj}`), 'prj-kpi-n')}
          {kpi(t('融合组', 'Blend groups'), t(`${result.groups.length} 组`, `${result.groups.length}`), 'prj-kpi-groups')}
          {kpi(t('最低照度', 'Lowest illuminance'), `${Math.round(Math.min(...result.groups.map((g) => g.lux)))} lx`, 'prj-kpi-lux')}
          {kpi(t('最大单像素', 'Largest pixel'), `${Math.max(...result.groups.map((g) => g.pixel)).toFixed(1)} mm`, 'prj-kpi-px')}
          {kpi(t(`用电 · ${result.nCircuit} 路`, `Power · ${result.nCircuit} circuits`), `${result.kw.toFixed(2)} kW`, 'prj-kpi-kw')}
          {kpi(t('问题', 'Issues'), t(`${reds} 红 / ${yellows} 黄`, `${reds} red / ${yellows} yellow`), 'prj-kpi-issues')}
        </div>
      )}
      <div style={{ display: 'grid', gap: 7 }} data-testid="prj-findings">
        <div className="section-label" style={{ marginBottom: 0 }}>{t('检查结果', 'Checks')}
          <span style={{ fontWeight: 400, color: 'var(--text2)', marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>{t('规则自动列出，不是 AI 给的', 'Listed by rules, not by AI')}</span>
        </div>
        {result.findings.map((f, i) => {
          const tone = f.severity === 'block' && f.gate === 'compute' ? TONE.block : TONE[f.severity];
          return (
            <div key={`${f.code}-${i}`} data-testid={`prj-finding-${f.code}`} style={{ fontSize: 12.5, lineHeight: 1.7, padding: '8px 12px', borderRadius: 6, background: tone.bg, color: tone.fg }}>
              <strong>{tone.mark} {f.code}</strong> · {en ? (f.messageEn ?? f.message) : f.message}
            </div>
          );
        })}
      </div>
      {result.ok && <PrjCalcTable result={result} />}
    </div>
  );
}

function PrjCalcTable({ result }: { result: PrjGroupsResult }) {
  const { t, lang } = useLang();
  const calc = prjCalcBasis(result, lang === 'en' ? 'en' : 'zh');
  const th: React.CSSProperties = { padding: '8px 10px', fontSize: 11, fontWeight: 700, color: 'var(--text2)', textAlign: 'left', background: 'var(--hover-bg)', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '8px 10px', borderTop: '1px solid var(--row-line)', verticalAlign: 'top' };
  const mark = (ok: boolean | null, warn?: boolean) => (ok === true ? ' ✓' : warn ? ' !' : ok === false ? ' ✕' : '');
  return (
    <div data-testid="prj-calc">
      <div className="section-label">{t('计算依据', 'Calculation basis')}
        <span style={{ fontWeight: 400, color: 'var(--text2)', marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>
          {t('按融合组；常数都标了来源，待 PD 确认', 'By blend group; every constant shows its source and awaits PD confirmation')}
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <tbody>
            <tr>
              <th style={th}>{t('项', 'Item')}</th>
              {calc.groups.map((g, i) => <th key={i} style={th}>{g}</th>)}
              <th style={th}>{t('公式 / 来源', 'Formula / source')}</th>
            </tr>
            {calc.rows.map((r) => (
              <tr key={r.key} data-testid={`prj-calc-${r.key}`}>
                <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 600 }}>{r.item}</td>
                {r.cells.map((c, i) => (
                  <td key={i} className="tnum" style={{ ...td, color: c.warn ? 'var(--warning)' : c.ok === false ? 'var(--danger)' : c.ok ? 'var(--success)' : undefined, fontWeight: c.ok === null ? undefined : 600 }}>
                    {c.text}{mark(c.ok, c.warn)}
                  </td>
                ))}
                <td style={{ ...td, color: 'var(--text2)', fontSize: 11.5, minWidth: 220 }}>{r.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text2)', margin: '8px 0 0' }} data-testid="prj-calc-total">{calc.total}</p>
    </div>
  );
}
