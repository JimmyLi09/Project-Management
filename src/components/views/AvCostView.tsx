'use client';

/* ===== 06 成本核算 =====
   One business line at a time: the bill of quantities from the project's saved
   05 configuration, priced from that line's price library (LED: F1 area, F7 / F9
   cables; projection: P2 projectors, P1 screen area, P10 signal cables), plus
   added lines. Below it, the project's combined view across all its lines
   (prototype Summary.dc.html). A configuration on a draft rule pack can be
   costed as a draft but never confirmed. */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { lineInfo, LINES } from '@/av/core/lines';
import {
  buildLedLines, buildPrjLines, checkSheet, displayCandidates, itemLabel, lumensOf, pitchOf, prjChecks, totals,
  type CostCheck, type CostLine, type LedSummary, type ManualLine, type Picks, type PriceItem, type PrjPicks, type PrjSummary, type SavedConfig,
} from '@/av/core/pricing';
import type { BusinessLine } from '@/av/core/types';
import { canViewPrices } from '@/lib/permissions';
import { fmtDate } from '@/lib/project';
import { useLang } from '@/lib/i18n';
import { useStore } from '../store';
import AvSteps from './AvSteps';

type Line = 'led' | 'projector';
interface Sheet {
  id: number; configId: number; lines: CostLine[]; cost: number; list: number;
  status: 'draft' | 'confirmed'; createdBy: string; createdAt: number; confirmedBy: string; confirmedAt: number;
}
interface SummaryRow { line: BusinessLine; pack: string | null; sheet: { cost: number; list: number; status: string } | null; outdated: boolean; draftPack: boolean }
interface CostState {
  config: SavedConfig<LedSummary | PrjSummary> | null;
  sheet: Sheet | null;
  items: PriceItem[];
  marginFloor: number;
  sheetOutdated: boolean;
  canEdit: boolean;
  summary: SummaryRow[];
}

const AUTO_KEYS: Record<Line, string[]> = {
  led: ['display', 'power_cable', 'data_cable'],
  projector: ['projector', 'screen', 'signal_cable', 'mount', 'blend'],
};
const money = (v: number) => `S$ ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
const today = () => new Date().toISOString().slice(0, 10);

export default function AvCostView() {
  const { me, projects, ledProjectId, setLedProjectId, go } = useStore();
  const { t } = useLang();
  const [line, setLine] = useState<Line>('led');
  const [state, setState] = useState<CostState | null>(null);
  const [picks, setPicks] = useState<Record<string, number | null>>({});
  const [manual, setManual] = useState<ManualLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const svc = lineInfo(line).svc!;
  const lineProjects = useMemo(() => projects.filter((p) => !p.archived && p.packages.some((k) => k.svc === svc)), [projects, svc]);
  const project = lineProjects.find((p) => p.id === ledProjectId);

  const load = useCallback(async () => {
    setState(null); setError(''); setMsg('');
    if (!project) return;
    const res = await fetch(`/api/av/cost?project=${encodeURIComponent(project.id)}&line=${line}`).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : { error: '网络错误' };
    if (!res?.ok || body.error) { setError(body.error || '加载失败'); return; }
    const s = body as CostState;
    setState(s);
    const byKey = new Map((s.sheet?.lines ?? []).map((l) => [l.key, l]));
    const next: Record<string, number | null> = {};
    for (const k of AUTO_KEYS[line]) next[k] = byKey.get(k)?.itemId ?? null;
    /* LED: suggest the display item when exactly one fits the pitch */
    if (line === 'led' && next.display === null && s.config) {
      const pitch = (s.config.summary as LedSummary).pitch;
      const fit = displayCandidates(s.items, pitch).filter((i) => { const p = pitchOf(i.pitch); return p !== null && Math.abs(p - pitch) < 1e-3; });
      if (fit.length === 1) next.display = fit[0].id;
    }
    setPicks(next);
    setManual((s.sheet?.lines ?? []).filter((l) => l.qtySource === '人工').map((l) => ({ key: l.key, name: l.name, qty: l.qty, unit: l.unit, itemId: l.itemId })));
  }, [project, line]);
  useEffect(() => { load(); }, [load]);

  const preview = useMemo(() => {
    if (!state?.config) return null;
    let lines: CostLine[];
    let extra: CostCheck[] = [];
    if (line === 'projector') {
      const cfg = state.config as SavedConfig<PrjSummary>;
      lines = buildPrjLines(cfg, picks as unknown as PrjPicks, manual, state.items);
      extra = prjChecks(lines, cfg, state.items);
    } else {
      lines = buildLedLines(state.config as SavedConfig<LedSummary>, picks as unknown as Picks, manual, state.items);
    }
    return { lines, totals: totals(lines), checks: checkSheet(lines, state.config, state.items, state.marginFloor, today(), extra) };
  }, [state, picks, manual, line]);

  if (!canViewPrices(me)) {
    return <><AvSteps /><div className="panel" style={{ padding: '18px 20px', fontSize: 13, color: 'var(--text2)' }}>{t('当前角色无权查看成本。', 'Your role cannot see costs.')}</div></>;
  }

  async function submit(confirm: boolean) {
    if (!project) return;
    setBusy(true); setError(''); setMsg('');
    const res = await fetch('/api/av/cost', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, line, picks, manual, confirm }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : { error: '网络错误' };
    setBusy(false);
    if (!res?.ok || body.error) { setError(body.error || '保存失败'); return; }
    await load();
    setMsg(confirm ? t('成本已确认。', 'Cost confirmed.') : t('草稿已保存。', 'Draft saved.'));
  }

  const editable = !!state?.canEdit;
  const blocks = preview?.checks.filter((c) => c.severity === 'block') ?? [];
  const options = (l: CostLine) => {
    const items = state!.items.filter((i) => i.active || i.id === l.itemId);
    if (l.key === 'display') return displayCandidates(items, (state!.config!.summary as LedSummary).pitch);
    if (l.key === 'projector') {
      const need = (state!.config!.summary as PrjSummary).lmProj;
      const enough = (i: PriceItem) => (lumensOf(i.pitch) ?? 0) >= need;
      const units = items.filter((i) => i.unit === l.unit);
      return [...units.filter(enough), ...units.filter((i) => !enough(i)), ...items.filter((i) => i.unit !== l.unit)];
    }
    return [...items.filter((i) => i.unit === l.unit), ...items.filter((i) => i.unit !== l.unit)];
  };
  const setPick = (key: string, id: number | null) => {
    if (AUTO_KEYS[line].includes(key)) setPicks({ ...picks, [key]: id });
    else setManual(manual.map((m) => (m.key === key ? { ...m, itemId: id } : m)));
  };
  const basis = () => {
    const c = state!.config!;
    const head = `${fmtDate(new Date(c.createdAt))} · ${c.createdBy} · ${t('规则包', 'pack')} ${c.packVersion}`;
    if (line === 'projector') {
      const s = c.summary as PrjSummary;
      return `${head} · ${s.width}×${s.height} mm · ${s.area.toFixed(2)} ㎡ · ${s.nProj} 台 × ${Math.ceil(s.lmProj).toLocaleString('en-US')} lm · ${t('信号线', 'signal')} ${s.nSignalCable}`;
    }
    const s = c.summary as LedSummary;
    return `${head} · P${s.pitch} · ${s.sqm.toFixed(2)} ㎡ · ${t('箱体', 'cabinets')} ${s.cabinets} · ${t('电源线', 'power')} ${s.nPowerCable} · ${t('数据线', 'data')} ${s.nDataCable}`;
  };

  return (
    <>
      <AvSteps />
      <div style={{ display: 'grid', gap: 20 }}>
        <div className="panel" style={{ padding: 0 }}>
          <div className="panel-head"><span className="panel-title">{t('项目与业务线', 'Project and line')}</span></div>
          <div style={{ padding: '14px 18px', display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="field" style={{ marginBottom: 0, width: 220 }}>
                <label htmlFor="cost-line">{t('业务线', 'Line')}</label>
                <select id="cost-line" value={line} onChange={(e) => setLine(e.target.value as Line)}>
                  <option value="led">{t('LED 显示屏', 'LED display')}</option>
                  <option value="projector">{t('投影系统（草案）', 'Projection (draft)')}</option>
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0, flex: '1 1 320px', maxWidth: 520 }}>
                <label htmlFor="cost-project">{t('项目', 'Project')}</label>
                <select id="cost-project" value={project ? project.id : ''} onChange={(e) => setLedProjectId(e.target.value)}>
                  <option value="">{t('— 选择项目 —', '— choose a project —')}</option>
                  {lineProjects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.client ? ` · ${p.client}` : ''}</option>)}
                </select>
              </div>
            </div>
            {state?.config && (
              <div style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.8 }}>
                {t('计算依据：', 'Based on: ')}<strong style={{ color: 'var(--text)' }}>{t('05 方案', '05 configuration')}</strong> {basis()}
              </div>
            )}
            {error && <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>{error}</div>}
          </div>
        </div>

        {project && state && !state.config && (
          <div className="panel" style={{ padding: '16px 18px', fontSize: 13, color: 'var(--text2)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {t('该项目这条业务线还没有保存的 05 方案。', 'No saved 05 configuration for this line yet.')}
            <button className="btn-line" onClick={() => go(line === 'led' ? 'ledingest' : 'prjstudio')}>
              {line === 'led' ? t('去 02–04 图纸校核', 'Open 02–04') : t('去 05 投影方案配置', 'Open projection 05')}
            </button>
          </div>
        )}

        {state?.config && preview && (
          <div className="panel clip" style={{ padding: 0 }}>
            <div className="panel-head">
              <span className="panel-title">{t(`${lineInfo(line).label} 单线成本`, `${lineInfo(line).en} line cost`)}</span>
              {state.sheet && (
                <span style={{ fontSize: 12, color: state.sheet.status === 'confirmed' ? 'var(--success)' : 'var(--text2)' }}>
                  {state.sheet.status === 'confirmed'
                    ? t(`已确认 · ${state.sheet.confirmedBy} · ${fmtDate(new Date(state.sheet.confirmedAt))}`, `Confirmed by ${state.sheet.confirmedBy}`)
                    : t(`草稿 · ${state.sheet.createdBy} · ${fmtDate(new Date(state.sheet.createdAt))}`, `Draft by ${state.sheet.createdBy}`)}
                </span>
              )}
            </div>
            {!state.config.summary.exportable && (
              <div style={{ margin: '12px 18px 0', fontSize: 12.5, padding: '9px 12px', borderRadius: 6, background: 'var(--warning-bg, #FDF7F1)', color: 'var(--warning)' }}>
                {t(`方案所用规则包 ${state.config.packVersion} 为草案或含阻断项（${state.config.summary.blocking.join('、')}）：可以核算并保存草稿，不能确认为正式成本。`,
                  'Draft rule pack: drafts only, no confirmation.')}
              </div>
            )}
            {state.sheetOutdated && (
              <div style={{ margin: '12px 18px 0', fontSize: 12.5, padding: '9px 12px', borderRadius: 6, background: 'var(--warning-bg, #FDF7F1)', color: 'var(--warning)' }}>
                {t('05 方案在上次核算后已重新保存，成本表需按新方案重算。', 'The 05 configuration changed after this sheet — recalculate.')}
              </div>
            )}
            {state.items.length === 0 && (
              <div style={{ margin: '12px 18px 0', fontSize: 12.5, color: 'var(--text2)' }}>
                {t('这条业务线的价格库为空，先到「AV 价格库」录入价格。', 'This line\'s price library is empty.')}{' '}
                <button style={{ textDecoration: 'underline', color: 'var(--navy700)', fontSize: 12.5 }} onClick={() => go('avprices')}>{t('打开价格库', 'Open library')}</button>
              </div>
            )}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 1080 }}>
                <tbody>
                  <tr>{[t('项目', 'Item'), t('数量', 'Qty'), t('依据', 'Basis'), t('价格库条目', 'Price item'), t('成本单价', 'Unit cost'),
                    t('售价单价', 'Unit sell'), t('成本小计', 'Cost'), t('售价小计', 'Sell'), ''].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr>
                  {preview.lines.map((l) => (
                    <tr key={l.key}>
                      <td style={td}>
                        {l.qtySource === '人工' && editable ? (
                          <input className="in sm" style={{ width: 180 }} value={l.name} aria-label={t('名称', 'Name')}
                            onChange={(e) => setManual(manual.map((m) => (m.key === l.key ? { ...m, name: e.target.value } : m)))} />
                        ) : l.name}
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }} className="tnum">
                        {l.qtySource === '人工' && editable ? (
                          <>
                            <input className="in sm" type="number" style={{ width: 70 }} value={l.qty} aria-label={t('数量', 'Qty')}
                              onChange={(e) => setManual(manual.map((m) => (m.key === l.key ? { ...m, qty: Number(e.target.value) } : m)))} />{' '}
                            <input className="in sm" style={{ width: 44 }} value={l.unit} aria-label={t('单位', 'Unit')}
                              onChange={(e) => setManual(manual.map((m) => (m.key === l.key ? { ...m, unit: e.target.value } : m)))} />
                          </>
                        ) : `${l.qty} ${l.unit}`}
                      </td>
                      <td style={{ ...td, color: 'var(--text2)' }}>{l.qtySource === '人工' ? t('人工', 'manual') : `rule · ${l.qtySource}`}</td>
                      <td style={{ ...td, maxWidth: 340 }}>
                        {editable ? (
                          <select className="in sm" style={{ width: 320 }} value={l.itemId ?? ''} aria-label={t('价格库条目', 'Price item')}
                            onChange={(e) => setPick(l.key, e.target.value ? Number(e.target.value) : null)}>
                            <option value="">{t('— 选择 —', '— choose —')}</option>
                            {options(l).map((i) => <option key={i.id} value={i.id}>{itemLabel(i)} · {i.unit}{i.costPrice === null ? t('（待定价）', ' (tbd)') : ''}</option>)}
                          </select>
                        ) : (l.itemLabel || '—')}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }} className="tnum">{l.unitCost === null ? '—' : l.unitCost.toLocaleString('en-US')}</td>
                      <td style={{ ...td, textAlign: 'right' }} className="tnum">{l.unitList === null ? '—' : l.unitList.toLocaleString('en-US')}</td>
                      <td style={{ ...td, textAlign: 'right' }} className="tnum">{l.unitCost === null ? '—' : money(l.unitCost * l.qty)}</td>
                      <td style={{ ...td, textAlign: 'right' }} className="tnum">{l.unitList === null ? '—' : money(l.unitList * l.qty)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        {l.qtySource === '人工' && editable && (
                          <button style={{ fontSize: 12, color: 'var(--text2)', textDecoration: 'underline' }}
                            onClick={() => setManual(manual.filter((m) => m.key !== l.key))}>{t('删除', 'Remove')}</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ background: 'var(--hover-bg)', fontWeight: 700 }}>
                    <td style={td} colSpan={6}>{t('单线合计', 'Line total')} · {t('毛利率', 'margin')} {pct(preview.totals.margin)}</td>
                    <td style={{ ...td, textAlign: 'right' }} className="tnum">{money(preview.totals.cost)}</td>
                    <td style={{ ...td, textAlign: 'right' }} className="tnum">{money(preview.totals.list)}</td>
                    <td style={td} />
                  </tr>
                </tbody>
              </table>
            </div>
            <div style={{ padding: '14px 18px', display: 'grid', gap: 12 }}>
              {editable && (
                <button className="btn-line" style={{ justifySelf: 'start' }}
                  onClick={() => setManual([...manual, { key: `m${manual.length + 1}-${Date.now()}`, name: '', qty: 1, unit: '项', itemId: null }])}>
                  {line === 'led' ? t('+ 附加项（控制系统、钢结构、安装人工…）', '+ Add line') : t('+ 附加项（镜头、调试、安装人工…）', '+ Add line')}
                </button>
              )}
              <Checks checks={preview.checks} />
              {msg && <div style={{ fontSize: 12.5, color: 'var(--success)' }}>{msg}</div>}
              {editable ? (
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <button className="btn-line" disabled={busy} onClick={() => submit(false)}>{t('保存草稿', 'Save draft')}</button>
                  <button className="btn-navy" disabled={busy || blocks.length > 0} onClick={() => submit(true)}
                    style={busy || blocks.length ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}>{t('确认成本', 'Confirm cost')}</button>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text2)' }}>{t('成本核算由该项目的 PM 完成。', 'Costing is done by the project PM.')}</div>
              )}
            </div>
          </div>
        )}

        {state && project && (
          <div className="panel clip" style={{ padding: 0 }}>
            <div className="panel-head"><span className="panel-title">{t('项目合并汇总', 'Project summary')}</span></div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}>
                <tbody>
                  <tr>{[t('业务线', 'Line'), t('规则包', 'Rule pack'), t('成本', 'Cost'), t('售价', 'Sell'), t('毛利率', 'Margin'), t('状态', 'Status')].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
                  {state.summary.map((r) => {
                    const l = LINES.find((x) => x.line === r.line)!;
                    const m = r.sheet && r.sheet.list > 0 ? (r.sheet.list - r.sheet.cost) / r.sheet.list : null;
                    return (
                      <tr key={r.line}>
                        <td style={{ ...td, fontWeight: 600 }}>{t(l.label, l.en)}</td>
                        <td style={{ ...td, color: 'var(--text2)' }}>{r.pack ?? t('未发布', 'none')}{l.draft ? t(' · 草案', ' · draft') : ''}</td>
                        <td style={{ ...td, textAlign: 'right' }} className="tnum">{r.sheet ? money(r.sheet.cost) : '—'}</td>
                        <td style={{ ...td, textAlign: 'right' }} className="tnum">{r.sheet ? money(r.sheet.list) : '—'}</td>
                        <td style={{ ...td, textAlign: 'right' }} className="tnum">{pct(m)}</td>
                        <td style={td}>
                          {!r.sheet ? <span style={{ color: 'var(--text2)' }}>{r.pack ? t('未核算', 'not costed') : t('规则包未发布', 'no rule pack')}</span>
                            : r.outdated ? <span style={{ color: 'var(--warning)' }}>{t('需重算', 'Recalculate')}</span>
                            : r.sheet.status === 'confirmed' ? <span style={{ color: 'var(--success)' }}>{t('已确认', 'Confirmed')}</span>
                            : <span style={{ color: 'var(--warning)' }}>{r.draftPack ? t('草稿 · 草案规则包', 'Draft · draft pack') : t('草稿', 'Draft')}</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {(() => {
                    const rows = state.summary.filter((r) => r.sheet);
                    const cost = rows.reduce((a, r) => a + r.sheet!.cost, 0);
                    const list = rows.reduce((a, r) => a + r.sheet!.list, 0);
                    const allFinal = rows.length > 0 && rows.length === state.summary.length && rows.every((r) => r.sheet!.status === 'confirmed' && !r.outdated);
                    return (
                      <tr style={{ fontWeight: 700, borderTop: '2px solid var(--text)', background: 'var(--hover-bg)' }}>
                        <td style={td} colSpan={2}>{t('项目合计', 'Project total')}{!allFinal && rows.length > 0 && <span style={{ fontWeight: 400, color: 'var(--warning)', fontSize: 12 }}> · {t('含草稿，仅供参考', 'includes drafts')}</span>}</td>
                        <td style={{ ...td, textAlign: 'right' }} className="tnum">{rows.length ? money(cost) : '—'}</td>
                        <td style={{ ...td, textAlign: 'right' }} className="tnum">{rows.length ? money(list) : '—'}</td>
                        <td style={{ ...td, textAlign: 'right' }} className="tnum">{pct(list > 0 ? (list - cost) / list : null)}</td>
                        <td style={td} />
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
            <p style={{ padding: '12px 18px 16px', fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
              {t('跨业务线的共用资源去重（机房、桥架、进场、调试工日）需要一套跨包规则，待你们给出口径后接入；目前各线成本直接相加。',
                'Cross-line de-duplication needs a rule set; lines are summed as-is for now.')}
            </p>
          </div>
        )}
      </div>
    </>
  );
}

function Checks({ checks }: { checks: CostCheck[] }) {
  const { t } = useLang();
  if (!checks.length) return null;
  const color = { block: 'var(--danger)', warn: 'var(--warning)', ok: 'var(--success)' } as const;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div className="section-label">{t('提交前检查', 'Pre-submit checks')}</div>
      {checks.map((c, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12.5, lineHeight: 1.7 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: color[c.severity], marginTop: 7, flexShrink: 0 }} />
          <span style={{ color: c.severity === 'ok' ? 'var(--text)' : color[c.severity] }}>{c.message}</span>
        </div>
      ))}
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '10px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
  color: 'var(--text2)', background: 'var(--hover-bg)', textAlign: 'left', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { padding: '9px 14px', borderTop: '1px solid var(--row-line)', verticalAlign: 'top' };
