/* ===== Projection · 01 立项的输入(AV-020 §3.1) =====
   场景、互动、环境光、天花高度、最近观众离墙距离。存在立项记录的 answers 里
   (和 AV-019 的「播放什么」同一处);05 新开投影方案时用它们预填空间参数。 */

import type { PrjEnv } from './rulepack.ts';
import type { PrjGroupsConfig, PrjInteract } from './groups.ts';

export type PrjScene = 'single' | 'immersive' | 'floor' | 'meeting' | 'arc' | 'model';
export const PRJ_SCENES: { key: PrjScene; zh: string; en: string }[] = [
  { key: 'single', zh: '展厅单面墙', en: 'Single feature wall' },
  { key: 'immersive', zh: '沉浸式多面', en: 'Immersive multi-face' },
  { key: 'floor', zh: '地面', en: 'Floor' },
  { key: 'meeting', zh: '会议室 / 教室', en: 'Meeting room / classroom' },
  { key: 'arc', zh: '弧幕（按展开宽度近似）', en: 'Curved screen (approximated unfolded)' },
  { key: 'model', zh: '投影模型', en: 'Projection on a model' },
];
export const PRJ_INTERACTS: { key: PrjInteract; zh: string; en: string }[] = [
  { key: 'none', zh: '没有', en: 'None' },
  { key: 'wall', zh: '墙面互动', en: 'Wall interaction' },
  { key: 'floor', zh: '地面互动', en: 'Floor interaction' },
];
export const PRJ_ENVS: { key: PrjEnv; zh: string; en: string }[] = [
  { key: 'dark', zh: '暗室', en: 'Dark room' },
  { key: 'window', zh: '有窗', en: 'Windows' },
  { key: 'bright', zh: '明亮', en: 'Bright' },
];

export interface PrjAnswers {
  prj_scene?: PrjScene | null;
  prj_interact?: PrjInteract | null;
  prj_env?: PrjEnv | null;
  prj_ceiling?: number | null;     // m
  prj_near?: number | null;        // m
}
export const PRJ_ANSWER_KEYS = ['prj_scene', 'prj_interact', 'prj_env', 'prj_ceiling', 'prj_near'] as const;
export const PRJ_ANSWER_ZH: Record<(typeof PRJ_ANSWER_KEYS)[number], string> = {
  prj_scene: '投影场景', prj_interact: '投影互动', prj_env: '环境光', prj_ceiling: '天花高度', prj_near: '最近观众离墙',
};

/* only recognised values; numbers must be positive (near may be 0 = not given) */
export function prjAnswersOf(body: Record<string, unknown>, cur: PrjAnswers): PrjAnswers {
  const next: PrjAnswers = { ...cur };
  const pick = <T extends string>(k: keyof PrjAnswers, list: { key: T }[]) => {
    if (k in body) (next as Record<string, unknown>)[k] = list.some((x) => x.key === body[k]) ? body[k] : null;
  };
  pick('prj_scene', PRJ_SCENES);
  pick('prj_interact', PRJ_INTERACTS);
  pick('prj_env', PRJ_ENVS);
  const num = (k: 'prj_ceiling' | 'prj_near', min: number) => {
    if (!(k in body)) return;
    const v = body[k] === '' || body[k] == null ? NaN : Number(body[k]);
    next[k] = Number.isFinite(v) && v >= min && v < 100 ? Math.round(v * 100) / 100 : null;
  };
  num('prj_ceiling', 0.5);
  num('prj_near', 0);
  return next;
}

/* 05:新开投影方案时,把 01 答过的空间参数填进去(没答的保持样本 / 默认值) */
export function prjPrefill(cfg: PrjGroupsConfig, a: PrjAnswers | null | undefined): PrjGroupsConfig {
  if (!a) return cfg;
  return {
    ...cfg,
    ...(a.prj_ceiling ? { prj_ceiling: a.prj_ceiling } : {}),
    ...(a.prj_env ? { prj_env: a.prj_env } : {}),
    ...(a.prj_near != null ? { prj_view_near: a.prj_near } : {}),
    ...(a.prj_interact ? { prj_interact: a.prj_interact } : {}),
  };
}
