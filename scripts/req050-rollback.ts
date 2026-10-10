/* ===== REQ-050 回退:把信息清单的「格」拆回旧版本认得的样子 =====

   什么时候用:REQ-050 上线后要把**代码**退回旧版本、又不想用更新前的快照覆盖数据库
   (那样会丢掉上线之后所有的修改)。旧版本不认 cells,不跑这个的话,分了格的项在旧版本里
   只显示第一格的状态,第二块屏那几格的内容和收料记录看不到。

   做什么(--apply 才写库;不带参数只报告会改什么):
     1. 先把 data\audax.db 在线备份到 data\backups\pre-req050-rollback-<时间>.db;
     2. 规格项(每份一格):第一格的内容回到这一项本身;其余每格拆回单独一条,名字后加实例名
        ——「屏幕尺寸与类型(户外 LED)」/「…(#2)」,和 REQ-044 那一版加第二份业务时的样子一样;
     3. 单独填(每个业务一格):第一个业务那格回到这一项本身(只挂这个业务);其余业务各拆成一条,
        名字后加业务名,只挂那个业务 —— 每个业务填的内容都看得到;
     4. 去掉迁移标记(以后再升级会重新合并一次「(#N)」项、重新出报告)。
   不删任何东西:修改记录(history)、迁移前的备份 checklistLegacy050、服务包 id 都原样留着
   (旧版本不认、也不碍事)。上线时合成一条的项目级重复项不拆回去 —— 没被采用的那份在 history 里,
   报告里逐项列出来。

   用法:先 pm2 stop audax(别让网站同时写库),scripts\req050-rollback.bat 看报告,
        确认后 scripts\req050-rollback.bat --apply,然后退代码、启动。 */

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

const SVC_ZH: Record<string, string> = {
  cgi: 'CGI 静帧', ani: '动画', scale: '沙盘模型', led: 'LED', projector: '投影', vrar: '3D VR/720', saleskit: 'Sales Kit', unitmodel: '单元模型',
};
let seq = 0;
const nid = () => 'i' + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);

type Cell = { status: string; date: string; remark: string; received?: string; owner?: string; shots?: string[]; receipts?: unknown[]; highlight?: boolean; updatedAt?: number };
type Item = { id?: string; zh: string; en: string; svcs?: string[]; inst?: string; mode?: string; scope?: string; cells?: Record<string, Cell>; history?: { k: string; text: string; cell?: string }[] } & Partial<Cell>;
type Pkg = { id?: string; svc: string; label?: string };

function splitProject(p: { packages: Pkg[]; checklist?: { group: string; items: Item[] }[] }, notes: string[]): number {
  let n = 0;
  const pkgsOf = (svc: string) => p.packages.filter((x) => x.svc === svc);
  for (const g of p.checklist || []) {
    const out: Item[] = [];
    for (const it of g.items) {
      if (!it.cells) { out.push(it); continue; }
      const entries = Object.entries(it.cells);
      const sep = it.mode === 'sep';
      const [k0, c0] = entries[0];
      const base: Item = { ...it };
      delete base.cells; delete base.mode;
      Object.assign(base, c0);
      if (sep) base.svcs = [k0];
      out.push(base);
      for (const [k, c] of entries.slice(1)) {
        let suffix = '', svcs: string[] = [], inst: string | undefined;
        if (sep) { suffix = SVC_ZH[k] || k; svcs = [k]; }
        else {
          const pk = p.packages.find((x) => x.id === k);
          const svc = pk?.svc || (it.svcs || [])[0] || '';
          const nth = pk ? pkgsOf(svc).indexOf(pk) + 1 : entries.findIndex(([x]) => x === k) + 1;
          inst = pk?.label || `#${nth}`;
          suffix = inst; svcs = [svc];
        }
        const { cells: _c, mode: _m, history: _h, ...rest } = it;
        out.push({ ...rest, ...c, id: nid(), zh: `${it.zh}(${suffix})`, en: it.en ? `${it.en} (${suffix})` : it.en, svcs, ...(inst ? { inst } : {}) });
      }
      n++;
      notes.push(`- ${g.group} / ${it.zh}:${sep ? '单独填' : '规格项'} ${entries.length} 格 → ${entries.length} 条`);
    }
    g.items = out;
  }
  return n;
}

async function main() {
  if (!fs.existsSync(DB)) { console.error(`找不到数据库:${DB}`); process.exit(1); }
  const d = new Database(DB, apply ? {} : { readonly: true });
  const rows = d.prepare('SELECT id, data FROM projects').all() as { id: string; data: string }[];
  const report: string[] = [];
  const changed: { id: string; data: string }[] = [];
  let items = 0, projects = 0, merged = 0, plain = 0;
  for (const r of rows) {
    let p: any;
    try { p = JSON.parse(r.data); } catch { continue; }
    if (!Array.isArray(p.checklist)) continue;
    const notes: string[] = [];
    const n = splitProject(p, notes);
    const hist = (p.checklist as { items: Item[] }[]).flatMap((g) => g.items).flatMap((it) => (it.history || []).filter((h) => h.k === 'mig050.merge').map((h) => `- ${it.zh}:${h.cell || ''} 那份(上线时合成一条,没被采用,只在新版本的修改记录里看得到)`));
    if (!n && !hist.length && !p.mig050) continue;
    projects++; items += n; merged += hist.length;
    if (n || hist.length) report.push(`### ${p.serial ? String(p.serial).padStart(3, '0') + ' · ' : ''}${p.name}`, '', ...notes, ...hist, '');
    else plain++;
    delete p.mig050;
    const { updatedAt: _u, version: _v, ...data } = p;
    changed.push({ id: r.id, data: JSON.stringify(data) });
  }
  const flag = d.prepare("SELECT value FROM meta WHERE key = 'mig.req050.checklist'").get() as { value: string } | undefined;
  const head = [
    `# REQ-050 回退${apply ? '' : '(只报告,没写库)'}`, '',
    `时间:${now.toLocaleString('zh-CN')}`, `数据库:${DB}`, `迁移标记:${flag ? flag.value : '(没有)'}`, '',
    `${projects} 个项目,${items} 项分了格的拆回单独几条;上线时合成一条的项目级重复项 ${merged} 份不拆(在修改记录里,旧版本看不到)。`,
    '修改记录、迁移前的清单备份(checklistLegacy050)、服务包 id 原样留着。',
    ...(plain ? [`另有 ${plain} 个项目没有分格的项,只去掉迁移标记。`] : []), '',
  ];
  const mdir = path.join(DATA, 'migrations');
  fs.mkdirSync(mdir, { recursive: true });
  if (!apply) {
    console.log([...head, ...report].join('\n'));
    console.log('\n只报告,没有写库。确认后加 --apply 再跑一次。');
    d.close();
    return;
  }
  const bdir = path.join(DATA, 'backups');
  fs.mkdirSync(bdir, { recursive: true });
  const backup = path.join(bdir, `pre-req050-rollback-${stamp}.db`);
  await d.backup(backup);
  const upd = d.prepare('UPDATE projects SET data = ?, version = version + 1 WHERE id = ?');
  d.transaction(() => {
    for (const x of changed) upd.run(x.data, x.id);
    d.prepare("DELETE FROM meta WHERE key = 'mig.req050.checklist'").run();
  })();
  d.close();
  const log = path.join(mdir, `050-checklist-rollback-${stamp}.md`);
  fs.writeFileSync(log, [...head, `备份:${backup}`, '', ...report].join('\n') + '\n', 'utf8');
  console.log(`改之前的数据库备份:${backup}`);
  console.log(`改了哪些:${log}`);
}
main().catch((e) => { console.error('回退失败:', e?.message || e); process.exit(1); });
