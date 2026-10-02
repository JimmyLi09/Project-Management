/* ===== REQ-044 回退:把项目上的共用清单拆回各服务包 =====

   什么时候用:REQ-044 上线后要把**代码**退回旧版本、又不想用更新前的快照覆盖数据库
   (那样会丢掉上线之后所有的修改)。旧版本只认 packages[].checklist,不跑这个的话,
   退回去之后所有项目的信息清单都是空的。

   做什么:
     1. 先把 data\audax.db 在线备份到 data\backups\pre-req044-rollback-<时间>.db;
     2. 每个项目:按每项的服务标签,把共用清单里的项抄回各服务包
        (共用项每个服务包各一份,内容相同;同一种服务第二份起的专属项只回到那一份);
        「无固定分类」开关也放回各服务包;
     3. 去掉项目上的 checklist —— 以后再升级会按那时的服务包清单重新合并、重新出报告。
        checklistLegacy、已移除的项原样留着,不删任何东西。

   用法:先 pm2 stop audax(别让网站同时写库),再跑 scripts\req044-rollback.bat,然后退代码、启动。 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const pad = (n: number) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const DATA = process.env.AUDAX_DATA_DIR || path.join(process.cwd(), 'data');
const DB = process.argv[2] || path.join(DATA, 'audax.db');

type Item = { id?: string; svcs?: string[]; inst?: string; [k: string]: unknown };
type Group = { group: string; groupEn: string; color: string; items: Item[] };

async function main() {
  if (!fs.existsSync(DB)) { console.error(`找不到数据库:${DB}`); process.exit(1); }
  const bdir = path.join(DATA, 'backups');
  fs.mkdirSync(bdir, { recursive: true });
  const backup = path.join(bdir, `pre-req044-rollback-${stamp}.db`);
  const d = new Database(DB);
  await d.backup(backup);
  const rows = d.prepare('SELECT id, data FROM projects').all() as { id: string; data: string }[];
  const upd = d.prepare('UPDATE projects SET data = ?, version = version + 1 WHERE id = ?');
  let n = 0;
  d.transaction(() => {
    for (const r of rows) {
      let p: any;
      try { p = JSON.parse(r.data); } catch { continue; }
      if (!Array.isArray(p.checklist)) continue;
      const groups: Group[] = p.checklist;
      const seen: Record<string, number> = {};
      (p.packages || []).forEach((pk: any) => {
        const nth = (seen[pk.svc] = (seen[pk.svc] || 0) + 1);
        const inst = nth > 1 ? (pk.label || `#${nth}`) : '';
        const mine = (it: Item) => (it.svcs || []).includes(pk.svc) && (inst ? it.inst === inst || !it.inst : !it.inst);
        pk.checklist = groups
          .map((g) => ({ group: g.group, groupEn: g.groupEn, color: g.color, items: g.items.filter(mine).map((it) => { const { svcs: _s, inst: _i, ...rest } = it; return { ...rest }; }) }))
          .filter((g) => g.items.length);
        if (p.noCategories) pk.noCategories = true;
      });
      /* 同一项抄进好几个服务包时,id 不能重复(旧版本按序号找项,但 React key 用 id) */
      const used = new Set<string>();
      (p.packages || []).forEach((pk: any) => pk.checklist.forEach((g: Group) => g.items.forEach((it) => {
        if (it.id && used.has(it.id)) it.id = `${it.id}-${pk.svc}${used.size}`;
        if (it.id) used.add(it.id);
      })));
      p.checklistRolledBack = { at: Date.now(), checklist: p.checklist, noCategories: !!p.noCategories };   // 拆回之前的样子也留一份
      delete p.checklist;
      delete p.noCategories;
      upd.run(JSON.stringify(p), r.id);
      n++;
    }
  })();
  d.close();
  console.log('');
  console.log(`已把 ${n} 个项目的共用清单拆回各服务包。`);
  console.log(`改之前的数据库备份:${backup}`);
}
main().catch((e) => { console.error('回退失败:', e?.message || e); process.exit(1); });
