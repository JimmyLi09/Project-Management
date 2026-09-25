'use client';

/* ===== 05 方案配置 · 弱电 =====
   ELV on the draft rule pack elv@0.1-draft: space type, subsystems and the
   elv_ fields, the engine's quantities with their calculation chain, findings
   and the system diagram. The pack is uncalibrated, so the screen can
   compute, save and cost, but never export a formal deliverable (ELV-TYPE-01). */

import React, { useEffect, useMemo, useState } from 'react';

import { computeElv, type ElvConfig } from '@/av/core/elv/compute';
import { buildElvDrawing } from '@/av/core/elv/drawing';
import { getElvPack, LATEST_ELV_PACK, type ElvSpace } from '@/av/core/elv/rulepack';
import { toSvg } from '@/av/core/svg';
import type { Severity, TraceNode } from '@/av/core/types';
import { canCostProject } from '@/lib/permissions';
import { useLang } from '@/lib/i18n';
import { useStore } from '../store';
import AvSteps from './AvSteps';
import { Field, TraceChain, Two } from './LedStudioView';

const SEVERITY: Record<Severity, { bg: string; fg: string; zh: string }> = {
  block: { bg: 'var(--danger-bg, #FDF0EC)', fg: 'var(--danger)', zh: '阻断' },
  warn: { bg: 'var(--warning-bg, #FDF7F1)', fg: 'var(--warning)', zh: '告警' },
  info: { bg: 'var(--hover-bg)', fg: 'var(--text2)', zh: '提示' },
};

const DEFAULT: ElvConfig = {
  elv_area: 1200, elv_floors: 1, elv_entrances: 2, elv_ceiling_h: 3, elv_avg_run: 40,
  elv_space: 'office', elv_cctv: true, elv_access: true, elv_net: true, elv_pa: true,
};

const SUBSYSTEMS = [
  ['elv_net', '综合布线 / 网络', 'Cabling & network'], ['elv_cctv', '视频监控', 'CCTV'],
  ['elv_access', '门禁', 'Access control'], ['elv_pa', '公共广播', 'Public address'],
] as const;

export default function ElvStudioView() {
  const { me, projects, ledProjectId, setLedProjectId, go } = useStore();
  const { t } = useLang();
  const [cfg, setCfg] = useState<ElvConfig>(DEFAULT);
  const [open, setOpen] = useState<string | null>(null);
  const [bound, setBound] = useState<string | null>(null);
  const [saved, setSaved] = useState('');

  const elvProjects = useMemo(() => projects.filter((p) => !p.archived && p.packages.some((k) => k.svc === 'elv')), [projects]);
  const project = elvProjects.find((p) => p.id === ledProjectId);
  const packVersion = bound ?? LATEST_ELV_PACK;
  const pack = getElvPack(packVersion);

  useEffect(() => {
    setBound(null); setSaved('');
    if (!project) return;
    fetch(`/api/av/inquiry?project=${encodeURIComponent(project.id)}`).then((r) => r.json())
      .then((b) => setBound(b.inquiry?.packs?.elv ?? null)).catch(() => setBound(null));
  }, [project]);

  const result = useMemo(() => computeElv(cfg, packVersion), [cfg, packVersion]);
  const drawing = useMemo(() => buildElvDrawing(result, { project: project?.name ?? t('弱电方案', 'ELV') }), [result, project, t]);
  const svg = useMemo(() => (drawing ? toSvg(drawing) : ''), [drawing]);
  const set = <K extends keyof ElvConfig>(k: K, v: ElvConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const num = (k: keyof ElvConfig) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never);

  async function save() {
    if (!project) return;
    setSaved('');
    const res = await fetch('/api/av/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, line: 'elv', cfg }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : { error: '网络错误' };
    setSaved(!res?.ok || body.error ? `✕ ${body.error || '保存失败'}` : 'ok');
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
      <AvSteps />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,330px) minmax(0,1fr)', gap: 20, alignItems: 'start' }}>
        <div className="panel" style={{ padding: 0 }}>
          <div className="panel-head"><span className="panel-title">{t('弱电词条', 'ELV fields')}</span></div>
          <div style={{ padding: '16px 18px', display: 'grid', gap: 12 }}>
            <div style={{ fontSize: 12, lineHeight: 1.7, padding: '9px 11px', borderRadius: 6, background: SEVERITY.warn.bg, color: SEVERITY.warn.fg }}>
              {t(`规则包 ${packVersion}：${pack.note}`, `Rule pack ${packVersion} is a draft.`)}
            </div>
            <Field label={t('项目（含弱电服务包）', 'Project')}>
              <select value={project ? project.id : ''} onChange={(e) => setLedProjectId(e.target.value)}>
                <option value="">{t('— 仅试算，不关联项目 —', '— scratch, no project —')}</option>
                {elvProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {project && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
                {bound ? t(`立项绑定 ${bound}，锁定`, `bound ${bound}`) : t('未经 01 立项，按最新规则包', 'latest pack')}
              </div>}
            </Field>
            <Field label={t('空间类型（决定点位密度）', 'Space type')}>
              <select value={cfg.elv_space} onChange={(e) => set('elv_space', e.target.value as ElvSpace)}>
                {Object.values(pack.spaces).map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
              </select>
            </Field>
            <Field label={t('子系统', 'Subsystems')}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 13 }}>
                {SUBSYSTEMS.map(([k, zh, en]) => (
                  <label key={k} style={{ display: 'flex', gap: 6, alignItems: 'center', margin: 0, fontWeight: 400, color: 'var(--text)', fontSize: 13 }}>
                    <input type="checkbox" style={{ width: 'auto' }} checked={cfg[k]} onChange={(e) => set(k, e.target.checked)} />{t(zh, en)}
                  </label>
                ))}
              </div>
            </Field>
            <Two>
              <Field label={t('覆盖面积 ㎡', 'Area ㎡')}><input type="number" value={cfg.elv_area} onChange={num('elv_area')} /></Field>
              <Field label={t('楼层数', 'Floors')}><input type="number" value={cfg.elv_floors} onChange={num('elv_floors')} /></Field>
              <Field label={t('出入口数', 'Entrances')}><input type="number" value={cfg.elv_entrances} onChange={num('elv_entrances')} /></Field>
              <Field label={t('吊顶高度 m', 'Ceiling m')}><input type="number" step="0.1" value={cfg.elv_ceiling_h} onChange={num('elv_ceiling_h')} /></Field>
              <Field label={t('平均水平布线长度 m', 'Avg cable run m')}><input type="number" value={cfg.elv_avg_run} onChange={num('elv_avg_run')} /></Field>
            </Two>
            {project && canCostProject(me, project) && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
                <button className="btn-navy" disabled={!result.ok} onClick={save} style={!result.ok ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}>
                  {t('保存方案到项目', 'Save to project')}
                </button>
                {saved === 'ok' && <span style={{ color: 'var(--success)' }}>{t('已保存。', 'Saved. ')}
                  <button style={{ textDecoration: 'underline', color: 'var(--navy700)', fontSize: 12 }} onClick={() => go('avcost')}>{t('去 06 成本核算', 'Open 06')}</button></span>}
                {saved.startsWith('✕') && <span style={{ color: 'var(--danger)' }}>{saved}</span>}
              </div>
            )}
            <div style={{ fontSize: 11, lineHeight: 1.8, color: 'var(--text2)', borderTop: '1px solid var(--row-line)', paddingTop: 10 }}>
              {t('弱电暂不走图纸解析（02–04），参数在此手工录入；点位按面积密度估算，有平面点位图时以点位图为准。', 'ELV has no drawing ingest yet; enter parameters here.')}
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
                  {cfg.elv_net && tile('n_outlet', t('信息点', 'Data outlets'), (n) => `${n.value} 个`)}
                  {cfg.elv_net && tile('n_ap', t('无线 AP', 'Wi-Fi APs'), (n) => `${n.value} 台`)}
                  {cfg.elv_cctv && tile('n_cam', t('摄像机', 'Cameras'), (n) => `${n.value} 台`)}
                  {cfg.elv_access && tile('n_door', t('门禁点', 'Doors'), (n) => `${n.value} 门`)}
                  {tile('n_switch', t('接入交换机', 'Switches'), (n) => `${n.value} 台 · ${tr.n_port.value} 口`)}
                  {tile('poe_w', t('PoE 功率', 'PoE load'), (n) => `${Math.round(n.value)} W`)}
                  {tile('n_box', t('六类线', 'Cat6'), (n) => `${n.value} 箱`)}
                  {cfg.elv_pa && tile('n_spk', t('吸顶扬声器', 'Speakers'), (n) => `${n.value} 只`)}
                  {cfg.elv_pa && tile('amp_w', t('功放功率', 'Amplifier'), (n) => `${Math.round(n.value)} W`)}
                  {cfg.elv_cctv && tile('nvr_tb', t('录像存储', 'Storage'), (n) => `${n.value.toFixed(1)} TB`)}
                  {tile('n_rack', t('42U 机柜', 'Racks'), (n) => `${n.value} 台 · ${tr.rack_u.value}U`)}
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
            <div className="panel-head"><span className="panel-title">{t('弱电系统图（示意）', 'System diagram')}</span></div>
            <div style={{ padding: '14px 18px' }}>
              {svg ? <div style={{ overflowX: 'auto', background: '#0E1013', borderRadius: 6, padding: 8 }} dangerouslySetInnerHTML={{ __html: svg }} />
                : <p style={{ fontSize: 13, color: 'var(--text2)' }}>{t('参数无效或未选子系统，无法出图。', 'Invalid inputs.')}</p>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
