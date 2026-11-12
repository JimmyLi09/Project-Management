/* ===== REQ-061 · Word / Excel / PPT 附件转 PDF 预览 =====
   - 用服务器上的 LibreOffice(soffice --headless --convert-to pdf)。路径先读环境变量 SOFFICE_PATH,
     没有就用 Windows 默认安装位置。找不到 = 没装:Office 附件显示「服务器还没装预览组件」,不排队、不报错。
   - 排队,一次只转一个,单个 60 秒超时。每次在系统临时目录里建一个空目录(含独立的 LibreOffice 配置目录,
     免得和服务器上开着的 LibreOffice 抢),转完连目录一起删。原文件不动,转好的 PDF 存 kb_previews。
   - 服务重启时还在「pending」的重新排队。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { getDb, getKbFile } from './db';
import { getPreview, previewIdsWithStatus, setPreview } from './kbStore';
import { previewKind } from '@/lib/kbPreview';

export const CONVERT_TIMEOUT_MS = 60_000;
const WIN_DEFAULT = 'C:\\Program Files\\LibreOffice\\program\\soffice.exe';

export const sofficePath = () => process.env.SOFFICE_PATH || WIN_DEFAULT;
export const sofficeAvailable = () => { try { return fs.existsSync(sofficePath()); } catch { return false; } };

const queue: string[] = [];
let running = false;
let resumed = false;

/* 排队转这个附件。已经转好 / 正在排的不重复排;没装 LibreOffice 就什么都不做 */
export function queuePreview(fileId: string, force = false) {
  if (!sofficeAvailable()) return false;
  const d = getDb();
  const cur = getPreview(d, fileId);
  if (cur && !force && (cur.status === 'ok' || cur.status === 'unsupported')) return false;
  if (cur?.status === 'pending' && queue.includes(fileId)) return true;
  setPreview(d, fileId, 'pending', Date.now());
  if (!queue.includes(fileId)) queue.push(fileId);
  void pump();
  return true;
}

/* 服务刚起来时:上次没转完的(pending)重新排队。第一次有人用到预览时调一次就行 */
export function resumePending() {
  if (resumed) return;
  resumed = true;
  if (!sofficeAvailable()) return;
  for (const id of previewIdsWithStatus(getDb(), 'pending')) if (!queue.includes(id)) queue.push(id);
  void pump();
}

/* PD / BD「生成全部预览」:所有还没转好的 Office 附件排队(失败过的也重来) */
export function queueAllOffice(): number {
  if (!sofficeAvailable()) return 0;
  const d = getDb();
  const rows = d.prepare('SELECT id, name FROM kb_files').all() as { id: string; name: string }[];
  let n = 0;
  for (const r of rows) {
    if (previewKind(r.name) !== 'office') continue;
    const p = getPreview(d, r.id);
    if (p?.status === 'ok') continue;
    if (queuePreview(r.id, true)) n++;
  }
  return n;
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const id = queue.shift()!;
      await convertOne(id);
    }
  } finally {
    running = false;
  }
}

/* PDF 页数:数 /Type /Page(不含 /Pages)。数不出来就留空,阅读器自己会数 */
export function countPdfPages(buf: Buffer): number | null {
  const m = buf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g);
  return m && m.length ? m.length : null;
}

function run(cmd: string, args: string[], timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, windowsHide: true, killSignal: 'SIGKILL' }, (err) => {
      if (err) reject(Object.assign(err, { timedOut: (err as { killed?: boolean }).killed === true }));
      else resolve();
    });
  });
}

async function convertOne(fileId: string) {
  const d = getDb();
  const f = getKbFile(fileId);
  if (!f) return;   // 附件被删了
  if (previewKind(f.name) !== 'office') { setPreview(d, fileId, 'unsupported', Date.now()); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'audax-preview-'));
  try {
    const ext = (/\.([a-z0-9]+)$/i.exec(f.name)?.[1] || 'bin').toLowerCase();
    const input = path.join(tmp, `in.${ext}`);
    fs.writeFileSync(input, Buffer.from(f.data, 'base64'));
    const profile = pathToFileURL(path.join(tmp, 'profile')).href;
    await run(sofficePath(), ['--headless', '--norestore', '--nolockcheck', `-env:UserInstallation=${profile}`,
      '--convert-to', 'pdf', '--outdir', tmp, input], CONVERT_TIMEOUT_MS);
    const out = path.join(tmp, 'in.pdf');
    if (!fs.existsSync(out)) throw new Error('LibreOffice 没有生成 PDF / LibreOffice produced no PDF');
    const pdf = fs.readFileSync(out);
    setPreview(d, fileId, 'ok', Date.now(), { pdf: pdf.toString('base64'), pages: countPdfPages(pdf) });
  } catch (e) {
    const timedOut = (e as { timedOut?: boolean }).timedOut;
    const msg = timedOut ? `转换超时(${CONVERT_TIMEOUT_MS / 1000} 秒) / Conversion timed out` : String((e as Error).message || e).slice(0, 300);
    console.warn(`[REQ-061] 附件预览转换失败(${f.name}):${msg}`);
    setPreview(d, fileId, 'failed', Date.now(), { error: msg });
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 临时目录删不掉也不影响 */ }
  }
}
