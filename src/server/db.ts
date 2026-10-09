import { remapContactRoles, toRoleKey } from '@/lib/contactRoles';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Project, Role, User } from '@/lib/types';
import { migrate } from '@/lib/project';
import { getBuiltinTemplate, SVC, type Template } from '@/lib/templates';
import { applyProjField, projSourceOf } from '@/lib/records';
import { logZh, type LogParams } from '@/lib/logmsg';
import { cleanSynonyms, DEFAULT_SYNONYMS, getSynonyms, migrationReport, setSynonyms, type ProjectMigration } from '@/lib/checklistMerge';
import { defaultPermTable, permDiff, sanitizePermTable, setServerPermSource, type PermTable } from '@/lib/permTable';
import { handOverWork, renameInProject } from '@/lib/peopleRefs';
import { migrateProject048, type Mig048Entry } from '@/lib/mig048';
import { isLegacyFlow } from '@/lib/legacyStages';
import { TPL } from '@/lib/templates';

/* On serverless platforms (Vercel) the project directory is read-only and
   ephemeral — keep the demo database in /tmp there. */
const DATA_DIR =
  process.env.AUDAX_DATA_DIR ||
  (process.env.VERCEL ? '/tmp/audax-data' : path.join(process.cwd(), 'data'));

let db: Database.Database | null = null;

/* Where uploads that live beside the database go (AV-015 judged images). */
export const dataDir = () => DATA_DIR;

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(path.join(DATA_DIR, 'audax.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS templates (
      svc TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      at INTEGER NOT NULL,
      by TEXT NOT NULL,
      text TEXT NOT NULL,
      k TEXT,
      p TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_log(project_id, at DESC);
    /* v2.2 §4.4 [P0-1]: idempotency ledger — one row per (project, action,
       workflow version). The UNIQUE constraint blocks duplicate submissions. */
    CREATE TABLE IF NOT EXISTS workflow_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      workflow_version INTEGER NOT NULL,
      actor_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      UNIQUE(project_id, action_type, workflow_version)
    );
  `);
  migrateSchema(db);
  seedIfEmpty(db);
  maybeSeedDemo(db);
  loadSynonyms(db);
  migrateSharedChecklist(db);   // REQ-044:要在 backfillIds 之前 —— 它读项目时也会顺手合并,那样就没有报告了
  backfillIds(db);
  backfillSerials(db);
  migrateInvoiceArchive(db);
  migrateContactRoles(db);
  migrateSchedules048(db);
  scheduleBackups(db);
  return db;
}

/* One-time pass so migrate()'s freshly-assigned item/row ids get persisted;
   otherwise every read would mint new random ids and break stable React keys
   (edit mode would drop on the 30s poll). Runs cheaply — only saves rows that
   actually gained ids. */
let idsBackfilled = false;
function backfillIds(d: Database.Database) {
  if (idsBackfilled) return;
  idsBackfilled = true;
  const rows = d.prepare('SELECT id, data FROM projects').all() as { id: string; data: string }[];
  const upd = d.prepare('UPDATE projects SET data = ? WHERE id = ?');
  for (const r of rows) {
    let obj: any;
    try { obj = JSON.parse(r.data); } catch { continue; }
    const badItem = (it: any) => !it.id || it.shot !== undefined || !Array.isArray(it.shots) || (Array.isArray(obj.checklist) && !Array.isArray(it.svcs));
    const need = (obj.packages || []).some((pk: any) =>
      (pk.schedule || []).some((x: any) => !x.id) ||
      (pk.checklist || []).some((g: any) => (g.items || []).some(badItem)))
      /* REQ-044: 项目上的共用清单也一样 —— 按 id 定位的动作要求 id 稳定 */
      || (obj.checklist || []).some((g: any) => (g.items || []).some(badItem));
    if (!need) continue;
    const m = migrate(obj);
    const { updatedAt: _drop, ...data } = m as any;
    upd.run(JSON.stringify(data), r.id);
  }
}

/* REQ-006: assign a sequential project NO. to any project missing one, in
   creation order, continuing from the current max. Runs once at startup. */
let serialsBackfilled = false;
function backfillSerials(d: Database.Database) {
  if (serialsBackfilled) return;
  serialsBackfilled = true;
  const rows = d.prepare('SELECT id, data FROM projects ORDER BY created_at ASC').all() as { id: string; data: string }[];
  const parsed: { id: string; o: any }[] = [];
  let max = 0;
  for (const r of rows) {
    let o: any;
    try { o = JSON.parse(r.data); } catch { continue; }
    parsed.push({ id: r.id, o });
    if (typeof o.serial === 'number' && o.serial > max) max = o.serial;
  }
  const upd = d.prepare('UPDATE projects SET data = ? WHERE id = ?');
  for (const { id, o } of parsed) {
    if (typeof o.serial === 'number' && o.serial > 0) continue;
    o.serial = ++max;
    const { updatedAt: _u, version: _v, ...data } = o;
    upd.run(JSON.stringify(data), id);
  }
}

/* REQ-045 上线时一次性整理(meta 里记一笔,只跑一次 —— 之后 PD / BD 手动取消归档的
   不会被再归回去):已开票(invoiceStatus=issued)且有 Invoice 号、还没归档的项目 →
   自动归档,原因 invoiced,每个项目写一条日志。只标了旧「已开票」没有号的不动,
   由项目列表顶部的「缺 Invoice 号」清单交给 PD / BD 补。不删任何数据。 */
const MIG_045 = 'mig.req045.invoiceArchive';
function migrateInvoiceArchive(d: Database.Database) {
  if (d.prepare('SELECT 1 FROM meta WHERE key = ?').get(MIG_045)) return;
  const rows = d.prepare('SELECT id, data FROM projects').all() as { id: string; data: string }[];
  const upd = d.prepare('UPDATE projects SET data = ?, updated_at = ?, version = version + 1 WHERE id = ?');
  const audit = d.prepare('INSERT INTO audit_log (project_id, at, by, text, k, p) VALUES (?, ?, ?, ?, ?, ?)');
  const now = Date.now();
  const done: string[] = [];
  d.transaction(() => {
    for (const r of rows) {
      let o: any;
      try { o = JSON.parse(r.data); } catch { continue; }
      const inv = o.invoiceClose;
      const ref = String(inv?.invoiceRef || '').trim();
      if (o.archived || inv?.invoiceStatus !== 'issued' || !ref) continue;
      o.archived = true;
      o.archivedAt = now;
      o.archivedBy = '系统';
      o.archiveReason = 'invoiced';
      o.invoiced = true;
      const k = 'proj.invoiceArchiveMig', params = { ref };
      o.log = Array.isArray(o.log) ? o.log : [];
      o.log.unshift({ at: now, by: '系统', text: logZh(k, params), k, p: params });
      if (o.log.length > 200) o.log.length = 200;
      const { updatedAt: _u, version: _v, ...data } = o;
      upd.run(JSON.stringify(data), now, r.id);
      audit.run(r.id, now, '系统', logZh(k, params), k, JSON.stringify(params));
      done.push(`${o.name || r.id} (${ref})`);
    }
    d.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(MIG_045, JSON.stringify({ at: now, archived: done.length }));
  })();
  if (done.length) console.log(`[REQ-045] 已开 Invoice 的项目自动归档 ${done.length} 个:${done.join('、')}`);
}

/* ===== REQ-052 联系人角色改存键 =====
   上线时一次性:「客户 Client」→ developer(界面显示「发展商 / Developer」),
   「总包 Main-con」「总包 Main Con」→ 同一个 maincon,其它固定角色也换成键。手填的不动。
   meta 记一笔只跑一次;改了哪些写到 data/migrations/052-contact-roles-<时间>.md。
   回退:scripts/req052-rollback.bat(键 → 旧标签)。 */
const MIG_052 = 'mig.req052.contactRoles';
function migrateContactRoles(d: Database.Database) {
  if (d.prepare('SELECT 1 FROM meta WHERE key = ?').get(MIG_052)) return;
  const rows = d.prepare('SELECT id, data FROM projects').all() as { id: string; data: string }[];
  const upd = d.prepare('UPDATE projects SET data = ?, updated_at = ?, version = version + 1 WHERE id = ?');
  const now = Date.now();
  const done: { name: string; changes: { from: string; to: string }[] }[] = [];
  d.transaction(() => {
    for (const r of rows) {
      let o: any;
      try { o = JSON.parse(r.data); } catch { continue; }
      const changes = remapContactRoles(o.contacts, toRoleKey);
      if (!changes.length) continue;
      const { updatedAt: _u, version: _v, ...data } = o;
      upd.run(JSON.stringify(data), now, r.id);
      done.push({ name: o.name || r.id, changes });
    }
    d.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(MIG_052, JSON.stringify({ at: now, projects: done.length, contacts: done.reduce((a, x) => a + x.changes.length, 0) }));
  })();
  if (!done.length) return;
  try {
    const dir = path.join(DATA_DIR, 'migrations');
    fs.mkdirSync(dir, { recursive: true });
    const t = new Date(now), pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}`;
    const file = path.join(dir, `052-contact-roles-${stamp}.md`);
    const lines = ['# REQ-052 联系人角色改存键 · 上线迁移报告', '', `时间:${t.toLocaleString('zh-CN')}`, '',
      `共 ${done.length} 个项目、${done.reduce((a, x) => a + x.changes.length, 0)} 条联系人。「客户 Client」→ developer(显示「发展商」);两种「总包」写法 → maincon。手填的角色没动。`, '',
      '回退:先 pm2 stop audax,再跑 scripts\\req052-rollback.bat。', '',
      ...done.map((x) => `- ${x.name}:${x.changes.map((c) => `${c.from} → ${c.to}`).join('、')}`)];
    fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
    console.log(`[REQ-052] 联系人角色改存键:${done.length} 个项目,报告 ${file}`);
  } catch (e) {
    console.warn('[REQ-052] 迁移报告没写成(数据已迁移,不影响使用):', e);
  }
}

/* ===== REQ-048 每个业务一份日历(阶段 = 阶段行)· 上线迁移 =====
   规则见 lib/mig048.ts。先把整个库备份一份(VACUUM INTO,同步、在线安全),再在一个事务里改,
   最后出报告。模板管理里 CGI / 动画的排期如果还是某一版老出厂模板的原样,换成新的默认阶段
   (改过的不动,报告里提一句);原来那份存在 meta 的 mig.req048.tplPrev,回退脚本用。 */
const MIG_048 = 'mig.req048.schedule';
function migrateSchedules048(d: Database.Database) {
  if (d.prepare('SELECT 1 FROM meta WHERE key = ?').get(MIG_048)) return;
  const rows = d.prepare('SELECT id, data FROM projects').all() as { id: string; data: string }[];
  const tpls = d.prepare("SELECT svc, data FROM templates WHERE svc IN ('cgi', 'ani')").all() as { svc: string; data: string }[];
  const now = Date.now();
  const t = new Date(now), pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}`;
  let backup = '';
  if (rows.length || tpls.length) {
    try {
      const dir = path.join(DATA_DIR, 'backups');
      fs.mkdirSync(dir, { recursive: true });
      backup = path.join(dir, `pre-req048-${stamp}.db`);
      d.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    } catch (e) {
      /* 备份不成就不迁移 —— 下次启动再试(读项目时有兜底,页面照样能用) */
      console.warn('[REQ-048] 迁移前备份失败,这次不迁移:', e);
      return;
    }
  }
  const upd = d.prepare('UPDATE projects SET data = ?, updated_at = ?, version = version + 1 WHERE id = ?');
  const done: Mig048Entry[] = [];
  const tplNotes: string[] = [];
  const tplPrev: Record<string, string> = {};
  d.transaction(() => {
    for (const r of rows) {
      let o: any;
      try { o = JSON.parse(r.data); } catch { continue; }
      if (!Array.isArray(o.packages)) continue;   // 更老的结构:读的时候 migrate() 会补
      const got = migrateProject048(o, now, () => crypto.randomBytes(6).toString('hex'));
      if (!got.length) continue;
      const { updatedAt: _u, version: _v, ...data } = o;
      upd.run(JSON.stringify(data), now, r.id);
      done.push(...got);
    }
    for (const x of tpls) {
      let tpl: Template;
      try { tpl = JSON.parse(x.data) as Template; } catch { continue; }
      const names = (tpl.schedule || []).map((row) => String(row[2] || ''));
      if (isLegacyFlow(x.svc, names)) {
        tplPrev[x.svc] = x.data;
        d.prepare('UPDATE templates SET data = ?, updated_at = ?, updated_by = ? WHERE svc = ?')
          .run(JSON.stringify({ ...tpl, schedule: TPL[x.svc].schedule }), now, 'REQ-048', x.svc);
        tplNotes.push(`- 模板管理「${SVC[x.svc]?.label || x.svc}」的排期是老出厂模板原样,换成新的默认阶段(信息清单没动)。`);
      } else {
        tplNotes.push(`- 模板管理「${SVC[x.svc]?.label || x.svc}」的排期改过,**没动**;要用新默认阶段,在模板管理点「恢复默认」。`);
      }
    }
    if (Object.keys(tplPrev).length) d.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('mig.req048.tplPrev', JSON.stringify(tplPrev));
    const n = (k: Mig048Entry['kind']) => done.filter((x) => x.kind === k).length;
    d.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(MIG_048, JSON.stringify({
      at: now, backup, packages: done.length, fromRows: n('fromRows'), rowsFromCal: n('rowsFromCal'), conflict: n('conflict'),
      adjusted: done.reduce((a, x) => a + x.adjusted, 0), templates: Object.keys(tplPrev),
    }));
  })();
  if (!done.length && !tplNotes.length) return;
  try {
    const dir = path.join(DATA_DIR, 'migrations');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `048-schedule-${stamp}.md`);
    const kindZh = { fromRows: '用阶段行生成日历', rowsFromCal: '用日历重写阶段行', conflict: '两边都有内容 · 以阶段行为准,原日历进存档' };
    const n = (k: Mig048Entry['kind']) => done.filter((x) => x.kind === k).length;
    const lines = ['# REQ-048 排期按业务分开、去掉经典模式 · 上线迁移报告', '', `时间:${t.toLocaleString('zh-CN')}`,
      `迁移前备份:${backup || '(库是空的,没备份)'}`, '',
      `共 ${done.length} 份业务:用阶段行生成日历 ${n('fromRows')} 份、用日历重写阶段行 ${n('rowsFromCal')} 份、两边都有内容 ${n('conflict')} 份。`,
      '阶段行上的负责人、状态、备注一个都没动;「用阶段行生成日历」的业务,日历上的日期就是行上的日期(按日历天算)。',
      '「日期调整」= 原来几行有重叠或空档,日历只能首尾相接,这几行在日历上的日期和原来差了几天 —— 下次在日历上保存时以日历为准,保存前行上的日期不变。',
      '「无日期」= 原来 0 周、又没填日期的阶段(多是「信息收集」),日历上各给了 1 天,排在第一个有日期的阶段之前。', '',
      ...(tplNotes.length ? ['## 模板管理', '', ...tplNotes, ''] : []),
      '## 每份业务', '', '| 项目 | 业务 | 做了什么 | 阶段数 | 有日期 | 日期调整 | 无日期 |', '|---|---|---|---|---|---|---|',
      ...done.map((x) => `| ${x.project.replace(/\|/g, '/')} | ${x.pkg} | ${kindZh[x.kind]} | ${x.stages} | ${x.dated ? '是' : '否'} | ${x.adjusted || ''} | ${x.undated || ''} |`),
      '', '回退:先 pm2 stop audax,再跑 scripts\\req048-rollback.bat(不带参数只报告;--apply 才写库)。'];
    fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
    console.log(`[REQ-048] 排期迁移:${done.length} 份业务,报告 ${file}`);
  } catch (e) {
    console.warn('[REQ-048] 迁移报告没写成(数据已迁移,不影响使用):', e);
  }
}

/* ===== REQ-044 一个项目一张信息清单 =====
   同义项:PD / BD 在模板管理里维护,存在 meta 表 cl.synonyms;没存过就用默认那份。 */
const SYN_KEY = 'cl.synonyms';
function loadSynonyms(d: Database.Database) {
  const row = d.prepare('SELECT value FROM meta WHERE key = ?').get(SYN_KEY) as { value: string } | undefined;
  try { setSynonyms(row ? JSON.parse(row.value) : null); } catch { setSynonyms(null); }
}
export function getChecklistSynonyms(): { list: string[][]; custom: boolean; defaults: string[][] } {
  const d = getDb();
  const custom = !!d.prepare('SELECT 1 FROM meta WHERE key = ?').get(SYN_KEY);
  return { list: getSynonyms(), custom, defaults: DEFAULT_SYNONYMS };
}
export function saveChecklistSynonyms(list: unknown): string[][] {
  const clean = cleanSynonyms(list);
  getDb().prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(SYN_KEY, JSON.stringify(clean));
  setSynonyms(clean);
  return clean;
}
export function resetChecklistSynonyms() {
  getDb().prepare('DELETE FROM meta WHERE key = ?').run(SYN_KEY);
  setSynonyms(null);
}

/* 上线迁移(每次启动检查一遍,只处理还是老结构的项目):各服务包的清单合成项目一张,
   原样备份进 checklistLegacy;每个项目写一条日志;报告写到
   data/migrations/044-checklist-merge-<时间>.md 给 PD 抽查。规则和预演工具
   (scripts/req044-dryrun.ts)是同一份代码。不删任何数据。 */
function migrateSharedChecklist(d: Database.Database) {
  const rows = d.prepare('SELECT id, data FROM projects ORDER BY created_at ASC').all() as { id: string; data: string }[];
  const upd = d.prepare('UPDATE projects SET data = ?, updated_at = ?, version = version + 1 WHERE id = ?');
  const audit = d.prepare('INSERT INTO audit_log (project_id, at, by, text, k, p) VALUES (?, ?, ?, ?, ?, ?)');
  const done: ProjectMigration[] = [];
  const now = Date.now();
  d.transaction(() => {
    for (const r of rows) {
      let o: any;
      try { o = JSON.parse(r.data); } catch { continue; }
      if (Array.isArray(o.checklist)) continue;
      let m: ProjectMigration | null = null;
      const p = migrate(o, { onChecklistMigrated: (x) => { m = x; } });
      if (!m) continue;
      const mm = m as ProjectMigration;
      done.push(mm);
      const k = 'cl.sharedMig', params = { from: mm.sourceItems, to: mm.items };
      p.log = Array.isArray(p.log) ? p.log : [];
      p.log.unshift({ at: now, by: '系统', text: logZh(k, params), k, p: params });
      if (p.log.length > 200) p.log.length = 200;
      const { updatedAt: _u, version: _v, ...data } = p;
      upd.run(JSON.stringify(data), now, r.id);
      audit.run(r.id, now, '系统', logZh(k, params), k, JSON.stringify(params));
    }
  })();
  if (!done.length) return;
  try {
    const dir = path.join(DATA_DIR, 'migrations');
    fs.mkdirSync(dir, { recursive: true });
    const t = new Date(now), pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}`;
    const file = path.join(dir, `044-checklist-merge-${stamp}.md`);
    fs.writeFileSync(file, migrationReport(done, { title: 'REQ-044 共用信息清单 · 上线迁移报告', when: t.toLocaleString('zh-CN'), db: path.join(DATA_DIR, 'audax.db'), synonyms: getSynonyms() }), 'utf8');
    console.log(`[REQ-044] 信息清单合成一张:${done.length} 个项目,报告 ${file}`);
  } catch (e) {
    console.warn('[REQ-044] 迁移报告没写成(数据已迁移,不影响使用):', e);
  }
}

/* next project NO. — one past the current max across all projects */
export function nextProjectSerial(): number {
  const rows = getDb().prepare('SELECT data FROM projects').all() as { data: string }[];
  let max = 0;
  for (const r of rows) {
    let o: any;
    try { o = JSON.parse(r.data); } catch { continue; }
    if (typeof o.serial === 'number' && o.serial > max) max = o.serial;
  }
  return max + 1;
}

/* ---- built-in daily backups (local/server deployments) ----
   Snapshot data/audax.db → data/backups/audax-YYYY-MM-DD.db once per day,
   keep the last 30. OS-independent: no cron/task scheduler needed. */
const BACKUP_KEEP_DAYS = 30;
let backupsScheduled = false;

function scheduleBackups(d: Database.Database) {
  if (backupsScheduled || process.env.VERCEL || process.env.AUDAX_NO_BACKUP === '1') return;
  backupsScheduled = true;
  const run = () => { backupNow(d).catch((e) => console.warn('[backup] failed:', e)); };
  run(); // on startup
  const timer = setInterval(run, 6 * 60 * 60 * 1000); // re-check every 6h
  (timer as unknown as { unref?: () => void }).unref?.();
}

async function backupNow(d: Database.Database) {
  const dir = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const target = path.join(dir, `audax-${today}.db`);
  if (!fs.existsSync(target)) {
    await d.backup(target); // online-safe snapshot via SQLite backup API
    prune(dir);
  }
  /* offsite copy: point AUDAX_BACKUP_DIR at a NAS / synced-drive folder and
     every daily snapshot is mirrored there too */
  const offsite = process.env.AUDAX_BACKUP_DIR;
  if (offsite) {
    try {
      fs.mkdirSync(offsite, { recursive: true });
      const dest = path.join(offsite, `audax-${today}.db`);
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(target, dest);
        prune(offsite);
      }
    } catch (e) {
      console.warn('[backup] offsite copy failed:', e);
    }
  }
}

function prune(dir: string) {
  const cutoff = Date.now() - BACKUP_KEEP_DAYS * 86400000;
  for (const f of fs.readdirSync(dir)) {
    if (!/^audax-\d{4}-\d{2}-\d{2}\.db$/.test(f)) continue;
    const full = path.join(dir, f);
    if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
  }
}

function maybeSeedDemo(d: Database.Database) {
  // Lazy import to avoid a require cycle (demo.ts imports hashPassword from here).
  const { shouldSeedDemo, seedDemo } = require('./demo') as typeof import('./demo');
  if (!shouldSeedDemo()) return;
  const n = (d.prepare('SELECT COUNT(*) AS c FROM projects').get() as { c: number }).c;
  if (n === 0) seedDemo(d);
}

/* ---- additive schema migrations for existing databases ---- */
function migrateSchema(d: Database.Database) {
  const cols = (d.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('email')) d.exec("ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT ''");
  if (!cols.includes('position')) d.exec("ALTER TABLE users ADD COLUMN position TEXT NOT NULL DEFAULT ''");
  if (!cols.includes('must_change_pw')) d.exec('ALTER TABLE users ADD COLUMN must_change_pw INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('disabled')) d.exec('ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('avatar')) d.exec("ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT ''");
  if (!cols.includes('point_cap')) d.exec('ALTER TABLE users ADD COLUMN point_cap INTEGER NOT NULL DEFAULT 0');
  /* REQ-051: 删除用户 = 先转交工作,再打上删除时间。行不删 —— 历史记录里的名字还要认得出是谁,
     显示「(已删除)」。0 = 没删 */
  if (!cols.includes('deleted_at')) d.exec('ALTER TABLE users ADD COLUMN deleted_at INTEGER NOT NULL DEFAULT 0');
  /* REQ-051: 不属于某个项目的管理操作(改权限表、删除用户)记在这里;项目里的照旧进 audit_log */
  d.exec(`CREATE TABLE IF NOT EXISTS admin_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    by TEXT NOT NULL,
    text TEXT NOT NULL,
    k TEXT,
    p TEXT
  )`);
  /* v2.2 §4.2 [P0-3]: optimistic-lock version on projects */
  const pcols = (d.prepare('PRAGMA table_info(projects)').all() as { name: string }[]).map((c) => c.name);
  if (!pcols.includes('version')) d.exec('ALTER TABLE projects ADD COLUMN version INTEGER NOT NULL DEFAULT 0');
  /* 操作日志 i18n:审计表补两列放词条 key 与参数。已经部署的库里这张表是老
     结构,CREATE TABLE IF NOT EXISTS 补不上,得单独 ALTER。两列都可空 ——
     老行保持 NULL,显示时退回它们自己的 text。 */
  const acols = (d.prepare('PRAGMA table_info(audit_log)').all() as { name: string }[]).map((c) => c.name);
  if (!acols.includes('k')) d.exec('ALTER TABLE audit_log ADD COLUMN k TEXT');
  if (!acols.includes('p')) d.exec('ALTER TABLE audit_log ADD COLUMN p TEXT');
  /* REQ-016: simple global key-value settings (e.g. export company notes) */
  d.exec('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT \'\')');
  /* REQ-012: user-saved schedule/checklist snippets. Named user_templates so it
     never collides with `templates` (the per-service production template admin). */
  /* REQ-023: 每个服务类型的资料卡字段定义(覆盖 lib/records.ts 里的出厂默认) */
  d.exec(`CREATE TABLE IF NOT EXISTS record_fields (
    svc TEXT PRIMARY KEY,
    fields TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    updated_by TEXT NOT NULL DEFAULT ''
  )`);
  d.exec(`CREATE TABLE IF NOT EXISTS user_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    created_by TEXT NOT NULL DEFAULT ''
  )`);
  /* REQ-035: 知识库。正文是 Markdown;每次保存把「上一版」压进 kb_versions,
     所以历史可看可回退。附件单独一张表,别把文档行撑大。 */
  d.exec(`CREATE TABLE IF NOT EXISTS kb_docs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    title_en TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'other',
    tags TEXT NOT NULL DEFAULT '[]',
    body TEXT NOT NULL DEFAULT '',
    anchors TEXT NOT NULL DEFAULT '{}',
    attachments TEXT NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL,
    updated_by TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    created_by TEXT NOT NULL DEFAULT ''
  )`);
  d.exec(`CREATE TABLE IF NOT EXISTS kb_versions (
    doc_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    at INTEGER NOT NULL,
    by TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (doc_id, version)
  )`);
  d.exec(`CREATE TABLE IF NOT EXISTS kb_files (
    id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL,
    name TEXT NOT NULL,
    mime TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL
  )`);
  /* REQ-036: 新人培训。路径定义一张表,每人每路径的进度一张表,
     每次考核的成绩单独留痕(需求要「记录成绩与尝试次数」)。 */
  d.exec(`CREATE TABLE IF NOT EXISTS training_paths (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    title_en TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT '',
    assignees TEXT NOT NULL DEFAULT '[]',
    steps TEXT NOT NULL DEFAULT '[]',
    quiz TEXT NOT NULL DEFAULT '[]',
    pass_score INTEGER NOT NULL DEFAULT 80,
    admin_only INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    updated_by TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    created_by TEXT NOT NULL DEFAULT ''
  )`);
  d.exec(`CREATE TABLE IF NOT EXISTS training_progress (
    path_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    done TEXT NOT NULL DEFAULT '[]',
    done_at TEXT NOT NULL DEFAULT '{}',
    attempts INTEGER NOT NULL DEFAULT 0,
    best_score REAL,
    passed_quiz INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (path_id, user_name)
  )`);
  d.exec(`CREATE TABLE IF NOT EXISTS training_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    score REAL NOT NULL,
    passed INTEGER NOT NULL DEFAULT 0,
    at INTEGER NOT NULL
  )`);
  /* REQ-037: KPI 规则。和积分规则同一套做法 —— 只增不改,带生效日。 */
  d.exec(`CREATE TABLE IF NOT EXISTS kpi_rules (
    version INTEGER PRIMARY KEY AUTOINCREMENT,
    rules TEXT NOT NULL,
    effective_from TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    created_by TEXT NOT NULL DEFAULT ''
  )`);
  /* REQ-038: 积分规则。只增不改 —— 每次保存写一个新版本,老版本留着,
     历史项目按它创建时生效的那一版计分。 */
  d.exec(`CREATE TABLE IF NOT EXISTS point_rules (
    version INTEGER PRIMARY KEY AUTOINCREMENT,
    rules TEXT NOT NULL,
    effective_from TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    created_by TEXT NOT NULL DEFAULT ''
  )`);
}

/* ---- REQ-035: 知识库 ---- */
export interface KbRow {
  id: string; title: string; title_en: string; category: string; tags: string; body: string;
  anchors: string; attachments: string; version: number;
  updated_at: number; updated_by: string; created_at: number; created_by: string;
}
export interface KbVersionRow { doc_id: string; version: number; title: string; body: string; summary: string; at: number; by: string }

export function listKbDocs(): KbRow[] {
  return getDb().prepare('SELECT * FROM kb_docs ORDER BY updated_at DESC').all() as KbRow[];
}
export function getKbDoc(id: string): KbRow | undefined {
  return getDb().prepare('SELECT * FROM kb_docs WHERE id = ?').get(id) as KbRow | undefined;
}
export function insertKbDoc(r: KbRow) {
  getDb().prepare(`INSERT INTO kb_docs
      (id, title, title_en, category, tags, body, anchors, attachments, version, updated_at, updated_by, created_at, created_by)
      VALUES (@id, @title, @title_en, @category, @tags, @body, @anchors, @attachments, @version, @updated_at, @updated_by, @created_at, @created_by)`).run(r);
}
export function updateKbDoc(r: KbRow) {
  getDb().prepare(`UPDATE kb_docs SET title=@title, title_en=@title_en, category=@category, tags=@tags,
      body=@body, anchors=@anchors, attachments=@attachments, version=@version,
      updated_at=@updated_at, updated_by=@updated_by WHERE id=@id`).run(r);
}
export function deleteKbDoc(id: string) {
  const d = getDb();
  d.prepare('DELETE FROM kb_versions WHERE doc_id = ?').run(id);
  d.prepare('DELETE FROM kb_files WHERE doc_id = ?').run(id);
  d.prepare('DELETE FROM kb_docs WHERE id = ?').run(id);
}
export function listKbVersions(docId: string): KbVersionRow[] {
  return getDb().prepare('SELECT doc_id, version, title, body, summary, at, by FROM kb_versions WHERE doc_id = ? ORDER BY version DESC')
    .all(docId) as KbVersionRow[];
}
export function insertKbVersion(v: KbVersionRow) {
  getDb().prepare('INSERT INTO kb_versions (doc_id, version, title, body, summary, at, by) VALUES (@doc_id, @version, @title, @body, @summary, @at, @by)').run(v);
}
/* 附件另存一张表:文档行本身要频繁读列表,别让 base64 把它撑大 */
export function insertKbFile(docId: string, id: string, name: string, mime: string, data: string) {
  getDb().prepare('INSERT OR REPLACE INTO kb_files (id, doc_id, name, mime, data) VALUES (?, ?, ?, ?, ?)')
    .run(id, docId, name, mime, data);
}
export function getKbFile(id: string): { id: string; doc_id: string; name: string; mime: string; data: string } | undefined {
  return getDb().prepare('SELECT * FROM kb_files WHERE id = ?').get(id) as never;
}
export function deleteKbFile(id: string) {
  getDb().prepare('DELETE FROM kb_files WHERE id = ?').run(id);
}

/* ---- REQ-036: 新人培训 ---- */
export interface TrainingPathRow {
  id: string; title: string; title_en: string; role: string; assignees: string; steps: string; quiz: string;
  pass_score: number; admin_only: number; updated_at: number; updated_by: string; created_at: number; created_by: string;
}
export interface TrainingProgressRow {
  path_id: string; user_name: string; done: string; done_at: string;
  attempts: number; best_score: number | null; passed_quiz: number; updated_at: number;
}

export const listTrainingPaths = (): TrainingPathRow[] =>
  getDb().prepare('SELECT * FROM training_paths ORDER BY created_at ASC').all() as TrainingPathRow[];
export const getTrainingPath = (id: string): TrainingPathRow | undefined =>
  getDb().prepare('SELECT * FROM training_paths WHERE id = ?').get(id) as TrainingPathRow | undefined;
export function insertTrainingPath(r: TrainingPathRow) {
  getDb().prepare(`INSERT INTO training_paths
    (id, title, title_en, role, assignees, steps, quiz, pass_score, admin_only, updated_at, updated_by, created_at, created_by)
    VALUES (@id, @title, @title_en, @role, @assignees, @steps, @quiz, @pass_score, @admin_only, @updated_at, @updated_by, @created_at, @created_by)`).run(r);
}
export function updateTrainingPath(r: TrainingPathRow) {
  getDb().prepare(`UPDATE training_paths SET title=@title, title_en=@title_en, role=@role, assignees=@assignees,
    steps=@steps, quiz=@quiz, pass_score=@pass_score, admin_only=@admin_only,
    updated_at=@updated_at, updated_by=@updated_by WHERE id=@id`).run(r);
}
export function deleteTrainingPath(id: string) {
  const d = getDb();
  d.prepare('DELETE FROM training_attempts WHERE path_id = ?').run(id);
  d.prepare('DELETE FROM training_progress WHERE path_id = ?').run(id);
  d.prepare('DELETE FROM training_paths WHERE id = ?').run(id);
}
export const listTrainingProgress = (): TrainingProgressRow[] =>
  getDb().prepare('SELECT * FROM training_progress').all() as TrainingProgressRow[];
export const getTrainingProgress = (pathId: string, user: string): TrainingProgressRow | undefined =>
  getDb().prepare('SELECT * FROM training_progress WHERE path_id = ? AND user_name = ?').get(pathId, user) as TrainingProgressRow | undefined;
export function upsertTrainingProgress(r: TrainingProgressRow) {
  getDb().prepare(`INSERT INTO training_progress (path_id, user_name, done, done_at, attempts, best_score, passed_quiz, updated_at)
    VALUES (@path_id, @user_name, @done, @done_at, @attempts, @best_score, @passed_quiz, @updated_at)
    ON CONFLICT(path_id, user_name) DO UPDATE SET done=@done, done_at=@done_at, attempts=@attempts,
      best_score=@best_score, passed_quiz=@passed_quiz, updated_at=@updated_at`).run(r);
}
export function insertTrainingAttempt(pathId: string, user: string, score: number, passed: boolean) {
  getDb().prepare('INSERT INTO training_attempts (path_id, user_name, score, passed, at) VALUES (?, ?, ?, ?, ?)')
    .run(pathId, user, score, passed ? 1 : 0, Date.now());
}
export const listTrainingAttempts = (pathId?: string): { id: number; path_id: string; user_name: string; score: number; passed: number; at: number }[] =>
  (pathId
    ? getDb().prepare('SELECT * FROM training_attempts WHERE path_id = ? ORDER BY at DESC').all(pathId)
    : getDb().prepare('SELECT * FROM training_attempts ORDER BY at DESC LIMIT 500').all()) as never;

/* ---- REQ-038: 积分规则版本 ---- */
export interface PointRuleRow {
  version: number; rules: string; effective_from: string; note: string; created_at: number; created_by: string;
}
export function listPointRules(): PointRuleRow[] {
  return getDb().prepare('SELECT * FROM point_rules ORDER BY version ASC').all() as PointRuleRow[];
}
/* ---- REQ-037: KPI 规则版本(结构与积分规则一致) ---- */
export function listKpiRules(): PointRuleRow[] {
  return getDb().prepare('SELECT * FROM kpi_rules ORDER BY version ASC').all() as PointRuleRow[];
}
export function insertKpiRules(rulesJson: string, effectiveFrom: string, note: string, by: string): number {
  const info = getDb()
    .prepare('INSERT INTO kpi_rules (rules, effective_from, note, created_at, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(rulesJson, effectiveFrom, note, Date.now(), by);
  return Number(info.lastInsertRowid);
}

export function insertPointRules(rulesJson: string, effectiveFrom: string, note: string, by: string): number {
  const info = getDb()
    .prepare('INSERT INTO point_rules (rules, effective_from, note, created_at, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(rulesJson, effectiveFrom, note, Date.now(), by);
  return Number(info.lastInsertRowid);
}

/* ---- REQ-012: user-saved templates (schedule / checklist snippets) ---- */
export interface UserTemplate { id: number; type: string; name: string; payload: string; created_at: number; created_by: string }
export function listUserTemplates(type?: string): UserTemplate[] {
  const d = getDb();
  return (type
    ? d.prepare('SELECT * FROM user_templates WHERE type = ? ORDER BY created_at DESC').all(type)
    : d.prepare('SELECT * FROM user_templates ORDER BY created_at DESC').all()) as UserTemplate[];
}
export function getUserTemplate(id: number): UserTemplate | undefined {
  return getDb().prepare('SELECT * FROM user_templates WHERE id = ?').get(id) as UserTemplate | undefined;
}
export function saveUserTemplate(type: string, name: string, payload: string, by: string): UserTemplate {
  const now = Date.now();
  const info = getDb()
    .prepare('INSERT INTO user_templates (type, name, payload, created_at, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(type, name, payload, now, by);
  return { id: Number(info.lastInsertRowid), type, name, payload, created_at: now, created_by: by };
}
export function deleteUserTemplate(id: number) {
  getDb().prepare('DELETE FROM user_templates WHERE id = ?').run(id);
}

/* ---- REQ-023: per-service record field schema (overrides lib/records.ts) ----
   One row per service type. Job Record and Project Registers both read this,
   so a change in either place shows up in both — that's the "同源" the spec
   asks for. Field *values* stay on each project's packages[i].record. */
export function listRecordFields(): Record<string, unknown> {
  const rows = getDb().prepare('SELECT svc, fields FROM record_fields').all() as { svc: string; fields: string }[];
  const out: Record<string, unknown> = {};
  rows.forEach((r) => { try { out[r.svc] = JSON.parse(r.fields); } catch { /* 坏行忽略,回落到出厂默认 */ } });
  return out;
}
export function setRecordFields(svc: string, fieldsJson: string, by: string) {
  getDb()
    .prepare(`INSERT INTO record_fields (svc, fields, updated_at, updated_by) VALUES (?, ?, ?, ?)
              ON CONFLICT(svc) DO UPDATE SET fields = excluded.fields, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .run(svc, fieldsJson, Date.now(), by);
}
export function resetRecordFields(svc: string) {
  getDb().prepare('DELETE FROM record_fields WHERE svc = ?').run(svc);
}

/* ---- REQ-016: global app settings (key-value) ---- */
export function getSetting(key: string): string {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : '';
}
export function setSetting(key: string, value: string) {
  getDb().prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

/* ---- secret for session signing (persisted so sessions survive restarts) ---- */
export function getSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  // Demo deployments run multiple ephemeral instances that each get their own
  // /tmp database — a fixed demo secret keeps logins valid across instances.
  // Set SESSION_SECRET in production.
  if (process.env.VERCEL) return 'audax-demo-session-secret-set-SESSION_SECRET-in-prod';
  const d = getDb();
  const row = d.prepare('SELECT value FROM meta WHERE key = ?').get('session_secret') as { value: string } | undefined;
  if (row) return row.value;
  const secret = crypto.randomBytes(32).toString('hex');
  d.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('session_secret', secret);
  return secret;
}

/* ---- password hashing (scrypt, no native deps beyond node) ---- */
export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(pw, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

/* ---- users ---- */
export function getUserByUsername(username: string) {
  return getDb()
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(username) as (User & { password_hash: string }) | undefined;
}
/* Sign-in accepts the username or the email address. */
export function getUserByLogin(login: string) {
  return getDb()
    .prepare("SELECT * FROM users WHERE username = ? OR (email != '' AND lower(email) = ?)")
    .get(login, login.toLowerCase()) as (User & { password_hash: string }) | undefined;
}
export function getUserByEmail(email: string) {
  return getDb()
    .prepare("SELECT * FROM users WHERE email != '' AND lower(email) = ?")
    .get(email.toLowerCase()) as (User & { password_hash: string }) | undefined;
}
const USER_COLS = 'id, username, name, role, email, position, must_change_pw AS mustChangePassword, disabled, avatar, point_cap AS pointCap, deleted_at AS deletedAt';
function rowToUser(r: Record<string, unknown> | undefined): User | undefined {
  if (!r) return undefined;
  return {
    id: r.id as number, username: r.username as string, name: r.name as string, role: r.role as Role,
    email: (r.email as string) || '', position: (r.position as string) || '',
    mustChangePassword: !!r.mustChangePassword, disabled: !!r.disabled,
    avatar: (r.avatar as string) || undefined,
    pointCap: (r.pointCap as number) || 0,
    ...(r.deletedAt ? { deletedAt: r.deletedAt as number } : {}),
  };
}
export function getUserById(id: number) {
  return rowToUser(getDb().prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id) as Record<string, unknown> | undefined);
}
export function listUsers(): User[] {
  return (getDb().prepare(`SELECT ${USER_COLS} FROM users ORDER BY id`).all() as Record<string, unknown>[]).map((r) => rowToUser(r)!);
}
export function createUser(
  username: string, password: string, name: string, role: Role,
  email = '', position = '', mustChangePassword = false,
): User {
  const info = getDb()
    .prepare('INSERT INTO users (username, password_hash, name, role, email, position, must_change_pw, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(username, hashPassword(password), name, role, email, position, mustChangePassword ? 1 : 0, Date.now());
  return { id: Number(info.lastInsertRowid), username, name, role, email, position, mustChangePassword, disabled: false };
}

/* Change a user's own password (verifies the current one). Clears the
   force-change flag. */
export function changePassword(id: number, currentPw: string, newPw: string): { ok: boolean; error?: string } {
  const row = getDb().prepare('SELECT password_hash FROM users WHERE id = ?').get(id) as { password_hash: string } | undefined;
  if (!row) return { ok: false, error: '用户不存在' };
  if (!verifyPassword(currentPw, row.password_hash)) return { ok: false, error: '当前密码错误' };
  getDb().prepare('UPDATE users SET password_hash = ?, must_change_pw = 0 WHERE id = ?').run(hashPassword(newPw), id);
  return { ok: true };
}
/* PD/BD resets someone's password; forces a change on their next login. */
export function resetPassword(id: number, newPw: string) {
  getDb().prepare('UPDATE users SET password_hash = ?, must_change_pw = 1 WHERE id = ?').run(hashPassword(newPw), id);
}
export function setUserDisabled(id: number, disabled: boolean) {
  getDb().prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, id);
}

/* ---- projects (stored as JSON documents; all mutations happen server-side) ----
   `updatedAt` is injected on read (from the row) for client conflict hints and
   stripped again before persisting. */
export function listProjects(): Project[] {
  const rows = getDb().prepare('SELECT data, updated_at, version FROM projects ORDER BY created_at DESC').all() as { data: string; updated_at: number; version: number }[];
  return rows.map((r) => {
    const p = migrate(JSON.parse(r.data));
    p.updatedAt = r.updated_at;
    p.version = r.version;
    return p;
  });
}
export function getProject(id: string): Project | undefined {
  const row = getDb().prepare('SELECT data, updated_at, version FROM projects WHERE id = ?').get(id) as { data: string; updated_at: number; version: number } | undefined;
  if (!row) return undefined;
  const p = migrate(JSON.parse(row.data));
  p.updatedAt = row.updated_at;
  p.version = row.version;
  return p;
}
export function insertProject(p: Project) {
  const { updatedAt: _u, version: _v, ...data } = p;
  getDb()
    .prepare('INSERT INTO projects (id, data, created_at, updated_at, version) VALUES (?, ?, ?, ?, 1)')
    .run(p.id, JSON.stringify(data), p.created, Date.now());
  p.version = 1;
}
export function saveProject(p: Project): number {
  const now = Date.now();
  const { updatedAt: _u, version: _v, ...data } = p;
  /* keep bumping version so the optimistic-lock counter stays meaningful even
     for the legacy (non-CAS) save path */
  getDb()
    .prepare('UPDATE projects SET data = ?, updated_at = ?, version = version + 1 WHERE id = ?')
    .run(JSON.stringify(data), now, p.id);
  p.updatedAt = now;
  return now;
}

/* v2.2 §4.5 [P0-3]: compare-and-swap save. Writes only if the row's version
   still equals `expectedVersion`; returns the new version on success or null
   on a stale write (caller re-reads and asks the user to reconfirm). */
export function saveProjectCAS(p: Project, expectedVersion: number): number | null {
  const now = Date.now();
  const { updatedAt: _u, version: _v, ...data } = p;
  const info = getDb()
    .prepare('UPDATE projects SET data = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?')
    .run(JSON.stringify(data), now, p.id, expectedVersion);
  if (info.changes === 0) return null; // stale — someone else wrote in between
  p.updatedAt = now;
  p.version = expectedVersion + 1;
  return p.version;
}

/* v2.2 §4.4 [P0-1]: record a workflow action's idempotency key. Returns false
   if this (project, action, workflowVersion) was already recorded — the caller
   must then abort (don't create a second task/notification). */
export function recordWorkflowAction(projectId: string, actionType: string, workflowVersion: number, actorId: string): boolean {
  try {
    getDb()
      .prepare('INSERT INTO workflow_actions (project_id, action_type, workflow_version, actor_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(projectId, actionType, workflowVersion, actorId, Date.now());
    return true;
  } catch (e: any) {
    if (String(e?.code || '').includes('CONSTRAINT') || /UNIQUE/.test(String(e?.message))) return false;
    throw e;
  }
}
export function listWorkflowActions(projectId: string) {
  return getDb()
    .prepare('SELECT action_type, workflow_version, actor_id, created_at FROM workflow_actions WHERE project_id = ? ORDER BY created_at')
    .all(projectId) as { action_type: string; workflow_version: number; actor_id: string; created_at: number }[];
}

/* v2.2 §4.4+§4.5: commit a workflow submission atomically — insert the
   idempotency key AND save projects.data with a version CAS, in one
   transaction. Returns 'ok', 'duplicate' (already submitted) or 'stale'
   (someone else wrote in between → caller re-reads and reconfirms). */
export function commitWorkflowAction(p: Project, actionType: string, actorId: string, expectedVersion: number, workflowVersion: number): 'ok' | 'duplicate' | 'stale' {
  const d = getDb();
  const now = Date.now();
  const wfv = workflowVersion; // the version the action acted on (before any rollback bump)
  const { updatedAt: _u, version: _v, ...data } = p;
  const json = JSON.stringify(data);
  const tx = d.transaction(() => {
    try {
      d.prepare('INSERT INTO workflow_actions (project_id, action_type, workflow_version, actor_id, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(p.id, actionType, wfv, actorId, now);
    } catch (e: any) {
      if (String(e?.code || '').includes('CONSTRAINT') || /UNIQUE/.test(String(e?.message))) throw new Error('__DUP__');
      throw e;
    }
    const info = d.prepare('UPDATE projects SET data = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?')
      .run(json, now, p.id, expectedVersion);
    if (info.changes === 0) throw new Error('__STALE__');
  });
  try {
    tx();
    p.updatedAt = now; p.version = expectedVersion + 1;
    return 'ok';
  } catch (e: any) {
    if (e?.message === '__DUP__') return 'duplicate';
    if (e?.message === '__STALE__') return 'stale';
    throw e;
  }
}
export function deleteProject(id: string) {
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
}

/* §6: cross-project register CSV import — ALL-OR-NOTHING. Each row identifies an
   existing project by name; we ensure a package of `svc` and merge the record
   patch. Runs in one transaction: if ANY row fails to resolve a project, the
   whole batch rolls back and nothing is written (no partial/corrupt import). */
export function importRegisterRecords(
  svc: string,
  rows: { project: string; patch: Record<string, string> }[],
  actor: string,
): { updated: number } {
  const d = getDb();
  const now = Date.now();
  const run = d.transaction(() => {
    const all = d.prepare('SELECT id, data FROM projects').all() as { id: string; data: string }[];
    const byName = new Map<string, { id: string; p: Project }>();
    for (const r of all) {
      const p = migrate(JSON.parse(r.data));
      if (p.archived) continue;
      const key = (p.name || '').trim().toLowerCase();
      if (key && !byName.has(key)) byName.set(key, { id: r.id, p });
    }
    const upd = d.prepare('UPDATE projects SET data = ?, updated_at = ?, version = version + 1 WHERE id = ?');
    let updated = 0;
    rows.forEach((row, i) => {
      const key = String(row.project || '').trim().toLowerCase();
      if (!key) throw new Error(`第 ${i + 1} 行:缺少项目名称`);
      const hit = byName.get(key);
      if (!hit) throw new Error(`第 ${i + 1} 行:未找到项目「${row.project}」(导入已全部撤销)`);
      const p = hit.p;
      let pk = p.packages.find((x) => x.svc === svc);
      if (!pk) {
        pk = { svc, start: '', delivery: '', buffer: 0, owner: '', status: 'active', schedule: [] };
        p.packages.push(pk);
        if (!Array.isArray(p.services)) p.services = [];
        if (!p.services.includes(svc)) p.services.push(svc);
      }
      const rec: Record<string, string | number | undefined> = { ...(pk.record || {}) };
      const notes: { k: string; p?: LogParams }[] = [];
      for (const [k, v] of Object.entries(row.patch || {})) {
        if (k === 'updatedAt') continue;
        /* 0922 变更单:与项目同源的那几列,导入时也得落到项目字段上 ——
           塞进 record 的话读的时候根本读不到,等于这一列白导。 */
        const src = projSourceOf(k);
        if (src) {
          const r = applyProjField(p, src, String(v ?? ''));
          if (!r.ok) throw new Error(`第 ${i + 1} 行:${r.error}(导入已全部撤销)`);
          if (r.log) notes.push(r.log);
          continue;
        }
        rec[k] = String(v ?? '').slice(0, 2000);
      }
      rec.updatedAt = now;
      pk.record = rec;
      const entries = [
        { at: now, by: actor, text: logZh('record.import', { svc }), k: 'record.import', p: { svc } as LogParams },
        ...notes.map((n) => ({ at: now, by: actor, text: logZh(n.k, n.p), k: n.k, p: n.p as LogParams })),
      ];
      p.log = [...entries, ...((p.log as { at: number; by: string; text: string }[]) || [])].slice(0, 200);
      const { updatedAt: _u, version: _v, ...pdata } = p;
      upd.run(JSON.stringify(pdata), now, hit.id);
      updated++;
    });
    return updated;
  });
  const updated = run();
  return { updated };
}

/* ---- permanent audit trail (project logs are capped at 200 in-document;
        every entry is also appended here and never rotated) ---- */
export function appendAudit(projectId: string, entries: { at: number; by: string; text: string; k?: string; p?: LogParams }[]) {
  if (!entries.length) return;
  const ins = getDb().prepare('INSERT INTO audit_log (project_id, at, by, text, k, p) VALUES (?, ?, ?, ?, ?, ?)');
  for (const e of entries) ins.run(projectId, e.at, e.by, e.text, e.k ?? null, e.p ? JSON.stringify(e.p) : null);
}
/* AV-016 · 自动保存的日志要合并:同一人、同一页(同一个 key + 参数)10 分钟内的连续草稿
   只记一条 —— 上一条就是它的话,把那条的时间挪到现在,不再新增一行 */
const MERGE_MS = 10 * 60 * 1000;
export function appendAuditMerged(projectId: string, e: { at: number; by: string; text: string; k: string; p?: LogParams },
  /* 同一页但参数会变的(01 改了哪几项):给出怎么把上一条和这一条合成一条 */
  combine?: (prev: LogParams | undefined) => { text: string; p: LogParams }) {
  const d = getDb();
  const p = e.p ? JSON.stringify(e.p) : null;
  /* 看的是「这个人」在这个项目上的上一条:两个人同时在改时,别人的日志夹在中间也不打断合并(复查 #68) */
  const last = d.prepare('SELECT id, at, by, k, p FROM audit_log WHERE project_id = ? AND by = ? ORDER BY at DESC, id DESC LIMIT 1')
    .get(projectId, e.by) as { id: number; at: number; by: string; k: string | null; p: string | null } | undefined;
  if (last && last.k === e.k && (combine || last.p === p) && e.at - last.at < MERGE_MS) {
    if (combine) {
      const c = combine(last.p ? JSON.parse(last.p) as LogParams : undefined);
      d.prepare('UPDATE audit_log SET at = ?, text = ?, p = ? WHERE id = ?').run(e.at, c.text, JSON.stringify(c.p), last.id);
    } else d.prepare('UPDATE audit_log SET at = ? WHERE id = ?').run(e.at, last.id);
    return;
  }
  appendAudit(projectId, [e]);
}
/* AV-017 步骤条 / 工作台的「最近更新」:这个项目最后一条 AV 日志,一次查到 */
export function lastAvAudit(projectId: string): { at: number; by: string; text: string; k?: string; p?: LogParams } | null {
  const r = getDb().prepare("SELECT at, by, text, k, p FROM audit_log WHERE project_id = ? AND k LIKE 'av.%' ORDER BY at DESC, id DESC LIMIT 1")
    .get(projectId) as { at: number; by: string; text: string; k: string; p: string | null } | undefined;
  return r ? { at: r.at, by: r.by, text: r.text, k: r.k, ...(r.p ? { p: JSON.parse(r.p) as LogParams } : {}) } : null;
}
export function listAudit(projectId: string, limit = 1000) {
  const rows = getDb()
    .prepare('SELECT at, by, text, k, p FROM audit_log WHERE project_id = ? ORDER BY at DESC LIMIT ?')
    .all(projectId, limit) as { at: number; by: string; text: string; k: string | null; p: string | null }[];
  /* 老行的 k / p 是 NULL —— 显示时就退回 text,和写它们的时候一模一样 */
  return rows.map((r) => ({
    at: r.at, by: r.by, text: r.text,
    ...(r.k ? { k: r.k } : {}),
    ...(r.p ? { p: JSON.parse(r.p) as LogParams } : {}),
  }));
}

/* ---- editable production templates (override built-ins; new projects only) ---- */
export function getTemplateOverride(svc: string): Template | null {
  const row = getDb().prepare('SELECT data FROM templates WHERE svc = ?').get(svc) as { data: string } | undefined;
  if (!row) return null;
  try { return JSON.parse(row.data) as Template; } catch { return null; }
}
export function getEffectiveTemplate(svc: string): Template {
  return getTemplateOverride(svc) || getBuiltinTemplate(svc);
}
export function saveTemplateOverride(svc: string, tpl: Template, by: string) {
  if (!SVC[svc]) throw new Error('unknown service');
  getDb()
    .prepare('INSERT INTO templates (svc, data, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(svc) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
    .run(svc, JSON.stringify(tpl), Date.now(), by);
}
export function resetTemplateOverride(svc: string) {
  getDb().prepare('DELETE FROM templates WHERE svc = ?').run(svc);
}
export function listTemplateOverrides(): { svc: string; updated_at: number; updated_by: string }[] {
  return getDb().prepare('SELECT svc, updated_at, updated_by FROM templates').all() as { svc: string; updated_at: number; updated_by: string }[];
}

/* ---- user editing (PD/BD); renames propagate to project ownership &
        assignments because matching is by name ---- */
export function updateUser(
  id: number,
  fields: { name?: string; email?: string; position?: string; role?: Role; pointCap?: number },
): User | undefined {
  const u = getUserById(id);
  if (!u) return undefined;
  const name = fields.name !== undefined ? fields.name : u.name;
  const email = fields.email !== undefined ? fields.email : u.email;
  const position = fields.position !== undefined ? fields.position : u.position;
  const role = fields.role !== undefined ? fields.role : u.role;
  const pointCap = fields.pointCap !== undefined ? Math.max(0, Math.round(fields.pointCap)) : (u.pointCap || 0);
  getDb()
    .prepare('UPDATE users SET name = ?, email = ?, position = ?, role = ?, point_cap = ? WHERE id = ?')
    .run(name, email, position, role, pointCap, id);
  if (name !== u.name) propagateRename(u.name, name);
  return { ...u, name, email, position, role, pointCap };
}

/* C6: store a compressed avatar dataURL (or clear it with ''). */
export function setUserAvatar(id: number, avatar: string): User | undefined {
  const u = getUserById(id);
  if (!u) return undefined;
  getDb().prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, id);
  return { ...u, avatar: avatar || undefined };
}

/* 改名:项目里按名字记的所有「职责」都跟着改(清单表见 lib/peopleRefs.ts),培训的指派 / 进度也跟着走。
   日志、收料记录这类「当时是谁做的」不改。一个事务里做完,中途出错就全不改。
   REQ-051 补全:以前漏了信息清单负责人、交接给谁、培训。 */
function propagateRename(oldName: string, newName: string) {
  const d = getDb();
  d.transaction(() => {
    for (const p of listProjects()) if (renameInProject(p, oldName, newName) > 0) saveProject(p);
    const paths = d.prepare('SELECT id, assignees FROM training_paths').all() as { id: string; assignees: string }[];
    for (const r of paths) {
      let list: unknown;
      try { list = JSON.parse(r.assignees || '[]'); } catch { continue; }
      if (!Array.isArray(list) || !list.includes(oldName)) continue;
      const next = [...new Set(list.map((n) => (n === oldName ? newName : n)))];
      d.prepare('UPDATE training_paths SET assignees = ? WHERE id = ?').run(JSON.stringify(next), r.id);
    }
    /* 进度按 (path_id, user_name) 唯一:新名字万一已经有一行(同名的人?)就别覆盖 */
    d.prepare('UPDATE OR IGNORE training_progress SET user_name = ? WHERE user_name = ?').run(newName, oldName);
    d.prepare('UPDATE training_attempts SET user_name = ? WHERE user_name = ?').run(newName, oldName);
  })();
}

/* ===== REQ-051 删除用户:先转交,再删 =====
   · 项目职责(PM / 工程师 / 编辑授权 / 服务包负责人 / 待接收的交接)→ to.projects
   · 没完成的排期任务 → to.tasks;没确认的信息清单项 → to.checklist
   · 已完成 / 已确认的、日志、收料记录:保留原名,显示「(已删除)」
   · 账号行不删,打上 deleted_at(同时停用)—— 登录、会话、指派下拉都认这个
   一个事务:转交和删除要么都成,要么都不成。 */
export function deleteUserWithHandover(id: number, to: { projects: string; tasks: string; checklist: string }, by: string):
  { projects: number; tasks: number; checklist: number; touched: number } | undefined {
  const u = getUserById(id);
  if (!u || u.deletedAt) return undefined;
  const d = getDb();
  const total = { projects: 0, tasks: 0, checklist: 0, touched: 0 };
  d.transaction(() => {
    const now = Date.now();
    for (const p of listProjects()) {
      const c = handOverWork(p, u.name, to);
      if (!c.projects && !c.tasks && !c.checklist) continue;
      const got = [c.projects && to.projects, c.tasks && to.tasks, c.checklist && to.checklist].filter(Boolean) as string[];
      const params = { from: u.name, who: [...new Set(got)].join('、'), n: c.projects + c.tasks + c.checklist };
      const e = { at: now, by, text: logZh('user.handover', params), k: 'user.handover', p: params };
      p.log = p.log || [];
      p.log.unshift(e);
      if (p.log.length > 200) p.log.length = 200;
      saveProject(p);
      appendAudit(p.id, [e]);
      total.projects += c.projects; total.tasks += c.tasks; total.checklist += c.checklist; total.touched++;
    }
    d.prepare('UPDATE users SET deleted_at = ?, disabled = 1 WHERE id = ?').run(now, id);
    appendAdminLog(by, 'user.delete', { name: u.name, toP: to.projects, toT: to.tasks, toC: to.checklist, n: total.touched });
  })();
  return total;
}

/* ===== REQ-051 管理日志(不属于某个项目的操作) ===== */
export function appendAdminLog(by: string, k: string, p?: LogParams) {
  getDb().prepare('INSERT INTO admin_log (at, by, text, k, p) VALUES (?, ?, ?, ?, ?)')
    .run(Date.now(), by, logZh(k, p), k, p ? JSON.stringify(p) : null);
}
export function listAdminLog(limit = 200): { at: number; by: string; text: string; k?: string; p?: LogParams }[] {
  const rows = getDb().prepare('SELECT at, by, text, k, p FROM admin_log ORDER BY at DESC, id DESC LIMIT ?')
    .all(limit) as { at: number; by: string; text: string; k: string | null; p: string | null }[];
  return rows.map((r) => ({ at: r.at, by: r.by, text: r.text, ...(r.k ? { k: r.k } : {}), ...(r.p ? { p: JSON.parse(r.p) as LogParams } : {}) }));
}

/* ===== REQ-051 权限表:存在 meta 表 perm.table =====
   没存过 = 默认值(= 现在代码的规则)。读出来一律过 sanitize:旧版本、手改、缺格都夹回 [下限, 上限]。
   服务端一次请求里会问很多遍,缓存 2 秒;保存时立刻失效。 */
const PERM_KEY = 'perm.table';
let permCache: { at: number; t: PermTable } | null = null;
export function getPermTable(): PermTable {
  if (permCache && Date.now() - permCache.at < 2000) return permCache.t;
  const row = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(PERM_KEY) as { value: string } | undefined;
  let t = defaultPermTable();
  if (row) { try { t = sanitizePermTable(JSON.parse(row.value)); } catch { /* 坏了就当默认 */ } }
  permCache = { at: Date.now(), t };
  return t;
}
/* 保存并记日志(每格一条);返回改了几格 */
export function savePermTable(raw: unknown, by: string): { table: PermTable; changed: number } {
  const before = getPermTable();
  const next = sanitizePermTable(raw);
  const diff = permDiff(before, next);
  if (!diff.length) return { table: before, changed: 0 };
  const d = getDb();
  d.transaction(() => {
    d.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(PERM_KEY, JSON.stringify(next));
    for (const c of diff) appendAdminLog(by, 'perm.change', { role: c.role, mod: c.module, lvFrom: c.from, lvTo: c.to });
  })();
  permCache = { at: Date.now(), t: next };
  return { table: next, changed: diff.length };
}
setServerPermSource(getPermTable);

/* ---- default accounts so the system is usable out of the box ---- */
function seedIfEmpty(d: Database.Database) {
  const count = (d.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
  if (count > 0) return;
  /* On real deployments the default accounts must change their password on
     first login; on the throwaway demo (Vercel) skip that friction. */
  const force = process.env.VERCEL || process.env.AUDAX_DEMO === '1' ? 0 : 1;
  const seed = d.prepare('INSERT INTO users (username, password_hash, name, role, must_change_pw, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const defaults: [string, string, string, Role][] = [
    ['pd', 'audax123', '总监 PD', 'director'],
    ['bd', 'audax123', 'BD', 'bd'],
    ['sales', 'audax123', '销售 Sales', 'sales'],
  ];
  for (const [username, pw, name, role] of defaults) {
    seed.run(username, hashPassword(pw), name, role, force, Date.now());
  }
}
