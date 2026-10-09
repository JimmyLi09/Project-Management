/* ===== REQ-052 回退:联系人角色从「键」改回旧标签 =====

   什么时候用:REQ-052 上线后要把**代码**退回旧版本、又不想用更新前的快照覆盖数据库。
   旧版本只认「客户 Client」「总包 Main-con」这类标签;不跑的话,旧版本里联系人的角色
   会显示成 developer / maincon 这样的英文键(数据没丢,只是显示难看)。

   做什么:
     1. 先把 data\audax.db 在线备份到 data\backups\pre-req052-rollback-<时间>.db;
     2. 每个项目的联系人:developer → 「客户 Client」,maincon → 「总包 Main-con」,其它固定角色同理;
        手填的不动;
     3. 删掉 meta 里的 mig.req052.contactRoles —— 以后重新上线会再迁移一次、再出报告。
     4. 改了哪些写到 data\migrations\052-contact-roles-rollback-<时间>.md。

   用法:先 pm2 stop audax,再跑 scripts\req052-rollback.bat,然后退代码、启动。加 --dry-run 只看不写。 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { remapContactRoles, toLegacyRole } from '../src/lib/contactRoles.ts';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const pad = (n: number) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const DATA = process.env.AUDAX_DATA_DIR || path.join(process.cwd(), 'data');
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const DB = args.find((a) => !a.startsWith('--')) || path.join(DATA, 'audax.db');

async function main() {
  if (!fs.existsSync(DB)) { console.error(`找不到数据库:${DB}`); process.exit(1); }
  const d = new Database(DB, dry ? { readonly: true } : {});
  const rows = d.prepare('SELECT id, data FROM projects').all() as { id: string; data: string }[];
  const plan: { id: string; name: string; data: string; changes: { from: string; to: string }[] }[] = [];
  for (const r of rows) {
    let p: any;
    try { p = JSON.parse(r.data); } catch { continue; }
    const changes = remapContactRoles(p.contacts, toLegacyRole);
    if (changes.length) plan.push({ id: r.id, name: p.name || r.id, data: JSON.stringify(p), changes });
  }
  const n = plan.reduce((a, x) => a + x.changes.length, 0);
  console.log(`联系人角色 键 → 旧标签:${plan.length} 个项目、${n} 条`);
  if (dry) { console.log('(--dry-run:没有写库)'); d.close(); return; }

  const bdir = path.join(DATA, 'backups');
  fs.mkdirSync(bdir, { recursive: true });
  const backup = path.join(bdir, `pre-req052-rollback-${stamp}.db`);
  await d.backup(backup);
  const upd = d.prepare('UPDATE projects SET data = ?, version = version + 1 WHERE id = ?');
  d.transaction(() => {
    for (const x of plan) upd.run(x.data, x.id);
    d.prepare("DELETE FROM meta WHERE key = 'mig.req052.contactRoles'").run();
  })();
  d.close();
  const mdir = path.join(DATA, 'migrations');
  fs.mkdirSync(mdir, { recursive: true });
  const log = path.join(mdir, `052-contact-roles-rollback-${stamp}.md`);
  fs.writeFileSync(log, ['# REQ-052 回退:联系人角色改回旧标签', '', `时间:${now.toLocaleString('zh-CN')}`, `备份:${backup}`, '',
    ...plan.map((x) => `- ${x.name}:${x.changes.map((c) => `${c.from} → ${c.to}`).join('、')}`)].join('\n') + '\n', 'utf8');
  console.log('');
  console.log(`改之前的数据库备份:${backup}`);
  console.log(`改了哪些:${log}`);
}
main().catch((e) => { console.error('回退失败:', e?.message || e); process.exit(1); });
