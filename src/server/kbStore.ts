/* ===== REQ-061 · 知识库新加的存储 =====
   - kb_docs.biz / sec:业务 × 板块(老文档为空 = 未归类);kb_files.uploaded_by:附件上传人(老附件为空)。
   - kb_previews:Office 附件转好的 PDF(原文件不动)。状态 pending / ok / failed / unsupported。
   - kb_map_versions:知识库首页的流程地图,一版一行,留最近 10 版。
     地图同时是知识库里的一篇文档(总览 / 通用 · 原分类「通用制度」),附件就是当前那一版的 HTML,
     这篇文档的 id 记在 meta「kb.mapDoc」。
   函数都带 d,单元测试用内存库直接调。只加列、加表,老数据不改不删。 */
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

export const MAP_DOC_KEY = 'kb.mapDoc';
export const MAP_KEEP = 10;
export const MAP_MAX = 2 * 1024 * 1024;
export const MAP_ASSET = 'docs/requirements/assets/061-Audax业务流程地图_SOPMap_v5.html';
export const MAP_FIRST_NAME = 'Audax 业务流程地图（SOP Map v5）';
export const MAP_FIRST_NAME_EN = 'Audax Business Process Map (SOP Map v5)';
export const SYSTEM_BY = '系统 System';

export function ensureKb061(d: Database.Database) {
  const cols = (t: string) => (d.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
  const kd = cols('kb_docs');
  if (!kd.includes('biz')) d.exec('ALTER TABLE kb_docs ADD COLUMN biz TEXT');
  if (!kd.includes('sec')) d.exec('ALTER TABLE kb_docs ADD COLUMN sec TEXT');
  if (!cols('kb_files').includes('uploaded_by')) d.exec('ALTER TABLE kb_files ADD COLUMN uploaded_by TEXT');
  d.exec(`CREATE TABLE IF NOT EXISTS kb_previews (
    file_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    pdf TEXT,
    pages INTEGER,
    error TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  )`);
  d.exec(`CREATE TABLE IF NOT EXISTS kb_map_versions (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    html TEXT NOT NULL,
    size INTEGER NOT NULL,
    at INTEGER NOT NULL,
    by TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT ''
  )`);
}

/* ── 预览 ── */
export type PreviewStatus = 'pending' | 'ok' | 'failed' | 'unsupported';
export interface PreviewRow { file_id: string; status: PreviewStatus; pdf: string | null; pages: number | null; error: string; updated_at: number }

export const getPreview = (d: Database.Database, fileId: string) =>
  d.prepare('SELECT * FROM kb_previews WHERE file_id = ?').get(fileId) as PreviewRow | undefined;
export function setPreview(d: Database.Database, fileId: string, status: PreviewStatus, now: number, o: { pdf?: string | null; pages?: number | null; error?: string } = {}) {
  d.prepare(`INSERT INTO kb_previews (file_id, status, pdf, pages, error, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_id) DO UPDATE SET status = excluded.status, pdf = excluded.pdf, pages = excluded.pages, error = excluded.error, updated_at = excluded.updated_at`)
    .run(fileId, status, o.pdf ?? null, o.pages ?? null, (o.error || '').slice(0, 500), now);
}
export const deletePreview = (d: Database.Database, fileId: string) => d.prepare('DELETE FROM kb_previews WHERE file_id = ?').run(fileId);
export const previewIdsWithStatus = (d: Database.Database, status: PreviewStatus) =>
  (d.prepare('SELECT file_id FROM kb_previews WHERE status = ?').all(status) as { file_id: string }[]).map((r) => r.file_id);
/* 一篇文档的附件各自的预览状态(不带 PDF 内容) */
export function previewsOfDoc(d: Database.Database, docId: string): Record<string, { status: PreviewStatus; pages: number | null; error: string }> {
  const rows = d.prepare(`SELECT p.file_id, p.status, p.pages, p.error FROM kb_previews p JOIN kb_files f ON f.id = p.file_id WHERE f.doc_id = ?`).all(docId) as PreviewRow[];
  return Object.fromEntries(rows.map((r) => [r.file_id, { status: r.status, pages: r.pages, error: r.error }]));
}

/* ── 流程地图 ── */
export interface MapVersion { version: number; name: string; size: number; at: number; by: string; note: string }
export const mapDocId = (d: Database.Database): string | null =>
  ((d.prepare('SELECT value FROM meta WHERE key = ?').get(MAP_DOC_KEY) as { value: string } | undefined)?.value) || null;
export const listMapVersions = (d: Database.Database) =>
  d.prepare('SELECT version, name, size, at, by, note FROM kb_map_versions ORDER BY version DESC').all() as MapVersion[];
export const currentMap = (d: Database.Database): MapVersion | null => listMapVersions(d)[0] || null;
export function mapHtml(d: Database.Database, version?: number): string | null {
  const r = (version
    ? d.prepare('SELECT html FROM kb_map_versions WHERE version = ?').get(version)
    : d.prepare('SELECT html FROM kb_map_versions ORDER BY version DESC LIMIT 1').get()) as { html: string } | undefined;
  return r ? r.html : null;
}

const fileId = () => 'kf' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const docId = () => 'kb' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const MAP_BODY = [
  '这是知识库首页的 **Audax 业务流程地图**。打开「知识库」默认先看到它:切换业务、展开邮件模板、调排期都在地图里;每个板块标题右边的「📄 文档 n」直接跳到这个业务、这个板块的文档。',
  '',
  'PD / BD 可以在首页「更新地图」上传新版本(.html,2MB 以内),旧版本留在「地图版本」里,最近 10 版可以恢复。下面的附件是当前这一版。',
  '',
  'The knowledge base opens on this **Audax business process map**. Use it to switch services, open email templates and adjust schedules; the “📄 Docs n” button beside each section heading jumps to the documents for that service and section. PD / BD can upload a new version (.html, up to 2MB) from the home page; the last 10 versions can be restored. The attachment below is the current version.',
].join('\n');

/* 存一版地图:新版本号 = 最大 + 1;只留最近 10 版;地图文档的附件换成这一版的 HTML。
   地图文档还没有(第一次)就建一篇:总览 / 通用 · 原分类「通用制度」。 */
export function saveMapVersion(d: Database.Database, o: { html: string; name: string; by: string; now: number; note?: string }): number {
  const size = Buffer.byteLength(o.html, 'utf8');
  if (size > MAP_MAX) throw new Error('地图文件超过 2MB / The map file is over 2MB');
  return d.transaction(() => {
    const max = (d.prepare('SELECT MAX(version) AS v FROM kb_map_versions').get() as { v: number | null }).v || 0;
    const version = max + 1;
    d.prepare('INSERT INTO kb_map_versions (version, name, html, size, at, by, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(version, o.name.slice(0, 200), o.html, size, o.now, o.by, (o.note || '').slice(0, 200));
    d.prepare('DELETE FROM kb_map_versions WHERE version <= ?').run(version - MAP_KEEP);
    /* 地图文档 */
    let id = mapDocId(d);
    let row = id ? d.prepare('SELECT * FROM kb_docs WHERE id = ?').get(id) as { attachments: string } | undefined : undefined;
    if (!row) {
      id = docId();
      d.prepare(`INSERT INTO kb_docs (id, title, title_en, category, tags, body, anchors, attachments, version, updated_at, updated_by, created_at, created_by, biz, sec)
        VALUES (?, ?, ?, 'policy', '[]', ?, '{}', '[]', 1, ?, ?, ?, ?, 'overview', NULL)`)
        .run(id, MAP_FIRST_NAME, MAP_FIRST_NAME_EN, MAP_BODY, o.now, o.by, o.now, o.by);
      d.prepare('INSERT INTO kb_versions (doc_id, version, title, body, summary, at, by) VALUES (?, 1, ?, ?, ?, ?, ?)')
        .run(id, MAP_FIRST_NAME, MAP_BODY, '导入首页流程地图', o.now, o.by);
      d.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(MAP_DOC_KEY, id);
      row = { attachments: '[]' };
    }
    /* 附件:只留当前这一版的 HTML(旧版本的 HTML 在 kb_map_versions 里) */
    let list: { id: string; name: string; mime: string; size: number; uploadedBy?: string; isMap?: boolean }[] = [];
    try { list = JSON.parse(row.attachments); } catch { list = []; }
    const old = list.filter((f) => f.isMap);
    for (const f of old) d.prepare('DELETE FROM kb_files WHERE id = ?').run(f.id);
    const fid = fileId();
    const fname = /\.html?$/i.test(o.name) ? o.name : `${o.name}.html`;
    d.prepare('INSERT INTO kb_files (id, doc_id, name, mime, data, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(fid, id, fname, 'text/html', Buffer.from(o.html, 'utf8').toString('base64'), o.by);
    list = [...list.filter((f) => !old.includes(f)), { id: fid, name: fname, mime: 'text/html', size, uploadedBy: o.by, isMap: true }];
    d.prepare('UPDATE kb_docs SET attachments = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(JSON.stringify(list), o.now, o.by, id);
    return version;
  })();
}

/* 恢复旧版:把那一版的内容存成新的一版(恢复这件事本身也留在历史里) */
export function restoreMapVersion(d: Database.Database, version: number, by: string, now: number): number {
  const r = d.prepare('SELECT name, html FROM kb_map_versions WHERE version = ?').get(version) as { name: string; html: string } | undefined;
  if (!r) throw new Error('找不到这一版地图 / That map version no longer exists');
  return saveMapVersion(d, { html: r.html, name: r.name, by, now, note: `恢复第 ${version} 版 / restored v${version}` });
}

/* 第一次上线:库里还没有地图,把仓库里的 SOP Map v5 导入成第一版 */
export function importMapIfMissing(d: Database.Database, root: string, now: number): 'imported' | 'exists' | 'nofile' {
  if (currentMap(d)) return 'exists';
  const file = path.join(root, MAP_ASSET);
  if (!fs.existsSync(file)) return 'nofile';
  saveMapVersion(d, { html: fs.readFileSync(file, 'utf8'), name: MAP_FIRST_NAME, by: SYSTEM_BY, now, note: '首次上线自动导入 / imported on first start' });
  return 'imported';
}
