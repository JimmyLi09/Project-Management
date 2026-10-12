/* ===== REQ-053 回退:Job Record 硬件的 4 栏行放回去 =====

   什么时候用:REQ-053 上线后要把**代码**退回 REQ-049 那一版(所有业务都是 4 栏表),又不想用更新前的快照
   覆盖数据库(那样会丢掉上线之后的所有改动)。

   做什么(每个项目看 mig053):
     - 迁移删掉的行(jobRecordLegacy053)按原来的位置放回 p.jobRecord;
     - 迁移时补上的 pk(留下来当「额外项目」的那几行)去掉;上线后新加的额外项目原样留着(旧版本也能显示,
       就是 4 栏表里多几行);
     - LED 登记表覆盖表里「Height 高 (mm)」换回迁移前那份(如果当时改过);
     - 删掉迁移标记和「预演已确认」那一笔 —— 以后重新上线会再预演、再确认、再迁移。
   pk.record(登记表字段)迁移时没动,上线后在登记表卡上改的值也留着,旧版本在「旧字段(只读)」里看得到。

   不带参数:只报告会改什么,不写库。加 --apply 才改:先在线备份到 data\backups\pre-req053-rollback-<时间>.db,
   改了什么写到 data\migrations\053-jobrecord-rollback-<时间>.md。
   用法:pm2 stop audax → scripts\req053-rollback.bat [--apply] → 退代码 → 启动。 */

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

type Row = { id: string; svc: string; item: string; detail: string; qty: string; note: string; pk?: string };
type Legacy = Row & { at: number; idx: number };

async function main() {
  if (!fs.existsSync(DB)) { console.error(`找不到数据库:${DB}`); process.exit(1); }
  const d = new Database(DB, apply ? {} : { readonly: true });
  const rows = d.prepare('SELECT id, data FROM projects').all() as { id: string; data: string }[];
  const lines: string[] = [];
  const changed: { id: string; data: string }[] = [];
  let back = 0, unpk = 0;
  for (const r of rows) {
    let p: any;
    try { p = JSON.parse(r.data); } catch { continue; }
    if (!p.mig053) continue;
    const list: Row[] = Array.isArray(p.jobRecord) ? p.jobRecord : [];
    const legacy: Legacy[] = Array.isArray(p.jobRecordLegacy053) ? p.jobRecordLegacy053 : [];
    const keptIds = new Set<string>(p.mig053.kept || []);
    let n = 0;
    for (const x of list) if (keptIds.has(x.id) && x.pk) { delete x.pk; n++; }
    const have = new Set(list.map((x) => x.id));
    const put = [...legacy].sort((a, b) => a.idx - b.idx).filter((x) => !have.has(x.id));
    for (const x of put) {
      const { at: _a, idx, ...row } = x;
      list.splice(Math.min(idx, list.length), 0, row);
    }
    p.jobRecord = list;
    delete p.jobRecordLegacy053;
    delete p.mig053;
    back += put.length; unpk += n;
    lines.push(`- ${p.name || r.id}:放回 ${put.length} 行${n ? `,去掉 ${n} 行的 pk` : ''}`);
    const { updatedAt: _u, version: _v, ...data } = p;
    changed.push({ id: r.id, data: JSON.stringify(data) });
  }
  const ledPrev = d.prepare("SELECT value FROM meta WHERE key = 'mig.req053.ledFieldsPrev'").get() as { value: string } | undefined;
  if (ledPrev) lines.push('- LED 登记表覆盖表的「Height 高 (mm)」换回迁移前那份');
  const flag = d.prepare("SELECT value FROM meta WHERE key = 'mig.req053.jobRecord'").get() as { value: string } | undefined;

  console.log(`迁移标记:${flag ? flag.value : '(没有 —— 没迁移过,或已经回退过)'}`);
  console.log(`要还原:${changed.length} 个项目,放回 ${back} 行,去掉 ${unpk} 行的 pk`);
  console.log(lines.join('\n') || '  (无)');
  if (!apply) { console.log('\n只报告,没有写库。确认后加 --apply 再跑一次(先 pm2 stop audax)。'); d.close(); return; }

  const bdir = path.join(DATA, 'backups');
  fs.mkdirSync(bdir, { recursive: true });
  const backup = path.join(bdir, `pre-req053-rollback-${stamp}.db`);
  await d.backup(backup);
  const upd = d.prepare('UPDATE projects SET data = ?, version = version + 1 WHERE id = ?');
  d.transaction(() => {
    for (const x of changed) upd.run(x.data, x.id);
    if (ledPrev) d.prepare('UPDATE record_fields SET fields = ?, updated_by = ? WHERE svc = ?').run(ledPrev.value, 'REQ-053 回退', 'led');
    d.prepare("DELETE FROM meta WHERE key IN ('mig.req053.jobRecord', 'mig.req053.approved', 'mig.req053.ledFieldsPrev')").run();
  })();
  d.close();
  const mdir = path.join(DATA, 'migrations');
  fs.mkdirSync(mdir, { recursive: true });
  const log = path.join(mdir, `053-jobrecord-rollback-${stamp}.md`);
  fs.writeFileSync(log, ['# REQ-053 回退:Job Record 硬件的 4 栏行放回去', '', `时间:${now.toLocaleString('zh-CN')}`, `备份:${backup}`, '',
    `共 ${changed.length} 个项目,放回 ${back} 行,去掉 ${unpk} 行的 pk。`, '', ...(lines.length ? lines : ['(无)'])].join('\n') + '\n', 'utf8');
  console.log('');
  console.log(`改之前的数据库备份:${backup}`);
  console.log(`改了哪些:${log}`);
}
main().catch((e) => { console.error('回退失败:', e?.message || e); process.exit(1); });
