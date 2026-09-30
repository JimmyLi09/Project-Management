/* ===== Bridge to the Python drawing service (services/drawing) =====
   Spawns `python -m avdrawing.ingest.cli` (or avdrawing.cases) per request: JSON
   on stdout, errors as {"error": ...} with exit code 2; and the DXF / Word renderers. One app, one intranet server (§14), no
   second long-running process to supervise. */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const SERVICE_DIR = path.join(process.cwd(), 'services', 'drawing');
const PYTHON = process.env.AV_PYTHON || (process.platform === 'win32'
  ? path.join(SERVICE_DIR, '.venv', 'Scripts', 'python.exe')
  : path.join(SERVICE_DIR, '.venv', 'bin', 'python'));
const TIMEOUT_MS = 120_000;

export const SAMPLE_STORE = path.join(process.cwd(), 'data', 'av-samples', 'led.jsonl');

export class DrawingServiceError extends Error {}

function runPython(args: string[], stdin?: string): Promise<{ code: number | null; out: string; err: string }> {
  if (!existsSync(PYTHON)) {
    /* AV-015 §5: no install steps on a colleague's screen — they go to the
       server log (and the runbook); the screen says what to do in plain words. */
    console.warn(`[制图服务] 找不到 ${PYTHON}：装好 Python 3.11 后重新运行 scripts/update，或设置 AV_PYTHON。`);
    return Promise.reject(new DrawingServiceError('制图服务暂不可用，请联系管理员。'));
  }
  return new Promise((resolve, reject) => {
    // UTF-8 both ways: a Windows pipe otherwise defaults to the ANSI code page and
    // Chinese in the JSON output (or in a drawing's file name) fails to encode.
    const child = spawn(PYTHON, args, { cwd: SERVICE_DIR, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');   // decode across chunk boundaries (large case imports)
    child.stderr.setEncoding('utf8');
    const timer = setTimeout(() => { child.kill(); reject(new DrawingServiceError('制图服务超时')); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(new DrawingServiceError(e.message)); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

export function runDrawingCli(args: string[], stdin?: string): Promise<Record<string, unknown>> {
  return runJsonCli('avdrawing.ingest.cli', args, stdin);
}

/* 历史案例：读取公司统计表（xlsx）的两张 LED 工作表 -> { cases, sheets } */
export function readCaseWorkbook(file: string): Promise<Record<string, unknown>> {
  return runJsonCli('avdrawing.cases', [file]);
}

async function runJsonCli(module: string, args: string[], stdin?: string): Promise<Record<string, unknown>> {
  const { code, out, err } = await runPython(['-m', module, ...args], stdin);
  let payload: Record<string, unknown> | null = null;
  try { payload = JSON.parse(out); } catch { /* fall through */ }
  if (code === 0 && payload) return payload;
  throw new DrawingServiceError(
    (payload?.error as string) || err.trim().split('\n').pop() || `制图服务退出码 ${code}`,
  );
}

/* Render a JSON payload to a file with one of the service's renderers and
   return the bytes: avdrawing.dxf (a drawing from src/av/core/drawing.ts ->
   R2010, mm, the §8.1 layers) or avdrawing.proposal (a ProposalDoc -> the
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
