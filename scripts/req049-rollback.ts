/* ===== REQ-049 回退:Job Record 4 栏表 =====

   REQ-049 往数据库里加了什么:每个项目一张 4 栏表 p.jobRecord(上线迁移时由旧登记表字段转来,
   之后在 Job Record 页上改的也都在这里)。旧登记表字段 pk.record 一个没动。
   所以**退回旧版本代码不需要跑任何东西**:旧代码不认 p.jobRecord,照常显示旧字段。
   要注意的只有一件事:上线后在 4 栏表里录的内容,旧版本里看不到 —— 这个脚本把它导出来。

     不带参数     只报告:几个项目、多少行,并把全部 4 栏行导出成 CSV(Excel 可直接打开)
                  到 data\migrations\049-jobrecord-export-<时间>.csv。不写库。
     --apply      导出之后,再把 p.jobRecord 和迁移标记删掉(先在线备份到
                  data\backups\pre-req049-rollback-<时间>.db)。以后重新上线会按旧字段再迁移一次 ——
                  上线后在 4 栏表里改的内容只在导出的 CSV 里。一般不需要这一步。

   用法:pm2 stop audax → scripts\req049-rollback.bat [--apply] → 退代码 → 启动。 */

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

async function main() {
  if (!fs.existsSync(DB)) { console.error(`找不到数据库:${DB}`); process.exit(1); }
  const d = new Database(DB, apply ? {} : { readonly: true });
  const rows = d.prepare('SELECT id, data FROM projects ORDER BY created_at').all() as { id: string; data: string }[];
  const q = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const csv: string[] = [['Project no.', 'Project', 'Client', 'Service', 'Service Item', 'Detail', 'Quantity', 'Special Notes', 'Migrated'].map(q).join(',')];
  let projects = 0, total = 0, fresh = 0;
  const changed: { id: string; data: string }[] = [];
  for (const r of rows) {
    let p: any;
    try { p = JSON.parse(r.data); } catch { continue; }
    if (!Array.isArray(p.jobRecord)) continue;
    projects++;
    if (!p.mig049) fresh++;
    for (const x of p.jobRecord) {
      total++;
      csv.push([p.serial ? String(p.serial).padStart(3, '0') : '', p.name, p.client, x.svc, x.item, x.detail, x.qty, x.note, p.mig049 ? 'yes' : 'no'].map(q).join(','));
    }
    if (apply) { delete p.jobRecord; delete p.mig049; const { updatedAt: _u, version: _v, ...data } = p; changed.push({ id: r.id, data: JSON.stringify(data) }); }
  }
  const flag = d.prepare("SELECT value FROM meta WHERE key = 'mig.req049.jobRecord'").get() as { value: string } | undefined;
  const mdir = path.join(DATA, 'migrations');
  fs.mkdirSync(mdir, { recursive: true });
  const out = path.join(mdir, `049-jobrecord-export-${stamp}.csv`);
  fs.writeFileSync(out, '﻿' + csv.join('\r\n') + '\r\n', 'utf8');
  console.log(`迁移标记:${flag ? flag.value : '(没有)'}`);
  console.log(`4 栏表:${projects} 个项目、${total} 行(其中 ${fresh} 个项目是上线后新建的,只有 4 栏表)`);
  console.log(`已导出:${out}`);
  if (!apply) { console.log('\n只报告 + 导出,没有写库。退回旧版本代码不需要再做别的。'); d.close(); return; }

  const bdir = path.join(DATA, 'backups');
  fs.mkdirSync(bdir, { recursive: true });
  const backup = path.join(bdir, `pre-req049-rollback-${stamp}.db`);
  await d.backup(backup);
  const upd = d.prepare('UPDATE projects SET data = ?, version = version + 1 WHERE id = ?');
  d.transaction(() => {
    for (const x of changed) upd.run(x.data, x.id);
    d.prepare("DELETE FROM meta WHERE key = 'mig.req049.jobRecord'").run();
  })();
  d.close();
  const log = path.join(mdir, `049-jobrecord-rollback-${stamp}.md`);
  fs.writeFileSync(log, ['# REQ-049 回退:删掉 Job Record 4 栏表', '', `时间:${now.toLocaleString('zh-CN')}`, `备份:${backup}`,
    `导出:${out}`, '', `删掉了 ${changed.length} 个项目的 4 栏表(共 ${total} 行);旧登记表字段原样在。`].join('\n') + '\n', 'utf8');
  console.log('');
  console.log(`改之前的数据库备份:${backup}`);
  console.log(`改了哪些:${log}`);
}
main().catch((e) => { console.error('回退失败:', e?.message || e); process.exit(1); });
