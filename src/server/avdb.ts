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

/* Called when a project is deleted, so its drawings do not outlive it. */
export function deleteProjectDrawings(projectId: string): void {
  const d = db();
  d.transaction(() => {
    d.prepare('DELETE FROM av_extraction WHERE drawing_id IN (SELECT id FROM av_drawing WHERE project_id = ?)').run(projectId);
    d.prepare('DELETE FROM av_drawing WHERE project_id = ?').run(projectId);
  })();
}
