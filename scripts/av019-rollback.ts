/* ===== AV-019 回退:把用到 led@1.1 的立项记录 / 方案版本改回 led@1.0 =====

   什么时候用:AV-019 上线后要把**代码**退回旧版本、又不想用更新前的快照覆盖数据库
   (那样会丢掉上线之后所有的修改)。旧版本不认识规则包 led@1.1:上线后新建的 LED 项目、
   点过「升级到 led@1.1」的项目,退回去以后 05 一打开就报「unknown rule pack」。

   做什么:
     1. 先把 data\audax.db 在线备份到 data\backups\pre-av019-rollback-<时间>.db;
     2. av_inquiry.packs.led = led@1.1 的改回 led@1.0;
     3. av_config(LED)里 pack_version = led@1.1 的版本改记 led@1.0 —— 这些版本存下来的
        汇总数(电源线 / 数据线根数等)不动,06 照旧能用;重新打开 05 时按 1.0 重算;
     4. 改了哪些记录写到 data\migrations\av019-rollback-<时间>.json,以后重新上线 AV-019
        时可以对照着在 05 里重新「升级」。不删任何东西。

   用法:先 pm2 stop audax(别让网站同时写库),再跑 scripts\av019-rollback.bat,然后退代码、启动。
   加 --dry-run 只看会改哪些,不写库。 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const FROM = 'led@1.1';
const TO = 'led@1.0';
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
  const has = (t: string) => !!d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const inq = has('av_inquiry') ? (d.prepare('SELECT project_id, packs FROM av_inquiry').all() as { project_id: string; packs: string }[])
    .filter((r) => { try { return JSON.parse(r.packs).led === FROM; } catch { return false; } }) : [];
  const cfgs = has('av_config') ? d.prepare("SELECT id, project_id FROM av_config WHERE line = 'led' AND pack_version = ?").all(FROM) as { id: number; project_id: string }[] : [];
  console.log(`立项记录 led@1.1 → led@1.0:${inq.length} 个项目`);
  console.log(`LED 方案版本 led@1.1 → led@1.0:${cfgs.length} 个版本`);
  if (dry) { console.log('(--dry-run:没有写库)'); d.close(); return; }

  const bdir = path.join(DATA, 'backups');
  fs.mkdirSync(bdir, { recursive: true });
  const backup = path.join(bdir, `pre-av019-rollback-${stamp}.db`);
  await d.backup(backup);
  const updInq = d.prepare('UPDATE av_inquiry SET packs = ? WHERE project_id = ?');
  const updCfg = d.prepare('UPDATE av_config SET pack_version = ? WHERE id = ?');
  d.transaction(() => {
    for (const r of inq) updInq.run(JSON.stringify({ ...JSON.parse(r.packs), led: TO }), r.project_id);
    for (const c of cfgs) updCfg.run(TO, c.id);
  })();
  d.close();
  const mdir = path.join(DATA, 'migrations');
  fs.mkdirSync(mdir, { recursive: true });
  const log = path.join(mdir, `av019-rollback-${stamp}.json`);
  fs.writeFileSync(log, JSON.stringify({ at: now.toISOString(), from: FROM, to: TO, inquiries: inq.map((r) => r.project_id), configs: cfgs }, null, 2));
  console.log('');
  console.log(`改之前的数据库备份:${backup}`);
  console.log(`改了哪些:${log}`);
}
main().catch((e) => { console.error('回退失败:', e?.message || e); process.exit(1); });
