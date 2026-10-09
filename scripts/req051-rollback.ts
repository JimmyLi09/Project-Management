/* ===== REQ-051 回退:权限表 / 删除用户 =====

   REQ-051 往数据库里加的东西:
     · users 表一列 deleted_at(0 = 没删)、一张新表 admin_log(管理日志)—— 启动时自动加,不动旧数据;
     · meta 里的 perm.table —— PD / BD 在「权限设置」点了保存才有;没有 = 默认值(= 上线前的规则)。
   退回旧版本代码时**什么都不用跑**:旧代码不认这一列、这张表、这个 key,行为就是上线前的样子;
   被删除的账号在旧版本里显示为「已停用」(删除时同时停用了),照样登录不了。

   这个脚本做三件事(按参数):
     不带参数          只报告:权限表改了哪几格、删过哪些账号、管理日志多少条。不写库。
     --reset-perms     权限表恢复默认(删掉 meta 里的 perm.table)。
     --undelete <账号>  撤销误删:清掉这个账号的删除标记,账号仍是「停用」,PD 在用户管理里点「恢复账号」。
                       删除时转交出去的项目 / 待办**不会**自动转回 —— 每个项目的日志里写着
                       「X 的工作转交给 Y」,需要的话在项目里改回来。
   写库前都先在线备份到 data\backups\pre-req051-rollback-<时间>.db,改了什么写到
   data\migrations\051-rollback-<时间>.md。加 --dry-run 只看不写。

   用法:pm2 stop audax → scripts\req051-rollback.bat [参数] → pm2 start audax(或退代码后再启动)。 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { defaultPermTable, permDiff, sanitizePermTable } from '../src/lib/permTable.ts';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const pad = (n: number) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const DATA = process.env.AUDAX_DATA_DIR || path.join(process.cwd(), 'data');
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const resetPerms = args.includes('--reset-perms');
const ui = args.indexOf('--undelete');
const undelete = ui >= 0 ? String(args[ui + 1] || '') : '';
const DB = args.find((a, i) => !a.startsWith('--') && (ui < 0 || i !== ui + 1)) || path.join(DATA, 'audax.db');

const LV: Record<string, string> = { none: '不可见', read: '只读', edit: '可编辑' };

async function main() {
  if (!fs.existsSync(DB)) { console.error(`找不到数据库:${DB}`); process.exit(1); }
  if (ui >= 0 && !undelete) { console.error('--undelete 后面要跟账号(登录名)'); process.exit(1); }
  const writes = !dry && (resetPerms || !!undelete);
  const d = new Database(DB, writes ? {} : { readonly: true });
  const cols = (d.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name);
  const hasDel = cols.includes('deleted_at');
  const hasLog = !!d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'admin_log'").get();

  const row = d.prepare("SELECT value FROM meta WHERE key = 'perm.table'").get() as { value: string } | undefined;
  let diff: ReturnType<typeof permDiff> = [];
  if (row) { try { diff = permDiff(defaultPermTable(), sanitizePermTable(JSON.parse(row.value))); } catch { /* 坏了就当默认 */ } }
  const deleted = hasDel ? d.prepare('SELECT id, username, name, role, deleted_at FROM users WHERE deleted_at > 0 ORDER BY deleted_at').all() as { id: number; username: string; name: string; role: string; deleted_at: number }[] : [];
  const logN = hasLog ? (d.prepare('SELECT COUNT(*) AS c FROM admin_log').get() as { c: number }).c : 0;

  const lines: string[] = [];
  lines.push(`权限表:${row ? (diff.length ? `改过 ${diff.length} 格` : '存过,但和默认一样') : '没存过(= 默认)'}`);
  diff.forEach((x) => lines.push(`  - ${x.role} ·「${x.module}」${LV[x.from]} → ${LV[x.to]}`));
  lines.push(`已删除的账号:${deleted.length} 个`);
  deleted.forEach((u) => lines.push(`  - ${u.name}(${u.username},${u.role},${new Date(u.deleted_at).toLocaleString('zh-CN')} 删除)`));
  lines.push(`管理日志:${logN} 条`);
  console.log(lines.join('\n'));
  if (!resetPerms && !undelete) {
    console.log('\n只报告,没有写库。退回旧版本代码不需要跑任何东西;要恢复默认权限加 --reset-perms,要撤销误删加 --undelete <账号>。');
    d.close(); return;
  }
  const target = undelete ? deleted.find((u) => u.username === undelete.toLowerCase()) : undefined;
  if (undelete && !target) { console.error(`\n没有找到已删除的账号「${undelete}」`); d.close(); process.exit(1); }
  const plan = [
    ...(resetPerms ? [row ? '权限表恢复默认(删掉 meta 里的 perm.table)' : '权限表本来就是默认,不用改'] : []),
    ...(target ? [`撤销删除 ${target.name}(${target.username}):清掉删除标记,账号仍是「停用」,转交出去的工作不自动转回`] : []),
  ];
  console.log('\n要做:\n' + plan.map((x) => '  - ' + x).join('\n'));
  if (dry) { console.log('(--dry-run:没有写库)'); d.close(); return; }

  const bdir = path.join(DATA, 'backups');
  fs.mkdirSync(bdir, { recursive: true });
  const backup = path.join(bdir, `pre-req051-rollback-${stamp}.db`);
  await d.backup(backup);
  d.transaction(() => {
    if (resetPerms && row) d.prepare("DELETE FROM meta WHERE key = 'perm.table'").run();
    if (target) d.prepare('UPDATE users SET deleted_at = 0, disabled = 1 WHERE id = ?').run(target.id);
    if (hasLog) {
      const ins = d.prepare('INSERT INTO admin_log (at, by, text, k, p) VALUES (?, ?, ?, NULL, NULL)');
      for (const x of plan) ins.run(Date.now(), 'scripts/req051-rollback', x);
    }
  })();
  d.close();
  const mdir = path.join(DATA, 'migrations');
  fs.mkdirSync(mdir, { recursive: true });
  const log = path.join(mdir, `051-rollback-${stamp}.md`);
  fs.writeFileSync(log, ['# REQ-051 回退', '', `时间:${now.toLocaleString('zh-CN')}`, `备份:${backup}`, '', '## 回退前', '', ...lines, '', '## 做了', '', ...plan.map((x) => '- ' + x)].join('\n') + '\n', 'utf8');
  console.log('');
  console.log(`改之前的数据库备份:${backup}`);
  console.log(`改了哪些:${log}`);
}
main().catch((e) => { console.error('回退失败:', e?.message || e); process.exit(1); });
