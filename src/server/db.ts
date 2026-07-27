import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Project, Role, User } from '@/lib/types';
import { migrate } from '@/lib/project';
import { getBuiltinTemplate, SVC, type Template } from '@/lib/templates';

/* On serverless platforms (Vercel) the project directory is read-only and
   ephemeral — keep the demo database in /tmp there. */
const DATA_DIR =
  process.env.AUDAX_DATA_DIR ||
  (process.env.VERCEL ? '/tmp/audax-data' : path.join(process.cwd(), 'data'));

let db: Database.Database | null = null;

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
      text TEXT NOT NULL
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
  backfillIds(db);
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
    const need = (obj.packages || []).some((pk: any) =>
      (pk.schedule || []).some((x: any) => !x.id) ||
      (pk.checklist || []).some((g: any) => (g.items || []).some((it: any) => !it.id || it.shot !== undefined || !Array.isArray(it.shots))));
    if (!need) continue;
    const m = migrate(obj);
    const { updatedAt: _drop, ...data } = m as any;
    upd.run(JSON.stringify(data), r.id);
  }
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
  /* v2.2 §4.2 [P0-3]: optimistic-lock version on projects */
  const pcols = (d.prepare('PRAGMA table_info(projects)').all() as { name: string }[]).map((c) => c.name);
  if (!pcols.includes('version')) d.exec('ALTER TABLE projects ADD COLUMN version INTEGER NOT NULL DEFAULT 0');
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
const USER_COLS = 'id, username, name, role, email, position, must_change_pw AS mustChangePassword, disabled, avatar, point_cap AS pointCap';
function rowToUser(r: Record<string, unknown> | undefined): User | undefined {
  if (!r) return undefined;
  return {
    id: r.id as number, username: r.username as string, name: r.name as string, role: r.role as Role,
    email: (r.email as string) || '', position: (r.position as string) || '',
    mustChangePassword: !!r.mustChangePassword, disabled: !!r.disabled,
    avatar: (r.avatar as string) || undefined,
    pointCap: (r.pointCap as number) || 0,
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

/* ---- permanent audit trail (project logs are capped at 200 in-document;
        every entry is also appended here and never rotated) ---- */
export function appendAudit(projectId: string, entries: { at: number; by: string; text: string }[]) {
  if (!entries.length) return;
  const ins = getDb().prepare('INSERT INTO audit_log (project_id, at, by, text) VALUES (?, ?, ?, ?)');
  for (const e of entries) ins.run(projectId, e.at, e.by, e.text);
}
export function listAudit(projectId: string, limit = 1000) {
  return getDb()
    .prepare('SELECT at, by, text FROM audit_log WHERE project_id = ? ORDER BY at DESC LIMIT ?')
    .all(projectId, limit) as { at: number; by: string; text: string }[];
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

function propagateRename(oldName: string, newName: string) {
  for (const p of listProjects()) {
    let changed = false;
    if ((p.owners || []).includes(oldName)) { p.owners = p.owners.map((n) => (n === oldName ? newName : n)); changed = true; }
    if ((p.perm || []).includes(oldName)) { p.perm = p.perm.map((n) => (n === oldName ? newName : n)); changed = true; }
    p.packages.forEach((pk) => {
      if (pk.owner === oldName) { pk.owner = newName; changed = true; }
      pk.schedule.forEach((r) => { if (r.assignee === oldName) { r.assignee = newName; changed = true; } });
    });
    if (changed) saveProject(p);
  }
}

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
