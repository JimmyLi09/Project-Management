import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Project, Role, User } from '@/lib/types';
import { migrate } from '@/lib/project';

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
  `);
  migrateSchema(db);
  seedIfEmpty(db);
  maybeSeedDemo(db);
  scheduleBackups(db);
  return db;
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
  if (fs.existsSync(target)) return; // already have today's snapshot
  await d.backup(target); // online-safe snapshot via SQLite backup API
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
export function getUserById(id: number) {
  return getDb()
    .prepare('SELECT id, username, name, role, email, position FROM users WHERE id = ?')
    .get(id) as User | undefined;
}
export function listUsers(): User[] {
  return getDb()
    .prepare('SELECT id, username, name, role, email, position FROM users ORDER BY id')
    .all() as User[];
}
export function createUser(
  username: string, password: string, name: string, role: Role,
  email = '', position = '',
): User {
  const info = getDb()
    .prepare('INSERT INTO users (username, password_hash, name, role, email, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(username, hashPassword(password), name, role, email, position, Date.now());
  return { id: Number(info.lastInsertRowid), username, name, role, email, position };
}

/* ---- projects (stored as JSON documents; all mutations happen server-side) ---- */
export function listProjects(): Project[] {
  const rows = getDb().prepare('SELECT data FROM projects ORDER BY created_at DESC').all() as { data: string }[];
  return rows.map((r) => migrate(JSON.parse(r.data)));
}
export function getProject(id: string): Project | undefined {
  const row = getDb().prepare('SELECT data FROM projects WHERE id = ?').get(id) as { data: string } | undefined;
  return row ? migrate(JSON.parse(row.data)) : undefined;
}
export function insertProject(p: Project) {
  getDb()
    .prepare('INSERT INTO projects (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(p.id, JSON.stringify(p), p.created, Date.now());
}
export function saveProject(p: Project) {
  getDb()
    .prepare('UPDATE projects SET data = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(p), Date.now(), p.id);
}
export function deleteProject(id: string) {
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
}

/* ---- default accounts so the system is usable out of the box ---- */
function seedIfEmpty(d: Database.Database) {
  const count = (d.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
  if (count > 0) return;
  const seed = d.prepare('INSERT INTO users (username, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?)');
  const defaults: [string, string, string, Role][] = [
    ['pd', 'audax123', '总监 PD', 'director'],
    ['bd', 'audax123', 'BD', 'bd'],
    ['sales', 'audax123', '销售 Sales', 'sales'],
  ];
  for (const [username, pw, name, role] of defaults) {
    seed.run(username, hashPassword(pw), name, role, Date.now());
  }
}
