/* ===== AI ArchViz Director — Model-Direct (白模带灯光) domain types =====
   Mirrors the GPT-Vision structured output (Handbook §8) and the DB design
   (最终优化方案 §9 / Handbook §9), adapted for a client-only demo: no server
   persistence, no real render/AI backend — see src/lib/archviz/mockData.ts. */

export type Dcc = 'sketchup' | '3dsmax';

export type LightingType = 'exterior' | 'interior';

export interface LightingPreset {
  id: string;
  type: LightingType;
  name: [string, string]; // [zh, en]
  /** short mood/subtitle shown under the name in the picker */
  blurb: [string, string];
  params: {
    // exterior
    sunAzimuth?: number; // deg
    sunElevation?: number; // deg
    skyIntensity?: number; // 0-1
    shadowSoftness?: 'soft' | 'medium' | 'hard';
    // interior
    ambientLevel?: number; // 0-1
    colorTempK?: number;
    coveIntensity?: number; // 0-1
    keyLightIntensity?: number; // 0-1
  };
}

export type ModelStatus = 'uploaded' | 'parsing' | 'ready' | 'failed';

export interface ArchModel {
  id: string;
  name: string;
  dcc: Dcc;
  status: ModelStatus;
  bbox: { floors: number; footprintM: [number, number] };
  createdAt: number;
}

export type RunStage =
  | 'queued'
  | 'sampling'
  | 'lighting'
  | 'rendering'
  | 'pre_scoring'
  | 'vision_eval'
  | 'ranking'
  | 'completed';

export const RUN_STAGES: RunStage[] = [
  'queued', 'sampling', 'lighting', 'rendering', 'pre_scoring', 'vision_eval', 'ranking', 'completed',
];

export interface AnalysisRun {
  id: string;
  modelId: string;
  lightingPresetIds: string[];
  stage: RunStage;
  rendered: number;
  total: number;
  createdAt: number;
  completedAt?: number;
}

export type DesignerLabel = 'none' | 'promoted' | 'demoted' | 'rejected' | 'hero';

export interface DimensionScores {
  composition: number;
  lighting: number;
  showcaseRegion: number;
  perspective: number;
  depth: number;
}

export interface ShotCamera {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fovMm: number;
}

export interface ShotLighting {
  presetId: string;
  mood: [string, string];
  shadowQuality?: 'soft' | 'medium' | 'hard';
}

export interface Shot {
  id: string;
  runId: string;
  /** GET /api/archviz/frames/:frameId/image — absent only for legacy client-only mock shots */
  imageUrl?: string;
  rank: number;
  /** shots sharing a camGroup are the same camera under different lighting presets (Relight variants) */
  camGroup: string;
  seed: number;
  overallScore: number;
  heroScore: number;
  confidence: number;
  dimensionScores: DimensionScores;
  showcaseRegions: string[];
  showcaseCoverage: number;
  camera: ShotCamera;
  lighting: ShotLighting;
  marketingReason: [string, string];
  requiresRecapture: boolean;
  favorite: boolean;
  label: DesignerLabel;
  createdAt: number;
}

export type DesignerActionType =
  | 'view_detail' | 'compare' | 'favorite' | 'unfavorite' | 'export'
  | 'promote' | 'demote' | 'reject' | 'mark_hero' | 'request_recapture';

export interface DesignerAction {
  id: string;
  shotId: string;
  type: DesignerActionType;
  at: number;
}

export type ArchvizScreen = 'new' | 'progress' | 'board' | 'detail' | 'compare';
