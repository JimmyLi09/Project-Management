/* ===== §8.2 cabinet list export =====
   规格、数量、每只模组数、库内 / 定制状态。CSV with a UTF-8 BOM so Excel opens
   it with the Chinese headers intact. */

import type { LayoutResult } from './layout.ts';

export const BOM_HEADERS = ['规格', '数量（只）', '模组数/只', '状态'] as const;

export function bomRows(layout: LayoutResult): string[][] {
  return layout.bom.map((b) => [
    `${b.w}×${b.h}`,
    String(b.count),
    String(b.mods),
    b.inLib ? '库内标准' : '库外，需定制',
  ]);
}

export function bomCsv(layout: LayoutResult): string {
  const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [BOM_HEADERS, ...bomRows(layout)].map((r) => r.map(cell).join(','));
  lines.push(['合计', String(layout.cells.length), '', ''].join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}
