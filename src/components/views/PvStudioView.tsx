'use client';

/* ===== 05 方案配置 · 光伏 =====
   Solar PV on the draft rule pack pv@0.1-draft: mounting, module and inverter
   classes and the pv_ fields, the engine's figures with their calculation
   chain, findings and the single-line diagram. The pack is uncalibrated, so the
   screen can compute, save and cost, but never export a formal deliverable
   (PV-TYPE-01). */

import React, { useEffect, useMemo, useRef, useState } from 'react';

import { computePv, type PvConfig } from '@/av/core/pv/compute';
import { buildPvDrawing } from '@/av/core/pv/drawing';
import { getPvPack, LATEST_PV_PACK, type PvInverterCode, type PvModuleCode, type PvMount } from '@/av/core/pv/rulepack';
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

const DEFAULT: PvConfig = {
  pv_area: 1000, pv_mount: 'metal', pv_module: 'm550', pv_inverter: 'inv50', pv_dc_run: 30, pv_ac_run: 20,
};

export default function PvStudioView() {
  const { me, projects, ledProjectId, setView } = useStore();
  const { t } = useLang();
  const [cfg, setCfg] = useState<PvConfig>(DEFAULT);
  const [open, setOpen] = useState<string | null>(null);
  const [bound, setBound] = useState<string | null>(null);
  const [saved, setSaved] = useState('');

  const pvProjects = useMemo(() => projects.filter((p) => !p.archived && p.packages.some((k) => k.svc === 'pv')), [projects]);
  const project = pvProjects.find((p) => p.id === ledProjectId);
  const packVersion = bound ?? LATEST_PV_PACK;
  const pack = getPvPack(packVersion);

  useEffect(() => {
    setBound(null); setSaved('');
    if (!project) return;
    fetch(`/api/av/inquiry?project=${encodeURIComponent(project.id)}`).then((r) => r.json())
      .then((b) => setBound(b.inquiry?.packs?.pv ?? null)).catch(() => setBound(null));
  }, [project]);

  const result = useMemo(() => computePv(cfg, packVersion), [cfg, packVersion]);

  /* AV-017:05 打开时载入这条线的正式版本;外框的「下一步」据此判断要不要弹窗保存 */
  const stored = useSavedConfig<PvConfig>(project?.id, 'pv');
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
    projectId: project?.id, line: 'pv', payload: cfg, drawingId: null,
    enabled: !!project && canCostProject(me, project), dirty, hadDraft: !!stored.draft, ready,
  });
  useEffect(() => { if (draftState?.at) refreshFlow(); }, [draftState?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const draftNote = draftState?.at ? t(`✓ 草稿已自动保存 · ${new Date(draftState.at).toTimeString().slice(0, 5)}`, `✓ Draft saved · ${new Date(draftState.at).toTimeString().slice(0, 5)}`)
    : stored.draft && ready ? t(`已载入草稿（${stored.draft.updatedBy}），还没存成正式版本`, `Loaded a draft (${stored.draft.updatedBy}), not saved yet`) : '';
  useFlowGuard(project && stored.loaded ? {
    line: 'pv', dirty, canSave: canCostProject(me, project),
    nextVersion: stored.version + 1, blocked: result.ok ? null : t('方案有阻断项，不能保存', 'Blocking findings — cannot save'), save,
  } : null);
  const drawing = useMemo(() => buildPvDrawing(result, { project: project?.name ?? t('光伏方案', 'Solar PV') }), [result, project, t]);
  const svg = useMemo(() => (drawing ? toSvg(drawing) : ''), [drawing]);
  const set = <K extends keyof PvConfig>(k: K, v: PvConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const num = (k: keyof PvConfig, opt = false) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(k, (opt && e.target.value === '' ? undefined : Number(e.target.value)) as never);

  async function save(): Promise<boolean> {
    if (!project) return false;
    setSaved('');
    const res = await fetch('/api/av/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, line: 'pv', cfg }),
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
          <div className="panel-head"><span className="panel-title">{t('光伏词条', 'Solar PV fields')}</span></div>
          <div style={{ padding: '16px 18px', display: 'grid', gap: 12 }}>
            <div style={{ fontSize: 12, lineHeight: 1.7, padding: '9px 11px', borderRadius: 6, background: SEVERITY.warn.bg, color: SEVERITY.warn.fg }}>
              {t(`规则包 ${packVersion}：${pack.note}`, `Rule pack ${packVersion} is a draft.`)}
            </div>
            <Field label={t('项目（含光伏服务包）', 'Project')}>
              <div style={{ fontSize: 13, fontWeight: 600, padding: '6px 0' }}>{project ? project.name : <span style={{ fontWeight: 400, color: 'var(--text2)' }}>{t('顶栏还没选项目，或这个项目没有这条业务线：只能试算，不能保存', 'No project picked above, or it lacks this line: scratch only')}</span>}</div>
              {project && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
                {bound ? t(`立项绑定 ${bound}，锁定`, `bound ${bound}`) : t('未经 01 立项，按最新规则包', 'latest pack')}
              </div>}
            </Field>
            <Field label={t('安装方式（决定覆盖率与支架荷载）', 'Mounting')}>
              <select value={cfg.pv_mount} onChange={(e) => set('pv_mount', e.target.value as PvMount)}>
                {Object.values(pack.mounts).map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
              </select>
            </Field>
            <Field label={t('组件', 'Module')}>
              <select value={cfg.pv_module} onChange={(e) => set('pv_module', e.target.value as PvModuleCode)}>
                {Object.values(pack.modules).map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
              </select>
            </Field>
            <Field label={t('逆变器', 'Inverter')}>
              <select value={cfg.pv_inverter} onChange={(e) => set('pv_inverter', e.target.value as PvInverterCode)}>
                {Object.values(pack.inverters).map((i) => <option key={i.code} value={i.code}>{i.label}</option>)}
              </select>
            </Field>
            <Two>
              <Field label={t('可用屋面面积 ㎡', 'Usable roof ㎡')}><input type="number" value={cfg.pv_area} onChange={num('pv_area')} /></Field>
              <Field label={t('目标容量 kWp（空 = 铺满）', 'Target kWp')}><input type="number" value={cfg.pv_target_kwp ?? ''} placeholder="—" onChange={num('pv_target_kwp', true)} /></Field>
              <Field label={t('组串至逆变器 m（单程）', 'String run m')}><input type="number" value={cfg.pv_dc_run} onChange={num('pv_dc_run')} /></Field>
              <Field label={t('逆变器至配电箱 m', 'Inverter run m')}><input type="number" value={cfg.pv_ac_run} onChange={num('pv_ac_run')} /></Field>
            </Two>
            {project && canCostProject(me, project) && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
                <button className="btn-navy" disabled={!result.ok} onClick={save} style={!result.ok ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}>
                  {t('保存方案到项目', 'Save to project')}
                </button>
                {saved === 'ok' && <span style={{ color: 'var(--success)' }}>{t('已保存。', 'Saved. ')}
                  <button style={{ textDecoration: 'underline', color: 'var(--navy700)', fontSize: 12 }} onClick={() => setView({ name: 'avcostquote', sub: 'cost', line: 'pv' })}>{t('去 06 成本核算', 'Open 06')}</button></span>}
                {saved.startsWith('✕') && <span style={{ color: 'var(--danger)' }}>{saved}</span>}
                {draftNote && <span style={{ color: 'var(--success)', fontSize: 12 }} data-testid="studio-draft">{draftNote}</span>}
              </div>
            )}
            <div style={{ fontSize: 11, lineHeight: 1.8, color: 'var(--text2)', borderTop: '1px solid var(--row-line)', paddingTop: 10 }}>
              {t('光伏暂不走图纸解析（02–04），参数在此手工录入；可用面积须扣除设备、天窗、检修通道与退界，有屋面勘测时以排布图为准。', 'Solar has no drawing ingest yet; enter parameters here.')}
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
                  {tile('kwp', t('装机容量', 'Capacity'), (n) => `${n.value.toFixed(2)} kWp`)}
                  {tile('n_mod', t('组件', 'Modules'), (n) => `${n.value} 块`)}
                  {tile('n_inv', t('逆变器', 'Inverters'), (n) => `${n.value} 台 · ${tr.ac_kw.value} kW`)}
                  {tile('dc_ac_real', t('容配比', 'DC/AC ratio'), (n) => n.value.toFixed(2))}
                  {tile('n_str', t('组串', 'Strings'), (n) => `${n.value} 串 · ≤${tr.str_max.value} 块`)}
                  {tile('yield_kwh', t('年发电量', 'Annual yield'), (n) => `${Math.round(n.value).toLocaleString('en-US')} kWh`)}
                  {tile('dc_m', t('直流光伏线', 'DC cable'), (n) => `${n.value.toLocaleString('en-US')} m`)}
                  {tile('load_kg', t('附加荷载', 'Added load'), (n) => `${n.value.toFixed(1)} kg/㎡`)}
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
            <div className="panel-head"><span className="panel-title">{t('光伏单线图（示意）', 'Single-line diagram')}</span></div>
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
