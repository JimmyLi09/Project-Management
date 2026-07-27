'use client';

import React from 'react';
import { useLang } from '@/lib/i18n';
import { LIGHTING_PRESETS } from '@/lib/archviz/mockData';
import { buildCameraExport, downloadFile } from '@/lib/archviz/export';
import type { DimensionScores } from '@/lib/archviz/types';
import { useArchviz } from '../store';
import { ShotThumb } from '../ShotThumb';

const DIM_LABEL: Record<keyof DimensionScores, [string, string]> = {
  composition: ['构图', 'Composition'],
  lighting: ['光影氛围', 'Lighting & Atmosphere'],
  showcaseRegion: ['表现区域', 'Showcase Region'],
  perspective: ['透视', 'Perspective'],
  depth: ['空间层次', 'Depth'],
};

export default function CompareView() {
  const { t } = useLang();
  const { shots, compareIds, goBoard, openDetail, toggleCompareSelect, logAction } = useArchviz();
  const items = compareIds.map((id) => shots.find((s) => s.id === id)).filter(Boolean) as typeof shots;

  if (items.length < 2) {
    return (
      <div className="avd-screen avd-narrow">
        <div className="avd-empty">{t('至少选择 2 个角度进行对比。', 'Select at least 2 shots to compare.')}
          <button className="avd-btn-line" onClick={goBoard}>{t('返回 Shot Board', 'Back to Shot Board')}</button>
        </div>
      </div>
    );
  }

  const sameCamera = items.every((s) => s.camGroup === items[0].camGroup);
  const best = Math.max(...items.map((s) => s.overallScore));

  return (
    <div className="avd-screen">
      <button className="avd-btn-line sm" onClick={goBoard}>← {t('返回 Shot Board', 'Back to Shot Board')}</button>
      <div className="avd-panel-title" style={{ margin: '10px 0' }}>
        {sameCamera ? t('Relight 对比 · 同相机不同灯光', 'Relight Compare · Same camera, different lighting') : t('角度对比 · 不同相机', 'Camera Compare · Different angles')}
      </div>

      <div className="avd-compare-grid" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
        {items.map((s) => {
          const preset = LIGHTING_PRESETS.find((p) => p.id === s.lighting.presetId);
          return (
            <div key={s.id} className={`avd-compare-col ${s.overallScore === best ? 'best' : ''}`}>
              <div className="avd-compare-thumb">
                <ShotThumb shot={s} className="avd-thumb-svg" />
                {s.overallScore === best && <span className="avd-badge-pill accent avd-compare-best-tag">{t('最高分', 'Highest')}</span>}
              </div>
              <div className="avd-compare-score">{s.overallScore} <span className="avd-muted">/ Hero {s.heroScore}</span></div>
              <div className="avd-panel-sub">#{s.rank} · {preset ? t(preset.name[0], preset.name[1]) : '-'}</div>

              {(Object.keys(s.dimensionScores) as (keyof DimensionScores)[]).map((k) => (
                <div key={k} className="avd-dim-row sm">
                  <span className="avd-dim-label">{t(DIM_LABEL[k][0], DIM_LABEL[k][1])}</span>
                  <span className="avd-dim-track"><span className="avd-dim-fill" style={{ width: `${s.dimensionScores[k]}%` }} /></span>
                  <span className="avd-dim-val">{s.dimensionScores[k]}</span>
                </div>
              ))}

              <div className="avd-compare-actions">
                <button className="avd-btn-line sm" onClick={() => openDetail(s.id)}>{t('查看详情', 'Open detail')}</button>
                <button className="avd-btn-line sm" onClick={() => { downloadFile(`${s.id}_camera.json`, JSON.stringify(buildCameraExport(s), null, 2), 'application/json'); logAction(s.id, 'export'); }}>
                  {t('导出', 'Export')}
                </button>
                <button className="avd-btn-line sm" onClick={() => toggleCompareSelect(s.id)}>{t('移除', 'Remove')}</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
