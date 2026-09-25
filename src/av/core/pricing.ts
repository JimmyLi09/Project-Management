/* ===== 06 成本核算 · LED single line =====
   Bill of quantities from a saved 05 configuration, priced from the price
   library. Prices change (the library is edited over time), so every cost line
   keeps a snapshot of the unit prices it was computed with: a saved sheet never
   moves on its own, and the checks say when the library has moved under it. */

import type { BusinessLine } from './types.ts';

export interface PriceItem {
  id: number;
  line: BusinessLine;
  category: string;          // hard_smd, gob, …, or any category an editor adds (线材、控制系统…)
  categoryLabel: string;
  model: string;
  pitch: string;             // as printed, e.g. "P1.86", "3.91-7.81mm"
  moduleSize: string;
  cabinetSize: string;
  unit: string;              // ㎡, 台, 根, 项 …
  costPrice: number | null;  // Partner Price in the 2026 cost book
  listPrice: number | null;  // MSRP in the 2026 cost book
  currency: string;
  source: string;
  validUntil: string;        // YYYY-MM-DD, '' = open-ended
  active: boolean;
  updatedBy: string;
  updatedAt: number;
}

/* First number in the printed pitch: "P1.875" → 1.875, "2.8-5.6mm" → 2.8. */
export function pitchOf(label: string): number | null {
  const m = /(\d+(?:\.\d+)?)/.exec(label);
  return m ? Number(m[1]) : null;
}

/* The 05 result a cost sheet is built from (spec §10 config_result). */
export interface SavedConfig {
  id: number;
  projectId: string;
  packVersion: string;
  drawingId: number | null;
  summary: {
    sqm: number;
    pitch: number;
    screenType: string;
    mods: number;
    cabinets: number;
    nPowerCable: number;     // F7, spare included
    nDataCable: number;      // F9, spare included
    powerCableSpec: string;
    exportable: boolean;     // false when LED-TYPE-01 or another block stands
    blocking: string[];      // codes of blocking findings
  };
  createdBy: string;
  createdAt: number;
}

export interface CostLine {
  key: string;               // display | power_cable | data_cable | m1, m2 … (added lines)
  name: string;
  qty: number;
  unit: string;
  qtySource: string;         // F1 / F7 / F9 for computed quantities, 人工 for added lines
  itemId: number | null;
  itemLabel: string;
  unitCost: number | null;   // snapshot at computation time
  unitList: number | null;
}

export const itemLabel = (i: PriceItem) =>
  [i.categoryLabel, i.model, i.pitch, i.cabinetSize].filter(Boolean).join(' · ');

/* Display items that fit the configured pitch come first; the rest follow. */
export function displayCandidates(items: PriceItem[], pitch: number): PriceItem[] {
  const sqm = items.filter((i) => i.active && i.unit === '㎡');
  const fits = (i: PriceItem) => { const p = pitchOf(i.pitch); return p !== null && Math.abs(p - pitch) < 1e-3; };
  return [...sqm.filter(fits), ...sqm.filter((i) => !fits(i))];
}

export interface ManualLine { key: string; name: string; qty: number; unit: string; itemId: number | null }
export interface Picks { display: number | null; power_cable: number | null; data_cable: number | null }

export function buildLedLines(cfg: SavedConfig, picks: Picks, manual: ManualLine[], items: PriceItem[]): CostLine[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const priced = (key: string, name: string, qty: number, unit: string, qtySource: string, itemId: number | null): CostLine => {
    const it = itemId === null ? undefined : byId.get(itemId);
    return {
      key, name, qty, unit, qtySource, itemId: it ? it.id : null, itemLabel: it ? itemLabel(it) : '',
      unitCost: it?.costPrice ?? null, unitList: it?.listPrice ?? null,
    };
  };
  const s = cfg.summary;
  return [
    priced('display', `LED 显示屏 P${s.pitch}`, round2(s.sqm), '㎡', 'F1', picks.display),
    priced('power_cable', `电源线 ${s.powerCableSpec}（含 1 备用）`, s.nPowerCable, '根', 'F7', picks.power_cable),
    priced('data_cable', '数据线（含 1 备用）', s.nDataCable, '根', 'F9', picks.data_cable),
    ...manual.map((m) => priced(m.key, m.name, m.qty, m.unit, '人工', m.itemId)),
  ];
}

export interface Totals { cost: number; list: number; margin: number | null }

export function totals(lines: CostLine[]): Totals {
  const cost = round2(lines.reduce((a, l) => a + (l.unitCost ?? 0) * l.qty, 0));
  const list = round2(lines.reduce((a, l) => a + (l.unitList ?? 0) * l.qty, 0));
  return { cost, list, margin: list > 0 ? (list - cost) / list : null };
}

export interface CostCheck { code: string; severity: 'block' | 'warn' | 'ok'; message: string }

/* 提交前检查 (prototype Summary.dc.html): what stops a sheet from being
   confirmed, and what only needs a look. */
export function checkSheet(
  lines: CostLine[], cfg: SavedConfig, items: PriceItem[], marginFloor: number, today: string,
): CostCheck[] {
  const out: CostCheck[] = [];
  const byId = new Map(items.map((i) => [i.id, i]));
  if (!cfg.summary.exportable) {
    out.push({ code: 'COST-CFG', severity: 'block',
      message: `方案存在阻断项（${cfg.summary.blocking.join('、')}），不得用于正式报价。` });
  }
  for (const l of lines) {
    const it = l.itemId === null ? undefined : byId.get(l.itemId);
    if (!it) { out.push({ code: 'COST-ITEM', severity: 'block', message: `「${l.name}」未选择价格库条目。` }); continue; }
    if (it.unit !== l.unit) out.push({ code: 'COST-UNIT', severity: 'block', message: `「${l.name}」按 ${l.unit} 计，所选条目按 ${it.unit} 计价。` });
    if (l.unitCost === null || l.unitList === null) out.push({ code: 'COST-PRICE', severity: 'block', message: `「${it.model || it.pitch || it.categoryLabel}」缺少成本价或售价，需在价格库补全。` });
    if (!it.active) out.push({ code: 'COST-INACTIVE', severity: 'warn', message: `「${itemLabel(it)}」已在价格库停用。` });
    if (it.validUntil && it.validUntil < today) out.push({ code: 'COST-EXPIRED', severity: 'warn', message: `「${itemLabel(it)}」价格已于 ${it.validUntil} 过期，需更新后重算。` });
    if (it.costPrice !== l.unitCost || it.listPrice !== l.unitList) {
      out.push({ code: 'COST-STALE', severity: 'warn', message: `「${itemLabel(it)}」价格库已变动（成本 ${it.costPrice ?? '—'} / 售价 ${it.listPrice ?? '—'}），本表仍按 ${l.unitCost ?? '—'} / ${l.unitList ?? '—'}，可重算。` });
    }
  }
  const t = totals(lines);
  if (t.margin !== null && !out.some((c) => c.severity === 'block')) {
    const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
    out.push(t.margin < marginFloor
      ? { code: 'COST-MARGIN', severity: 'warn', message: `毛利率 ${pct(t.margin)} 低于公司下限 ${pct(marginFloor)}。` }
      : { code: 'COST-MARGIN', severity: 'ok', message: `毛利率 ${pct(t.margin)} 不低于公司下限 ${pct(marginFloor)}。` });
  }
  return out;
}

export const round2 = (x: number) => Math.round(x * 100) / 100;
