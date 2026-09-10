/* ===== REQ-036: 新人培训 —— 培训路径 / 进度 / 考核 =====

   培训内容**不在这里存**:每一步引用一篇知识库文档(REQ-035),改文档就是改
   培训材料,避免同一份 SOP 在两个地方各维护一份、越走越不一样。
   需要一句话交代的地方(「先找带教领一台机器」)才用 note 型步骤。

   「通过」= 走完所有步骤 + 考核达到及格线(默认 80%,按路径可配)。 */

export type StepKind = 'doc' | 'note';

export interface TrainingStep {
  id: string;
  kind: StepKind;
  title: string;
  docId?: string;      // kind==='doc' 时指向知识库文档
  note?: string;       // kind==='note' 时的说明文字
}

export type QuestionKind = 'single' | 'multi' | 'bool';

export interface QuizQuestion {
  id: string;
  kind: QuestionKind;
  q: string;
  options: { key: string; text: string }[];   // bool 题固定 对 / 错
  answer: string[];                            // 正确选项的 key;发给学员时会被剥掉
}

export interface TrainingPath {
  id: string;
  title: string;
  titleEn: string;
  role: string;              // 面向哪个角色('' = 不限)
  assignees: string[];       // 额外指派到人
  steps: TrainingStep[];
  quiz: QuizQuestion[];
  passScore: number;         // 及格线(百分比),默认 80
  /* 收紧到只有总监 / BD 能维护这条路径。默认关 —— 需求写的是「题库由总监 / PM
     维护」;但 PM 自己也可能是这条路径的学员(按角色指派会把全体 PM 圈进来),
     那样他就能看到自己要考那张卷子的答案。要真防这一手,把这条打开。 */
  adminOnly: boolean;
  updatedAt: number;
  updatedBy: string;
  createdAt: number;
  createdBy: string;
}

export interface TrainingProgress {
  pathId: string;
  user: string;
  done: string[];            // 已完成的 step id
  doneAt: Record<string, number>;
  attempts: number;
  bestScore: number | null;  // 百分比
  passedQuiz: boolean;
  updatedAt: number;
}

export interface QuizAttempt {
  id: number;
  pathId: string;
  user: string;
  score: number;
  passed: boolean;
  at: number;
}

export const QUESTION_KINDS: [QuestionKind, string, string][] = [
  ['single', '单选', 'Single choice'],
  ['multi', '多选', 'Multiple choice'],
  ['bool', '判断', 'True / false'],
];

export const BOOL_OPTIONS = [{ key: 'T', text: '对 True' }, { key: 'F', text: '错 False' }];

/* 这条路径归不归这个人:角色对上,或者被点名指派 */
export function isAssigned(p: TrainingPath, user: { name: string; role: string }): boolean {
  if (p.assignees.includes(user.name)) return true;
  return !!p.role && p.role === user.role;
}

/* 步骤完成度(百分比)。没有步骤的路径算 100%,免得除以零。 */
export function stepPct(p: TrainingPath, pr?: TrainingProgress): number {
  if (!p.steps.length) return 100;
  const done = (pr?.done || []).filter((id) => p.steps.some((s) => s.id === id)).length;
  return Math.round((done / p.steps.length) * 100);
}

/* 整条路径算不算「通过」:步骤走完 + 考核达标(没配考核就只看步骤) */
export function isPassed(p: TrainingPath, pr?: TrainingProgress): boolean {
  if (stepPct(p, pr) < 100) return false;
  return p.quiz.length === 0 || !!pr?.passedQuiz;
}

/* 卡在哪一步:第一个还没完成的步骤 */
export function stuckAt(p: TrainingPath, pr?: TrainingProgress): TrainingStep | undefined {
  return p.steps.find((s) => !(pr?.done || []).includes(s.id));
}

/* 判分。多选必须完全一致才得分 —— 少选也算错,不给部分分:
   培训考核要的是「掌握了没有」,半对半错说明没掌握。 */
export function grade(quiz: QuizQuestion[], answers: Record<string, string[]>): { score: number; right: number; total: number } {
  const total = quiz.length;
  if (!total) return { score: 100, right: 0, total: 0 };
  let right = 0;
  for (const q of quiz) {
    const got = [...(answers[q.id] || [])].sort();
    const want = [...q.answer].sort();
    if (got.length === want.length && got.every((x, i) => x === want[i])) right++;
  }
  return { score: Math.round((right / total) * 100), right, total };
}
