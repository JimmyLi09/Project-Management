/* ===== AV-019 §2.3 人工调整电源回路 / 网线 =====
   05 线路图上「调整电源回路」「调整网线」改的是 cfg.led_wiring_override:
   每只箱体的回路号、网线号和网线上的序号。这里是改它的几个纯函数,
   页面和测试用同一套;算结果仍然由 compute 按它重算(DXF、技术方案、06 跟着变)。 */

import type { ComputeResult } from './compute.ts';
import type { WiringOverride } from './types.ts';
import { cellId, layoutSig } from './wiring.ts';

/* 把当前(自动或已调整)的结果抄成一份可以改的调整 */
export function snapshot(r: ComputeResult, by: string, at = Date.now()): WiringOverride | null {
  const { layout, wiring: w } = r;
  if (!layout || !w || w.algo !== 'chain') return null;
  const runOf = new Map<number, { run: number; seq: number }>();
  w.runs.forEach((run, k) => run.cells.forEach((i, s) => runOf.set(i, { run: k + 1, seq: s + 1 })));
  return {
    sig: layoutSig(layout.cells),
    power: false,
    data: false,
    cells: layout.cells.map((c, i) => ({
      id: cellId(c),
      circuit: w.circuitOf[i] >= 0 ? w.circuitOf[i] + 1 : null,
      run: runOf.get(i)?.run ?? null,
      seq: runOf.get(i)?.seq ?? null,
    })),
    ...(w.manual.data ? { ports: Object.fromEntries(w.ports.map((p, k) => [String(k + 1), p])) } : {}),
    by, at,
  };
}

/* 开始改某一部分:没有调整就从当前结果抄一份;那部分还是自动的,先用当前自动结果刷新它
   (自动结果可能在上次抄下来之后变过,例如改了功耗参数) */
export function beginEdit(r: ComputeResult, cur: WiringOverride | undefined, part: 'power' | 'data', by: string, at = Date.now()): WiringOverride | null {
  const fresh = snapshot(r, by, at);
  if (!fresh) return null;
  if (!cur || cur.sig !== fresh.sig) return fresh;
  if (cur[part]) return cur;
  const byId = new Map(fresh.cells.map((c) => [c.id, c]));
  return {
    ...cur,
    cells: cur.cells.map((c) => (part === 'power'
      ? { ...c, circuit: byId.get(c.id)?.circuit ?? null }
      : { ...c, run: byId.get(c.id)?.run ?? null, seq: byId.get(c.id)?.seq ?? null })),
    ...(part === 'data' ? { ports: undefined } : {}),
  };
}

/* 回路号 / 网线号保持 1、2、3… 连续(划空了的那一路去掉,后面的往前补),
   图上、色板上的编号才对得上;网口跟着网线走 */
function compact(ov: WiringOverride): WiringOverride {
  const cMap = new Map(circuitNumbers(ov).map((n, k) => [n, k + 1]));
  const rMap = new Map(runNumbers(ov).map((n, k) => [n, k + 1]));
  const ports = ov.ports
    ? Object.fromEntries(Object.entries(ov.ports).filter(([k]) => rMap.has(Number(k))).map(([k, v]) => [String(rMap.get(Number(k))), v]))
    : undefined;
  return {
    ...ov,
    cells: ov.cells.map((c) => ({ ...c, circuit: c.circuit == null ? null : cMap.get(c.circuit)!, run: c.run == null ? null : rMap.get(c.run)! })),
    ...(ports ? { ports } : {}),
  };
}
const touch = (ov: WiringOverride, by: string, at: number) => ({ ...compact(ov), by, at });

/* 把这些箱体划给回路 circuit(1 起) */
export function assignCircuit(ov: WiringOverride, ids: string[], circuit: number, by: string, at = Date.now()): WiringOverride {
  const set = new Set(ids);
  return touch({ ...ov, power: true, cells: ov.cells.map((c) => (set.has(c.id) ? { ...c, circuit } : c)) }, by, at);
}

/* 把一只箱体接到网线 run 的末尾(从原来那条上摘下来) */
export function appendToRun(ov: WiringOverride, id: string, run: number, by: string, at = Date.now()): WiringOverride {
  const last = Math.max(0, ...ov.cells.filter((c) => c.run === run && c.id !== id).map((c) => c.seq ?? 0));
  return touch({ ...ov, data: true, cells: ov.cells.map((c) => (c.id === id ? { ...c, run, seq: last + 1 } : c)) }, by, at);
}

/* 清空一条网线(再按顺序重新点) */
export function clearRun(ov: WiringOverride, run: number, by: string, at = Date.now()): WiringOverride {
  /* 不压缩编号:清空后接着往这条上点,编号不变 */
  return { ...ov, data: true, by, at, cells: ov.cells.map((c) => (c.run === run ? { ...c, run: null, seq: null } : c)) };
}

/* 改网口编号 */
export function setPort(ov: WiringOverride, run: number, port: number, by: string, at = Date.now()): WiringOverride {
  return touch({ ...ov, data: true, ports: { ...(ov.ports ?? {}), [String(run)]: port } }, by, at);
}

/* 这次调整里用到的回路号 / 网线号(色板用;「＋ 新回路」= 最大号 + 1) */
export const circuitNumbers = (ov: WiringOverride) => [...new Set(ov.cells.map((c) => c.circuit).filter((x): x is number => x != null))].sort((a, b) => a - b);
export const runNumbers = (ov: WiringOverride) => [...new Set(ov.cells.map((c) => c.run).filter((x): x is number => x != null))].sort((a, b) => a - b);

/* 「人工调整 · 谁 · 何时」 */
export function manualLabel(m: { by: string; at: number } | null | undefined): string {
  if (!m) return '';
  const d = new Date(m.at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${m.by} · ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
