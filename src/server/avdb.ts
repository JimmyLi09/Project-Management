/* ===== AV platform · drawing review persistence (spec v1.0 §10) =====
   `drawing` and `extraction`, prefixed av_ so the AV tables stay recognisable
   (and liftable) inside the shared database. A drawing belongs to a project;
   each of its six extractions keeps the extracted value and the reviewed value
   side by side ("同时保留原始与修正").

   Review progress is saved as the PM works. Passing the A10 gate stamps
   reviewed_at and locks the drawing: a later change means a new upload, so the
   record of what was confirmed, by whom, never moves under anyone's feet. */

import { getDb } from './db';
import { DEMO_CASES, shouldSeedDemo } from './demo';
import type { DrawingElement, DrawingSummary, IngestRecord, IngestResult, StoredDrawing } from '@/av/core/handoff';
import type { CostLine, PriceItem, SavedConfig, SummaryBase } from '@/av/core/pricing';
import type { QuoteSection } from '@/av/core/quote';
import type { Deduction } from '@/av/core/xline';
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
      CREATE TABLE IF NOT EXISTS av_quote (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        sections TEXT NOT NULL,
        discount_pct REAL NOT NULL,
        gst_rate REAL NOT NULL,
        margin_floor REAL NOT NULL,
        dedup TEXT NOT NULL DEFAULT '[]',
        reason TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'submitted',
        submitted_by TEXT NOT NULL,
        submitted_at INTEGER NOT NULL,
        decided_by TEXT NOT NULL DEFAULT '',
        decided_at INTEGER NOT NULL DEFAULT 0,
        decision_note TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS av_case (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_sheet TEXT NOT NULL,
        status TEXT NOT NULL,
        ref_no TEXT,
        year INTEGER,
        name TEXT NOT NULL,
        client TEXT,
        address TEXT,
        width_mm REAL,
        height_mm REAL,
        sqm REAL,
        pitch REAL,
        modules INTEGER,
        kw REAL,
        power_cable TEXT,
        data_cable TEXT,
        product TEXT,
        remarks TEXT,
        imported_by TEXT NOT NULL,
        imported_at INTEGER NOT NULL
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
    /* quotations saved before cross-line savings existed */
    const qcols = (d.prepare('PRAGMA table_info(av_quote)').all() as { name: string }[]).map((c) => c.name);
    if (!qcols.includes('dedup')) d.exec("ALTER TABLE av_quote ADD COLUMN dedup TEXT NOT NULL DEFAULT '[]'");

    /* ===== AV-014 · 人工修改与跨导入的身份 =====
       av_case 仍然只存统计表导入的原始值 —— 导入逻辑不变,人看到的值是
       「原始值叠加人工值」。人工值单独放 av_case_edit,所以重新导入整张表
       也冲不掉它。Handover date / 保修期没有统计表来源,同样放这张表。

       case_key 是一块屏跨多次导入的身份,由**原始导入值**算(见 caseKeyOf)。
       missing = 统计表里已经没有它了,但有人工修改所以留着。 */
    const ccols = (d.prepare('PRAGMA table_info(av_case)').all() as { name: string }[]).map((c) => c.name);
    if (!ccols.includes('case_key')) d.exec("ALTER TABLE av_case ADD COLUMN case_key TEXT NOT NULL DEFAULT ''");
    if (!ccols.includes('missing')) d.exec('ALTER TABLE av_case ADD COLUMN missing INTEGER NOT NULL DEFAULT 0');
    d.exec(`
      CREATE TABLE IF NOT EXISTS av_case_edit (
        case_key TEXT NOT NULL,
        field TEXT NOT NULL,
        value TEXT NOT NULL,      /* '' = 人工清空,与「没改过」区分开 */
        edited_by TEXT NOT NULL,
        edited_at INTEGER NOT NULL,
        PRIMARY KEY (case_key, field)
      );
      /* 改前 → 改后。公司级数据不挂项目,所以不走 audit_log,自带一张,
         与价格库的 av_price_history 同一路子。k + p 供 i18n 渲染。 */
      CREATE TABLE IF NOT EXISTS av_case_edit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_key TEXT NOT NULL,
        at INTEGER NOT NULL,
        by TEXT NOT NULL,
        k TEXT NOT NULL,
        p TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_av_case_edit_log ON av_case_edit_log(case_key, at DESC);
      CREATE INDEX IF NOT EXISTS idx_av_case_key ON av_case(case_key);
    `);
    /* AV-012 时代导入的行没有 case_key —— 按同一套规则补算一次,补完它们
       才认得出自己,以后重新导入不会被当成新屏。

       判断条件是「有行、但一行都没有 key」,而不是「这次启动刚加了这一列」:
       要是加完列、补算之前进程挂了,下次启动列已经在了,按后一种判断就再也
       不补 —— 所有行 key 都是空串,编辑一块屏会同时改到所有屏。补算本身在
       一个事务里,要么全补上要么一行没动,所以「一行都没 key」恰好就是遗留
       状态。已经有 key 的库绝不重算:重新导入后保留下来的旧行与新行 id 交错,
       重算会把重复屏的序号排乱,和人工修改对不上。 */
    const keyed = d.prepare("SELECT count(*) AS n, SUM(case_key <> '') AS k FROM av_case").get() as { n: number; k: number | null };
    if (keyed.n > 0 && !keyed.k) backfillCaseKeys(d);
    /* 演示模式(Vercel 预览)没有 Python,导入不了统计表,案例库空着就什么都验
       不了 —— 放一批示例屏。库里已经有屏就不动。内网服务器不开演示模式。 */
    else if (keyed.n === 0 && shouldSeedDemo()) seedDemoCases(d);
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
    d.prepare('DELETE FROM av_quote WHERE project_id = ?').run(projectId);
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

/* ===== 07 quotations =====
   A quotation freezes the sections it was built from, the discount, the GST
   rate and the margin floor of the day, so the document reads the same later.
   So are the cross-line savings it took off (xline.ts).
   Submitting a new one supersedes a quotation still waiting for approval. */

export type QuoteStatus = 'submitted' | 'approved' | 'rejected' | 'superseded';

export interface Quote {
  id: number;
  projectId: string;
  sections: QuoteSection[];
  dedup: Deduction[];
  discountPct: number;
  gstRate: number;
  marginFloor: number;
  reason: string;
  status: QuoteStatus;
  submittedBy: string;
  submittedAt: number;
  decidedBy: string;
  decidedAt: number;
  decisionNote: string;
}

type QuoteRow = { id: number; project_id: string; sections: string; dedup: string; discount_pct: number; gst_rate: number; margin_floor: number;
  reason: string; status: string; submitted_by: string; submitted_at: number; decided_by: string; decided_at: number; decision_note: string };
const toQuote = (r: QuoteRow): Quote => ({
  id: r.id, projectId: r.project_id, sections: JSON.parse(r.sections), dedup: JSON.parse(r.dedup), discountPct: r.discount_pct, gstRate: r.gst_rate,
  marginFloor: r.margin_floor, reason: r.reason, status: r.status as QuoteStatus, submittedBy: r.submitted_by,
  submittedAt: r.submitted_at, decidedBy: r.decided_by, decidedAt: r.decided_at, decisionNote: r.decision_note,
});

export function createQuote(q: Pick<Quote, 'projectId' | 'sections' | 'dedup' | 'discountPct' | 'gstRate' | 'marginFloor' | 'reason'>, by: string): Quote {
  const d = db();
  const id = d.transaction(() => {
    d.prepare("UPDATE av_quote SET status = 'superseded' WHERE project_id = ? AND status = 'submitted'").run(q.projectId);
    return Number(d.prepare(`INSERT INTO av_quote (project_id, sections, dedup, discount_pct, gst_rate, margin_floor, reason, submitted_by, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(q.projectId, JSON.stringify(q.sections), JSON.stringify(q.dedup), q.discountPct, q.gstRate, q.marginFloor, q.reason, by, Date.now()).lastInsertRowid);
  })();
  return getQuote(id)!;
}

export function getQuote(id: number): Quote | null {
  const r = db().prepare('SELECT * FROM av_quote WHERE id = ?').get(id) as QuoteRow | undefined;
  return r ? toQuote(r) : null;
}

export function listQuotes(projectId: string): Quote[] {
  return (db().prepare('SELECT * FROM av_quote WHERE project_id = ? ORDER BY id DESC').all(projectId) as QuoteRow[]).map(toQuote);
}

/* Only a quotation still waiting can be decided; false when it no longer is. */
export function decideQuote(id: number, status: 'approved' | 'rejected', by: string, note: string): boolean {
  return db().prepare(`UPDATE av_quote SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ? AND status = 'submitted'`)
    .run(status, by, Date.now(), note, id).changes === 1;
}

/* ===== 历史案例 (ported from avcost-phase1, 2026-09-28; AV-014 2026-09-29) =====
   公司的《All the Project Links》统计表是正本,案例库是它两张 LED 工作表的
   可检索副本。

   AV-014 之后多了一层:人可以在平台上直接改。原始导入值仍然只存在 av_case
   (导入逻辑不变),人工值另放 av_case_edit —— 所以「重新导入整张表」冲不掉
   人改过的东西。页面看到的 = 原始值叠加人工值,下面统一叫**有效值**。

   排序和筛选都按有效值算,而且都在 SQL 里做:列表有 500 条上限,前端排序
   只排得到前 500 条,那是错的。 */

/** 保修期默认 12 个月(AV-014 §3.3)。等于默认值时不写 av_case_edit ——
 *  不然每块屏都挂一条「人工修改」,「已人工修改 · N 项」就没意义了。 */
export const DEFAULT_WARRANTY_MONTHS = 12;

export interface HistCase {
  id: number;
  sourceSheet: string;
  status: 'ongoing' | 'completed';
  refNo: string | null;
  year: number | null;
  name: string;
  client: string | null;
  address: string | null;
  widthMm: number | null;
  heightMm: number | null;
  sqm: number | null;
  pitch: number | null;
  modules: number | null;
  kw: number | null;
  powerCable: string | null;
  dataCable: string | null;
  product: string | null;
  remarks: string | null;
}

/** 页面拿到的一块屏:有效值 + AV-014 新增的几样。 */
export interface CaseRow extends HistCase {
  caseKey: string;
  /** 统计表里已经没有它了,但有人工修改所以留着(AV-014 §4) */
  missing: boolean;
  handover: string | null;          // YYYY-MM-DD,手填
  warrantyMonths: number;           // 默认 12
  expire: string | null;            // = handover + warrantyMonths,自动算
  /** 年份列显示的值:统计表年份,没有就取交付年份(§3.3) */
  effYear: number | null;
  manualFields: string[];           // 人工改过哪些字段
}

type FieldType = 'text' | 'int' | 'real';
interface CaseField { key: string; col: string | null; type: FieldType }

/* 可编辑字段。col = null 表示统计表里没有这一项(交付日期、保修期),
   它们只可能来自人工填写。 */
const CASE_FIELDS: CaseField[] = [
  { key: 'name', col: 'name', type: 'text' },
  { key: 'client', col: 'client', type: 'text' },
  { key: 'year', col: 'year', type: 'int' },
  { key: 'address', col: 'address', type: 'text' },
  { key: 'status', col: 'status', type: 'text' },
  { key: 'refNo', col: 'ref_no', type: 'text' },
  { key: 'widthMm', col: 'width_mm', type: 'real' },
  { key: 'heightMm', col: 'height_mm', type: 'real' },
  { key: 'sqm', col: 'sqm', type: 'real' },
  { key: 'pitch', col: 'pitch', type: 'real' },
  { key: 'product', col: 'product', type: 'text' },
  { key: 'modules', col: 'modules', type: 'int' },
  { key: 'kw', col: 'kw', type: 'real' },
  { key: 'powerCable', col: 'power_cable', type: 'text' },
  { key: 'dataCable', col: 'data_cable', type: 'text' },
  { key: 'remarks', col: 'remarks', type: 'text' },
  { key: 'handover', col: null, type: 'text' },
  { key: 'warrantyMonths', col: null, type: 'int' },
];
export const CASE_FIELD_KEYS = CASE_FIELDS.map((f) => f.key);
const FIELD_BY_KEY = new Map(CASE_FIELDS.map((f) => [f.key, f]));

/* ---- 有效值视图 ----
   e 把 av_case_edit 竖表转成每块屏一行;v 逐字段叠加;w 再算依赖叠加结果的
   两样(到期日、年份口径)—— SQLite 不让在同一个 SELECT 里引用自己的别名,
   所以分了一层。 */
const editExpr = (f: CaseField) => {
  const e = `e."${f.key}"`;
  const cast = f.type === 'text' ? e : `CAST(${e} AS ${f.type === 'int' ? 'INTEGER' : 'REAL'})`;
  if (!f.col) {
    const dflt = f.key === 'warrantyMonths' ? String(DEFAULT_WARRANTY_MONTHS) : 'NULL';
    return `CASE WHEN ${e} IS NULL OR ${e} = '' THEN ${dflt} ELSE ${cast} END AS "${f.key}"`;
  }
  /* value = '' 是「人工清空」,与「没改过」(NULL)必须分得开 */
  return `CASE WHEN ${e} IS NULL THEN c.${f.col} WHEN ${e} = '' THEN NULL ELSE ${cast} END AS "${f.key}"`;
};

const EFF_VIEW = `
  WITH e AS (
    SELECT case_key,
      ${CASE_FIELDS.map((f) => `MAX(CASE WHEN field = '${f.key}' THEN value END) AS "${f.key}"`).join(',\n      ')},
      count(*) AS manualCount, group_concat(field) AS manualList
    FROM av_case_edit GROUP BY case_key
  ),
  v AS (
    SELECT c.id, c.case_key AS caseKey, c.missing, c.source_sheet AS sourceSheet,
      ${CASE_FIELDS.map(editExpr).join(',\n      ')},
      IFNULL(e.manualCount, 0) AS manualCount, e.manualList
    FROM av_case c LEFT JOIN e ON e.case_key = c.case_key
  ),
  w AS (
    SELECT v.*,
      /* SQLite 的月加法会把溢出的日子进位(1 月 31 日 + 1 个月 = 3 月 3 日),
         与前端 Date.setMonth 一致 —— 两边算出来的到期日不会打架。 */
      CASE WHEN handover IS NOT NULL AND handover <> ''
           THEN date(handover, '+' || warrantyMonths || ' months') END AS expire,
      CASE WHEN year IS NOT NULL THEN year
           WHEN handover IS NOT NULL AND handover <> '' THEN CAST(strftime('%Y', handover) AS INTEGER) END AS effYear
    FROM v
  )`;

export interface CaseFilter {
  q?: string;
  status?: string;
  pitchMin?: number;
  pitchMax?: number;
  sqmMin?: number;
  sqmMax?: number;
  /** 年份多选,'none' = 未填年份(§3.2) */
  years?: string[];
  clients?: string[];
}

/* 排序白名单。前端传来的列名绝不拼进 ORDER BY —— 只认这张表里的 key。 */
const SORTS: Record<string, { expr: string; def: 'asc' | 'desc' }> = {
  sqm: { expr: 'sqm', def: 'desc' },
  year: { expr: 'effYear', def: 'desc' },
  handover: { expr: 'handover', def: 'desc' },
  expire: { expr: 'expire', def: 'asc' },
  name: { expr: 'lower(name)', def: 'asc' },
  client: { expr: 'lower(client)', def: 'asc' },
  pitch: { expr: 'pitch', def: 'asc' },
  kw: { expr: 'kw', def: 'desc' },
};
export const CASE_SORT_KEYS = Object.keys(SORTS);
export const caseSortDefaultDir = (k: string): 'asc' | 'desc' => SORTS[k]?.def ?? 'desc';

type CaseDbRow = Omit<CaseRow, 'missing' | 'manualFields'> & { missing: number; manualList: string | null };

const toCaseRow = (r: CaseDbRow): CaseRow => ({
  ...r,
  missing: !!r.missing,
  manualFields: r.manualList ? r.manualList.split(',') : [],
});

export function searchCases(
  f: CaseFilter,
  sortKey = 'sqm',
  dir?: 'asc' | 'desc',
  limit = 500,
): { cases: CaseRow[]; total: number } {
  const where: string[] = [];
  const args: (string | number)[] = [];
  const q = f.q?.trim();
  if (q) {
    where.push(`(name || ' ' || IFNULL(client,'') || ' ' || IFNULL(address,'') || ' ' || IFNULL(product,'') || ' ' ||
      IFNULL(refNo,'') || ' ' || IFNULL(remarks,'')) LIKE ? ESCAPE '\\'`);
    args.push(`%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
  }
  if (f.status) { where.push('status = ?'); args.push(f.status); }
  for (const [col, lo, hi] of [['pitch', f.pitchMin, f.pitchMax], ['sqm', f.sqmMin, f.sqmMax]] as const) {
    if (lo !== undefined) { where.push(`${col} >= ?`); args.push(lo); }
    if (hi !== undefined) { where.push(`${col} <= ?`); args.push(hi); }
  }
  /* 同一类里多选是 OR,类与类之间是 AND(§3.2) */
  if (f.years?.length) {
    const ys = f.years.filter((y) => y === 'none' || /^\d{4}$/.test(y));
    if (ys.length) {
      const nums = ys.filter((y) => y !== 'none');
      const parts: string[] = [];
      if (nums.length) { parts.push(`effYear IN (${nums.map(() => '?').join(',')})`); args.push(...nums.map(Number)); }
      if (ys.includes('none')) parts.push('effYear IS NULL');
      where.push(`(${parts.join(' OR ')})`);
    }
  }
  if (f.clients?.length) {
    where.push(`client IN (${f.clients.map(() => '?').join(',')})`);
    args.push(...f.clients);
  }

  const s = SORTS[sortKey] ?? SORTS.sqm;
  const d = (dir === 'asc' || dir === 'desc') ? dir : s.def;
  /* 空值永远排最后,不论升降序(§3.1);同值按导入顺序稳定排。 */
  const order = `${s.expr} IS NULL, ${s.expr} ${d === 'asc' ? 'ASC' : 'DESC'}, id`;
  const cond = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const conn = db();
  const total = (conn.prepare(`${EFF_VIEW} SELECT count(*) AS n FROM w ${cond}`).get(...args) as { n: number }).n;
  const rows = conn.prepare(`${EFF_VIEW} SELECT * FROM w ${cond} ORDER BY ${order} LIMIT ?`)
    .all(...args, limit) as CaseDbRow[];
  return { cases: rows.map(toCaseRow), total };
}

/** 「筛选」浮层的选项:整个库里出现过的年份与客户,各带块屏数(§3.2)。
 *  口径与年份列显示值一致 —— 用的是同一个 effYear。 */
export function caseFacets(): { years: { year: string; n: number }[]; clients: { client: string; n: number }[] } {
  const conn = db();
  const years = conn.prepare(`${EFF_VIEW}
    SELECT IFNULL(CAST(effYear AS TEXT), 'none') AS year, count(*) AS n FROM w
    GROUP BY effYear ORDER BY effYear IS NULL, effYear DESC`).all() as { year: string; n: number }[];
  const clients = conn.prepare(`${EFF_VIEW}
    SELECT client, count(*) AS n FROM w WHERE client IS NOT NULL AND client <> ''
    GROUP BY client ORDER BY lower(client)`).all() as { client: string; n: number }[];
  return { years, clients };
}

/* ---- case_key:一块屏跨多次导入的身份(§4) ----
   用**原始导入值**算,不用编辑后的值 —— 否则谁改了项目名,下次导入就对不
   上了。不含工作表 / 状态:项目从「进行中」表挪到「已完成」表,人工修改要
   跟着走。 */
const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const mm = (v: number | null | undefined) => (v == null ? '' : String(Math.round(v)));

export const caseKeyOf = (c: Pick<HistCase, 'name' | 'client' | 'widthMm' | 'heightMm'>) =>
  [norm(c.name), norm(c.client), mm(c.widthMm), mm(c.heightMm)].join('|');

/** 同一次导入里完全相同的多块屏(8SW 那种)加出现序号区分。 */
function keysFor(cases: Pick<HistCase, 'name' | 'client' | 'widthMm' | 'heightMm'>[]): string[] {
  const seen = new Map<string, number>();
  return cases.map((c) => {
    const base = caseKeyOf(c);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  });
}

/** 演示模式的示例屏(数据在 demo.ts)。直接用传进来的连接写 —— 这时还在
 *  db() 的初始化里,调 db() 会重入。交付日期 / 非默认保修期走 av_case_edit,
 *  和真人填的一模一样,所以页面上会标「已人工修改」,那是如实的。 */
function seedDemoCases(d: ReturnType<typeof getDb>): void {
  const rows = DEMO_CASES.map((c) => ({
    sourceSheet: c.sheet === 'ongoing' ? 'LED ongoing project' : 'LED completed project',
    status: c.sheet, refNo: c.refNo, year: c.year, name: c.name, client: c.client, address: c.address,
    widthMm: c.w, heightMm: c.h, sqm: c.sqm, pitch: c.pitch, modules: c.modules, kw: c.kw,
    powerCable: c.pc, dataCable: c.dc, product: c.product, remarks: c.remarks,
  }));
  const keys = keysFor(rows);
  const at = Date.now();
  const ins = d.prepare(`INSERT INTO av_case (case_key, missing, source_sheet, status, ref_no, year, name, client, address,
    width_mm, height_mm, sqm, pitch, modules, kw, power_cable, data_cable, product, remarks, imported_by, imported_at)
    VALUES (@caseKey, 0, @sourceSheet, @status, @refNo, @year, @name, @client, @address,
    @widthMm, @heightMm, @sqm, @pitch, @modules, @kw, @powerCable, @dataCable, @product, @remarks, '演示数据', @at)`);
  const edit = d.prepare('INSERT INTO av_case_edit (case_key, field, value, edited_by, edited_at) VALUES (?, ?, ?, ?, ?)');
  d.transaction(() => {
    rows.forEach((r, i) => {
      ins.run({ ...r, caseKey: keys[i], at });
      const c = DEMO_CASES[i];
      if (c.handover) edit.run(keys[i], 'handover', c.handover, '演示数据', at);
      if (c.warrantyMonths !== DEFAULT_WARRANTY_MONTHS) edit.run(keys[i], 'warrantyMonths', String(c.warrantyMonths), '演示数据', at);
    });
  })();
}

/** AV-012 时代导入的行没有 case_key,补算一次。 */
function backfillCaseKeys(d: ReturnType<typeof getDb>): void {
  const rows = d.prepare('SELECT id, name, client, width_mm AS widthMm, height_mm AS heightMm FROM av_case ORDER BY id')
    .all() as { id: number; name: string; client: string | null; widthMm: number | null; heightMm: number | null }[];
  if (!rows.length) return;
  const keys = keysFor(rows);
  const up = d.prepare('UPDATE av_case SET case_key = ? WHERE id = ?');
  d.transaction(() => { rows.forEach((r, i) => up.run(keys[i], r.id)); })();
}

/* ---- 重新导入(§4)----
   两步:先 dry-run 出预览,确认后才写。统计表是正本,但人改过的字段和手填
   的交付日期 / 保修期一律保留。 */
export interface ImportPreview {
  added: number;
  updated: number;
  manualFields: number;      // 会保留的人工字段数
  manualScreens: number;     // 涉及几块屏
  handoverKept: number;      // 保留了手填交付日期的屏
  removed: number;           // 统计表里没有了、也没人改过 → 移除
  keptMissing: number;       // 统计表里没有了、但有人工修改 → 保留并标记
}

const val = (v: unknown): string => (v == null ? '' : String(v));
/** 人工值与原始值是否已经一样了 —— 数值按数比,文本按串比。 */
function sameAsRaw(f: CaseField, edit: string, raw: unknown): boolean {
  if (f.type === 'text') return edit === val(raw);
  if (edit === '') return raw == null;
  const a = Number(edit);
  return Number.isFinite(a) && raw != null && a === Number(raw);
}

export function applyImport(
  incoming: Omit<HistCase, 'id'>[],
  by: string,
  opts: { dryRun?: boolean } = {},
): ImportPreview {
  const d = db();
  const keys = keysFor(incoming);
  const incomingKeys = new Set(keys);
  const existing = new Set((d.prepare('SELECT DISTINCT case_key FROM av_case').all() as { case_key: string }[]).map((r) => r.case_key));
  const editedKeys = new Set((d.prepare('SELECT DISTINCT case_key FROM av_case_edit').all() as { case_key: string }[]).map((r) => r.case_key));

  const gone = [...existing].filter((k) => !incomingKeys.has(k));
  const keptMissing = gone.filter((k) => editedKeys.has(k));
  const removed = gone.filter((k) => !editedKeys.has(k));
  /* 留下来的屏(新导入的 + 标记保留的)身上有多少人工字段会被保住 */
  const survivors = new Set([...incomingKeys, ...keptMissing]);
  const edits = d.prepare('SELECT case_key, field FROM av_case_edit').all() as { case_key: string; field: string }[];
  const kept = edits.filter((e) => survivors.has(e.case_key));

  const preview: ImportPreview = {
    added: keys.filter((k) => !existing.has(k)).length,
    updated: keys.filter((k) => existing.has(k)).length,
    manualFields: kept.length,
    manualScreens: new Set(kept.map((e) => e.case_key)).size,
    handoverKept: kept.filter((e) => e.field === 'handover').length,
    removed: removed.length,
    keptMissing: keptMissing.length,
  };
  if (opts.dryRun) return preview;

  const ins = d.prepare(`INSERT INTO av_case (case_key, missing, source_sheet, status, ref_no, year, name, client, address,
    width_mm, height_mm, sqm, pitch, modules, kw, power_cable, data_cable, product, remarks, imported_by, imported_at)
    VALUES (@caseKey, 0, @sourceSheet, @status, @refNo, @year, @name, @client, @address,
    @widthMm, @heightMm, @sqm, @pitch, @modules, @kw, @powerCable, @dataCable, @product, @remarks, @by, @at)`);
  const at = Date.now();
  d.transaction(() => {
    /* 没人改过又不在新表里的 → 连行带记录一起走 */
    for (const k of removed) {
      d.prepare('DELETE FROM av_case WHERE case_key = ?').run(k);
      d.prepare('DELETE FROM av_case_edit WHERE case_key = ?').run(k);
      d.prepare('DELETE FROM av_case_edit_log WHERE case_key = ?').run(k);
    }
    /* 有人工修改但不在新表里的 → 留着,打上标记供人判断 */
    for (const k of keptMissing) d.prepare('UPDATE av_case SET missing = 1 WHERE case_key = ?').run(k);
    /* 新表里的:原始行整条换掉(人工值不在这张表里,冲不掉) */
    for (const k of incomingKeys) d.prepare('DELETE FROM av_case WHERE case_key = ?').run(k);
    incoming.forEach((c, i) => ins.run({ ...c, caseKey: keys[i], by, at }));

    /* 新统计表的值已经和人工值一样了 → 清掉那条人工标记(§4),
       不然页面会一直挂着「已人工修改」,而其实没差别了。 */
    const raws = d.prepare('SELECT case_key, ' + CASE_FIELDS.filter((f) => f.col).map((f) => `${f.col} AS "${f.key}"`).join(', ')
      + ' FROM av_case').all() as Record<string, unknown>[];
    const rawBy = new Map(raws.map((r) => [String(r.case_key), r]));
    for (const e of d.prepare('SELECT case_key, field, value FROM av_case_edit').all() as { case_key: string; field: string; value: string }[]) {
      const f = FIELD_BY_KEY.get(e.field);
      const raw = rawBy.get(e.case_key);
      if (!f || !f.col || !raw) continue;
      if (sameAsRaw(f, e.value, raw[f.key])) {
        d.prepare('DELETE FROM av_case_edit WHERE case_key = ? AND field = ?').run(e.case_key, e.field);
      }
    }
  })();
  return preview;
}

/* ---- 逐块屏编辑(§3.4)---- */
export interface CaseEditResult { row: CaseRow; changes: { field: string; from: string; to: string }[] }

const show = (v: unknown): string => (v == null || v === '' ? '' : String(v));

/** 写人工值。与原始值相同的字段不写(或删掉已有的那条),这样
 *  「已人工修改」只标真正跟统计表不一样的地方。
 *
 *  revert 列出的字段直接把人工值删掉,回去跟着统计表走 —— 没有这条的话,
 *  改错一个数字就只能凭记忆把统计表里那个数原样打回来(空字符串是「人工
 *  清空」,不等于「不改了」)。 */
export function editCase(
  caseKey: string,
  fields: Record<string, string>,
  by: string,
  revert: string[] = [],
): CaseEditResult | null {
  const d = db();
  const before = getCase(caseKey);
  if (!before) return null;
  const raw = d.prepare(`SELECT ${CASE_FIELDS.filter((f) => f.col).map((f) => `${f.col} AS "${f.key}"`).join(', ')}
    FROM av_case WHERE case_key = ?`).get(caseKey) as Record<string, unknown> | undefined;
  if (!raw) return null;

  const at = Date.now();
  d.transaction(() => {
    for (const key of revert) {
      if (FIELD_BY_KEY.has(key)) d.prepare('DELETE FROM av_case_edit WHERE case_key = ? AND field = ?').run(caseKey, key);
    }
    for (const [key, v] of Object.entries(fields)) {
      if (revert.includes(key)) continue;          // 刚恢复的字段别又被表单里的旧值写回去
      const f = FIELD_BY_KEY.get(key);
      if (!f) continue;                       // 不认的字段一律忽略
      const value = v.trim();
      const isDefault = !f.col
        ? (f.key === 'warrantyMonths' ? Number(value) === DEFAULT_WARRANTY_MONTHS : value === '')
        : sameAsRaw(f, value, raw[f.key]);
      if (isDefault) d.prepare('DELETE FROM av_case_edit WHERE case_key = ? AND field = ?').run(caseKey, key);
      else d.prepare(`INSERT INTO av_case_edit (case_key, field, value, edited_by, edited_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(case_key, field) DO UPDATE SET value = excluded.value, edited_by = excluded.edited_by, edited_at = excluded.edited_at`)
        .run(caseKey, key, value, by, at);
    }
  })();

  const row = getCase(caseKey)!;
  const changes = CASE_FIELDS
    .map((f) => ({ field: f.key, from: show((before as unknown as Record<string, unknown>)[f.key]), to: show((row as unknown as Record<string, unknown>)[f.key]) }))
    .filter((c) => c.from !== c.to);
  return { row, changes };
}

/** 同一项目的其它屏(AV-014 §7「同步到本项目其它屏」)。
 *  「同一项目」按页面上看到的项目名 + 客户认(有效值,去首尾空白、不分大小写)——
 *  不用 case_key:它是按原始导入值算的,谁改过项目名就对不上了,而人判断
 *  「这是不是同一个项目」看的是页面上那个名字。 */
export function caseSiblings(caseKey: string): CaseRow[] {
  const me = getCase(caseKey);
  if (!me) return [];
  const rows = db().prepare(`${EFF_VIEW} SELECT * FROM w
    WHERE lower(trim(name)) = lower(trim(?)) AND lower(trim(IFNULL(client, ''))) = lower(trim(?)) AND caseKey <> ?
    ORDER BY id`).all(me.name, me.client ?? '', caseKey) as CaseDbRow[];
  return rows.map(toCaseRow);
}

/** 同步时一并带过去的字段:只有交付与保修。尺寸、面积这些每块屏各不相同。 */
export const CASE_SYNC_FIELDS = ['handover', 'warrantyMonths'] as const;

export function getCase(caseKey: string): CaseRow | null {
  const r = db().prepare(`${EFF_VIEW} SELECT * FROM w WHERE caseKey = ?`).get(caseKey) as CaseDbRow | undefined;
  return r ? toCaseRow(r) : null;
}

export function appendCaseLog(caseKey: string, by: string, k: string, p: Record<string, unknown>): void {
  db().prepare('INSERT INTO av_case_edit_log (case_key, at, by, k, p) VALUES (?, ?, ?, ?, ?)')
    .run(caseKey, Date.now(), by, k, JSON.stringify(p));
}

export function caseLog(caseKey: string, limit = 20): { at: number; by: string; k: string; p: Record<string, unknown> }[] {
  return (db().prepare('SELECT at, by, k, p FROM av_case_edit_log WHERE case_key = ? ORDER BY at DESC, id DESC LIMIT ?')
    .all(caseKey, limit) as { at: number; by: string; k: string; p: string }[])
    .map((r) => ({ ...r, p: JSON.parse(r.p) as Record<string, unknown> }));
}

export function caseLibraryInfo(): { count: number; importedBy: string; importedAt: number } {
  const r = db().prepare('SELECT count(*) AS count, MAX(imported_by) AS importedBy, MAX(imported_at) AS importedAt FROM av_case').get() as
    { count: number; importedBy: string | null; importedAt: number | null };
  return { count: r.count, importedBy: r.importedBy ?? '', importedAt: r.importedAt ?? 0 };
}
