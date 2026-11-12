/* ===== REQ-062 · 新人培训:给页面的数据 + 所有操作(权限在这里判) =====
   GET /api/train  → bundle(这个人能看到的:自己的关卡、带的人、待我评估、能力矩阵、配置…)
   POST /api/train → act({ op, ... }),每个 op 先判权限,改完对那个学员 reconcile(记过关、自动升级)。
   权限(需求 2.12):
   - 看自己的培训、提交、约评估:自己
   - 签核实操、打分、填定级:PD / BD;带教人只对自己带的人
   - 看能力矩阵:PD / BD 全部;带教人自己和带的人;PM 只看自己;其他角色没有
   - 手动调级别、初始化矩阵、指定带教人、开始新人期、改 pm_level、编辑路径 / 评分表 / 及格线 / 晋级条件、开关派项目限制:PD / BD
   - 开下一级业务路径:PD / BD;带教人只对自己带的人
   - 维护测验题库:PD / BD 和能当带教人的(Senior PM / PM Director) */
import type Database from 'better-sqlite3';
import { getDb, listProjects } from './db';
import {
  GATE_KEY, addAssess, addTrack, kbIndex, rowToAssess, allLevels, finishAssess, gateOn, getAssess, getConfig, getQuiz, isConfigPart, levelsOf, listAttend,
  promoChecks, quizInfo, reconcile, saveQuiz, savePlacement, setAttend, setConfigPart, setLevel, setMark, setMentor,
  setNoviceStart, setPmLevel, setPromoCheck, skillLog, trainUser, trainUsers, viewOf, type TUser,
} from './trainStore';
import {
  ASSIST, INDEPENDENT, TRAIN_BIZ_KEYS, canAct, isPmLevel, isTrainBiz, mentorEligible, projectBizs, promoChecklist, promoFor,
  rubricResult, type Assess, type PersonView, type StepView, type TrainConfig,
} from '@/lib/train';
import { bizOfSvc } from '@/lib/bizMap';
import { grade, type QuizQuestion } from '@/lib/training';
import { clean as cleanLegacy } from './training';
import { isApproach } from '@/lib/approach';
import { recentQuarterPoints } from '@/lib/kpi';
import { localDay } from '@/lib/localDate';
import { pointRulesFor } from './kpiRules';
import type { Project, User } from '@/lib/types';

export class TrainError extends Error { constructor(msg: string, public status = 400) { super(msg); } }
const deny = (zh: string, en: string) => new TrainError(`${zh} / ${en}`, 403);
const bad = (zh: string, en: string) => new TrainError(`${zh} / ${en}`, 400);

export interface Me { name: string; role: string; pmLevel: string; admin: boolean; eligible: boolean; mentees: string[] }
export function meOf(d: Database.Database, u: Pick<User, 'name' | 'role'>): Me {
  const all = trainUsers(d);
  const row = all.find((x) => x.name === u.name);
  const admin = u.role === 'director' || u.role === 'bd';
  return {
    name: u.name, role: u.role, pmLevel: row?.pmLevel || '', admin,
    eligible: mentorEligible({ role: u.role, pmLevel: row?.pmLevel }),
    mentees: all.filter((x) => x.mentor === u.name && !x.deleted).map((x) => x.name),
  };
}
export const canReview = (me: Me, student: string) => me.admin || me.mentees.includes(student);
export const canSeeMatrix = (me: Me) => me.admin || me.role === 'pm' || me.mentees.length > 0 || me.eligible;
export const canMaintainQuiz = (me: Me) => me.admin || me.eligible;

/* 能力矩阵的行:PM 角色 + 任何有级别 / 带教 / 新人期 / 业务路径的人(停用 / 删除的不列) */
function matrixPeople(d: Database.Database, users: TUser[]): TUser[] {
  const withData = new Set<string>([
    ...allLevels(d).map((r) => r.user),
    ...(d.prepare('SELECT DISTINCT user FROM tr_tracks').all() as { user: string }[]).map((r) => r.user),
  ]);
  return users.filter((u) => !u.disabled && !u.deleted && u.role !== 'director' && u.role !== 'bd'
    && (u.role === 'pm' || u.mentor || u.noviceStart != null || withData.has(u.name)));
}
const visibleNames = (me: Me, people: TUser[]) => people.filter((u) => me.admin || u.name === me.name || me.mentees.includes(u.name)).map((u) => u.name);

/* 学员提交实操时能关联的项目:跟项目 / 协助 / 负责 PM,而且项目里有这个业务(主线的不限业务) */
function projectsFor(name: string, projects: Project[]) {
  const live = projects.filter((p) => !isApproach(p) && !p.archived);
  const pick = (f: (p: Project) => boolean) => live.filter(f).map((p) => ({ id: p.id, name: p.name, bizs: projectBizs((p.packages || []).map((k) => k.svc)) }));
  return {
    shadow: pick((p) => (p.trainees || []).some((t) => t.name === name && t.mode === 'shadow')),
    assist: pick((p) => (p.trainees || []).some((t) => t.name === name && t.mode === 'assist')),
    owner: pick((p) => (p.owners || []).includes(name)),
  };
}

/* 带过几个这个业务的项目(当负责 PM)—— 到 3 个给「可带教」的提示 */
function ledCounts(projects: Project[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const p of projects) {
    if (isApproach(p)) continue;
    const bizs = projectBizs((p.packages || []).map((k) => k.svc));
    for (const o of p.owners || []) for (const b of bizs) ((out[o] ||= {})[b] = (out[o][b] || 0) + 1);
  }
  return out;
}

export function bundle(user: Pick<User, 'name' | 'role'>, now = Date.now()) {
  const d = getDb();
  const me = meOf(d, user);
  const cfg = getConfig(d);
  const users = trainUsers(d);
  const people = matrixPeople(d, users);
  const visible = new Set(visibleNames(me, people));
  const projects = listProjects();
  const view = (n: string) => viewOf(d, n, now, cfg);
  /* REQ-063:季度项目分值要积分规则,用到才读一次 */
  const today = localDay(new Date(now));
  let ptsCache: ReturnType<typeof pointRulesFor> | null = null;
  const ptsFor = () => (ptsCache ||= pointRulesFor());
  const meRow = users.find((u) => u.name === me.name);
  const myView = view(me.name);
  const mine = myView.stages.length ? myView : null;
  /* 带的人(PD / BD:所有在培训里的人) */
  const learners = people.filter((u) => u.name !== me.name && visible.has(u.name) && (u.noviceStart != null || u.mentor || (d.prepare('SELECT 1 FROM tr_tracks WHERE user = ?').get(u.name))));
  const views = learners.map((u) => view(u.name));
  const reviewable = views.filter((v) => canReview(me, v.user));
  /* 待我评估 */
  const queue: { user: string; kind: string; stage: string; key: string; id?: number; title: { zh: string; en: string }; at: number; project?: string; note?: string; ready?: boolean; self?: Record<string, string> | null }[] = [];
  for (const v of reviewable) {
    for (const s of v.stages) {
      if (s.status !== 'open') continue;
      for (const st of [...s.steps, ...s.gate]) {
        const last = st.history[st.history.length - 1];
        if (st.def.kind === 'task' && last?.status === 'submitted') queue.push({ user: v.user, kind: 'task', stage: s.key, key: st.key, id: last.id, title: { zh: st.def.zh, en: st.def.en }, at: last.at, project: last.project, note: last.note });
        if ((st.def.kind === 'present' || st.def.kind === 'sim') && last?.status === 'booked') queue.push({ user: v.user, kind: st.def.kind, stage: s.key, key: st.key, id: last.id, title: { zh: st.def.zh, en: st.def.en }, at: last.at });
        if (st.def.kind === 'placement' && st.state !== 'passed') {
          const selfAns = (d.prepare('SELECT data FROM tr_marks WHERE user = ? AND key = ?').get(v.user, 's0.self') as { data: string } | undefined)?.data;
          queue.push({ user: v.user, kind: 'placement', stage: s.key, key: st.key, title: { zh: st.def.zh, en: st.def.en }, at: v.noviceStart || 0, ready: s.learnDone, self: selfAns ? JSON.parse(selfAns) : null });
        }
      }
    }
  }
  /* 6 个月课程的考核:名单里、课都上了(或没有课)、还没有考核结果的 */
  const attend = listAttend(d);
  const courseExams = (d.prepare("SELECT * FROM tr_assess WHERE key LIKE 'course.%' ORDER BY at, id").all() as Record<string, unknown>[]).map(rowToAssess);
  for (const c of cfg.courses) {
    if (c.exam !== 'pass' && c.exam !== 'rubric') continue;
    for (const n of c.participants) {
      if (!canReview(me, n)) continue;
      const key = `course.${c.id}.exam`;
      if (courseExams.some((r) => r.user === n && r.key === key && r.status === 'passed')) continue;
      const allIn = c.lessons.every((l) => attend.some((a) => a.course === c.id && a.lesson === l.id && a.user === n && a.status === 'present'));
      if (allIn) queue.push({ user: n, kind: 'cexam', stage: c.id, key, title: { zh: `${c.code} ${c.zh} · 考核`, en: `${c.code} ${c.en} · assessment` }, at: 0 });
    }
  }
  const overdue = views.filter((v) => canReview(me, v.user)).flatMap((v) => v.stages.filter((s) => s.overdueDays > 0).map((s) => ({ user: v.user, stage: s.key, track: s.track, sid: s.sid, title: { zh: s.def.zh, en: s.def.en }, days: s.overdueDays, due: s.due })));

  /* 能力矩阵 */
  const lc = ledCounts(projects);
  const levelRows = allLevels(d);
  const matrix = canSeeMatrix(me) ? people.filter((u) => visible.has(u.name)).map((u) => {
    const v = u.name === me.name ? myView : views.find((x) => x.user === u.name) || view(u.name);
    const lv = Object.fromEntries(TRAIN_BIZ_KEYS.map((b) => [b, levelRows.find((r) => r.user === u.name && r.biz === b)?.level ?? 0]));
    const menteesDone = users.filter((x) => x.mentor === u.name).map((x) => (x.name === me.name ? myView : views.find((y) => y.user === x.name) || view(x.name))).filter((x) => x.noviceDone).length;
    const promo = promoFor(cfg, u.pmLevel);
    return {
      name: u.name, role: u.role, position: u.position, pmLevel: u.pmLevel, mentor: u.mentor, noviceStart: u.noviceStart,
      levels: lv, selected: v.selected, noviceDone: v.noviceDone, assistCount: v.assistCount, independentCount: v.independentCount,
      overdueDays: Math.max(0, ...v.stages.map((s) => s.overdueDays)),
      teachHint: TRAIN_BIZ_KEYS.filter((b) => lv[b] === INDEPENDENT && (lc[u.name]?.[b] || 0) >= 3),
      /* REQ-063:晋级条件里的「连续 N 个季度项目分值」用 KPI 的季度积分(最近 N 个已结束的季度,现算不落库) */
      promo: promo ? { id: promo.id, from: promo.from, to: promo.to, items: promoChecklist(promo, {
        levels: lv, menteesDone,
        manual: Object.fromEntries(Object.entries(promoChecks(d, u.name)).filter(([k]) => k.startsWith(`${promo.id}.`)).map(([k, x]) => [k.slice(promo.id.length + 1), x])),
        quarters: promo.kpi ? recentQuarterPoints(projects, u.name, promo.kpi.quarters, today, ptsFor()) : undefined,
      }) } : null,
    };
  }) : null;
  const log = matrix ? skillLog(d).filter((r) => visible.has(r.user)).slice(0, 1000) : [];
  const assessForMatrix = matrix ? (d.prepare("SELECT * FROM tr_assess WHERE status IN ('passed','approved','failed','returned') ORDER BY at DESC LIMIT 3000").all() as Record<string, unknown>[])
    .filter((r) => visible.has(r.user as string)).map(rowToAssess) : [];

  /* 课程:名单里看得到的人的点名和考核 */
  const seeCourse = (n: string) => me.admin || me.eligible || n === me.name || me.mentees.includes(n);
  const courses = {
    attend: attend.filter((a) => seeCourse(a.user)),
    exams: courseExams.filter((r) => seeCourse(r.user)),
    autoLevels: Object.fromEntries(cfg.courses.filter((c) => c.exam === 'auto').map((c) => [c.id, Object.fromEntries(c.participants.filter(seeCourse).map((n) => [n, levelsOf(d, n)[c.autoBiz || 'model'] || 0]))])),
  };

  /* 「路径与评分表」页上给 PD / BD 标红的:空板块、还没出题 */
  const qi = quizInfo(d);
  const warn = { noquiz: [] as string[], empty: [] as string[] };
  const kb = kbIndex(d);
  for (const [track, stages] of [['main', cfg.main] as const, ...Object.entries(cfg.biz)]) {
    for (const s of stages) for (const st of [...s.steps, ...s.gate]) {
      const key = `${track === 'main' ? s.id : `${track}.${s.id}`}.${st.id}`;
      if (st.kind === 'quiz' && !(qi[key]?.n)) warn.noquiz.push(key);
      if (st.kind === 'docset' && !(kb[st.biz === 'cur' ? track : st.biz || '']?.[st.sec || ''] || []).length) warn.empty.push(key);
    }
  }
  return {
    me: { ...me, noviceStart: meRow?.noviceStart ?? null, mentor: meRow?.mentor || '', matrix: canSeeMatrix(me), quiz: canMaintainQuiz(me) },
    gateOn: gateOn(d),
    config: cfg,
    quizInfo: qi,
    warn,
    mine,
    myProjects: projectsFor(me.name, projects),
    people: views,
    queue: queue.sort((a, b) => a.at - b.at),
    overdue,
    matrix,
    log,
    assess: assessForMatrix,
    courses,
    users: users.filter((u) => !u.deleted && !u.disabled).map((u) => ({ name: u.name, role: u.role, pmLevel: me.admin || visible.has(u.name) ? u.pmLevel : undefined, eligible: mentorEligible(u) })),
  };
}

/* ── 操作 ── */
type Body = Record<string, unknown>;
const s = (x: unknown, n = 200) => String(x ?? '').trim().slice(0, n);

function studentView(d: Database.Database, name: string, now: number): PersonView {
  if (!trainUser(d, name)) throw bad('没有这个人', 'No such user');
  return viewOf(d, name, now);
}
function stepOf(v: PersonView, key: string): StepView | undefined {
  for (const st of v.stages) { const x = [...st.steps, ...st.gate].find((y) => y.key === key); if (x) return x; }
  return undefined;
}

export function act(user: Pick<User, 'name' | 'role'>, b: Body, now = Date.now()): { ok: true; result?: unknown } {
  const d = getDb();
  const me = meOf(d, user);
  const cfg = getConfig(d);
  const op = s(b.op, 30);
  const touched = new Set<string>();
  let result: unknown;
  const needAdmin = () => { if (!me.admin) throw deny('只有 PD / BD 可以做这一步', 'Only PD / BD can do this'); };
  const needReview = (who: string) => { if (!canReview(me, who)) throw deny('只能评估自己带的人', 'You can only assess people you mentor'); };

  switch (op) {
    /* —— 学员自己 —— */
    case 'mark': {   // 自评问卷 / 读文档 / 板块阅读:自己勾
      const key = s(b.key, 80);
      const v = viewOf(d, me.name, now, cfg);
      const c = canAct(v, key);
      if (!c.ok) throw new TrainError(c.why, 409);
      const st = c.step!;
      if (!['self', 'doc', 'docset'].includes(st.def.kind)) throw bad('这一步不能自己勾', 'This step cannot be ticked by yourself');
      const on = b.done !== false;
      let data: unknown = null;
      if (st.def.kind === 'self' && on) {
        const ans = (b.answers || {}) as Record<string, unknown>;
        data = Object.fromEntries(TRAIN_BIZ_KEYS.map((k) => [k, ['none', 'done', 'led'].includes(String(ans[k])) ? String(ans[k]) : 'none']));
      }
      if (st.def.kind === 'docset' && on && (st.docs || []).some((x) => !x.read)) throw bad('这个板块的文档还没有都打开过', 'Open every document in this section first');
      if (st.def.kind === 'doc' && on && st.docs?.[0] && !st.docs[0].read) throw bad('先打开这篇文档', 'Open the document first');
      setMark(d, me.name, key, on, data, now);
      touched.add(me.name);
      break;
    }
    case 'submitTask': {
      const key = s(b.key, 80);
      const v = viewOf(d, me.name, now, cfg);
      const c = canAct(v, key);
      if (!c.ok) throw new TrainError(c.why, 409);
      const st = c.step!;
      if (st.def.kind !== 'task') throw bad('这一步不是实操', 'This step is not a practical task');
      if (st.state === 'submitted') throw bad('已经提交了,等带教人签核', 'Already submitted — waiting for your mentor');
      if (st.state === 'done') throw bad('这一步已经通过了', 'This step is already signed off');
      const note = s(b.note, 4000);
      if (!note) throw bad('请写完成说明', 'Describe what you did');
      const pid = s(b.project, 60);
      if (st.def.project) {
        const mine = projectsFor(me.name, listProjects())[st.def.project];
        const okP = mine.find((p) => p.id === pid);
        if (!okP) throw bad(
          st.def.project === 'shadow' ? '要关联一个你是「跟项目」成员的项目' : st.def.project === 'assist' ? '要关联一个你是「协助」成员的项目' : '要关联一个你是负责 PM 的项目',
          st.def.project === 'shadow' ? 'Link a project you shadow' : st.def.project === 'assist' ? 'Link a project you assist on' : 'Link a project you lead');
        if (c.stage!.track !== 'main' && !okP.bizs.includes(c.stage!.track)) throw bad('这个项目里没有这个业务', 'That project does not include this service');
      }
      addAssess(d, { user: me.name, key, kind: 'task', status: 'submitted', note, project: pid, by: me.name, at: now });
      break;
    }
    case 'book': {   // 约讲解 / 模拟演练
      const key = s(b.key, 80);
      const v = viewOf(d, me.name, now, cfg);
      const c = canAct(v, key);
      if (!c.ok) throw new TrainError(c.why, 409);
      const st = c.step!;
      if (st.def.kind !== 'present' && st.def.kind !== 'sim') throw bad('这一步不用约', 'This step is not booked');
      if (st.state === 'booked') throw bad('已经约了,等带教人打分', 'Already booked — waiting for the score');
      if (st.state === 'passed') throw bad('这一项已经通过了', 'Already passed');
      addAssess(d, { user: me.name, key, kind: st.def.kind, status: 'booked', note: s(b.note, 1000), by: me.name, at: now });
      break;
    }
    case 'quiz': {
      const key = s(b.key, 80);
      const v = viewOf(d, me.name, now, cfg);
      const c = canAct(v, key);
      if (!c.ok) throw new TrainError(c.why, 409);
      const st = c.step!;
      if (st.def.kind !== 'quiz') throw bad('这一步不是测验', 'This step is not a quiz');
      if (st.state === 'passed') throw bad('已经通过了', 'Already passed');
      const q = getQuiz(d, key);
      if (!q.questions.length) throw bad('这份测验还没出题', 'This quiz has no questions yet');
      const g = grade(q.questions, (b.answers || {}) as Record<string, string[]>);
      const passScore = q.passScore ?? st.def.passScore ?? cfg.pass.quiz;
      const passed = g.score >= passScore;
      addAssess(d, { user: me.name, key, kind: 'quiz', status: passed ? 'passed' : 'failed', score: g.score, by: me.name, at: now, doneAt: now, doneBy: me.name });
      touched.add(me.name);
      result = { score: g.score, right: g.right, total: g.total, passed, passScore };
      break;
    }

    /* —— 带教人 / PD / BD —— */
    case 'reviewTask': {
      const a = getAssess(d, Number(b.id));
      if (!a || a.kind !== 'task') throw bad('找不到这条提交', 'Submission not found');
      needReview(a.user);
      if (a.status !== 'submitted') throw bad('这条已经处理过了', 'Already handled');
      finishAssess(d, a.id, { status: b.ok ? 'approved' : 'returned', comment: s(b.comment, 2000), by: me.name, at: now });
      touched.add(a.user);
      break;
    }
    case 'signTask': {   // 不用关联项目的实操(面谈、跟会议):带教人直接签核
      const who = s(b.user, 60), key = s(b.key, 80);
      needReview(who);
      const v = studentView(d, who, now);
      const c = canAct(v, key);
      if (!c.ok) throw new TrainError(c.why, 409);
      if (c.step!.def.kind !== 'task' || c.step!.def.project) throw bad('这一步要学员自己提交', 'The learner has to submit this step');
      if (c.step!.state === 'done') throw bad('已经签核了', 'Already signed off');
      addAssess(d, { user: who, key, kind: 'task', status: 'approved', note: s(b.note, 2000), comment: s(b.comment, 2000), by: me.name, at: now, doneAt: now, doneBy: me.name });
      touched.add(who);
      break;
    }
    case 'score': {   // 讲解 / 模拟演练打分
      const a = getAssess(d, Number(b.id));
      if (!a || (a.kind !== 'present' && a.kind !== 'sim')) throw bad('找不到这次评估', 'Assessment not found');
      needReview(a.user);
      if (a.status !== 'booked') throw bad('这次已经打过分了', 'Already scored');
      const raw = Array.isArray(b.scores) ? b.scores : [];
      const scores = raw.slice(0, 4).map((x) => ({ s: Math.round(Number((x as { s?: unknown })?.s)), c: s((x as { c?: unknown })?.c, 500) }));
      if (scores.length !== 4) throw bad('4 项都要打分', 'Score all 4 items');
      const r = rubricResult(scores.map((x) => x.s), cfg.pass);
      if (!r.valid) throw bad('每项 1 – 5 分', 'Each item is scored 1 – 5');
      finishAssess(d, a.id, { status: r.passed ? 'passed' : 'failed', scores, comment: s(b.comment, 2000), by: me.name, at: now });
      touched.add(a.user);
      result = r;
      break;
    }
    case 'placement': {
      const who = s(b.user, 60);
      needReview(who);
      const v = studentView(d, who, now);
      const st = v.stages.find((x) => x.sid === 's0' && x.track === 'main');
      if (!st || st.status === 'locked') throw new TrainError('还没开始新人期 / The induction has not started', 409);
      if (st.status === 'passed') throw bad('已经定过级了', 'Placement already recorded');
      if (!st.learnDone) throw new TrainError('先完成自评问卷和面谈 / Finish the self-assessment and interview first', 409);
      const bizs = [...new Set((Array.isArray(b.bizs) ? b.bizs : []).map(String))].filter(isTrainBiz);
      if (bizs.length < 2 || bizs.length > 3) throw bad('新人期同时带 2 – 3 个业务', 'Pick 2 – 3 services for the induction');
      const lvIn = (b.levels || {}) as Record<string, unknown>;
      const levels: Record<string, number> = {};
      for (const k of bizs) {
        const lv = Math.round(Number(lvIn[k] ?? 0));
        if (!(lv >= 0 && lv <= ASSIST)) throw bad('定级最高只能给到「可协助」', 'Placement can go up to “Can assist” at most');
        levels[k] = lv;
      }
      const self = ((d.prepare('SELECT data FROM tr_marks WHERE user = ? AND key = ?').get(who, 's0.self') as { data: string } | undefined)?.data) || '{}';
      d.transaction(() => {
        savePlacement(d, who, { self: JSON.parse(self) || {}, bizs, levels, comment: s(b.comment, 2000) }, me.name, now);
        for (const k of bizs) {
          addTrack(d, who, k, me.name, 'placement', now);
          if (levels[k] > 0) setLevel(d, { user: who, biz: k, level: levels[k], source: 'placement', ref: 's0', by: me.name, at: now, raiseOnly: true });
        }
      })();
      touched.add(who);
      break;
    }
    case 'openTrack': {   // 开下一级业务路径(新人期之外加开业务)
      const who = s(b.user, 60), biz = s(b.biz, 20);
      if (!isTrainBiz(biz)) throw bad('业务不对', 'Unknown service');
      needReview(who);
      if (!trainUser(d, who)) throw bad('没有这个人', 'No such user');
      addTrack(d, who, biz, me.name, 'open', now);
      touched.add(who);
      break;
    }
    case 'attend': {   // 课程点名:PD / BD 或带教人(讲师)
      if (!me.admin && !me.eligible) throw deny('只有 PD / BD 或带教人可以点名', 'Only PD / BD or mentors can take attendance');
      const c = cfg.courses.find((x) => x.id === s(b.course, 20));
      if (!c) throw bad('没有这门课', 'No such course');
      const lesson = c.lessons.find((l) => l.id === s(b.lesson, 20));
      if (!lesson) throw bad('没有这一课', 'No such lesson');
      const who = s(b.user, 60);
      if (!c.participants.includes(who)) throw bad('这个人不在这门课的名单里', 'Not on this course\'s list');
      const status = b.status === 'present' ? 'present' : b.status === 'absent' ? 'absent' : '';
      if (!status) d.prepare('DELETE FROM tr_attend WHERE course = ? AND lesson = ? AND user = ?').run(c.id, lesson.id, who);
      else setAttend(d, c.id, lesson.id, who, status, me.name, now);
      break;
    }
    case 'courseExam': {
      const c = cfg.courses.find((x) => x.id === s(b.course, 20));
      if (!c || (c.exam !== 'pass' && c.exam !== 'rubric')) throw bad('这门课没有考核', 'This course has no assessment');
      const who = s(b.user, 60);
      if (!c.participants.includes(who)) throw bad('这个人不在这门课的名单里', 'Not on this course\'s list');
      needReview(who);
      const key = `course.${c.id}.exam`;
      if (c.exam === 'rubric') {
        const raw = Array.isArray(b.scores) ? b.scores : [];
        const scores = raw.slice(0, 4).map((x) => ({ s: Math.round(Number((x as { s?: unknown })?.s)), c: s((x as { c?: unknown })?.c, 500) }));
        const r = rubricResult(scores.map((x) => x.s), cfg.pass);
        if (scores.length !== 4 || !r.valid) throw bad('4 项都要打 1 – 5 分', 'Score all 4 items from 1 to 5');
        addAssess(d, { user: who, key, kind: 'cexam', status: r.passed ? 'passed' : 'failed', scores, comment: s(b.comment, 2000), by: me.name, at: now, doneAt: now, doneBy: me.name });
        result = r;
      } else {
        addAssess(d, { user: who, key, kind: 'cexam', status: b.passed ? 'passed' : 'failed', comment: s(b.comment, 2000), by: me.name, at: now, doneAt: now, doneBy: me.name });
      }
      break;
    }

    /* —— PD / BD —— */
    case 'setLevel': {
      needAdmin();
      const who = s(b.user, 60), biz = s(b.biz, 20), reason = s(b.reason, 500);
      if (!isTrainBiz(biz)) throw bad('业务不对', 'Unknown service');
      if (!trainUser(d, who)) throw bad('没有这个人', 'No such user');
      if (!reason) throw bad('手动调整要写原因', 'A reason is required for a manual change');
      const lv = Math.round(Number(b.level));
      if (!(lv >= 0 && lv <= 4)) throw bad('级别不对', 'Invalid level');
      setLevel(d, { user: who, biz, level: lv, source: 'manual', reason, by: me.name, at: now });
      touched.add(who);
      break;
    }
    case 'initLevels': {   // 上线初始化:一次填多格,原因统一填一次
      needAdmin();
      const reason = s(b.reason, 500) || '上线初始化 / Initial set-up';
      const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 2000) as { user?: unknown; biz?: unknown; level?: unknown }[];
      d.transaction(() => {
        for (const r of rows) {
          const who = s(r.user, 60), biz = s(r.biz, 20), lv = Math.round(Number(r.level));
          if (!isTrainBiz(biz) || !(lv >= 0 && lv <= 4) || !trainUser(d, who)) continue;
          if (setLevel(d, { user: who, biz, level: lv, source: 'init', reason, by: me.name, at: now })) touched.add(who);
        }
      })();
      break;
    }
    case 'setPmLevel': {
      needAdmin();
      const who = s(b.user, 60);
      if (!trainUser(d, who)) throw bad('没有这个人', 'No such user');
      if (!isPmLevel(b.level)) throw bad('PM 级别不对', 'Invalid PM level');
      setPmLevel(d, who, String(b.level));
      break;
    }
    case 'setMentor': {
      needAdmin();
      const who = s(b.user, 60), mentor = s(b.mentor, 60);
      if (!trainUser(d, who)) throw bad('没有这个人', 'No such user');
      if (mentor) {
        if (mentor === who) throw bad('不能自己带自己', 'Cannot mentor yourself');
        const m = trainUser(d, mentor);
        if (!m || m.deleted || m.disabled || !mentorEligible(m)) throw bad('带教人要是 PD / BD,或 PM 级别是 Senior PM / PM Director', 'A mentor must be PD / BD, or a Senior PM / PM Director');
      }
      setMentor(d, who, mentor);
      break;
    }
    case 'startNovice': {
      needAdmin();
      const who = s(b.user, 60);
      const u = trainUser(d, who);
      if (!u) throw bad('没有这个人', 'No such user');
      if (u.role !== 'pm') throw bad('新人期只给 PM', 'The induction is for PMs');
      if (!u.mentor) throw bad('先指定带教人', 'Assign a mentor first');
      if (u.noviceStart != null) throw bad('已经在新人期了', 'Already in the induction');
      const day = s(b.start, 10);
      const at = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00`).getTime() : now;
      setNoviceStart(d, who, at);
      touched.add(who);
      break;
    }
    case 'config': {
      needAdmin();
      const part = s(b.part, 20);
      if (!isConfigPart(part)) throw bad('不认识的配置', 'Unknown setting');
      try { result = setConfigPart(d, part, b.value, me.name, now); } catch (e) { throw new TrainError((e as Error).message, 400); }
      break;
    }
    case 'promoCheck': {
      needAdmin();
      const who = s(b.user, 60), item = s(b.item, 60);
      if (!trainUser(d, who)) throw bad('没有这个人', 'No such user');
      setPromoCheck(d, who, item, !!b.done, me.name, now);
      break;
    }
    case 'gate': {
      needAdmin();
      d.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(GATE_KEY, b.on ? '1' : '0');
      break;
    }
    default:
      throw bad('不认识的操作', 'Unknown action');
  }
  for (const n of touched) reconcile(d, n, me.name, now);
  return { ok: true, result };
}

/* ── 测验:学员拿题(不带答案)/ 维护的人拿全量、保存 ── */
function quizStep(cfg: TrainConfig, key: string) {
  const parts = key.split('.');
  const [track, sid, stepId] = parts.length === 2 ? ['main', parts[0], parts[1]] : [parts[0], parts[1], parts[2]];
  const stages = track === 'main' ? cfg.main : cfg.biz[track];
  const st = stages?.find((x) => x.id === sid)?.gate.find((x) => x.id === stepId && x.kind === 'quiz');
  return st || null;
}
export function quizForLearner(user: Pick<User, 'name' | 'role'>, key: string, now = Date.now()) {
  const d = getDb();
  const v = viewOf(d, user.name, now);
  const c = canAct(v, key);
  if (!c.ok) throw new TrainError(c.why, 409);
  if (c.step!.def.kind !== 'quiz') throw bad('这一步不是测验', 'This step is not a quiz');
  const q = getQuiz(d, key);
  return { questions: q.questions.map((x) => ({ ...x, answer: [] as string[] })), passScore: q.passScore ?? c.step!.def.passScore ?? getConfig(d).pass.quiz };
}
export function quizForMaintainer(user: Pick<User, 'name' | 'role'>, key: string, now = Date.now()) {
  const d = getDb();
  const me = meOf(d, user);
  if (!canMaintainQuiz(me)) throw deny('只有 PD / BD 和带教人可以维护题库', 'Only PD / BD and mentors can maintain quizzes');
  const cfg = getConfig(d);
  const st = quizStep(cfg, key);
  if (!st) throw bad('没有这份测验', 'No such quiz');
  /* 自己还要考这一份的(新人期里还没过),不给答案 */
  const mine = stepOf(viewOf(d, me.name, now, cfg), key);
  if (mine && mine.state !== 'passed') throw deny('这份测验你自己还要考,不能看答案', 'You still have to take this quiz, so you cannot see the answers');
  return { key, step: st, ...getQuiz(d, key), defaultPass: st.passScore ?? cfg.pass.quiz };
}
export function saveQuizAs(user: Pick<User, 'name' | 'role'>, key: string, body: { questions?: unknown; passScore?: unknown }, now = Date.now()) {
  const d = getDb();
  quizForMaintainer(user, key, now);   // 同样的权限
  const me = meOf(d, user);
  const questions = cleanLegacy({ title: 'x', quiz: body.questions }).quiz as QuizQuestion[];
  for (const [i, q] of questions.entries()) {
    if (!q.q) throw bad(`第 ${i + 1} 题还没写题干`, `Question ${i + 1} has no text`);
    if (q.options.length < 2) throw bad(`第 ${i + 1} 题至少要有两个选项`, `Question ${i + 1} needs at least two options`);
    if (!q.answer.length) throw bad(`第 ${i + 1} 题还没标正确答案`, `Question ${i + 1} has no correct answer`);
  }
  const cur = getQuiz(d, key);
  let pass = cur.passScore;
  if (body.passScore !== undefined) {
    if (!me.admin) { if ((body.passScore ?? null) !== cur.passScore) throw deny('及格线只有 PD / BD 能改', 'Only PD / BD can change the pass mark'); }
    else pass = body.passScore === null || body.passScore === '' ? null : Math.max(0, Math.min(100, Math.round(Number(body.passScore))));
  }
  saveQuiz(d, key, questions, pass, me.name, now);
  return getQuiz(d, key);
}

/* 给项目列表用:这个人在哪些业务上的级别(派项目检查用,不往页面发) */
export const levelsFor = (name: string) => levelsOf(getDb(), name);
export const bizOf = bizOfSvc;
export type { Assess };
