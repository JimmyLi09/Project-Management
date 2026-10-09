/* ===== REQ-048 回退:排期迁移还原 =====

   什么时候用:REQ-048 上线后要把**代码**退回旧版本、又不想用更新前的快照覆盖数据库
   (那样会丢掉上线之后的所有改动)。

   上线迁移做过的事(每份业务记在 packages[i].mig048 里)和这里怎么还原:
     fromRows     用阶段行生成了日历  → 日历上线后没再保存过:删掉这份日历(旧版本就回到「经典排期」);
                                      保存过:留着(旧版本里也能用),报告里列出来。
     rowsFromCal  用日历重写了阶段行  → 换回原来的行(mig048.prevRows)。上线后在日历上保存过的,
                                      行上已经是新排的日期 / 负责人 —— 留着,报告里列出来。
     conflict     以阶段行为准重建日历 → 日历没再保存过:换回原来的日历(mig048.prevCalendar)。
   迁移时挪去留底(scheduleLegacy)的那几行一并去掉;模板管理里被换掉的 CGI / 动画排期换回原样。
   最后删掉迁移标记 —— 以后重新上线会再迁移一次、再出报告。

   不带参数:只报告会改什么,不写库。加 --apply 才改:先在线备份到
   data\backups\pre-req048-rollback-<时间>.db,改了什么写到 data\migrations\048-schedule-rollback-<时间>.md。
   用法:pm2 stop audax → scripts\req048-rollback.bat [--apply] → 退代码 → 启动。 */

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
  const rows = d.prepare('SELECT id, data FROM projects').all() as { id: string; data: string }[];
  const lines: string[] = [];
  const changed: { id: string; data: string }[] = [];
  const kept: string[] = [];
  for (const r of rows) {
    let p: any;
    try { p = JSON.parse(r.data); } catch { continue; }
    let touched = false;
    (p.packages || []).forEach((pk: any, i: number) => {
      const m = pk.mig048;
      if (!m) return;
      const tag = `${p.name || r.id} · ${pk.svc}${pk.label ? ' ' + pk.label : ''} #${i + 1}`;
      const saved = (pk.calendar?.version ?? 0) !== (m.calVersion ?? 0);
      if (m.kind === 'fromRows') {
        if (!saved) { delete pk.calendar; lines.push(`- ${tag}:删掉迁移生成的日历`); }
        else kept.push(`- ${tag}:上线后在日历上保存过,日历留着(阶段行已是新排的)`);
      } else if (m.kind === 'rowsFromCal') {
        if (!saved && Array.isArray(m.prevRows)) { pk.schedule = m.prevRows; lines.push(`- ${tag}:阶段行换回原来的 ${m.prevRows.length} 行`); }
        else kept.push(`- ${tag}:上线后在日历上保存过,阶段行留着`);
      } else if (m.kind === 'conflict') {
        if (!saved && m.prevCalendar) { pk.calendar = m.prevCalendar; lines.push(`- ${tag}:日历换回迁移前那份`); }
        else kept.push(`- ${tag}:上线后在日历上保存过,日历留着(迁移前那份仍在「存档」里)`);
      }
      if (Array.isArray(pk.scheduleLegacy)) {
        pk.scheduleLegacy = pk.scheduleLegacy.filter((x: any) => x.removedAt !== m.at);
        if (!pk.scheduleLegacy.length) delete pk.scheduleLegacy;
      }
      delete pk.mig048;
      touched = true;
    });
    if (touched) { const { updatedAt: _u, version: _v, ...data } = p; changed.push({ id: r.id, data: JSON.stringify(data) }); }
  }
  const prevRow = d.prepare("SELECT value FROM meta WHERE key = 'mig.req048.tplPrev'").get() as { value: string } | undefined;
  const tplPrev: Record<string, string> = prevRow ? JSON.parse(prevRow.value) : {};
  Object.keys(tplPrev).forEach((svc) => lines.push(`- 模板管理「${svc}」的排期换回迁移前那份`));
  const flag = d.prepare("SELECT value FROM meta WHERE key = 'mig.req048.schedule'").get() as { value: string } | undefined;

  console.log(`迁移标记:${flag ? flag.value : '(没有 —— 没迁移过,或已经回退过)'}`);
  console.log(`要还原:${lines.length} 处`);
  console.log(lines.join('\n') || '  (无)');
  if (kept.length) console.log(`\n留着不动(上线后改过):${kept.length} 处\n${kept.join('\n')}`);
  if (!apply) { console.log('\n只报告,没有写库。确认后加 --apply 再跑一次。'); d.close(); return; }

  const bdir = path.join(DATA, 'backups');
  fs.mkdirSync(bdir, { recursive: true });
  const backup = path.join(bdir, `pre-req048-rollback-${stamp}.db`);
  await d.backup(backup);
  const upd = d.prepare('UPDATE projects SET data = ?, version = version + 1 WHERE id = ?');
  d.transaction(() => {
    for (const x of changed) upd.run(x.data, x.id);
    for (const [svc, data] of Object.entries(tplPrev)) d.prepare('UPDATE templates SET data = ? WHERE svc = ?').run(data, svc);
    d.prepare("DELETE FROM meta WHERE key IN ('mig.req048.schedule', 'mig.req048.tplPrev')").run();
  })();
  d.close();
  const mdir = path.join(DATA, 'migrations');
  fs.mkdirSync(mdir, { recursive: true });
  const log = path.join(mdir, `048-schedule-rollback-${stamp}.md`);
  fs.writeFileSync(log, ['# REQ-048 回退:排期迁移还原', '', `时间:${now.toLocaleString('zh-CN')}`, `备份:${backup}`, '',
    '## 还原了', '', ...(lines.length ? lines : ['(无)']), '', '## 留着不动(上线后改过)', '', ...(kept.length ? kept : ['(无)'])].join('\n') + '\n', 'utf8');
  console.log('');
  console.log(`改之前的数据库备份:${backup}`);
  console.log(`改了哪些:${log}`);
}
main().catch((e) => { console.error('回退失败:', e?.message || e); process.exit(1); });
