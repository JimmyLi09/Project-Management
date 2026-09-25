/* ===== F6–F9 power circuits and data runs (§7) ===== */

export interface Circuit {
  cols: number[];   // 0-based column indices, contiguous
  kw: number;
}

export interface WiringResult {
  colKw: number[];            // per-column load, left -> right
  circuits: Circuit[];        // F6 grouping
  nCircuit: number;           // F6 — the electrical requirement
  nPowerCable: number;        // F7 = nCircuit + 1 spare
  rowRuns: number[];          // F8 per cabinet row, bottom -> top
  nDataRun: number;           // F8 total
  nDataCable: number;         // F9 = nDataRun + 1 spare
  /* True when the screen needs more circuits than it has columns, so a column
     carries more than one circuit and the grouping cannot show them apart. */
  circuitsExceedColumns: boolean;
}

/* §7.1 — group cabinet columns into contiguous circuits of even load
   ("各组功耗尽量均衡"). Exact DP minimising the squared deviation of each
   group's load from the mean; ties are broken toward the front, so seven equal
   columns in three circuits come out 3+2+2 rather than 3+3+1 or 2+2+3 (§6.3).

   Minimising the heaviest group alone would not do: 3+3+1 and 3+2+2 share the
   same heaviest group and only the squared-deviation objective separates them. */
export function balanceColumns(colKw: number[], n: number): Circuit[] {
  const N = colKw.length;
  const g = Math.min(n, N);
  if (g < 1) return [];

  const pre = [0];
  for (const kw of colKw) pre.push(pre[pre.length - 1] + kw);
  const sum = (a: number, b: number) => pre[b] - pre[a];
  const mean = pre[N] / g;
  const penalty = (a: number, b: number) => (sum(a, b) - mean) ** 2;

  /* best[k][i] = least total penalty for splitting columns [0,i) into k groups;
     cut[k][i] = the LARGEST start of the last group achieving it, which makes
     reconstruction front-loaded. */
  const best = Array.from({ length: g + 1 }, () => new Array<number>(N + 1).fill(Infinity));
  const cut = Array.from({ length: g + 1 }, () => new Array<number>(N + 1).fill(-1));
  best[0][0] = 0;
  for (let k = 1; k <= g; k++) {
    for (let i = k; i <= N; i++) {
      for (let j = k - 1; j < i; j++) {
        if (best[k - 1][j] === Infinity) continue;
        const v = best[k - 1][j] + penalty(j, i);
        if (v <= best[k][i] + 1e-9) { best[k][i] = Math.min(best[k][i], v); cut[k][i] = j; }
      }
    }
  }

  const out: Circuit[] = [];
  let i = N;
  for (let k = g; k >= 1; k--) {
    const j = cut[k][i];
    out.unshift({ cols: range(j, i), kw: sum(j, i) });
    i = j;
  }
  return out;
}

export interface WiringInput {
  widths: number[];
  heights: number[];
  H: number;
  pitch: number;
  wSqm: number;
  circuitKw: number;
  dataPx: number;
  pxW: number;
  kw: number;
  /* F8's stored expression, evaluated once per row. */
  rowRunOf: (rowH: number) => number;
}

export function wiring(inp: WiringInput): WiringResult {
  const colKw = inp.widths.map((w) => (w * inp.H / 1e6) * inp.wSqm / 1000);
  const nCircuit = Math.ceil(inp.kw / inp.circuitKw);
  const circuits = balanceColumns(colKw, nCircuit);
  const rowRuns = inp.heights.map(inp.rowRunOf);
  const nDataRun = rowRuns.reduce((a, b) => a + b, 0);
  return {
    colKw,
    circuits,
    nCircuit,
    nPowerCable: nCircuit + 1,
    rowRuns,
    nDataRun,
    nDataCable: nDataRun + 1,
    circuitsExceedColumns: nCircuit > inp.widths.length,
  };
}

const range = (a: number, b: number) => Array.from({ length: b - a }, (_, k) => a + k);
