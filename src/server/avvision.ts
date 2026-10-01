/* ===== AV-015 识别引擎：本机视觉模型 → OCR → 手填 =====
   The picture never leaves the server: the vision engine is Ollama on this
   machine (127.0.0.1:11434 by default), running an open model whose licence
   allows commercial use; no paid API is called anywhere.

   Engines are tried in order and each one only has to answer "here is what I
   read" or fail. A failure is logged with its technical detail for the admin
   status page and the server log; the screen gets a plain-words reason code
   and the next engine's result. Manual entry cannot fail, so the flow never
   stops (§5). */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

import {
  JUDGE_PROMPT, JUDGE_SCHEMA, manualResult, normalise, ocrNumbers, type Engine, type JudgeResult,
} from '@/av/core/imagejudge';
import { getSetting, setSetting } from './db';

/* ── settings (规则设置 › 识别服务) ── */

export interface VisionSettings {
  enabled: boolean;
  model: string;
  url: string;
  timeoutSec: number;
  keepAliveMin: number;     // Ollama keep_alive: unload the model after this many idle minutes
  updatedBy: string;
  updatedAt: number;
}

/* Qwen2.5-VL 7B: Apache-2.0 (the 3B is research-only, the 72B has its own
   licence — neither may be used here). */
export const DEFAULT_MODEL = 'qwen2.5vl:7b';

export const VISION_DEFAULTS: VisionSettings = {
  enabled: true, model: DEFAULT_MODEL, url: 'http://127.0.0.1:11434', timeoutSec: 240, keepAliveMin: 10,
  updatedBy: '', updatedAt: 0,
};

const KEY = 'av_vision';

export function getVisionSettings(): VisionSettings {
  try {
    const v = JSON.parse(getSetting(KEY) || '{}') as Partial<VisionSettings>;
    return { ...VISION_DEFAULTS, ...v };
  } catch { return { ...VISION_DEFAULTS }; }
}

/* The engine may only be reached inside the company: this machine or a private
   LAN address. Anything else would send pictures off the intranet. */
export function isLocalUrl(u: string): boolean {
  let url: URL;
  try { url = new URL(u); } catch { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const h = url.hostname.replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1') return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function validateVisionSettings(input: Partial<VisionSettings>): { settings: Omit<VisionSettings, 'updatedBy' | 'updatedAt'> } | { error: string } {
  const cur = getVisionSettings();
  const model = String(input.model ?? cur.model).trim();
  const url = String(input.url ?? cur.url).trim().replace(/\/+$/, '');
  const timeoutSec = Number(input.timeoutSec ?? cur.timeoutSec);
  const keepAliveMin = Number(input.keepAliveMin ?? cur.keepAliveMin);
  if (!/^[\w.\-/:]{1,100}$/.test(model)) return { error: '模型名只能包含字母、数字和 . - / : _' };
  if (!isLocalUrl(url)) return { error: '服务地址只能是本机（127.0.0.1）或公司内网地址，图片不能出内网' };
  if (!(timeoutSec >= 30 && timeoutSec <= 900)) return { error: '超时须在 30–900 秒之间' };
  if (!(keepAliveMin >= 0 && keepAliveMin <= 720)) return { error: '空闲卸载须在 0–720 分钟之间' };
  return { settings: { enabled: input.enabled ?? cur.enabled, model, url, timeoutSec: Math.round(timeoutSec), keepAliveMin: Math.round(keepAliveMin) } };
}

export function saveVisionSettings(s: Omit<VisionSettings, 'updatedBy' | 'updatedAt'>, by: string): VisionSettings {
  const v = { ...s, updatedBy: by, updatedAt: Date.now() };
  setSetting(KEY, JSON.stringify(v));
  return v;
}

/* ── Ollama ── */

/* Why an engine was skipped or failed — the screen turns these into plain
   words; the detail next to it is for the admin only. */
export type FallbackCode =
  | 'vision_off' | 'vision_down' | 'model_missing' | 'vision_timeout' | 'vision_failed' | 'bad_output'
  | 'bad_image' | 'interrupted'
  | 'by_hand';   // AV-016:解析失败的留档,同事点了「手填」

class EngineError extends Error {
  constructor(public code: FallbackCode, detail: string) { super(detail); }
}

async function ollama(s: VisionSettings, p: string, init: RequestInit & { timeoutMs: number }): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), init.timeoutMs);
  try {
    return await fetch(`${s.url}${p}`, { ...init, signal: ctl.signal });
  } finally { clearTimeout(timer); }
}

const sameModel = (a: string, b: string) => a === b || a === `${b}:latest` || `${a}:latest` === b;

/* Fast pre-flight (a couple of seconds): is the service up and the model
   pulled? Called before accepting a job, so a missing service falls back at
   once instead of after the full timeout. */
export async function visionReady(s = getVisionSettings()): Promise<{ ok: true } | { ok: false; code: FallbackCode; detail: string }> {
  if (!s.enabled) return { ok: false, code: 'vision_off', detail: '管理员已关闭本机视觉模型' };
  if (!isLocalUrl(s.url)) return { ok: false, code: 'vision_off', detail: `服务地址 ${s.url} 不是本机 / 内网地址` };
  let tags: { models?: { name: string }[] };
  try {
    const res = await ollama(s, '/api/tags', { timeoutMs: 2500 });
    if (!res.ok) return { ok: false, code: 'vision_down', detail: `GET /api/tags → HTTP ${res.status}` };
    tags = await res.json();
  } catch (e) {
    return { ok: false, code: 'vision_down', detail: `连不上 ${s.url}：${(e as Error).message}` };
  }
  if (!(tags.models ?? []).some((m) => sameModel(m.name, s.model))) {
    return { ok: false, code: 'model_missing', detail: `Ollama 里没有模型 ${s.model}（已装：${(tags.models ?? []).map((m) => m.name).join('、') || '无'}）` };
  }
  return { ok: true };
}

export interface Progress { phase: 'load' | 'read'; chars: number }

/* One picture through the vision model. Streams, so the screen can show that
   it is still working (on a CPU-only server a picture takes minutes). */
export async function runVision(
  imageB64: string, onProgress: (p: Progress) => void, s = getVisionSettings(),
): Promise<{ raw: unknown; model: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), s.timeoutSec * 1000);
  let res: Response;
  try {
    onProgress({ phase: 'load', chars: 0 });
    res = await fetch(`${s.url}/api/chat`, {
      method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: s.model, stream: true, format: JUDGE_SCHEMA, keep_alive: `${s.keepAliveMin}m`,
        options: { temperature: 0, num_predict: 1500 },
        messages: [{ role: 'user', content: JUDGE_PROMPT, images: [imageB64] }],
      }),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new EngineError(res.status === 404 ? 'model_missing' : 'vision_failed', `POST /api/chat → HTTP ${res.status} ${text.slice(0, 300)}`);
    }
    let content = '';
    let buf = '';
    const dec = new TextDecoder();
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += dec.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line) as { message?: { content?: string }; error?: string; done?: boolean };
        if (msg.error) throw new EngineError('vision_failed', msg.error);
        content += msg.message?.content ?? '';
        onProgress({ phase: 'read', chars: content.length });
      }
    }
    try {
      return { raw: JSON.parse(content), model: s.model };
    } catch {
      const m = /\{[\s\S]*\}/.exec(content);
      try { if (m) return { raw: JSON.parse(m[0]), model: s.model }; } catch { /* fall through */ }
      throw new EngineError('bad_output', `模型输出不是合法 JSON：${content.slice(0, 300)}`);
    }
  } catch (e) {
    if (e instanceof EngineError) throw e;
    if (ctl.signal.aborted) throw new EngineError('vision_timeout', `超过 ${s.timeoutSec} 秒没有读完`);
    throw new EngineError('vision_failed', (e as Error).message);
  } finally { clearTimeout(timer); }
}

/* ── OCR (separate environment, see services/drawing/requirements-ocr.txt) ── */

const SERVICE_DIR = path.join(process.cwd(), 'services', 'drawing');

export function ocrPython(): string | null {
  const p = process.env.AV_OCR_PYTHON || (process.platform === 'win32'
    ? path.join(SERVICE_DIR, '.venv-ocr', 'Scripts', 'python.exe')
    : path.join(SERVICE_DIR, '.venv-ocr', 'bin', 'python'));
  return existsSync(p) ? p : null;
}

async function runOcr(image: string): Promise<{ boxes: { text: string; confidence: number }[] } | { error: string }> {
  const py = ocrPython();
  if (!py) return { error: 'OCR 没有安装（没有 .venv-ocr）' };
  return new Promise((resolve) => {
    const child = spawn(py, ['-m', 'avdrawing.ingest.ocrcli', image], {
      cwd: SERVICE_DIR, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const timer = setTimeout(() => { child.kill(); resolve({ error: 'OCR 超过 120 秒' }); }, 120_000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ error: e.message }); });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out) as { boxes?: { text: string; confidence: number }[]; error?: string };
        resolve(j.boxes ? { boxes: j.boxes } : { error: j.error || 'OCR 无输出' });
      } catch { resolve({ error: err.trim().split('\n').pop() || 'OCR 无输出' }); }
    });
  });
}

/* ── the chain ── */

export interface Outcome {
  result: JudgeResult;
  engine: Engine;
  model: string;
  fallback: FallbackCode | null;   // why the vision model did not produce this result
  detail: string;                  // technical detail — admin status page and server log only
}

/* After the vision model is out: OCR if it is installed, else manual. */
export async function fallbackChain(imageFile: string | null, code: FallbackCode, detail: string): Promise<Outcome> {
  console.warn(`[AV-015] 本机视觉模型未用上（${code}）：${detail}`);
  if (imageFile) {
    const ocr = await runOcr(imageFile);
    if ('boxes' in ocr) {
      return { result: manualResult('ocr', ocrNumbers(ocr.boxes)), engine: 'ocr', model: 'PaddleOCR', fallback: code, detail };
    }
    if (ocrPython()) console.warn(`[AV-015] OCR 也失败：${ocr.error}`);
  }
  return { result: manualResult('manual'), engine: 'manual', model: '', fallback: code, detail };
}

export async function visionChain(imageB64: string, imageFile: string, onProgress: (p: Progress) => void): Promise<Outcome> {
  const s = getVisionSettings();
  try {
    const { raw, model } = await runVision(imageB64, onProgress, s);
    return { result: normalise(raw), engine: 'vision', model, fallback: null, detail: '' };
  } catch (e) {
    const code = e instanceof EngineError ? e.code : 'vision_failed';
    return fallbackChain(imageFile, code, (e as Error).message);
  }
}

/* ── 检测状态 (admin) ── */

export interface VisionStatus {
  settings: VisionSettings;
  urlLocal: boolean;
  service: { ok: boolean; version: string; error: string };
  model: { installed: boolean; params: string; quant: string; sizeGb: number | null; license: string };
  processor: 'gpu' | 'cpu' | 'mixed' | 'not_loaded' | 'unknown';
  vramGb: number | null;
  ocr: boolean;
  checkedAt: number;
}

export async function visionStatus(warm: boolean): Promise<VisionStatus> {
  const s = getVisionSettings();
  const out: VisionStatus = {
    settings: s, urlLocal: isLocalUrl(s.url),
    service: { ok: false, version: '', error: '' },
    model: { installed: false, params: '', quant: '', sizeGb: null, license: '' },
    processor: 'unknown', vramGb: null, ocr: !!ocrPython(), checkedAt: Date.now(),
  };
  if (!out.urlLocal) { out.service.error = '服务地址不是本机 / 内网地址'; return out; }
  const json = async <T,>(p: string, init: RequestInit & { timeoutMs: number }): Promise<T> => {
    const res = await ollama(s, p, init);
    if (!res.ok) throw new Error(`${p} → HTTP ${res.status}`);
    return res.json() as Promise<T>;
  };
  try {
    out.service.version = (await json<{ version: string }>('/api/version', { timeoutMs: 3000 })).version;
    out.service.ok = true;
  } catch (e) { out.service.error = (e as Error).message; return out; }
  try {
    const tags = await json<{ models?: { name: string; size: number }[] }>('/api/tags', { timeoutMs: 3000 });
    const m = (tags.models ?? []).find((x) => sameModel(x.name, s.model));
    if (m) {
      out.model.installed = true;
      out.model.sizeGb = Math.round((m.size / 1e9) * 10) / 10;
      const show = await json<{ license?: string; details?: { parameter_size?: string; quantization_level?: string } }>('/api/show', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: s.model }), timeoutMs: 5000,
      }).catch(() => ({} as { license?: string; details?: { parameter_size?: string; quantization_level?: string } }));
      out.model.params = show.details?.parameter_size ?? '';
      out.model.quant = show.details?.quantization_level ?? '';
      out.model.license = (show.license ?? '').split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 80) ?? '';
    }
  } catch (e) { out.service.error = (e as Error).message; }
  if (out.model.installed && warm) {
    /* loading the model is what tells us GPU or CPU; an empty prompt only loads it */
    await json('/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: s.model, prompt: '', keep_alive: `${s.keepAliveMin}m` }), timeoutMs: s.timeoutSec * 1000,
    }).catch((e) => { out.service.error = `加载模型失败：${(e as Error).message}`; });
  }
  try {
    const ps = await json<{ models?: { name: string; size: number; size_vram: number }[] }>('/api/ps', { timeoutMs: 3000 });
    const m = (ps.models ?? []).find((x) => sameModel(x.name, s.model));
    if (!m) out.processor = 'not_loaded';
    else {
      out.vramGb = Math.round((m.size_vram / 1e9) * 10) / 10;
      out.processor = m.size_vram <= 0 ? 'cpu' : m.size_vram >= m.size * 0.99 ? 'gpu' : 'mixed';
    }
  } catch { out.processor = 'unknown'; }
  return out;
}
