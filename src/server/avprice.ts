/* Validation for price-library writes, shared by the create and edit routes. */

import type { BusinessLine } from '@/av/core/types';
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
  };
}
