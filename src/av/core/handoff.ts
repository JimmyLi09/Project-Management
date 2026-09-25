/* ===== 04 → 05 hand-off =====
   The JSON contract produced by services/drawing (avdrawing.ingest.cli) and the
   mapping of a reviewed ingest onto the §4.1 fields of LedConfig, carrying each
   value's provenance into the calculation chain (§9 / A9).

   The A10 gate itself is decided in Python: each record arrives with
   `needs_review`, and the server re-checks the gate on submission. This module
   only tracks what the PM has confirmed. */

import type { LedConfig, Method, Provenance } from './types.ts';

export type DrawingElement =
  | 'led_opening_w' | 'led_opening_h' | 'led_mount_h'
  | 'led_ctrl_dist' | 'led_pwr_dist' | 'led_view_min';

export const REQUIRED_ELEMENTS: DrawingElement[] = ['led_opening_w', 'led_opening_h'];

export interface IngestRecord {
  drawing: string;
  element: DrawingElement;
  value: number | null;
  unit: string;
  prov: { source: string; method: Method; confidence: number | 'deterministic' | 'confirmed'; rule: string | null; note: string | null };
  confirmed: boolean;
  corrected: number | null;
  corrected_by: string;
  corrected_at: string;
  needs_review: boolean;
}

export interface IngestResult {
  drawing: string;
  grade: 'A' | 'B' | 'C';
  scale_mm_per_unit: number;
  threshold: number;
  notes: string[];
  may_enter_configuration: boolean;
  extractions: IngestRecord[];
}

/* A drawing as stored against a project (spec §10 drawing + extraction). */
export interface StoredDrawing extends IngestResult {
  id: number;
  project_id: string;
  uploaded_by: string;
  uploaded_at: number;
  reviewed_by: string;
  reviewed_at: number;    // 0 until the A10 gate has passed; then the drawing is locked
}

export interface DrawingSummary {
  id: number;
  projectId: string;
  fileName: string;
  grade: IngestResult['grade'];
  uploadedBy: string;
  uploadedAt: number;
  reviewedBy: string;
  reviewedAt: number;
  pending: number;
}

export const finalValue = (r: IngestRecord): number | null => r.corrected ?? r.value;

/* Still open for this record: flagged for review and not yet confirmed, or a
   required element confirmed without a value (未识别项补录). Mirrors
   DrawingIngest.needs_review for the one case the screen can change. */
export const isPending = (r: IngestRecord): boolean =>
  r.confirmed ? REQUIRED_ELEMENTS.includes(r.element) && finalValue(r) === null : r.needs_review;

export interface Handoff {
  drawing: string;
  project?: string;       // project name, shown on 05 and in the drawing's information panel
  fields: Partial<Pick<LedConfig, DrawingElement>>;
  prov: Partial<Record<keyof LedConfig, Provenance>>;
}

export function toHandoff(result: IngestResult, project?: string): Handoff {
  const fields: Handoff['fields'] = {};
  const prov: Handoff['prov'] = {};
  for (const r of result.extractions) {
    const v = finalValue(r);
    if (v === null) continue;
    fields[r.element] = v;
    const corrected = r.corrected !== null && r.corrected !== r.value;
    prov[r.element] = corrected
      ? {
          source: r.prov.source, method: 'manual', confidence: 'confirmed',
          note: `人工修正：原值 ${r.value ?? '未识别'}${r.corrected_by ? `，${r.corrected_by}` : ''}`,
        }
      : {
          source: r.prov.source, method: r.prov.method, rule: r.prov.rule ?? undefined,
          confidence: r.confirmed ? 'confirmed' : r.prov.confidence,
          note: r.prov.note ?? undefined,
        };
  }
  return { drawing: result.drawing, project, fields, prov };
}
