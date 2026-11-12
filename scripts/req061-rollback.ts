/* ===== REQ-061 回退:知识库改版(业务 × 板块、流程地图首页、在线预览)新加的表和列的数据清掉 =====
   什么时候用:REQ-061 上线后要把**代码**退回去,又不想用更新前的快照覆盖数据库(那样会丢掉上线之后的所有改动)。
   旧代码不认识新表新列,不清也能跑;清掉是为了以后重新上线时从干净的状态开始。
   做什么:
     - 删表 kb_previews(Office 附件转好的 PDF —— 原文件在 kb_files 里,一点没动)
     - 删表 kb_map_versions(首页流程地图的历史版本 —— 当前那一版的 HTML 仍是地图文档的附件)
     - kb_docs.biz / sec、kb_files.uploaded_by 清空(列留着,旧代码不读;每篇原来归在哪,报告里列出来)
   不动:所有文档的正文、标题、分类、标签、版本历史、附件原文件;上线后新建的文档、新传的附件都留着。
   「Audax 业务流程地图」那篇文档也留着(旧代码里它就是一篇普通文档,附件是 HTML,只能下载);
   meta 的 kb.mapDoc 留着,以后重新上线会接着用这篇,不会再建一篇。
   不带参数:只报告会清什么,不写库。加 --apply 才改:先在线备份到 data\backups\pre-req061-rollback-<时间>.db,
   清了什么写到 data\migrations\061-kb-rollback-<时间>.md。
   用法:pm2 stop audax → scripts\req061-rollback.bat [--apply] → 退代码 → 启动。 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const pad = (n: number) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const DATA = process.env.AUDAX_DATA_DIR || path.join(process.cwd(), 'data');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const DB = args.find((a) => !a.startsWith('--')) || path.join(DATA, 'audax.db');

type Db = { prepare: (s: string) => { all: (...a: unknown[]) => unknown[]; get: (...a: unknown[]) => unknown; run: (...a: unknown[]) => unknown }; exec: (s: string) => void };
const hasTable = (d: Db, t: string) => !!d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
const hasCol = (d: Db, t: string, c: string) => (d.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).some((x) => x.name === c);

async function main() {
  if (!fs.existsSync(DB)) { console.error(`找不到数据库:${DB}`); process.exit(1); }
  const d = new Database(DB, apply ? {} : { readonly: true });
  const lines: string[] = [];

  const prev = hasTable(d, 'kb_previews')
    ? d.prepare('SELECT status, COUNT(*) AS n FROM kb_previews GROUP BY status').all() as { status: string; n: number }[] : null;
  lines.push(prev ? `- 删表 kb_previews:${prev.reduce((s, r) => s + r.n, 0)} 条预览(${prev.map((r) => `${r.status} ${r.n}`).join(',') || '空'})` : '- kb_previews:没有这张表');
  const maps = hasTable(d, 'kb_map_versions')
    ? d.prepare('SELECT version, name, by, at FROM kb_map_versions ORDER BY version').all() as { version: number; name: string; by: string; at: number }[] : null;
  lines.push(maps ? `- 删表 kb_map_versions:${maps.length} 版地图(${maps.map((m) => `v${m.version} ${m.name}`).join(';') || '空'})` : '- kb_map_versions:没有这张表');

  const bizCols = hasCol(d, 'kb_docs', 'biz') && hasCol(d, 'kb_docs', 'sec');
  const classified = bizCols
    ? d.prepare('SELECT id, title, biz, sec FROM kb_docs WHERE biz IS NOT NULL OR sec IS NOT NULL ORDER BY title').all() as { id: string; title: string; biz: string | null; sec: string | null }[] : [];
  lines.push(bizCols ? `- 清空 kb_docs.biz / sec:${classified.length} 篇已归类` : '- kb_docs 没有 biz / sec 列');
  const upCol = hasCol(d, 'kb_files', 'uploaded_by');
  const withUploader = upCol ? (d.prepare('SELECT COUNT(*) AS n FROM kb_files WHERE uploaded_by IS NOT NULL').get() as { n: number }).n : 0;
  lines.push(upCol ? `- 清空 kb_files.uploaded_by:${withUploader} 个附件记了上传人` : '- kb_files 没有 uploaded_by 列');
  const mapDoc = hasTable(d, 'meta')
    ? (d.prepare("SELECT value FROM meta WHERE key = 'kb.mapDoc'").get() as { value: string } | undefined)?.value : undefined;
  const mapTitle = mapDoc ? (d.prepare('SELECT title FROM kb_docs WHERE id = ?').get(mapDoc) as { title: string } | undefined)?.title : undefined;
  const docs = (d.prepare('SELECT COUNT(*) AS n FROM kb_docs').get() as { n: number }).n;
  const files = (d.prepare('SELECT COUNT(*) AS n FROM kb_files').get() as { n: number }).n;

  console.log(`REQ-061 回退 · 数据库 ${DB}`);
  lines.forEach((l) => console.log(l));
  console.log(`- 不动:${docs} 篇文档(正文 / 版本历史)、${files} 个附件原文件${mapTitle ? `;地图文档「${mapTitle}」留着` : ''}`);
  if (!apply) {
    d.close();
    console.log('');
    console.log('这是预览,没有改库。确认要回退:pm2 stop audax 后跑 scripts\\req061-rollback.bat --apply');
    return;
  }

  const bdir = path.join(DATA, 'backups');
  fs.mkdirSync(bdir, { recursive: true });
  const backup = path.join(bdir, `pre-req061-rollback-${stamp}.db`);
  await d.backup(backup);
  d.transaction(() => {
    d.exec('DROP TABLE IF EXISTS kb_previews');
    d.exec('DROP TABLE IF EXISTS kb_map_versions');
    if (bizCols) d.prepare('UPDATE kb_docs SET biz = NULL, sec = NULL WHERE biz IS NOT NULL OR sec IS NOT NULL').run();
    if (upCol) d.prepare('UPDATE kb_files SET uploaded_by = NULL WHERE uploaded_by IS NOT NULL').run();
  })();
  d.close();

  const out = path.join(DATA, 'migrations');
  fs.mkdirSync(out, { recursive: true });
  const report = path.join(out, `061-kb-rollback-${stamp}.md`);
  fs.writeFileSync(report, [
    '# REQ-061 知识库改版 · 回退报告', '', `- 时间:${now.toLocaleString('zh-CN')}`, `- 数据库:${DB}`, `- 回退前备份:${backup}`, '',
    '## 清掉的', '', ...lines, '',
    '## 原来的归类(重新上线后要恢复,可以照这张表重新归,或从回退前备份里取)', '',
    classified.length ? '| 文档 | 业务 | 板块 |\n|---|---|---|\n' + classified.map((c) => `| ${c.title.replace(/\|/g, '/')} | ${c.biz || ''} | ${c.sec || ''} |`).join('\n') : '(没有已归类的文档)', '',
    '## 没动的', '',
    `- ${docs} 篇文档的正文、标题、分类、标签、版本历史;${files} 个附件的原文件。`,
    mapTitle ? `- 地图文档「${mapTitle}」(id ${mapDoc})和 meta 的 kb.mapDoc 留着;旧代码里它是一篇普通文档。` : '- 没有地图文档。',
    '- 附件清单(kb_docs.attachments)里的 uploadedBy / isMap 字段留着,旧代码不读。', '',
  ].join('\n'), 'utf8');
  console.log('');
  console.log(`已回退。回退前备份:${backup}`);
  console.log(`报告:${report}`);
}
main().catch((e) => { console.error('回退失败:', e?.message || e); process.exit(1); });
