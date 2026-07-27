/* ===== Mock/demo data for AI ArchViz Director — Model-Direct =====
   There is no real render farm or GPT-Vision backend behind this prototype.
   This module simulates plausible pipeline output: a fixed lighting-preset
   catalog (Handbook §5.2 / 附录A) and a seeded shot generator producing
   ranked, structured evaluations shaped like the real GPT-Vision schema
   (Handbook §8). Mirrors the newProject()/seedDemo() fixture pattern used
   elsewhere in this repo (src/lib/project.ts, src/server/demo.ts). */

import type {
  ArchModel, DimensionScores, LightingPreset, Shot, ShotCamera,
} from './types';

/* ── seeded RNG (mulberry32) — deterministic per run so re-renders/reloads
   don't reshuffle already-generated shots ── */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const LIGHTING_PRESETS: LightingPreset[] = [
  {
    id: 'exterior_daylight_morning',
    type: 'exterior',
    name: ['室外 · 日照晨光', 'Exterior · Morning Daylight'],
    blurb: ['清晨柔和阴影，暖白天光', 'Soft morning shadows, cool clear sky'],
    params: { sunAzimuth: 120, sunElevation: 35, skyIntensity: 1.0, shadowSoftness: 'soft' },
  },
  {
    id: 'exterior_daylight_dusk',
    type: 'exterior',
    name: ['室外 · 日照黄昏', 'Exterior · Golden Dusk'],
    blurb: ['低角度长阴影，暖橙氛围', 'Low sun, long soft shadows, warm glow'],
    params: { sunAzimuth: 250, sunElevation: 12, skyIntensity: 0.7, shadowSoftness: 'soft' },
  },
  {
    id: 'interior_warm_ambient',
    type: 'interior',
    name: ['室内 · 暖色氛围光', 'Interior · Warm Ambient'],
    blurb: ['环形灯具 + 间接照明 + GI', 'Ring fixtures + cove indirect + GI bounce'],
    params: { ambientLevel: 0.6, colorTempK: 3200, coveIntensity: 0.8, keyLightIntensity: 0.55 },
  },
];

export const SHOWCASE_REGIONS: [string, string][] = [
  ['main_entrance', 'Main Entrance'],
  ['hero_massing', 'Hero Massing'],
  ['facade', 'Main Facade'],
  ['landscape', 'Landscape'],
  ['corner', 'Corner Turn'],
  ['skyline', 'Skyline'],
];

const REASON_TEMPLATES: Array<[string, string]> = [
  ['入口与标志形体在视觉重心，构图稳定，光影层次清晰。', 'Entrance and hero massing sit at the visual center; composition is stable with clear light/shadow layering.'],
  ['主立面完整入镜，透视消失点校正良好，纵深关系明确。', 'Main facade is fully framed, vanishing point well-corrected, strong sense of depth.'],
  ['转角处形体与景观同时可见，构图引导线自然汇聚。', 'The corner reveals both massing and landscape together, with leading lines converging naturally.'],
  ['俯瞰角度突出总体布局，天际线与场地关系一目了然。', 'The elevated angle emphasizes overall massing; skyline and site relationship read clearly.'],
  ['英雄角微仰视角强化建筑高度感，前景遮挡较少。', 'A slight hero-angle tilt emphasizes height, with minimal foreground occlusion.'],
];

function pick<T>(rnd: () => number, arr: T[]): T {
  return arr[Math.floor(rnd() * arr.length) % arr.length];
}

export function newModel(name: string, dcc: ArchModel['dcc']): ArchModel {
  return {
    id: 'model_' + Math.random().toString(36).slice(2, 9),
    name,
    dcc,
    status: 'ready',
    bbox: { floors: 3 + Math.floor(Math.random() * 12), footprintM: [30 + Math.random() * 60, 20 + Math.random() * 50] },
    createdAt: Date.now(),
  };
}

function camGroupCamera(rnd: () => number, i: number, total: number): ShotCamera {
  // turntable azimuth spread + weighted elevation/focal variety (Handbook §6 / v2 §4.3)
  const azimuth = Math.round((360 / total) * i + rnd() * 14 - 7);
  const elevationBand = pick(rnd, [1.6, 1.6, 1.6, 4.5, 12]); // eye-height dominant, occasional hero/overview
  const radius = 18 + rnd() * 34;
  const rad = (azimuth * Math.PI) / 180;
  return {
    position: [Math.round(Math.cos(rad) * radius * 10) / 10, Math.round(elevationBand * 10) / 10, Math.round(Math.sin(rad) * radius * 10) / 10],
    target: [0, 1.6, 0],
    up: [0, 1, 0],
    fovMm: pick(rnd, [24, 28, 35, 50]),
  };
}

/**
 * Generates ranked shots for a run: one camera turntable, rendered once per
 * selected lighting preset (Relight siblings share `camGroup`). Mirrors the
 * "先粗后精" flow — scores are pre-baked here rather than computed live,
 * since there's no real local-scoring/GPT-Vision stage to run.
 */
export function generateShots(runId: string, presetIds: string[], seed: number, cameraCount = 14): Shot[] {
  const rnd = mulberry32(seed);
  const presets = presetIds.length ? presetIds : [LIGHTING_PRESETS[0].id];
  const shots: Shot[] = [];

  for (let i = 0; i < cameraCount; i++) {
    const camGroup = `${runId}_cam${i}`;
    const camera = camGroupCamera(rnd, i, cameraCount);
    // base "quality" of this camera angle, shared across its lighting variants
    // so Relight comparisons look like the same shot under different light,
    // not unrelated random scores.
    const base = 58 + rnd() * 34;
    const regions = [...SHOWCASE_REGIONS].sort(() => rnd() - 0.5).slice(0, 1 + Math.floor(rnd() * 2)).map((r) => r[0]);

    for (const presetId of presets) {
      const preset = LIGHTING_PRESETS.find((p) => p.id === presetId) || LIGHTING_PRESETS[0];
      const jitter = (rnd() - 0.5) * 10;
      const composition = clamp(base + jitter + (rnd() - 0.5) * 8);
      const lighting = clamp(base + jitter + (rnd() - 0.4) * 14);
      const showcaseRegion = clamp(base + jitter + (rnd() - 0.5) * 10);
      const perspective = clamp(base + jitter + (rnd() - 0.5) * 8);
      const depth = clamp(base + jitter + (rnd() - 0.5) * 10);
      const dimensionScores: DimensionScores = { composition, lighting, showcaseRegion, perspective, depth };
      // marketing value = showcase x composition x lighting (v2 §4.4 / Handbook §7)
      const overallScore = Math.round(
        composition * 0.25 + lighting * 0.20 + showcaseRegion * 0.20 + perspective * 0.20 + depth * 0.15,
      );
      const heroScore = clamp(overallScore + (rnd() - 0.3) * 8);
      const requiresRecapture = rnd() < 0.12;

      shots.push({
        id: `${camGroup}_${presetId}`,
        runId,
        rank: 0, // assigned after sort
        camGroup,
        seed: Math.floor(rnd() * 1e9),
        overallScore,
        heroScore: Math.round(heroScore),
        confidence: Math.round((0.72 + rnd() * 0.25) * 100) / 100,
        dimensionScores,
        showcaseRegions: regions,
        showcaseCoverage: Math.round((0.45 + rnd() * 0.45) * 100) / 100,
        camera,
        lighting: {
          presetId: preset.id,
          mood: preset.type === 'exterior'
            ? (preset.id.includes('dusk') ? ['金色黄昏', 'Golden dusk'] : ['清澈晨光', 'Clear morning'])
            : ['暖色氛围', 'Warm ambient'],
          shadowQuality: preset.params.shadowSoftness || 'soft',
        },
        marketingReason: pick(rnd, REASON_TEMPLATES),
        requiresRecapture,
        favorite: false,
        label: 'none',
        createdAt: Date.now(),
      });
    }
  }

  shots.sort((a, b) => b.overallScore - a.overallScore);
  shots.forEach((s, idx) => { s.rank = idx + 1; });
  return shots;
}

function clamp(n: number): number {
  return Math.max(1, Math.min(99, Math.round(n)));
}
