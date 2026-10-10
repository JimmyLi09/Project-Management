/* ===== REQ-050 信息清单不重复 · 迁移预演(只读,不碰正式数据库) =====

   做什么:
     1. 用 SQLite 的在线备份把 data\audax.db 复制一份到 data\migrations\050-dryrun-<时间>.db
        (网站开着也能复制,正式库一个字节都不改);
     2. 在这份副本上按上线时的规则处理每个项目的信息清单:
        「名字(#2)」这类重复项和原项合成一行 —— 规格项(屏幕尺寸、铁架、放置位置……)同一行里
        每份业务一格(LED-1 / LED-2);项目级的项(地址、图纸、时间节点……)只留一条,
        保留状态最靠后的那一份,其余几份原样记进这一项的修改记录;
     3. 自检:每一项都有去处、没有被降级、收料记录和参考图一条不少;
     4. 报告写到 data\migrations\050-checklist-dryrun-<时间>.md,最后附「规格项默认值」给 PD 复核。

   规则和上线迁移用的是同一份代码(src/lib/mig050.ts、src/lib/checklistScope.ts)。
   用法:scripts\req050-dryrun.bat(或 node --import ./scripts/ts-register.mjs scripts/req050-dryrun.ts [数据库路径]) */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { migrate } from '../src/lib/project';
import { svcName, TPL, type Template } from '../src/lib/templates';
import { DEFAULT_SYNONYMS, setSynonyms } from '../src/lib/checklistMerge';
import { scopeOf, tplNamesFrom } from '../src/lib/checklistScope';
import { migrateProject050, report050, type Mig050Entry } from '../src/lib/mig050';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const pad = (n: number) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const DATA = process.env.AUDAX_DATA_DIR || path.join(process.cwd(), 'data');
const SRC_DB = process.argv[2] || path.join(DATA, 'audax.db');
const OUT = path.join(DATA, 'migrations');

async function main() {
  if (!fs.existsSync(SRC_DB)) { console.error(`找不到数据库:${SRC_DB}`); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const copy = path.join(OUT, `050-dryrun-${stamp}.db`);
  const src = new Database(SRC_DB, { readonly: true, fileMustExist: true });
  await src.backup(copy);   // 在线备份:网站开着也安全,只读打开正式库
  src.close();

  const d = new Database(copy);
  const syn = (() => {
    try {
      const row = d.prepare("SELECT value FROM meta WHERE key = 'cl.synonyms'").get() as { value: string } | undefined;
      const v = row ? JSON.parse(row.value) : null;
      return Array.isArray(v) ? (v as string[][]) : DEFAULT_SYNONYMS;
    } catch { return DEFAULT_SYNONYMS; }
  })();
  setSynonyms(syn);
  /* 模板管理里 PD 存过的模板:模板里有、规格项表里没有的项算项目级 */
  const saved: Record<string, Template> = {};
  try {
    for (const r of d.prepare('SELECT svc, data FROM templates').all() as { svc: string; data: string }[]) {
      try { saved[r.svc] = JSON.parse(r.data) as Template; } catch { /* 坏行忽略 */ }
    }
  } catch { /* 老库没有这张表 */ }
  const tplNames = tplNamesFrom(saved);

  const rows = d.prepare('SELECT id, data FROM projects ORDER BY created_at ASC').all() as { id: string; data: string }[];
  const upd = d.prepare('UPDATE projects SET data = ? WHERE id = ?');
  const list: Mig050Entry[] = [];
  let skipped = 0, broken = 0;
  d.transaction(() => {
    for (const r of rows) {
      let o: any;
      try { o = JSON.parse(r.data); } catch { broken++; continue; }
      const p = migrate(o) as any;   // 和网站读项目时同样的规整(补 id、老结构的清单先合成一张)
      const m = migrateProject050(p, { tplNames, synonyms: syn, at: now.getTime() });
      if (!m) { skipped++; continue; }
      list.push(m);
      const { updatedAt: _u, version: _v, ...data } = p;
      upd.run(JSON.stringify(data), r.id);
    }
  })();
  d.close();

  /* 规格项默认值:出厂模板 + PD 存过的模板,每个业务列出规格项 / 项目级;项目里手加的项按名字猜的另列 */
  const scopeTable: string[] = [
    '同一业务加第二份时,**规格项**在同一行里多一格(LED-1 / LED-2),**项目级**的项不多。下面是开发按现有模板整理的默认值,上线后可以在模板管理里改。',
    '',
    '| 业务 | 规格项(每份一格) | 项目级(整个项目一条) |',
    '|---|---|---|',
  ];
  const svcs = [...new Set([...Object.keys(TPL), ...Object.keys(saved)])];
  for (const svc of svcs) {
    const t = saved[svc] || TPL[svc];
    const names = (t?.checklist || []).flatMap((g) => (g[3] || []).map((it) => ({ zh: it[0], en: it[1] })));
    if (!names.length) continue;
    const inst = names.filter((n) => scopeOf(n, [svc], tplNames).scope === 'inst').map((n) => n.zh);
    const proj = names.filter((n) => scopeOf(n, [svc], tplNames).scope === 'proj').map((n) => n.zh);
    scopeTable.push(`| ${svcName(svc, 'zh')}${saved[svc] ? '(PD 改过的模板)' : ''} | ${inst.join('、') || '—'} | ${proj.join('、') || '—'} |`);
  }
  scopeTable.push('| 其它业务(通用模板) | 需求 / 规格 | 素材 / 参考、截止日 |');
  const guessed = new Map<string, string>();
  list.forEach((m) => m.families.filter((f) => f.why === 'hint' || f.why === 'default').forEach((f) => guessed.set(`${svcName(f.svc, 'zh')} · ${f.name}`, f.scope === 'inst' ? '规格项' : '项目级')));
  if (guessed.size) {
    scopeTable.push('', '项目里手加的项(模板里没有)按名字猜的:', '');
    [...guessed].forEach(([k, v]) => scopeTable.push(`- ${k} → ${v}`));
  }

  const md = report050(list, {
    title: 'REQ-050 信息清单不重复 · 迁移预演报告',
    when: now.toLocaleString('zh-CN'),
    db: `${SRC_DB}(副本:${copy})`,
    skipped, broken, scopeTable,
  });
  const report = path.join(OUT, `050-checklist-dryrun-${stamp}.md`);
  fs.writeFileSync(report, md + '\n', 'utf8');

  const touched = list.filter((m) => m.families.length || m.blank.length || m.unresolved.length).length;
  const bad = list.filter((m) => m.problems.length).length;
  const lost = list.filter((m) => m.receiptsAfter < m.receiptsBefore).length;
  console.log('');
  console.log(`预演完成:看了 ${list.length} 个项目,其中 ${touched} 个有「(#N)」重复项或要分格;自检${bad || lost ? `有 ${bad + lost} 个项目有问题` : '全部通过'}。`);
  console.log(`报告:${report}`);
  console.log(`副本:${copy}(正式库没有动)`);
}
main().catch((e) => { console.error('预演失败:', e?.message || e); process.exit(1); });
