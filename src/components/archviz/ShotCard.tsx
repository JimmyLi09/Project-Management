'use client';

import React from 'react';
import { useLang } from '@/lib/i18n';
import { LIGHTING_PRESETS } from '@/lib/archviz/mockData';
import type { Shot } from '@/lib/archviz/types';
import { ShotThumb } from './ShotThumb';

const LABEL_TAG: Record<string, [string, string, string]> = {
  hero: ['★ Hero', '★ Hero', '#FF8000'],
  promoted: ['↑ 已提升', '↑ Promoted', '#27DAFA'],
  demoted: ['↓ 已降级', '↓ Demoted', '#8891a8'],
  rejected: ['已拒绝', 'Rejected', '#e2564f'],
};

export function ShotCard({
  shot, selected, onOpen, onToggleFavorite, onToggleSelect, showSelect,
}: {
  shot: Shot;
  selected?: boolean;
  onOpen?: () => void;
  onToggleFavorite?: () => void;
  onToggleSelect?: () => void;
  showSelect?: boolean;
}) {
  const { t } = useLang();
  const preset = LIGHTING_PRESETS.find((p) => p.id === shot.lighting.presetId);
  const labelTag = shot.label !== 'none' ? LABEL_TAG[shot.label] : null;

  return (
    <div className={`avd-shot-card ${selected ? 'selected' : ''}`}>
      <button className="avd-shot-thumb" onClick={onOpen} title={t('查看详情', 'View detail')}>
        <ShotThumb shot={shot} className="avd-thumb-svg" />
        <span className="avd-shot-rank">#{shot.rank}</span>
        {labelTag && <span className="avd-shot-label" style={{ background: labelTag[2] }}>{t(labelTag[0], labelTag[1])}</span>}
        {showSelect && (
          <span
            className={`avd-shot-check ${selected ? 'on' : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggleSelect?.(); }}
          >
            {selected ? '✓' : ''}
          </span>
        )}
      </button>
      <div className="avd-shot-body">
        <div className="avd-shot-scores">
          <span className="avd-score-main">{shot.overallScore}</span>
          <span className="avd-score-sub">Hero {shot.heroScore} · {Math.round(shot.confidence * 100)}%</span>
        </div>
        <button
          className={`avd-fav-btn ${shot.favorite ? 'on' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(); }}
          title={t('收藏', 'Favorite')}
        >
          {shot.favorite ? '★' : '☆'}
        </button>
      </div>
      <div className="avd-shot-tags">
        {preset && <span className="avd-tag">{t(preset.name[0], preset.name[1])}</span>}
        {shot.showcaseRegions.slice(0, 2).map((r) => <span key={r} className="avd-tag muted">{r.replace('_', ' ')}</span>)}
      </div>
    </div>
  );
}
