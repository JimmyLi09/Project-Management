'use client';

/* ===== REQ-062 · 新人培训页面的公共部分:数据类型、取数 / 提交、小组件 ===== */
import React from 'react';
import { useLang } from '@/lib/i18n';
import {
  LEVELS, STEP_KINDS, bizLabel, lvName,
  type Assess, type PersonView, type PromoItem, type StageView, type StepView, type TrainConfig, type QuizInfo,
} from '@/lib/train';

export interface TUserLite { name: string; role: string; pmLevel?: string; eligible: boolean }
export interface QueueItem { user: string; kind: string; stage: string; key: string; id?: number; title: { zh: string; en: string }; at: number; project?: string; note?: string; ready?: boolean; self?: Record<string, string> | null }
export interface MatrixRow {
  name: string; role: string; position: string; pmLevel: string; mentor: string; noviceStart: number | null;
  levels: Record<string, number>; selected: string[]; noviceDone: boolean; assistCount: number; independentCount: number; overdueDays: number;
  teachHint: string[];
  promo: { id: string; from: string; to: string; items: PromoItem[] } | null;
}
export interface LogRow { id: number; user: string; biz: string; from_level: number; to_level: number; source: string; reason: string; ref: string; at: number; by: string }
export interface Bundle {
  me: { name: string; role: string; pmLevel: string; admin: boolean; eligible: boolean; mentees: string[]; noviceStart: number | null; mentor: string; matrix: boolean; quiz: boolean };
  gateOn: boolean;
  config: TrainConfig;
  quizInfo: QuizInfo;
  warn: { noquiz: string[]; empty: string[] };
  mine: PersonView | null;
  myProjects: Record<'shadow' | 'assist' | 'owner', { id: string; name: string; bizs: string[] }[]>;
  people: PersonView[];
  queue: QueueItem[];
  overdue: { user: string; stage: string; track: string; sid: string; title: { zh: string; en: string }; days: number; due: number | null }[];
  matrix: MatrixRow[] | null;
  log: LogRow[];
  assess: Assess[];
  courses: { attend: { course: string; lesson: string; user: string; status: string; at: number; by: string }[]; exams: Assess[]; autoLevels: Record<string, Record<string, number>> };
  users: TUserLite[];
  result?: unknown;
}

export async function trainAct(body: Record<string, unknown>): Promise<{ ok: true; data: Bundle } | { ok: false; error: string }> {
  const r = await fetch('/api/train', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  if (!r) return { ok: false, error: '网络错误 / Network error' };
  const j = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, data: j as Bundle } : { ok: false, error: (j as { error?: string }).error || '操作失败 / Failed' };
}

export const fmtDay = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleDateString() : '—');

export function LvBadge({ v, small }: { v: number; small?: boolean }) {
  const { lang } = useLang();
  const l = LEVELS[Math.max(0, Math.min(4, v || 0))];
  return <span className="badge" data-lv={l.v} style={{ background: l.bg, color: l.color, fontWeight: 700, fontSize: small ? 11 : 12 }}>{lang === 'zh' ? l.zh : l.en}</span>;
}

export const stageLabel = (s: Pick<StageView, 'track' | 'sid' | 'def'>, lang: 'zh' | 'en') =>
  `${lang === 'zh' ? '关' : 'Stage'} ${s.sid.slice(1)} · ${lang === 'zh' ? s.def.zh : s.def.en || s.def.zh}${s.track !== 'main' ? ` · ${bizLabel(s.track, lang)}` : ''}`;

export function StatusTag({ s }: { s: StageView }) {
  const { t } = useLang();
  const m = {
    passed: [t('已过关', 'Passed'), '#e6f2ec', '#0f6a48'],
    exempt: [s.exemptBy === 'placement' ? t('定级免修', 'Exempt (placement)') : t('已达到', 'Already at level'), '#efe8f8', '#7A4FB5'],
    open: [s.overdueDays > 0 ? t(`进行中 · 超 ${s.overdueDays} 天`, `In progress · ${s.overdueDays}d late`) : t('进行中', 'In progress'), s.overdueDays > 0 ? '#fdecea' : '#fbf0dc', s.overdueDays > 0 ? '#98342b' : '#a8690b'],
    locked: [t('未解锁', 'Locked'), '#f1efea', '#8A8478'],
  }[s.status] as [string, string, string];
  return <span className="badge" data-testid="stage-status" data-status={s.status} style={{ background: m[1], color: m[2] }}>{m[0]}</span>;
}

export function stepStateText(st: StepView, t: (zh: string, en: string) => string): [string, string] {
  switch (st.state) {
    case 'done': return [st.def.kind === 'task' ? t('✓ 已签核', '✓ Signed off') : t('✓ 已完成', '✓ Done'), '#0f6a48'];
    case 'empty': return [t('✓ 板块里还没有文档(算完成)', '✓ No documents in this section yet (counts as done)'), '#0f6a48'];
    case 'submitted': return [t('⏳ 已提交,等带教人签核', '⏳ Submitted — waiting for your mentor'), '#a8690b'];
    case 'returned': return [t('↩ 被退回,改了再交', '↩ Returned — revise and resubmit'), '#98342b'];
    case 'booked': return [t('⏳ 已约,等带教人打分', '⏳ Booked — waiting for the score'), '#a8690b'];
    case 'passed': return [t('✓ 通过', '✓ Passed'), '#0f6a48'];
    case 'failed': return [t('✗ 没通过,可以再来', '✗ Not passed — try again'), '#98342b'];
    case 'noquiz': return [t('还没出题', 'No questions yet'), '#98342b'];
    default: return [t('未完成', 'To do'), 'var(--text2)'];
  }
}

export function KindTag({ st }: { st: StepView }) {
  const { lang } = useLang();
  const k = STEP_KINDS[st.def.kind];
  return <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{k.icon} {lang === 'zh' ? k.zh : k.en}</span>;
}

/* 一次评分(讲解 / 模拟演练 / 课程考核)的明细 */
export function ScoreLine({ a, rubric, cfg }: { a: Assess; rubric?: { items: { zh: string; en: string }[] }; cfg: TrainConfig }) {
  const { lang, t } = useLang();
  const sc = a.scores || [];
  const avg = sc.length ? Math.round((sc.reduce((x, y) => x + y.s, 0) / sc.length) * 10) / 10 : null;
  return (
    <div style={{ fontSize: 12, borderTop: '1px dashed var(--row-line)', paddingTop: 6, marginTop: 6 }} data-testid="score-line" data-status={a.status}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <b style={{ color: a.status === 'passed' ? '#0f6a48' : a.status === 'failed' ? '#98342b' : '#a8690b' }}>
          {a.status === 'passed' ? t('通过', 'Passed') : a.status === 'failed' ? t('未通过', 'Not passed') : a.status === 'booked' ? t('已约', 'Booked') : a.status}
        </b>
        {avg != null && <span data-testid="score-avg">{t('平均', 'Average')} {avg.toFixed(1)}</span>}
        {a.score != null && <span>{a.score} {t('分', 'pts')}</span>}
        <span style={{ color: 'var(--text2)' }}>{a.doneBy || a.by} · {new Date(a.doneAt || a.at).toLocaleString()}</span>
      </div>
      {sc.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 10px', marginTop: 4 }}>
          {sc.map((x, i) => (
            <React.Fragment key={i}>
              <span style={{ color: 'var(--text2)' }}>{rubric?.items[i] ? (lang === 'zh' ? rubric.items[i].zh : rubric.items[i].en || rubric.items[i].zh) : `#${i + 1}`}{x.c ? ` — ${x.c}` : ''}</span>
              <b className="tnum" style={{ color: x.s < cfg.pass.min ? '#98342b' : 'var(--text)' }}>{x.s}</b>
            </React.Fragment>
          ))}
        </div>
      )}
      {a.comment && <div style={{ marginTop: 4 }}>{t('评语:', 'Comment: ')}{a.comment}</div>}
    </div>
  );
}

export const levelName = lvName;
/* 按步骤 key 找它的定义(讲解 / 模拟演练要知道用哪张评分表) */
export function findStep(cfg: TrainConfig, key: string) {
  const parts = key.split('.');
  const [track, sid, id] = parts.length === 2 ? ['main', parts[0], parts[1]] : [parts[0], parts[1], parts[2]];
  const stages = track === 'main' ? cfg.main : cfg.biz[track] || [];
  const st = stages.find((x) => x.id === sid);
  return st ? [...st.steps, ...st.gate].find((x) => x.id === id) || null : null;
}
export const sourceName = (s: string, lang: 'zh' | 'en') => ({
  init: ['初始化', 'Initial set-up'], placement: ['入职定级', 'Placement'], auto: ['过关自动升级', 'Passed a stage'], manual: ['手动调整', 'Manual change'],
} as Record<string, [string, string]>)[s]?.[lang === 'zh' ? 0 : 1] || s;

export const card: React.CSSProperties = { padding: '14px 18px' };
export const th: React.CSSProperties = { textAlign: 'left', padding: '9px 12px', fontSize: 11.5, fontWeight: 700, color: 'var(--text2)', borderBottom: '1px solid var(--row-line)', whiteSpace: 'nowrap' };
export const td: React.CSSProperties = { padding: '9px 12px', fontSize: 12.5, borderTop: '1px solid var(--row-line)' };
export const fieldL: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: 'var(--text2)', fontWeight: 600 };
