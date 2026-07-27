'use client';

import React from 'react';
import { useLang } from '@/lib/i18n';
import { RUN_STAGES } from '@/lib/archviz/types';
import type { RunStage } from '@/lib/archviz/types';
import { useArchviz } from '../store';
import { ShotCard } from '../ShotCard';

const STAGE_LABEL: Record<RunStage, [string, string]> = {
  queued: ['排队中', 'Queued'],
  sampling: ['相机采样', 'Camera Sampling'],
  lighting: ['布光', 'Lighting Setup'],
  rendering: ['带灯渲染', 'Lit Rendering'],
  pre_scoring: ['本地粗筛', 'Local Pre-scoring'],
  vision_eval: ['GPT Vision 精评', 'GPT Vision Evaluation'],
  ranking: ['排名', 'Ranking'],
  completed: ['完成', 'Completed'],
};

export default function ProgressView() {
  const { t } = useLang();
  const { activeRun, activeModel, runShots, goBoard, goNew } = useArchviz();

  if (!activeRun) {
    return (
      <div className="avd-screen avd-narrow">
        <div className="avd-empty">{t('没有正在进行的分析。', 'No analysis in progress.')}
          <button className="avd-btn-line" onClick={goNew}>{t('新建分析', 'New analysis')}</button>
        </div>
      </div>
    );
  }

  const curIdx = RUN_STAGES.indexOf(activeRun.stage);
  const done = activeRun.stage === 'completed';

  return (
    <div className="avd-screen">
      <div className="avd-panel">
        <div className="avd-panel-head">
          <div>
            <div className="avd-panel-title">{activeModel?.name}</div>
            <div className="avd-panel-sub">
              {activeModel?.dcc === 'sketchup' ? 'SketchUp' : '3ds Max'} · {activeModel?.bbox.floors} {t('层', 'floors')}
            </div>
          </div>
          {done && <button className="avd-btn-primary" onClick={goBoard}>{t('查看 Shot Board →', 'View Shot Board →')}</button>}
        </div>
        <div className="avd-panel-body">
          <div className="avd-stepper">
            {RUN_STAGES.map((s, i) => (
              <div key={s} className={`avd-step ${i < curIdx || done ? 'done' : i === curIdx ? 'cur' : ''}`}>
                <span className="avd-step-num">{i + 1}</span>
                <span>{t(STAGE_LABEL[s][0], STAGE_LABEL[s][1])}</span>
              </div>
            ))}
          </div>

          <div className="avd-progress-meta">
            <span>{t('已渲染角度', 'Rendered angles')}: <b>{activeRun.rendered}</b> / {activeRun.total}</span>
            <span className="avd-progress-note">
              {done
                ? t('渲染农场未接入 — 以下为模拟结果，供流程演示', 'No render farm connected — results below are simulated for flow demonstration')
                : t('部分结果实时上屏，无需等待全部完成', 'Partial results appear live — no need to wait for completion')}
            </span>
          </div>
        </div>
      </div>

      {runShots.length > 0 && (
        <div className="avd-board-grid avd-progress-grid">
          {runShots.map((s) => <ShotCard key={s.id} shot={s} />)}
        </div>
      )}
    </div>
  );
}
