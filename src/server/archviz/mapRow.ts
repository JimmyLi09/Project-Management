import type { AnalysisRun, ArchModel, Shot } from '@/lib/archviz/types';
import { presetById } from '@/lib/archviz/presets';

export function rowToModel(row: any): ArchModel {
  return {
    id: row.id,
    name: row.name,
    dcc: row.dcc,
    status: row.status,
    bbox: { floors: row.bbox_floors, footprintM: [0, 0] },
    createdAt: row.created_at,
  };
}

export function rowToRun(row: any): AnalysisRun {
  return {
    id: row.id,
    modelId: row.model_id,
    lightingPresetIds: JSON.parse(row.lighting_preset_ids_json),
    stage: row.stage,
    rendered: row.rendered,
    total: row.total,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  };
}

export function rowToShot(row: any): Shot {
  const preset = presetById(row.preset_id);
  const isDusk = preset.id.includes('dusk');
  const mood: [string, string] = preset.type === 'exterior'
    ? (isDusk ? ['金色黄昏', 'Golden dusk'] : ['清澈晨光', 'Clear morning'])
    : ['暖色氛围', 'Warm ambient'];
  return {
    id: row.frame_id,
    runId: row.run_id,
    imageUrl: `/api/archviz/frames/${row.frame_id}/image`,
    rank: row.rank,
    camGroup: row.cam_group,
    seed: 0,
    overallScore: row.overall_score,
    heroScore: row.hero_score,
    confidence: row.confidence,
    dimensionScores: JSON.parse(row.dimension_scores_json),
    showcaseRegions: JSON.parse(row.showcase_regions_json),
    showcaseCoverage: 0.6,
    camera: JSON.parse(row.camera_json),
    lighting: {
      presetId: row.preset_id,
      mood,
      shadowQuality: preset.params.shadowSoftness,
    },
    marketingReason: [row.marketing_reason_zh, row.marketing_reason_en],
    requiresRecapture: !!row.requires_recapture,
    favorite: !!row.favorite,
    label: row.label,
    createdAt: row.created_at,
  };
}
