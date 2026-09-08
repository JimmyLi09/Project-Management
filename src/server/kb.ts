/* ===== REQ-035: 知识库的服务端读写 =====
   API 路由只管鉴权与 HTTP,清洗和落库的规矩都在这里,四个路由共用一份。 */
import {
  deleteKbFile, getKbDoc, insertKbDoc, insertKbFile, insertKbVersion,
  listKbDocs, listKbVersions, updateKbDoc, type KbRow,
} from './db';
import { KB_CATEGORIES, type KbAttachment, type KbCategory, type KbDoc, type KbVersion } from '@/lib/kb';
import { SVC } from '@/lib/templates';
import { STAGES } from '@/lib/templates';

export const MAX_BODY = 400_000;          // 一篇文档正文上限(约 20 万汉字)
export const MAX_FILE = 8 * 1024 * 1024;  // 单个上传文件 8MB
const CATS = new Set(KB_CATEGORIES.map((c) => c[0]));

const jparse = <T,>(s: string, d: T): T => { try { return JSON.parse(s) as T; } catch { return d; } };

export function rowToDoc(r: KbRow): KbDoc {
  const a = jparse<{ svc?: string[]; stage?: string[] }>(r.anchors, {});
  return {
    id: r.id, title: r.title, titleEn: r.title_en,
    category: (CATS.has(r.category as KbCategory) ? r.category : 'other') as KbCategory,
    tags: jparse<string[]>(r.tags, []),
    body: r.body,
    anchors: { svc: a.svc || [], stage: a.stage || [] },
    attachments: jparse<KbAttachment[]>(r.attachments, []),
    version: r.version,
    updatedAt: r.updated_at, updatedBy: r.updated_by,
    createdAt: r.created_at, createdBy: r.created_by,
  };
}

export const allDocs = (): KbDoc[] => listKbDocs().map(rowToDoc);
export const oneDoc = (id: string): KbDoc | undefined => { const r = getKbDoc(id); return r ? rowToDoc(r) : undefined; };
export const versionsOf = (id: string): KbVersion[] =>
  listKbVersions(id).map((v) => ({ version: v.version, title: v.title, body: v.body, summary: v.summary, at: v.at, by: v.by }));

export interface DocInput {
  title?: unknown; titleEn?: unknown; category?: unknown; tags?: unknown;
  body?: unknown; anchors?: unknown; summary?: unknown;
}

/* 清洗一份来自浏览器的输入。锚点按已知的服务类型 / 阶段过一遍,
   免得把任意字符串塞进去,后面按锚点查文档时对不上。 */
export function clean(inp: DocInput) {
  const title = String(inp.title ?? '').trim().slice(0, 200);
  const body = String(inp.body ?? '');
  if (body.length > MAX_BODY) throw new Error('正文过长(上限 40 万字符)');
  const a = (inp.anchors || {}) as { svc?: unknown; stage?: unknown };
  const stageKeys = new Set<string>(STAGES.map((s) => s[0] as string));
  return {
    title,
    titleEn: String(inp.titleEn ?? '').trim().slice(0, 200),
    category: (CATS.has(String(inp.category) as KbCategory) ? String(inp.category) : 'other') as KbCategory,
    tags: (Array.isArray(inp.tags) ? inp.tags : []).slice(0, 20).map((t) => String(t).trim().slice(0, 40)).filter(Boolean),
    body,
    anchors: {
      svc: (Array.isArray(a.svc) ? a.svc : []).map(String).filter((s) => !!SVC[s]).slice(0, 20),
      stage: (Array.isArray(a.stage) ? a.stage : []).map(String).filter((s) => stageKeys.has(s)).slice(0, 20),
    },
    summary: String(inp.summary ?? '').trim().slice(0, 200),
  };
}

export function createDoc(inp: DocInput, by: string): KbDoc {
  const c = clean(inp);
  if (!c.title) throw new Error('文档标题不能为空');
  const now = Date.now();
  const row: KbRow = {
    id: 'kb' + now.toString(36) + Math.random().toString(36).slice(2, 7),
    title: c.title, title_en: c.titleEn, category: c.category,
    tags: JSON.stringify(c.tags), body: c.body,
    anchors: JSON.stringify(c.anchors), attachments: '[]',
    version: 1, updated_at: now, updated_by: by, created_at: now, created_by: by,
  };
  insertKbDoc(row);
  /* 第 1 版也进历史 —— 否则回退时看不到最初长什么样 */
  insertKbVersion({ doc_id: row.id, version: 1, title: c.title, body: c.body, summary: c.summary || '创建', at: now, by });
  return rowToDoc(row);
}

/* 保存 = 版本 +1,并把这一版压进历史。
   正文和标题都没变就不产生新版本 —— 只改了分类 / 标签不该刷出一条「修订」。 */
export function saveDoc(id: string, inp: DocInput, by: string): KbDoc {
  const cur = getKbDoc(id);
  if (!cur) throw new Error('文档不存在');
  const c = clean(inp);
  if (!c.title) throw new Error('文档标题不能为空');
  const changed = c.body !== cur.body || c.title !== cur.title;
  const now = Date.now();
  const version = changed ? cur.version + 1 : cur.version;
  const row: KbRow = {
    ...cur,
    title: c.title, title_en: c.titleEn, category: c.category,
    tags: JSON.stringify(c.tags), body: c.body, anchors: JSON.stringify(c.anchors),
    version, updated_at: now, updated_by: by,
  };
  updateKbDoc(row);
  if (changed) insertKbVersion({ doc_id: id, version, title: c.title, body: c.body, summary: c.summary, at: now, by });
  return rowToDoc(row);
}

/* 回退:不是把历史抹掉重来,而是把老内容作为**新的一版**存进去 ——
   回退这件事本身也留在历史里,谁什么时候退回哪一版一目了然。 */
export function revertDoc(id: string, toVersion: number, by: string): KbDoc {
  const cur = getKbDoc(id);
  if (!cur) throw new Error('文档不存在');
  const v = listKbVersions(id).find((x) => x.version === toVersion);
  if (!v) throw new Error('找不到这个版本');
  const now = Date.now();
  const version = cur.version + 1;
  const row: KbRow = { ...cur, title: v.title, body: v.body, version, updated_at: now, updated_by: by };
  updateKbDoc(row);
  insertKbVersion({ doc_id: id, version, title: v.title, body: v.body, summary: `回退到第 ${toVersion} 版`, at: now, by });
  return rowToDoc(row);
}

export function attachFile(docId: string, name: string, mime: string, buf: Buffer, by: string): KbDoc {
  const cur = getKbDoc(docId);
  if (!cur) throw new Error('文档不存在');
  if (buf.length > MAX_FILE) throw new Error('附件超过 8MB');
  const list = jparse<KbAttachment[]>(cur.attachments, []);
  if (list.length >= 30) throw new Error('一篇文档最多 30 个附件');
  const id = 'kf' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  insertKbFile(docId, id, name, mime, buf.toString('base64'));
  list.push({ id, name, mime, size: buf.length });
  const row: KbRow = { ...cur, attachments: JSON.stringify(list), updated_at: Date.now(), updated_by: by };
  updateKbDoc(row);
  return rowToDoc(row);
}

export function removeFile(docId: string, fileId: string, by: string): KbDoc {
  const cur = getKbDoc(docId);
  if (!cur) throw new Error('文档不存在');
  const list = jparse<KbAttachment[]>(cur.attachments, []).filter((f) => f.id !== fileId);
  deleteKbFile(fileId);
  const row: KbRow = { ...cur, attachments: JSON.stringify(list), updated_at: Date.now(), updated_by: by };
  updateKbDoc(row);
  return rowToDoc(row);
}
