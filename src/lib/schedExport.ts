/* REQ-056:排期导出的「月历」「甘特」两种样式 —— 只管排版用的数(哪几个月、每周哪几天有哪一段、
   甘特每格一周、色条从哪到哪),不碰 React,好测。日期一律是本地日 YYYY-MM-DD。
   数据来源和其他排期样式一样:pkg.schedule + 日历边界(planDates),由 ExportOverlay 换算好传进来。 */
import { addDays, compareDates, inclusiveDays, type LocalDate } from '@/features/schedule-planner/domain/schedule';
import { getPublicHoliday } from '@/features/schedule-planner/domain/holidays';

export type ExpStage = {
  no: number;                // 阶段编号(1 起)
  name: string;
  star: boolean;             // ★ 关键节点(REQ-018 的 freeze)
  start: LocalDate | null;   // 没有日期的阶段:不画色条,列表里写「—」
  end: LocalDate | null;
  status: string;            // todo / wip / done / block
};

export const ymd = (d: Date): LocalDate =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` as LocalDate;
const parts = (d: LocalDate) => d.split('-').map(Number) as [number, number, number];
/* 这一天是星期几:0 = 周一 … 6 = 周日 */
export const weekdayMon = (d: LocalDate) => { const [y, m, dd] = parts(d); return (new Date(y, m - 1, dd).getDay() + 6) % 7; };
export const mondayOf = (d: LocalDate) => addDays(d, -weekdayMon(d));
const dated = (s: ExpStage[]) => s.filter((x): x is ExpStage & { start: LocalDate; end: LocalDate } => !!x.start && !!x.end && compareDates(x.start, x.end) <= 0);

/* 整个工期:第一个开始 → 最后一个结束,共几天、几周(按 7 天一周往上取整) */
export function spanOf(stages: ExpStage[]): { start: LocalDate; end: LocalDate; days: number; weeks: number } | null {
  const d = dated(stages);
  if (!d.length) return null;
  const start = d.reduce((a, x) => (compareDates(x.start, a) < 0 ? x.start : a), d[0].start);
  const end = d.reduce((a, x) => (compareDates(x.end, a) > 0 ? x.end : a), d[0].end);
  const days = inclusiveDays(start, end);
  return { start, end, days, weeks: Math.ceil(days / 7) };
}

/* 月历:覆盖到的每个月 */
export function monthsOf(stages: ExpStage[]): { year: number; month: number }[] {
  const sp = spanOf(stages);
  if (!sp) return [];
  const [y0, m0] = parts(sp.start), [y1, m1] = parts(sp.end);
  const out: { year: number; month: number }[] = [];
  for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? (y++, m = 1) : m++) out.push({ year: y, month: m });
  return out;
}

/* 一个月的格子:周一到周日一行,只排这个月用得到的那几周(4–6 行);月外的日子也给出来(浅色) */
export function monthWeeks(year: number, month: number): LocalDate[][] {
  const first = `${year}-${String(month).padStart(2, '0')}-01` as LocalDate;
  const last = addDays(month === 12 ? (`${year + 1}-01-01` as LocalDate) : (`${year}-${String(month + 1).padStart(2, '0')}-01` as LocalDate), -1);
  const weeks: LocalDate[][] = [];
  for (let w = mondayOf(first); compareDates(w, last) <= 0; w = addDays(w, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(w, i)));
  return weeks;
}
export const inMonth = (d: LocalDate, year: number, month: number) => { const [y, m] = parts(d); return y === year && m === month; };

/* 一周里每个阶段占哪几天:from / to = 列(0 = 周一)。同一周里日期有重叠的分到不同的行(lane)。
   label:阶段开始那天、或者这一周的第一段,写「01 · 阶段名」;isStart:这一段包含阶段开始日(左边画竖线) */
export type WeekSeg = { stage: ExpStage; from: number; to: number; lane: number; label: boolean; isStart: boolean };
export function weekSegments(week: LocalDate[], stages: ExpStage[], clip?: [LocalDate, LocalDate]): WeekSeg[] {
  /* clip:只画这几天(月历里月外的日子不画色条) */
  const ws = clip ? clip[0] : week[0], we = clip ? clip[1] : week[6];
  const segs: WeekSeg[] = [];
  const laneEnds: number[] = [];
  for (const s of dated(stages)) {
    if (compareDates(s.end, ws) < 0 || compareDates(s.start, we) > 0) continue;
    const a = compareDates(s.start, ws) < 0 ? ws : s.start;
    const b = compareDates(s.end, we) > 0 ? we : s.end;
    const from = weekdayMon(a), to = weekdayMon(b);
    let lane = laneEnds.findIndex((e) => e < from);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(to); } else laneEnds[lane] = to;
    const isStart = s.start === a;
    segs.push({ stage: s, from, to, lane, isStart, label: true });
  }
  return segs;
}

/* 这一个月里出现过的阶段(本页阶段列表) */
export const stagesInMonth = (stages: ExpStage[], year: number, month: number) => {
  const first = `${year}-${String(month).padStart(2, '0')}-01` as LocalDate;
  const last = addDays(month === 12 ? (`${year + 1}-01-01` as LocalDate) : (`${year}-${String(month + 1).padStart(2, '0')}-01` as LocalDate), -1);
  return dated(stages).filter((s) => compareDates(s.end, first) >= 0 && compareDates(s.start, last) <= 0);
};

/* 关键日期:每个阶段的开始日 + 最后交付日(= 最后一个阶段的结束日) */
export function keyDates(stages: ExpStage[]): { starts: Set<string>; end: LocalDate | null } {
  const sp = spanOf(stages);
  return { starts: new Set(dated(stages).map((s) => s.start)), end: sp ? sp.end : null };
}
export const holidayOf = (d: LocalDate) => getPublicHoliday(d);

/* 甘特:每格一周,从第一个阶段那周的周一排到最后一个阶段那周 */
export function ganttWeeks(stages: ExpStage[]): LocalDate[] {
  const sp = spanOf(stages);
  if (!sp) return [];
  const out: LocalDate[] = [];
  for (let w = mondayOf(sp.start); compareDates(w, sp.end) <= 0; w = addDays(w, 7)) out.push(w);
  return out;
}
/* 色条 / 红线在整条时间轴上的位置(百分比);d0 = 第一格的周一,n = 几周 */
export const ganttPos = (d0: LocalDate, n: number, start: LocalDate, end: LocalDate) => {
  const total = n * 7;
  const left = (inclusiveDays(d0, start) - 1) / total * 100;
  const width = inclusiveDays(start, end) / total * 100;
  return { left, width };
};
export const ganttLine = (d0: LocalDate, n: number, day: LocalDate) => (inclusiveDays(d0, day) - 0.5) / (n * 7) * 100;

/* 色条颜色:月历按阶段顺序;甘特按状态(进行中绿、未开始灰蓝、已完成灰) */
export const STAGE_TONES = ['#E4DDF3', '#F6E2D0', '#D8E3F1', '#DCEADD', '#F4D9D9', '#E9E3D6', '#D8ECEB', '#F1E6C8'];
export const STAGE_EDGES = ['#7B68B5', '#C2803E', '#4C77AE', '#4F8A5B', '#B5545A', '#8C7B5A', '#3E8C86', '#A88A2B'];
export const toneOf = (no: number) => STAGE_TONES[(no - 1) % STAGE_TONES.length];
export const edgeOf = (no: number) => STAGE_EDGES[(no - 1) % STAGE_EDGES.length];
export const GANTT_STATUS: Record<string, string> = { wip: '#2F7A57', todo: '#9FB2C8', done: '#8B8F96', block: '#C0392B' };

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthTitle = (year: number, month: number, zh: boolean) => (zh ? `${year} 年 ${month} 月` : `${MONTH_LONG[month - 1]} ${year}`);
/* 「Oct 14 → Dec 29, 2026」(跨年时两边都写年份) */
export function spanLabel(start: LocalDate, end: LocalDate): string {
  const [y0, m0, d0] = parts(start), [y1, m1, d1] = parts(end);
  return y0 === y1 ? `${MON[m0 - 1]} ${d0} → ${MON[m1 - 1]} ${d1}, ${y1}` : `${MON[m0 - 1]} ${d0}, ${y0} → ${MON[m1 - 1]} ${d1}, ${y1}`;
}
/* 甘特左边日期栏:「14 Oct – 20 Oct」;表头:「12 Oct」 */
export const dayMon = (d: LocalDate) => { const [, m, dd] = parts(d); return `${dd} ${MON[m - 1]}`; };
