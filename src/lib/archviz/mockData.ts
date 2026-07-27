/* ===== Re-exports for existing client imports =====
   The actual shot/model generation (generateShots/newModel) that used to
   live here is gone — a real backend now generates real data (see
   src/server/archviz/*). This file just keeps the shared vocabulary
   (presets, seeded RNG) importable from its old path so client components
   don't all need updating to import from presets.ts/rng.ts directly. */

export { mulberry32 } from './rng';
export { LIGHTING_PRESETS, SHOWCASE_REGIONS, presetById } from './presets';
