'use client';

import React from 'react';
import { useLang } from '@/lib/i18n';
import { LIGHTING_PRESETS } from '@/lib/archviz/mockData';
import { buildCameraExport, buildReportText, downloadFile } from '@/lib/archviz/export';
import type { DimensionScores } from '@/lib/archviz/types';
import { useArchviz } from '../store';
import { ShotThumb } from '../ShotThumb';

const DIM_LABEL: Record<keyof DimensionScores, [string, string]> = {
  composition: ['构图 Composition', 'Composition'],
  lighting: ['光影氛围 Lighting & Atmosphere', 'Lighting & Atmosphere'],
  showcaseRegion: ['表现区域 Showcase Region', 'Showcase Region'],
  perspective: ['透视 Perspective', 'Perspective'],
  depth: ['空间层次 Depth', 'Depth'],
};

export default function DetailView() {
  const { t, lang } = useLang();
  const {
    activeShot, activeModel, goBoard, openDetail, goCompare, variantsOf,
    setFavorite, setLabel, requestRecapture, logAction,
  } = useArchviz();

  if (!activeShot) {
    return (
      <div className="avd-screen avd-narrow">
        <div className="avd-empty">{t('未选择角度。', 'No shot selected.')}
          <button className="avd-btn-line" onClick={goBoard}>{t('返回 Shot Board', 'Back to Shot Board')}</button>
        </div>
      </div>
    );
  }

  const shot = activeShot;
  const preset = LIGHTING_PRESETS.find((p) => p.id === shot.lighting.presetId);
  const variants = variantsOf(shot.camGroup).sort((a, b) => a.lighting.presetId.localeCompare(b.lighting.presetId));

  const exportCamera = () => {
    downloadFile(`${shot.id}_camera.json`, JSON.stringify(buildCameraExport(shot), null, 2), 'application/json');
    logAction(shot.id, 'export');
  };
  const exportReport = () => {
    downloadFile(`${shot.id}_report.txt`, buildReportText(shot, activeModel, lang), 'text/plain');
    logAction(shot.id, 'export');
  };

  return (
    <div className="avd-screen">
      <button className="avd-btn-line sm" onClick={goBoard}>← {t('返回 Shot Board', 'Back to Shot Board')}</button>

      <div className="avd-detail-layout">
        <div className="avd-detail-main">
          <div className="avd-detail-hero">
            <ShotThumb shot={shot} className="avd-thumb-svg" />
            <div className="avd-detail-badges">
              <span className="avd-badge-pill">#{shot.rank}</span>
              <span className="avd-badge-pill accent">{shot.overallScore}</span>
              <span className="avd-badge-pill">Hero {shot.heroScore}</span>
              <span className="avd-badge-pill">{Math.round(shot.confidence * 100)}% {t('置信度', 'confidence')}</span>
              {shot.requiresRecapture && <span className="avd-badge-pill warn">{t('建议重拍', 'Re-capture suggested')}</span>}
            </div>
          </div>

          {variants.length > 1 && (
            <div className="avd-relight-strip">
              <div className="avd-relight-head">
                <div className="avd-panel-sub">{t('Relight 变体对比 — 同相机不同灯光', 'Relight comparison — same camera, different lighting')}</div>
                <button className="avd-btn-line sm" onClick={() => goCompare(variants.map((v) => v.id))}>{t('对比全部变体', 'Compare all variants')}</button>
              </div>
              <div className="avd-relight-row">
                {variants.map((v) => (
                  <button key={v.id} className={`avd-relight-thumb ${v.id === shot.id ? 'active' : ''}`} onClick={() => openDetail(v.id)}>
                    <ShotThumb shot={v} className="avd-thumb-svg" />
                    <span>{t(LIGHTING_PRESETS.find((p) => p.id === v.lighting.presetId)?.name[0] || '', LIGHTING_PRESETS.find((p) => p.id === v.lighting.presetId)?.name[1] || '')}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="avd-panel">
            <div className="avd-panel-head"><div className="avd-panel-title">{t('维度评分', 'Dimension Scores')}</div></div>
            <div className="avd-panel-body">
              {(Object.keys(shot.dimensionScores) as (keyof DimensionScores)[]).map((k) => (
                <div key={k} className="avd-dim-row">
                  <span className="avd-dim-label">{t(DIM_LABEL[k][0], DIM_LABEL[k][1])}</span>
                  <span className="avd-dim-track"><span className="avd-dim-fill" style={{ width: `${shot.dimensionScores[k]}%` }} /></span>
                  <span className="avd-dim-val">{shot.dimensionScores[k]}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="avd-panel">
            <div className="avd-panel-head"><div className="avd-panel-title">{t('AI 解释', 'AI Explanation')}</div></div>
            <div className="avd-panel-body">
              <p className="avd-reason">{lang === 'zh' ? shot.marketingReason[0] : shot.marketingReason[1]}</p>
              <div className="avd-tags-row">
                {shot.showcaseRegions.map((r) => <span key={r} className="avd-tag">{r.replace('_', ' ')}</span>)}
              </div>
            </div>
          </div>
        </div>

        <div className="avd-detail-side">
          <div className="avd-panel">
            <div className="avd-panel-head"><div className="avd-panel-title">{t('灯光信息', 'Lighting')}</div></div>
            <div className="avd-panel-body avd-kv">
              <div><span>{t('预设', 'Preset')}</span><b>{preset ? t(preset.name[0], preset.name[1]) : '-'}</b></div>
              <div><span>{t('氛围', 'Mood')}</span><b>{t(shot.lighting.mood[0], shot.lighting.mood[1])}</b></div>
              <div><span>{t('阴影质量', 'Shadow')}</span><b>{shot.lighting.shadowQuality}</b></div>
              {preset?.type === 'exterior' ? (
                <>
                  <div><span>{t('太阳方位角', 'Sun azimuth')}</span><b>{preset.params.sunAzimuth}°</b></div>
                  <div><span>{t('太阳高度角', 'Sun elevation')}</span><b>{preset.params.sunElevation}°</b></div>
                </>
              ) : (
                <>
                  <div><span>{t('色温', 'Color temp')}</span><b>{preset?.params.colorTempK}K</b></div>
                  <div><span>{t('间接光强度', 'Cove intensity')}</span><b>{Math.round((preset?.params.coveIntensity ?? 0) * 100)}%</b></div>
                </>
              )}
            </div>
          </div>

          <div className="avd-panel">
            <div className="avd-panel-head"><div className="avd-panel-title">{t('相机参数', 'Camera')}</div></div>
            <div className="avd-panel-body">
              <pre className="avd-code">{JSON.stringify(shot.camera, null, 2)}</pre>
              <div className="avd-panel-sub">{t('精确可回导 DCC — 无需重拍', 'Exact + reproducible — no re-shoot needed')}</div>
            </div>
          </div>

          <div className="avd-panel">
            <div className="avd-panel-head"><div className="avd-panel-title">{t('操作', 'Actions')}</div></div>
            <div className="avd-panel-body avd-actions-col">
              <button className={`avd-btn-line ${shot.favorite ? 'active' : ''}`} onClick={() => setFavorite(shot.id, !shot.favorite)}>
                {shot.favorite ? '★' : '☆'} {t('收藏', 'Favorite')}
              </button>
              <button className={`avd-btn-line ${shot.label === 'hero' ? 'active' : ''}`} onClick={() => setLabel(shot.id, shot.label === 'hero' ? 'none' : 'hero')}>
                {t('标为 Hero', 'Mark as Hero')}
              </button>
              <button className={`avd-btn-line ${shot.label === 'promoted' ? 'active' : ''}`} onClick={() => setLabel(shot.id, shot.label === 'promoted' ? 'none' : 'promoted')}>
                {t('提升', 'Promote')}
              </button>
              <button className={`avd-btn-line ${shot.label === 'demoted' ? 'active' : ''}`} onClick={() => setLabel(shot.id, shot.label === 'demoted' ? 'none' : 'demoted')}>
                {t('降级', 'Demote')}
              </button>
              <button className={`avd-btn-line danger ${shot.label === 'rejected' ? 'active' : ''}`} onClick={() => setLabel(shot.id, shot.label === 'rejected' ? 'none' : 'rejected')}>
                {t('拒绝', 'Reject')}
              </button>
              <button className="avd-btn-line" onClick={() => requestRecapture(shot.id)}>{t('请求重拍', 'Request Re-capture')}</button>
              <div className="avd-actions-divider" />
              <button className="avd-btn-primary" onClick={exportCamera}>{t('导出相机 + 灯光 (JSON)', 'Export camera + lighting (JSON)')}</button>
              <button className="avd-btn-line" onClick={exportReport}>{t('导出报告 (TXT)', 'Export report (TXT)')}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
