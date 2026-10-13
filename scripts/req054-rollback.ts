/* ===== REQ-054 回退:上线迁移去掉的编号放回去 =====

   什么时候用:REQ-054 上线后要把**代码**退回上一版(没有「售前接洽」),又不想用更新前的快照覆盖数据库。
   注意旧版本启动时会给所有没编号的项目补编号 —— 所以退代码之前,先把迁移去掉的号放回原位:

   做什么(看 approach.legacySerial):
     - 迁移时去掉编号的项目:原编号放回 serial,去掉 approach(还原成上线前的样子);
       如果这个号已经被别的项目用了(迁移后新建的正式项目拿到了它),不放回,报告里列出来;
     - 上线后转成正式项目的(已经有新编号)、并入别的项目的:不动,报告里列出来;
     - 上线后 AV 立项询价新建的售前记录(没有原编号):不动 —— 旧版本启动时会给它们按顺序补编号,报告里列出来;
     - 删掉迁移标记和「预演已确认」那一笔:以后重新上线会再预演、再确认、再迁移。

   不带参数:只报告会改什么,不写库。加 --apply 才改:先在线备份到 data\backups\pre-req054-rollback-<时间>.db,
   改了什么写到 data\migrations\054-approach-rollback-<时间>.md。
   用法:pm2 stop audax → scripts\req054-rollback.bat [--apply] → 退代码 → 启动。 */

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
const code = (n?: number) => (n ? String(n).padStart(3, '0') : '—');

async function main() {
  if (!fs.existsSync(DB)) { console.error(`找不到数据库:${DB}`); process.exit(1); }
  const d = new Database(DB, apply ? {} : { readonly: true });
  const rows = d.prepare('SELECT id, data FROM projects').all() as { id: string; data: string }[];
  const all: { id: string; o: any }[] = [];
  for (const r of rows) { try { all.push({ id: r.id, o: JSON.parse(r.data) }); } catch { /* 坏行跳过 */ } }
  const used = new Set(all.filter((x) => typeof x.o.serial === 'number').map((x) => x.o.serial as number));
  const back: string[] = [], taken: string[] = [], keep: string[] = [], fresh: string[] = [];
  const changed: { id: string; data: string }[] = [];
  for (const { id, o } of all) {
    const ap = o.approach;
    if (!ap) continue;
    const ls = ap.legacySerial;
    if (typeof ls === 'number' && ls > 0) {
      if (ap.status === 'converted' || ap.status === 'merged') { keep.push(`${o.name}(原 ${code(ls)},上线后${ap.status === 'converted' ? '已转正式项目,现在是 ' + code(o.serial) : '已并入别的项目'})`); continue; }
      if (used.has(ls)) { taken.push(`${o.name}(原 ${code(ls)},这个号现在被别的项目用了)`); continue; }
      o.serial = ls;
      used.add(ls);
      delete o.approach;
      back.push(`${code(ls)} · ${o.name}`);
      const { updatedAt: _u, version: _v, ...data } = o;
      changed.push({ id, data: JSON.stringify(data) });
    } else if (ap.status !== 'converted') {
      fresh.push(o.name);
    }
  }
  const flag = d.prepare("SELECT value FROM meta WHERE key = 'mig.req054.approach'").get() as { value: string } | undefined;
  const lines = [
    `放回编号:${back.length} 个${back.length ? '(' + back.join('、') + ')' : ''}`,
    ...(taken.length ? [`号已被占用、不放回:${taken.join('、')} —— 旧版本启动时会给它补一个新号`] : []),
    ...(keep.length ? [`不动:${keep.join('、')}`] : []),
    ...(fresh.length ? [`上线后新建的售前记录 ${fresh.length} 个(${fresh.join('、')}):不动,旧版本启动时会按顺序补编号`] : []),
  ];
  console.log(`迁移标记:${flag ? flag.value : '(没有 —— 没迁移过,或已经回退过)'}`);
  console.log(`要还原:${changed.length} 个项目`);
  console.log(lines.map((l) => '  ' + l).join('\n'));
  if (!apply) { console.log('\n只报告,没有写库。确认后加 --apply 再跑一次(先 pm2 stop audax)。'); d.close(); return; }

  const bdir = path.join(DATA, 'backups');
  fs.mkdirSync(bdir, { recursive: true });
  const backup = path.join(bdir, `pre-req054-rollback-${stamp}.db`);
  await d.backup(backup);
  const upd = d.prepare('UPDATE projects SET data = ?, version = version + 1 WHERE id = ?');
  d.transaction(() => {
    for (const x of changed) upd.run(x.data, x.id);
    d.prepare("DELETE FROM meta WHERE key IN ('mig.req054.approach', 'mig.req054.approved')").run();
  })();
  d.close();
  const mdir = path.join(DATA, 'migrations');
  fs.mkdirSync(mdir, { recursive: true });
  const log = path.join(mdir, `054-approach-rollback-${stamp}.md`);
  fs.writeFileSync(log, ['# REQ-054 回退:上线迁移去掉的编号放回去', '', `时间:${now.toLocaleString('zh-CN')}`, `备份:${backup}`, '',
    ...lines.map((l) => '- ' + l)].join('\n') + '\n', 'utf8');
  console.log('');
  console.log(`改之前的数据库备份:${backup}`);
  console.log(`改了哪些:${log}`);
}
main().catch((e) => { console.error('回退失败:', e?.message || e); process.exit(1); });
