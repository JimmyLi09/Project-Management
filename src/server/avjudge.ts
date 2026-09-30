/* ===== AV-015 图片智能判读 · 存储与任务 =====
   One row per uploaded picture (or scanned PDF). The picture is kept, shrunk to
   what the model is shown, under data/av-images/<id>/; the model's reading, the
   person's review and the engine that produced it sit in the row.

   Recognition runs in the background, one picture at a time (on a CPU-only
   server one picture takes minutes and a second one in parallel would only
   slow both). The screen polls the row for progress. When the local service is
   not there at all, the upload falls back at once instead of queueing. */

import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  defaultPitch, emptyReview, finalOf, gate, isCurved, itemOf, manualResult, pitchOptions, settle, similarCases, toConfirm,
  type Engine, type Intent, type ItemKey, type JudgeResult, type JudgeReview, type PitchOption,
} from '@/av/core/imagejudge';
import type { DrawingElement, DrawingExtra, IngestRecord, IngestResult } from '@/av/core/handoff';
import { getRulePack, LATEST_LED_PACK } from '@/av/core/rulepack';
import { logZh } from '@/lib/logmsg';
import { applyReview, getDrawing, getInquiry, insertDrawing, listPriceItems, markReviewed, searchCases } from './avdb';
import { runDrawingCli, SAMPLE_STORE } from './avdrawing';
import { fallbackChain, visionChain, visionReady, type FallbackCode, type Outcome, type Progress } from './avvision';
import { appendAudit, dataDir, getDb } from './db';

let ready = false;
function db() {
  const d = getDb();
  if (!ready) {
    d.exec(`
      CREATE TABLE IF NOT EXISTS av_judge (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        pages TEXT NOT NULL DEFAULT '[]',      /* stored page images, file names under av-images/<id>/ */
        total_pages INTEGER NOT NULL DEFAULT 1,
        page INTEGER NOT NULL DEFAULT 1,       /* which page was read */
        status TEXT NOT NULL,                  /* running | done */
        phase TEXT NOT NULL DEFAULT '',        /* queued | load | read */
        chars INTEGER NOT NULL DEFAULT 0,
        engine TEXT NOT NULL DEFAULT '',       /* vision | ocr | manual */
        model TEXT NOT NULL DEFAULT '',
        fallback TEXT NOT NULL DEFAULT '',     /* why the vision model did not read it (plain-words code) */
        detail TEXT NOT NULL DEFAULT '',       /* technical detail: admin only */
        result TEXT NOT NULL DEFAULT '',
        review TEXT NOT NULL DEFAULT '',
        started_at INTEGER NOT NULL DEFAULT 0,
        ms INTEGER NOT NULL DEFAULT 0,
        drawing_id INTEGER NOT NULL DEFAULT 0, /* set once handed to 05 */
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        handed_by TEXT NOT NULL DEFAULT '',
        handed_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_av_judge_project ON av_judge(project_id, created_at DESC);
    `);
    ready = true;
  }
  return d;
}

type Row = {
  id: number; project_id: string; file_name: string; pages: string; total_pages: number; page: number;
  status: 'running' | 'done'; phase: string; chars: number; engine: string; model: string; fallback: string; detail: string;
  result: string; review: string; started_at: number; ms: number; drawing_id: number;
  created_by: string; created_at: number; handed_by: string; handed_at: number;
};

const imageDir = (id: number) => path.join(dataDir(), 'av-images', String(id));

/* Queue state survives module re-evaluation (dev reloads, separate route bundles). */
const Q = ((globalThis as { __avJudgeQ?: { tail: Promise<void>; live: Set<number> } }).__avJudgeQ ??= {
  tail: Promise.resolve(), live: new Set<number>(),
});

const getRow = (id: number) => db().prepare('SELECT * FROM av_judge WHERE id = ?').get(id) as Row | undefined;

/* ── images ── */

export const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff']);

/* What the model is shown and the screen displays: upright, ≤ 1600 px on the
   long side, JPEG. Without sharp a JPEG / PNG goes as it is; other formats
   cannot be shown to the model and fall back to manual entry. */
async function shrink(src: Buffer, ext: string): Promise<{ data: Buffer; ext: string } | null> {
  try {
    const sharp = (await import('sharp')).default;
    const data = await sharp(src).rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
    return { data, ext: '.jpg' };
  } catch {
    return ext === '.png' || ext === '.jpg' || ext === '.jpeg' ? { data: src, ext: ext === '.jpeg' ? '.jpg' : ext } : null;
  }
}

async function storePages(id: number, file: string, ext: string): Promise<{ pages: string[]; total: number }> {
  const dir = imageDir(id);
  await mkdir(dir, { recursive: true });
  let sources: { data: Buffer; ext: string }[] = [];
  let total = 1;
  if (ext === '.pdf') {
    const tmp = path.join(os.tmpdir(), `av-raster-${id}-${Date.now()}`);
    try {
      const r = await runDrawingCli(['raster', file, tmp, '--max-pages', '5']) as { total: number; pages: string[] };
      total = r.total;
      sources = await Promise.all(r.pages.map(async (p) => ({ data: await readFile(p), ext: '.png' })));
    } finally { await rm(tmp, { recursive: true, force: true }); }
  } else {
    sources = [{ data: await readFile(file), ext }];
  }
  const pages: string[] = [];
  for (let i = 0; i < sources.length; i++) {
    const s = await shrink(sources[i].data, sources[i].ext);
    if (!s) continue;
    const name = `p${i + 1}${s.ext}`;
    await writeFile(path.join(dir, name), s.data);
    pages.push(name);
  }
  return { pages, total };
}

export async function readPage(id: number, page: number): Promise<{ data: Buffer; mime: string } | null> {
  const row = getRow(id);
  if (!row) return null;
  const name = (JSON.parse(row.pages) as string[])[page - 1];
  if (!name) return null;
  try {
    const data = await readFile(path.join(imageDir(id), name));
    return { data, mime: name.endsWith('.png') ? 'image/png' : 'image/jpeg' };
  } catch { return null; }
}

/* ── running ── */

function finish(id: number, o: Outcome, ms: number, by: string) {
  db().prepare(`UPDATE av_judge SET status = 'done', phase = '', engine = ?, model = ?, fallback = ?, detail = ?, result = ?,
    review = ?, ms = ? WHERE id = ?`)
    .run(o.engine, o.model, o.fallback ?? '', o.detail, JSON.stringify(o.result), JSON.stringify(emptyReview()), ms, id);
  const row = getRow(id)!;
  const w = itemOf(o.result, 'led_opening_w')?.value;
  const h = itemOf(o.result, 'led_opening_h')?.value;
  const p = { file: row.file_name, jk: o.result.kind ?? 'none', w: w ?? '', h: h ?? '', eng: o.engine };
  appendAudit(row.project_id, [{ at: Date.now(), by, text: logZh('av.judgeResult', p), k: 'av.judgeResult', p }]);
}

function enqueue(id: number, page: number, by: string) {
  Q.live.add(id);
  db().prepare("UPDATE av_judge SET status = 'running', phase = 'queued', chars = 0, page = ?, started_at = 0 WHERE id = ?").run(page, id);
  Q.tail = Q.tail.then(async () => {
    const row = getRow(id);
    const name = row ? (JSON.parse(row.pages) as string[])[page - 1] : undefined;
    if (!row || !name) { Q.live.delete(id); return; }
    const file = path.join(imageDir(id), name);
    const started = Date.now();
    db().prepare("UPDATE av_judge SET phase = 'load', started_at = ? WHERE id = ?").run(started, id);
    let last = 0;
    const progress = (p: Progress) => {
      const now = Date.now();
      if (now - last < 800) return;
      last = now;
      db().prepare('UPDATE av_judge SET phase = ?, chars = ? WHERE id = ?').run(p.phase, p.chars, id);
    };
    try {
      const b64 = (await readFile(file)).toString('base64');
      const o = await visionChain(b64, file, progress);
      finish(id, o, Date.now() - started, by);
    } catch (e) {
      finish(id, await fallbackChain(file, 'vision_failed', (e as Error).message), Date.now() - started, by);
    } finally { Q.live.delete(id); }
  });
}

/* A row left 'running' by a restarted server is not coming back. */
async function heal(row: Row): Promise<Row> {
  if (row.status !== 'running' || Q.live.has(row.id)) return row;
  const name = (JSON.parse(row.pages) as string[])[row.page - 1];
  const o = await fallbackChain(name ? path.join(imageDir(row.id), name) : null, 'interrupted', '服务器重启，识别中断');
  finish(row.id, o, 0, row.created_by);
  return getRow(row.id)!;
}

/* Upload → a judgement row. Falls back at once when the local service is not
   there; otherwise queues the vision run and returns while it works. */
export async function startJudge(a: { projectId: string; fileName: string; file: string; ext: string; by: string }): Promise<number> {
  const { lastInsertRowid } = db().prepare(`INSERT INTO av_judge (project_id, file_name, status, phase, created_by, created_at)
    VALUES (?, ?, 'running', 'queued', ?, ?)`).run(a.projectId, a.fileName, a.by, Date.now());
  const id = Number(lastInsertRowid);
  const up = { file: a.fileName };
  appendAudit(a.projectId, [{ at: Date.now(), by: a.by, text: logZh('av.judgeUpload', up), k: 'av.judgeUpload', p: up }]);
  let stored: { pages: string[]; total: number };
  try { stored = await storePages(id, a.file, a.ext); }
  catch (e) { stored = { pages: [], total: 1 }; console.warn(`[AV-015] 图片存不下来：${(e as Error).message}`); }
  db().prepare('UPDATE av_judge SET pages = ?, total_pages = ? WHERE id = ?').run(JSON.stringify(stored.pages), stored.total, id);
  if (!stored.pages.length) {
    finish(id, { result: manualResult('manual'), engine: 'manual', model: '', fallback: 'bad_image', detail: `读不了 ${a.ext} 图片` }, 0, a.by);
    return id;
  }
  const ok = await visionReady();
  if (!ok.ok) {
    const o = await fallbackChain(path.join(imageDir(id), stored.pages[0]), ok.code, ok.detail);
    finish(id, o, 0, a.by);
    return id;
  }
  enqueue(id, 1, a.by);
  return id;
}

export async function rerunJudge(id: number, page: number, by: string): Promise<void> {
  const row = getRow(id);
  if (!row) throw new Error('判读记录不存在');
  if (row.drawing_id) throw new Error('已带入 05，不能重新识别；请重新上传');
  if (row.status === 'running') throw new Error('正在识别，请稍候');
  const pages = JSON.parse(row.pages) as string[];
  if (!(page >= 1 && page <= pages.length)) throw new Error('没有这一页');
  const ok = await visionReady();
  if (!ok.ok) {
    db().prepare('UPDATE av_judge SET page = ? WHERE id = ?').run(page, id);
    finish(id, await fallbackChain(path.join(imageDir(id), pages[page - 1]), ok.code, ok.detail), 0, by);
    return;
  }
  enqueue(id, page, by);
}

/* ── what the screen gets ── */

export interface JudgeView {
  id: number;
  projectId: string;
  fileName: string;
  pages: number;
  totalPages: number;
  page: number;
  status: 'running' | 'done';
  phase: string;
  chars: number;
  elapsedMs: number;
  engine: Engine | '';
  model: string;
  fallback: FallbackCode | '';
  detail?: string;                    // admins only
  ms: number;
  result: JudgeResult | null;
  review: JudgeReview;
  pitchOptions: PitchOption[];
  suggestedPitch: number | null;
  gate: ReturnType<typeof gate> | null;
  mod: [number, number];              // module size 05 will tile with (snap suggestions)
  cases: { name: string; client: string | null; widthMm: number | null; heightMm: number | null; pitch: number | null; status: string; curved: boolean }[];
  drawingId: number;
  createdBy: string;
  createdAt: number;
  handedBy: string;
  handedAt: number;
}

export interface JudgeSummary { id: number; fileName: string; status: string; engine: string; drawingId: number; createdBy: string; createdAt: number }

export function listJudges(projectId: string): JudgeSummary[] {
  return (db().prepare('SELECT id, file_name, status, engine, drawing_id, created_by, created_at FROM av_judge WHERE project_id = ? ORDER BY created_at DESC, id DESC')
    .all(projectId) as Pick<Row, 'id' | 'file_name' | 'status' | 'engine' | 'drawing_id' | 'created_by' | 'created_at'>[])
    .map((r) => ({ id: r.id, fileName: r.file_name, status: r.status, engine: r.engine, drawingId: r.drawing_id, createdBy: r.created_by, createdAt: r.created_at }));
}

const CURVE = /curve|curved|arc|弧|曲/i;

/* The kernel's side of the screen: pitch candidates, the default, the gate and
   similar cases, all from the stored reading + review. */
function derive(result: JudgeResult, review: JudgeReview, projectId: string) {
  const options = pitchOptions(listPriceItems('led'), result.env === 'outdoor' ? 'outdoor' : 'indoor');
  const drawn = finalOf(result, review, 'pitch_hint');
  const view = settle(result, review).view;
  const suggested = defaultPitch(options, view, typeof drawn === 'number' ? drawn : null);
  const pack = getRulePack(getInquiry(projectId)?.packs.led ?? LATEST_LED_PACK);
  const prof = pack.profiles[result.env === 'outdoor' ? 'out_fixed' : 'in_fixed'];
  const mod: [number, number] = [prof.modW, prof.modH];
  const s = settle(result, review, suggested, mod);
  const sqm = s.tileWidth && s.height ? (s.tileWidth * s.height) / 1e6 : null;
  const cases = similarCases(searchCases({}, 'sqm', 'desc', 5000).cases, { sqm, pitch: s.pitch, curved: isCurved(finalOf(result, review, 'shape')) })
    .map((c) => ({ name: c.name, client: c.client, widthMm: c.widthMm, heightMm: c.heightMm, pitch: c.pitch, status: c.status,
      curved: CURVE.test(`${c.name} ${c.product ?? ''} ${c.remarks ?? ''}`) }));
  return { options, suggested, gate: gate(result, review, suggested, mod), settled: s, mod, cases };
}

export async function getJudgeView(id: number, admin: boolean): Promise<JudgeView | null> {
  let row = getRow(id);
  if (!row) return null;
  row = await heal(row);
  const result = row.result ? JSON.parse(row.result) as JudgeResult : null;
  const review = row.review ? JSON.parse(row.review) as JudgeReview : emptyReview();
  const d = result ? derive(result, review, row.project_id) : null;
  return {
    id: row.id, projectId: row.project_id, fileName: row.file_name, pages: (JSON.parse(row.pages) as string[]).length,
    totalPages: row.total_pages, page: row.page, status: row.status, phase: row.phase, chars: row.chars,
    elapsedMs: row.status === 'running' && row.started_at ? Date.now() - row.started_at : 0,
    engine: row.engine as Engine | '', model: row.model, fallback: row.fallback as FallbackCode | '',
    ...(admin ? { detail: row.detail } : {}),
    ms: row.ms, result, review, pitchOptions: d?.options ?? [], suggestedPitch: d?.suggested ?? null, gate: d?.gate ?? null,
    mod: d?.mod ?? [320, 160], cases: d?.cases ?? [], drawingId: row.drawing_id, createdBy: row.created_by, createdAt: row.created_at,
    handedBy: row.handed_by, handedAt: row.handed_at,
  };
}

export const judgeProject = (id: number) => getRow(id)?.project_id ?? null;

/* ── the person's review: only these fields, validated, are taken from the screen ── */

const SHAPES = new Set(['flat', 'concave', 'convex', 'corner', 'irregular']);
const MOUNTS = new Set(['recessed', 'wall', 'floor', 'hanging', 'truss']);
const ANSWER_KEYS = new Set(['arc', 'radKind', 'rad', 'view', 'maint', 'ctrl', 'pwr', 'size_w', 'size_h', 'snapW', 'snapH']);

export function saveReview(id: number, input: Partial<JudgeReview>): JudgeReview {
  const row = getRow(id);
  if (!row) throw new Error('判读记录不存在');
  if (row.status !== 'done' || !row.result) throw new Error('还在识别，请稍候');
  if (row.drawing_id) throw new Error('已带入 05，不能再改；如需修改请重新上传');
  const result = JSON.parse(row.result) as JudgeResult;
  const cur = row.review ? JSON.parse(row.review) as JudgeReview : emptyReview();
  const next: JudgeReview = { ...cur };
  if ('intent' in input) {
    if (input.intent !== null && !['site', 'ref', 'other'].includes(String(input.intent))) throw new Error('用途无效');
    next.intent = (input.intent ?? null) as Intent | null;
  }
  const confirmable = new Set<ItemKey>(toConfirm(result));
  if (input.confirmed) {
    next.confirmed = {};
    for (const [k, v] of Object.entries(input.confirmed)) {
      if (!confirmable.has(k as ItemKey)) throw new Error(`没有要确认的「${k}」`);
      if (v) next.confirmed[k as ItemKey] = true;
    }
  }
  if (input.values) {
    next.values = {};
    for (const [k, v] of Object.entries(input.values)) {
      const it = itemOf(result, k as ItemKey);
      if (!it) throw new Error(`没有「${k}」这一项`);
      if (k === 'shape') { if (!SHAPES.has(String(v))) throw new Error('形状无效'); next.values.shape = String(v); continue; }
      if (k === 'mount') { if (!MOUNTS.has(String(v))) throw new Error('安装方式无效'); next.values.mount = String(v); continue; }
      if (k === 'ratio') continue;
      if (v === null) { next.values[k as ItemKey] = null; continue; }
      const n = Number(v);
      if (!(Number.isFinite(n) && n >= 0)) throw new Error('数值须为非负数');
      next.values[k as ItemKey] = n;
    }
  }
  if (input.answers) {
    next.answers = {};
    for (const [k, v] of Object.entries(input.answers)) {
      if (!ANSWER_KEYS.has(k)) continue;
      const sv = String(v ?? '').slice(0, 20);
      if (sv && ['rad', 'view', 'ctrl', 'pwr', 'size_w', 'size_h', 'snapW', 'snapH'].includes(k) && !(Number(sv) >= 0)) throw new Error('请填数字');
      if (sv) (next.answers as Record<string, string>)[k] = sv;
    }
  }
  if ('pitch' in input) {
    if (input.pitch === null) next.pitch = null;
    else {
      const p = Number(input.pitch);
      const d = derive(result, next, row.project_id);
      const drawn = finalOf(result, next, 'pitch_hint');
      const known = d.options.some((o) => Math.abs(o.pitch - p) < 1e-9) || (typeof drawn === 'number' && Math.abs(drawn - p) < 1e-9);
      if (!known) throw new Error('点间距须从候选里选');
      const view = d.settled.view;
      if (view !== null && p > view + 1e-9 && !(typeof drawn === 'number' && Math.abs(drawn - p) < 1e-9)) {
        throw new Error(`P${p} 不满足 LED-VD-01（最近观看距离 ${view} m）`);
      }
      next.pitch = p;
    }
  }
  db().prepare('UPDATE av_judge SET review = ? WHERE id = ?').run(JSON.stringify(next), id);
  return next;
}

/* ── 带入 05 (§4.5) ── */

const METHOD: Record<Engine, IngestRecord['prov']['method']> = { vision: 'ai_vision', ocr: 'ai_ocr', manual: 'manual' };

export async function handoff(id: number, by: string): Promise<number> {
  const row = getRow(id);
  if (!row || row.status !== 'done' || !row.result) throw new Error('判读记录不存在或还在识别');
  if (row.drawing_id) return row.drawing_id;
  const result = JSON.parse(row.result) as JudgeResult;
  const review = row.review ? JSON.parse(row.review) as JudgeReview : emptyReview();
  const d = derive(result, review, row.project_id);
  if (!d.gate.ok) throw new Error(d.gate.reasons.join('；'));
  const s = d.settled;
  const engine = row.engine as Engine;

  /* the value 05 uses for each element, and how it came to be */
  const final: Record<DrawingElement, { v: number | null; note: string | null; derived: boolean }> = {
    led_opening_w: { v: s.tileWidth, derived: !!s.curve && s.curve.arc !== s.curve.width || !!s.derived.width,
      note: [s.curve ? (s.curve.given === 'chord'
        ? `弧形屏：弦长 ${s.curve.width} mm + ${review.answers.radKind === 'rise' ? `弧高 ${s.curve.rise}` : `半径 ${s.curve.radius}`} mm → 弧长 ${s.curve.arc} mm（确定性换算），按弧长平铺`
        : s.curve.given === 'arc' ? '弧形屏：标注即弧长，按弧长平铺' : '弧形屏：宽是弧长还是弦长待现场量，暂按标注值平铺')
        : null, s.derived.width ?? null].filter(Boolean).join('；') || null },
    led_opening_h: { v: s.height, derived: !!s.derived.height, note: s.derived.height ?? null },
    led_mount_h: { v: s.mountH, derived: false, note: null },
    led_view_min: { v: s.view, derived: false, note: null },
    led_ctrl_dist: { v: s.ctrl, derived: false, note: null },
    led_pwr_dist: { v: s.pwr, derived: false, note: null },
  };
  const readable = review.intent === 'site';   // a reference picture's sizes are not ours
  const extractions: IngestRecord[] = (Object.keys(final) as DrawingElement[]).map((el) => {
    const it = itemOf(result, el);
    const read = readable || (el !== 'led_opening_w' && el !== 'led_opening_h') ? it?.value ?? null : null;
    return {
      drawing: row.file_name, element: el, value: typeof read === 'number' ? read : null, unit: it?.unit ?? (el.endsWith('_h') || el === 'led_opening_w' ? 'mm' : 'm'),
      prov: {
        source: `来自图片 · 已人工确认 · ${it?.source || (it?.raw ? `读自「${it.raw}」` : '人工填写')}`,
        method: typeof read === 'number' ? METHOD[engine] : 'manual',
        confidence: typeof read === 'number' ? it!.confidence : 0, rule: null,
        note: [final[el].note, it?.estimated ? '估算值' : null].filter(Boolean).join('；') || null,
      },
      confirmed: false, corrected: null, corrected_by: '', corrected_at: '', needs_review: true,
    };
  });
  const ingest: IngestResult = {
    drawing: row.file_name, grade: 'C', scale_mm_per_unit: 0, threshold: 0.85,
    notes: ['图片智能判读（AV-015）：模型只读图，数值逐项人工确认后带入；点间距、箱体、功耗、线材由计算内核按规则包算。'],
    may_enter_configuration: false, extractions,
  };
  const pending = (['led_view_min', 'led_ctrl_dist', 'led_pwr_dist'] as DrawingElement[]).filter((el) => final[el].v === null);
  const extra: DrawingExtra = {
    judgeId: id, intent: review.intent === 'ref' ? 'ref' : 'site', curve: s.curve, pitch: s.pitch, maintain: s.maintain, pending,
    notes: [
      ...(pending.length ? ['按默认值估算，待补：' + pending.map((p) => ({ led_view_min: '最近观看距离', led_ctrl_dist: '控制室距离', led_pwr_dist: '配电距离' } as Record<string, string>)[p]).join('、')] : []),
      ...(s.curve ? ['弧形屏：按弧长平铺排箱体、算功耗和线材；弧形箱体 / 柔性模组 / 弧形钢结构在 06 单列「待询价」。'] : []),
      ...(review.intent === 'ref' ? ['用途为「参考效果」：尺寸按我们现场填写，图片只参考形状与效果。'] : []),
    ],
  };
  const drawingId = insertDrawing(row.project_id, ingest, row.created_by, extra);
  applyReview(drawingId, extractions.map((r) => {
    const v = final[r.element].v;
    return { element: r.element, confirmed: true, corrected: v !== null && v !== r.value ? v : null };
  }), by);
  markReviewed(drawingId, by);
  db().prepare('UPDATE av_judge SET drawing_id = ?, handed_by = ?, handed_at = ? WHERE id = ?').run(drawingId, by, Date.now(), id);

  /* samples (models.write_back_samples): only a person correcting what the
     model read — not a reference picture's sizes, not an arc conversion */
  const drawing = getDrawing(drawingId)!;
  const samples = {
    ...drawing,
    extractions: drawing.extractions.filter((r) => !final[r.element].derived && r.value !== null),
  };
  if (engine !== 'manual' && samples.extractions.some((r) => r.corrected !== null)) {
    await runDrawingCli(['writeback', SAMPLE_STORE], JSON.stringify(samples))
      .catch((e) => console.warn(`[AV-015] 样本回写跳过：${(e as Error).message}`));
  }

  const changed: string[] = [];
  for (const k of Object.keys(review.values) as ItemKey[]) {
    const it = itemOf(result, k);
    const v = review.values[k];
    if (it && v !== it.value) changed.push(`${k}:${it.value ?? ''}:${v ?? ''}`);
  }
  const p = { file: row.file_name, w: s.tileWidth ?? '', h: s.height ?? '', pitch: s.pitch ?? '', jchg: changed.join(';') };
  appendAudit(row.project_id, [{ at: Date.now(), by, text: logZh('av.judgeConfirm', p), k: 'av.judgeConfirm', p }]);
  return drawingId;
}

export async function deleteProjectJudges(projectId: string): Promise<void> {
  const ids = (db().prepare('SELECT id FROM av_judge WHERE project_id = ?').all(projectId) as { id: number }[]).map((r) => r.id);
  db().prepare('DELETE FROM av_judge WHERE project_id = ?').run(projectId);
  await Promise.all(ids.map((id) => rm(imageDir(id), { recursive: true, force: true })));
}

/* the most recent vision run, for the admin status page */
export function lastVisionRun(): { at: number; ms: number; model: string; engine: string; fallback: string } | null {
  const r = db().prepare("SELECT created_at, ms, model, engine, fallback FROM av_judge WHERE status = 'done' ORDER BY id DESC LIMIT 1")
    .get() as { created_at: number; ms: number; model: string; engine: string; fallback: string } | undefined;
  return r ? { at: r.created_at, ms: r.ms, model: r.model, engine: r.engine, fallback: r.fallback } : null;
}

