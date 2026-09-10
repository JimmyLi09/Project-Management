/* ===== REQ-036: 新人培训的服务端读写 =====

   一条硬规矩:**正确答案永远不发给学员**。判分只在服务端做。
   题目和答案存在一起,所以每次往外发之前都要先过一遍 stripAnswers ——
   答案跟着题目一起进了浏览器,这份考核就等于没考。 */
import {
  getTrainingPath, getTrainingProgress, insertTrainingAttempt, insertTrainingPath,
  listTrainingAttempts, listTrainingPaths, listTrainingProgress, updateTrainingPath,
  upsertTrainingProgress, type TrainingPathRow, type TrainingProgressRow,
} from './db';
import {
  BOOL_OPTIONS, grade, type QuestionKind, type QuizQuestion,
  type TrainingPath, type TrainingProgress, type TrainingStep,
} from '@/lib/training';

const jparse = <T,>(s: string, d: T): T => { try { return JSON.parse(s) as T; } catch { return d; } };
const KINDS = new Set<QuestionKind>(['single', 'multi', 'bool']);

export function rowToPath(r: TrainingPathRow): TrainingPath {
  return {
    id: r.id, title: r.title, titleEn: r.title_en, role: r.role,
    assignees: jparse<string[]>(r.assignees, []),
    steps: jparse<TrainingStep[]>(r.steps, []),
    quiz: jparse<QuizQuestion[]>(r.quiz, []),
    passScore: r.pass_score, adminOnly: !!r.admin_only,
    updatedAt: r.updated_at, updatedBy: r.updated_by,
    createdAt: r.created_at, createdBy: r.created_by,
  };
}

function rowToProgress(r: TrainingProgressRow): TrainingProgress {
  return {
    pathId: r.path_id, user: r.user_name,
    done: jparse<string[]>(r.done, []),
    doneAt: jparse<Record<string, number>>(r.done_at, {}),
    attempts: r.attempts, bestScore: r.best_score,
    passedQuiz: !!r.passed_quiz, updatedAt: r.updated_at,
  };
}

/* 把正确答案剥掉。
   学习用的那条出口(/api/training)**对所有人**都剥,管理员也不例外 ——
   本来是「管理员看得到全量」,但平台里 PM 既是题库维护者又可能是这条路径的
   学员(按角色指派会把全体 PM 圈进来),答案跟着列表进浏览器,等于把卷子和
   答案一起发下去。所以答案只在「打开编辑器」这一条路上按需取(见 canEditPath)。 */
export const stripAnswers = (p: TrainingPath): TrainingPath =>
  ({ ...p, quiz: p.quiz.map((q) => ({ ...q, answer: [] })) });

export const allPaths = (): TrainingPath[] => listTrainingPaths().map(rowToPath);
export const onePath = (id: string): TrainingPath | undefined => { const r = getTrainingPath(id); return r ? rowToPath(r) : undefined; };
export const allProgress = (): TrainingProgress[] => listTrainingProgress().map(rowToProgress);
export const progressOf = (pathId: string, user: string): TrainingProgress | undefined => {
  const r = getTrainingProgress(pathId, user);
  return r ? rowToProgress(r) : undefined;
};
export const attemptsOf = (pathId?: string) =>
  listTrainingAttempts(pathId).map((a) => ({ id: a.id, pathId: a.path_id, user: a.user_name, score: a.score, passed: !!a.passed, at: a.at }));

export interface PathInput {
  title?: unknown; titleEn?: unknown; role?: unknown; assignees?: unknown;
  steps?: unknown; quiz?: unknown; passScore?: unknown; adminOnly?: unknown;
}

const ROLES = new Set(['director', 'bd', 'sales', 'pm', 'member', 'viewer', 'finance']);
const sid = (p: string) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function clean(inp: PathInput) {
  const title = String(inp.title ?? '').trim().slice(0, 120);
  const rawSteps = Array.isArray(inp.steps) ? inp.steps : [];
  if (rawSteps.length > 100) throw new Error('一条路径最多 100 步');
  const steps: TrainingStep[] = rawSteps.map((s) => {
    const x = s as Partial<TrainingStep>;
    const kind: TrainingStep['kind'] = x.kind === 'note' ? 'note' : 'doc';
    return {
      id: String(x.id || sid('st')).slice(0, 40),
      kind,
      title: String(x.title ?? '').trim().slice(0, 160),
      ...(kind === 'doc' ? { docId: String(x.docId ?? '').slice(0, 40) } : { note: String(x.note ?? '').slice(0, 4000) }),
    };
  });

  const rawQuiz = Array.isArray(inp.quiz) ? inp.quiz : [];
  if (rawQuiz.length > 100) throw new Error('一套小测最多 100 题');
  const quiz: QuizQuestion[] = rawQuiz.map((s) => {
    const x = s as Partial<QuizQuestion>;
    const kind = (KINDS.has(x.kind as QuestionKind) ? x.kind : 'single') as QuestionKind;
    const options = kind === 'bool'
      ? BOOL_OPTIONS
      : (Array.isArray(x.options) ? x.options : []).slice(0, 12)
          .map((o, i) => ({ key: String(o?.key || String.fromCharCode(65 + i)).slice(0, 8), text: String(o?.text ?? '').slice(0, 300) }))
          .filter((o) => o.text);
    const keys = new Set(options.map((o) => o.key));
    let answer = (Array.isArray(x.answer) ? x.answer : []).map(String).filter((k) => keys.has(k));
    /* 单选 / 判断只留一个答案 —— 存两个的话判分永远判不对 */
    if (kind !== 'multi') answer = answer.slice(0, 1);
    return { id: String(x.id || sid('q')).slice(0, 40), kind, q: String(x.q ?? '').trim().slice(0, 500), options, answer };
  });

  const ps = Number(inp.passScore);
  return {
    title,
    titleEn: String(inp.titleEn ?? '').trim().slice(0, 120),
    role: ROLES.has(String(inp.role)) ? String(inp.role) : '',
    assignees: (Array.isArray(inp.assignees) ? inp.assignees : []).slice(0, 100).map((x) => String(x).trim().slice(0, 60)).filter(Boolean),
    steps, quiz,
    passScore: Number.isFinite(ps) ? Math.max(0, Math.min(100, Math.round(ps))) : 80,
    adminOnly: !!inp.adminOnly,
  };
}

/* 保存前的完整性检查:没题目 / 没选项 / 没标答案的题一律拦下 ——
   放进去的话学员永远做不对,而且看不出为什么。 */
function checkQuiz(quiz: QuizQuestion[]) {
  for (const [i, q] of quiz.entries()) {
    if (!q.q) throw new Error(`第 ${i + 1} 题还没写题干`);
    if (q.options.length < 2) throw new Error(`第 ${i + 1} 题至少要有两个选项`);
    if (!q.answer.length) throw new Error(`第 ${i + 1} 题还没标正确答案`);
  }
}

export function createPath(inp: PathInput, by: string): TrainingPath {
  const c = clean(inp);
  if (!c.title) throw new Error('培训路径名称不能为空');
  checkQuiz(c.quiz);
  const now = Date.now();
  const row: TrainingPathRow = {
    id: 'tp' + now.toString(36) + Math.random().toString(36).slice(2, 7),
    title: c.title, title_en: c.titleEn, role: c.role,
    assignees: JSON.stringify(c.assignees), steps: JSON.stringify(c.steps), quiz: JSON.stringify(c.quiz),
    pass_score: c.passScore, admin_only: c.adminOnly ? 1 : 0,
    updated_at: now, updated_by: by, created_at: now, created_by: by,
  };
  insertTrainingPath(row);
  return rowToPath(row);
}

export function savePath(id: string, inp: PathInput, by: string): TrainingPath {
  const cur = getTrainingPath(id);
  if (!cur) throw new Error('培训路径不存在');
  const c = clean(inp);
  if (!c.title) throw new Error('培训路径名称不能为空');
  checkQuiz(c.quiz);
  const row: TrainingPathRow = {
    ...cur,
    title: c.title, title_en: c.titleEn, role: c.role,
    assignees: JSON.stringify(c.assignees), steps: JSON.stringify(c.steps), quiz: JSON.stringify(c.quiz),
    pass_score: c.passScore, admin_only: c.adminOnly ? 1 : 0, updated_at: Date.now(), updated_by: by,
  };
  updateTrainingPath(row);
  return rowToPath(row);
}

const blank = (pathId: string, user: string): TrainingProgressRow =>
  ({ path_id: pathId, user_name: user, done: '[]', done_at: '{}', attempts: 0, best_score: null, passed_quiz: 0, updated_at: Date.now() });

/* 勾 / 取消勾一步。只认这条路径里真实存在的步骤 id。 */
export function markStep(pathId: string, user: string, stepId: string, done: boolean): TrainingProgress {
  const path = onePath(pathId);
  if (!path) throw new Error('培训路径不存在');
  if (!path.steps.some((s) => s.id === stepId)) throw new Error('无效的步骤');
  const cur = getTrainingProgress(pathId, user) || blank(pathId, user);
  const list = new Set(jparse<string[]>(cur.done, []));
  const at = jparse<Record<string, number>>(cur.done_at, {});
  if (done) { list.add(stepId); at[stepId] = Date.now(); } else { list.delete(stepId); delete at[stepId]; }
  const row: TrainingProgressRow = { ...cur, done: JSON.stringify([...list]), done_at: JSON.stringify(at), updated_at: Date.now() };
  upsertTrainingProgress(row);
  return rowToProgress(row);
}

/* 交卷。判分只在这里做,浏览器拿不到答案,也就没法自己给自己判及格。 */
export function submitQuiz(pathId: string, user: string, answers: Record<string, string[]>) {
  const path = onePath(pathId);
  if (!path) throw new Error('培训路径不存在');
  if (!path.quiz.length) throw new Error('这条路径没有配考核');
  const g = grade(path.quiz, answers || {});
  const passed = g.score >= path.passScore;

  const cur = getTrainingProgress(pathId, user) || blank(pathId, user);
  const best = cur.best_score == null ? g.score : Math.max(cur.best_score, g.score);
  const row: TrainingProgressRow = {
    ...cur,
    attempts: cur.attempts + 1,
    best_score: best,
    /* 通过了就一直是通过 —— 后面再练一次考砸了不该把资格收回去 */
    passed_quiz: cur.passed_quiz || passed ? 1 : 0,
    updated_at: Date.now(),
  };
  upsertTrainingProgress(row);
  insertTrainingAttempt(pathId, user, g.score, passed);
  return { score: g.score, right: g.right, total: g.total, passed, passScore: path.passScore, progress: rowToProgress(row) };
}
