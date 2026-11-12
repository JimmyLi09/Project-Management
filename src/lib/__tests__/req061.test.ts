/* REQ-061 · 知识库按「业务流程地图」改版 + 在线预览:
   业务 × 板块的映射和校验、权限矩阵、哪些文件能 inline、地图桥脚本、地图版本(留 10 版 / 恢复 / 首次导入)、老数据不动 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { KB_BIZ, KB_SECS, bizOfSvc, bizSecError, isBiz, isSec, secsFor } from '../bizMap.ts';
import { SVC } from '../templates.ts';
import { fileBadge, inlineType, previewKind } from '../kbPreview.ts';
import {
  canDeleteKb, canDeleteKbFile, canEditKb, canEditKbDoc, canEditTraining, canManageKbPreviews,
  canRevertKb, canSeeAllTraining, canUpdateKbMap, type Identity,
} from '../permissions.ts';
import { MAP_CSP, withBridge } from '../../server/kbMapBridge.ts';
import {
  MAP_ASSET, MAP_DOC_KEY, MAP_KEEP, MAP_MAX, currentMap, deletePreview, ensureKb061, getPreview, importMapIfMissing,
  listMapVersions, mapDocId, mapHtml, previewIdsWithStatus, previewsOfDoc, restoreMapVersion, saveMapVersion, setPreview,
} from '../../server/kbStore.ts';
import { countPdfPages } from '../../server/kbPreview.ts';

/* 和 db.ts 里 REQ-035 的建表一样(上线前的老库长这样) */
function oldKbDb() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE kb_docs (id TEXT PRIMARY KEY, title TEXT NOT NULL, title_en TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'other',
    tags TEXT NOT NULL DEFAULT '[]', body TEXT NOT NULL DEFAULT '', anchors TEXT NOT NULL DEFAULT '{}', attachments TEXT NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, created_by TEXT NOT NULL DEFAULT '');
  CREATE TABLE kb_versions (doc_id TEXT NOT NULL, version INTEGER NOT NULL, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, by TEXT NOT NULL DEFAULT '', PRIMARY KEY (doc_id, version));
  CREATE TABLE kb_files (id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL DEFAULT '', data TEXT NOT NULL);`);
  return d;
}
function seedOld(d: Database.Database) {
  d.prepare(`INSERT INTO kb_docs (id, title, category, tags, body, attachments, version, updated_at, updated_by, created_at, created_by)
    VALUES ('old1', 'LED 安装 SOP', 'sop', '["LED"]', '# 老正文', '[{"id":"of1","name":"图纸.pdf","mime":"application/pdf","size":3}]', 3, 100, 'JM', 50, 'JM')`).run();
  d.prepare(`INSERT INTO kb_versions VALUES ('old1', 1, 'LED 安装 SOP', 'v1', '', 50, 'JM'), ('old1', 2, 'LED 安装 SOP', 'v2', '', 70, 'JM')`).run();
  d.prepare(`INSERT INTO kb_files VALUES ('of1', 'old1', '图纸.pdf', 'application/pdf', 'QUJD')`).run();
}
const dump = (d: Database.Database) => ({
  docs: d.prepare('SELECT id, title, title_en, category, tags, body, anchors, attachments, version, updated_at, updated_by, created_at, created_by FROM kb_docs ORDER BY id').all(),
  versions: d.prepare('SELECT * FROM kb_versions ORDER BY doc_id, version').all(),
  files: d.prepare('SELECT id, doc_id, name, mime, data FROM kb_files ORDER BY id').all(),
});
const HTML = (n: number) => `<!doctype html><html><head><title>map ${n}</title></head><body><nav id="tabs"><a href="#overview">总览</a><a href="#led">LED</a></nav><h2 id="sec-A">A</h2></body></html>`;

const PD: Identity = { name: 'PD', role: 'director' };
const BD: Identity = { name: 'BD', role: 'bd' };
const PM: Identity = { name: '张三', role: 'pm' };
const PM2: Identity = { name: 'Priya', role: 'pm' };
const SALES: Identity = { name: 'Candy', role: 'sales' };
const ENG: Identity = { name: 'Kevin', role: 'member' };
const VIEWER: Identity = { name: 'V', role: 'viewer' };
const FIN: Identity = { name: 'F', role: 'finance' };

test('业务:9 个,前 8 个是地图上的标签;平台里每个业务都归到唯一一个知识库业务', () => {
  assert.deepEqual(KB_BIZ.map((b) => b.key), ['overview', 'persp', 'anim', 'model', 'digital', 'saleskit', 'led', 'control', 'other']);
  assert.deepEqual(KB_BIZ.filter((b) => b.onMap).map((b) => b.key), ['overview', 'persp', 'anim', 'model', 'digital', 'saleskit', 'led', 'control']);
  const seen = new Map<string, string>();
  for (const b of KB_BIZ) for (const s of b.svcs) { assert.ok(!seen.has(s), `${s} 只能归一个业务`); seen.set(s, b.key); }
  for (const s of Object.keys(SVC)) assert.ok(seen.has(s), `平台业务 ${s} 要在映射表里`);
  assert.equal(bizOfSvc('led'), 'led');
  assert.equal(bizOfSvc('tv'), 'led');
  assert.equal(bizOfSvc('cgi'), 'persp');
  assert.equal(bizOfSvc('unitmodel'), 'model');
  assert.equal(bizOfSvc('elv'), 'control');
  assert.equal(bizOfSvc('以后新加的业务'), 'other', '不认识的归「其他业务」');
  for (const b of KB_BIZ) { assert.ok(b.zh && b.en, '业务名中英都有'); assert.match(b.color, /^#[0-9A-F]{6}$/i); }
});

test('板块:A – I;非「总览」只有 B / C / D;中英文案齐', () => {
  assert.deepEqual(KB_SECS.map((s) => s.key), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']);
  assert.deepEqual(secsFor('overview'), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']);
  for (const b of KB_BIZ.filter((x) => x.key !== 'overview')) assert.deepEqual(secsFor(b.key), ['B', 'C', 'D']);
  for (const s of KB_SECS) assert.ok(s.zh && s.en && s.what && s.whatEn);
  assert.ok(isBiz('led') && !isBiz('LED') && !isBiz('') && !isBiz(null));
  assert.ok(isSec('A') && !isSec('a') && !isSec('J'));
});

test('业务 × 板块校验:都空 = 未归类;只给板块不行;非总览选 A / E – I 不行', () => {
  assert.equal(bizSecError(null, null), null);
  assert.equal(bizSecError('', ''), null);
  assert.equal(bizSecError('led', null), null);
  assert.equal(bizSecError('led', 'C'), null);
  assert.equal(bizSecError('overview', 'A'), null);
  assert.equal(bizSecError('overview', 'I'), null);
  for (const s of ['A', 'E', 'F', 'G', 'H', 'I']) {
    const e = bizSecError('led', s);
    assert.ok(e && /B \/ C \/ D/.test(e) && /Overview/.test(e), `led × ${s} 要中英两句报错`);
  }
  assert.match(bizSecError(null, 'B') || '', /先选业务.*Pick a service/);
  assert.match(bizSecError('xx', null) || '', /Unknown service/);
  assert.match(bizSecError('led', 'Z') || '', /Unknown section/);
});

test('权限矩阵:PD / BD 全能;PM 能加、只能改自己建的、删自己传的;其他人只读', () => {
  for (const u of [PD, BD]) {
    assert.ok(canEditKb(u) && canDeleteKb(u) && canRevertKb(u) && canUpdateKbMap(u) && canManageKbPreviews(u));
    assert.ok(canEditKbDoc(u, { createdBy: '别人' }) && canEditKbDoc(u, {}));
    assert.ok(canDeleteKbFile(u, { uploadedBy: '别人' }) && canDeleteKbFile(u, { uploadedBy: null }));
  }
  assert.ok(canEditKb(PM), 'PM 能新建 / 导入 / 加附件');
  assert.ok(canEditKbDoc(PM, { createdBy: '张三' }));
  assert.ok(!canEditKbDoc(PM, { createdBy: 'Priya' }), 'PM 不能改别人建的');
  assert.ok(!canEditKbDoc(PM, { createdBy: '' }), '没有建档人(系统建的)的 PM 不能改');
  assert.ok(canDeleteKbFile(PM, { uploadedBy: '张三' }));
  assert.ok(!canDeleteKbFile(PM, { uploadedBy: 'Priya' }));
  assert.ok(!canDeleteKbFile(PM, { uploadedBy: null }), '老附件没有上传人 = 只有 PD / BD 能删');
  assert.ok(!canDeleteKb(PM) && !canRevertKb(PM) && !canUpdateKbMap(PM) && !canManageKbPreviews(PM));
  assert.ok(!canEditKbDoc(PM2, { createdBy: '张三' }));
  for (const u of [SALES, ENG, VIEWER, FIN]) {
    assert.ok(!canEditKb(u) && !canDeleteKb(u) && !canRevertKb(u) && !canUpdateKbMap(u) && !canManageKbPreviews(u), `${u.role} 只读`);
    assert.ok(!canEditKbDoc(u, { createdBy: u.name }) && !canDeleteKbFile(u, { uploadedBy: u.name }), `${u.role} 自己名下的也不能改`);
  }
});

test('培训权限:REQ-061 只是和知识库拆开;REQ-062 起统一按新规则(JM 1112)—— 建 / 改路径只有 PD / BD', () => {
  for (const u of [PD, BD]) assert.ok(canEditTraining(u) && canSeeAllTraining(u));
  for (const u of [PM, SALES, ENG, VIEWER, FIN]) assert.ok(!canEditTraining(u) && !canSeeAllTraining(u));
  assert.ok(canEditKb(PM), '知识库这边 PM 照样能新建 / 加附件,和培训无关');
});

test('预览类型:只有 PDF 和 4 种图片 inline;HTML / SVG 不 inline;Office 转 PDF;文本纯文本', () => {
  assert.equal(previewKind('a.PDF'), 'pdf');
  for (const n of ['a.png', 'a.JPG', 'a.jpeg', 'a.gif', 'a.webp']) assert.equal(previewKind(n), 'image', n);
  for (const n of ['a.doc', 'a.docx', 'a.xls', 'a.xlsx', 'a.ppt', 'a.pptx']) assert.equal(previewKind(n), 'office', n);
  for (const n of ['a.txt', 'a.md', 'a.csv']) assert.equal(previewKind(n), 'text', n);
  for (const n of ['a.html', 'a.htm', 'a.svg', 'a.zip', 'a.dwg', 'noext', 'a.pdf.html', 'a.xml', 'a.js']) assert.equal(previewKind(n), 'none', n);
  assert.equal(inlineType('x.pdf'), 'application/pdf');
  assert.equal(inlineType('x.JPG'), 'image/jpeg');
  assert.equal(inlineType('x.webp'), 'image/webp');
  for (const n of ['x.html', 'x.svg', 'x.docx', 'x.txt', 'x.png.svg']) assert.equal(inlineType(n), null, n);
  assert.equal(fileBadge('x.docx').label, 'DOC');
  assert.equal(fileBadge('x.xlsx').label, 'XLS');
  assert.equal(fileBadge('x.pptx').label, 'PPT');
  assert.equal(fileBadge('x.html', true).label, 'MAP');
});

test('PDF 页数:数 /Type /Page,不把 /Pages 算进去', () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type /Pages /Kids[2 0 R 3 0 R]>>\n2 0 obj<</Type /Page>>\n3 0 obj<</Type/Page/Parent 1 0 R>>\n%%EOF', 'latin1');
  assert.equal(countPdfPages(pdf), 2);
  assert.equal(countPdfPages(Buffer.from('not a pdf')), null);
});

test('地图桥:脚本插在最后一个 </body> 前;CSP 是不带 allow-same-origin 的 sandbox', () => {
  const out = withBridge(HTML(1));
  assert.ok(out.indexOf('<script>(function () {') < out.lastIndexOf('</body>'));
  assert.ok(out.endsWith('</body></html>'));
  assert.ok(withBridge('<p>无 body</p>').endsWith('</script>'));
  assert.match(out, /audax-kb:docs/);
  assert.match(out, /e\.source !== parent/, '只认父页面发来的消息');
  assert.equal(MAP_CSP, 'sandbox allow-scripts allow-popups');
  assert.ok(!/allow-same-origin/.test(MAP_CSP));
  assert.ok(!/eval|new Function/.test(out), '桥脚本不用 eval');
});

test('只加列加表:老库的文档、版本、附件原样;再跑一遍不出错', () => {
  const d = oldKbDb(); seedOld(d);
  const before = dump(d);
  ensureKb061(d); ensureKb061(d);
  assert.deepEqual(dump(d), before);
  const cols = (t: string) => (d.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
  assert.ok(cols('kb_docs').includes('biz') && cols('kb_docs').includes('sec'));
  assert.ok(cols('kb_files').includes('uploaded_by'));
  const r = d.prepare('SELECT biz, sec FROM kb_docs WHERE id = ?').get('old1') as { biz: null; sec: null };
  assert.equal(r.biz, null, '老文档 = 未归类'); assert.equal(r.sec, null);
  assert.equal((d.prepare('SELECT uploaded_by FROM kb_files WHERE id = ?').get('of1') as { uploaded_by: null }).uploaded_by, null);
});

test('预览表:存 / 改状态 / 按文档取 / 删', () => {
  const d = oldKbDb(); seedOld(d); ensureKb061(d);
  setPreview(d, 'of1', 'pending', 1);
  assert.deepEqual(previewIdsWithStatus(d, 'pending'), ['of1']);
  setPreview(d, 'of1', 'ok', 2, { pdf: 'UERG', pages: 3 });
  assert.equal(getPreview(d, 'of1')?.status, 'ok');
  assert.deepEqual(previewsOfDoc(d, 'old1'), { of1: { status: 'ok', pages: 3, error: '' } });
  setPreview(d, 'of1', 'failed', 3, { error: 'x'.repeat(900) });
  assert.equal(getPreview(d, 'of1')?.error.length, 500);
  assert.equal(getPreview(d, 'of1')?.pdf, null);
  deletePreview(d, 'of1');
  assert.equal(getPreview(d, 'of1'), undefined);
});

test('地图:第一版建出地图文档(总览 · 通用制度 · 附件是 HTML);之后每版换附件;只留 10 版', () => {
  const d = oldKbDb(); seedOld(d); ensureKb061(d);
  const old = dump(d).docs.filter((x) => (x as { id: string }).id === 'old1');
  assert.equal(currentMap(d), null);
  assert.equal(saveMapVersion(d, { html: HTML(1), name: 'SOP Map v5', by: 'PD', now: 1000 }), 1);
  const id = mapDocId(d)!;
  assert.ok(id);
  const doc = d.prepare('SELECT * FROM kb_docs WHERE id = ?').get(id) as { category: string; biz: string; sec: null; attachments: string; created_by: string; version: number };
  assert.equal(doc.category, 'policy'); assert.equal(doc.biz, 'overview'); assert.equal(doc.sec, null); assert.equal(doc.version, 1);
  let att = JSON.parse(doc.attachments) as { id: string; name: string; isMap?: boolean; uploadedBy?: string }[];
  assert.equal(att.length, 1); assert.ok(att[0].isMap); assert.equal(att[0].name, 'SOP Map v5.html'); assert.equal(att[0].uploadedBy, 'PD');
  assert.equal(Buffer.from((d.prepare('SELECT data FROM kb_files WHERE id = ?').get(att[0].id) as { data: string }).data, 'base64').toString('utf8'), HTML(1));
  assert.equal((d.prepare('SELECT COUNT(*) AS n FROM kb_versions WHERE doc_id = ?').get(id) as { n: number }).n, 1);

  /* 这篇上另外挂一个普通附件,换地图时不能被带走 */
  d.prepare(`INSERT INTO kb_files (id, doc_id, name, mime, data, uploaded_by) VALUES ('extra', ?, '说明.pdf', 'application/pdf', 'QQ==', 'PD')`).run(id);
  d.prepare('UPDATE kb_docs SET attachments = ? WHERE id = ?').run(JSON.stringify([...att, { id: 'extra', name: '说明.pdf', mime: 'application/pdf', size: 1 }]), id);

  for (let n = 2; n <= 12; n++) saveMapVersion(d, { html: HTML(n), name: `v${n}`, by: 'BD', now: 1000 + n });
  const vs = listMapVersions(d);
  assert.equal(vs.length, MAP_KEEP);
  assert.deepEqual(vs.map((v) => v.version), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
  assert.equal(currentMap(d)?.version, 12);
  assert.equal(mapHtml(d), HTML(12));
  assert.equal(mapHtml(d, 3), HTML(3));
  assert.equal(mapHtml(d, 1), null, '第 1 版已经被挤掉');
  assert.equal(mapDocId(d), id, '还是同一篇地图文档');
  att = JSON.parse((d.prepare('SELECT attachments FROM kb_docs WHERE id = ?').get(id) as { attachments: string }).attachments);
  assert.deepEqual(att.map((f) => f.name).sort(), ['v12.html', '说明.pdf'].sort());
  assert.equal(att.filter((f) => f.isMap).length, 1);
  assert.equal((d.prepare('SELECT COUNT(*) AS n FROM kb_files WHERE doc_id = ?').get(id) as { n: number }).n, 2, '旧版本的 HTML 附件行删掉,只留当前这版 + 普通附件');
  assert.equal((d.prepare('SELECT updated_by FROM kb_docs WHERE id = ?').get(id) as { updated_by: string }).updated_by, 'BD');
  /* 老文档一点没动 */
  assert.deepEqual(dump(d).docs.filter((x) => (x as { id: string }).id === 'old1'), old);
});

test('地图:恢复旧版 = 存成新的一版,备注写明;超过 2MB 拒绝;不存在的版本报错', () => {
  const d = oldKbDb(); ensureKb061(d);
  saveMapVersion(d, { html: HTML(1), name: 'a', by: 'PD', now: 1 });
  saveMapVersion(d, { html: HTML(2), name: 'b', by: 'PD', now: 2 });
  assert.equal(restoreMapVersion(d, 1, 'BD', 3), 3);
  const cur = currentMap(d)!;
  assert.equal(cur.version, 3); assert.equal(cur.name, 'a'); assert.equal(cur.by, 'BD'); assert.match(cur.note, /恢复第 1 版.*restored v1/);
  assert.equal(mapHtml(d), HTML(1));
  assert.equal(listMapVersions(d).length, 3, '恢复不删历史');
  assert.throws(() => restoreMapVersion(d, 99, 'BD', 4), /That map version no longer exists/);
  assert.throws(() => saveMapVersion(d, { html: 'x'.repeat(MAP_MAX + 1), name: 'big', by: 'PD', now: 5 }), /over 2MB/);
  assert.equal(currentMap(d)!.version, 3, '超限的没存进去');
});

test('首次上线:库里没有地图就导入仓库里的 SOP Map v5;已经有了不重复导', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'req061-'));
  try {
    const d = oldKbDb(); seedOld(d); ensureKb061(d);
    assert.equal(importMapIfMissing(d, root, 10), 'nofile');
    assert.equal(currentMap(d), null);
    fs.mkdirSync(path.join(root, path.dirname(MAP_ASSET)), { recursive: true });
    fs.writeFileSync(path.join(root, MAP_ASSET), HTML(5));
    assert.equal(importMapIfMissing(d, root, 11), 'imported');
    const m = currentMap(d)!;
    assert.equal(m.version, 1); assert.equal(m.by, '系统 System'); assert.match(m.note, /imported on first start/);
    assert.equal(mapHtml(d), HTML(5));
    assert.equal(importMapIfMissing(d, root, 12), 'exists');
    assert.equal(listMapVersions(d).length, 1);
    assert.ok((d.prepare('SELECT value FROM meta WHERE key = ?').get(MAP_DOC_KEY) as { value: string }).value);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('仓库里确实带着 SOP Map v5:2MB 以内;#tabs、板块 id「sec-X」和 7 个业务标签都是地图自己用脚本画的', () => {
  const file = path.join(process.cwd(), MAP_ASSET);
  assert.ok(fs.existsSync(file), MAP_ASSET);
  const html = fs.readFileSync(file, 'utf8');
  assert.ok(Buffer.byteLength(html) <= MAP_MAX);
  assert.match(html, /id="tabs"/);
  assert.match(html, /id="sec-\$\{k\}"/, '板块标题带 id="sec-A" … 「sec-I」');
  assert.match(html, /href="#overview"/);
  for (const b of KB_BIZ.filter((x) => x.onMap && x.key !== 'overview')) assert.match(html, new RegExp(`id:"${b.key}"`), `地图里有 #${b.key} 标签`);
});
