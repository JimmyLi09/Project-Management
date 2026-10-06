'use client';

/* ===== 05 方案配置 · 投影图纸（AV-020 §3.4） =====
   Four views of the same computation — plan, unfolded elevation, section and
   schematic — drawn by src/av/core/prj/views.ts. On the plan and the section
   the projectors can be dragged (throw; in the section also lens height), or
   the figures typed in; either way the group is marked「人工调整 · 谁 · 何时」
   and every check reruns. Exports: SVG of the current view, DXF (views ①–③ by
   layer) and the technical proposal in Chinese or English, re-gated on the server. */

import React, { useMemo, useRef, useState } from 'react';

import type { PrjGroupsConfig, PrjGroupsResult, PrjManual } from '@/av/core/prj/groups';
import { buildPrjView, PRJ_VIEWS, type PrjHandle, type PrjView } from '@/av/core/prj/views';
import { PAD, toSvg } from '@/av/core/svg';
import { useLang } from '@/lib/i18n';
import { Icon } from '../ui';

const small: React.CSSProperties = { fontSize: 12, padding: '4px 6px', width: 76 };
const linkBtn: React.CSSProperties = { fontSize: 12, textDecoration: 'underline', color: 'var(--navy700)' };
const r2 = (x: number) => Math.round(x * 100) / 100;
const clampM = (x: number, a: number, b: number) => r2(Math.max(a, Math.min(b, x)));

export function PrjDrawingsPanel({ result, cfg, onChange, by, canAdjust, canExport, packVersion, title, client }: {
  result: PrjGroupsResult;
  cfg: PrjGroupsConfig;
  onChange: (c: PrjGroupsConfig) => void;
  by: string;
  canAdjust: boolean;
  canExport: boolean;
  packVersion: string;
  title: string;
  client: string;
}) {
  const { t, lang } = useLang();
  const en = lang === 'en';
  const [view, setView] = useState<PrjView>('plan');
  const [busy, setBusy] = useState('');
  const out = useMemo(() => buildPrjView(view, result, en ? 'en' : 'zh'), [view, result, en]);
  const svg = useMemo(() => (out ? toSvg(out.drawing, { fit: true }) : ''), [out]);
  const overlay = useRef<SVGSVGElement>(null);
  /* the screen ↔ model mapping is frozen when a drag starts: moving a projector changes the drawing's
     extents (and so its viewBox), which would otherwise shift the mapping under the pointer */
  const drag = useRef<{ h: PrjHandle; inv: DOMMatrix; minX: number; maxY: number } | null>(null);

  /* 人工调整:只改这一组的 manual,其余照旧;两项都清空 = 恢复自动 */
  const setManual = (gi: number, patch: Partial<Pick<PrjManual, 'd' | 'lensH'>>) => {
    onChange({
      ...cfg,
      prj_groups: cfg.prj_groups.map((g, i) => {
        if (i !== gi) return g;
        const next = { d: g.manual?.d, lensH: g.manual?.lensH, ...patch };
        const { manual: _old, ...rest } = g;
        return next.d == null && next.lensH == null ? rest : { ...rest, manual: { ...next, by, at: Date.now() } };
      }),
    });
  };

  /* screen → model (mm): the overlay shares the drawing's viewBox (toSvg: X = x − minX + PAD, Y = maxY + PAD − y) */
  const startDrag = (e: React.PointerEvent, h: PrjHandle) => {
    const ctm = overlay.current?.getScreenCTM();
    if (!ctm || !out) return;
    drag.current = { h, inv: ctm.inverse(), minX: out.drawing.bbox.minX, maxY: out.drawing.bbox.maxY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const f = drag.current;
    if (!f) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(f.inv);
    const m = { x: p.x + f.minX - PAD, y: f.maxY + PAD - p.y };
    const { h } = f;
    const ceil = cfg.prj_ceiling;
    if (h.kind === 'plan') {
      setManual(h.gi, { d: Math.max(0.1, r2(((m.x - h.wx) * h.nx + (m.y - h.wy) * h.ny) / 1000)) });
    } else if (h.floor) {
      setManual(h.gi, { d: clampM(m.y / 1000, 0.1, ceil) });
    } else {
      setManual(h.gi, { d: Math.max(0.1, r2((h.wallX - m.x) / 1000)), lensH: clampM(m.y / 1000, 0, ceil) });
    }
  };

  function download(name: string, body: BlobPart, mime: string) {
    const url = URL.createObjectURL(new Blob([body], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }
  async function exportFile(kind: 'dxf' | 'proposal', l: 'zh' | 'en' = 'zh') {
    setBusy(kind + l);
    const res = await fetch('/api/av/export/projector', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, lang: kind === 'dxf' ? (en ? 'en' : 'zh') : l, cfg, packVersion, title, client }),
    }).catch(() => null);
    setBusy('');
    if (!res?.ok) {
      const body = res ? await res.json().catch(() => ({})) : {};
      alert(body.error || t('导出失败', 'Export failed'));
      return;
    }
    const blob = await res.blob();
    download(kind === 'dxf' ? 'projection.dxf' : `projection-proposal-${l}.docx`, blob, blob.type);
  }

  const reds = result.findings.filter((f) => f.severity === 'block');
  const vb = out ? `0 0 ${out.drawing.bbox.maxX - out.drawing.bbox.minX + PAD * 2} ${out.drawing.bbox.maxY - out.drawing.bbox.minY + PAD * 2}` : '';
  const hr = out ? Math.max(out.drawing.bbox.maxX - out.drawing.bbox.minX, out.drawing.bbox.maxY - out.drawing.bbox.minY) * 0.012 : 0;
  const note = PRJ_VIEWS.find((v) => v.key === view)!;

  return (
    <div className="panel" style={{ padding: 0 }} data-testid="prj-drawings">
      <div className="panel-head" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="panel-title">{t('图纸', 'Drawings')}</span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {PRJ_VIEWS.map((v) => (
            <button key={v.key} data-testid={`prj-view-${v.key}`} onClick={() => setView(v.key)}
              className={view === v.key ? 'btn-navy sm' : 'btn-line sm'} style={{ fontSize: 12 }}>{en ? v.en : v.zh}</button>
          ))}
        </div>
      </div>
      <div style={{ padding: '12px 18px', display: 'grid', gap: 10 }}>
        <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>{en ? note.noteEn : note.noteZh}{!canAdjust && view !== 'elev' && view !== 'sch' ? t('（只读）', ' (read only)') : ''}</div>
        {out ? (
          <div style={{ position: 'relative', background: '#0E1013', borderRadius: 6, padding: 8 }}>
            <div data-testid="prj-view-svg" dangerouslySetInnerHTML={{ __html: svg }} />
            {canAdjust && out.handles.length > 0 && (
              <svg ref={overlay} viewBox={vb} preserveAspectRatio="xMinYMin meet" data-testid="prj-handles"
                style={{ position: 'absolute', left: 8, top: 8, width: 'calc(100% - 16px)', height: 'calc(100% - 16px)', touchAction: 'none' }}
                onPointerMove={onMove} onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; }}>
                {out.handles.map((h, i) => (
                  <circle key={i} data-testid={`prj-handle-${h.kind}-${h.gi}`} cx={h.x - out.drawing.bbox.minX + PAD} cy={out.drawing.bbox.maxY + PAD - h.y} r={hr}
                    fill="#FFFFFF33" stroke="#FFFFFF" strokeWidth={hr * 0.15} style={{ cursor: 'grab' }}
                    onPointerDown={(e) => startDrag(e, h)}>
                    <title>{t('拖动调整机位', 'Drag to move the projector')}</title>
                  </circle>
                ))}
              </svg>
            )}
          </div>
        ) : <p style={{ fontSize: 13, color: 'var(--text2)' }}>{t('参数无效，无法出图。', 'Invalid inputs — nothing to draw.')}</p>}

        {canAdjust && result.ok && (
          <div style={{ display: 'grid', gap: 6, fontSize: 12 }} data-testid="prj-manual">
            <div className="section-label" style={{ marginBottom: 0 }}>{t('机位人工调整', 'Adjust projector position')}
              <span style={{ fontWeight: 400, color: 'var(--text2)', marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>{t('留空 = 自动；改了会标「人工调整」并重新检查', 'Blank = automatic; a value is marked "adjusted by hand" and rechecked')}</span>
            </div>
            {result.groups.map((g, gi) => {
              const m = cfg.prj_groups[gi]?.manual;
              const numIn = (part: 'd' | 'lensH', auto: number) => (
                <input type="number" step="0.05" style={small} data-testid={`prj-manual-${part}-${gi}`} value={m?.[part] ?? ''} placeholder={auto.toFixed(2)}
                  onChange={(e) => setManual(gi, { [part]: e.target.value === '' ? undefined : Number(e.target.value) })} />
              );
              return (
                <div key={gi} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong style={{ minWidth: 70 }}>{g.group.name}</strong>
                  <span>{g.floor ? t('吊装高度 m', 'Hung at m') : t('投射 m', 'Throw m')}</span>{numIn('d', g.d)}
                  {!g.floor && <><span>{t('镜头离地 m', 'Lens height m')}</span>{numIn('lensH', g.lensH)}</>}
                  {g.manual && <>
                    <span style={{ color: 'var(--warning)' }} data-testid={`prj-manual-tag-${gi}`}>{t('人工调整', 'Adjusted by hand')} · {g.manual}</span>
                    <button style={linkBtn} data-testid={`prj-manual-reset-${gi}`} onClick={() => setManual(gi, { d: undefined, lensH: undefined })}>{t('恢复自动', 'Back to automatic')}</button>
                  </>}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {out && <button className="btn-line" onClick={() => download(`projection-${view}.svg`, toSvg(out.drawing), 'image/svg+xml')} data-testid="prj-export-svg">
            <Icon name="download" size={14} /> SVG</button>}
          {canExport && <>
            <button className="btn-line" disabled={!!busy} onClick={() => exportFile('dxf')} data-testid="prj-export-dxf"><Icon name="download" size={14} /> DXF</button>
            <button className="btn-line" disabled={!!busy} onClick={() => exportFile('proposal', 'zh')} data-testid="prj-export-zh"><Icon name="download" size={14} /> {t('技术方案（中文）', 'Proposal (Chinese)')}</button>
            <button className="btn-line" disabled={!!busy} onClick={() => exportFile('proposal', 'en')} data-testid="prj-export-en"><Icon name="download" size={14} /> {t('技术方案（英文）', 'Proposal (English)')}</button>
          </>}
          {busy && <span style={{ fontSize: 12, color: 'var(--text2)' }}>{t('生成中…', 'Generating…')}</span>}
        </div>
        {canExport && (reds.length ? (
          <div style={{ fontSize: 12, color: 'var(--danger)' }} data-testid="prj-export-blocked">{t(`有 ${reds.length} 个红项：DXF 和技术方案要改好后才能导出。`, `${reds.length} red finding${reds.length > 1 ? 's' : ''}: fix them before exporting the DXF or proposal.`)}</div>
        ) : !result.pack.calibrated && (
          <div style={{ fontSize: 12, color: 'var(--warning)' }} data-testid="prj-export-stamp">{t('规则包常数还没全部确认：导出的 DXF 和技术方案上会标「部分常数待校准」。', 'Not every constant is confirmed yet: the exported DXF and proposal are marked "some constants not yet calibrated".')}</div>
        ))}
      </div>
    </div>
  );
}
