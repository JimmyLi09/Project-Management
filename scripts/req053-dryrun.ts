/* ===== REQ-053 Job Record 硬件回到登记表 · 迁移预演(只读,不碰正式数据) =====

   做什么:
     1. 用 SQLite 的在线备份把 data\audax.db 复制一份到 data\migrations\053-dryrun-<时间>.db
        (网站开着也能复制,正式库一个字节都不改);
     2. 在这份副本上按上线时的规则处理每个项目的 Job Record:只看硬件业务(LED、投影、TV、MAXHUB、灯箱、AV、
        弱电、光伏,以登记表管理里的分类为准;REQ-059 起 3D VR/720 是软件)——
        删掉 049 拆出来、之后没人改过的 4 栏行和只预填了业务名的空行;改过 / 新加的留下当那一份的「额外项目」;
     3. 自检:软件业务的行、登记表字段 pk.record 一个都没动;
     4. 报告写到 data\migrations\053-jobrecord-dryrun-<时间>.md。

   **先预演、再正式**:正式迁移(新版本启动时)要删行的话,必须先有 JM 确认过的预演。
   JM 看完报告没问题,再跑一次并加 --approve:重新预演一遍、出报告,然后在正式库里记一笔「已确认」
   (只写这一笔 meta,别的不动),之后 pm2 restart audax 才会真跑。
   用法:scripts\req053-dryrun.bat [--approve] [数据库路径]
   规则和上线迁移是同一份代码(src/lib/mig053.ts)。 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { baseDefOf, fieldsOf, type FieldDef, type FieldOverrides } from '../src/lib/records';
import { cleanJobFormats, formatOf, type JobFormatMap } from '../src/lib/jobFormat';
import { SVC } from '../src/lib/templates';
import { migrateProject053, report053, type Mig053Entry } from '../src/lib/mig053';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const pad = (n: number) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const DATA = process.env.AUDAX_DATA_DIR || path.join(process.cwd(), 'data');
const args = process.argv.slice(2);
const approve = args.includes('--approve');
const SRC_DB = args.find((a) => !a.startsWith('--')) || path.join(DATA, 'audax.db');
const OUT = path.join(DATA, 'migrations');
const MIG_053 = 'mig.req053.jobRecord';
const APPROVE_053 = 'mig.req053.approved';

async function main() {
  if (!fs.existsSync(SRC_DB)) { console.error(`找不到数据库:${SRC_DB}`); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const src = new Database(SRC_DB, { readonly: true, fileMustExist: true });
  const ran = src.prepare('SELECT value FROM meta WHERE key = ?').get(MIG_053) as { value: string } | undefined;
  if (ran) {
    src.close();
    console.error(`正式迁移已经跑过了(${new Date(JSON.parse(ran.value).at).toLocaleString('zh-CN')}),现在预演只会显示 0 行 —— 结果看 data\\migrations\\053-jobrecord-*.md。`);
    process.exit(1);
  }
  const copy = path.join(OUT, `053-dryrun-${stamp}.db`);
  await src.backup(copy);   // 在线备份:网站开着也安全,只读打开正式库
  src.close();

  const d = new Database(copy);
  const ov: FieldOverrides = {};
  try {
    for (const r of d.prepare('SELECT svc, fields FROM record_fields').all() as { svc: string; fields: string }[]) {
      try { ov[r.svc] = JSON.parse(r.fields) as FieldDef[]; } catch { /* 坏行忽略 */ }
    }
  } catch { /* 老库没有这张表 */ }
  let fm: JobFormatMap = {};
  try {
    const row = d.prepare("SELECT value FROM meta WHERE key = 'job.formats'").get() as { value: string } | undefined;
    if (row) fm = cleanJobFormats(JSON.parse(row.value), (k) => !!SVC[k]);
  } catch { /* 当默认 */ }
  const hwList = Object.keys(SVC).filter((k) => formatOf(k, fm) === 'hw');

  const rows = d.prepare('SELECT id, data FROM projects ORDER BY created_at ASC').all() as { id: string; data: string }[];
  const upd = d.prepare('UPDATE projects SET data = ? WHERE id = ?');
  const list: Mig053Entry[] = [];
  let noJob = 0;
  d.transaction(() => {
    for (const r of rows) {
      let o: any;
      try { o = JSON.parse(r.data); } catch { continue; }
      if (!Array.isArray(o.packages)) continue;
      if (!Array.isArray(o.jobRecord)) { noJob++; continue; }
      const m = migrateProject053(o, { defsFor: (svc) => fieldsOf(baseDefOf(svc), ov), isHw: (svc) => formatOf(svc, fm) === 'hw', at: now.getTime() });
      if (!m) continue;
      list.push(m);
      const { updatedAt: _u, version: _v, ...data } = o;
      upd.run(JSON.stringify(data), r.id);
    }
  })();
  d.close();
  const led = ov.led && ov.led.find((x) => x.key === 'dimH' && (x.zh === 'Width 宽 (mm)' || x.en === 'Width (mm)'));

  const md = report053(list, {
    title: 'REQ-053 Job Record 硬件回到登记表 · 迁移预演报告',
    when: now.toLocaleString('zh-CN'),
    db: `${SRC_DB}(副本:${copy})· 硬件业务:${hwList.map((k) => SVC[k]?.label || k).join('、')}`,
    ledLabel: led ? 'LED 登记表(增减字段里存过的那一套)的「Width 宽 (mm)」上线时会改名为「Height 高 (mm)」' : '',
  });
  const report = path.join(OUT, `053-jobrecord-dryrun-${stamp}.md`);
  fs.writeFileSync(report, md + (noJob ? `\n另有 ${noJob} 个项目还没有 Job Record 4 栏行(049 还没跑过),硬件字段不会被拆,不用处理。\n` : ''), 'utf8');

  const split = list.reduce((a, m) => a + m.split.length, 0), blank = list.reduce((a, m) => a + m.blank.length, 0);
  const kept = list.reduce((a, m) => a + m.kept.length, 0), bad = list.filter((m) => m.problems.length).length;
  console.log('');
  console.log(`预演完成:${list.length} 个项目有硬件的 4 栏行 —— 删 ${split} 行拆分行 + ${blank} 行空行,留 ${kept} 行当额外项目;自检${bad ? `有 ${bad} 个项目有问题` : '全部通过'}。`);
  console.log(`报告:${report}`);
  console.log(`副本:${copy}(正式库没有动)`);

  if (!approve) {
    console.log('');
    console.log('请 JM 看报告。没问题的话再跑一次:scripts\\req053-dryrun.bat --approve,然后 pm2 restart audax(或 scripts\\update.bat)。');
    return;
  }
  if (bad) { console.error('自检有问题,不能确认 —— 把报告发给开发。'); process.exit(1); }
  const w = new Database(SRC_DB, { fileMustExist: true });
  w.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(APPROVE_053, JSON.stringify({
    at: now.getTime(), by: os.userInfo().username, report, split, blank, kept,
  }));
  w.close();
  console.log('');
  console.log('已在正式库记下「预演已确认」。下一步:pm2 restart audax(新版本已经装好的话),或者跑 scripts\\update.bat。');
  console.log('启动后看 data\\migrations\\053-jobrecord-<时间>.md,数字应和这份预演报告一样。');
}
main().catch((e) => { console.error('预演失败:', e?.message || e); process.exit(1); });
