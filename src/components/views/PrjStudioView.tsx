'use client';

/* ===== 05 方案配置 · 投影 =====
   prj@0.2 (AV-020): blend groups × faces, the finished-project samples, rule
   findings and the calculation basis (PrjGroupsPanel). Projects opened on the
   single-image draft prj@0.1-draft keep that form and its figures until the PM
   previews the upgrade here; it takes effect on the next save, logged. */

import React, { useEffect, useMemo, useRef, useState } from 'react';

import { computePrj, type PrjConfig } from '@/av/core/prj/compute';
import { buildPrjDrawing } from '@/av/core/prj/drawing';
import { computePrjGroups, isGroupsConfig, migratePrjV01, type PrjGroupsConfig } from '@/av/core/prj/groups';
import { PRJ_LIBRARY_SEED, type PrjLibrary } from '@/av/core/prj/library';
import { prjPrefill, type PrjAnswers } from '@/av/core/prj/inquiry';
import { getPrjGroupsPack, getPrjPack, isGroupsPack, LATEST_PRJ_PACK, PRJ_V01_PACK, prjPackUpgradable, type PrjContent, type PrjProfileCode } from '@/av/core/prj/rulepack';
import { prjSample } from '@/av/core/prj/samples';
import { toSvg } from '@/av/core/svg';
import type { Severity, TraceNode } from '@/av/core/types';
import { canCostProject, canExportLed } from '@/lib/permissions';
import { useLang } from '@/lib/i18n';
import { useStore } from '../store';
import { useFlowGuard, useFlowRefresh } from './AvFlow';
import DraftNotice from './DraftNotice';
import { sameConfig, useAutoDraft, useSavedConfig } from './useSavedConfig';
import { Field, TraceChain, Two } from './LedStudioView';
import { PrjGroupsEditor, PrjGroupsResults } from './PrjGroupsPanel';
import { PrjDrawingsPanel } from './PrjDrawingsPanel';

const SEVERITY: Record<Severity, { bg: string; fg: string; zh: string }> = {
  block: { bg: 'var(--danger-bg, #FDF0EC)', fg: 'var(--danger)', zh: '阻断' },
  warn: { bg: 'var(--warning-bg, #FDF7F1)', fg: 'var(--warning)', zh: '告警' },
  info: { bg: 'var(--hover-bg)', fg: 'var(--text2)', zh: '提示' },
};

const DEFAULT: PrjConfig = {
  prj_image_w: 6000, prj_image_h: 3375, prj_throw_dist: 6.5, prj_ambient_lux: 150, prj_screen_gain: 1,
  prj_content: 'basic', prj_profile: 'laser_wuxga', prj_view_far: 15, prj_view_near: 3,
};

const DEFAULT_V2: PrjGroupsConfig = prjSample('single');

export default function PrjStudioView() {
  const { me, projects, ledProjectId, setView } = useStore();
  const { t } = useLang();
  const [cfg, setCfg] = useState<PrjConfig | PrjGroupsConfig>(DEFAULT_V2);
  const [upgradeOf, setUpgrade] = useState('');   // AV-020:点了「预览并升级」的项目 id
  const [open, setOpen] = useState<string | null>(null);
  const [bound, setBound] = useState<string | null>(null);
  const [answers, setAnswers] = useState<PrjAnswers | null>(null);
  const [inqFor, setInqFor] = useState('');   // the project whose 01 answers have loaded
  /* AV-020 §3.5:设备库来自价格库「投影」(PD / BD 可改);最新规则包是 prj@1.0 还是 0.2 由服务端说了算 */
  const [lib, setLib] = useState<PrjLibrary>(PRJ_LIBRARY_SEED);
  const [latest, setLatest] = useState<string>(LATEST_PRJ_PACK);
  useEffect(() => {
    fetch('/api/av/prj-library').then((r) => r.json()).then((b) => {
      if (b.library && Object.keys(b.library).length) setLib(b.library);
      if (b.latest) setLatest(b.latest);
    }).catch(() => null);
  }, []);
  const [saved, setSaved] = useState('');

  const prjProjects = useMemo(() => projects.filter((p) => !p.archived && p.packages.some((k) => k.svc === 'projector')), [projects]);
  const project = prjProjects.find((p) => p.id === ledProjectId);

  useEffect(() => {
    setBound(null); setSaved(''); setAnswers(null);
    if (!project) return;
    fetch(`/api/av/inquiry?project=${encodeURIComponent(project.id)}`).then((r) => r.json())
      .then((b) => { setBound(b.inquiry?.packs?.projector ?? null); setAnswers(b.inquiry?.answers ?? null); })
      .catch(() => setBound(null)).finally(() => setInqFor(project.id));
  }, [project]);

  /* AV-017:05 打开时载入这条线的正式版本;外框的「下一步」据此判断要不要弹窗保存 */
  const stored = useSavedConfig<PrjConfig | PrjGroupsConfig>(project?.id, 'projector');
  /* AV-020:立项绑定的规则包优先;没经过 01 的项目看存过的方案是哪种形状 */
  const basePack = bound ?? (stored.cfg && !isGroupsConfig(stored.cfg) ? PRJ_V01_PACK : latest);
  const upgrade = !!project && upgradeOf === project.id && prjPackUpgradable(basePack, latest);
  const packVersion = upgrade ? latest : basePack;
  const v2 = isGroupsPack(packVersion);
  /* the form state can briefly hold the other shape while the binding loads; each view reads its own */
  const cfgV2: PrjGroupsConfig = isGroupsConfig(cfg) ? cfg : migratePrjV01(cfg);
  const cfgV1: PrjConfig = isGroupsConfig(cfg) ? DEFAULT : cfg;
  const payload = v2 ? cfgV2 : cfgV1;
  const result = useMemo(() => computePrj(cfgV1, v2 ? PRJ_V01_PACK : packVersion), [cfgV1, v2, packVersion]);
  const result2 = useMemo(() => (v2 ? computePrjGroups(cfgV2, packVersion, lib) : null), [cfgV2, v2, packVersion, lib]);
  const pack = getPrjPack(v2 ? PRJ_V01_PACK : packVersion);
  const pack2 = v2 ? getPrjGroupsPack(packVersion) : null;
  const ok = v2 ? !!result2?.ok : result.ok;
  const refreshFlow = useFlowRefresh();
  const initFor = useRef('');
  const [ready, setReady] = useState(false);
  const [restored, setRestored] = useState(false);
  useEffect(() => { setReady(false); }, [project?.id]);
  useEffect(() => {
    if (!project || !stored.loaded || inqFor !== project.id || initFor.current === project.id) return;
    initFor.current = project.id;
    /* AV-016 ②:没存成正式版本的草稿优先 */
    /* AV-020 §3.1:新开的方案按 01 答过的天花、环境光、观众距离、互动预填 */
    setCfg(stored.draft?.cfg ?? stored.cfg ?? prjPrefill(DEFAULT_V2, answers));
    setRestored(!!stored.draft);
    setReady(true);
  }, [project, stored.loaded, stored.cfg, stored.draft, answers, inqFor]);
  const dirty = !stored.cfg || !sameConfig(payload, stored.cfg) || upgrade;
  const { draftState, draftSaving, draftCleared, cancelDraft, resetDraft } = useAutoDraft({
    projectId: project?.id, line: 'projector', payload, drawingId: null,
    enabled: !!project && canCostProject(me, project) && !stored.failed, dirty, hadDraft: !!stored.draft, version: stored.version, ready,
  });
  useEffect(() => { if (draftState?.at) refreshFlow(); }, [draftState?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  /* AV-016 ②:放弃草稿 = 回到最新正式版本 */
  async function discardDraft() {
    if (!project || !stored.cfg) return;
    await fetch(`/api/av/config/draft?project=${encodeURIComponent(project.id)}&line=projector`, { method: 'DELETE' }).catch(() => null);
    setCfg(stored.cfg);
    setRestored(false);
    resetDraft(stored.cfg);
    stored.reload();
    refreshFlow();
  }
  useFlowGuard(project && stored.loaded ? {
    line: 'projector', dirty, canSave: canCostProject(me, project),
    nextVersion: stored.version + 1, blocked: ok ? null : t('方案有阻断项，不能保存', 'Blocking findings — cannot save'), save,
  } : null);
  const drawing = useMemo(() => (v2 ? null : buildPrjDrawing(result, { project: project?.name ?? t('投影方案', 'Projection') })), [v2, result, project, t]);
  const svg = useMemo(() => (drawing ? toSvg(drawing) : ''), [drawing]);
  const set = <K extends keyof PrjConfig>(k: K, v: PrjConfig[K]) => setCfg((c) => ({ ...(isGroupsConfig(c) ? DEFAULT : c), [k]: v }));
  const num = (k: keyof PrjConfig, opt = false) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(k, (opt && e.target.value === '' ? undefined : Number(e.target.value)) as never);

  async function save(): Promise<boolean> {
    if (!project) return false;
    cancelDraft();   // 排队 / 在路上的草稿作废,别在正式版本之后又写回去
    setSaved('');
    const res = await fetch('/api/av/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, line: 'projector', cfg: payload, upgradePack: upgrade }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : { error: '网络错误' };
    const done = !!res?.ok && !body.error;
    setSaved(done ? 'ok' : `✕ ${body.error || '保存失败'}`);
    if (done) {
      if (upgrade && body.packVersion) { setBound(body.packVersion); setUpgrade(''); setCfg(payload); }
      stored.markSaved(payload, Number(body.version) || stored.version + 1); resetDraft(payload); stored.reload(); refreshFlow();
    }
    return done;
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
      <div style={{ display: 'grid', gridTemplateColumns: v2 ? 'minmax(0,380px) minmax(0,1fr)' : 'minmax(0,330px) minmax(0,1fr)', gap: 20, alignItems: 'start' }}>
        <div className="panel" style={{ padding: 0 }}>
          <div className="panel-head"><span className="panel-title">{t('投影词条', 'Projection fields')}</span></div>
          <div style={{ padding: '16px 18px', display: 'grid', gap: 12 }}>
            <div style={{ fontSize: 12, lineHeight: 1.7, padding: '9px 11px', borderRadius: 6, background: SEVERITY.warn.bg, color: SEVERITY.warn.fg }}>
              {pack2 ? t(`规则包 ${packVersion}：${pack2.note}`, `Rule pack ${packVersion}: ${pack2.noteEn}`)
                : t(`规则包 ${packVersion}：${pack.note}`, `Rule pack ${packVersion} is a draft.`)}
            </div>
            <Field label={t('项目（含投影服务包）', 'Project')}>
              <div style={{ fontSize: 13, fontWeight: 600, padding: '6px 0' }}>{project ? project.name : <span style={{ fontWeight: 400, color: 'var(--text2)' }}>{t('顶栏还没选项目，或这个项目没有这条业务线：只能试算，不能保存', 'No project picked above, or it lacks this line: scratch only')}</span>}</div>
              {project && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
                {bound ? t(`立项绑定 ${bound}，锁定`, `bound ${bound}`) : t('未经 01 立项，按最新规则包', 'latest pack')}
              </div>}
            </Field>
            {project && prjPackUpgradable(basePack, latest) && (
              <div data-testid="prj-upgrade" style={{ fontSize: 12.5, lineHeight: 1.75, padding: '9px 12px', borderRadius: 6,
                background: upgrade ? 'var(--hover-bg)' : SEVERITY.warn.bg, color: upgrade ? 'var(--text)' : SEVERITY.warn.fg }}>
                {upgrade ? (
                  <>
                    {isGroupsPack(basePack)
                      ? t(`正在预览 ${latest}：方案不变，常数全部已确认。保存时才升级，历史版本不变。`,
                        `Previewing ${latest}: same design, every constant confirmed. The upgrade happens on save; earlier versions are kept.`)
                      : t(`正在预览 ${latest}：旧的单画面已换成 1 组 1 面。天花高度、画面离地、投影机型号是默认值，请核对后保存；保存时才升级，历史版本不变。`,
                        `Previewing ${latest}: the single image is now one group with one face. Ceiling height, image height above the floor and projector model are defaults — check them, then save. The upgrade happens on save; earlier versions are kept.`)}{' '}
                    <button style={{ textDecoration: 'underline', fontSize: 12 }} onClick={() => setUpgrade('')} data-testid="prj-upgrade-undo">{t('不升级', 'Keep current pack')}</button>
                  </>
                ) : (
                  <>
                    {isGroupsPack(basePack)
                      ? t(`这个项目按 ${basePack} 计算（部分常数待校准）。${latest} 已发布：常数全部由 PD 确认，数值不变，导出不再标「待校准」。`,
                        `This project is computed on ${basePack} (some constants not yet calibrated). ${latest} is published: every constant confirmed by PD, same values, exports no longer marked uncalibrated.`)
                      : t(`这个项目按 ${basePack}（单画面草案）计算：不支持多面 / 转角融合、机位与遮挡检查。${latest} 按融合组计算，有设备库与计算依据。`,
                        `This project is computed on ${basePack} (single-image draft): no multi-face or corner blends, no lens height or shadow checks. ${latest} works by blend group with a device library and a calculation basis.`)}{' '}
                    {canCostProject(me, project) && <button style={{ textDecoration: 'underline', color: 'var(--navy700)', fontSize: 12 }} onClick={() => setUpgrade(project.id)} data-testid="prj-upgrade-go">
                      {t(`预览并升级到 ${latest}`, `Preview and upgrade to ${latest}`)}</button>}
                  </>
                )}
              </div>
            )}
            {v2 && <PrjGroupsEditor cfg={cfgV2} onChange={setCfg} lib={lib} />}
            {!v2 && <>
            <Field label={t('投影机类型（参数组）', 'Projector class')}>
              <select value={cfgV1.prj_profile} onChange={(e) => set('prj_profile', e.target.value as PrjProfileCode)}>
                {Object.values(pack.profiles).map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
              </select>
            </Field>
            <Field label={t('内容类别（决定对比度与可视距离）', 'Content class')}>
              <select value={cfgV1.prj_content} onChange={(e) => set('prj_content', e.target.value as PrjContent)}>
                {Object.values(pack.content).map((c) => <option key={c.code} value={c.code}>{c.label} · {c.contrast}:1</option>)}
              </select>
            </Field>
            <Two>
              <Field label={t('画面宽 mm', 'Image W mm')}><input type="number" value={cfgV1.prj_image_w} onChange={num('prj_image_w')} /></Field>
              <Field label={t('画面高 mm', 'Image H mm')}><input type="number" value={cfgV1.prj_image_h} onChange={num('prj_image_h')} /></Field>
              <Field label={t('投射距离 m', 'Throw m')}><input type="number" step="0.1" value={cfgV1.prj_throw_dist} onChange={num('prj_throw_dist')} /></Field>
              <Field label={t('屏面环境照度 lx', 'Ambient lx')}><input type="number" value={cfgV1.prj_ambient_lux} onChange={num('prj_ambient_lux')} /></Field>
              <Field label={t('幕布增益', 'Screen gain')}><input type="number" step="0.1" value={cfgV1.prj_screen_gain} onChange={num('prj_screen_gain')} /></Field>
              <div />
              <Field label={t('最远观看距离 m', 'Farthest viewer m')}><input type="number" step="0.1" value={cfgV1.prj_view_far ?? ''} placeholder="—" onChange={num('prj_view_far', true)} /></Field>
              <Field label={t('最近观看距离 m', 'Nearest viewer m')}><input type="number" step="0.1" value={cfgV1.prj_view_near ?? ''} placeholder="—" onChange={num('prj_view_near', true)} /></Field>
            </Two>
            </>}
            {project && canCostProject(me, project) && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
                <button className="btn-navy" disabled={!ok} onClick={save} style={!ok ? { opacity: 0.45, cursor: 'not-allowed' } : undefined} data-testid="prj-save">
                  {t('保存方案到项目', 'Save to project')}
                </button>
                {saved === 'ok' && <span style={{ color: 'var(--success)' }}>{t('已保存。', 'Saved. ')}
                  <button style={{ textDecoration: 'underline', color: 'var(--navy700)', fontSize: 12 }} onClick={() => setView({ name: 'avcostquote', sub: 'cost', line: 'projector' })}>{t('去 06 成本核算', 'Open 06')}</button></span>}
                {saved.startsWith('✕') && <span style={{ color: 'var(--danger)' }}>{saved}</span>}
                <DraftNotice testid="studio-draft" saved={stored} restored={restored} state={draftState} saving={draftSaving} cleared={draftCleared}
                  onDiscard={stored.cfg ? discardDraft : null} />
              </div>
            )}
            <div style={{ fontSize: 11, lineHeight: 1.8, color: 'var(--text2)', borderTop: '1px solid var(--row-line)', paddingTop: 10 }}>
              {t('投影暂不走图纸解析（02–04），参数在此手工录入。', 'Projection has no drawing ingest yet; enter parameters here.')}
            </div>
          </div>
        </div>

        {v2 && result2 && (
          <div style={{ display: 'grid', gap: 20, minWidth: 0 }}>
            <div className="panel" style={{ padding: 0 }}>
              <div className="panel-head"><span className="panel-title">{t('计算结果', 'Results')}</span></div>
              <div style={{ padding: '16px 18px' }} data-testid="prj-results">
                <PrjGroupsResults result={result2} />
              </div>
            </div>
            {/* AV-020 §3.4:四个视图、拖动机位、DXF 与技术方案;没选项目时也能试算、调整,导出给 PM */}
            <PrjDrawingsPanel result={result2} cfg={cfgV2} onChange={setCfg} by={me?.name ?? ''}
              canAdjust={!project || canCostProject(me, project)} canExport={!!me && canExportLed(me)}
              packVersion={packVersion} title={project?.name ?? ''} client={project?.client ?? ''} />
          </div>
        )}
        {!v2 && <div style={{ display: 'grid', gap: 20 }}>
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
        </div>}
      </div>
    </>
  );
}
