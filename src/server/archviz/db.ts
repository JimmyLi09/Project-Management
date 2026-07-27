import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { LIGHTING_PRESETS } from '@/lib/archviz/presets';

/* Separate DB from the Audax project-management app (src/server/db.ts) —
   this module is a self-contained bolt-on with no relation to that domain,
   so it gets its own file rather than new tables mixed into audax.db. */
const DATA_DIR =
  process.env.ARCHVIZ_DATA_DIR ||
  (process.env.VERCEL ? '/tmp/archviz-data' : path.join(process.cwd(), 'data'));

let db: Database.Database | null = null;

export function getArchvizDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(path.join(DATA_DIR, 'archviz.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      dcc TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      file_blob BLOB NOT NULL,
      status TEXT NOT NULL,
      seed INTEGER NOT NULL,
      bbox_floors INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lighting_presets (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name_zh TEXT NOT NULL,
      name_en TEXT NOT NULL,
      blurb_zh TEXT NOT NULL,
      blurb_en TEXT NOT NULL,
      params_json TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS analysis_runs (
      id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL,
      lighting_preset_ids_json TEXT NOT NULL,
      stage TEXT NOT NULL,
      rendered INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL,
      pool_total INTEGER NOT NULL,
      pool_kept INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS render_jobs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      cam_index INTEGER NOT NULL,
      cam_group TEXT NOT NULL,
      preset_id TEXT NOT NULL,
      camera_json TEXT NOT NULL,
      dcc TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      claimed_by TEXT,
      claimed_at INTEGER,
      image_blob BLOB,
      real_bbox_json TEXT,
      error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_render_jobs_run ON render_jobs(run_id);
    CREATE INDEX IF NOT EXISTS idx_render_jobs_status ON render_jobs(status, dcc, created_at);

    CREATE TABLE IF NOT EXISTS frames (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      cam_group TEXT NOT NULL,
      preset_id TEXT NOT NULL,
      image_blob BLOB NOT NULL,
      blur_score REAL,
      exposure_score REAL,
      dup_hash TEXT,
      pre_score REAL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_frames_run ON frames(run_id);

    CREATE TABLE IF NOT EXISTS frame_evaluations (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      frame_id TEXT NOT NULL,
      cam_group TEXT NOT NULL,
      rank INTEGER NOT NULL DEFAULT 0,
      overall_score INTEGER NOT NULL,
      hero_score INTEGER NOT NULL,
      confidence REAL NOT NULL,
      dimension_scores_json TEXT NOT NULL,
      showcase_regions_json TEXT NOT NULL,
      marketing_reason_zh TEXT NOT NULL,
      marketing_reason_en TEXT NOT NULL,
      camera_json TEXT NOT NULL,
      preset_id TEXT NOT NULL,
      requires_recapture INTEGER NOT NULL DEFAULT 0,
      favorite INTEGER NOT NULL DEFAULT 0,
      label TEXT NOT NULL DEFAULT 'none',
      created_at INTEGER NOT NULL,
      UNIQUE(run_id, frame_id)
    );
    CREATE INDEX IF NOT EXISTS idx_frame_evals_run ON frame_evaluations(run_id, overall_score DESC);

    CREATE TABLE IF NOT EXISTS designer_actions (
      id TEXT PRIMARY KEY,
      shot_id TEXT NOT NULL,
      type TEXT NOT NULL,
      at INTEGER NOT NULL
    );
  `);
  seedLightingPresets(db);
  return db;
}

function seedLightingPresets(d: Database.Database) {
  const count = (d.prepare('SELECT COUNT(*) AS n FROM lighting_presets').get() as { n: number }).n;
  if (count > 0) return;
  const insert = d.prepare(`
    INSERT INTO lighting_presets (id, type, name_zh, name_en, blurb_zh, blurb_en, params_json, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `);
  const tx = d.transaction(() => {
    for (const p of LIGHTING_PRESETS) {
      insert.run(p.id, p.type, p.name[0], p.name[1], p.blurb[0], p.blurb[1], JSON.stringify(p.params));
    }
  });
  tx();
}

/* ---- worker bearer token (auto-generated + persisted so local/dev testing
   doesn't require setting an env var; set ARCHVIZ_WORKER_TOKEN in production
   so every render-node script can be issued the same fixed token) ---- */
export function getWorkerToken(): string {
  if (process.env.ARCHVIZ_WORKER_TOKEN) return process.env.ARCHVIZ_WORKER_TOKEN;
  const d = getArchvizDb();
  const row = d.prepare('SELECT value FROM meta WHERE key = ?').get('worker_token') as { value: string } | undefined;
  if (row) return row.value;
  const token = crypto.randomBytes(24).toString('hex');
  d.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('worker_token', token);
  return token;
}

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
