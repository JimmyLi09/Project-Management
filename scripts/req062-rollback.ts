/* ===== REQ-062 回退:新人培训改版新加的表删掉、新列清空、派项目限制关掉 =====
   什么时候用:REQ-062 上线后要把**代码**退回去,又不想用更新前的快照覆盖数据库(那样会丢掉上线之后的所有改动)。
   旧代码不认识新表新列,不清也能跑;清掉是为了以后重新上线时从干净的状态开始。
   做什么:
     - 删表:tr_config、tr_quiz、tr_tracks、tr_placement、tr_marks、tr_assess、tr_passes、skill_levels、skill_log、tr_attend、tr_promo、kb_reads
     - users.pm_level / mentor / novice_start 清空(列留着,旧代码不读;谁是什么级别、谁带谁,报告里列出来)
     - app_settings 删「assignGate062」(派项目限制),meta 删「req062.pmLevelPrefill」(重新上线时会再按职位预填一次)
   不动:REQ-036 的培训路径、进度、测验成绩(training_paths / training_progress / training_attempts);
   项目里的 trainees(跟项目 / 协助成员)和 capCheckAt 这两个字段留着 —— 旧代码不读它们(跟项目的人会看不到那个项目),报告里列出来。
   不带参数:只报告会清什么,不写库。加 --apply 才改:先在线备份到 data\backups\pre-req062-rollback-<时间>.db,
   清了什么写到 data\migrations\062-training-rollback-<时间>.md。
   用法:pm2 stop audax → scripts\req062-rollback.bat [--apply] → 退代码 → 启动。 */
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
const TABLES = ['tr_config', 'tr_quiz', 'tr_tracks', 'tr_placement', 'tr_marks', 'tr_assess', 'tr_passes', 'skill_levels', 'skill_log', 'tr_attend', 'tr_promo', 'kb_reads'];
const LV = ['未学', '了解', '可协助', '可独立', '可带教'];

type Db = { prepare: (s: string) => { all: (...a: unknown[]) => unknown[]; get: (...a: unknown[]) => unknown; run: (...a: unknown[]) => unknown }; exec: (s: string) => void };
const hasTable = (d: Db, t: string) => !!d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
const hasCol = (d: Db, t: string, c: string) => (d.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).some((x) => x.name === c);

async function main() {
  if (!fs.existsSync(DB)) { console.error(`找不到数据库:${DB}`); process.exit(1); }
  const d = new Database(DB, apply ? {} : { readonly: true });
  const lines: string[] = [];
  for (const t of TABLES) {
    if (!hasTable(d, t)) { lines.push(`- ${t}:没有这张表`); continue; }
    lines.push(`- 删表 ${t}:${(d.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n} 行`);
  }
  const userCols = ['pm_level', 'mentor', 'novice_start'].filter((c) => hasCol(d, 'users', c));
  const people = userCols.length === 3
    ? d.prepare("SELECT name, pm_level, mentor, novice_start FROM users WHERE pm_level != '' OR mentor != '' OR novice_start IS NOT NULL ORDER BY id").all() as { name: string; pm_level: string; mentor: string; novice_start: number | null }[] : [];
  lines.push(userCols.length ? `- 清空 users.${userCols.join(' / ')}:${people.length} 人有值` : '- users 没有 REQ-062 的列');
  const gate = (d.prepare("SELECT value FROM app_settings WHERE key = 'assignGate062'").get() as { value: string } | undefined)?.value;
  lines.push(`- 删设置「派项目限制」(现在是${gate === '1' ? '打开' : '关闭'})`);
  const levels = hasTable(d, 'skill_levels') ? d.prepare('SELECT user, biz, level, source FROM skill_levels ORDER BY user, biz').all() as { user: string; biz: string; level: number; source: string }[] : [];
  const projects = d.prepare('SELECT id, data FROM projects').all() as { id: string; data: string }[];
  const trainees: string[] = [];
  for (const p of projects) {
    try {
      const o = JSON.parse(p.data) as { name?: string; trainees?: { name: string; mode: string }[] };
      if (o.trainees?.length) trainees.push(`${o.name || p.id}:${o.trainees.map((x) => `${x.name}(${x.mode === 'assist' ? '协助' : '跟项目'})`).join('、')}`);
    } catch { /* 坏行跳过 */ }
  }
  const legacy = ['training_paths', 'training_progress', 'training_attempts'].filter((t) => hasTable(d, t)).map((t) => `${t} ${(d.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n} 行`);

  console.log(`REQ-062 回退 · 数据库 ${DB}`);
  lines.forEach((l) => console.log(l));
  console.log(`- 不动:REQ-036 的老培训(${legacy.join('、') || '无'});项目里的跟项目 / 协助成员 ${trainees.length} 个项目(字段留着)`);
  if (!apply) {
    d.close();
    console.log('');
    console.log('这是预览,没有改库。确认要回退:pm2 stop audax 后跑 scripts\\req062-rollback.bat --apply');
    return;
  }
  const bdir = path.join(DATA, 'backups');
  fs.mkdirSync(bdir, { recursive: true });
  const backup = path.join(bdir, `pre-req062-rollback-${stamp}.db`);
  await d.backup(backup);
  d.transaction(() => {
    for (const t of TABLES) d.exec(`DROP TABLE IF EXISTS ${t}`);
    if (userCols.length === 3) d.prepare("UPDATE users SET pm_level = '', mentor = '', novice_start = NULL WHERE pm_level != '' OR mentor != '' OR novice_start IS NOT NULL").run();
    d.prepare("DELETE FROM app_settings WHERE key = 'assignGate062'").run();
    d.prepare("DELETE FROM meta WHERE key IN ('req062.pmLevelPrefill', 'req062.seeded')").run();
  })();
  d.close();
  const out = path.join(DATA, 'migrations');
  fs.mkdirSync(out, { recursive: true });
  const report = path.join(out, `062-training-rollback-${stamp}.md`);
  fs.writeFileSync(report, [
    '# REQ-062 新人培训改版 · 回退报告', '', `- 时间:${now.toLocaleString('zh-CN')}`, `- 数据库:${DB}`, `- 回退前备份:${backup}`, '',
    '## 清掉的', '', ...lines, '',
    '## 原来的 PM 级别、带教人、新人期', '',
    people.length ? '| 姓名 | PM 级别 | 带教人 | 新人期开始 |\n|---|---|---|---|\n' + people.map((p) => `| ${p.name} | ${p.pm_level || ''} | ${p.mentor || ''} | ${p.novice_start ? new Date(p.novice_start).toLocaleDateString('zh-CN') : ''} |`).join('\n') : '(没有)', '',
    '## 原来的能力矩阵', '',
    levels.length ? '| 姓名 | 业务 | 级别 | 来源 |\n|---|---|---|---|\n' + levels.map((l) => `| ${l.user} | ${l.biz} | ${LV[l.level] || l.level} | ${l.source} |`).join('\n') : '(没有)', '',
    '## 没动的', '',
    `- REQ-036 的老培训:${legacy.join('、') || '无'}。`,
    `- 项目里的跟项目 / 协助成员(trainees)和 capCheckAt 字段留着,旧代码不读(跟项目的人回退后看不到那个项目):${trainees.length ? '' : '无'}`,
    ...trainees.map((x) => `  - ${x}`), '',
  ].join('\n'), 'utf8');
  console.log('');
  console.log(`已回退。回退前备份:${backup}`);
  console.log(`报告:${report}`);
}
main().catch((e) => { console.error('回退失败:', e?.message || e); process.exit(1); });
