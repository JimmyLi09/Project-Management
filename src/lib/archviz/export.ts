/* ===== Export helpers: camera+lighting recapture params + a text report =====
   Handbook §10 export_camera(run_id, frame_id, fmt) -> {camera_file, lighting}.
   No real DCC round-trip exists here, so this produces the same structured
   payload a real export_camera call would return, downloadable as JSON. */

import { LIGHTING_PRESETS } from './mockData';
import type { ArchModel, Shot } from './types';

export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function buildCameraExport(shot: Shot) {
  const preset = LIGHTING_PRESETS.find((p) => p.id === shot.lighting.presetId);
  return {
    frame_id: shot.id,
    source: 'model_lit',
    rank: shot.rank,
    camera: shot.camera,
    lighting_preset: preset?.id,
    lighting_params: preset?.params,
    requires_recapture: shot.requiresRecapture,
  };
}

export function buildReportText(shot: Shot, model?: ArchModel, lang: 'zh' | 'en' = 'zh'): string {
  const preset = LIGHTING_PRESETS.find((p) => p.id === shot.lighting.presetId);
  const L = (zh: string, en: string) => (lang === 'zh' ? zh : en);
  return [
    `AI ArchViz Director — ${L('推荐角度报告', 'Recommended Shot Report')}`,
    `${L('模型', 'Model')}: ${model?.name ?? '-'}`,
    `${L('排名', 'Rank')}: #${shot.rank}`,
    `${L('总分', 'Overall Score')}: ${shot.overallScore}  Hero: ${shot.heroScore}  ${L('置信度', 'Confidence')}: ${Math.round(shot.confidence * 100)}%`,
    '',
    L('维度评分', 'Dimension Scores'),
    `  Composition: ${shot.dimensionScores.composition}`,
    `  Lighting & Atmosphere: ${shot.dimensionScores.lighting}`,
    `  Showcase Region: ${shot.dimensionScores.showcaseRegion}`,
    `  Perspective: ${shot.dimensionScores.perspective}`,
    `  Depth: ${shot.dimensionScores.depth}`,
    '',
    L('表现区域', 'Showcase Regions') + `: ${shot.showcaseRegions.join(', ')}`,
    L('灯光预设', 'Lighting Preset') + `: ${preset ? L(preset.name[0], preset.name[1]) : '-'}`,
    L('解释', 'Explanation') + `: ${lang === 'zh' ? shot.marketingReason[0] : shot.marketingReason[1]}`,
    L('相机参数', 'Camera') + `: pos=${JSON.stringify(shot.camera.position)} target=${JSON.stringify(shot.camera.target)} fov=${shot.camera.fovMm}mm`,
    shot.requiresRecapture ? L('⚠ 建议重拍', '⚠ Re-capture suggested') : L('✓ 相机可直接复现', '✓ Camera is directly reproducible'),
  ].join('\n');
}
