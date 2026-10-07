/* Validation for price-library writes, shared by the create and edit routes. */

import type { BusinessLine } from '@/av/core/types';
import type { CtrlSpec, PriceItem } from '@/av/core/pricing';
import type { PrjDeviceSpec, PrjPartRole } from '@/av/core/prj/library';
import type { PriceInput } from './avdb';

export function validate(it: Partial<PriceInput> | undefined): string | null {
  if (!it) return '缺少条目';
  if (!String(it.categoryLabel || '').trim()) return '请填写类别';
  if (!String(it.unit || '').trim()) return '请填写计价单位';
  for (const k of ['costPrice', 'listPrice'] as const) {
    const v = it[k];
    if (v !== null && v !== undefined && !(Number(v) >= 0)) return '价格须为非负数，或留空表示待定价';
  }
  if (it.validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(it.validUntil)) return '有效期格式应为 YYYY-MM-DD';
  return null;
}

/* AV-018:手工新增时分类填的是文字(「LED」「LED 显示屏」「户外 LED」…),原来原样存成分类代码,
   点间距候选认不出来。现在存成内部代码;认不出的仍按原文存(线材、控制系统…) */
export function categoryCode(label: string): string {
  const t = label.trim();
  if (/^(hard_smd|gob|cob|soft|smd|hologram(_he)?|transparent|poster)(_outdoor)?$/i.test(t)) return t;
  const out = /outdoor|户外|室外/i.test(t) ? '_outdoor' : '';
  /* AV-019:设备库 */
  if (/^control$|控制系统|控制器|播放盒|controller/i.test(t)) return 'control';
  /* AV-020:投影设备库(在 LED 的「显示屏」规则之前,免得「投影」被认成别的) */
  if (/^projector$|^投影机$/i.test(t)) return 'projector';
  if (/^lens$|^镜头$/i.test(t)) return 'lens';
  if (/^prj_part$|^投影配套$/i.test(t)) return 'prj_part';
  if (/hologram|全息/i.test(t)) return 'hologram';
  if (/transparent|透明/i.test(t)) return 'transparent';
  if (/poster|海报/i.test(t)) return 'poster';
  if (/\bcob\b|cob/i.test(t)) return `cob${out}`;
  if (/\bgob\b|gob/i.test(t)) return `gob${out}`;
  if (/soft|软模组|柔性/i.test(t)) return `soft${out}`;
  if (/led|显示屏|smd|小间距/i.test(t)) return `smd${out}`;
  return t;
}

export function normalise(it: Partial<PriceInput>): PriceInput {
  const price = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
  const label = String(it.categoryLabel || '').trim();
  return {
    line: (it.line || 'led') as BusinessLine,
    category: String(it.category || '').trim() || categoryCode(label),
    categoryLabel: label,
    model: String(it.model || '').trim(),
    pitch: String(it.pitch || '').trim(),
    moduleSize: String(it.moduleSize || '').trim(),
    cabinetSize: String(it.cabinetSize || '').trim(),
    unit: String(it.unit || '').trim(),
    costPrice: price(it.costPrice),
    listPrice: price(it.listPrice),
    currency: String(it.currency || 'SGD'),
    source: String(it.source || '手工录入').trim(),
    validUntil: String(it.validUntil || ''),
    active: it.active !== false,
    spec: normaliseSpec(it.spec),
  };
}

/* AV-019:设备库规格。缺的数字按 0、输入按逗号拆开;认不出的种类就不存规格(F11 不会选它) */
const KINDS = ['player', 'video', 'large', 'media', 'pc'];
function normaliseSpec(v: unknown): PriceItem['spec'] {
  if (!v || typeof v !== 'object') return null;
  const x = v as Record<string, unknown>;
  const prj = normalisePrjSpec(x);
  if (prj) return prj;
  if (!KINDS.includes(String(x.kind))) return null;
  const num = (k: string) => Math.max(0, Math.round(Number(x[k]) || 0));
  const inputs = Array.isArray(x.inputs) ? x.inputs.map(String) : String(x.inputs ?? '').split(/[,，、]/);
  return {
    kind: x.kind as CtrlSpec['kind'], brand: String(x.brand ?? '').trim(),
    ports: num('ports'), loadPx: num('loadPx'), maxW: num('maxW'), maxH: num('maxH'),
    inputs: inputs.map((s) => s.trim()).filter(Boolean), standalone: !!x.standalone,
  };
}

/* AV-020:投影设备库规格。没填的功耗 / 重量 / 噪音存 null(05 提示待补),位移和投射比按比例存 */
const ROLES: PrjPartRole[] = ['mount', 'blend', 'box', 'pc', 'cable', 'radar', 'switch', 'control', 'install', 'trip'];
function normalisePrjSpec(x: Record<string, unknown>): PrjDeviceSpec | null {
  const pos = (k: string) => { const n = Number(x[k]); return Number.isFinite(n) && n > 0 ? n : 0; };
  const opt = (v: unknown) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
  const code = String(x.code ?? '').trim().replace(/\s+/g, '');
  if (x.kind === 'projector') {
    const std = x.std && typeof x.std === 'object' ? x.std as Record<string, unknown> : null;
    const tMin = std ? Number(std.throwMin) : NaN, tMax = std ? Number(std.throwMax) : NaN;
    return {
      kind: 'projector', code, brand: String(x.brand ?? '').trim(), lumens: pos('lumens'), resW: pos('resW') || 1920, resH: pos('resH') || 1200,
      watts: opt(x.watts), kg: opt(x.kg), db: opt(x.db), shiftUp: pos('shiftUp'), shiftDown: pos('shiftDown'),
      std: std && tMin > 0 && tMax >= tMin ? {
        name: String(std.name ?? '').trim() || `标配 ${tMin === tMax ? tMin : `${tMin}–${tMax}`}`,
        nameEn: String(std.nameEn ?? '').trim() || `Standard ${tMin === tMax ? tMin : `${tMin}–${tMax}`}`,
        throwMin: tMin, throwMax: tMax, ...(std.ust ? { ust: true } : {}),
      } : null,
      ...(String(x.note ?? '').trim() ? { note: String(x.note).trim() } : {}),
    };
  }
  if (x.kind === 'lens') {
    const tMin = pos('throwMin'), tMax = pos('throwMax') || tMin;
    const fits = Array.isArray(x.fits) ? x.fits.map(String) : String(x.fits ?? '').split(/[,，、\s]+/);
    return {
      kind: 'lens', code, nameEn: String(x.nameEn ?? '').trim(), throwMin: tMin, throwMax: Math.max(tMin, tMax),
      ...(x.ust ? { ust: true } : {}), shiftUp: opt(x.shiftUp), shiftDown: opt(x.shiftDown),
      fits: [...new Set(fits.map((s) => s.trim()).filter(Boolean))],
    };
  }
  if (x.kind === 'part' && ROLES.includes(x.role as PrjPartRole)) return { kind: 'part', role: x.role as PrjPartRole };
  return null;
}
