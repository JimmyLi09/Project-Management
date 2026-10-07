/* ===== 06 成本核算 · LED single line =====
   Bill of quantities from a saved 05 configuration, priced from the price
   library. Prices change (the library is edited over time), so every cost line
   keeps a snapshot of the unit prices it was computed with: a saved sheet never
   moves on its own, and the checks say when the library has moved under it. */

import type { CtrlKind } from './controller.ts';
import { PRJ_PART_CATEGORY, PRJ_PROJECTOR_CATEGORY, type PrjDeviceSpec, type PrjPartRole } from './prj/library.ts';
import type { BusinessLine } from './types.ts';
import type { SharedTag } from './xline.ts';

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
  /* AV-019:设备库(LED「控制系统」分类)的规格 —— 网口、带载、最大宽高、输入、能否独立播放;
     AV-020:投影机 / 镜头 / 投影配套的规格(prj/library.ts) */
  spec?: CtrlSpec | PrjDeviceSpec | null;
}

export interface CtrlSpec {
  kind: CtrlKind;
  brand?: string;
  ports: number;
  loadPx: number;
  maxW: number;
  maxH: number;
  inputs: string[];
  standalone: boolean;
}
/* 设备库的分类代码 */
export const CTRL_CATEGORY = 'control';
export const isCtrlSpec = (s: PriceItem['spec']): s is CtrlSpec => !!s && ['player', 'video', 'large', 'media', 'pc'].includes(s.kind);

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
  /* AV-019 F11:控制器 / 播放盒、媒体播放器、播控电脑(保存时按设备库和 01 的回答选好) */
  ctrl?: LedCtrlSummary;
  /* AV-015: a curved screen, tiled along its arc; 06 adds the curved build as a line to be quoted */
  curve?: { shape: 'concave' | 'convex'; arc: number; width: number; given: 'arc' | 'chord' | 'unknown'; radius: number | null; rise: number | null };
}

export interface LedCtrlSummary {
  model: string | null;           // null = 单台都不满足
  kind: CtrlKind | null;
  itemId: number | null;
  needMedia: boolean;
  mediaItemId: number | null;
  needPc: boolean;
  pcItemId: number | null;
  pending: boolean;               // 01 还没定播放内容,按会议 / 演示先给的
  manual: boolean;                // 05 里人工改选
  use: string;
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
  /* prj@0.2 (AV-020): blend groups and interaction, for the 06 device rows */
  groups?: { name: string; projector: string; lens: string; n: number; faces: number; model?: string }[];
  interact?: 'none' | 'wall' | 'floor';
  /* AV-020 §3.6:配套设备数量(prj/system.ts,保存时算好);有它 06 就按配置模板出行 */
  system?: { pcs: number; blends: number; boxes: number; radars: number | null; boxPerSet: number };
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
  shared?: SharedTag;        // cross-line shared resource (xline.ts)
}

export const itemLabel = (i: PriceItem) =>
  [i.categoryLabel, i.model, i.pitch, i.cabinetSize].filter(Boolean).join(' · ');

/* AV-018:按面积计价的单位,几种写法都认(手工录入常写 m² / m2 / sqm) */
export const sqmUnit = (u: string) => /^(㎡|m²|m\^?2|sqm|sq\.?\s*m|平方米?)$/i.test(u.trim());
const sameUnit = (a: string, b: string) => a.trim() === b.trim() || (sqmUnit(a) && sqmUnit(b));

/* Display items that fit the configured pitch come first; the rest follow. */
export function displayCandidates(items: PriceItem[], pitch: number): PriceItem[] {
  const sqm = items.filter((i) => i.active && sqmUnit(i.unit));
  /* 与 06 的阻断检查(ledChecks)同一条规则:区间型号落在区间里也算合适 */
  const fits = (i: PriceItem) => pitchFits(i.pitch, pitch) === true;
  return [...sqm.filter(fits), ...sqm.filter((i) => !fits(i))];
}

export interface ManualLine { key: string; name: string; qty: number; unit: string; itemId: number | null; shared?: SharedTag }
const tagged = (l: CostLine, shared?: SharedTag): CostLine => (shared ? { ...l, shared } : l);
export interface Picks {
  display: number | null; power_cable: number | null; data_cable: number | null; curve?: number | null;
  /* AV-019:缺省用保存方案时 F11 选好的那一项 */
  controller?: number | null; media_player?: number | null; playback_pc?: number | null;
}
/* AV-019:设备行 —— 没价格写「待报价」,不阻断确认成本 */
export const CTRL_LINE_KEYS = ['controller', 'media_player', 'playback_pc'] as const;
/* AV-020 §3.6:投影配置模板的行(投影机按机型一行 projector:<代码>,配套 p_<角色>),同样待报价不阻断 */
export const isPrjTplKey = (k: string) => k.startsWith('projector:') || k.startsWith('p_');
const quoteLater = (k: string) => (CTRL_LINE_KEYS as readonly string[]).includes(k) || isPrjTplKey(k);
const KIND_ZH: Record<string, string> = { player: '多媒体播放盒', video: '视频控制器', large: '大型控制器' };

/* AV-015 §4.4: the core has no curvature, so the curved build is a line of its own until it is quoted. */
export const CURVE_LINE_NAME = '弧形箱体 / 柔性模组 / 弧形钢结构 —— 待询价';

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
    ...(s.curve ? [priced('curve', CURVE_LINE_NAME, 1, '项', '待询价', picks.curve ?? null)] : []),
    ...(s.ctrl ? [
      priced('controller', s.ctrl.model ? `${KIND_ZH[s.ctrl.kind ?? ''] ?? '控制器'} ${s.ctrl.model}${s.ctrl.manual ? '（人工选择）' : ''}${s.ctrl.pending ? '（待确认）' : ''}` : '控制器（超出单台能力，待定）',
        1, '台', 'F11', picks.controller !== undefined ? picks.controller : s.ctrl.itemId),
      ...(s.ctrl.needMedia ? [priced('media_player', '媒体播放器（HDMI 输出）', 1, '台', 'F11', picks.media_player !== undefined ? picks.media_player : s.ctrl.mediaItemId)] : []),
      ...(s.ctrl.needPc ? [priced('playback_pc', '播控电脑', 1, '台', 'F11', picks.playback_pc !== undefined ? picks.playback_pc : s.ctrl.pcItemId)] : []),
    ] : []),
    ...manual.map((m) => tagged(priced(m.key, m.name, m.qty, m.unit, '人工', m.itemId), m.shared)),
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
    if (!it && l.key === 'curve') {
      out.push({ code: 'COST-CURVE', severity: 'block', message: '弧形箱体 / 柔性模组 / 弧形钢结构待询价：询到价后在价格库建一条（单位「项」），再在这里选上。' });
      continue;
    }
    if (!it && l.key === 'display' && extra.some((c) => c.code === 'LED-COST-QUOTE')) continue;   // 已经写成「待报价」
    /* AV-019:控制器 / 媒体播放器 / 播控电脑没选上或没价格 —— 标「待报价」,不阻断 */
    if (quoteLater(l.key) && (!it || l.unitCost === null || l.unitList === null)) {
      out.push({ code: 'COST-CTRL-QUOTE', severity: 'warn', message: `「${l.name}」待报价：${it ? '设备库里这一项还没有成本价 / 售价' : '设备库里还没有这一项'}，不影响确认成本，报价前补上。` });
      if (!it) continue;
    }
    if (!it) { out.push({ code: 'COST-ITEM', severity: 'block', message: `「${l.name}」未选择价格库条目。` }); continue; }
    if (!sameUnit(it.unit, l.unit)) out.push({ code: 'COST-UNIT', severity: 'block', message: `「${l.name}」按 ${l.unit} 计，所选条目按 ${it.unit} 计价。` });
    if ((l.unitCost === null || l.unitList === null) && !quoteLater(l.key)) out.push({ code: 'COST-PRICE', severity: 'block', message: `「${it.model || it.pitch || it.categoryLabel}」缺少成本价或售价，需在价格库补全。` });
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

/* AV-020 §2:安装调试 3 人;≤ 4 台 2 天,5–9 台 3 天(10 台以上待校准,先按 3 天并提示) */
export const prjInstallDays = (nProj: number) => (nProj <= 4 ? 2 : 3);

export function buildPrjLines(cfg: SavedConfig<PrjSummary>, picks: Partial<PrjPicks> & Record<string, number | null | undefined>, manual: ManualLine[], items: PriceItem[]): CostLine[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const priced = (key: string, name: string, qty: number, unit: string, qtySource: string, itemId: number | null | undefined): CostLine => {
    const it = itemId == null ? undefined : byId.get(itemId);
    return { key, name, qty, unit, qtySource, itemId: it ? it.id : null, itemLabel: it ? itemLabel(it) : '',
      unitCost: it?.costPrice ?? null, unitList: it?.listPrice ?? null };
  };
  const s = cfg.summary;
  if (s.system && s.groups) {
    /* AV-020 §3.6 配置模板:没挑过的行缺省用价格库里对应的那一条(投影机按型号代码,配套按角色) */
    const spec = (i: PriceItem) => (i.spec && !isCtrlSpec(i.spec) ? i.spec : null);
    const auto = (key: string, find: (sp: PrjDeviceSpec, i: PriceItem) => boolean) =>
      (picks[key] !== undefined ? picks[key] : items.find((i) => i.active && spec(i) && find(spec(i)!, i))?.id ?? null);
    const role = (r: PrjPartRole) => auto(`p_${r}`, (sp, i) => i.category === PRJ_PART_CATEGORY && sp.kind === 'part' && sp.role === r);
    const sys = s.system;
    const models = new Map<string, { model: string; n: number; groups: string[] }>();
    for (const g of s.groups) {
      const m = models.get(g.projector) ?? { model: g.model ?? g.projector, n: 0, groups: [] };
      m.n += g.n; m.groups.push(g.name);
      models.set(g.projector, m);
    }
    const days = prjInstallDays(s.nProj);
    const T = '§3.6';
    return [
      ...[...models].map(([code, m]) => priced(`projector:${code}`, `投影机 ${m.model}（${m.groups.join('、')}）`, m.n, '台', T,
        auto(`projector:${code}`, (sp, i) => i.category === PRJ_PROJECTOR_CATEGORY && sp.kind === 'projector' && sp.code === code))),
      priced('p_mount', '投影固定支架（每台 1 个）', s.nProj, '个', T, role('mount')),
      ...(sys.blends ? [priced('p_blend', '软件融合服务器（每个融合组 1 套）', sys.blends, '套', T, role('blend'))] : []),
      ...(sys.boxes ? [priced('p_box', `多屏宝（每 ${sys.boxPerSet} 台 1 套，待确认）`, sys.boxes, '套', T, role('box'))] : []),
      priced('p_pc', 'PC 主机（每个融合组 1 台）', sys.pcs, '台', T, role('pc')),
      priced('p_cable', '线材辅材（每台 1 批：20 m HDMI 光纤 + 六类网线）', s.nProj, '批', T, role('cable')),
      ...(s.interact === 'wall' && sys.radars ? [priced('p_radar', '雷达（墙面互动）', sys.radars, '颗', T, role('radar'))] : []),
      priced('p_switch', '路由器 / 交换机', 1, '台', T, role('switch')),
      priced('p_control', '中控系统', 1, '套', T, role('control')),
      priced('p_install', `安装调试（3 人 × ${days} 天，含融合调试）`, 3 * days, '人天', T, role('install')),
      priced('p_trip', '出差费', 1, '项', T, role('trip')),
      ...manual.map((m) => tagged(priced(m.key, m.name, m.qty, m.unit, '人工', m.itemId), m.shared)),
    ];
  }
  return [
    priced('projector', `投影机（单机 ≥ ${Math.ceil(s.lmProj).toLocaleString('en-US')} lm）`, s.nProj, '台', 'P2', picks.projector),
    priced('screen', '投影幕 / 投影面', round2(s.area), '㎡', 'P1', picks.screen),
    priced('signal_cable', '信号线（含 1 备用）', s.nSignalCable, '根', 'P10', picks.signal_cable),
    priced('mount', '投影机吊架', s.nProj, '套', 'P2', picks.mount),
    ...(s.nProj > 1 ? [priced('blend', '融合处理器', 1, '套', 'P2', picks.blend)] : []),
    ...manual.map((m) => tagged(priced(m.key, m.name, m.qty, m.unit, '人工', m.itemId), m.shared)),
  ];
}

/* The display item must be the pitch 05 designed. 06 keeps the last sheet's
   picks, so after 05 saves a new version (P2 → P2.5) the old P2 item would
   otherwise price the new screen without anyone noticing. A range item
   ("3.91-7.81mm") fits any pitch inside the range. */
export function pitchFits(label: string, pitch: number): boolean | null {
  const nums = (label.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (!nums.length) return null;
  if (nums.length >= 2 && /[-–~]/.test(label)) return pitch >= Math.min(nums[0], nums[1]) - 1e-3 && pitch <= Math.max(nums[0], nums[1]) + 1e-3;
  return Math.abs(nums[0] - pitch) < 1e-3;
}

export function ledChecks(lines: CostLine[], cfg: SavedConfig<LedSummary>, items: PriceItem[]): CostCheck[] {
  /* AV-019:控制与信号源的提示(不阻断) */
  const ctrl: CostCheck[] = [];
  const c = cfg.summary.ctrl;
  if (c?.pending) ctrl.push({ code: 'LED-COST-CTRL', severity: 'warn', message: '控制与信号源：01「这块屏主要播放什么」还没定，先按会议 / 演示给的建议，待确认。' });
  if (c && !c.model) ctrl.push({ code: 'LED-COST-CTRL', severity: 'warn', message: '控制器：超出单台能力，需多台拼接或大型控制器，请在这一行选上或手动加行。' });
  return [...ctrl, ...ledDisplayChecks(lines, cfg, items)];
}

function ledDisplayChecks(lines: CostLine[], cfg: SavedConfig<LedSummary>, items: PriceItem[]): CostCheck[] {
  const l = lines.find((x) => x.key === 'display');
  const it = l?.itemId == null ? undefined : items.find((i) => i.id === l.itemId);
  /* AV-018:05 选的是价格库里还没有的点间距(标准档位,02–04 标「待报价」):不报「未选择条目」,
     说清楚是待报价、要先在价格库补这一款 —— 和弧形的「待询价」一样,补上之前不能确认成本 */
  if (!it && l && !items.some((i) => i.active && sqmUnit(i.unit) && pitchFits(i.pitch, cfg.summary.pitch) === true)) {
    return [{ code: 'LED-COST-QUOTE', severity: 'block',
      message: `LED 显示屏 P${cfg.summary.pitch} 待报价：价格库里还没有这个点间距的型号，先在价格库补这款（单位 ㎡），再在这里选上。` }];
  }
  if (!it) return [];
  const fits = pitchFits(it.pitch, cfg.summary.pitch);
  if (fits === null) return [{ code: 'LED-COST-PITCH', severity: 'warn', message: `「${itemLabel(it)}」没写点间距，无法核对是否就是方案的 P${cfg.summary.pitch}。` }];
  return fits ? [] : [{ code: 'LED-COST-PITCH', severity: 'block',
    message: `所选显示屏条目是 ${it.pitch}，05 方案是 P${cfg.summary.pitch}：请换成 P${cfg.summary.pitch} 的条目（05 改过点间距后，成本表沿用了上一版的选择）。` }];
}

/* The chosen projector must reach the brightness P6 asks for. */
export function prjChecks(lines: CostLine[], cfg: SavedConfig<PrjSummary>, items: PriceItem[]): CostCheck[] {
  const s = cfg.summary;
  if (s.system && s.groups) {
    /* AV-020:配置模板的提示(不阻断) */
    const out: CostCheck[] = [];
    if (s.interact === 'floor') out.push({ code: 'PRJ-COST-RADAR', severity: 'warn', message: '地面互动的雷达 / 传感器数量规则待定：请手动加一行。' });
    if (s.nProj >= 10) out.push({ code: 'PRJ-COST-INSTALL', severity: 'warn', message: `${s.nProj} 台：10 台以上的安装调试天数待校准，先按 3 天算，请核对。` });
    for (const l of lines.filter((x) => x.key.startsWith('projector:'))) {
      const it = l.itemId == null ? undefined : items.find((i) => i.id === l.itemId);
      const code = l.key.slice('projector:'.length);
      if (it?.spec && it.spec.kind === 'projector' && it.spec.code !== code) {
        out.push({ code: 'PRJ-COST-MODEL', severity: 'warn', message: `「${l.name}」选的是 ${it.model}，和 05 方案的机型不一致，请核对。` });
      }
    }
    return out;
  }
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
    /* the ELV rack is the machine room's rack: the one other lines' control gear joins */
    ...rows.filter((r) => r[2] > 0).map(([k, n, q, u, src]) => tagged(line(k, n, q, u, src, picks[k] ?? null), k === 'rack' ? 'rack' : undefined)),
    ...manual.map((m) => tagged(line(m.key, m.name, m.qty, m.unit, '人工', m.itemId), m.shared)),
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
    ...manual.map((m) => tagged(line(m.key, m.name, m.qty, m.unit, '人工', m.itemId), m.shared)),
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
