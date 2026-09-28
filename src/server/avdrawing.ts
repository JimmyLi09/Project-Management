/* ===== Bridge to the Python drawing service (services/drawing) =====
   Spawns `python -m avdrawing.ingest.cli` per request: JSON on stdout, errors as
   {"error": ...} with exit code 2; and the DXF / Word renderers. One app, one intranet server (§14), no
   second long-running process to supervise. */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const SERVICE_DIR = path.join(process.cwd(), 'services', 'drawing');
const PYTHON = process.env.AV_PYTHON || path.join(SERVICE_DIR, '.venv', 'bin', 'python');
const TIMEOUT_MS = 120_000;

export const SAMPLE_STORE = path.join(process.cwd(), 'data', 'av-samples', 'led.jsonl');

export class DrawingServiceError extends Error {}

function runPython(args: string[], stdin?: string): Promise<{ code: number | null; out: string; err: string }> {
  if (!existsSync(PYTHON)) {
    return Promise.reject(new DrawingServiceError(
      `制图服务未安装（找不到 ${PYTHON}）。按 services/drawing/README.md 建立虚拟环境，或设置 AV_PYTHON。`,
    ));
  }
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, args, { cwd: SERVICE_DIR });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new DrawingServiceError('制图服务超时')); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(new DrawingServiceError(e.message)); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

export async function runDrawingCli(args: string[], stdin?: string): Promise<Record<string, unknown>> {
  const { code, out, err } = await runPython(['-m', 'avdrawing.ingest.cli', ...args], stdin);
  let payload: Record<string, unknown> | null = null;
  try { payload = JSON.parse(out); } catch { /* fall through */ }
  if (code === 0 && payload) return payload;
  throw new DrawingServiceError(
    (payload?.error as string) || err.trim().split('\n').pop() || `制图服务退出码 ${code}`,
  );
}

/* Render a JSON payload to a file with one of the service's renderers and
   return the bytes: avdrawing.dxf (a drawing from src/av/core/drawing.ts ->
   R2010, mm, the §8.1 layers) or avdrawing.proposal (a ProposalPayload -> the
   Word technical proposal). */
export async function renderFile(module: 'avdrawing.dxf' | 'avdrawing.proposal', payload: unknown, ext: string): Promise<Buffer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'av-render-'));
  try {
    const src = path.join(dir, 'payload.json');
    const dst = path.join(dir, `out.${ext}`);
    await writeFile(src, JSON.stringify(payload));
    const { code, err } = await runPython(['-m', module, src, dst]);
    if (code !== 0) throw new DrawingServiceError(err.trim().split('\n').pop() || `制图服务退出码 ${code}`);
    return await readFile(dst);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/* A line's drawings, configurations and costs hang off a project that carries
   that line's service package (spec 01: 业务线勾选). */
export function lineProjectError(
  p: { packages?: { svc: string }[]; archived?: boolean } | undefined, svc = 'led', label = 'LED',
): string | null {
  if (!p) return '项目不存在';
  if (p.archived) return '项目已归档';
  if (!(p.packages || []).some((k) => k.svc === svc)) return `该项目没有${label}服务包，请先在项目中添加${label}服务。`;
  return null;
}
export const ledProjectError = (p: Parameters<typeof lineProjectError>[0]) => lineProjectError(p, 'led', ' LED ');
