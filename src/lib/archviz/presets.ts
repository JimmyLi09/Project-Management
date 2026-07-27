/* ===== Shared vocabulary — imported by both client views (lighting picker,
   labels) and the server (run seeding, marketing-reason generation). Single
   source of truth so the frontend and backend can never drift apart. ===== */

import type { LightingPreset } from './types';

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

export function presetById(id: string): LightingPreset {
  return LIGHTING_PRESETS.find((p) => p.id === id) || LIGHTING_PRESETS[0];
}

export const SHOWCASE_REGIONS: [string, string][] = [
  ['main_entrance', 'Main Entrance'],
  ['hero_massing', 'Hero Massing'],
  ['facade', 'Main Facade'],
  ['landscape', 'Landscape'],
  ['corner', 'Corner Turn'],
  ['skyline', 'Skyline'],
];

export const REASON_TEMPLATES: Array<[string, string]> = [
  ['入口与标志形体在视觉重心，构图稳定，光影层次清晰。', 'Entrance and hero massing sit at the visual center; composition is stable with clear light/shadow layering.'],
  ['主立面完整入镜，透视消失点校正良好，纵深关系明确。', 'Main facade is fully framed, vanishing point well-corrected, strong sense of depth.'],
  ['转角处形体与景观同时可见，构图引导线自然汇聚。', 'The corner reveals both massing and landscape together, with leading lines converging naturally.'],
  ['俯瞰角度突出总体布局，天际线与场地关系一目了然。', 'The elevated angle emphasizes overall massing; skyline and site relationship read clearly.'],
  ['英雄角微仰视角强化建筑高度感，前景遮挡较少。', 'A slight hero-angle tilt emphasizes height, with minimal foreground occlusion.'],
];
