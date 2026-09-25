'use client';

/* ===== 05 方案配置 + 05b 出图 =====
   The LED word-entry form, the deterministic engine's output with its
   calculation chain, and the layout / wiring drawing — spec v1.0 §4–§9.

   Nothing is computed here. Every number on this screen comes from
   src/av/core, which is framework-free and separately tested. */

import React, { useEffect, useMemo, useState } from 'react';

import { bomCsv } from '@/av/core/bom';
import { compute } from '@/av/core/compute';
import { assertExportable, buildDrawing } from '@/av/core/drawing';
import { getRulePack, LATEST_LED_PACK, listRulePacks } from '@/av/core/rulepack';
import { toSvg } from '@/av/core/svg';
import type { DrawingElement, Handoff } from '@/av/core/handoff';
import type { LedConfig, ScreenType, Severity, Size, TraceNode } from '@/av/core/types';
import { canCostProject, canExportLed } from '@/lib/permissions';
import { useLang } from '@/lib/i18n';
import { useStore } from '../store';
import { Icon } from '../ui';
import AvSteps from './AvSteps';

const SEVERITY: Record<Severity, { bg: string; fg: string; zh: string; en: string }> = {
  block: { bg: 'var(--danger-bg, #FDF0EC)', fg: 'var(--danger)', zh: '阻断', en: 'Blocking' },
  warn: { bg: 'var(--warning-bg, #FDF7F1)', fg: 'var(--warning)', zh: '告警', en: 'Warning' },
  info: { bg: 'var(--hover-bg)', fg: 'var(--text2)', zh: '提示', en: 'Note' },
};

function defaultConfig(packVersion: string, type: ScreenType): LedConfig {
  const p = getRulePack(packVersion).profiles[type];
  return {
    led_opening_w: 4480, led_opening_h: 2560,
    led_screen_type: type, led_pitch: 2, led_cabinet: p.primary,
    led_refresh: 3840, led_nits: type === 'out_fixed' ? 5000 : 800,
    led_install: 'steel', led_maintain: 'front', led_redundancy: 'sender_1plus1',
    led_ctrl_brand: 'novastar', led_power_cable: '3*2.5',
  };
}

const parseLib = (s: string): Size[] =>
  s.split(',').map((part) => part.trim().toLowerCase().split(/[x×*]/).map(Number))
    .filter((n) => n.length === 2 && n[0] > 0 && n[1] > 0)
    .map((n) => [n[0], n[1]] as Size);

const fmtLib = (lib: Size[]) => lib.map((s) => `${s[0]}x${s[1]}`).join(', ');

export default function LedStudioView() {
  const { me, projects, ledHandoff, setLedHandoff, setLedProjectId, go } = useStore();
  const { t, lang } = useLang();

  const [packVersion, setPackVersion] = useState(LATEST_LED_PACK);
  const [cfg, setCfg] = useState<LedConfig>(() => defaultConfig(LATEST_LED_PACK, 'in_fixed'));
  const [libText, setLibText] = useState(() => fmtLib(getRulePack(LATEST_LED_PACK).profiles.in_fixed.cabLib));
  const [openTrace, setOpenTrace] = useState<string | null>(null);
  /* Values handed over by 04 人工校核, with their provenance (§9). Those fields
     are read-only here: the drawing, not this form, is their source. */
  const [fromDrawing, setFromDrawing] = useState<Handoff | null>(null);

  useEffect(() => {
    if (!ledHandoff) return;
    setCfg((prev) => ({ ...prev, ...ledHandoff.fields }));
    if (ledHandoff.packVersion) setPackVersion(ledHandoff.packVersion);
    setFromDrawing(ledHandoff);
    setLedHandoff(null);
  }, [ledHandoff, setLedHandoff]);

  const locked = (k: DrawingElement) => !!fromDrawing && k in fromDrawing.fields;

  /* §10 config_result — save this configuration against the project the
     drawing belongs to; the server recomputes it with the same core. */
  const project = fromDrawing?.projectId ? projects.find((p) => p.id === fromDrawing.projectId) : undefined;
  const maySave = !!project && canCostProject(me, project);
  const [saved, setSaved] = useState('');
  async function saveToProject() {
    if (!project) return;
    setSaved('');
    const res = await fetch('/api/av/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, drawingId: fromDrawing?.drawingId ?? null, cfg: { ...cfg, led_cab_lib: lib.length ? lib : undefined } }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : { error: t('网络错误', 'Network error') };
    setSaved(!res?.ok || body.error ? `✕ ${body.error || t('保存失败', 'Save failed')}` : 'ok');
  }

  const pack = getRulePack(packVersion);
  const profile = pack.profiles[cfg.led_screen_type];
  const lib = useMemo(() => parseLib(libText), [libText]);
  const [modW, modH] = cfg.led_mod ?? [profile.modW, profile.modH];

  const result = useMemo(
    () => compute({ ...cfg, led_cab_lib: lib.length ? lib : undefined }, packVersion, fromDrawing?.prov),
    [cfg, lib, packVersion, fromDrawing],
  );
  const drawing = useMemo(
    () => buildDrawing(result, { project: fromDrawing?.project ?? fromDrawing?.drawing ?? t('方案配置', 'Configuration') }),
    [result, t, fromDrawing],
  );
  const svg = useMemo(() => (drawing ? toSvg(drawing) : ''), [drawing]);

  const set = <K extends keyof LedConfig>(key: K, value: LedConfig[K]) =>
    setCfg((prev) => ({ ...prev, [key]: value }));

  /* Switching the screen type reloads that parameter group's defaults (§3.1). */
  function switchType(type: ScreenType) {
    const p = pack.profiles[type];
    setCfg((prev) => ({ ...prev, led_screen_type: type, led_cabinet: p.primary, led_mod: undefined }));
    setLibText(fmtLib(p.cabLib));
  }

  function download(name: string, body: string, mime: string) {
    const url = URL.createObjectURL(new Blob([body], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportFile(kind: 'svg' | 'bom' | 'dxf') {
    try {
      assertExportable(result);
    } catch (e) {
      alert((e as Error).message);
      return;
    }
    if (!drawing || !result.layout) return;
    if (kind === 'svg') download('led-layout.svg', svg, 'image/svg+xml');
    else if (kind === 'bom') download('led-cabinets.csv', bomCsv(result.layout), 'text/csv;charset=utf-8');
    else download('led-layout.drawing.json', JSON.stringify(drawing, null, 2), 'application/json');
  }

  const trace = result.trace;
  const tile = (key: string, label: [string, string], render: (n: TraceNode) => string) => {
    const node = trace[key];
    if (!node) return null;
    const text = render(node);
    return (
      <button key={key} className="kpi" style={{ textAlign: 'left', cursor: 'pointer', padding: '16px 18px',
        outline: openTrace === key ? '2px solid var(--navy700)' : undefined }}
        onClick={() => setOpenTrace(openTrace === key ? null : key)}
        title={t('展开计算链', 'Expand calculation chain')}>
        <div className="kpi-label">{t(label[0], label[1])}</div>
        <div className="kpi-value tnum" style={{ fontSize: text.length > 6 ? 22 : 30, whiteSpace: 'nowrap' }}>{text}</div>
        <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
          {node.prov.rule ? `rule · ${node.prov.rule}` : node.prov.method}
        </div>
      </button>
    );
  };

  return (
    <>
    <AvSteps />
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,330px) minmax(0,1fr)', gap: 20, alignItems: 'start' }}>

      {/* ── 参数 ─────────────────────────────────────────────── */}
      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head"><span className="panel-title">{t('LED 词条', 'LED fields')}</span></div>
        <div style={{ padding: '16px 18px', display: 'grid', gap: 12 }}>

          {fromDrawing ? (
            <div style={{ fontSize: 12, lineHeight: 1.7, padding: '9px 11px', borderRadius: 6, background: 'var(--hover-bg)' }}>
              {t('已载入校核结果：', 'Loaded from review: ')}
              {fromDrawing.project && <><strong>{fromDrawing.project}</strong> · </>}<strong>{fromDrawing.drawing}</strong>
              {t('。图纸带入字段只读。', '. Drawing fields are read-only.')}{' '}
              <button style={{ fontSize: 12, textDecoration: 'underline', color: 'var(--text2)' }}
                onClick={() => setFromDrawing(null)}>{t('改为手动输入', 'Switch to manual')}</button>
              {maySave && (
                <div style={{ marginTop: 8, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button className="btn-navy" disabled={!result.layout} onClick={saveToProject}
                    style={!result.layout ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}>
                    {t('保存方案到项目', 'Save to project')}
                  </button>
                  {saved === 'ok' && (
                    <span style={{ color: 'var(--success)' }}>
                      {t('已保存。', 'Saved. ')}
                      <button style={{ textDecoration: 'underline', color: 'var(--navy700)', fontSize: 12 }}
                        onClick={() => { setLedProjectId(project!.id); go('avcost'); }}>{t('去 06 成本核算', 'Open 06 costing')}</button>
                    </span>
                  )}
                  {saved.startsWith('✕') && <span style={{ color: 'var(--danger)' }}>{saved}</span>}
                </div>
              )}
            </div>
          ) : (
            <button className="btn-line" style={{ justifySelf: 'start' }} onClick={() => go('ledingest')}>
              {t('从图纸导入（03 / 04）', 'Import from drawing (03 / 04)')}
            </button>
          )}

          <Field label={t('规则包', 'Rule pack')}>
            <select value={packVersion} onChange={(e) => setPackVersion(e.target.value)} disabled={!!fromDrawing?.packVersion}>
              {listRulePacks().map((p) => <option key={p.version} value={p.version}>{p.version}</option>)}
            </select>
            {fromDrawing?.packVersion && (
              <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
                {t('立项时绑定，锁定不可改（历史项目按创建时版本计算）', 'Bound at inquiry; locked')}
              </div>
            )}
          </Field>

          <Field label={t('屏体类型（参数组）', 'Screen type (parameter group)')}>
            <select value={cfg.led_screen_type} onChange={(e) => switchType(e.target.value as ScreenType)}>
              {Object.values(pack.profiles).map((p) => (
                <option key={p.code} value={p.code}>
                  {p.label} · {p.wSqm} W/㎡ {p.calibrated ? '' : t('（待校准）', '(uncalibrated)')}
                </option>
              ))}
            </select>
          </Field>

          {!profile.calibrated && (
            <div style={{ fontSize: 12, lineHeight: 1.7, padding: '9px 11px', borderRadius: 6,
              background: SEVERITY.warn.bg, color: SEVERITY.warn.fg }}>{profile.note}</div>
          )}

          <Two>
            <Field label={t('屏体开口宽 mm', 'Opening W mm')}>
              <input type="number" value={cfg.led_opening_w} readOnly={locked('led_opening_w')} onChange={(e) => set('led_opening_w', +e.target.value)} />
            </Field>
            <Field label={t('屏体开口高 mm', 'Opening H mm')}>
              <input type="number" value={cfg.led_opening_h} readOnly={locked('led_opening_h')} onChange={(e) => set('led_opening_h', +e.target.value)} />
            </Field>
            <Field label={t('模组宽 mm', 'Module W mm')}>
              <input type="number" value={modW} onChange={(e) => set('led_mod', [+e.target.value, modH])} />
            </Field>
            <Field label={t('模组高 mm', 'Module H mm')}>
              <input type="number" value={modH} onChange={(e) => set('led_mod', [modW, +e.target.value])} />
            </Field>
          </Two>

          <Field label={t('箱体库（宽×高，逗号分隔）', 'Cabinet library')}>
            <input value={libText} onChange={(e) => setLibText(e.target.value)} />
          </Field>

          <Field label={t('主力箱体', 'Primary cabinet')}>
            <select value={`${cfg.led_cabinet[0]}x${cfg.led_cabinet[1]}`}
              onChange={(e) => set('led_cabinet', parseLib(e.target.value)[0] ?? cfg.led_cabinet)}>
              {lib.map((s) => <option key={`${s[0]}x${s[1]}`} value={`${s[0]}x${s[1]}`}>{s[0]} × {s[1]}</option>)}
            </select>
          </Field>

          <Two>
            <Field label={t('点间距 P', 'Pitch P')}>
              <input type="number" step="0.01" value={cfg.led_pitch} onChange={(e) => set('led_pitch', +e.target.value)} />
            </Field>
            <Field label={t('亮度 nit', 'Brightness nit')}>
              <input type="number" value={cfg.led_nits} onChange={(e) => set('led_nits', +e.target.value)} />
            </Field>
            <Field label={t('刷新率 Hz', 'Refresh Hz')}>
              <select value={cfg.led_refresh} onChange={(e) => set('led_refresh', +e.target.value as 1920 | 3840)}>
                <option value={1920}>1920</option><option value={3840}>3840</option>
              </select>
            </Field>
            <Field label={t('电源线规格', 'Power cable')}>
              <input value={cfg.led_power_cable} onChange={(e) => set('led_power_cable', e.target.value)} />
            </Field>
            <Field label={t('安装方式', 'Installation')}>
              <select value={cfg.led_install} onChange={(e) => set('led_install', e.target.value as LedConfig['led_install'])}>
                <option value="steel">{t('钢结构', 'Steel frame')}</option>
                <option value="wall">{t('壁挂', 'Wall mount')}</option>
                <option value="hoist">{t('吊装', 'Hoisted')}</option>
              </select>
            </Field>
            <Field label={t('维护方式', 'Maintenance')}>
              <select value={cfg.led_maintain} onChange={(e) => set('led_maintain', e.target.value as LedConfig['led_maintain'])}>
                <option value="front">{t('前维护', 'Front')}</option>
                <option value="rear">{t('后维护', 'Rear')}</option>
              </select>
            </Field>
            <Field label={t('控制系统', 'Control system')}>
              <select value={cfg.led_ctrl_brand} onChange={(e) => set('led_ctrl_brand', e.target.value as LedConfig['led_ctrl_brand'])}>
                <option value="novastar">{t('诺瓦', 'NovaStar')}</option>
                <option value="colorlight">{t('卡莱特', 'Colorlight')}</option>
                <option value="other">{t('其他', 'Other')}</option>
              </select>
            </Field>
            <Field label={t('冗余策略', 'Redundancy')}>
              <select value={cfg.led_redundancy} onChange={(e) => set('led_redundancy', e.target.value as LedConfig['led_redundancy'])}>
                <option value="sender_1plus1">{t('发送卡 1+1', 'Sender 1+1')}</option>
                <option value="none">{t('无', 'None')}</option>
              </select>
            </Field>
          </Two>

          <div className="section-label" style={{ marginTop: 4 }}>{t('图纸带入（04 校核后只读）', 'From 04 review')}</div>
          <Two>
            <Field label={t('安装标高 mm', 'Mount height mm')}>
              <input type="number" value={cfg.led_mount_h ?? ''} placeholder="—" readOnly={locked('led_mount_h')}
                onChange={(e) => set('led_mount_h', e.target.value === '' ? undefined : +e.target.value)} />
            </Field>
            <Field label={t('最近观看距离 m', 'Min viewing dist m')}>
              <input type="number" step="0.1" value={cfg.led_view_min ?? ''} placeholder="—" readOnly={locked('led_view_min')}
                onChange={(e) => set('led_view_min', e.target.value === '' ? undefined : +e.target.value)} />
            </Field>
            <Field label={t('控制室距离 m', 'Control room m')}>
              <input type="number" step="0.1" value={cfg.led_ctrl_dist ?? ''} placeholder="—" readOnly={locked('led_ctrl_dist')}
                onChange={(e) => set('led_ctrl_dist', e.target.value === '' ? undefined : +e.target.value)} />
            </Field>
            <Field label={t('强电井距离 m', 'Power riser m')}>
              <input type="number" step="0.1" value={cfg.led_pwr_dist ?? ''} placeholder="—" readOnly={locked('led_pwr_dist')}
                onChange={(e) => set('led_pwr_dist', e.target.value === '' ? undefined : +e.target.value)} />
            </Field>
          </Two>

          <div style={{ fontSize: 11, lineHeight: 1.8, color: 'var(--text2)', borderTop: '1px solid var(--row-line)', paddingTop: 10 }}>
            {t('公司参数', 'Company')} · {t('单回路', 'Circuit')} {pack.company.circuitKw} kW<br />
            {t('控制系统', 'Control')} · {pack.control.brand} · {pack.control.dataPx.toLocaleString()} px/{t('数据线', 'run')}
          </div>
        </div>
      </div>

      {/* ── 结果与出图 ───────────────────────────────────────── */}
      <div style={{ display: 'grid', gap: 20 }}>

        <div className="panel" style={{ padding: 0 }}>
          <div className="panel-head">
            <span className="panel-title">{t('计算结果', 'Results')}</span>
            <span style={{ fontSize: 11, color: 'var(--text2)' }}>
              {t('点击任一数值展开计算链', 'Click a value to expand its chain')}
            </span>
          </div>
          <div style={{ padding: '16px 18px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 11 }}>
              {tile('sqm', ['面积 ㎡', 'Area ㎡'], (n) => n.value.toFixed(2))}
              {tile('mods', ['模组', 'Modules'], (n) => `${n.value}`)}
              {tile('px', ['分辨率', 'Resolution'], () => `${trace.px_w?.value}×${trace.px_h?.value}`)}
              {tile('kw', ['功耗 kW', 'Power kW'], (n) => n.value.toFixed(2))}
              {tile('n_power_cable', ['电源线（含备用）', 'Power cables'], (n) => `${n.value}`)}
              {tile('n_data_cable', ['数据线（含备用）', 'Data cables'], (n) => `${n.value}`)}
            </div>

            {openTrace && trace[openTrace] && (
              <div style={{ marginTop: 14, borderTop: '1px solid var(--row-line)', paddingTop: 12 }}>
                <div className="section-label">{t('计算链', 'Calculation chain')}</div>
                <TraceChain trace={trace} start={openTrace} />
              </div>
            )}

            {result.findings.length > 0 && (
              <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
                {result.findings.map((f) => (
                  <div key={f.code} style={{ fontSize: 12.5, lineHeight: 1.75, padding: '9px 12px', borderRadius: 6,
                    background: SEVERITY[f.severity].bg, color: SEVERITY[f.severity].fg }}>
                    <strong>{f.code}</strong> · {lang === 'zh' ? SEVERITY[f.severity].zh : SEVERITY[f.severity].en}
                    {f.gate === 'export' && ` · ${t('仅拦导出', 'export only')}`} — {f.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="panel" style={{ padding: 0 }}>
          <div className="panel-head">
            <span className="panel-title">{t('拼接与线路图', 'Layout & wiring')}</span>
            {canExportLed(me) && result.layout && (
              <span style={{ display: 'flex', gap: 8 }}>
                <button className="btn-line" onClick={() => exportFile('svg')}><Icon name="download" size={14} /> SVG</button>
                <button className="btn-line" onClick={() => exportFile('bom')}><Icon name="download" size={14} /> {t('箱体清单', 'Cabinets')}</button>
                <button className="btn-line" onClick={() => exportFile('dxf')}><Icon name="download" size={14} /> {t('DXF 数据包', 'DXF payload')}</button>
              </span>
            )}
          </div>
          <div style={{ padding: '14px 18px' }}>
            {result.layout ? (
              <>
                <div style={{ overflowX: 'auto', background: '#0E1013', borderRadius: 6, padding: 8 }}
                  dangerouslySetInnerHTML={{ __html: svg }} />
                {canExportLed(me) && (
                  <p style={{ fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.8, marginTop: 10 }}>
                    {t('DXF 由制图服务渲染：下载数据包后执行 ', 'Render DXF from the payload: ')}
                    <code>python -m avdrawing.dxf led-layout.drawing.json out.dxf</code>
                    {t('，输出 R2010 / 单位 mm / 八图层。', ' — R2010, mm, eight layers.')}
                  </p>
                )}
              </>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--text2)' }}>
                {t('排布无解，无法出图。请按上方阻断提示调整屏体尺寸或箱体库。',
                  'No layout solution — resolve the blocking findings above.')}
              </p>
            )}
          </div>
        </div>

        {result.layout && (
          <div className="panel clip" style={{ padding: 0 }}>
            <div className="panel-head"><span className="panel-title">{t('箱体清单', 'Cabinet list')}</span></div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                <tr>
                  {[t('规格', 'Size'), t('数量', 'Qty'), t('模组数/只', 'Modules ea.'), t('状态', 'Status')].map((h) => (
                    <th key={h} style={{ padding: '10px 18px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em',
                      textTransform: 'uppercase', color: 'var(--text2)', background: 'var(--hover-bg)', textAlign: 'left' }}>{h}</th>
                  ))}
                </tr>
                {result.layout.bom.map((b) => (
                  <tr key={`${b.w}x${b.h}`}>
                    <td style={cellStyle}>{b.w} × {b.h}</td>
                    <td style={cellStyle} className="tnum">{b.count}</td>
                    <td style={cellStyle} className="tnum">{b.mods}</td>
                    <td style={{ ...cellStyle, color: b.inLib ? 'var(--success)' : 'var(--warning)' }}>
                      {b.inLib ? t('库内标准', 'In library') : t('库外，需定制', 'Custom build')}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td style={{ ...cellStyle, fontWeight: 700 }}>{t('合计', 'Total')}</td>
                  <td style={{ ...cellStyle, fontWeight: 700 }} className="tnum">{result.layout.cells.length}</td>
                  <td style={cellStyle} colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
    </>
  );
}

const cellStyle: React.CSSProperties = { padding: '10px 18px', borderTop: '1px solid var(--row-line)' };

/* The app's own .field styling: label above, full-width input / select. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field" style={{ marginBottom: 0, minWidth: 0 }}>
      <label>{label}</label>
      {children}
    </div>
  );
}

export const Two = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 11 }}>{children}</div>
);

/* A9 追溯视图 — expand a value to its inputs, and theirs, down to the sources. */
export function TraceChain({ trace, start }: { trace: Record<string, TraceNode>; start: string }) {
  const { t } = useLang();
  const rows: { node: TraceNode; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (key: string, depth: number) => {
    const node = trace[key];
    if (!node || seen.has(key)) return;
    seen.add(key);
    rows.push({ node, depth });
    node.inputs.forEach((k) => walk(k, depth + 1));
  };
  walk(start, 0);

  return (
    <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
      {rows.map(({ node, depth }) => (
        <div key={node.key} style={{ fontSize: 12, lineHeight: 1.7, paddingLeft: depth * 18,
          color: depth === 0 ? 'var(--text1)' : 'var(--text2)' }}>
          <span className="tnum" style={{ fontWeight: depth === 0 ? 700 : 400 }}>
            {node.key} = {node.value} {node.unit}
          </span>
          {' · '}
          <span>{node.prov.rule ? `rule · ${node.prov.rule}` : node.prov.method}</span>
          {' · '}
          <span>{typeof node.prov.confidence === 'number'
            ? `${t('置信', 'confidence')} ${node.prov.confidence}`
            : node.prov.confidence}</span>
          {' · '}
          <span>{node.prov.source}</span>
          {node.prov.note ? <span style={{ color: 'var(--warning)' }}> · {node.prov.note}</span> : null}
        </div>
      ))}
    </div>
  );
}
