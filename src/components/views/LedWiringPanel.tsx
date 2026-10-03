'use client';

/* ===== AV-019 §2.3 线路图 + 人工调整电源回路 / 网线 =====
   工具栏三个按钮:「调整电源回路」「调整网线」「恢复自动」。
   调整电源回路:选一个回路(或「＋ 新回路」),点或框选箱体,箱体就划给这一路;
   调整网线:选一条网线(或「＋ 新网线」),按顺序点箱体定义串接先后,可以改网口号。
   改的是 cfg.led_wiring_override;数字全部由内核按它重算,这里只负责点选。 */

import React, { useRef, useState } from 'react';

import type { ComputeResult } from '@/av/core/compute';
import { CIRCUIT_COLORS, RUN_COLORS, type Drawing } from '@/av/core/drawing';
import { appendToRun, assignCircuit, beginEdit, circuitNumbers, clearRun, manualLabel, runNumbers, setPort } from '@/av/core/override';
import { PAD } from '@/av/core/svg';
import type { WiringOverride } from '@/av/core/types';
import { cellId } from '@/av/core/wiring';
import { useLang } from '@/lib/i18n';

type Mode = 'power' | 'data' | null;

export default function LedWiringPanel({ result, drawing, svg, zoom, by, override, onOverride }: {
  result: ComputeResult;
  drawing: Drawing;
  svg: string;
  zoom: 'fit' | 'full';
  by: string;
  override: WiringOverride | undefined;
  /* 用「在最新那份上改」的写法:连着点几下时,每一下都叠在上一下的结果上 */
  onOverride: (f: (prev: WiringOverride | undefined) => WiringOverride | undefined) => void;
}) {
  const { t } = useLang();
  const [mode, setMode] = useState<Mode>(null);
  const [pick, setSel] = useState(1);
  const box = useRef<HTMLDivElement>(null);
  /* 按下的位置放 ref:点得快时 mouseup 可能赶在重新渲染之前,state 还没更新 */
  const dragRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [drag, setDragState] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const setDrag = (d: typeof drag) => { dragRef.current = d; setDragState(d); };
  const w = result.wiring!;
  const lay = result.layout!;
  const chain = w.algo === 'chain';
  const ov = override;
  const limitW = w.limitW;
  const cap = result.pack.control.dataPx;

  function start(part: 'power' | 'data') {
    if (mode === part) { setMode(null); return; }
    const next = beginEdit(result, ov, part, by);
    if (!next) return;
    onOverride(() => next);
    setMode(part);
    setSel(1);
  }
  function restore() {
    if (!confirm(t('恢复自动结果？人工调整会去掉（已存的历史版本里还在）。', 'Restore the automatic result? The manual wiring is dropped (saved versions keep it).'))) return;
    onOverride(() => undefined);
    setMode(null);
  }

  /* 屏幕坐标 → 模型坐标(mm,Y 向上) → 箱体 */
  function toModel(clientX: number, clientY: number) {
    const el = box.current?.querySelector('svg') as SVGSVGElement | null;
    const m = el?.getScreenCTM();
    if (!el || !m) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: p.x + drawing.bbox.minX - PAD, y: drawing.bbox.maxY + PAD - p.y };
  }
  const cellsIn = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    return lay.cells.filter((c) => c.x < x1 && c.x + c.w > x0 && c.y < y1 && c.y + c.h > y0);
  };

  function down(e: React.MouseEvent) {
    if (!mode) return;
    const r = box.current!.getBoundingClientRect();
    setDrag({ x0: e.clientX - r.left, y0: e.clientY - r.top, x1: e.clientX - r.left, y1: e.clientY - r.top });
  }
  function move(e: React.MouseEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const r = box.current!.getBoundingClientRect();
    setDrag({ ...drag, x1: e.clientX - r.left, y1: e.clientY - r.top });
  }
  function up(e: React.MouseEvent) {
    const drag = dragRef.current;
    if (!mode || !drag || !ov) { setDrag(null); return; }
    const r = box.current!.getBoundingClientRect();
    const a = toModel(drag.x0 + r.left, drag.y0 + r.top), b = toModel(e.clientX, e.clientY);
    const far = Math.hypot(e.clientX - r.left - drag.x0, e.clientY - r.top - drag.y0) > 6;
    setDrag(null);
    if (!a || !b) return;
    /* 点一下 = 那一只;拖一个框 = 框到的全部(网线只认点选,顺序才清楚) */
    const hit = far && mode === 'power' ? cellsIn(a, b) : cellsIn(b, b);
    if (!hit.length) return;
    const ids = hit.map(cellId), no = sel;
    if (mode === 'power') onOverride((prev) => (prev ? assignCircuit(prev, ids, no, by) : prev));
    else onOverride((prev) => (prev ? appendToRun(prev, ids[0], no, by) : prev));
  }

  /* 色板上每一路 / 每一条的实时数字(按调整里的编号算,不受空号影响) */
  const idx = new Map(lay.cells.map((c, i) => [cellId(c), i]));
  const sumOf = (pick: (c: WiringOverride['cells'][number]) => boolean, arr: number[]) =>
    (ov?.cells ?? []).filter(pick).reduce((a, c) => a + (arr[idx.get(c.id) ?? -1] ?? 0), 0);
  const chips = !ov || !mode ? [] : (mode === 'power' ? circuitNumbers(ov) : runNumbers(ov));
  const nextNo = Math.max(0, ...chips) + 1;
  const sel = Math.min(pick, nextNo);
  const unP = ov ? ov.cells.filter((c) => c.circuit == null).length : 0;
  const unD = ov ? ov.cells.filter((c) => c.run == null).length : 0;
  const manual = result.manual;

  return (
    <>
      {chain && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }} data-testid="led-wiring-tools">
          <button className={mode === 'power' ? 'btn-navy sm' : 'btn-line sm'} onClick={() => start('power')} data-testid="led-edit-power">
            {mode === 'power' ? t('完成调整电源', 'Done (power)') : t('调整电源回路', 'Adjust power circuits')}
          </button>
          <button className={mode === 'data' ? 'btn-navy sm' : 'btn-line sm'} onClick={() => start('data')} data-testid="led-edit-data">
            {mode === 'data' ? t('完成调整网线', 'Done (data)') : t('调整网线', 'Adjust data runs')}
          </button>
          <button className="btn-line sm" disabled={!ov} style={!ov ? { opacity: 0.45, cursor: 'not-allowed' } : undefined} onClick={restore} data-testid="led-restore">
            {t('恢复自动', 'Restore automatic')}
          </button>
          {manual && (
            <span style={{ fontSize: 12, color: 'var(--warning)' }} data-testid="led-manual">
              {t('人工调整', 'Manual')} · {manualLabel(manual)}
              {' · '}{[manual.power && t('电源', 'power'), manual.data && t('网线', 'data')].filter(Boolean).join(t('、', ' & '))}
            </span>
          )}
        </div>
      )}
      {!chain && (
        <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>
          {t('手动调整电源回路 / 网线要先升级到 led@1.1。', 'Manual wiring needs rule pack led@1.1 — upgrade first.')}
        </div>
      )}

      {mode && ov && (
        <div style={{ display: 'grid', gap: 8, padding: '10px 12px', borderRadius: 6, background: 'var(--hover-bg)', marginBottom: 10, fontSize: 12.5 }} data-testid="led-palette">
          <div style={{ color: 'var(--text2)' }}>
            {mode === 'power'
              ? t('选一个回路，再点箱体或拖框选一片，箱体就划给这一路。每路实时显示功率和电流，超上限标红。',
                'Pick a circuit, then click a cabinet or drag a box — those cabinets move to that circuit. Load and current update live; over-limit turns red.')
              : t('选一条网线，按顺序点箱体，定义串接先后。点到别的网线上的箱体会从那条摘下来。超 560,000 px 标红。',
                'Pick a data run, then click cabinets in order to chain them. A cabinet taken from another run leaves it. Over 560,000 px turns red.')}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[...chips, nextNo].map((n) => {
              const isNew = n === nextNo;
              const col = (mode === 'power' ? CIRCUIT_COLORS : RUN_COLORS)[(n - 1) % (mode === 'power' ? CIRCUIT_COLORS.length : RUN_COLORS.length)];
              const val = mode === 'power' ? sumOf((c) => c.circuit === n, w.cellW) : sumOf((c) => c.run === n, w.cellPx);
              const over = mode === 'power' ? val > limitW + 1e-6 : val > cap;
              const label = isNew
                ? (mode === 'power' ? t('＋ 新回路', '+ New circuit') : t('＋ 新网线', '+ New run'))
                : mode === 'power'
                  ? `${t('回路', 'C')} ${n} · ${Math.round(val)} W${w.voltage ? ` · ${(val / w.voltage).toFixed(1)} A` : ''}`
                  : `${t('网线', 'Run')} ${n} · ${val.toLocaleString('en-US')} px`;
              return (
                <button key={n} onClick={() => setSel(n)} data-testid={`led-chip-${n}`}
                  style={{ padding: '5px 10px', borderRadius: 14, fontSize: 12, border: `2px solid ${sel === n ? 'var(--navy700)' : 'transparent'}`,
                    background: over ? 'var(--danger-bg, #FDF0EC)' : 'var(--card)', color: over ? 'var(--danger)' : 'var(--text)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  {!isNew && <span style={{ width: 10, height: 10, borderRadius: 5, background: col, display: 'inline-block' }} />}
                  {label}{over ? ` ✕ ${t('超限', 'over')}` : ''}
                </button>
              );
            })}
          </div>
          {mode === 'data' && chips.includes(sel) && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                {t(`网线 ${sel} 接控制器网口`, `Run ${sel} on controller port`)}
                <input type="number" min={1} style={{ width: 64 }} data-testid="led-port"
                  value={ov.ports?.[String(sel)] ?? sel}
                  onChange={(e) => { const v = Math.max(1, Math.round(+e.target.value || 1)); onOverride((prev) => (prev ? setPort(prev, sel, v, by) : prev)); }} />
              </label>
              <button style={{ textDecoration: 'underline', fontSize: 12 }} onClick={() => onOverride((prev) => (prev ? clearRun(prev, sel, by) : prev))} data-testid="led-clear-run">
                {t('清空这条，重新按顺序点', 'Clear this run and click again')}
              </button>
            </div>
          )}
          {(mode === 'power' ? unP : unD) > 0 && (
            <div style={{ color: 'var(--danger)' }} data-testid="led-unassigned">
              {mode === 'power'
                ? t(`还有 ${unP} 只箱体没分配回路（图上红框）`, `${unP} cabinets not on any circuit (red frames)`)
                : t(`还有 ${unD} 只箱体没接网线（图上红框）`, `${unD} cabinets not on any data run (red frames)`)}
            </div>
          )}
        </div>
      )}

      <div ref={box} data-testid="led-svg-box" style={{ position: 'relative', overflow: 'auto', maxHeight: zoom === 'full' ? 640 : undefined, background: '#0E1013', borderRadius: 6, padding: 8,
        cursor: mode ? 'crosshair' : undefined, userSelect: mode ? 'none' : undefined }}
        onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={() => setDrag(null)}>
        <div data-testid="led-svg" dangerouslySetInnerHTML={{ __html: svg }} />
        {drag && Math.hypot(drag.x1 - drag.x0, drag.y1 - drag.y0) > 6 && mode === 'power' && (
          <div style={{ position: 'absolute', left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0),
            border: '1.5px dashed #F5B83D', background: '#F5B83D22', pointerEvents: 'none' }} />
        )}
      </div>
    </>
  );
}
