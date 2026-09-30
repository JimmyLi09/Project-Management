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
import { getJudgeView, IMAGE_EXT, startJudge, type JudgeView } from './avjudge';
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
    ready = true;
  }
  return d;
}

type Row = {
  id: number; project_id: string; file_name: string; size: number; status: string; error: string;
  drawing_id: number; judge_id: number; uploaded_by: string; uploaded_at: number; parsed_at: number;
};

export interface UploadSummary {
  id: number; fileName: string; size: number; status: 'parsing' | 'parsed' | 'judge' | 'failed'; error: string;
  drawingId: number; judgeId: number; uploadedBy: string; uploadedAt: number;
}

const toSummary = (r: Row): UploadSummary => ({
  id: r.id, fileName: r.file_name, size: r.size, status: r.status as UploadSummary['status'], error: r.error,
  drawingId: r.drawing_id, judgeId: r.judge_id, uploadedBy: r.uploaded_by, uploadedAt: r.uploaded_at,
});

const fileDir = (id: number) => path.join(dataDir(), 'av-files', String(id));
const getRow = (id: number) => db().prepare('SELECT * FROM av_upload WHERE id = ?').get(id) as Row | undefined;

export const uploadProject = (id: number) => getRow(id)?.project_id ?? null;

/* 先落盘、登记,再说解析的事 */
export async function archiveUpload(projectId: string, fileName: string, data: Buffer, by: string): Promise<number> {
  const { lastInsertRowid } = db().prepare(`INSERT INTO av_upload (project_id, file_name, size, status, uploaded_by, uploaded_at)
    VALUES (?, ?, ?, 'parsing', ?, ?)`).run(projectId, fileName, data.length, by, Date.now());
  const id = Number(lastInsertRowid);
  await mkdir(fileDir(id), { recursive: true });
  await writeFile(path.join(fileDir(id), fileName), data);
  return id;
}

export async function readUpload(id: number): Promise<{ name: string; data: Buffer } | null> {
  const r = getRow(id);
  if (!r) return null;
  try { return { name: r.file_name, data: await readFile(path.join(fileDir(id), r.file_name)) }; } catch { return null; }
}

export function listUploads(projectId: string): UploadSummary[] {
  return (db().prepare('SELECT * FROM av_upload WHERE project_id = ? ORDER BY uploaded_at DESC, id DESC').all(projectId) as Row[]).map(toSummary);
}

export type ParseOutcome =
  | { kind: 'drawing'; drawing: StoredDrawing; uploadId: number }
  | { kind: 'judge'; judge: JudgeView | null; uploadId: number }
  | { kind: 'failed'; error: string; status: number; uploadId: number };

/* 解析一份留档(首次上传和「重新解析」都走这里)。失败不抛:记下原因,原件留着 */
export async function parseUpload(id: number, scale: number | null, by: string, admin: boolean, retry = false): Promise<ParseOutcome> {
  const r = getRow(id);
  if (!r) return { kind: 'failed', error: '留档不存在', status: 404, uploadId: id };
  /* 重新解析只给失败的那几份:已经解析出图纸 / 图片判读的再跑一遍会多出一份重复的 */
  if (retry && r.status !== 'failed') return { kind: 'failed', error: r.status === 'parsing' ? '正在解析，请稍候' : '这份已经解析过了', status: 409, uploadId: id };
  const target = path.join(fileDir(id), r.file_name);
  const ext = path.extname(r.file_name).toLowerCase();
  db().prepare("UPDATE av_upload SET status = 'parsing', error = '' WHERE id = ?").run(id);
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
    const error = e instanceof Error ? e.message : '解析失败';
    db().prepare("UPDATE av_upload SET status = 'failed', error = ? WHERE id = ?").run(error.slice(0, 300), id);
    const p = { file: r.file_name, err: error.slice(0, 120) };
    appendAudit(r.project_id, [{ at: Date.now(), by, text: logZh('av.uploadFail', p), k: 'av.uploadFail', p }]);
    return { kind: 'failed', error, status: e instanceof DrawingServiceError ? 422 : 500, uploadId: id };
  }
}

/* 移除一份解析失败的留档(原件一并删掉)。解析成功的不能从这里删:图纸还在用它 */
export async function removeFailedUpload(id: number): Promise<boolean> {
  const r = getRow(id);
  if (!r || r.status !== 'failed') return false;
  db().prepare('DELETE FROM av_upload WHERE id = ?').run(id);
  await rm(fileDir(id), { recursive: true, force: true });
  return true;
}

export async function deleteProjectUploads(projectId: string): Promise<void> {
  const ids = (db().prepare('SELECT id FROM av_upload WHERE project_id = ?').all(projectId) as { id: number }[]).map((x) => x.id);
  db().prepare('DELETE FROM av_upload WHERE project_id = ?').run(projectId);
  await Promise.all(ids.map((id) => rm(fileDir(id), { recursive: true, force: true })));
}
