'use client';

import React, { useMemo, useState } from 'react';
import { useLang } from '@/lib/i18n';
import { LIGHTING_PRESETS } from '@/lib/archviz/mockData';
import { useArchviz } from '../store';
import { ShotCard } from '../ShotCard';

type StatusFilter = 'top20' | 'all' | 'favorite' | 'rejected';
type SortBy = 'rank' | 'score' | 'confidence';

export default function BoardView() {
  const { t } = useLang();
  const {
    activeRun, activeModel, boardShots, goNew, openDetail, setFavorite, toggleCompareSelect,
    compareIds, clearCompare, goCompare,
  } = useArchviz();
  const [search, setSearch] = useState('');
  const [presetFilter, setPresetFilter] = useState<string>('all');
  const [status, setStatus] = useState<StatusFilter>('top20');
  const [sortBy, setSortBy] = useState<SortBy>('rank');
  const [selectMode, setSelectMode] = useState(false);

  const filtered = useMemo(() => {
    let list = boardShots;
    if (status === 'top20') list = list.slice(0, 20);
    if (status === 'favorite') list = list.filter((s) => s.favorite);
    if (status === 'rejected') list = list.filter((s) => s.label === 'rejected');
    if (presetFilter !== 'all') list = list.filter((s) => s.lighting.presetId === presetFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((s) => s.showcaseRegions.some((r) => r.includes(q)) || String(s.rank).includes(q));
    }
    const sorted = [...list];
    if (sortBy === 'score') sorted.sort((a, b) => b.overallScore - a.overallScore);
    else if (sortBy === 'confidence') sorted.sort((a, b) => b.confidence - a.confidence);
    else sorted.sort((a, b) => a.rank - b.rank);
    return sorted;
  }, [boardShots, status, presetFilter, search, sortBy]);

  if (!activeRun) {
    return (
      <div className="avd-screen avd-narrow">
        <div className="avd-empty">{t('还没有分析结果。', 'No analysis results yet.')}
          <button className="avd-btn-line" onClick={goNew}>{t('新建分析', 'New analysis')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="avd-screen">
      <div className="avd-toolbar">
        <div className="avd-toolbar-title">
          {activeModel?.name} <span className="avd-muted">· {boardShots.length} {t('个角度', 'angles')}</span>
        </div>
        <div className="avd-toolbar-controls">
          <input className="avd-input sm" placeholder={t('搜索区域 / 排名…', 'Search region / rank…')} value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="avd-input sm" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="top20">{t('Top 20', 'Top 20')}</option>
            <option value="all">{t('全部', 'All')}</option>
            <option value="favorite">{t('已收藏', 'Favorite')}</option>
            <option value="rejected">{t('已拒绝', 'Rejected')}</option>
          </select>
          <select className="avd-input sm" value={presetFilter} onChange={(e) => setPresetFilter(e.target.value)}>
            <option value="all">{t('全部灯光', 'All lighting')}</option>
            {LIGHTING_PRESETS.map((p) => <option key={p.id} value={p.id}>{t(p.name[0], p.name[1])}</option>)}
          </select>
          <select className="avd-input sm" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
            <option value="rank">{t('按排名', 'By rank')}</option>
            <option value="score">{t('按总分', 'By score')}</option>
            <option value="confidence">{t('按置信度', 'By confidence')}</option>
          </select>
          <button className={`avd-btn-line sm ${selectMode ? 'active' : ''}`} onClick={() => { setSelectMode((v) => !v); clearCompare(); }}>
            {t('多选对比', 'Multi-select')}
          </button>
          <button className="avd-btn-primary sm" onClick={goNew}>+ {t('新建分析', 'New')}</button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="avd-empty">{t('没有符合筛选条件的角度。', 'No angles match the current filters.')}</div>
      ) : (
        <div className="avd-board-grid">
          {filtered.map((s) => (
            <ShotCard
              key={s.id}
              shot={s}
              showSelect={selectMode}
              selected={compareIds.includes(s.id)}
              onOpen={() => (selectMode ? toggleCompareSelect(s.id) : openDetail(s.id))}
              onToggleFavorite={() => setFavorite(s.id, !s.favorite)}
              onToggleSelect={() => toggleCompareSelect(s.id)}
            />
          ))}
        </div>
      )}

      {selectMode && compareIds.length > 0 && (
        <div className="avd-compare-bar">
          <span>{t(`已选 ${compareIds.length} 个角度`, `${compareIds.length} selected`)}</span>
          <button className="avd-btn-line sm" onClick={clearCompare}>{t('清空', 'Clear')}</button>
          <button className="avd-btn-primary sm" disabled={compareIds.length < 2} onClick={() => goCompare()}>{t('对比', 'Compare')}</button>
        </div>
      )}
    </div>
  );
}
