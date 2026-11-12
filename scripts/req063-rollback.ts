/* ===== REQ-063 回退:KPI 看板补充 + 项目修改记录 =====
   什么时候用:REQ-063 上线后要把**代码**退回去,又不想用更新前的快照覆盖数据库(那样会丢掉上线之后的所有改动)。
   REQ-063 没有加表、没有加列,只在这几处写了新东西 —— 旧代码都不认识,不清也能照常跑:
     - 项目的服务包上:revisions(修改记录)、reasonMeeting(已开原因会)
     - app_settings:req063Since(修改记录上线日)
     - KPI 规则版本(kpi_rules)里:两个新维度、级别区间、修改轮次规则、三个数的目标 —— 旧代码读的时候自动忽略
   做什么:
     不带参数:只报告,不写库。
     --apply:先在线备份到 data\backups\pre-req063-rollback-<时间>.db,然后删 app_settings 的 req063Since
              (重新上线时会把重新上线那天记成上线日 —— 报告里写了原来的日期,上线后可在「规则设置 · KPI 规则」改回去);
              修改记录全部写进报告(data\migrations\063-revisions-rollback-<时间>.md)和一份 JSON(同名 .json),
              **项目里的修改记录字段留着**(旧代码不读;重新上线后接着用)。
     --apply --strip:另外把项目里的 revisions / reasonMeeting 两个字段去掉(内容已在报告和 JSON 里)。只动这两个字段,项目其他内容一字不改。
   KPI 规则版本一律不动(删了历史周期的分就变了)。
   用法:pm2 stop audax → scripts\req063-rollback.bat [--apply [--strip]] → 退代码 → 启动。 */
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
const strip = apply && args.includes('--strip');
const DB = args.find((a) => !a.startsWith('--')) || path.join(DATA, 'audax.db');
const SINCE_KEY = 'req063Since';
const FEE: Record<string, string> = { free: '免费', due: '待 Sales 报价', quoted: '已出报价', confirmed: '客户已确认', waived: 'PD 批准免收' };

type Rev = { id: string; src: string; date: string; note: string; fee?: string; by: string; at: number; waiveReason?: string };
type Pkg = { svc: string; label?: string; revisions?: Rev[]; reasonMeeting?: { at: number; by: string; note: string; rounds: number } };
type Proj = { id?: string; name?: string; packages?: Pkg[] };

async function main() {
  if (!fs.existsSync(DB)) { console.error(`找不到数据库:${DB}`); process.exit(1); }
  const d = new Database(DB, apply ? {} : { readonly: true });
  const since = (d.prepare('SELECT value FROM app_settings WHERE key = ?').get(SINCE_KEY) as { value: string } | undefined)?.value || '';
  const rows = d.prepare('SELECT id, data FROM projects').all() as { id: string; data: string }[];
  const revRows: string[] = [];
  const meetRows: string[] = [];
  const dump: { id: string; name: string; pkg: number; svc: string; revisions?: Rev[]; reasonMeeting?: Pkg['reasonMeeting'] }[] = [];
  const touched: { id: string; data: string }[] = [];
  let nRev = 0, nMeet = 0;
  for (const r of rows) {
    let p: Proj;
    try { p = JSON.parse(r.data) as Proj; } catch { continue; }
    let has = false;
    (p.packages || []).forEach((pk, pi) => {
      if (!pk.revisions?.length && !pk.reasonMeeting) return;
      has = true;
      dump.push({ id: r.id, name: p.name || r.id, pkg: pi, svc: pk.svc, revisions: pk.revisions, reasonMeeting: pk.reasonMeeting });
      let n = 0;
      for (const x of pk.revisions || []) {
        nRev++;
        const round = x.src === 'client' ? `R${++n}` : '内部';
        revRows.push(`| ${p.name || r.id} | ${pk.svc}${pk.label ? ` · ${pk.label}` : ''} | ${round} | ${x.date} | ${(x.note || '').replace(/\|/g, '/').replace(/\n/g, ' ')} | ${x.fee ? FEE[x.fee] || x.fee : ''}${x.waiveReason ? `(${x.waiveReason})` : ''} | ${x.by} |`);
      }
      if (pk.reasonMeeting) { nMeet++; meetRows.push(`| ${p.name || r.id} | ${pk.svc} | ${pk.reasonMeeting.rounds} | ${pk.reasonMeeting.note} | ${pk.reasonMeeting.by} | ${new Date(pk.reasonMeeting.at).toLocaleDateString('zh-CN')} |`); }
      if (strip) { delete pk.revisions; delete pk.reasonMeeting; }
    });
    if (has && strip) touched.push({ id: r.id, data: JSON.stringify(p) });
  }
  const kpiVers = (d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'kpi_rules'").get()
    ? d.prepare('SELECT version, rules, effective_from FROM kpi_rules ORDER BY version').all() as { version: number; rules: string; effective_from: string }[] : []);
  const newOn = kpiVers.filter((v) => {
    try { return (JSON.parse(v.rules).sets || []).some((s: { dims?: Record<string, { on?: boolean; weight?: number }> }) => ['revRounds', 'revRecover'].some((k) => s.dims?.[k]?.on && (s.dims[k].weight || 0) > 0)); } catch { return false; }
  }).map((v) => `v${v.version}(${v.effective_from || '不限'} 起)`);

  const lines = [
    `- 修改记录上线日(app_settings ${SINCE_KEY}):${since || '(没有)'}${apply ? ' → 删除' : ''}`,
    `- 项目里的修改记录:${dump.length} 个服务包、${nRev} 条;已开原因会 ${nMeet} 个服务包${strip ? ' → 字段去掉(内容在报告和 JSON 里)' : ' → 字段留着(旧代码不读)'}`,
    `- KPI 规则版本:${kpiVers.length} 版,不动;其中打开了新维度的:${newOn.join('、') || '无'}(旧代码读这些版本时自动忽略新维度 —— 回退后这些版本里的总分只按原来四维算)`,
  ];
  console.log(`REQ-063 回退 · 数据库 ${DB}`);
  lines.forEach((l) => console.log(l));
  if (!apply) {
    d.close();
    console.log('');
    console.log('这是预览,没有改库。确认要回退:pm2 stop audax 后跑 scripts\\req063-rollback.bat --apply(要连修改记录字段一起去掉加 --strip)');
    return;
  }
  const bdir = path.join(DATA, 'backups');
  fs.mkdirSync(bdir, { recursive: true });
  const backup = path.join(bdir, `pre-req063-rollback-${stamp}.db`);
  await d.backup(backup);
  d.transaction(() => {
    d.prepare('DELETE FROM app_settings WHERE key = ?').run(SINCE_KEY);
    const up = d.prepare('UPDATE projects SET data = ? WHERE id = ?');
    for (const t of touched) up.run(t.data, t.id);
  })();
  d.close();
  const out = path.join(DATA, 'migrations');
  fs.mkdirSync(out, { recursive: true });
  const report = path.join(out, `063-revisions-rollback-${stamp}.md`);
  const json = path.join(out, `063-revisions-rollback-${stamp}.json`);
  fs.writeFileSync(json, JSON.stringify({ since, packages: dump }, null, 2), 'utf8');
  fs.writeFileSync(report, [
    '# REQ-063 KPI 看板补充 + 项目修改记录 · 回退报告', '', `- 时间:${now.toLocaleString('zh-CN')}`, `- 数据库:${DB}`, `- 回退前备份:${backup}`, `- 修改记录原样(JSON):${json}`, '',
    '## 做了什么', '', ...lines, '',
    `重新上线时会把重新上线那天记成上线日;要沿用原来的 **${since || '(没有)'}**,上线后在「规则设置 · KPI 规则 · 修改记录上线日」改回去。`,
    strip ? '项目里的修改记录字段已去掉;重新上线后要恢复,用上面的 JSON(按项目 id + 服务包序号放回 packages[i].revisions / reasonMeeting)。'
      : '项目里的修改记录字段留着:旧代码不读也不改它们(回退期间「复制项目」会把它们一起复制过去 —— 重新上线后在副本上删掉即可)。', '',
    '## 修改记录', '',
    revRows.length ? '| 项目 | 服务包 | 轮次 | 日期 | 修改内容 | 收费 | 记录人 |\n|---|---|---|---|---|---|---|\n' + revRows.join('\n') : '(没有)', '',
    '## 已开原因会', '',
    meetRows.length ? '| 项目 | 服务包 | 当时轮数 | 结论 | 登记人 | 日期 |\n|---|---|---|---|---|---|\n' + meetRows.join('\n') : '(没有)', '',
  ].join('\n'), 'utf8');
  console.log('');
  console.log(`已回退。回退前备份:${backup}`);
  console.log(`报告:${report}`);
}
main().catch((e) => { console.error('回退失败:', e?.message || e); process.exit(1); });
