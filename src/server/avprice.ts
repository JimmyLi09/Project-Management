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

export function normalise(it: Partial<PriceInput>): PriceInput {
  const price = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
  const label = String(it.categoryLabel || '').trim();
  return {
    line: (it.line || 'led') as BusinessLine,
    category: String(it.category || label).trim(),
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
