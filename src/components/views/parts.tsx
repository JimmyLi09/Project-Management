'use client';

import React from 'react';
import { SVC, svcColor, svcLabel, stageColor, STAGES, stageIdx } from '@/lib/templates';
import { projStage, type Health } from '@/lib/project';
import type { Project } from '@/lib/types';

export function SvcTag({ k, style }: { k: string; style?: React.CSSProperties }) {
  return (
    <span className="svc" style={{ background: `${svcColor(k)}1a`, color: svcColor(k), ...style }}>
      {svcLabel(k)}
    </span>
  );
}

export function StageTag({ p }: { p: Project }) {
  const s = projStage(p);
  return (
    <span className="stage-tag" style={{ background: `${stageColor(s)}22`, color: stageColor(s) }}>
      {STAGES[stageIdx(s)][1]}
    </span>
  );
}

export const HEALTH_CLS: Record<Health, string> = { ok: 'h-ok', risk: 'h-risk', over: 'h-over' };
export const HEALTH_TXT: Record<Health, string> = { ok: '正常', risk: '预警', over: '逾期' };

export function HealthTag({ h }: { h: Health }) {
  return (
    <span className={`health ${HEALTH_CLS[h]}`}>
      <span className="dt" />{HEALTH_TXT[h]}
    </span>
  );
}

export const STATUS_PILL_CLS: Record<string, string> = {
  todo: 'st-todo', wip: 'st-wip', done: 'st-done', block: 'st-block',
};
export const STATUS_TXT: Record<string, string> = {
  todo: '未开始', wip: '进行中', done: '已完成', block: '受阻',
};
export const STATUS_TXT_FULL: Record<string, string> = {
  todo: '未开始 Not started', wip: '进行中 WIP', done: '已完成 Done', block: '受阻 Blocked',
};
