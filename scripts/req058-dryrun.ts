/* ===== REQ-058 信息清单模板 · 迁移预演(只读,不碰正式数据) =====

   做什么:
     1. 只读打开 data\audax.db,看「模板管理」里 PD / BD 存过哪些业务的模板(templates 表),
        以及同义项有没有单独存过(meta cl.synonyms);
     2. 按上线时的规则算一遍:受这次改动影响的业务(效果图、动画、沙盘、3D VR/720、单元模型,和所有用通用模板的业务)
        覆盖过的,**只把清单部分换成新的**,排期保留覆盖值;存过的同义项把 REQ-058 新加的并进去;
     3. 报告写到 data\migrations\058-templates-dryrun-<时间>.md,逐个列出换之前 / 换之后的分组和项。
        一个都没覆盖过就写「无覆盖,直接生效」。

   **先预演、再正式**:有要改的,正式迁移(新版本启动时)要等 JM 确认过的预演。
   JM 看完报告没问题,再跑一次并加 --approve:重新预演一遍、出报告,然后在正式库里记一笔「已确认」(只写这一笔 meta),
   之后 pm2 restart audax 才会真改。已有项目的清单一个字都不动。
   用法:scripts\req058-dryrun.bat [--approve] [数据库路径]
   规则和上线迁移是同一份代码(src/lib/mig058.ts)。 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { svcName, type Template } from '../src/lib/templates';
import { APPROVE_058, MIG_058, plan058, report058, SYN_KEY } from '../src/lib/mig058';

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

function main() {
  if (!fs.existsSync(SRC_DB)) { console.error(`找不到数据库:${SRC_DB}`); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const d = new Database(SRC_DB, { readonly: true, fileMustExist: true });
  const ran = d.prepare('SELECT value FROM meta WHERE key = ?').get(MIG_058) as { value: string } | undefined;
  if (ran) {
    d.close();
    console.error(`正式迁移已经跑过了(${new Date(JSON.parse(ran.value).at).toLocaleString('zh-CN')}) —— 结果看 data\\migrations\\058-templates-*.md。`);
    process.exit(1);
  }
  const overrides: { svc: string; data: Template }[] = [];
  let all = 0;
  try {
    for (const r of d.prepare('SELECT svc, data FROM templates').all() as { svc: string; data: string }[]) {
      all++;
      try { overrides.push({ svc: r.svc, data: JSON.parse(r.data) as Template }); } catch { /* 坏行不动 */ }
    }
  } catch { /* 老库没有这张表 */ }
  const synRow = d.prepare('SELECT value FROM meta WHERE key = ?').get(SYN_KEY) as { value: string } | undefined;
  let saved: string[][] | null = null;
  if (synRow) { try { saved = JSON.parse(synRow.value); } catch { saved = null; } }
  d.close();

  const plan = plan058(overrides, saved);
  const md = report058(plan, {
    title: 'REQ-058 信息清单模板 · 迁移预演报告', when: now.toLocaleString('zh-CN'),
    db: `数据库:${SRC_DB}(只读打开,没有改)。模板管理里存过的业务:${overrides.map((o) => `${svcName(o.svc, 'zh')}(${o.svc})`).join('、') || '无'}${all > overrides.length ? `;另有 ${all - overrides.length} 行读不出来,不动` : ''}`,
    names: (k) => svcName(k, 'zh'),
  });
  const report = path.join(OUT, `058-templates-dryrun-${stamp}.md`);
  fs.writeFileSync(report, md, 'utf8');
  const none = !plan.templates.length && !plan.synonyms;
  console.log('');
  console.log(none
    ? '预演完成:无覆盖,直接生效(模板管理里没有存过受影响的业务模板,同义项也没有单独存过)。'
    : `预演完成:${plan.templates.length} 个业务模板要换清单(${plan.templates.map((e) => e.svc).join(', ') || '无'}),排期保留;同义项${plan.synonyms ? `要补 ${plan.synonyms.added.length} 个名字` : '不用改'}。`);
  console.log(`报告:${report}`);

  if (!approve) {
    if (!none) {
      console.log('');
      console.log('请 JM 看报告。没问题的话再跑一次:scripts\\req058-dryrun.bat --approve,然后 pm2 restart audax(或 scripts\\update.bat)。');
    }
    return;
  }
  const w = new Database(SRC_DB, { fileMustExist: true });
  w.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(APPROVE_058, JSON.stringify({
    at: now.getTime(), by: os.userInfo().username, report, templates: plan.templates.map((e) => e.svc), synonyms: !!plan.synonyms,
  }));
  w.close();
  console.log('');
  console.log('已在正式库记下「预演已确认」。下一步:pm2 restart audax(新版本已经装好的话),或者跑 scripts\\update.bat。');
  console.log('启动后看 data\\migrations\\058-templates-<时间>.md,内容应和这份预演报告一样。');
}
main();
