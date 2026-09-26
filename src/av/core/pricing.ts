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

/* The 05 result a cost sheet is built from (spec §10 config_result). Every
   line's summary says whether the configuration may be quoted at all. */
export interface SummaryBase {
  exportable: boolean;       // false when a blocking finding stands (LED-TYPE-01, PRJ-TYPE-01 …)
  blocking: string[];
}

export interface LedSummary extends SummaryBase {
  sqm: number;
  pitch: number;
  screenType: string;
  mods: number;
  cabinets: number;
  nPowerCable: number;       // F7, spare included
  nDataCable: number;        // F9, spare included
  powerCableSpec: string;
}

export interface PrjSummary extends SummaryBase {
  width: number;
  height: number;
  area: number;
  nProj: number;
  lmProj: number;
  throwRatio: number;
  pxW: number;
  pxH: number;
  kw: number;
  nCircuit: number;
  nSignalCable: number;      // P10, spare included
  profile: string;
  content: string;
}

export interface ElvSummary extends SummaryBase {
  area: number;
  floors: number;
  space: string;
  subsystems: string[];      // cctv / access / net / pa
  nOutlet: number;
  nAp: number;
  nCam: number;
  nDoor: number;
  nPort: number;
  nSwitch: number;
  poeW: number;
  nBox: number;
  nPatch: number;
  nSpk: number;
  ampW: number;
  nPaZone: number;
  nvrTb: number;
  nNvr: number;
  nRack: number;
}

export interface PvSummary extends SummaryBase {
  area: number;
  mount: string;
  module: string;
  modW: number;              // Wp per module, the basis of the module count
  nMod: number;
  kwp: number;
  invKw: number;             // rated kW per inverter
  nInv: number;
  acKw: number;
  nStr: number;
  dcM: number;
  acM: number;
  nMc4: number;
  yieldKwh: number;
}

export interface SavedConfig<S extends SummaryBase = LedSummary> {
  id: number;
  projectId: string;
  line: BusinessLine;
  packVersion: string;
  drawingId: number | null;
  summary: S;
  createdBy: string;
  createdAt: number;
}

export interface CostLine {
  key: string;               // display | power_cable | data_cable | m1, m2 … (added lines)
  name: string;
  qty: number;
  unit: string;
  qtySource: string;         // rule id (F1, P2, S7 …) for computed quantities, a note for fixed ones, 人工 for added lines
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
  lines: CostLine[], cfg: SavedConfig<SummaryBase>, items: PriceItem[], marginFloor: number, today: string,
  extra: CostCheck[] = [],
): CostCheck[] {
  const out: CostCheck[] = [...extra];
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

/* ===== projection line ===== */

/* The rating printed in the library's spec column: "12,000 lm" → 12000,
   "650 W" → 650. */
export const specNumber = (spec: string): number | null => {
  const m = /(\d+(?:\.\d+)?)/.exec(spec.replace(/,/g, ''));
  return m ? Number(m[1]) : null;
};
export const lumensOf = specNumber;

export interface PrjPicks { projector: number | null; screen: number | null; signal_cable: number | null; mount: number | null; blend: number | null }

export function buildPrjLines(cfg: SavedConfig<PrjSummary>, picks: PrjPicks, manual: ManualLine[], items: PriceItem[]): CostLine[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const priced = (key: string, name: string, qty: number, unit: string, qtySource: string, itemId: number | null): CostLine => {
    const it = itemId === null ? undefined : byId.get(itemId);
    return { key, name, qty, unit, qtySource, itemId: it ? it.id : null, itemLabel: it ? itemLabel(it) : '',
      unitCost: it?.costPrice ?? null, unitList: it?.listPrice ?? null };
  };
  const s = cfg.summary;
  return [
    priced('projector', `投影机（单机 ≥ ${Math.ceil(s.lmProj).toLocaleString('en-US')} lm）`, s.nProj, '台', 'P2', picks.projector),
    priced('screen', '投影幕 / 投影面', round2(s.area), '㎡', 'P1', picks.screen),
    priced('signal_cable', '信号线（含 1 备用）', s.nSignalCable, '根', 'P10', picks.signal_cable),
    priced('mount', '投影机吊架', s.nProj, '套', 'P2', picks.mount),
    ...(s.nProj > 1 ? [priced('blend', '融合处理器', 1, '套', 'P2', picks.blend)] : []),
    ...manual.map((m) => priced(m.key, m.name, m.qty, m.unit, '人工', m.itemId)),
  ];
}

/* The chosen projector must reach the brightness P6 asks for. */
export function prjChecks(lines: CostLine[], cfg: SavedConfig<PrjSummary>, items: PriceItem[]): CostCheck[] {
  const line = lines.find((l) => l.key === 'projector');
  const it = line?.itemId == null ? undefined : items.find((i) => i.id === line.itemId);
  if (!it) return [];
  const lm = lumensOf(it.pitch);
  if (lm === null) return [{ code: 'PRJ-COST-LM', severity: 'warn', message: `「${itemLabel(it)}」未注明亮度（规格栏如 12000 lm），无法核对是否满足单机 ${Math.ceil(cfg.summary.lmProj)} lm。` }];
  return lm < cfg.summary.lmProj
    ? [{ code: 'PRJ-COST-LM', severity: 'block', message: `所选投影机 ${lm.toLocaleString('en-US')} lm 低于单机所需 ${Math.ceil(cfg.summary.lmProj).toLocaleString('en-US')} lm。` }]
    : [];
}

/* ===== ELV line ===== */

export type ElvPicks = Partial<Record<'outlet' | 'ap' | 'cam' | 'door' | 'switch' | 'patch' | 'cable' | 'spk' | 'amp' | 'nvr' | 'hdd' | 'rack', number | null>>;

export function buildElvLines(cfg: SavedConfig<ElvSummary>, picks: ElvPicks, manual: ManualLine[], items: PriceItem[]): CostLine[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const s = cfg.summary;
  const rows: [keyof ElvPicks, string, number, string, string][] = [
    ['outlet', '数据点位（面板 + 模块）', s.nOutlet, '个', 'E1'],
    ['ap', '无线 AP', s.nAp, '台', 'E2'],
    ['cam', '网络摄像机', s.nCam, '台', 'E3'],
    ['door', '门禁点（读卡器 + 电锁 + 按钮）', s.nDoor, '套', 'E4'],
    ['switch', '接入交换机（PoE）', s.nSwitch, '台', 'E6'],
    ['patch', '配线架', s.nPatch, '个', 'E9'],
    ['cable', '六类线（305 m / 箱）', s.nBox, '箱', 'E8'],
    ['spk', '吸顶扬声器', s.nSpk, '只', 'E10'],
    ['amp', `功放（每区 ≥ ${Math.ceil(s.nPaZone ? s.ampW / s.nPaZone : 0)} W）`, s.nPaZone, '台', 'E11'],
    ['nvr', '网络录像机 NVR', s.nNvr, '台', 'E12'],
    ['hdd', `录像硬盘（${s.nvrTb.toFixed(1)} TB）`, Math.ceil(s.nvrTb), 'TB', 'E12'],
    ['rack', '机柜 42U', s.nRack, '台', 'E13'],
  ];
  const line = (key: string, name: string, qty: number, unit: string, qtySource: string, itemId: number | null): CostLine => {
    const it = itemId == null ? undefined : byId.get(itemId);
    return { key, name, qty, unit, qtySource, itemId: it ? it.id : null, itemLabel: it ? itemLabel(it) : '',
      unitCost: it?.costPrice ?? null, unitList: it?.listPrice ?? null };
  };
  return [
    ...rows.filter((r) => r[2] > 0).map(([k, n, q, u, src]) => line(k, n, q, u, src, picks[k] ?? null)),
    ...manual.map((m) => line(m.key, m.name, m.qty, m.unit, '人工', m.itemId)),
  ];
}

/* Each zone's amplifier must carry that zone's speaker load (E11). */
export function elvChecks(lines: CostLine[], cfg: SavedConfig<ElvSummary>, items: PriceItem[]): CostCheck[] {
  const l = lines.find((x) => x.key === 'amp');
  const it = l?.itemId == null ? undefined : items.find((i) => i.id === l.itemId);
  if (!it || !cfg.summary.nPaZone) return [];
  const need = cfg.summary.ampW / cfg.summary.nPaZone;
  const w = specNumber(it.pitch);
  if (w === null) return [{ code: 'ELV-COST-AMP', severity: 'warn', message: `「${itemLabel(it)}」未注明功率（规格栏如 650 W），无法核对是否满足每区 ${Math.ceil(need)} W。` }];
  return w < need ? [{ code: 'ELV-COST-AMP', severity: 'block', message: `所选功放 ${w} W 低于每区所需 ${Math.ceil(need)} W。` }] : [];
}

/* ===== Solar PV line ===== */

export type PvPicks = Partial<Record<'module' | 'inverter' | 'mount' | 'dc_cable' | 'ac_cable' | 'connector' | 'acdb' | 'monitor', number | null>>;

export function buildPvLines(cfg: SavedConfig<PvSummary>, picks: PvPicks, manual: ManualLine[], items: PriceItem[]): CostLine[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const s = cfg.summary;
  const rows: [keyof PvPicks, string, number, string, string][] = [
    ['module', `光伏组件（${s.modW} Wp）`, s.nMod, '块', 'S2'],
    ['inverter', `并网逆变器（${s.invKw} kW）`, s.nInv, '台', 'S4'],
    ['mount', '支架与压块（每块组件）', s.nMod, '套', 'S2'],
    ['dc_cable', '直流光伏线', s.dcM, 'm', 'S7'],
    ['ac_cable', '交流电缆', s.acM, 'm', 'S7'],
    ['connector', 'MC4 连接器', s.nMc4, '对', 'S7'],
    ['acdb', '交流配电箱（隔离开关、防雷、保护）', 1, '套', '每项目 1 套'],
    ['monitor', '监控与数据采集', 1, '套', '每项目 1 套'],
  ];
  const line = (key: string, name: string, qty: number, unit: string, qtySource: string, itemId: number | null): CostLine => {
    const it = itemId == null ? undefined : byId.get(itemId);
    return { key, name, qty, unit, qtySource, itemId: it ? it.id : null, itemLabel: it ? itemLabel(it) : '',
      unitCost: it?.costPrice ?? null, unitList: it?.listPrice ?? null };
  };
  return [
    ...rows.map(([k, n, q, u, src]) => line(k, n, q, u, src, picks[k] ?? null)),
    ...manual.map((m) => line(m.key, m.name, m.qty, m.unit, '人工', m.itemId)),
  ];
}

/* The module count assumes the configured wattage, and each inverter must
   carry its rated share (S2, S4); both ratings sit in the spec column. */
export function pvChecks(lines: CostLine[], cfg: SavedConfig<PvSummary>, items: PriceItem[]): CostCheck[] {
  const picked = (key: string) => {
    const l = lines.find((x) => x.key === key);
    return l?.itemId == null ? undefined : items.find((i) => i.id === l.itemId);
  };
  const out: CostCheck[] = [];
  const mod = picked('module');
  if (mod) {
    const w = specNumber(mod.pitch);
    if (w === null) out.push({ code: 'PV-COST-MOD', severity: 'warn', message: `「${itemLabel(mod)}」未注明功率（规格栏如 550 Wp），无法核对组件数量的依据。` });
    else if (w !== cfg.summary.modW) out.push({ code: 'PV-COST-MOD', severity: 'block', message: `所选组件 ${w} Wp 与方案的 ${cfg.summary.modW} Wp 不一致，组件数量须按所选型号重算 05 方案。` });
  }
  const inv = picked('inverter');
  if (inv) {
    const kw = specNumber(inv.pitch);
    if (kw === null) out.push({ code: 'PV-COST-INV', severity: 'warn', message: `「${itemLabel(inv)}」未注明额定功率（规格栏如 50 kW），无法核对。` });
    else if (kw < cfg.summary.invKw) out.push({ code: 'PV-COST-INV', severity: 'block', message: `所选逆变器 ${kw} kW 低于方案的 ${cfg.summary.invKw} kW。` });
  }
  return out;
}

export const round2 = (x: number) => Math.round(x * 100) / 100;
