/* ===== REQ-054 售前接洽 · 迁移预演(只读,不碰正式数据) =====

   做什么:
     1. 用 SQLite 的在线备份把 data\audax.db 复制一份到 data\migrations\054-dryrun-<时间>.db
        (网站开着也能复制,正式库一个字节都不改);
     2. 列出所有从 AV 立项询价建的项目,按条件(没有负责人、交接没提交、没开过 Invoice)判断:
        - 049 · 147-Senja Close sales gallery(id muy6ka5ieeir):要改 —— 去掉编号、改为售前记录;
        - 其他符合条件的(例如 046 · BOC Lobby LED):「符合条件,待 JM 确认」,不改;
          JM 确认要一起改的,预演时加 --include 046(可以写几个,逗号隔开);
     3. 在副本上真改一遍,自检:其他项目编号一个不动;
     4. 报告写到 data\migrations\054-approach-dryrun-<时间>.md。

   **先预演、再正式**:正式迁移(新版本启动时)要改编号的话,必须先有 JM 确认过的预演。
   JM 看完报告没问题,再跑一次并加 --approve(和要一起改的 --include):重新预演一遍、出报告,
   然后在正式库里记一笔「已确认」和确认过的项目(只写这一笔 meta,别的不动),之后 pm2 restart audax 才会真跑。
   用法:scripts\req054-dryrun.bat [--include 046] [--approve] [数据库路径]
   规则和上线迁移是同一份代码(src/lib/mig054.ts)。 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { applyMig054, MIG054_DEFAULT_IDS, planMig054, report054, resolveInclude } from '../src/lib/mig054';
import type { Project } from '../src/lib/types';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const pad = (n: number) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const DATA = process.env.AUDAX_DATA_DIR || path.join(process.cwd(), 'data');
const args = process.argv.slice(2);
const approve = args.includes('--approve');
const incIdx = args.indexOf('--include');
const includeArgs = incIdx >= 0 ? String(args[incIdx + 1] || '').split(',') : [];
const SRC_DB = args.find((a, i) => !a.startsWith('--') && i !== incIdx + 1) || path.join(DATA, 'audax.db');
const OUT = path.join(DATA, 'migrations');
const MIG_054 = 'mig.req054.approach';
const APPROVE_054 = 'mig.req054.approved';
const code = (n?: number) => (n ? String(n).padStart(3, '0') : '—');

async function main() {
  if (!fs.existsSync(SRC_DB)) { console.error(`找不到数据库:${SRC_DB}`); process.exit(1); }
  if (incIdx >= 0 && !includeArgs.filter(Boolean).length) { console.error('--include 后面要写编号,例如 --include 046'); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const src = new Database(SRC_DB, { readonly: true, fileMustExist: true });
  const ran = src.prepare('SELECT value FROM meta WHERE key = ?').get(MIG_054) as { value: string } | undefined;
  if (ran) {
    src.close();
    console.error(`正式迁移已经跑过了(${new Date(JSON.parse(ran.value).at).toLocaleString('zh-CN')}),现在预演没有意义 —— 结果看 data\\migrations\\054-approach-*.md。`);
    process.exit(1);
  }
  const copy = path.join(OUT, `054-dryrun-${stamp}.db`);
  await src.backup(copy);   // 在线备份:网站开着也安全,只读打开正式库
  src.close();

  const d = new Database(copy);
  const rows = d.prepare('SELECT id, data FROM projects ORDER BY created_at ASC').all() as { id: string; data: string }[];
  const list: Project[] = [];
  for (const r of rows) { try { const o = JSON.parse(r.data); if (o && Array.isArray(o.packages)) list.push(o); } catch { /* 坏行跳过 */ } }
  const { ids: inc, bad } = resolveInclude(list, includeArgs);
  if (bad.length) { d.close(); console.error(`--include 里认不出:${bad.join('、')}(写编号如 046,或项目 id)`); process.exit(1); }
  const plan = planMig054(list, inc);
  const notOk = plan.filter((r) => inc.includes(r.id) && r.action !== 'change');
  if (notOk.length) { d.close(); console.error(`--include 的这些项目不符合条件,不能改:${notOk.map((r) => `${code(r.serial)} · ${r.name}(${r.why})`).join(';')}`); process.exit(1); }
  const want = plan.filter((r) => r.action === 'change');
  const before = new Map(list.map((p) => [p.id, p.serial]));
  const upd = d.prepare('UPDATE projects SET data = ? WHERE id = ?');
  d.transaction(() => {
    for (const r of want) {
      const o = list.find((x) => x.id === r.id)!;
      applyMig054(o, now.getTime());
      const { updatedAt: _u, version: _v, ...data } = o;
      upd.run(JSON.stringify(data), o.id);
    }
  })();
  /* 自检:只有要改的那几个没了编号,其他一个不动 */
  const after = (d.prepare('SELECT id, data FROM projects').all() as { id: string; data: string }[]).map((r) => JSON.parse(r.data) as Project);
  const problems: string[] = [];
  for (const p of after) {
    const was = before.get(p.id);
    if (want.some((r) => r.id === p.id)) { if (p.serial || p.approach?.legacySerial !== was) problems.push(`${p.name}:没改对`); }
    else if (p.serial !== was) problems.push(`${p.name}:编号变了(${was} → ${p.serial})`);
  }
  d.close();
  let max = 0;
  for (const p of after) if (typeof p.serial === 'number' && p.serial > max) max = p.serial;

  const md = report054(plan, { title: 'REQ-054 售前接洽 · 迁移预演报告', when: now.toLocaleString('zh-CN'), db: `${SRC_DB}(副本:${copy})`, next: max + 1 })
    + `\n自检:${problems.length ? '**有问题**:' + problems.join(';') : '全部通过(只有要改的项目去掉了编号,其他编号一个不动)'}\n`;
  const report = path.join(OUT, `054-approach-dryrun-${stamp}.md`);
  fs.writeFileSync(report, md, 'utf8');

  console.log('');
  console.log(`预演完成:${want.length} 个项目去掉编号、改为售前记录${want.length ? '(' + want.map((r) => code(r.serial) + ' · ' + r.name).join('、') + ')' : ''};`
    + `另有 ${plan.filter((r) => r.action === 'confirm').length} 个符合条件待确认;自检${problems.length ? '有问题' : '全部通过'}。`);
  console.log(`报告:${report}`);
  console.log(`副本:${copy}(正式库没有动)`);
  if (!approve) {
    console.log('');
    console.log('请 JM 看报告。没问题的话再跑一次:scripts\\req054-dryrun.bat --approve(要一起改 046 就加 --include 046),然后 pm2 restart audax(或 scripts\\update.bat)。');
    return;
  }
  if (problems.length) { console.error('自检有问题,不能确认 —— 把报告发给开发。'); process.exit(1); }
  const w = new Database(SRC_DB, { fileMustExist: true });
  w.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(APPROVE_054, JSON.stringify({
    at: now.getTime(), by: os.userInfo().username, report, ids: want.map((r) => r.id),
    serials: want.map((r) => r.serial), include: inc.filter((x) => !MIG054_DEFAULT_IDS.includes(x)),
  }));
  w.close();
  console.log('');
  console.log(`已在正式库记下「预演已确认」(${want.map((r) => code(r.serial)).join('、') || '没有要改的'})。下一步:pm2 restart audax(新版本已经装好的话),或者跑 scripts\\update.bat。`);
  console.log('启动后看 data\\migrations\\054-approach-<时间>.md,结果应和这份预演报告一样。');
}
main().catch((e) => { console.error('预演失败:', e?.message || e); process.exit(1); });
