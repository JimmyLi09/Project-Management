/* ===== Cross-line shared resources · rule pack xline@0.1-draft =====

   When one project carries several business lines, some costs are incurred
   once for the site rather than once per line (prototype Summary.dc.html:
   机房机柜、主干桥架、进场吊装、调试工日). Cost rows carry a shared tag — set by
   the PM on added lines in 06, or fixed for a computed row such as the ELV
   rack. For each tag present in two or more lines, the line with the largest
   sell amount keeps its rows in full and the others are reduced by the tag's
   rate. A DRAFT from industry practice (2026-09-26 decision); rates are
   uncalibrated. Rationale: docs/requirements/018. */

import { round2, type CostLine } from './pricing.ts';
import type { BusinessLine } from './types.ts';

export type SharedTag = 'mobilisation' | 'rack' | 'commissioning' | 'containment';

export interface SharedRule {
  tag: SharedTag;
  label: string;
  rate: number;    // share of the other lines' amounts that is saved
  basis: string;
}

export const XLINE_PACK = {
  version: 'xline@0.1-draft',
  calibrated: false,
  note: '按行业常规编制的草案，扣减比例待用公司多业务线项目的实际结算校准。',
  rules: {
    mobilisation: { tag: 'mobilisation', label: '进场与吊装', rate: 1,
      basis: '同一现场只进场、搭设临设、租用吊装设备一次：保留金额最大的一项，其余全部扣除。' },
    rack: { tag: 'rack', label: '机柜', rate: 1,
      basis: 'LED / 投影控制设备并入同一机房机柜（弱电机柜已含 30% 余量）：保留最大一项，其余扣除；须核对 U 数。' },
    commissioning: { tag: 'commissioning', label: '系统调试', rate: 0.2,
      basis: '多系统联调时现场配合与测试工日重叠，其余各线调试按 20% 扣减。' },
    containment: { tag: 'containment', label: '弱电桥架 / 线槽', rate: 0.3,
      basis: '信号线（LED 数据线、投影信号线、弱电线缆）主干路由共用，其余各线按 30% 扣减；电源线与光伏线缆按规范须与信号线分隔，不得标记。' },
  } satisfies Record<SharedTag, SharedRule>,
};

export const SHARED_TAGS = Object.keys(XLINE_PACK.rules) as SharedTag[];
export const isSharedTag = (v: unknown): v is SharedTag => SHARED_TAGS.includes(v as SharedTag);

/* A tagged cost row with its amounts. */
export interface SharedRow { line: BusinessLine; name: string; tag: SharedTag; cost: number; list: number }

export const sharedRows = (line: BusinessLine, lines: CostLine[]): SharedRow[] =>
  lines.filter((l) => l.shared).map((l) => ({
    line, name: l.name, tag: l.shared!, cost: round2((l.unitCost ?? 0) * l.qty), list: round2((l.unitList ?? 0) * l.qty),
  }));

/* One saving: the rows reduced, the line kept in full, and the amounts taken off. */
export interface Deduction {
  tag: SharedTag;
  label: string;
  rate: number;
  kept: BusinessLine;
  items: SharedRow[];
  cost: number;
  list: number;
}

export function dedupe(rows: SharedRow[]): Deduction[] {
  const out: Deduction[] = [];
  for (const rule of Object.values(XLINE_PACK.rules)) {
    const byLine = new Map<BusinessLine, SharedRow[]>();
    for (const r of rows.filter((x) => x.tag === rule.tag)) byLine.set(r.line, [...(byLine.get(r.line) ?? []), r]);
    if (byLine.size < 2) continue;
    const sum = (rs: SharedRow[], k: 'cost' | 'list') => rs.reduce((a, r) => a + r[k], 0);
    const kept = [...byLine.entries()].reduce((a, b) => (sum(b[1], 'list') > sum(a[1], 'list') ? b : a))[0];
    const items = rows.filter((r) => r.tag === rule.tag && r.line !== kept);
    out.push({
      tag: rule.tag, label: rule.label, rate: rule.rate, kept, items,
      cost: round2(rule.rate * sum(items, 'cost')), list: round2(rule.rate * sum(items, 'list')),
    });
  }
  return out;
}

export const dedupTotals = (d: Deduction[]) => ({
  cost: round2(d.reduce((a, x) => a + x.cost, 0)),
  list: round2(d.reduce((a, x) => a + x.list, 0)),
});
