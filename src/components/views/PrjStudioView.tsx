'use client';

/* ===== 05 方案配置 · 投影 =====
   Projection on the draft rule pack prj@0.1-draft: the prj_ field form, the
   engine's figures with their calculation chain, validation findings and the
   blend layout drawing. The pack is uncalibrated, so the screen can compute,
   save and cost, but never export a formal deliverable (PRJ-TYPE-01). */

import React, { useEffect, useMemo, useRef, useState } from 'react';

import { computePrj, type PrjConfig } from '@/av/core/prj/compute';
import { buildPrjDrawing } from '@/av/core/prj/drawing';
import { getPrjPack, LATEST_PRJ_PACK, type PrjContent, type PrjProfileCode } from '@/av/core/prj/rulepack';
import { toSvg } from '@/av/core/svg';
import type { Severity, TraceNode } from '@/av/core/types';
import { canCostProject } from '@/lib/permissions';
import { useLang } from '@/lib/i18n';
import { useStore } from '../store';
import { useFlowGuard, useFlowRefresh } from './AvFlow';
import { sameConfig, useAutoDraft, useSavedConfig } from './useSavedConfig';
import { Field, TraceChain, Two } from './LedStudioView';

const SEVERITY: Record<Severity, { bg: string; fg: string; zh: string }> = {
  block: { bg: 'var(--danger-bg, #FDF0EC)', fg: 'var(--danger)', zh: '阻断' },
  warn: { bg: 'var(--warning-bg, #FDF7F1)', fg: 'var(--warning)', zh: '告警' },
  info: { bg: 'var(--hover-bg)', fg: 'var(--text2)', zh: '提示' },
};

const DEFAULT: PrjConfig = {
  prj_image_w: 6000, prj_image_h: 3375, prj_throw_dist: 6.5, prj_ambient_lux: 150, prj_screen_gain: 1,
  prj_content: 'basic', prj_profile: 'laser_wuxga', prj_view_far: 15, prj_view_near: 3,
};

export default function PrjStudioView() {
  const { me, projects, ledProjectId, setView } = useStore();
  const { t } = useLang();
  const [cfg, setCfg] = useState<PrjConfig>(DEFAULT);
  const [open, setOpen] = useState<string | null>(null);
  const [bound, setBound] = useState<string | null>(null);
  const [saved, setSaved] = useState('');

  const prjProjects = useMemo(() => projects.filter((p) => !p.archived && p.packages.some((k) => k.svc === 'projector')), [projects]);
  const project = prjProjects.find((p) => p.id === ledProjectId);
  const packVersion = bound ?? LATEST_PRJ_PACK;
  const pack = getPrjPack(packVersion);

  useEffect(() => {
    setBound(null); setSaved('');
    if (!project) return;
    fetch(`/api/av/inquiry?project=${encodeURIComponent(project.id)}`).then((r) => r.json())
      .then((b) => setBound(b.inquiry?.packs?.projector ?? null)).catch(() => setBound(null));
  }, [project]);

  const result = useMemo(() => computePrj(cfg, packVersion), [cfg, packVersion]);

  /* AV-017:05 打开时载入这条线的正式版本;外框的「下一步」据此判断要不要弹窗保存 */
  const stored = useSavedConfig<PrjConfig>(project?.id, 'projector');
  const refreshFlow = useFlowRefresh();
  const initFor = useRef('');
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(false); }, [project?.id]);
  useEffect(() => {
    if (!project || !stored.loaded || initFor.current === project.id) return;
    initFor.current = project.id;
    /* AV-016 ②:没存成正式版本的草稿优先 */
    setCfg(stored.draft?.cfg ?? stored.cfg ?? DEFAULT);
    setReady(true);
  }, [project, stored.loaded, stored.cfg, stored.draft]);
  const dirty = !stored.cfg || !sameConfig(cfg, stored.cfg);
  const { draftState, resetDraft } = useAutoDraft({
    projectId: project?.id, line: 'projector', payload: cfg, drawingId: null,
    enabled: !!project && canCostProject(me, project), dirty, hadDraft: !!stored.draft, ready,
  });
  useEffect(() => { if (draftState?.at) refreshFlow(); }, [draftState?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const draftNote = draftState?.at ? t(`✓ 草稿已自动保存 · ${new Date(draftState.at).toTimeString().slice(0, 5)}`, `✓ Draft saved · ${new Date(draftState.at).toTimeString().slice(0, 5)}`)
    : stored.draft && ready ? t(`已载入草稿（${stored.draft.updatedBy}），还没存成正式版本`, `Loaded a draft (${stored.draft.updatedBy}), not saved yet`) : '';
  useFlowGuard(project && stored.loaded ? {
    line: 'projector', dirty, canSave: canCostProject(me, project),
    nextVersion: stored.version + 1, blocked: result.ok ? null : t('方案有阻断项，不能保存', 'Blocking findings — cannot save'), save,
  } : null);
  const drawing = useMemo(() => buildPrjDrawing(result, { project: project?.name ?? t('投影方案', 'Projection') }), [result, project, t]);
  const svg = useMemo(() => (drawing ? toSvg(drawing) : ''), [drawing]);
  const set = <K extends keyof PrjConfig>(k: K, v: PrjConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const num = (k: keyof PrjConfig, opt = false) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(k, (opt && e.target.value === '' ? undefined : Number(e.target.value)) as never);

  async function save(): Promise<boolean> {
    if (!project) return false;
    setSaved('');
    const res = await fetch('/api/av/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, line: 'projector', cfg }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : { error: '网络错误' };
    const ok = !!res?.ok && !body.error;
    setSaved(ok ? 'ok' : `✕ ${body.error || '保存失败'}`);
    if (ok) { stored.reload(); resetDraft(); refreshFlow(); }
    return ok;
  }

  const tr = result.trace;
  const tile = (key: string, label: string, text: (n: TraceNode) => string) => {
    const n = tr[key];
    if (!n) return null;
    const s = text(n);
    return (
      <button key={key} className="kpi" onClick={() => setOpen(open === key ? null : key)} title={t('展开计算链', 'Expand chain')}
        style={{ textAlign: 'left', cursor: 'pointer', padding: '16px 18px', outline: open === key ? '2px solid var(--navy700)' : undefined }}>
        <div className="kpi-label">{label}</div>
        <div className="kpi-value tnum" style={{ fontSize: s.length > 7 ? 22 : 30, whiteSpace: 'nowrap' }}>{s}</div>
        <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>{n.prov.rule ? `rule · ${n.prov.rule}` : n.prov.method}</div>
      </button>
    );
  };

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,330px) minmax(0,1fr)', gap: 20, alignItems: 'start' }}>
        <div className="panel" style={{ padding: 0 }}>
          <div className="panel-head"><span className="panel-title">{t('投影词条', 'Projection fields')}</span></div>
          <div style={{ padding: '16px 18px', display: 'grid', gap: 12 }}>
            <div style={{ fontSize: 12, lineHeight: 1.7, padding: '9px 11px', borderRadius: 6, background: SEVERITY.warn.bg, color: SEVERITY.warn.fg }}>
              {t(`规则包 ${packVersion}：${pack.note}`, `Rule pack ${packVersion} is a draft.`)}
            </div>
            <Field label={t('项目（含投影服务包）', 'Project')}>
              <div style={{ fontSize: 13, fontWeight: 600, padding: '6px 0' }}>{project ? project.name : <span style={{ fontWeight: 400, color: 'var(--text2)' }}>{t('顶栏还没选项目，或这个项目没有这条业务线：只能试算，不能保存', 'No project picked above, or it lacks this line: scratch only')}</span>}</div>
              {project && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
                {bound ? t(`立项绑定 ${bound}，锁定`, `bound ${bound}`) : t('未经 01 立项，按最新规则包', 'latest pack')}
              </div>}
            </Field>
            <Field label={t('投影机类型（参数组）', 'Projector class')}>
              <select value={cfg.prj_profile} onChange={(e) => set('prj_profile', e.target.value as PrjProfileCode)}>
                {Object.values(pack.profiles).map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
              </select>
            </Field>
            <Field label={t('内容类别（决定对比度与可视距离）', 'Content class')}>
              <select value={cfg.prj_content} onChange={(e) => set('prj_content', e.target.value as PrjContent)}>
                {Object.values(pack.content).map((c) => <option key={c.code} value={c.code}>{c.label} · {c.contrast}:1</option>)}
              </select>
            </Field>
            <Two>
              <Field label={t('画面宽 mm', 'Image W mm')}><input type="number" value={cfg.prj_image_w} onChange={num('prj_image_w')} /></Field>
              <Field label={t('画面高 mm', 'Image H mm')}><input type="number" value={cfg.prj_image_h} onChange={num('prj_image_h')} /></Field>
              <Field label={t('投射距离 m', 'Throw m')}><input type="number" step="0.1" value={cfg.prj_throw_dist} onChange={num('prj_throw_dist')} /></Field>
              <Field label={t('屏面环境照度 lx', 'Ambient lx')}><input type="number" value={cfg.prj_ambient_lux} onChange={num('prj_ambient_lux')} /></Field>
              <Field label={t('幕布增益', 'Screen gain')}><input type="number" step="0.1" value={cfg.prj_screen_gain} onChange={num('prj_screen_gain')} /></Field>
              <div />
              <Field label={t('最远观看距离 m', 'Farthest viewer m')}><input type="number" step="0.1" value={cfg.prj_view_far ?? ''} placeholder="—" onChange={num('prj_view_far', true)} /></Field>
              <Field label={t('最近观看距离 m', 'Nearest viewer m')}><input type="number" step="0.1" value={cfg.prj_view_near ?? ''} placeholder="—" onChange={num('prj_view_near', true)} /></Field>
            </Two>
            {project && canCostProject(me, project) && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
                <button className="btn-navy" disabled={!result.ok} onClick={save} style={!result.ok ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}>
                  {t('保存方案到项目', 'Save to project')}
                </button>
                {saved === 'ok' && <span style={{ color: 'var(--success)' }}>{t('已保存。', 'Saved. ')}
                  <button style={{ textDecoration: 'underline', color: 'var(--navy700)', fontSize: 12 }} onClick={() => setView({ name: 'avcostquote', sub: 'cost', line: 'projector' })}>{t('去 06 成本核算', 'Open 06')}</button></span>}
                {saved.startsWith('✕') && <span style={{ color: 'var(--danger)' }}>{saved}</span>}
                {draftNote && <span style={{ color: 'var(--success)', fontSize: 12 }} data-testid="studio-draft">{draftNote}</span>}
              </div>
            )}
            <div style={{ fontSize: 11, lineHeight: 1.8, color: 'var(--text2)', borderTop: '1px solid var(--row-line)', paddingTop: 10 }}>
              {t('投影暂不走图纸解析（02–04），参数在此手工录入。', 'Projection has no drawing ingest yet; enter parameters here.')}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 20 }}>
          <div className="panel" style={{ padding: 0 }}>
            <div className="panel-head">
              <span className="panel-title">{t('计算结果', 'Results')}</span>
              <span style={{ fontSize: 11, color: 'var(--text2)' }}>{t('点击任一数值展开计算链', 'Click a value to expand its chain')}</span>
            </div>
            <div style={{ padding: '16px 18px' }}>
              {result.ok && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 11 }}>
                  {tile('n_proj', t('投影机', 'Projectors'), (n) => `${n.value} 台`)}
                  {tile('lm_proj', t('单机所需亮度', 'Lumens each'), (n) => `${Math.round(n.value).toLocaleString('en-US')} lm`)}
                  {tile('throw_ratio', t('投射比', 'Throw ratio'), (n) => n.value.toFixed(2))}
                  {tile('px_w', t('有效分辨率', 'Resolution'), () => `${tr.px_w.value}×${tr.px_h.value}`)}
                  {tile('e_req', t('屏面照度', 'Illuminance'), (n) => `${Math.round(n.value)} lx`)}
                  {tile('kw', t('功耗', 'Power'), (n) => `${n.value.toFixed(2)} kW`)}
                  {tile('n_signal_cable', t('信号线（含备用）', 'Signal cables'), (n) => `${n.value}`)}
                </div>
              )}
              {open && tr[open] && (
                <div style={{ marginTop: 14, borderTop: '1px solid var(--row-line)', paddingTop: 12 }}>
                  <div className="section-label">{t('计算链', 'Calculation chain')}</div>
                  <TraceChain trace={tr} start={open} />
                </div>
              )}
              <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
                {result.findings.map((f) => (
                  <div key={f.code} style={{ fontSize: 12.5, lineHeight: 1.75, padding: '9px 12px', borderRadius: 6, background: SEVERITY[f.severity].bg, color: SEVERITY[f.severity].fg }}>
                    <strong>{f.code}</strong> · {SEVERITY[f.severity].zh}{f.gate === 'export' && ` · ${t('仅拦导出与正式报价', 'export only')}`} — {f.message}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="panel" style={{ padding: 0 }}>
            <div className="panel-head"><span className="panel-title">{t('投影布置示意（正视）', 'Layout (front view)')}</span></div>
            <div style={{ padding: '14px 18px' }}>
              {svg ? <div style={{ overflowX: 'auto', background: '#0E1013', borderRadius: 6, padding: 8 }} dangerouslySetInnerHTML={{ __html: svg }} />
                : <p style={{ fontSize: 13, color: 'var(--text2)' }}>{t('参数无效，无法出图。', 'Invalid inputs.')}</p>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
