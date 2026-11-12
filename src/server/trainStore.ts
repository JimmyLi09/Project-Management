/* ===== REQ-062 · 新人培训新加的存储 =====
   只加列、加表,REQ-036 的 training_paths / training_progress / training_attempts 一点不动。
   - users 加 3 列:pm_level(PM 级别)、mentor(带教人姓名)、novice_start(新人期开始时间,空 = 不在新人期)
   - tr_config   路径的关卡结构、评分表、及格线、6 个月课程、晋级条件(一个部分一行,JSON)
   - tr_quiz     测验题库(按步骤 key,一份一行;答案只在维护接口里出现)
   - tr_tracks   这个人开了哪几个业务路径(定级时选的 2 – 3 个 + 之后「开下一级路径」)
   - tr_placement 入职定级(自评 + 带教人定的业务和起步级别)
   - tr_marks    学员自己勾的步骤(自评问卷、读文档、板块阅读)
   - tr_assess   每一次评估 / 提交:实操签核、测验成绩、讲解 / 模拟演练的评分(每次一行,留全部记录)
   - tr_passes   过关记录(过了就不再受后来新增文档等影响)
   - skill_levels / skill_log  能力矩阵(人 × 业务)及每次变化的日志
   - tr_attend   6 个月课程点名;tr_promo 晋级条件里 PD / BD 手动勾的项
   - kb_reads    谁打开过知识库的哪篇文档(板块阅读要「都打开过才能勾」)
   函数都带 d,单元测试用内存库直接调。 */
import type Database from 'better-sqlite3';
import {
  DEFAULT_COURSES_NOTE, LEVELS, PM_LEVELS, RUBRIC_KEYS, STAGE_TARGET, TRAIN_BIZ_KEYS, defaultBizStages, defaultConfig, isTrainBiz,
  personView, pmLevelFromPosition, readyToPass,
  type Assess, type Course, type KbIndex, type PersonView, type Placement, type Promo, type QuizInfo, type StageId, type StepKind,
  type TStage, type TStep, type TrainConfig, type TrainData,
} from '@/lib/train';
import type { QuizQuestion } from '@/lib/training';

type Db = Database.Database;
const j = <T,>(s: string | null | undefined, d: T): T => { try { return s ? (JSON.parse(s) as T) : d; } catch { return d; } };

export const GATE_KEY = 'assignGate062';
export const PREFILL_KEY = 'req062.pmLevelPrefill';
export const SEED_KEY = 'req062.seeded';

export function ensure062(d: Db) {
  const cols = (d.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('pm_level')) d.exec("ALTER TABLE users ADD COLUMN pm_level TEXT NOT NULL DEFAULT ''");
  if (!cols.includes('mentor')) d.exec("ALTER TABLE users ADD COLUMN mentor TEXT NOT NULL DEFAULT ''");
  if (!cols.includes('novice_start')) d.exec('ALTER TABLE users ADD COLUMN novice_start INTEGER');
  d.exec(`
    CREATE TABLE IF NOT EXISTS tr_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS tr_quiz (key TEXT PRIMARY KEY, questions TEXT NOT NULL DEFAULT '[]', pass_score INTEGER, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS tr_tracks (user TEXT NOT NULL, biz TEXT NOT NULL, opened_at INTEGER NOT NULL, opened_by TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', PRIMARY KEY (user, biz));
    CREATE TABLE IF NOT EXISTS tr_placement (user TEXT PRIMARY KEY, self TEXT NOT NULL DEFAULT '{}', bizs TEXT NOT NULL DEFAULT '[]', levels TEXT NOT NULL DEFAULT '{}', comment TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, by TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS tr_marks (user TEXT NOT NULL, key TEXT NOT NULL, data TEXT NOT NULL DEFAULT 'null', at INTEGER NOT NULL, PRIMARY KEY (user, key));
    CREATE TABLE IF NOT EXISTS tr_assess (id INTEGER PRIMARY KEY AUTOINCREMENT, user TEXT NOT NULL, key TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
      scores TEXT, score INTEGER, comment TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', project TEXT NOT NULL DEFAULT '',
      at INTEGER NOT NULL, by TEXT NOT NULL DEFAULT '', done_at INTEGER, done_by TEXT NOT NULL DEFAULT '');
    CREATE INDEX IF NOT EXISTS tr_assess_user ON tr_assess(user, key);
    CREATE TABLE IF NOT EXISTS tr_passes (user TEXT NOT NULL, key TEXT NOT NULL, at INTEGER NOT NULL, via TEXT NOT NULL DEFAULT 'pass', PRIMARY KEY (user, key));
    CREATE TABLE IF NOT EXISTS skill_levels (user TEXT NOT NULL, biz TEXT NOT NULL, level INTEGER NOT NULL, source TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL DEFAULT '', PRIMARY KEY (user, biz));
    CREATE TABLE IF NOT EXISTS skill_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user TEXT NOT NULL, biz TEXT NOT NULL, from_level INTEGER NOT NULL, to_level INTEGER NOT NULL,
      source TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', ref TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, by TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS tr_attend (course TEXT NOT NULL, lesson TEXT NOT NULL, user TEXT NOT NULL, status TEXT NOT NULL, at INTEGER NOT NULL, by TEXT NOT NULL DEFAULT '', PRIMARY KEY (course, lesson, user));
    CREATE TABLE IF NOT EXISTS tr_promo (user TEXT NOT NULL, item TEXT NOT NULL, done INTEGER NOT NULL, at INTEGER NOT NULL, by TEXT NOT NULL DEFAULT '', PRIMARY KEY (user, item));
    CREATE TABLE IF NOT EXISTS kb_reads (user TEXT NOT NULL, doc_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user, doc_id));
  `);
}

/* ── 配置:一部分一行。首次启动写预置,已有的不重复建 ── */
const CONFIG_PARTS = ['main', 'biz', 'rubrics', 'pass', 'courses', 'coursesNote', 'promo'] as const;
export type ConfigPart = typeof CONFIG_PARTS[number];
export const isConfigPart = (x: unknown): x is ConfigPart => (CONFIG_PARTS as readonly string[]).includes(x as string);

export function seed062(d: Db, now: number, by = '系统 System'): string[] {
  const def = defaultConfig();
  const added: string[] = [];
  const ins = d.prepare('INSERT OR IGNORE INTO tr_config (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)');
  for (const k of CONFIG_PARTS) if (ins.run(k, JSON.stringify(def[k]), now, by).changes) added.push(k);
  return added;
}

export function getConfig(d: Db): TrainConfig {
  const def = defaultConfig();
  const rows = d.prepare('SELECT key, value FROM tr_config').all() as { key: string; value: string }[];
  const cfg = { ...def } as TrainConfig;
  for (const r of rows) if (isConfigPart(r.key)) (cfg as unknown as Record<string, unknown>)[r.key] = j(r.value, def[r.key]);
  for (const b of TRAIN_BIZ_KEYS) if (!cfg.biz[b]) cfg.biz[b] = defaultBizStages(b);
  return cfg;
}

/* 保存前的清洗:只留认识的字段、截长度;步骤 id 不能重复 */
const str = (x: unknown, n = 300) => String(x ?? '').trim().slice(0, n);
const STEP_KIND_SET = new Set<StepKind>(['self', 'doc', 'docset', 'task', 'quiz', 'present', 'sim', 'placement']);
function cleanStep(x: unknown, gate: boolean): TStep {
  const s = (x || {}) as Partial<TStep>;
  const kind = STEP_KIND_SET.has(s.kind as StepKind) ? (s.kind as StepKind) : gate ? 'present' : 'doc';
  const out: TStep = { id: str(s.id, 30) || Math.random().toString(36).slice(2, 8), kind, zh: str(s.zh), en: str(s.en) };
  if (kind === 'doc') { if (s.map) out.map = true; else out.docId = str(s.docId, 40); }
  if (kind === 'docset') { out.biz = str(s.biz, 20) || 'cur'; out.sec = str(s.sec, 2); }
  if (kind === 'present' || kind === 'sim') out.rubric = (RUBRIC_KEYS as string[]).includes(String(s.rubric)) ? s.rubric : kind === 'present' ? 'present' : 'simBrief';
  if (kind === 'task' && (s.project === 'shadow' || s.project === 'assist' || s.project === 'owner')) out.project = s.project;
  if (kind === 'quiz' && s.passScore != null && Number.isFinite(Number(s.passScore))) out.passScore = Math.max(0, Math.min(100, Math.round(Number(s.passScore))));
  return out;
}
function cleanStages(x: unknown, ids: StageId[]): TStage[] {
  const arr = Array.isArray(x) ? x : [];
  return ids.map((id) => {
    const s = (arr.find((y) => (y as TStage)?.id === id) || {}) as Partial<TStage>;
    const steps = (Array.isArray(s.steps) ? s.steps : []).slice(0, 30).map((y) => cleanStep(y, false));
    const gate = (Array.isArray(s.gate) ? s.gate : []).slice(0, 10).map((y) => cleanStep(y, true));
    const seen = new Set<string>();
    for (const st of [...steps, ...gate]) { if (seen.has(st.id)) throw new Error(`步骤 id「${st.id}」重复 / Duplicate step id “${st.id}”`); seen.add(st.id); }
    const due = Number(s.dueDay);
    return { id, zh: str(s.zh, 60) || id, en: str(s.en, 60), dueDay: Number.isFinite(due) ? Math.max(1, Math.min(400, Math.round(due))) : 30,
      upZh: str(s.upZh, 120), upEn: str(s.upEn, 120), steps, gate };
  });
}
export function cleanPart(part: ConfigPart, v: unknown): unknown {
  switch (part) {
    case 'main': return cleanStages(v, ['s0', 's1']);
    case 'biz': {
      const o = (v || {}) as Record<string, unknown>;
      return Object.fromEntries(TRAIN_BIZ_KEYS.map((b) => [b, cleanStages(o[b] ?? defaultBizStages(b), ['s2', 's3', 's4'])]));
    }
    case 'rubrics': {
      const o = (v || {}) as Record<string, { zh?: unknown; en?: unknown; items?: unknown }>;
      return Object.fromEntries(RUBRIC_KEYS.map((k) => {
        const r = o[k] || {};
        const items = (Array.isArray(r.items) ? r.items : []).slice(0, 4).map((it) => ({ zh: str((it as { zh?: unknown })?.zh), en: str((it as { en?: unknown })?.en) }));
        if (items.length !== 4) throw new Error('每张评分表要 4 项 / Each rubric needs 4 items');
        return [k, { zh: str(r.zh, 60), en: str(r.en, 60), items }];
      }));
    }
    case 'pass': {
      const o = (v || {}) as { avg?: unknown; min?: unknown; quiz?: unknown };
      const avg = Number(o.avg), min = Number(o.min), quiz = Number(o.quiz);
      if (!(avg >= 1 && avg <= 5) || !(min >= 1 && min <= 5) || !(quiz >= 0 && quiz <= 100)) throw new Error('及格线不对 / Invalid pass marks');
      return { avg: Math.round(avg * 10) / 10, min: Math.round(min), quiz: Math.round(quiz) };
    }
    case 'courses': {
      const arr = Array.isArray(v) ? v : [];
      return arr.slice(0, 30).map((c0) => {
        const c = (c0 || {}) as Partial<Course>;
        const exam = c.exam === 'rubric' || c.exam === 'auto' || c.exam === 'none' ? c.exam : 'pass';
        return {
          id: str(c.id, 20) || Math.random().toString(36).slice(2, 8), code: str(c.code, 10), zh: str(c.zh, 80), en: str(c.en, 80), exam,
          ...(exam === 'auto' ? { autoBiz: isTrainBiz(c.autoBiz) ? c.autoBiz : 'model' } : {}),
          lessons: (Array.isArray(c.lessons) ? c.lessons : []).slice(0, 30).map((l, i) => ({ id: str((l as { id?: unknown })?.id, 20) || `L${i + 1}`, zh: str((l as { zh?: unknown })?.zh, 80), en: str((l as { en?: unknown })?.en, 80) })),
          participants: [...new Set((Array.isArray(c.participants) ? c.participants : []).map((n) => str(n, 60)).filter(Boolean))].slice(0, 100),
        } as Course;
      });
    }
    case 'coursesNote': { const o = (v || {}) as { zh?: unknown; en?: unknown }; return { zh: str(o.zh, 300) || DEFAULT_COURSES_NOTE.zh, en: str(o.en, 300) }; }
    case 'promo': {
      const arr = Array.isArray(v) ? v : [];
      const ok = new Set(PM_LEVELS.map((l) => l.v));
      return arr.slice(0, 6).map((p0) => {
        const p = (p0 || {}) as Partial<Promo>;
        if (!ok.has(p.from as never) || !ok.has(p.to as never)) throw new Error('晋级条件的级别不对 / Invalid PM levels in promotion rules');
        return {
          id: str(p.id, 30) || `${p.from}-${p.to}`, from: p.from, to: p.to,
          matrix: (Array.isArray(p.matrix) ? p.matrix : []).slice(0, 10).map((r) => {
            const bizs = (Array.isArray(r?.bizs) ? r.bizs : []).filter(isTrainBiz);
            const level = Math.max(1, Math.min(4, Math.round(Number(r?.level) || 3)));
            return { bizs, level, need: Math.max(1, Math.min(bizs.length || 1, Math.round(Number(r?.need) || 1))) };
          }).filter((r) => r.bizs.length),
          mentees: Math.max(0, Math.min(10, Math.round(Number(p.mentees) || 0))),
          kpi: p.kpi && Number.isFinite(Number(p.kpi.min)) ? { min: Math.max(0, Math.min(1000, Number(p.kpi.min))), quarters: Math.max(1, Math.min(8, Math.round(Number(p.kpi.quarters) || 2))) } : null,
          manual: (Array.isArray(p.manual) ? p.manual : []).slice(0, 10).map((m, i) => ({ id: str(m?.id, 20) || `m${i}`, zh: str(m?.zh, 120), en: str(m?.en, 120) })).filter((m) => m.zh || m.en),
        } as Promo;
      });
    }
  }
}
export function setConfigPart(d: Db, part: ConfigPart, value: unknown, by: string, now: number) {
  const clean = cleanPart(part, value);
  d.prepare('INSERT INTO tr_config (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
    .run(part, JSON.stringify(clean), now, by);
  return clean;
}

/* ── PM 级别:上线时按「职位」文字预填一次(只给 PM 角色,只填空的) ── */
export function prefillPmLevels(d: Db, now: number): { name: string; position: string; level: string }[] | null {
  if (d.prepare('SELECT 1 FROM meta WHERE key = ?').get(PREFILL_KEY)) return null;
  const rows = d.prepare("SELECT name, position, pm_level FROM users WHERE role = 'pm'").all() as { name: string; position: string; pm_level: string }[];
  const out: { name: string; position: string; level: string }[] = [];
  d.transaction(() => {
    for (const r of rows) {
      if (r.pm_level) continue;
      const lv = pmLevelFromPosition(r.position);
      out.push({ name: r.name, position: r.position, level: lv });
      if (lv) d.prepare('UPDATE users SET pm_level = ? WHERE name = ? AND pm_level = \'\'').run(lv, r.name);
    }
    d.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(PREFILL_KEY, JSON.stringify({ at: now, filled: out.filter((x) => x.level).length, blank: out.filter((x) => !x.level).length }));
  })();
  return out;
}

/* ── 人 ── */
export interface TUser { name: string; role: string; position: string; pmLevel: string; mentor: string; noviceStart: number | null; disabled: boolean; deleted: boolean }
export function trainUsers(d: Db): TUser[] {
  return (d.prepare('SELECT name, role, position, pm_level, mentor, novice_start, disabled, deleted_at FROM users ORDER BY id').all() as
    { name: string; role: string; position: string; pm_level: string; mentor: string; novice_start: number | null; disabled: number; deleted_at: number }[])
    .map((r) => ({ name: r.name, role: r.role, position: r.position || '', pmLevel: r.pm_level || '', mentor: r.mentor || '', noviceStart: r.novice_start ?? null, disabled: !!r.disabled, deleted: !!r.deleted_at }));
}
export const trainUser = (d: Db, name: string) => trainUsers(d).find((u) => u.name === name);
export const setPmLevel = (d: Db, name: string, lv: string) => d.prepare('UPDATE users SET pm_level = ? WHERE name = ?').run(lv, name);
export const setMentor = (d: Db, name: string, mentor: string) => d.prepare('UPDATE users SET mentor = ? WHERE name = ?').run(mentor, name);
export const setNoviceStart = (d: Db, name: string, at: number | null) => d.prepare('UPDATE users SET novice_start = ? WHERE name = ?').run(at, name);

/* ── 一个人的全部培训数据 ── */
export const rowToAssess = (r: Record<string, unknown>): Assess => ({
  id: r.id as number, user: r.user as string, key: r.key as string, kind: r.kind as string, status: r.status as Assess['status'],
  scores: j(r.scores as string, null), score: (r.score as number | null) ?? null, comment: (r.comment as string) || '', note: (r.note as string) || '',
  project: (r.project as string) || '', at: r.at as number, by: (r.by as string) || '', doneAt: (r.done_at as number | null) ?? null, doneBy: (r.done_by as string) || '',
});
export function loadData(d: Db, name: string): TrainData {
  const u = trainUser(d, name);
  const pl = d.prepare('SELECT * FROM tr_placement WHERE user = ?').get(name) as { self: string; bizs: string; levels: string; comment: string; at: number; by: string } | undefined;
  return {
    user: name, role: u?.role || '', mentor: u?.mentor || '', noviceStart: u?.noviceStart ?? null,
    tracks: (d.prepare('SELECT biz, opened_at, opened_by, source FROM tr_tracks WHERE user = ? ORDER BY opened_at, biz').all(name) as { biz: string; opened_at: number; opened_by: string; source: string }[])
      .map((t) => ({ biz: t.biz, openedAt: t.opened_at, openedBy: t.opened_by, source: t.source })),
    placement: pl ? { self: j(pl.self, {}), bizs: j(pl.bizs, []), levels: j(pl.levels, {}), comment: pl.comment, at: pl.at, by: pl.by } : null,
    levels: Object.fromEntries((d.prepare('SELECT biz, level, source, updated_at FROM skill_levels WHERE user = ?').all(name) as { biz: string; level: number; source: string; updated_at: number }[])
      .map((r) => [r.biz, { level: r.level, source: r.source, at: r.updated_at }])),
    marks: Object.fromEntries((d.prepare('SELECT key, data, at FROM tr_marks WHERE user = ?').all(name) as { key: string; data: string; at: number }[]).map((r) => [r.key, { data: j(r.data, null), at: r.at }])),
    assess: (d.prepare('SELECT * FROM tr_assess WHERE user = ? ORDER BY at, id').all(name) as Record<string, unknown>[]).map(rowToAssess),
    passes: Object.fromEntries((d.prepare('SELECT key, at, via FROM tr_passes WHERE user = ?').all(name) as { key: string; at: number; via: string }[]).map((r) => [r.key, { at: r.at, via: r.via }])),
    reads: Object.fromEntries((d.prepare('SELECT doc_id, at FROM kb_reads WHERE user = ?').all(name) as { doc_id: string; at: number }[]).map((r) => [r.doc_id, r.at])),
  };
}
export const levelsOf = (d: Db, name: string): Record<string, number> =>
  Object.fromEntries((d.prepare('SELECT biz, level FROM skill_levels WHERE user = ?').all(name) as { biz: string; level: number }[]).map((r) => [r.biz, r.level]));
export const allLevels = (d: Db) => d.prepare('SELECT user, biz, level, source, updated_at, updated_by FROM skill_levels').all() as { user: string; biz: string; level: number; source: string; updated_at: number; updated_by: string }[];
export const skillLog = (d: Db, user?: string) => (user
  ? d.prepare('SELECT * FROM skill_log WHERE user = ? ORDER BY at DESC, id DESC').all(user)
  : d.prepare('SELECT * FROM skill_log ORDER BY at DESC, id DESC LIMIT 2000').all()) as { id: number; user: string; biz: string; from_level: number; to_level: number; source: string; reason: string; ref: string; at: number; by: string }[];

/* ── 写 ── */
export function setMark(d: Db, user: string, key: string, on: boolean, data: unknown, now: number) {
  if (on) d.prepare('INSERT INTO tr_marks (user, key, data, at) VALUES (?, ?, ?, ?) ON CONFLICT(user, key) DO UPDATE SET data = excluded.data, at = excluded.at').run(user, key, JSON.stringify(data ?? null), now);
  else d.prepare('DELETE FROM tr_marks WHERE user = ? AND key = ?').run(user, key);
}
export function addAssess(d: Db, a: { user: string; key: string; kind: string; status: string; scores?: unknown; score?: number | null; comment?: string; note?: string; project?: string; by: string; at: number; doneAt?: number | null; doneBy?: string }): number {
  return Number(d.prepare(`INSERT INTO tr_assess (user, key, kind, status, scores, score, comment, note, project, at, by, done_at, done_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(a.user, a.key, a.kind, a.status, a.scores == null ? null : JSON.stringify(a.scores), a.score ?? null, (a.comment || '').slice(0, 2000), (a.note || '').slice(0, 4000), a.project || '', a.at, a.by, a.doneAt ?? null, a.doneBy || '').lastInsertRowid);
}
export const getAssess = (d: Db, id: number) => { const r = d.prepare('SELECT * FROM tr_assess WHERE id = ?').get(id) as Record<string, unknown> | undefined; return r ? rowToAssess(r) : undefined; };
export function finishAssess(d: Db, id: number, o: { status: string; scores?: unknown; comment?: string; by: string; at: number }) {
  d.prepare('UPDATE tr_assess SET status = ?, scores = COALESCE(?, scores), comment = ?, done_at = ?, done_by = ? WHERE id = ?')
    .run(o.status, o.scores == null ? null : JSON.stringify(o.scores), (o.comment || '').slice(0, 2000), o.at, o.by, id);
}
export function addTrack(d: Db, user: string, biz: string, by: string, source: string, now: number) {
  d.prepare('INSERT OR IGNORE INTO tr_tracks (user, biz, opened_at, opened_by, source) VALUES (?, ?, ?, ?, ?)').run(user, biz, now, by, source);
}
export function savePlacement(d: Db, user: string, p: Omit<Placement, 'at' | 'by'>, by: string, now: number) {
  d.prepare(`INSERT INTO tr_placement (user, self, bizs, levels, comment, at, by) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user) DO UPDATE SET self = excluded.self, bizs = excluded.bizs, levels = excluded.levels, comment = excluded.comment, at = excluded.at, by = excluded.by`)
    .run(user, JSON.stringify(p.self), JSON.stringify(p.bizs), JSON.stringify(p.levels), p.comment.slice(0, 2000), now, by);
}
/* 改级别并记日志。raiseOnly = 自动升级 / 定级:不把已有的更高级别降下来 */
export function setLevel(d: Db, o: { user: string; biz: string; level: number; source: string; reason?: string; ref?: string; by: string; at: number; raiseOnly?: boolean }): boolean {
  const lv = Math.max(0, Math.min(LEVELS.length - 1, Math.round(o.level)));
  const cur = (d.prepare('SELECT level FROM skill_levels WHERE user = ? AND biz = ?').get(o.user, o.biz) as { level: number } | undefined)?.level ?? 0;
  if (lv === cur || (o.raiseOnly && lv < cur)) return false;
  d.prepare(`INSERT INTO skill_levels (user, biz, level, source, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user, biz) DO UPDATE SET level = excluded.level, source = excluded.source, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .run(o.user, o.biz, lv, o.source, o.at, o.by);
  d.prepare('INSERT INTO skill_log (user, biz, from_level, to_level, source, reason, ref, at, by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(o.user, o.biz, cur, lv, o.source, (o.reason || '').slice(0, 500), o.ref || '', o.at, o.by);
  return true;
}
export const markRead = (d: Db, user: string, docId: string, now: number) =>
  d.prepare('INSERT INTO kb_reads (user, doc_id, at) VALUES (?, ?, ?) ON CONFLICT(user, doc_id) DO NOTHING').run(user, docId, now);
export const setAttend = (d: Db, course: string, lesson: string, user: string, status: string, by: string, now: number) =>
  d.prepare('INSERT INTO tr_attend (course, lesson, user, status, at, by) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(course, lesson, user) DO UPDATE SET status = excluded.status, at = excluded.at, by = excluded.by').run(course, lesson, user, status, now, by);
export const listAttend = (d: Db) => d.prepare('SELECT course, lesson, user, status, at, by FROM tr_attend').all() as { course: string; lesson: string; user: string; status: string; at: number; by: string }[];
export const setPromoCheck = (d: Db, user: string, item: string, done: boolean, by: string, now: number) =>
  d.prepare('INSERT INTO tr_promo (user, item, done, at, by) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user, item) DO UPDATE SET done = excluded.done, at = excluded.at, by = excluded.by').run(user, item, done ? 1 : 0, now, by);
export const promoChecks = (d: Db, user: string): Record<string, boolean> =>
  Object.fromEntries((d.prepare('SELECT item, done FROM tr_promo WHERE user = ?').all(user) as { item: string; done: number }[]).map((r) => [r.item, !!r.done]));

/* ── 测验题库 ── */
export function quizInfo(d: Db): QuizInfo {
  return Object.fromEntries((d.prepare('SELECT key, questions, pass_score FROM tr_quiz').all() as { key: string; questions: string; pass_score: number | null }[])
    .map((r) => [r.key, { n: j<unknown[]>(r.questions, []).length, passScore: r.pass_score }]));
}
export function getQuiz(d: Db, key: string): { questions: QuizQuestion[]; passScore: number | null; updatedAt: number | null; updatedBy: string } {
  const r = d.prepare('SELECT questions, pass_score, updated_at, updated_by FROM tr_quiz WHERE key = ?').get(key) as { questions: string; pass_score: number | null; updated_at: number; updated_by: string } | undefined;
  return { questions: j(r?.questions, []), passScore: r?.pass_score ?? null, updatedAt: r?.updated_at ?? null, updatedBy: r?.updated_by || '' };
}
export function saveQuiz(d: Db, key: string, questions: QuizQuestion[], passScore: number | null, by: string, now: number) {
  d.prepare(`INSERT INTO tr_quiz (key, questions, pass_score, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET questions = excluded.questions, pass_score = excluded.pass_score, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .run(key, JSON.stringify(questions), passScore, now, by);
}

/* ── 知识库「业务 × 板块」的文档清单(板块阅读用) ── */
export function kbIndex(d: Db): KbIndex {
  const has = (d.prepare('PRAGMA table_info(kb_docs)').all() as { name: string }[]).some((c) => c.name === 'biz');
  if (!has) return {};
  const out: KbIndex = {};
  for (const r of d.prepare('SELECT id, title, biz, sec FROM kb_docs WHERE biz IS NOT NULL AND sec IS NOT NULL ORDER BY updated_at DESC').all() as { id: string; title: string; biz: string; sec: string }[]) {
    ((out[r.biz] ||= {})[r.sec] ||= []).push({ id: r.id, title: r.title });
  }
  return out;
}
export const mapDocId062 = (d: Db) => ((d.prepare("SELECT value FROM meta WHERE key = 'kb.mapDoc'").get() as { value: string } | undefined)?.value) || null;

/* ── 算 + 自动记过关 / 升级 ──
   每次有人改了某个学员的东西,调一次:学习步骤和评估都齐了的关记「过关」,对应业务自动升级(不降)。 */
export function viewOf(d: Db, user: string, now: number, cfg = getConfig(d)): PersonView {
  return personView(cfg, loadData(d, user), kbIndex(d), quizInfo(d), mapDocId062(d), now);
}
export function reconcile(d: Db, user: string, by: string, now: number): { passed: string[]; raised: string[] } {
  const cfg = getConfig(d);
  const passed: string[] = [], raised: string[] = [];
  for (let i = 0; i < 6; i++) {
    const v = viewOf(d, user, now, cfg);
    const ready = readyToPass(v);
    if (!ready.length) break;
    d.transaction(() => {
      for (const s of ready) {
        d.prepare('INSERT OR IGNORE INTO tr_passes (user, key, at, via) VALUES (?, ?, ?, ?)').run(user, s.key, now, 'pass');
        passed.push(s.key);
        const target = STAGE_TARGET[s.sid];
        if (target != null && s.track !== 'main' && setLevel(d, { user, biz: s.track, level: target, source: 'auto', ref: s.key, by, at: now, raiseOnly: true })) raised.push(s.track);
      }
    })();
  }
  return { passed, raised };
}
export const gateOn = (d: Db) => ((d.prepare('SELECT value FROM app_settings WHERE key = ?').get(GATE_KEY) as { value: string } | undefined)?.value) === '1';
