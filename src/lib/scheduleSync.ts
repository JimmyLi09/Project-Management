/* ===== REQ-048 · 日历排期 ⇄ 阶段行 =====
   去掉「经典模式」以后,排期只在日历上排(pkg.calendar:阶段 + 分界点)。但我的待办、KPI、团队负载、
   积分、报表、导出、复制项目……读的都是阶段行 pkg.schedule —— 这些读取方一个不改,改的是:
   **日历一保存,就把每个阶段写回成一行**(阶段名、开始、结束、备注;负责人、状态在行上,原样保留)。

   一个阶段对应哪一行:阶段 id = 行 id。
   · 新建业务:先按模板建行,再用这些行生成日历(buildPackage),天生一一对应;
   · 老项目:上线时用阶段行生成日历(migrateSchedules,一次性),也是一一对应;
   · 在日历上新加的阶段:写回时新建一行,id 就是阶段 id。
   日历上删掉的阶段:那一行如果有内容(负责人、状态、备注……),挪到 pkg.scheduleLegacy 留底,没内容的直接去掉。
   「特殊行」(里程碑 / 假日横幅,kind)不是阶段,原样留在行里,页面上只读显示。 */

import {
  addDays, compareDates, deriveSchedules, STAGE_TONES, type LocalDate,
} from '@/features/schedule-planner/domain/schedule';
import { calculateDuration } from '@/features/schedule-planner/domain/duration';
import type { CalendarSchedule, CalendarStage, ScheduleRow, ServicePackage } from './types';

/* 阶段行 = 日历上的一个阶段。特殊行(里程碑 / 假日横幅)和临时插入的节点(custom,一天的样片 / 加单)不算阶段,
   原样留在行里(待办、导出照旧读得到),页面上只读显示 */
export const isStageRow = (r: ScheduleRow) => !r.kind && !r.custom;

/* 行上有没有「人填进去的东西」—— 没有的话删掉也不丢信息 */
export const rowHasInfo = (r: ScheduleRow) =>
  !!(r.assignee || (r.status && r.status !== 'todo') || r.note || r.delayNote);

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` as LocalDate;
const round1 = (n: number) => Math.round(n * 10) / 10;

let seq = 0;
const freshId = () => `r${Date.now().toString(36)}${(seq++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/* ---------- 阶段行 → 日历 ---------- */

export interface FromRowsResult {
  calendar: CalendarSchedule;
  /* 有日期、但日历表达不了原样的行数(原来有重叠 / 空档):日历上的日期和行上的差了几天 */
  adjusted: number;
  /* 原来没有日期的阶段(0 周、又没填日期),日历上各给了 1 天 */
  undated: number;
  dated: boolean;
}

/* dates[i] = 第 i 行(含特殊行)的计划起止(planDates 算的,调用方传进来,避免互相 import) */
export function calendarFromRows(
  rows: ScheduleRow[],
  dates: ({ start: Date; end: Date } | null)[],
  opts: { by: string; at: number; excludeHolidays?: boolean },
): FromRowsResult {
  const pairs = rows.map((r, i) => ({ r, d: dates[i] ?? null })).filter((x) => isStageRow(x.r));
  pairs.forEach((x) => { if (!x.r.id) x.r.id = freshId(); });
  const stages: CalendarStage[] = pairs.map(({ r }, i) => ({
    id: r.id!,
    name: (r.task || r.phase || `阶段 ${i + 1}`).trim().slice(0, 60) || `阶段 ${i + 1}`,
    ...(r.taskEn ? { nameEn: r.taskEn.trim().slice(0, 120) } : {}),
    tone: STAGE_TONES[i % STAGE_TONES.length],
    note: r.note || '',
    weeks: Number.isFinite(r.weeks) && r.weeks >= 0 ? r.weeks : 1,
  }));
  const first = pairs.findIndex((x) => x.d);
  const boundaries: LocalDate[] = [];
  let adjusted = 0;
  const undated = first >= 0 ? pairs.filter((x) => !x.d).length : 0;
  if (first >= 0 && pairs.length) {
    /* 第一个有日期的阶段之前那几个(多是 0 周的「信息收集」)各占它前面的 1 天 */
    const s0 = iso(pairs[first].d!.start);
    boundaries.push(addDays(s0, -Math.max(0, first)));
    for (let i = 0; i < pairs.length; i += 1) {
      const prev = boundaries[i];
      const min = i === 0 ? prev : addDays(prev, 1);          // 每个阶段至少 1 天
      const want = pairs[i].d ? iso(pairs[i].d!.end) : min;
      const end = compareDates(want, min) < 0 ? min : want;
      boundaries.push(end);
      const start = i === 0 ? prev : addDays(prev, 1);
      const d = pairs[i].d;
      if (d && (iso(d.start) !== start || iso(d.end) !== end)) adjusted += 1;
    }
  }
  return {
    calendar: {
      stages, boundaries, version: 0, updatedAt: opts.at, updatedBy: opts.by,
      excludeHolidays: opts.excludeHolidays ?? false,
    },
    adjusted,
    undated,
    dated: boundaries.length > 0,
  };
}

/* ---------- 日历 → 阶段行(保存日历时) ---------- */

export interface ToRowsResult { rows: ScheduleRow[]; moved: ScheduleRow[] }

/* 周数(行上的 weeks:导出的「周」列、合计用)按日历的单位折:勾了 Exclude Holidays 是 5 个工作日一周,否则 7 天 */
export function rowsFromCalendar(rows: ScheduleRow[], cal: Pick<CalendarSchedule, 'stages' | 'boundaries' | 'excludeHolidays'>): ToRowsResult {
  const ex = cal.excludeHolidays !== false;
  const byId = new Map(rows.filter((r) => r.id && isStageRow(r)).map((r) => [r.id!, r] as const));
  const used = new Set<string>();
  const sched = deriveSchedules(cal.boundaries as LocalDate[], cal.stages.map((s) => ({ ...s })));
  const out: ScheduleRow[] = cal.stages.map((st, i) => {
    const old = byId.get(st.id);
    if (old) used.add(st.id);
    const s = sched[i];
    const units = s.start && s.end ? calculateDuration(s.start, s.end, ex) : null;
    const base: ScheduleRow = old ? { ...old } : {
      id: st.id, no: String(i + 1), phase: '', task: '', taskEn: '', owner: '', assignee: '',
      weeks: 1, typical: '—', gate: ' ', freeze: false, status: 'todo', note: '', s: '', e: '',
    };
    return {
      ...base,
      task: st.name,
      taskEn: st.nameEn || '',
      note: st.note ?? base.note ?? '',
      s: s.start || '',
      e: s.end || '',
      weeks: units !== null ? round1(units / (ex ? 5 : 7)) : (typeof st.weeks === 'number' ? st.weeks : base.weeks),
    };
  });
  const moved = rows.filter((r) => isStageRow(r) && !(r.id && used.has(r.id)) && rowHasInfo(r));
  const special = rows.filter((r) => !isStageRow(r));
  return { rows: [...out, ...special], moved };
}

/* 保存日历:写回阶段行,删掉的有内容的行留底 */
export function applyCalendarToPackage(pk: ServicePackage): number {
  if (!pk.calendar) return 0;
  const { rows, moved } = rowsFromCalendar(pk.schedule || [], pk.calendar);
  pk.schedule = rows;
  if (moved.length) pk.scheduleLegacy = [...(pk.scheduleLegacy || []), ...moved.map((r) => ({ ...r, removedAt: Date.now() }))];
  if (pk.calendar.boundaries.length) pk.start = pk.calendar.boundaries[0];
  return moved.length;
}

/* ---------- 「已改 · 默认 2w」 ---------- */

/* 默认工期(周)换成当前单位的天数:勾了「Exclude Holidays」按 5 个工作日一周,否则 7 天;0 周 = 1 天 */
export const defaultUnits = (weeks: number | undefined, excludeHolidays: boolean): number | null =>
  typeof weeks === 'number' && Number.isFinite(weeks) ? Math.max(1, Math.round(weeks * (excludeHolidays ? 5 : 7))) : null;

export const weeksLabel = (weeks: number) => `${Number.isInteger(weeks) ? weeks : weeks.toFixed(1)}w`;

/* 新建业务:用模板建好的行生成日历;有开始日就按默认工期排好,并把日期写回行。
   按日历天排(和原来的经典排期一样:1 周 = 7 天;需求验收也是「改成 21 天 → 后面顺延 7 天」),
   要排除周末 / 公众假期的,在那份排期上勾 Exclude Holidays。 */
export function seedCalendar(pk: ServicePackage, layout: ((start: LocalDate, weeks: number[]) => LocalDate[]) | null, by: string): void {
  const { calendar } = calendarFromRows(pk.schedule, pk.schedule.map(() => null), { by, at: Date.now(), excludeHolidays: false });
  if (pk.start && layout && /^\d{4}-\d{2}-\d{2}$/.test(pk.start)) {
    calendar.boundaries = layout(pk.start as LocalDate, calendar.stages.map((s) => s.weeks ?? 1));
  }
  pk.calendar = calendar;
  if (calendar.boundaries.length) pk.schedule = rowsFromCalendar(pk.schedule, calendar).rows;
}

export { iso as isoLocal };
