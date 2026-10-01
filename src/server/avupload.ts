/* ===== AV-016 ① 图纸先留档再解析 =====
   原来上传的文件写进临时目录,解析完(或失败)就删掉 —— 解析一失败,文件就没了,
   同事得回头再找一遍原件。现在先把原件存进 data/av-files/<留档号>/,再解析;
   失败的留档照样列在「项目图纸」里,可以「重新解析」「下载原件」。

   解析本身不变:DXF / 矢量 PDF 走制图服务,图片 / 扫描件走 AV-015 的图片判读。 */

import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';

import type { IngestResult, StoredDrawing } from '@/av/core/handoff';
import { logZh } from '@/lib/logmsg';
import { getDrawing, insertDrawing } from './avdb';
import { DrawingServiceError, runDrawingCli } from './avdrawing';
import { getJudgeView, IMAGE_EXT, startJudge, startManual, type JudgeView } from './avjudge';
import { appendAudit, dataDir, getDb } from './db';

let ready = false;
function db() {
  const d = getDb();
  if (!ready) {
    d.exec(`
      CREATE TABLE IF NOT EXISTS av_upload (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        size INTEGER NOT NULL,
        status TEXT NOT NULL,            /* parsing | parsed | judge | failed */
        error TEXT NOT NULL DEFAULT '',  /* 失败原因(人话) */
        drawing_id INTEGER NOT NULL DEFAULT 0,
        judge_id INTEGER NOT NULL DEFAULT 0,
        uploaded_by TEXT NOT NULL,
        uploaded_at INTEGER NOT NULL,
        parsed_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_av_upload_project ON av_upload(project_id, uploaded_at DESC);
    `);
    /* AV-016:技术错误另存一列,只给管理员看;error 列只放人话 */
    const cols = (d.prepare('PRAGMA table_info(av_upload)').all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes('detail')) d.exec('ALTER TABLE av_upload ADD COLUMN detail TEXT');
    /* 复查 #68:这一次开始解析的时间,用来认出「解析中」卡住的(服务器在解析途中重启) */
    if (!cols.includes('started_at')) d.exec('ALTER TABLE av_upload ADD COLUMN started_at INTEGER');
    ready = true;
  }
  return d;
}

type Row = {
  id: number; project_id: string; file_name: string; size: number; status: string; error: string;
  drawing_id: number; judge_id: number; uploaded_by: string; uploaded_at: number; parsed_at: number; detail: string | null;
  started_at: number | null;
};

export interface UploadSummary {
  id: number; fileName: string; size: number; status: 'parsing' | 'parsed' | 'judge' | 'failed'; error: string;
  drawingId: number; judgeId: number; uploadedBy: string; uploadedAt: number;
  reason?: ReasonCode; // 失败原因归类(页面按语言显示)
  detail?: string;   // 技术原因,只有管理员拿得到
}

/* ===== 解析失败的原因:给同事看的人话 =====
   制图服务报出来的是 Python 的异常、进程退出码、英文提示,同事看不懂也用不上。
   这里归成几句人话,每句都说清楚「文件已保存」和下一步能做什么;原文进服务器日志
   和 detail 列(管理员可见)。0930 先行版存下的老记录显示时也过一遍。 */
const R = {
  down: '本机识别服务暂不可用。文件已保存，可稍后重新解析，或直接手填。',
  timeout: '本机识别服务超时。文件已保存，可稍后重新解析，或直接手填。',
  scale: '比例尺未标定：在右边填上比例（如 1:50 填 50）再重新解析，或直接手填。',
  units: '图纸没有设置单位（毫米 / 米），读不出尺寸。请设计方补上单位后重新上传，或直接手填。',
  type: '这种文件格式读不了（支持 DXF、PDF、图片）。文件已保存，可以手填。',
  broken: '文件损坏或打不开。请重新导出后上传，或直接手填。',
  interrupted: '上次解析被中断（可能是服务器重启）。文件已保存，可以重新解析或手填。',
  other: '解析没成功。文件已保存，可以重新解析或手填；仍不行请联系管理员。',
};
export type ReasonCode = keyof typeof R;
export function reasonCode(msg: string): ReasonCode {
  const hit = (Object.keys(R) as ReasonCode[]).find((k) => R[k] === msg);
  if (hit) return hit;
  const m = msg.toLowerCase();
  if (/超时|timed? ?out/.test(m)) return 'timeout';
  if (/比例尺|scale/.test(m)) return 'scale';
  if (/insunits|units/.test(m)) return 'units';
  if (/unsupported drawing type|不支持/.test(m)) return 'type';
  if (/暂不可用|enoent|spawn|退出码|modulenotfound|no module|importerror|eacces|ocr/.test(m)) return 'down';
  if (/invalid|damaged|corrupt|cannot open|failed to open|not a pdf|eof|truncated|bad zip|dxfstructureerror|损坏/.test(m)) return 'broken';
  return 'other';
}
export const plainReason = (msg: string): string => R[reasonCode(msg)];

const toSummary = (r: Row, admin = false): UploadSummary => ({
  id: r.id, fileName: r.file_name, size: r.size, status: r.status as UploadSummary['status'],
  error: r.status === 'failed' ? plainReason(r.error) : r.error,
  ...(r.status === 'failed' ? { reason: reasonCode(r.error) } : {}),
  drawingId: r.drawing_id, judgeId: r.judge_id, uploadedBy: r.uploaded_by, uploadedAt: r.uploaded_at,
  ...(admin && r.status === 'failed' ? { detail: r.detail || r.error } : {}),
});

const fileDir = (id: number) => path.join(dataDir(), 'av-files', String(id));
/* 「解析中」超过 10 分钟还没有结果:解析途中服务器重启了(制图服务单次最多 2 分钟,一份最多跑两次)。
   不收拾的话这一份「重新解析」「手填」都说「正在解析」、删也删不掉、清单里也看不见 —— 改成解析失败 */
const STUCK_MS = 10 * 60 * 1000;
function healStuck() {
  db().prepare(`UPDATE av_upload SET status = 'failed', error = ?, detail = '解析中断：超过 10 分钟没有结果（服务器可能在解析途中重启）'
    WHERE status = 'parsing' AND COALESCE(started_at, uploaded_at) < ?`).run(R.interrupted, Date.now() - STUCK_MS);
}
const getRow = (id: number) => { healStuck(); return db().prepare('SELECT * FROM av_upload WHERE id = ?').get(id) as Row | undefined; };

export const uploadProject = (id: number) => getRow(id)?.project_id ?? null;

/* 先落盘、登记,再说解析的事 */
export async function archiveUpload(projectId: string, fileName: string, data: Buffer, by: string): Promise<number> {
  const now = Date.now();
  const { lastInsertRowid } = db().prepare(`INSERT INTO av_upload (project_id, file_name, size, status, uploaded_by, uploaded_at, started_at)
    VALUES (?, ?, ?, 'parsing', ?, ?, ?)`).run(projectId, fileName, data.length, by, now, now);
  const id = Number(lastInsertRowid);
  try {
    await mkdir(fileDir(id), { recursive: true });
    await writeFile(path.join(fileDir(id), fileName), data);
  } catch (e) {
    /* 原件没写进去(磁盘满、文件名太长…):这一行留着也没有东西可解析、可下载,撤掉 */
    db().prepare('DELETE FROM av_upload WHERE id = ?').run(id);
    await rm(fileDir(id), { recursive: true, force: true }).catch(() => null);
    throw e;
  }
  return id;
}

export async function readUpload(id: number): Promise<{ name: string; data: Buffer } | null> {
  const r = getRow(id);
  if (!r) return null;
  try { return { name: r.file_name, data: await readFile(path.join(fileDir(id), r.file_name)) }; } catch { return null; }
}

export function listUploads(projectId: string, admin = false): UploadSummary[] {
  healStuck();
  return (db().prepare('SELECT * FROM av_upload WHERE project_id = ? ORDER BY uploaded_at DESC, id DESC').all(projectId) as Row[]).map((r) => toSummary(r, admin));
}

export type ParseOutcome =
  | { kind: 'drawing'; drawing: StoredDrawing; uploadId: number }
  | { kind: 'judge'; judge: JudgeView | null; uploadId: number }
  | { kind: 'failed'; error: string; status: number; uploadId: number; reason?: ReasonCode };

/* 解析一份留档(首次上传和「重新解析」都走这里)。失败不抛:记下原因,原件留着 */
export async function parseUpload(id: number, scale: number | null, by: string, admin: boolean, retry = false): Promise<ParseOutcome> {
  const r = getRow(id);
  if (!r) return { kind: 'failed', error: '留档不存在', status: 404, uploadId: id };
  /* 重新解析只给失败的那几份:已经解析出图纸 / 图片判读的再跑一遍会多出一份重复的 */
  if (retry && r.status !== 'failed') return { kind: 'failed', error: r.status === 'parsing' ? '正在解析，请稍候' : '这份已经解析过了', status: 409, uploadId: id };
  const target = path.join(fileDir(id), r.file_name);
  const ext = path.extname(r.file_name).toLowerCase();
  /* 先占住(和「手填」一样):同一份同时点两次「重新解析」只跑一次 */
  const claimed = db().prepare(`UPDATE av_upload SET status = 'parsing', error = '', started_at = ? WHERE id = ? AND status = ?`)
    .run(Date.now(), id, retry ? 'failed' : 'parsing').changes;
  if (!claimed) return { kind: 'failed', error: '正在解析，请稍候', status: 409, uploadId: id };
  try {
    const scanned = ext === '.pdf' && ((await runDrawingCli(['grade', target])) as { grade: string }).grade === 'C';
    if (IMAGE_EXT.has(ext) || scanned) {
      const jid = await startJudge({ projectId: r.project_id, fileName: r.file_name, file: target, ext, by });
      db().prepare("UPDATE av_upload SET status = 'judge', judge_id = ?, parsed_at = ? WHERE id = ?").run(jid, Date.now(), id);
      return { kind: 'judge', judge: await getJudgeView(jid, admin), uploadId: id };
    }
    const args = ['ingest', target, ...(scale ? ['--scale', String(scale)] : [])];
    const result = (await runDrawingCli(args)) as unknown as IngestResult;
    const did = insertDrawing(r.project_id, result, r.uploaded_by);
    db().prepare("UPDATE av_upload SET status = 'parsed', drawing_id = ?, parsed_at = ? WHERE id = ?").run(did, Date.now(), id);
    const p = { file: result.drawing, grade: result.grade };
    appendAudit(r.project_id, [{ at: Date.now(), by, text: logZh('av.ingest', p), k: 'av.ingest', p }]);
    return { kind: 'drawing', drawing: getDrawing(did)!, uploadId: id };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    const error = plainReason(detail);
    console.warn(`[AV-016] 留档 ${id}「${r.file_name}」解析失败:${detail}`);
    db().prepare("UPDATE av_upload SET status = 'failed', error = ?, detail = ? WHERE id = ?").run(error, detail.slice(0, 1000), id);
    const p = { file: r.file_name, err: error };
    appendAudit(r.project_id, [{ at: Date.now(), by, text: logZh('av.uploadFail', p), k: 'av.uploadFail', p }]);
    return { kind: 'failed', error, reason: reasonCode(detail), status: e instanceof DrawingServiceError ? 422 : 500, uploadId: id };
  }
}

/* AV-016 ①「手填」:解析失败的留档不再跑识别,直接开一张手填的判读单(图能显示就带上),
   填完确认后和图片判读一样生成一张已校核的图纸、带入 05 */
export async function manualUpload(id: number, by: string, admin: boolean): Promise<ParseOutcome> {
  const r = getRow(id);
  if (!r) return { kind: 'failed', error: '留档不存在', status: 404, uploadId: id };
  if (r.status !== 'failed') return { kind: 'failed', error: r.status === 'parsing' ? '正在解析，请稍候' : '这份已经解析过了', status: 409, uploadId: id };
  const target = path.join(fileDir(id), r.file_name);
  const ext = path.extname(r.file_name).toLowerCase();
  /* 先占住:同一份同时点两次「手填」只开一张单子 */
  const claimed = db().prepare("UPDATE av_upload SET status = 'parsing', started_at = ? WHERE id = ? AND status = 'failed'").run(Date.now(), id).changes;
  if (!claimed) return { kind: 'failed', error: '正在处理，请稍候', status: 409, uploadId: id };
  let jid: number;
  try { jid = await startManual({ projectId: r.project_id, fileName: r.file_name, file: target, ext, by }); }
  catch (e) {
    db().prepare("UPDATE av_upload SET status = 'failed' WHERE id = ?").run(id);
    console.warn(`[AV-016] 留档 ${id} 改手填失败:${(e as Error).message}`);
    return { kind: 'failed', error: '没能打开手填单，请稍后再试', status: 500, uploadId: id };
  }
  db().prepare("UPDATE av_upload SET status = 'judge', judge_id = ?, parsed_at = ? WHERE id = ?").run(jid, Date.now(), id);
  const p = { file: r.file_name };
  appendAudit(r.project_id, [{ at: Date.now(), by, text: logZh('av.uploadManual', p), k: 'av.uploadManual', p }]);
  return { kind: 'judge', judge: await getJudgeView(jid, admin), uploadId: id };
}

/* 移除一份解析失败的留档(原件一并删掉),写操作日志。只有 PD / BD 能删(路由里查)。
   解析成功的不能从这里删:图纸还在用它 */
export async function removeFailedUpload(id: number, by: string): Promise<boolean> {
  const r = getRow(id);
  if (!r || r.status !== 'failed') return false;
  if (!db().prepare("DELETE FROM av_upload WHERE id = ? AND status = 'failed'").run(id).changes) return false;
  await rm(fileDir(id), { recursive: true, force: true });
  const p = { file: r.file_name };
  appendAudit(r.project_id, [{ at: Date.now(), by, text: logZh('av.uploadDel', p), k: 'av.uploadDel', p }]);
  return true;
}

export async function deleteProjectUploads(projectId: string): Promise<void> {
  const ids = (db().prepare('SELECT id FROM av_upload WHERE project_id = ?').all(projectId) as { id: number }[]).map((x) => x.id);
  db().prepare('DELETE FROM av_upload WHERE project_id = ?').run(projectId);
  await Promise.all(ids.map((id) => rm(fileDir(id), { recursive: true, force: true })));
}
