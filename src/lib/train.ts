/* ===== REQ-062 · 新人培训:分阶段过关、评估、能力矩阵、派项目限制 =====
   这里只放「纯计算」:类型、预置内容、解锁 / 过关 / 及格 / 新人期 / 晋级 / 派项目的判断。
   服务端(server/trainStore.ts)把库里的数据读成 TrainData 交给这里算,算好的结果发给页面 ——
   页面不自己判,免得两边口径不一样。单元测试直接测这里。
   REQ-036 的老路径(lib/training.ts)不动,页面上放在「其他培训」。 */
import { KB_BIZ, bizOfSvc, type KbBiz } from './bizMap';

export const DAY = 86_400_000;

/* ── 级别(每人每个业务一个) ── */
export type Lv = 0 | 1 | 2 | 3 | 4;
export const LEVELS: { v: Lv; zh: string; en: string; color: string; bg: string }[] = [
  { v: 0, zh: '未学', en: 'Not started', color: '#8A8478', bg: '#f1efea' },
  { v: 1, zh: '了解', en: 'Aware', color: '#2F6FB0', bg: '#e6eef8' },
  { v: 2, zh: '可协助', en: 'Can assist', color: '#a8690b', bg: '#fbf0dc' },
  { v: 3, zh: '可独立', en: 'Independent', color: '#0f6a48', bg: '#e6f2ec' },
  { v: 4, zh: '可带教', en: 'Can mentor', color: '#7A4FB5', bg: '#efe8f8' },
];
export const lvName = (v: number, lang: 'zh' | 'en') => { const l = LEVELS[Math.max(0, Math.min(4, v))]; return lang === 'zh' ? l.zh : l.en; };
export const ASSIST: Lv = 2;
export const INDEPENDENT: Lv = 3;

/* ── PM 级别(users.pm_level) ── */
export type PmLevel = '' | 'coord' | 'pm' | 'senior' | 'director';
export const PM_LEVELS: { v: Exclude<PmLevel, ''>; zh: string; en: string }[] = [
  { v: 'coord', zh: 'Project Coordinator', en: 'Project Coordinator' },
  { v: 'pm', zh: 'PM', en: 'PM' },
  { v: 'senior', zh: 'Senior PM', en: 'Senior PM' },
  { v: 'director', zh: 'PM Director', en: 'PM Director' },
];
export const isPmLevel = (x: unknown): x is PmLevel => x === '' || PM_LEVELS.some((l) => l.v === x);
export const pmLevelName = (v: string) => PM_LEVELS.find((l) => l.v === v)?.en || '';
/* 上线时按「职位」文字预填一次(只给 PM 角色;认不出来的留空,PD / BD 再核对) */
export function pmLevelFromPosition(position: string): PmLevel {
  const s = (position || '').toLowerCase();
  if (!s.trim()) return '';
  if (/director|总监|主管/.test(s)) return 'director';
  if (/senior|高级|资深/.test(s)) return 'senior';
  if (/coord|助理|协调/.test(s)) return 'coord';
  if (/\bpm\b|project manager|项目经理/.test(s)) return 'pm';
  return '';
}
/* 能当带教人:PD / BD,或 PM 级别是 Senior PM / PM Director */
export const mentorEligible = (u: { role: string; pmLevel?: string }) =>
  u.role === 'director' || u.role === 'bd' || (u.role === 'pm' && (u.pmLevel === 'senior' || u.pmLevel === 'director'));

/* ── 业务(7 个,来自 REQ-061 的 bizMap,不含「总览」「其他业务」) ── */
export const TRAIN_BIZ = KB_BIZ.filter((b) => b.key !== 'overview' && b.key !== 'other');
export const TRAIN_BIZ_KEYS = TRAIN_BIZ.map((b) => b.key) as KbBiz[];
export const isTrainBiz = (x: unknown): x is KbBiz => typeof x === 'string' && (TRAIN_BIZ_KEYS as string[]).includes(x);
export const bizLabel = (k: string, lang: 'zh' | 'en') => { const b = KB_BIZ.find((x) => x.key === k); return b ? (lang === 'zh' ? b.zh : b.en) : k; };

/* ── 关卡结构 ── */
export type StepKind = 'self' | 'doc' | 'docset' | 'task' | 'quiz' | 'present' | 'sim' | 'placement';
export const STEP_KINDS: Record<StepKind, { icon: string; zh: string; en: string; gate: boolean }> = {
  self: { icon: '📝', zh: '自评问卷 · 自己填', en: 'Self-assessment · you fill it in', gate: false },
  doc: { icon: '📄', zh: '读文档 · 自己勾', en: 'Read a document · tick it yourself', gate: false },
  docset: { icon: '🧩', zh: '板块阅读 · 文档都打开过才能勾', en: 'Section reading · open every document, then tick', gate: false },
  task: { icon: '🛠', zh: '实操 · 带教人签核', en: 'Practical task · signed off by your mentor', gate: false },
  quiz: { icon: '✍️', zh: '测验 · 系统判分', en: 'Quiz · marked by the system', gate: true },
  present: { icon: '🎤', zh: '讲解 Presentation · 带教人按评分表打分', en: 'Presentation · scored by your mentor', gate: true },
  sim: { icon: '🎭', zh: '模拟演练 · 带教人按评分表打分', en: 'Simulation · scored by your mentor', gate: true },
  placement: { icon: '🧭', zh: '定级 · 带教人填', en: 'Placement · filled in by your mentor', gate: true },
};
export type RubricKey = 'present' | 'simBrief' | 'simEmail';
export type ProjectRole = 'shadow' | 'assist' | 'owner';
export interface TStep {
  id: string;
  kind: StepKind;
  zh: string;
  en: string;
  docId?: string;          // doc:指定文档;map = 首页流程地图那篇
  map?: boolean;
  biz?: string;            // docset:业务('cur' = 这条业务路径自己的业务)
  sec?: string;            // docset:板块
  rubric?: RubricKey;      // present / sim
  project?: ProjectRole;   // task:提交时必须关联一个自己是 跟项目 / 协助 / 负责 PM 的项目
  passScore?: number;      // quiz:这一份的及格线(空 = 用全局)
}
export type StageId = 's0' | 's1' | 's2' | 's3' | 's4';
export interface TStage { id: StageId; zh: string; en: string; dueDay: number; upZh: string; upEn: string; steps: TStep[]; gate: TStep[] }
export const STAGE_TARGET: Partial<Record<StageId, Lv>> = { s2: 1, s3: 2, s4: 3 };   // 过关后这个业务升到几级
export const STAGE_NO: Record<StageId, number> = { s0: 0, s1: 1, s2: 2, s3: 3, s4: 4 };

export interface Rubric { zh: string; en: string; items: { zh: string; en: string }[] }
export interface Course {
  id: string; code: string; zh: string; en: string;
  lessons: { id: string; zh: string; en: string }[];
  exam: 'pass' | 'rubric' | 'auto' | 'none';   // 通过 / 未通过;讲解评分表;M4 = 实体模型到「可独立」;没有考核
  autoBiz?: string;
  participants: string[];                       // 学员名单:PD / BD 每门课手动选
}
export interface PromoReq { bizs: string[]; level: Lv; need: number }
export interface Promo {
  id: string; from: Exclude<PmLevel, ''>; to: Exclude<PmLevel, ''>;
  matrix: PromoReq[];            // 能力矩阵条件(每条:这几个业务里至少 need 个到 level)
  mentees: number;               // 带教几名新人走完新人期
  kpi: { min: number; quarters: number } | null;   // 连续几个季度项目分值 ≥ min(REQ-063)
  manual: { id: string; zh: string; en: string }[];   // PD / BD 手动勾
}
export interface TrainConfig {
  main: TStage[];                       // 关 0、关 1
  biz: Record<string, TStage[]>;        // 7 条业务路径,各 关 2 – 4
  rubrics: Record<RubricKey, Rubric>;
  pass: { avg: number; min: number; quiz: number };
  courses: Course[];
  coursesNote: { zh: string; en: string };
  promo: Promo[];
}

/* ── 预置内容(首次启动写进库;PD / BD 之后在「路径与评分表」里改) ── */
export const DEFAULT_RUBRICS: Record<RubricKey, Rubric> = {
  present: { zh: '讲解 Presentation', en: 'Presentation', items: [
    { zh: '内容准确:业务、交付物、术语没有讲错', en: 'Accurate: services, deliverables and terms are right' },
    { zh: '流程清楚:从交接到交付每一步、谁负责、哪里要客户确认(workflow 了解程度)', en: 'Clear workflow: every step from handover to delivery, who owns it, where the client signs off' },
    { zh: '应对提问:带教人追问 3 个「如果…怎么办」', en: 'Handles questions: three “what if…” follow-ups from the mentor' },
    { zh: '表达与时间:像对客户讲,10 分钟内讲完', en: 'Delivery and timing: as if to a client, within 10 minutes' },
  ] },
  simBrief: { zh: '模拟演练 · 接 brief', en: 'Simulation · taking a brief', items: [
    { zh: '资料问全:对照这个业务的资料清单,没有漏项', en: 'Complete: nothing missed against this service\'s checklist' },
    { zh: '确认范围、数量、交期', en: 'Confirms scope, quantities and deadlines' },
    { zh: '会后纪要(E2)写清楚、当天发出', en: 'Clear meeting minutes (E2), sent the same day' },
    { zh: '应对加需求:知道什么时候要开变更单', en: 'Handles extra requests: knows when a variation order is needed' },
  ] },
  simEmail: { zh: '模拟演练 · 写邮件', en: 'Simulation · writing an email', items: [
    { zh: '用对模板(E3 小样确认 / E5 第 3 轮提醒…)', en: 'Right template (E3 sample sign-off / E5 third-round reminder…)' },
    { zh: '信息完整:附件、截止时间、需要客户回复什么', en: 'Complete: attachments, deadline, what the client must reply' },
    { zh: '语气得体,中英文无误', en: 'Right tone, no mistakes in Chinese or English' },
    { zh: '2 小时内把客户意见整理好转给深圳', en: 'Client comments sorted and passed to Shenzhen within 2 hours' },
  ] },
};
export const RUBRIC_KEYS: RubricKey[] = ['present', 'simBrief', 'simEmail'];

export const DEFAULT_MAIN: TStage[] = [
  { id: 's0', zh: '入职定级', en: 'Placement', dueDay: 2, upZh: '定新人期带哪 2 – 3 个业务、各业务的起步级别', upEn: 'Decides which 2 – 3 services to train in and the starting level of each',
    steps: [
      { id: 'self', kind: 'self', zh: '自评问卷:7 个业务各选「没做过 / 做过 / 独立带过」', en: 'Self-assessment: for each of the 7 services pick “never / done it / led it”' },
      { id: 'talk', kind: 'task', zh: '带教人面谈 + 抽问(对「做过」的业务追问流程)', en: 'Interview with your mentor (follow-up questions on services you have done)' },
    ],
    gate: [{ id: 'place', kind: 'placement', zh: '带教人填定级结果', en: 'Mentor records the placement' }] },
  { id: 's1', zh: '基础认知', en: 'Foundations', dueDay: 7, upZh: '解锁所选业务的关 2', upEn: 'Unlocks stage 2 of each chosen service',
    steps: [
      { id: 'map', kind: 'doc', map: true, zh: '读 SOP Map(流程地图总览)', en: 'Read the SOP Map (process map overview)' },
      { id: 'A', kind: 'docset', biz: 'overview', sec: 'A', zh: '总览 · A 成员架构', en: 'Overview · A Team structure' },
      { id: 'F', kind: 'docset', biz: 'overview', sec: 'F', zh: '总览 · F 邮件模板 + 项目规范', en: 'Overview · F Email templates + standards' },
      { id: 'meet', kind: 'task', zh: '跟 2 次项目会议并写纪要(E2)', en: 'Sit in on 2 project meetings and write the minutes (E2)' },
    ],
    gate: [
      { id: 'quiz', kind: 'quiz', zh: 'SOP 基础测验', en: 'SOP basics quiz' },
      { id: 'talk', kind: 'present', rubric: 'present', zh: '讲解:一个项目从交接到交付怎么走', en: 'Presentation: how a project goes from handover to delivery' },
    ] },
];

export function defaultBizStages(biz: string): TStage[] {
  const b = KB_BIZ.find((x) => x.key === biz);
  const zh = b?.zh || biz, en = b?.en || biz;
  return [
    { id: 's2', zh: '业务了解', en: 'Know the service', dueDay: 21, upZh: `${zh} → 了解`, upEn: `${en} → Aware`,
      steps: [
        { id: 'B', kind: 'docset', biz: 'cur', sec: 'B', zh: `${zh} · B 交接 + 制作流程`, en: `${en} · B Handover + production flow` },
        { id: 'C', kind: 'docset', biz: 'cur', sec: 'C', zh: `${zh} · C 清单 · 排期 · 阶段准备`, en: `${en} · C Checklist · schedule · stage prep` },
        { id: 'D', kind: 'docset', biz: 'cur', sec: 'D', zh: `${zh} · D 关键节点 + 总结邮件`, en: `${en} · D Milestones + summary emails` },
      ],
      gate: [
        { id: 'quiz', kind: 'quiz', zh: `${zh} 小测验`, en: `${en} quiz` },
        { id: 'talk', kind: 'present', rubric: 'present', zh: `讲解:${zh}的完整流程`, en: `Presentation: the whole ${en} workflow` },
      ] },
    { id: 's3', zh: '跟项目', en: 'Shadow a project', dueDay: 45, upZh: `${zh} → 可协助`, upEn: `${en} → Can assist`,
      steps: [{ id: 'shadow', kind: 'task', project: 'shadow', zh: `跟 1 个${zh}的真实项目(参加交接会、看完每个确认节点)`, en: `Shadow 1 real ${en} project (join the handover, follow every sign-off)` }],
      gate: [
        { id: 'brief', kind: 'sim', rubric: 'simBrief', zh: '模拟接 brief', en: 'Simulation: take a brief' },
        { id: 'email', kind: 'sim', rubric: 'simEmail', zh: '模拟写邮件', en: 'Simulation: write an email' },
      ] },
    { id: 's4', zh: '独立带项目', en: 'Run a project', dueDay: 90, upZh: `${zh} → 可独立`, upEn: `${en} → Independent`,
      steps: [
        { id: 'assist', kind: 'task', project: 'assist', zh: '协助 1 个项目:至少负责 2 个节点(如收资料、发小样)', en: 'Assist on 1 project: own at least 2 milestones (e.g. collect info, send samples)' },
        { id: 'lead', kind: 'task', project: 'owner', zh: `独立带 1 个 Coordinator 级${zh}项目,带教人旁听`, en: `Lead 1 coordinator-level ${en} project with your mentor sitting in` },
      ],
      gate: [{ id: 'review', kind: 'present', rubric: 'present', zh: '项目复盘讲解:做了什么、哪里出问题、修改了几轮、下次怎么做', en: 'Project review: what was done, what went wrong, how many rounds, what to do next time' }] },
  ];
}

export const DEFAULT_COURSES: Course[] = [
  { id: 'M1', code: 'M1', zh: '3ds Max 相机', en: '3ds Max cameras', exam: 'pass', participants: [],
    lessons: [1, 2, 3].map((n) => ({ id: `L${n}`, zh: `第 ${n} 课`, en: `Lesson ${n}` })) },
  { id: 'M2', code: 'M2', zh: '彩平制作', en: 'Colour floor plans', exam: 'pass', participants: [],
    lessons: [1, 2, 3, 4].map((n) => ({ id: `L${n}`, zh: `第 ${n} 课`, en: `Lesson ${n}` })) },
  { id: 'M3', code: 'M3', zh: 'SU 建模 → Max', en: 'SketchUp modelling → Max', exam: 'pass', participants: [],
    lessons: [1, 2, 3, 4].map((n) => ({ id: `L${n}`, zh: `第 ${n} 课`, en: `Lesson ${n}` })) },
  { id: 'M4', code: 'M4', zh: '实体模型独立跟项目', en: 'Scale models: run a project', exam: 'auto', autoBiz: 'model', participants: [], lessons: [] },
  { id: 'M5', code: 'M5', zh: 'AI 效果 / mood 工具', en: 'AI renders / mood tools', exam: 'rubric', participants: [],
    lessons: [{ id: 'L1', zh: '第 1 课', en: 'Lesson 1' }] },
  { id: 'M6', code: 'M6', zh: 'SOP Map + checklist', en: 'SOP Map + checklists', exam: 'rubric', participants: [],
    lessons: [{ id: 'L1', zh: '第 1 课', en: 'Lesson 1' }] },
  { id: 'PS', code: 'PS', zh: 'PS 后期基础(长期)', en: 'Photoshop post-production (ongoing)', exam: 'none', participants: [],
    lessons: [{ id: 'L1', zh: '第 1 课', en: 'Lesson 1' }] },
];
export const DEFAULT_COURSES_NOTE = { zh: '和新人主线并行,不锁。每两周一次,周二 3 – 4pm。', en: 'Runs alongside the main track and never locks. Every other Tuesday, 3 – 4pm.' };

export const DEFAULT_PROMO: Promo[] = [
  { id: 'coord-pm', from: 'coord', to: 'pm',
    matrix: [
      { bizs: ['persp'], level: 3, need: 1 }, { bizs: ['anim'], level: 3, need: 1 }, { bizs: ['model'], level: 3, need: 1 },
      { bizs: ['saleskit', 'digital'], level: 3, need: 1 }, { bizs: ['led', 'control'], level: 3, need: 1 },
    ],
    mentees: 0, kpi: { min: 60, quarters: 2 }, manual: [] },
  { id: 'pm-senior', from: 'pm', to: 'senior',
    matrix: [{ bizs: [...TRAIN_BIZ_KEYS], level: 4, need: 2 }],
    mentees: 1, kpi: { min: 90, quarters: 2 },
    manual: [{ id: 'meet3', zh: '独立主持 3 次客户会议', en: 'Chaired 3 client meetings on their own' }] },
  { id: 'senior-director', from: 'senior', to: 'director', matrix: [], mentees: 0, kpi: null,
    manual: [
      { id: 'team', zh: '带团队', en: 'Leads a team' },
      { id: 'bizdev', zh: '开发业务', en: 'Develops new business' },
      { id: 'innov', zh: '创新', en: 'Drives innovation' },
      { id: 'review', zh: 'PD / Director 评审', en: 'PD / Director review' },
    ] },
];

export function defaultConfig(): TrainConfig {
  return {
    main: JSON.parse(JSON.stringify(DEFAULT_MAIN)),
    biz: Object.fromEntries(TRAIN_BIZ_KEYS.map((b) => [b, defaultBizStages(b)])),
    rubrics: JSON.parse(JSON.stringify(DEFAULT_RUBRICS)),
    pass: { avg: 3.5, min: 3, quiz: 80 },
    courses: JSON.parse(JSON.stringify(DEFAULT_COURSES)),
    coursesNote: { ...DEFAULT_COURSES_NOTE },
    promo: JSON.parse(JSON.stringify(DEFAULT_PROMO)),
  };
}

/* ── 一个人的培训数据(服务端从库里读出来) ── */
export type AssessStatus = 'submitted' | 'approved' | 'returned' | 'booked' | 'passed' | 'failed';
export interface Assess {
  id: number; user: string; key: string; kind: string; status: AssessStatus;
  scores: { s: number; c: string }[] | null; score: number | null;
  comment: string; note: string; project: string;
  at: number; by: string; doneAt: number | null; doneBy: string;
}
export interface Placement { self: Record<string, string>; bizs: string[]; levels: Record<string, number>; comment: string; at: number; by: string }
export interface TrainData {
  user: string; role: string; mentor: string; noviceStart: number | null;
  tracks: { biz: string; openedAt: number; openedBy: string; source: string }[];
  placement: Placement | null;
  levels: Record<string, { level: number; source: string; at: number }>;
  marks: Record<string, { data: unknown; at: number }>;
  assess: Assess[];
  passes: Record<string, { at: number; via: string }>;
  reads: Record<string, number>;
}
export type KbIndex = Record<string, Record<string, { id: string; title: string }[]>>;
export type QuizInfo = Record<string, { n: number; passScore: number | null }>;

/* ── 评分表及格:平均 ≥ avg 且没有任何一项低于 min ── */
export function rubricResult(scores: number[], pass: { avg: number; min: number }) {
  const ok = scores.length > 0 && scores.every((s) => Number.isInteger(s) && s >= 1 && s <= 5);
  const avg = ok ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  return { valid: ok, avg: Math.round(avg * 100) / 100, passed: ok && avg >= pass.avg - 1e-9 && Math.min(...scores) >= pass.min };
}

/* ── 算一个人的关卡状态 ── */
export type StepState = 'todo' | 'done' | 'empty' | 'submitted' | 'returned' | 'booked' | 'passed' | 'failed' | 'noquiz';
export interface StepView {
  key: string; def: TStep; state: StepState; gate: boolean;
  docs?: { id: string; title: string; read: boolean }[];
  history: Assess[];
  quizN?: number; passScore?: number;
}
export type StageStatus = 'locked' | 'open' | 'passed' | 'exempt';
export interface StageView {
  key: string; track: string; sid: StageId; def: TStage; status: StageStatus;
  steps: StepView[]; gate: StepView[]; learnDone: boolean; gateDone: boolean;
  due: number | null; overdueDays: number; passedAt: number | null; exemptBy: string;
  unlocked: boolean;      // 前一关是否已过(免修的关也要前一关过了,后面的关才解锁)
}
export interface PersonView {
  user: string; mentor: string; noviceStart: number | null; novice: boolean;
  selected: string[]; tracks: string[];
  levels: Record<string, number>;
  stages: StageView[];
  noviceDone: boolean; assistCount: number; independentCount: number;
}

export const stageKeyOf = (track: string, sid: StageId) => (track === 'main' ? sid : `${track}.${sid}`);
export const stepKeyOf = (stageKey: string, stepId: string) => `${stageKey}.${stepId}`;
export const stagesFor = (cfg: TrainConfig, track: string): TStage[] => (track === 'main' ? cfg.main : cfg.biz[track] || defaultBizStages(track));
export const lvOf = (d: Pick<TrainData, 'levels'>, biz: string) => d.levels[biz]?.level ?? 0;
const DONE_STEP = new Set<StepState>(['done', 'empty']);

function stepView(cfg: TrainConfig, d: TrainData, st: TStep, stageKey: string, track: string, kb: KbIndex, quiz: QuizInfo, mapDocId: string | null): StepView {
  const key = stepKeyOf(stageKey, st.id);
  const history = d.assess.filter((a) => a.key === key).sort((a, b) => a.at - b.at || a.id - b.id);
  const last = history[history.length - 1];
  const gate = STEP_KINDS[st.kind]?.gate ?? false;
  const base = { key, def: st, gate, history };
  switch (st.kind) {
    case 'self':
      return { ...base, state: d.marks[key] ? 'done' : 'todo' };
    case 'doc': {
      const id = st.map ? mapDocId : st.docId;
      return { ...base, state: d.marks[key] ? 'done' : 'todo', docs: id ? [{ id, title: '', read: !!d.reads[id] }] : [] };
    }
    case 'docset': {
      const biz = st.biz === 'cur' ? track : st.biz || '';
      const docs = (kb[biz]?.[st.sec || ''] || []).map((x) => ({ ...x, read: !!d.reads[x.id] }));
      if (!docs.length) return { ...base, state: 'empty', docs };
      return { ...base, state: d.marks[key] && docs.every((x) => x.read) ? 'done' : 'todo', docs };
    }
    case 'task':
      return { ...base, state: last?.status === 'approved' ? 'done' : last?.status === 'submitted' ? 'submitted' : last?.status === 'returned' ? 'returned' : 'todo' };
    case 'quiz': {
      const info = quiz[key];
      const passScore = info?.passScore ?? st.passScore ?? cfg.pass.quiz;
      if (history.some((a) => a.status === 'passed')) return { ...base, state: 'passed', quizN: info?.n || 0, passScore };
      if (!info || !info.n) return { ...base, state: 'noquiz', quizN: 0, passScore };
      return { ...base, state: last ? 'failed' : 'todo', quizN: info.n, passScore };
    }
    case 'present':
    case 'sim':
      return { ...base, state: history.some((a) => a.status === 'passed') ? 'passed' : last?.status === 'booked' ? 'booked' : last?.status === 'failed' ? 'failed' : 'todo' };
    case 'placement':
      return { ...base, state: d.placement ? 'passed' : 'todo' };
    default:
      return { ...base, state: 'todo' };
  }
}

export function personView(cfg: TrainConfig, d: TrainData, kb: KbIndex, quiz: QuizInfo, mapDocId: string | null, now: number): PersonView {
  const novice = d.noviceStart != null;
  const tracks = TRAIN_BIZ_KEYS.filter((b) => d.tracks.some((t) => t.biz === b));   // 按 7 个业务的固定顺序
  const levels = Object.fromEntries(TRAIN_BIZ_KEYS.map((b) => [b, lvOf(d, b)])) as Record<string, number>;
  const stages: StageView[] = [];
  const ok = (key: string) => { const s = stages.find((x) => x.key === key); return !!s && (s.status === 'passed' || (s.status === 'exempt' && s.unlocked)); };
  const build = (track: string, def: TStage, unlocked: boolean) => {
    const key = stageKeyOf(track, def.id);
    const steps = def.steps.map((s) => stepView(cfg, d, s, key, track, kb, quiz, mapDocId));
    const gate = def.gate.map((s) => stepView(cfg, d, s, key, track, kb, quiz, mapDocId));
    const learnDone = steps.every((s) => DONE_STEP.has(s.state));
    const gateDone = gate.every((s) => s.state === 'passed');
    const pass = d.passes[key];
    const target = STAGE_TARGET[def.id];
    const exempt = !pass && target != null && track !== 'main' && (levels[track] || 0) >= target;
    const status: StageStatus = pass ? 'passed' : exempt ? 'exempt' : unlocked ? 'open' : 'locked';
    const due = novice && d.noviceStart != null ? d.noviceStart + def.dueDay * DAY : null;
    const overdueDays = status === 'open' && due != null && now > due ? Math.floor((now - due) / DAY) + 1 : 0;
    const src = d.levels[track]?.source || '';
    stages.push({ key, track, sid: def.id, def, status, steps, gate, learnDone, gateDone, due, overdueDays, passedAt: pass?.at ?? null,
      exemptBy: exempt ? (src === 'placement' ? 'placement' : 'level') : '', unlocked });
  };
  const [m0, m1] = [cfg.main.find((s) => s.id === 's0'), cfg.main.find((s) => s.id === 's1')];
  if (novice || d.passes.s0 || d.passes.s1) {
    if (m0) build('main', m0, novice);
    if (m1) build('main', m1, ok('s0'));
  }
  for (const biz of tracks) {
    const defs = stagesFor(cfg, biz);
    const pre1 = novice || d.passes.s1 ? ok('s1') || !m1 : true;   // 新人期内要关 1 通过;新人期之外加开的业务不卡关 1
    for (const def of defs) {
      const prev = def.id === 's2' ? pre1 : ok(stageKeyOf(biz, def.id === 's3' ? 's2' : 's3'));
      build(biz, def, prev);
    }
  }
  const selected = d.placement?.bizs.filter(isTrainBiz) || [];
  const assistCount = selected.filter((b) => (levels[b] || 0) >= ASSIST).length;
  const independentCount = selected.filter((b) => (levels[b] || 0) >= INDEPENDENT).length;
  const noviceDone = selected.length > 0 && assistCount === selected.length && independentCount >= 1;
  return { user: d.user, mentor: d.mentor, noviceStart: d.noviceStart, novice, selected, tracks, levels, stages, noviceDone, assistCount, independentCount };
}

/* 这一关学习步骤做完了、评估也都过了、还没记「过关」—— 服务端每次改完都调一次,记过关 + 自动升级 */
export function readyToPass(v: PersonView): StageView[] {
  return v.stages.filter((s) => s.status === 'open' && s.learnDone && s.gateDone);
}

/* 一个步骤此刻能不能提交(未解锁的关只能看;评估要学习步骤全做完) */
export function canAct(v: PersonView, stepKey: string): { ok: boolean; why: string; step?: StepView; stage?: StageView } {
  for (const s of v.stages) {
    const st = [...s.steps, ...s.gate].find((x) => x.key === stepKey);
    if (!st) continue;
    if (s.status === 'locked') return { ok: false, why: '这一关还没解锁 / This stage is still locked', step: st, stage: s };
    if (s.status === 'passed' || s.status === 'exempt') return { ok: false, why: '这一关已经过了 / This stage is already complete', step: st, stage: s };
    if (st.gate && !s.learnDone) return { ok: false, why: '先把这一关的学习步骤做完,才能约评估 / Finish the learning steps of this stage first', step: st, stage: s };
    return { ok: true, why: '', step: st, stage: s };
  }
  return { ok: false, why: '没有这一步 / No such step' };
}

/* ── 派项目限制 ── */
/* kind:skip 不查 / ok / below 没到「可协助」/ assistOnly 只到「可协助」(建议再配一位可独立的) —— 页面按它出中英文提示 */
export interface GateResult { checked: boolean; block: string; warns: string[]; kind: 'skip' | 'ok' | 'below' | 'assistOnly'; biz?: string }
const isFullRole = (role: string) => role === 'director' || role === 'bd';
export const projectBizs = (svcs: string[]) => [...new Set(svcs.map(bizOfSvc))].filter(isTrainBiz) as string[];

/* 指定负责 PM:项目里的业务至少一个 ≥「可协助」。on = 开关打开(拦);关着只提醒。 */
export function ownerGate(o: { name: string; role: string; svcs: string[]; levels: Record<string, number>; on: boolean; approach?: boolean }): GateResult {
  const bizs = projectBizs(o.svcs);
  if (o.approach || isFullRole(o.role) || !bizs.length) return { checked: false, block: '', warns: [], kind: 'skip' };
  const best = Math.max(0, ...bizs.map((b) => o.levels[b] || 0));
  if (best < ASSIST) {
    const msg = `${o.name}在这个项目的业务上还没到「可协助」,不能指定为负责 PM。可以加为「跟项目」成员。 / ${o.name} has not reached “Can assist” in any service on this project, so cannot be the lead PM. Add them as a shadow member instead.`;
    return o.on ? { checked: true, block: msg, warns: [], kind: 'below' } : { checked: true, block: '', warns: [msg], kind: 'below' };
  }
  if (best < INDEPENDENT) {
    return { checked: true, block: '', warns: [`${o.name}在这个项目的业务上只到「可协助」,建议再指定一位「可独立」的 PM 一起带。 / ${o.name} is only at “Can assist” on this project — consider adding an independent PM as well.`], kind: 'assistOnly' };
  }
  return { checked: true, block: '', warns: [], kind: 'ok' };
}

/* 服务包负责人是 PM 时:这个服务包的业务 ≥「可协助」 */
export function pkgOwnerGate(o: { name: string; role: string; svc: string; levels: Record<string, number>; on: boolean }): GateResult {
  if (o.role !== 'pm') return { checked: false, block: '', warns: [], kind: 'skip' };
  const biz = bizOfSvc(o.svc);
  if (!isTrainBiz(biz)) return { checked: false, block: '', warns: [], kind: 'skip' };
  const lv = o.levels[biz] || 0;
  if (lv >= ASSIST) return lv < INDEPENDENT
    ? { checked: true, block: '', warns: [`${o.name}在${bizLabel(biz, 'zh')}只到「可协助」,建议再指定一位「可独立」的 PM 一起带。 / ${o.name} is only at “Can assist” in ${bizLabel(biz, 'en')} — consider adding an independent PM as well.`], kind: 'assistOnly', biz }
    : { checked: true, block: '', warns: [], kind: 'ok', biz };
  const msg = `${o.name}在${bizLabel(biz, 'zh')}上还没到「可协助」,不能当这个服务包的负责人。 / ${o.name} has not reached “Can assist” in ${bizLabel(biz, 'en')}, so cannot own this service.`;
  return o.on ? { checked: true, block: msg, warns: [], kind: 'below', biz } : { checked: true, block: '', warns: [msg], kind: 'below', biz };
}

/* 项目里哪些业务没有任何一位负责 PM 到「可协助」(PD / BD 当负责人的算有) */
export function coverageGaps(svcs: string[], owners: { name: string; role: string; levels: Record<string, number> }[]): string[] {
  return projectBizs(svcs).filter((b) => !owners.some((o) => isFullRole(o.role) || (o.levels[b] || 0) >= ASSIST));
}

/* ── 晋级条件清单 ── */
export interface PromoItem { id: string; zh: string; en: string; met: boolean | null; auto: boolean }
export function promoChecklist(p: Promo, o: { levels: Record<string, number>; menteesDone: number; manual: Record<string, boolean> }): PromoItem[] {
  const items: PromoItem[] = [];
  p.matrix.forEach((r, i) => {
    const names = r.bizs.map((b) => bizLabel(b, 'zh')).join(' / '), namesEn = r.bizs.map((b) => bizLabel(b, 'en')).join(' / ');
    const got = r.bizs.filter((b) => (o.levels[b] || 0) >= r.level).length;
    const all = r.need >= r.bizs.length;
    items.push({ id: `m${i}`, auto: true, met: got >= r.need,
      zh: all || r.bizs.length === 1 ? `${names}「${lvName(r.level, 'zh')}」` : `${names} 中至少 ${r.need} 个「${lvName(r.level, 'zh')}」`,
      en: all || r.bizs.length === 1 ? `${namesEn} at “${lvName(r.level, 'en')}”` : `At least ${r.need} of ${namesEn} at “${lvName(r.level, 'en')}”` });
  });
  if (p.mentees > 0) items.push({ id: 'mentees', auto: true, met: o.menteesDone >= p.mentees, zh: `带教 ${p.mentees} 名新人走完新人期`, en: `Mentored ${p.mentees} new joiner(s) through the induction` });
  for (const m of p.manual) items.push({ id: `x.${m.id}`, auto: false, met: !!o.manual[m.id], zh: m.zh, en: m.en });
  if (p.kpi) items.push({ id: 'kpi', auto: true, met: null, zh: `连续 ${p.kpi.quarters} 个季度项目分值 ≥ ${p.kpi.min}(待 KPI 接入)`, en: `Project score ≥ ${p.kpi.min} for ${p.kpi.quarters} quarters in a row (waiting for KPI)` });
  return items;
}
export const promoFor = (cfg: TrainConfig, pmLevel: string) => cfg.promo.find((p) => p.from === (pmLevel || 'coord')) || null;
