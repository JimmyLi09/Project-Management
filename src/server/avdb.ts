/* ===== AV platform · drawing review persistence (spec v1.0 §10) =====
   `drawing` and `extraction`, prefixed av_ so the AV tables stay recognisable
   (and liftable) inside the shared database. A drawing belongs to a project;
   each of its six extractions keeps the extracted value and the reviewed value
   side by side ("同时保留原始与修正").

   Review progress is saved as the PM works. Passing the A10 gate stamps
   reviewed_at and locks the drawing: a later change means a new upload, so the
   record of what was confirmed, by whom, never moves under anyone's feet. */

import { getDb } from './db';
import type { DrawingElement, DrawingSummary, IngestRecord, IngestResult, StoredDrawing } from '@/av/core/handoff';
import type { CostLine, PriceItem, SavedConfig, SummaryBase } from '@/av/core/pricing';
import type { BusinessLine } from '@/av/core/types';

export type { DrawingSummary, StoredDrawing };

let ready = false;
function db() {
  const d = getDb();
  if (!ready) {
    d.exec(`
      CREATE TABLE IF NOT EXISTS av_drawing (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        line TEXT NOT NULL DEFAULT 'led',
        file_name TEXT NOT NULL,
        grade TEXT NOT NULL,
        scale_mm_per_unit REAL NOT NULL,
        threshold REAL NOT NULL,
        notes TEXT NOT NULL,
        uploaded_by TEXT NOT NULL,
        uploaded_at INTEGER NOT NULL,
        reviewed_by TEXT NOT NULL DEFAULT '',
        reviewed_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_av_drawing_project ON av_drawing(project_id, uploaded_at DESC);
      /* 01 立项询价: what the project was opened for, and which rule-pack version
         each business line is bound to (§5: 历史项目锁定其创建时的版本). */
      CREATE TABLE IF NOT EXISTS av_inquiry (
        project_id TEXT PRIMARY KEY,
        location TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        lines TEXT NOT NULL,
        packs TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      /* Price library. Prices change: every edit to a price or its validity
         leaves a row in av_price_history, and cost sheets keep their own
         snapshot of the prices they used. */
      CREATE TABLE IF NOT EXISTS av_price_item (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        line TEXT NOT NULL,
        category TEXT NOT NULL,
        category_label TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT '',
        pitch TEXT NOT NULL DEFAULT '',
        module_size TEXT NOT NULL DEFAULT '',
        cabinet_size TEXT NOT NULL DEFAULT '',
        unit TEXT NOT NULL,
        cost_price REAL,
        list_price REAL,
        currency TEXT NOT NULL DEFAULT 'SGD',
        source TEXT NOT NULL DEFAULT '',
        valid_until TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        updated_by TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS av_price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        cost_price REAL,
        list_price REAL,
        valid_until TEXT NOT NULL DEFAULT '',
        changed_by TEXT NOT NULL,
        changed_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS av_setting (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_by TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL DEFAULT 0
      );
      /* §10 config_result: each save of a 05 configuration against a project. */
      CREATE TABLE IF NOT EXISTS av_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        line TEXT NOT NULL,
        pack_version TEXT NOT NULL,
        drawing_id INTEGER,
        cfg TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS av_cost_sheet (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        line TEXT NOT NULL,
        config_id INTEGER NOT NULL,
        lines TEXT NOT NULL,
        cost REAL NOT NULL,
        list REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        confirmed_by TEXT NOT NULL DEFAULT '',
        confirmed_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS av_extraction (
        drawing_id INTEGER NOT NULL REFERENCES av_drawing(id) ON DELETE CASCADE,
        element TEXT NOT NULL,
        value REAL,
        unit TEXT NOT NULL,
        source TEXT NOT NULL,
        method TEXT NOT NULL,
        confidence TEXT NOT NULL,
        rule TEXT,
        note TEXT,
        needs_review INTEGER NOT NULL,
        confirmed INTEGER NOT NULL DEFAULT 0,
        confirmed_by TEXT NOT NULL DEFAULT '',
        corrected REAL,
        corrected_by TEXT NOT NULL DEFAULT '',
        corrected_at TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (drawing_id, element)
      );
    `);
    ready = true;
  }
  return d;
}

type ExtractionRow = {
  element: DrawingElement; value: number | null; unit: string; source: string; method: string;
  confidence: string; rule: string | null; note: string | null; needs_review: number;
  confirmed: number; confirmed_by: string; corrected: number | null; corrected_by: string; corrected_at: string;
};
type DrawingRow = {
  id: number; project_id: string; file_name: string; grade: string; scale_mm_per_unit: number;
  threshold: number; notes: string; uploaded_by: string; uploaded_at: number; reviewed_by: string; reviewed_at: number;
};

export function insertDrawing(projectId: string, result: IngestResult, by: string): number {
  const d = db();
  const now = Date.now();
  const tx = d.transaction(() => {
    const { lastInsertRowid } = d.prepare(`
      INSERT INTO av_drawing (project_id, file_name, grade, scale_mm_per_unit, threshold, notes, uploaded_by, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(projectId, result.drawing, result.grade, result.scale_mm_per_unit, result.threshold,
        JSON.stringify(result.notes), by, now);
    const ins = d.prepare(`
      INSERT INTO av_extraction (drawing_id, element, value, unit, source, method, confidence, rule, note, needs_review)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const r of result.extractions) {
      ins.run(lastInsertRowid, r.element, r.value, r.unit, r.prov.source, r.prov.method,
        JSON.stringify(r.prov.confidence), r.prov.rule, r.prov.note, r.needs_review ? 1 : 0);
    }
    return Number(lastInsertRowid);
  });
  return tx();
}

export function getDrawing(id: number): StoredDrawing | null {
  const d = db();
  const row = d.prepare('SELECT * FROM av_drawing WHERE id = ?').get(id) as DrawingRow | undefined;
  if (!row) return null;
  const rows = d.prepare('SELECT * FROM av_extraction WHERE drawing_id = ? ORDER BY rowid').all(id) as ExtractionRow[];
  const extractions: IngestRecord[] = rows.map((r) => ({
    drawing: row.file_name,
    element: r.element,
    value: r.value,
    unit: r.unit,
    prov: {
      source: r.source, method: r.method as IngestRecord['prov']['method'],
      confidence: JSON.parse(r.confidence), rule: r.rule, note: r.note,
    },
    confirmed: !!r.confirmed,
    corrected: r.corrected,
    corrected_by: r.corrected_by,
    corrected_at: r.corrected_at,
    needs_review: !!r.needs_review,
  }));
  return {
    id: row.id,
    project_id: row.project_id,
    drawing: row.file_name,
    grade: row.grade as IngestResult['grade'],
    scale_mm_per_unit: row.scale_mm_per_unit,
    threshold: row.threshold,
    notes: JSON.parse(row.notes),
    may_enter_configuration: row.reviewed_at > 0,
    extractions,
    uploaded_by: row.uploaded_by,
    uploaded_at: row.uploaded_at,
    reviewed_by: row.reviewed_by,
    reviewed_at: row.reviewed_at,
  };
}

export function listDrawings(projectId: string): DrawingSummary[] {
  return (db().prepare(`
    SELECT d.id, d.project_id, d.file_name, d.grade, d.uploaded_by, d.uploaded_at, d.reviewed_by, d.reviewed_at,
      (SELECT COUNT(*) FROM av_extraction e WHERE e.drawing_id = d.id AND e.needs_review = 1 AND e.confirmed = 0) AS pending
    FROM av_drawing d WHERE d.project_id = ? ORDER BY d.uploaded_at DESC, d.id DESC`).all(projectId) as {
      id: number; project_id: string; file_name: string; grade: string; uploaded_by: string; uploaded_at: number;
      reviewed_by: string; reviewed_at: number; pending: number;
    }[]).map((r) => ({
      id: r.id, projectId: r.project_id, fileName: r.file_name, grade: r.grade as IngestResult['grade'],
      uploadedBy: r.uploaded_by, uploadedAt: r.uploaded_at, reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at,
      pending: r.pending,
    }));
}

export interface ReviewChange {
  element: DrawingElement;
  confirmed: boolean;
  corrected: number | null;
}

/* Apply the PM's confirmations to the stored drawing. Only `confirmed` and
   `corrected` are taken from the request; value, provenance and needs_review
   stay as the drawing service extracted them. Who and when come from the
   session. Returns the updated drawing. */
export function applyReview(id: number, changes: ReviewChange[], by: string): StoredDrawing {
  const d = db();
  const current = getDrawing(id);
  if (!current) throw new Error('图纸不存在');
  if (current.reviewed_at) throw new Error('该图纸已完成校核并锁定；如需修改请重新上传。');
  const known = new Map(current.extractions.map((r) => [r.element, r]));
  const at = new Date().toISOString();
  const upd = d.prepare(`
    UPDATE av_extraction SET confirmed = ?, confirmed_by = ?, corrected = ?, corrected_by = ?, corrected_at = ?
    WHERE drawing_id = ? AND element = ?`);
  d.transaction(() => {
    for (const c of changes) {
      const r = known.get(c.element);
      if (!r) throw new Error(`未知要素 ${c.element}`);
      const corrected = c.confirmed && c.corrected !== null && Number.isFinite(c.corrected) && c.corrected !== r.value
        ? Number(c.corrected) : null;
      if (corrected !== null && corrected < 0) throw new Error(`${c.element} 的人工值须为非负数`);
      /* keep the original stamp when an already-corrected value is re-sent unchanged */
      const same = corrected !== null && corrected === r.corrected;
      upd.run(
        c.confirmed ? 1 : 0, c.confirmed ? by : '',
        corrected, corrected === null ? '' : same ? r.corrected_by : by, corrected === null ? '' : same ? r.corrected_at : at,
        id, c.element,
      );
    }
  })();
  return getDrawing(id)!;
}

export function markReviewed(id: number, by: string): void {
  db().prepare('UPDATE av_drawing SET reviewed_by = ?, reviewed_at = ? WHERE id = ? AND reviewed_at = 0').run(by, Date.now(), id);
}

export interface Inquiry {
  projectId: string;
  location: string;
  notes: string;
  lines: BusinessLine[];
  packs: Partial<Record<BusinessLine, string>>;
  createdBy: string;
  createdAt: number;
}

/* Runs `createProject` and records the inquiry in one transaction, so a project
   never exists half-opened. */
export function openInquiry(inq: Omit<Inquiry, 'createdAt'>, createProject: () => void): Inquiry {
  const d = db();
  const createdAt = Date.now();
  d.transaction(() => {
    createProject();
    d.prepare(`INSERT INTO av_inquiry (project_id, location, notes, lines, packs, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(inq.projectId, inq.location, inq.notes, JSON.stringify(inq.lines), JSON.stringify(inq.packs), inq.createdBy, createdAt);
  })();
  return { ...inq, createdAt };
}

export function getInquiry(projectId: string): Inquiry | null {
  const r = db().prepare('SELECT * FROM av_inquiry WHERE project_id = ?').get(projectId) as {
    project_id: string; location: string; notes: string; lines: string; packs: string; created_by: string; created_at: number;
  } | undefined;
  if (!r) return null;
  return {
    projectId: r.project_id, location: r.location, notes: r.notes,
    lines: JSON.parse(r.lines), packs: JSON.parse(r.packs), createdBy: r.created_by, createdAt: r.created_at,
  };
}

/* Called when a project is deleted, so its drawings and inquiry do not outlive it. */
export function deleteProjectDrawings(projectId: string): void {
  const d = db();
  d.transaction(() => {
    d.prepare('DELETE FROM av_inquiry WHERE project_id = ?').run(projectId);
    d.prepare('DELETE FROM av_config WHERE project_id = ?').run(projectId);
    d.prepare('DELETE FROM av_cost_sheet WHERE project_id = ?').run(projectId);
    d.prepare('DELETE FROM av_extraction WHERE drawing_id IN (SELECT id FROM av_drawing WHERE project_id = ?)').run(projectId);
    d.prepare('DELETE FROM av_drawing WHERE project_id = ?').run(projectId);
  })();
}

/* ===== price library ===== */

type PriceRow = {
  id: number; line: string; category: string; category_label: string; model: string; pitch: string;
  module_size: string; cabinet_size: string; unit: string; cost_price: number | null; list_price: number | null;
  currency: string; source: string; valid_until: string; active: number; updated_by: string; updated_at: number;
};
const toItem = (r: PriceRow): PriceItem => ({
  id: r.id, line: r.line as BusinessLine, category: r.category, categoryLabel: r.category_label, model: r.model,
  pitch: r.pitch, moduleSize: r.module_size, cabinetSize: r.cabinet_size, unit: r.unit, costPrice: r.cost_price,
  listPrice: r.list_price, currency: r.currency, source: r.source, validUntil: r.valid_until, active: !!r.active,
  updatedBy: r.updated_by, updatedAt: r.updated_at,
});

export function listPriceItems(line?: BusinessLine): PriceItem[] {
  const rows = (line
    ? db().prepare('SELECT * FROM av_price_item WHERE line = ? ORDER BY id').all(line)
    : db().prepare('SELECT * FROM av_price_item ORDER BY line, id').all()) as PriceRow[];
  return rows.map(toItem);
}

export type PriceInput = Omit<PriceItem, 'id' | 'updatedBy' | 'updatedAt'>;

export function createPriceItem(it: PriceInput, by: string): PriceItem {
  const d = db();
  const now = Date.now();
  const { lastInsertRowid } = d.prepare(`
    INSERT INTO av_price_item (line, category, category_label, model, pitch, module_size, cabinet_size, unit,
      cost_price, list_price, currency, source, valid_until, active, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(it.line, it.category, it.categoryLabel, it.model, it.pitch, it.moduleSize, it.cabinetSize, it.unit,
      it.costPrice, it.listPrice, it.currency, it.source, it.validUntil, it.active ? 1 : 0, by, now);
  const id = Number(lastInsertRowid);
  d.prepare('INSERT INTO av_price_history (item_id, cost_price, list_price, valid_until, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, it.costPrice, it.listPrice, it.validUntil, by, now);
  return toItem(d.prepare('SELECT * FROM av_price_item WHERE id = ?').get(id) as PriceRow);
}

/* Edit an item. A change to either price or to the validity date is kept in
   the history, so "what did this cost in June" stays answerable. */
export function updatePriceItem(id: number, patch: Partial<PriceInput>, by: string): PriceItem {
  const d = db();
  const cur = d.prepare('SELECT * FROM av_price_item WHERE id = ?').get(id) as PriceRow | undefined;
  if (!cur) throw new Error('价格条目不存在');
  const next = { ...toItem(cur), ...patch };
  const now = Date.now();
  d.transaction(() => {
    d.prepare(`UPDATE av_price_item SET category = ?, category_label = ?, model = ?, pitch = ?, module_size = ?,
      cabinet_size = ?, unit = ?, cost_price = ?, list_price = ?, currency = ?, source = ?, valid_until = ?, active = ?,
      updated_by = ?, updated_at = ? WHERE id = ?`)
      .run(next.category, next.categoryLabel, next.model, next.pitch, next.moduleSize, next.cabinetSize, next.unit,
        next.costPrice, next.listPrice, next.currency, next.source, next.validUntil, next.active ? 1 : 0, by, now, id);
    if (next.costPrice !== cur.cost_price || next.listPrice !== cur.list_price || next.validUntil !== cur.valid_until) {
      d.prepare('INSERT INTO av_price_history (item_id, cost_price, list_price, valid_until, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, next.costPrice, next.listPrice, next.validUntil, by, now);
    }
  })();
  return toItem(d.prepare('SELECT * FROM av_price_item WHERE id = ?').get(id) as PriceRow);
}

export function priceHistory(itemId: number) {
  return db().prepare('SELECT cost_price, list_price, valid_until, changed_by, changed_at FROM av_price_history WHERE item_id = ? ORDER BY changed_at DESC, id DESC')
    .all(itemId) as { cost_price: number | null; list_price: number | null; valid_until: string; changed_by: string; changed_at: number }[];
}

/* Import a price list. Rows already present (same source, category, model,
   pitch and cabinet) are skipped, so importing twice does not duplicate. */
export function importPriceItems(items: PriceInput[], by: string): { added: number; skipped: number } {
  const d = db();
  const exists = d.prepare(`SELECT 1 FROM av_price_item WHERE source = ? AND category = ? AND model = ? AND pitch = ? AND cabinet_size = ? AND line = ?`);
  let added = 0, skipped = 0;
  d.transaction(() => {
    for (const it of items) {
      if (exists.get(it.source, it.category, it.model, it.pitch, it.cabinetSize, it.line)) { skipped++; continue; }
      createPriceItem(it, by);
      added++;
    }
  })();
  return { added, skipped };
}

/* ===== company settings ===== */

export const MARGIN_FLOOR_DEFAULT = 0.18; // the prototype's 公司下限 18%

export function getMarginFloor(): number {
  const r = db().prepare("SELECT value FROM av_setting WHERE key = 'margin_floor'").get() as { value: string } | undefined;
  return r ? Number(r.value) : MARGIN_FLOOR_DEFAULT;
}

export function setMarginFloor(v: number, by: string): void {
  db().prepare(`INSERT INTO av_setting (key, value, updated_by, updated_at) VALUES ('margin_floor', ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .run(String(v), by, Date.now());
}

/* ===== 05 configuration saves (§10 config_result) ===== */

export function saveConfig<S extends SummaryBase>(c: Omit<SavedConfig<S>, 'id' | 'createdAt'>, cfg: unknown): SavedConfig<S> {
  const createdAt = Date.now();
  const { lastInsertRowid } = db().prepare(`INSERT INTO av_config (project_id, line, pack_version, drawing_id, cfg, summary, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(c.projectId, c.line, c.packVersion, c.drawingId, JSON.stringify(cfg), JSON.stringify(c.summary), c.createdBy, createdAt);
  return { ...c, id: Number(lastInsertRowid), createdAt };
}

type ConfigRow = { id: number; project_id: string; line: string; pack_version: string; drawing_id: number | null; cfg: string; summary: string; created_by: string; created_at: number };

export function latestConfig<S extends SummaryBase = SummaryBase>(projectId: string, line: BusinessLine): (SavedConfig<S> & { cfg: unknown }) | null {
  const r = db().prepare('SELECT * FROM av_config WHERE project_id = ? AND line = ? ORDER BY id DESC LIMIT 1').get(projectId, line) as ConfigRow | undefined;
  return r ? {
    id: r.id, projectId: r.project_id, line: r.line as BusinessLine, packVersion: r.pack_version, drawingId: r.drawing_id,
    summary: JSON.parse(r.summary) as S, createdBy: r.created_by, createdAt: r.created_at, cfg: JSON.parse(r.cfg),
  } : null;
}

/* ===== cost sheets ===== */

export interface CostSheet {
  id: number;
  projectId: string;
  line: BusinessLine;
  configId: number;
  lines: CostLine[];
  cost: number;
  list: number;
  status: 'draft' | 'confirmed';
  createdBy: string;
  createdAt: number;
  confirmedBy: string;
  confirmedAt: number;
}

type SheetRow = { id: number; project_id: string; line: string; config_id: number; lines: string; cost: number; list: number;
  status: string; created_by: string; created_at: number; confirmed_by: string; confirmed_at: number };
const toSheet = (r: SheetRow): CostSheet => ({
  id: r.id, projectId: r.project_id, line: r.line as BusinessLine, configId: r.config_id, lines: JSON.parse(r.lines),
  cost: r.cost, list: r.list, status: r.status as CostSheet['status'], createdBy: r.created_by, createdAt: r.created_at,
  confirmedBy: r.confirmed_by, confirmedAt: r.confirmed_at,
});

export function saveCostSheet(s: Pick<CostSheet, 'projectId' | 'line' | 'configId' | 'lines' | 'cost' | 'list'>, by: string, confirm: boolean): CostSheet {
  const now = Date.now();
  const { lastInsertRowid } = db().prepare(`INSERT INTO av_cost_sheet (project_id, line, config_id, lines, cost, list, status, created_by, created_at, confirmed_by, confirmed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(s.projectId, s.line, s.configId, JSON.stringify(s.lines), s.cost, s.list, confirm ? 'confirmed' : 'draft', by, now,
      confirm ? by : '', confirm ? now : 0);
  return toSheet(db().prepare('SELECT * FROM av_cost_sheet WHERE id = ?').get(Number(lastInsertRowid)) as SheetRow);
}

export function latestCostSheet(projectId: string, line: BusinessLine): CostSheet | null {
  const r = db().prepare('SELECT * FROM av_cost_sheet WHERE project_id = ? AND line = ? ORDER BY id DESC LIMIT 1').get(projectId, line) as SheetRow | undefined;
  return r ? toSheet(r) : null;
}
