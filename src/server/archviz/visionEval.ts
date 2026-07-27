/* ===== Stage 2: pluggable "vision" evaluator (Handbook §4 Stage 2 / §8) =====
   No GPT/Claude Vision API key exists yet, so Phase 1 ships a rule-based
   implementation — but one driven by the REAL Stage-1 pixel metrics
   (prescore.ts) and the shot's real camera geometry, not pure fabrication.
   Swap point for a real vision-model call later: replace the body of
   `evaluateFrame` with an actual API call that returns the same
   `VisionEvalResult` shape — every caller (render-jobs/[id]/complete) is
   already written against this interface. */

import type { DimensionScores, ShotCamera } from '@/lib/archviz/types';
import { SHOWCASE_REGIONS, REASON_TEMPLATES } from '@/lib/archviz/presets';
import { mulberry32, hashSeed, pick, clamp01to99 } from '@/lib/archviz/rng';
import type { PreScoreResult } from './prescore';

export interface VisionEvalContext {
  frameId: string;
  camera: ShotCamera;
  preScore: PreScoreResult;
}

export interface VisionEvalResult {
  dimensionScores: DimensionScores;
  overallScore: number;
  heroScore: number;
  confidence: number;
  showcaseRegions: string[];
  marketingReason: [string, string];
  requiresRecapture: boolean;
}

export async function evaluateFrame(ctx: VisionEvalContext): Promise<VisionEvalResult> {
  const rnd = mulberry32(hashSeed(ctx.frameId));
  const { blurScore, exposureScore } = ctx.preScore;

  // composition: real edge-energy signal (sharper frames read as more
  // deliberately composed in this stub) + seeded variety
  const composition = clamp01to99(50 + Math.min(40, blurScore) * 0.9 + (rnd() - 0.5) * 12);

  // lighting: driven by real exposure balance
  const lighting = clamp01to99(20 + exposureScore * 0.7 + (rnd() - 0.5) * 10);

  // showcase region: deterministic from the camera's real azimuth, not random
  const azimuth = (Math.atan2(ctx.camera.position[2], ctx.camera.position[0]) * 180) / Math.PI;
  const bucket = Math.floor((((azimuth % 360) + 360) % 360) / 60) % SHOWCASE_REGIONS.length;
  const showcaseRegions = [SHOWCASE_REGIONS[bucket][0], SHOWCASE_REGIONS[(bucket + 2) % SHOWCASE_REGIONS.length][0]];

  // perspective: eye-height cameras (per Handbook §6 sampling bands) read as
  // more "correct" than extreme overview/hero angles in this heuristic
  const targetY = ctx.camera.target[1] || 1;
  const elevRatio = ctx.camera.position[1] / targetY;
  const perspective = clamp01to99(85 - Math.abs(elevRatio - 1) * 18 + (rnd() - 0.5) * 10);

  // depth: cameras at a moderate distance read foreground/midground/background
  // layers better than extreme close/far shots
  const dist = Math.hypot(ctx.camera.position[0], ctx.camera.position[2]);
  const depth = clamp01to99(70 - Math.abs(dist - 45) * 0.6 + (rnd() - 0.5) * 10);

  const dimensionScores: DimensionScores = { composition, lighting, showcaseRegion: clamp01to99(60 + (rnd() - 0.5) * 20), perspective, depth };
  const overallScore = Math.round(
    dimensionScores.composition * 0.25 + dimensionScores.lighting * 0.20 + dimensionScores.showcaseRegion * 0.20
    + dimensionScores.perspective * 0.20 + dimensionScores.depth * 0.15,
  );
  const heroScore = clamp01to99(overallScore + (rnd() - 0.3) * 8);
  const confidence = Math.round(Math.min(0.97, 0.68 + Math.min(0.25, blurScore / 200)) * 100) / 100;

  // a genuinely blurry or badly-exposed frame is flagged for real, not randomly
  const requiresRecapture = blurScore < 6 || exposureScore < 35;

  return {
    dimensionScores, overallScore, heroScore, confidence, showcaseRegions,
    marketingReason: pick(rnd, REASON_TEMPLATES),
    requiresRecapture,
  };
}
