/* ===== REQ-044 共用信息清单 · 迁移预演(只读,不碰正式数据库) =====

   做什么:
     1. 用 SQLite 的在线备份把 data\audax.db 复制一份到
        data\migrations\044-dryrun-<时间>.db(网站开着也能复制,正式库一个字节都不改);
     2. 在这份副本上按上线时的规则把每个项目的各服务包清单合成一张
        (原样备份进 checklistLegacy);
     3. 自检:每一项都找得到去处、已确认的没被降级、收料记录和参考图一条不少;
     4. 报告写到 data\migrations\044-checklist-merge-dryrun-<时间>.md。

   合并规则和上线迁移用的是同一份代码(src/lib/checklistMerge.ts)。
   用法:scripts\req044-dryrun.bat(或 node --import ./scripts/ts-register.mjs scripts/req044-dryrun.ts [数据库路径]) */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { migrate } from '../src/lib/project';
import { svcName } from '../src/lib/templates';
import { DEFAULT_SYNONYMS, migrateProjectChecklist, migrationReport, type ProjectMigration } from '../src/lib/checklistMerge';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const pad = (n: number) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const DATA = process.env.AUDAX_DATA_DIR || path.join(process.cwd(), 'data');
const SRC_DB = process.argv[2] || path.join(DATA, 'audax.db');
const OUT = path.join(DATA, 'migrations');

async function main() {
  if (!fs.existsSync(SRC_DB)) { console.error(`找不到数据库:${SRC_DB}`); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const copy = path.join(OUT, `044-dryrun-${stamp}.db`);
  const src = new Database(SRC_DB, { readonly: true, fileMustExist: true });
  await src.backup(copy);   // 在线备份:网站开着也安全,只读打开正式库
  src.close();

  const d = new Database(copy);
  const syn = (() => {
    try {
      const row = d.prepare("SELECT value FROM meta WHERE key = 'cl.synonyms'").get() as { value: string } | undefined;
      const v = row ? JSON.parse(row.value) : null;
      return Array.isArray(v) ? (v as string[][]) : DEFAULT_SYNONYMS;
    } catch { return DEFAULT_SYNONYMS; }
  })();
  const tagOf = (svc: string, label?: string) => svcName(svc, 'zh') + (label ? ` · ${label}` : '');
  const rows = d.prepare('SELECT id, data FROM projects ORDER BY created_at ASC').all() as { id: string; data: string }[];
  const upd = d.prepare('UPDATE projects SET data = ? WHERE id = ?');
  const list: ProjectMigration[] = [];
  let already = 0, broken = 0;
  d.transaction(() => {
    for (const r of rows) {
      let o: any;
      try { o = JSON.parse(r.data); } catch { broken++; continue; }
      const p = migrate(o) as any;   // 和网站读项目时同样的规整(补 id、把老收料信息搬成第一条记录)
      const m = migrateProjectChecklist(p, { synonyms: syn, tagOf });
      if (!m) { already++; continue; }
      list.push(m);
      const { updatedAt: _u, version: _v, ...data } = p;
      upd.run(JSON.stringify(data), r.id);
    }
  })();
  d.close();

  const md = migrationReport(list, { title: 'REQ-044 共用信息清单 · 迁移预演报告', when: now.toLocaleString('zh-CN'), db: `${SRC_DB}(副本:${copy})`, synonyms: syn });
  const extra = [already ? `\n> 有 ${already} 个项目已经是新结构,跳过。` : '', broken ? `\n> 有 ${broken} 个项目数据读不出来,跳过(请把报告发回来看)。` : ''].join('');
  const report = path.join(OUT, `044-checklist-merge-dryrun-${stamp}.md`);
  fs.writeFileSync(report, md + extra + '\n', 'utf8');

  const merged = list.filter((m) => m.merged.length).length;
  const bad = list.filter((m) => m.problems.length).length;
  console.log('');
  console.log(`预演完成:${list.length} 个项目,其中 ${merged} 个有跨服务合并;自检${bad ? `有 ${bad} 个项目有问题` : '全部通过'}。`);
  console.log(`报告:${report}`);
  console.log(`副本:${copy}(正式库没有动)`);
}
main().catch((e) => { console.error('预演失败:', e?.message || e); process.exit(1); });
