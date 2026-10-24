/* ===== REQ-058 回退:模板管理里的覆盖值、同义项换回迁移前那份 =====
   什么时候用:REQ-058 上线后要把**代码**退回去,又不想用更新前的快照覆盖数据库(那样会丢掉上线之后的所有改动)。
   做什么(看 meta 的 templatesLegacy058):
     - 迁移时换过清单的业务模板,整份换回迁移前存的那份(迁移之后 PD 又在模板管理里改过的,这一下也会被换回去,报告里会列出来);
     - 同义项迁移时补过的,换回迁移前那份;
     - 删掉迁移标记和「预演已确认」那一笔 —— 以后重新上线会再预演、再确认、再迁移。templatesLegacy058 留着,方便查。
   已有项目的清单迁移时没动,这里也不动。上线后新建的项目用的是新清单,回退后也照样留着。
   不带参数:只报告会改什么,不写库。加 --apply 才改:先在线备份到 data\backups\pre-req058-rollback-<时间>.db,
   改了什么写到 data\migrations\058-templates-rollback-<时间>.md。
   用法:pm2 stop audax → scripts\req058-rollback.bat [--apply] → 退代码 → 启动。 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { APPROVE_058, LEGACY_058, MIG_058, SYN_KEY } from '../src/lib/mig058';

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
  const mig = d.prepare('SELECT value FROM meta WHERE key = ?').get(MIG_058) as { value: string } | undefined;
  const leg = d.prepare('SELECT value FROM meta WHERE key = ?').get(LEGACY_058) as { value: string } | undefined;
  const legacy = leg ? JSON.parse(leg.value) as { at: number; templates?: Record<string, unknown>; synonyms?: string[][] | null } : null;
  const svcs = Object.keys(legacy?.templates || {});
  const lines: string[] = [];
  const edited: string[] = [];
  for (const svc of svcs) {
    const cur = d.prepare('SELECT updated_at, updated_by FROM templates WHERE svc = ?').get(svc) as { updated_at: number; updated_by: string } | undefined;
    const after = cur && cur.updated_by !== 'REQ-058';
    if (after) edited.push(svc);
    lines.push(`- ${svc}:换回迁移前那份${after ? `(注意:迁移之后 ${cur!.updated_by} 在 ${new Date(cur!.updated_at).toLocaleString('zh-CN')} 又改过,这次改的会被换掉)` : ''}`);
  }
  const synBack = !!legacy && legacy.synonyms !== undefined;
  console.log(`要还原:${svcs.length} 个业务模板${synBack ? ' + 同义项' : ''}${mig ? '' : '(还没迁移过)'}`);
  lines.forEach((l) => console.log(l));
  if (!apply) {
    d.close();
    console.log('');
    console.log('这是预览,没有改库。确认要还原:pm2 stop audax 后跑 scripts\\req058-rollback.bat --apply');
    return;
  }
  const bdir = path.join(DATA, 'backups');
  fs.mkdirSync(bdir, { recursive: true });
  const backup = path.join(bdir, `pre-req058-rollback-${stamp}.db`);
  await d.backup(backup);
  d.transaction(() => {
    const upd = d.prepare('UPDATE templates SET data = ?, updated_at = ?, updated_by = ? WHERE svc = ?');
    for (const svc of svcs) upd.run(JSON.stringify(legacy!.templates![svc]), now.getTime(), 'REQ-058 回退', svc);
    if (synBack) {
      if (legacy!.synonyms) d.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(SYN_KEY, JSON.stringify(legacy!.synonyms));
      else d.prepare('DELETE FROM meta WHERE key = ?').run(SYN_KEY);
    }
    d.prepare('DELETE FROM meta WHERE key IN (?, ?)').run(MIG_058, APPROVE_058);
  })();
  d.close();
  const out = path.join(DATA, 'migrations');
  fs.mkdirSync(out, { recursive: true });
  const report = path.join(out, `058-templates-rollback-${stamp}.md`);
  fs.writeFileSync(report, [
    '# REQ-058 信息清单模板 · 回退报告', '', `- 时间:${now.toLocaleString('zh-CN')}`, `- 回退前备份:${backup}`, '',
    `还原了 ${svcs.length} 个业务模板${synBack ? '和同义项' : ''}:`, '', ...lines, '',
    edited.length ? `迁移之后又改过的:${edited.join(', ')}(那次改的在回退前备份里)。` : '', '',
    '迁移标记和「预演已确认」已删掉;templatesLegacy058 留着。', '',
  ].join('\n'), 'utf8');
  console.log('');
  console.log(`已还原。回退前备份:${backup}`);
  console.log(`报告:${report}`);
}
main().catch((e) => { console.error('回退失败:', e?.message || e); process.exit(1); });
