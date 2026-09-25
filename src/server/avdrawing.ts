/* ===== Bridge to the Python drawing service (services/drawing) =====
   Spawns `python -m avdrawing.ingest.cli` per request: JSON on stdout, errors as
   {"error": ...} with exit code 2. One app, one intranet server (§14), no
   second long-running process to supervise. */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

const SERVICE_DIR = path.join(process.cwd(), 'services', 'drawing');
const PYTHON = process.env.AV_PYTHON || path.join(SERVICE_DIR, '.venv', 'bin', 'python');
const TIMEOUT_MS = 120_000;

export const SAMPLE_STORE = path.join(process.cwd(), 'data', 'av-samples', 'led.jsonl');

export class DrawingServiceError extends Error {}

export function runDrawingCli(args: string[], stdin?: string): Promise<Record<string, unknown>> {
  if (!existsSync(PYTHON)) {
    return Promise.reject(new DrawingServiceError(
      `制图服务未安装（找不到 ${PYTHON}）。按 services/drawing/README.md 建立虚拟环境，或设置 AV_PYTHON。`,
    ));
  }
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, ['-m', 'avdrawing.ingest.cli', ...args], { cwd: SERVICE_DIR });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new DrawingServiceError('图纸解析超时')); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(new DrawingServiceError(e.message)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      let payload: Record<string, unknown> | null = null;
      try { payload = JSON.parse(out); } catch { /* fall through */ }
      if (code === 0 && payload) return resolve(payload);
      reject(new DrawingServiceError(
        (payload?.error as string) || err.trim().split('\n').pop() || `制图服务退出码 ${code}`,
      ));
    });
    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
  });
}
