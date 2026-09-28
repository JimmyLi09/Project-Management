/* ===== F3 cabinet layout + F10 bill of materials (§6) =====

   A screen is NOT one cabinet size repeated. Width and height are solved
   independently against the cabinet library; the cartesian product of the two
   sequences is the cabinet grid. §6.3 is explicit that this must not be
   simplified to "one fixed cabinet + trim the remainder". */

import type { Size } from './types.ts';

export interface Cell {
  r: number;       // 1-based row, counted from the BOTTOM of the screen
  c: number;       // 1-based column, counted from the LEFT
  x: number;       // mm from the left edge
  y: number;       // mm from the bottom edge
  w: number;
  h: number;
  custom: boolean; // the (w,h) pair is not in the library — needs a custom build
}

export interface BomRow {
  w: number;
  h: number;
  count: number;
  mods: number;    // modules per cabinet
  inLib: boolean;
}

export interface LayoutResult {
  widths: number[];   // left -> right, primary first so odd columns land on the right
  heights: number[];  // bottom -> top, primary first so odd rows land on the top
  cells: Cell[];
  bom: BomRow[];      // F10
  custom: boolean;    // any cell outside the library (LED-CAB-01)
}

/* §6.1/§6.2 — one-dimensional unbounded-knapsack DP over module units.
   Priority 1: fewest non-primary pieces.  Priority 2: fewest pieces overall.
   Returns null when the target cannot be hit exactly (LED-FIT-01/02).

   The returned sequence is ordered primary-first, which places the odd piece at
   the top row / right column — matching site practice (§6.2) and the 144-Chuan
   Grove drawing, where 2560 = 480×4 + 640 with the 640 cabinet on top. */
export function solveAxis(total: number, options: number[], primary: number, unit: number): number[] | null {
  if (!(unit > 0) || !isWhole(total / unit)) return null;
  const T = Math.round(total / unit);

  const units = [...new Set(options.filter((o) => isWhole(o / unit)).map((o) => Math.round(o / unit)))]
    .filter((u) => u > 0)
    .sort((a, b) => a - b);
  if (!units.length) return null;

  const P = isWhole(primary / unit) ? Math.round(primary / unit) : null;

  /* cost[t] = [non-primary pieces, total pieces]; pick[t] = piece taken last. */
  const cost: [number, number][] = Array.from({ length: T + 1 }, () => [Infinity, Infinity]);
  const pick = new Array<number>(T + 1).fill(0);
  cost[0] = [0, 0];
  for (let t = 1; t <= T; t++) {
    for (const u of units) {
      if (u > t) break;
      const prev = cost[t - u];
      if (prev[0] === Infinity) continue;
      const c: [number, number] = [prev[0] + (u === P ? 0 : 1), prev[1] + 1];
      if (c[0] < cost[t][0] || (c[0] === cost[t][0] && c[1] < cost[t][1])) { cost[t] = c; pick[t] = u; }
    }
  }
  if (cost[T][0] === Infinity) return null;

  const seq: number[] = [];
  for (let t = T; t > 0; t -= pick[t]) seq.push(pick[t] * unit);
  /* Stable sort: primary pieces first, odd pieces last. */
  return seq.sort((a, b) => Number(a !== primary) - Number(b !== primary));
}

export function layout(
  L: number, H: number, modW: number, modH: number, lib: Size[], primary: Size,
): LayoutResult | null {
  const widths = solveAxis(L, lib.map((s) => s[0]), primary[0], modW);
  const heights = solveAxis(H, lib.map((s) => s[1]), primary[1], modH);
  if (!widths || !heights) return null;

  const inLib = new Set(lib.map(key));
  const cells: Cell[] = [];
  let y = 0;
  heights.forEach((h, ri) => {
    let x = 0;
    widths.forEach((w, ci) => {
      cells.push({ r: ri + 1, c: ci + 1, x, y, w, h, custom: !inLib.has(key([w, h])) });
      x += w;
    });
    y += h;
  });

  /* F10 — aggregate by (w,h). */
  const agg = new Map<string, BomRow>();
  for (const c of cells) {
    const k = key([c.w, c.h]);
    const row = agg.get(k);
    if (row) row.count++;
    else agg.set(k, {
      w: c.w, h: c.h, count: 1,
      mods: Math.round(c.w / modW) * Math.round(c.h / modH),
      inLib: !c.custom,
    });
  }
  const bom = [...agg.values()].sort((a, b) => b.count - a.count || a.w - b.w || a.h - b.h);

  return { widths, heights, cells, bom, custom: cells.some((c) => c.custom) };
}

const key = (s: Size) => `${s[0]}x${s[1]}`;
const isWhole = (x: number) => Math.abs(x - Math.round(x)) < 1e-6;
