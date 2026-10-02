/* ===== F6–F9 power circuits and data runs (§7) ===== */

export interface Circuit {
  cols: number[];   // 0-based column indices, contiguous
  kw: number;
}

/* AV-019:逐只箱体的结果,两种算法都给 —— 线路图、计算依据表、人工调整都按它 */
export interface PowerCircuit {
  cells: number[];            // layout.cells 的下标,按电源链的先后
  w: number;                  // 负载 W
  amps: number | null;        // 电流 A(规则包没给电压时为 null)
}
export interface DataRun {
  cells: number[];            // layout.cells 的下标,按串接先后
  px: number;                 // 带载(像素)
}
export type DataMode = 'row' | 'snake';

export interface WiringResult {
  algo: 'columns' | 'chain';  // led@1.0 按整列均衡 / led@1.1 按箱体成链逐路校核
  cellW: number[];            // 每只箱体功率 W(layout.cells 顺序)
  cellPx: number[];           // 每只箱体像素
  circuitOf: number[];        // 每只箱体属于第几路(0 起)
  power: PowerCircuit[];
  runs: DataRun[];            // 数据线,编号 1… 自上而下
  dataMode: DataMode;
  limitW: number;             // 单回路上限 W
  voltage: number | null;
  colKw: number[];            // per-column load, left -> right
  circuits: Circuit[];        // F6 grouping(led@1.0 按列;led@1.1 为每路覆盖到的列,仅作兼容)
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
  /* AV-019:逐只箱体(layout.cells)。algo 缺省 = led@1.0 的按列均衡 */
  cells?: { r: number; c: number; w: number; h: number }[];
  algo?: 'columns' | 'chain';
  dataMode?: DataMode;
  voltage?: number | null;
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
  const cells = inp.cells ?? gridCells(inp.widths, inp.heights);
  const cellW = cells.map((c) => (c.w * c.h / 1e6) * inp.wSqm);
  const cellPx = cells.map((c) => Math.round(c.w / inp.pitch) * Math.round(c.h / inp.pitch));
  const limitW = inp.circuitKw * 1000;
  const voltage = inp.voltage ?? null;
  const idx = gridIndex(cells);
  const nc = inp.widths.length, nr = inp.heights.length;
  const amps = (w: number) => (voltage ? w / voltage : null);

  let circuits: Circuit[];
  let power: PowerCircuit[];
  let circuitOf: number[];
  let runs: DataRun[];
  let nCircuit: number;
  const dataMode: DataMode = inp.dataMode ?? 'row';

  if (inp.algo === 'chain') {
    /* led@1.1 —— 电源按列竖向蛇形成链,按箱体分回路,允许一列中途换回路;逐路校核 */
    const chain = powerChain(idx, nc, nr);
    const loads = chain.map((i) => cellW[i]);
    const total = loads.reduce((a, b) => a + b, 0);
    let n = Math.max(1, Math.ceil(total / limitW - 1e-9));
    let groups = partitionChain(loads, n);
    while (Math.max(...groups.map(([a, b]) => sumOf(loads, a, b))) > limitW + 1e-6 && n < chain.length) {
      n++;
      groups = partitionChain(loads, n);
    }
    nCircuit = groups.length;
    power = groups.map(([a, b]) => { const w = sumOf(loads, a, b); return { cells: chain.slice(a, b), w, amps: amps(w) }; });
    circuitOf = new Array<number>(cells.length).fill(0);
    power.forEach((pc, k) => pc.cells.forEach((i) => { circuitOf[i] = k; }));
    circuits = power.map((pc) => ({ cols: [...new Set(pc.cells.map((i) => cells[i].c - 1))].sort((a, b) => a - b), kw: pc.w / 1000 }));
    runs = dataRuns(idx, nc, nr, cellPx, inp.dataPx, dataMode);
  } else {
    /* led@1.0 —— 原样:整列均衡分组;数据线按 F8 每行条数 */
    nCircuit = Math.ceil(inp.kw / inp.circuitKw);
    circuits = balanceColumns(colKw, nCircuit);
    circuitOf = cells.map((c) => Math.max(0, circuits.findIndex((g) => g.cols.includes(c.c - 1))));
    power = circuits.map((g, k) => {
      const list = powerChain(idx, nc, nr).filter((i) => circuitOf[i] === k);
      const w = list.reduce((a, i) => a + cellW[i], 0);
      return { cells: list, w, amps: amps(w) };
    });
    const rowRuns0 = inp.heights.map(inp.rowRunOf);
    runs = [];
    for (let r = nr - 1; r >= 0; r--) {
      const row = Array.from({ length: nc }, (_, c) => idx[c][r]);
      const k = Math.max(1, rowRuns0[r]);
      for (let t = 0; t < k; t++) {
        const part = row.slice(Math.round((t * nc) / k), Math.round(((t + 1) * nc) / k));
        if (part.length) runs.push({ cells: part, px: part.reduce((a, i) => a + cellPx[i], 0) });
      }
    }
  }

  const rowRuns = inp.algo === 'chain'
    ? inp.heights.map((_, r) => runs.filter((run) => run.cells.length && cells[run.cells[0]].r === r + 1).length)
    : inp.heights.map(inp.rowRunOf);
  const nDataRun = inp.algo === 'chain' ? runs.length : rowRuns.reduce((a, b) => a + b, 0);
  return {
    algo: inp.algo === 'chain' ? 'chain' : 'columns',
    cellW, cellPx, circuitOf, power, runs, dataMode, limitW, voltage,
    colKw,
    circuits,
    nCircuit,
    nPowerCable: nCircuit + 1,
    rowRuns,
    nDataRun,
    nDataCable: nDataRun + 1,
    circuitsExceedColumns: inp.algo === 'chain' ? false : nCircuit > inp.widths.length,
  };
}

/* 没给 cells 时按行列补出来(老调用) */
function gridCells(widths: number[], heights: number[]) {
  const out: { r: number; c: number; w: number; h: number }[] = [];
  heights.forEach((h, ri) => widths.forEach((w, ci) => out.push({ r: ri + 1, c: ci + 1, w, h })));
  return out;
}
/* idx[c][r] = layout.cells 的下标(c 自左 0 起,r 自下 0 起) */
function gridIndex(cells: { r: number; c: number }[]): number[][] {
  const idx: number[][] = [];
  cells.forEach((cell, i) => { (idx[cell.c - 1] ||= [])[cell.r - 1] = i; });
  return idx;
}
/* 电源链:第 1 列自下而上,第 2 列自上而下……(蛇形,链不断开) */
export function powerChain(idx: number[][], nc: number, nr: number): number[] {
  const out: number[] = [];
  for (let c = 0; c < nc; c++) for (let k = 0; k < nr; k++) out.push(idx[c][c % 2 === 0 ? k : nr - 1 - k]);
  return out;
}
/* 数据线:每行一条 = 自上而下每行从左到右;蛇形 = 自上而下、行间换向。
   逐只累加像素,到单线带载上限就换下一条(一只箱体不拆);每行一条时换行也换线。 */
function dataRuns(idx: number[][], nc: number, nr: number, cellPx: number[], cap: number, mode: DataMode): DataRun[] {
  const runs: DataRun[] = [];
  let cur: DataRun | null = null;
  for (let k = 0; k < nr; k++) {
    const r = nr - 1 - k;
    const cols = Array.from({ length: nc }, (_, c) => (mode === 'snake' && k % 2 === 1 ? nc - 1 - c : c));
    if (mode === 'row') cur = null;
    for (const c of cols) {
      const i = idx[c][r];
      if (!cur || (cur.cells.length && cur.px + cellPx[i] > cap)) { cur = { cells: [], px: 0 }; runs.push(cur); }
      cur.cells.push(i);
      cur.px += cellPx[i];
    }
  }
  return runs;
}
/* 把电源链切成 n 段连续的回路,各段负载尽量相等(段负载与平均值之差的平方和最小;
   同分时前面的段多分一点)。返回 [起, 止) 下标对 */
export function partitionChain(loads: number[], n: number): [number, number][] {
  const N = loads.length;
  const g = Math.max(1, Math.min(n, N));
  const pre = [0];
  for (const x of loads) pre.push(pre[pre.length - 1] + x);
  const mean = pre[N] / g;
  const best = Array.from({ length: g + 1 }, () => new Array<number>(N + 1).fill(Infinity));
  const cut = Array.from({ length: g + 1 }, () => new Array<number>(N + 1).fill(-1));
  best[0][0] = 0;
  for (let k = 1; k <= g; k++) {
    for (let i = k; i <= N; i++) {
      for (let j = k - 1; j < i; j++) {
        if (best[k - 1][j] === Infinity) continue;
        const v = best[k - 1][j] + (pre[i] - pre[j] - mean) ** 2;
        if (v <= best[k][i] + 1e-9) { best[k][i] = Math.min(best[k][i], v); cut[k][i] = j; }
      }
    }
  }
  const out: [number, number][] = [];
  let i = N;
  for (let k = g; k >= 1; k--) { const j = cut[k][i]; out.unshift([j, i]); i = j; }
  return out;
}
const sumOf = (a: number[], i: number, j: number) => { let s = 0; for (let k = i; k < j; k++) s += a[k]; return s; };

const range = (a: number, b: number) => Array.from({ length: b - a }, (_, k) => a + k);
