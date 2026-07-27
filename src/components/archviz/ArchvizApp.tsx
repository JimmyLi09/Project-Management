'use client';

import React from 'react';
import { useLang } from '@/lib/i18n';
import { ArchvizProvider, useArchviz } from './store';
import NewAnalysisView from './views/NewAnalysisView';
import ProgressView from './views/ProgressView';
import BoardView from './views/BoardView';
import DetailView from './views/DetailView';
import CompareView from './views/CompareView';
import './archviz.css';

export default function ArchvizApp() {
  return (
    <ArchvizProvider>
      <ArchvizShell />
    </ArchvizProvider>
  );
}

function ArchvizShell() {
  const { t } = useLang();
  const { screen, activeRun, goNew, goBoard } = useArchviz();

  const crumb = (name: string, label: string, onClick: () => void, enabled: boolean) => (
    <button
      className={`avd-crumb ${screen === name ? 'active' : ''}`}
      onClick={enabled ? onClick : undefined}
      disabled={!enabled}
      style={{ opacity: enabled ? 1 : 0.4, cursor: enabled ? 'pointer' : 'default' }}
    >
      {label}
    </button>
  );

  return (
    <div className="avd">
      <div className="avd-topbar">
        <div className="avd-topbar-title">
          AI ArchViz Director <span className="avd-topbar-badge">Model-Direct</span>
        </div>
        <div className="avd-crumbs">
          {crumb('new', t('新建分析', 'New Analysis'), goNew, true)}
          <span>›</span>
          {crumb('progress', t('渲染进度', 'Progress'), () => {}, !!activeRun)}
          <span>›</span>
          {crumb('board', t('Shot Board', 'Shot Board'), goBoard, !!activeRun)}
          {(screen === 'detail' || screen === 'compare') && (
            <>
              <span>›</span>
              {crumb(screen, screen === 'detail' ? t('详情', 'Detail') : t('对比', 'Compare'), () => {}, true)}
            </>
          )}
        </div>
      </div>

      {screen === 'new' && <NewAnalysisView />}
      {screen === 'progress' && <ProgressView />}
      {screen === 'board' && <BoardView />}
      {screen === 'detail' && <DetailView />}
      {screen === 'compare' && <CompareView />}
    </div>
  );
}
