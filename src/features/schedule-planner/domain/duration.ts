import { getPublicHoliday } from './holidays'
import { addDays, compareDates, inclusiveDays, type LocalDate } from './schedule'

function weekdayOf(value: LocalDate): number {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day).getDay()
}

/** Counts Monday-Friday dates, excluding the configured public holidays. */
export function workingDaysInclusive(start: LocalDate, end: LocalDate): number {
  if (compareDates(start, end) > 0) {
    return 0
  }

  let cursor = start
  let count = 0
  while (compareDates(cursor, end) <= 0) {
    const weekday = weekdayOf(cursor)
    if (weekday >= 1 && weekday <= 5 && !getPublicHoliday(cursor)) {
      count += 1
    }
    cursor = addDays(cursor, 1)
  }
  return count
}

export function calculateDuration(
  start: LocalDate,
  end: LocalDate,
  excludeHolidays: boolean = true
): number {
  return excludeHolidays ? workingDaysInclusive(start, end) : inclusiveDays(start, end)
}

export type DurationUnit = 'workdays' | 'days'

/**
 * REQ-046:工期折周按单位来 ——
 *   workdays(勾了 Exclude Holidays):5 个工作日 = 1 周,按 0.5 周四舍五入
 *     (10 → 2w,7 → 1.5w,6 → 1w);不满 5 个工作日写天数。
 *     原来不分单位一律按 7 天折,Sep 27–Oct 11 的 10 个工作日显示成「1w」。
 *   days(不勾):日历天,7 天 = 1 周,按 0.5 周向下取整(原有逻辑不变)。
 */
export function formatDuration(duration: number, unit: DurationUnit = 'days'): string {
  if (!Number.isFinite(duration) || duration < 0) {
    return '—'
  }
  const perWeek = unit === 'workdays' ? 5 : 7
  if (duration < perWeek) {
    return `${duration}d`
  }

  const halves = unit === 'workdays' ? Math.round((duration / perWeek) * 2) : Math.floor((duration / perWeek) * 2)
  const displayWeeks = halves / 2
  const value = Number.isInteger(displayWeeks) ? String(displayWeeks) : displayWeeks.toFixed(1)
  return `${value}w`
}

/** 悬停看的精确值:「10 个工作日」/「14 天」 */
export function durationExact(duration: number, unit: DurationUnit, lang: 'zh' | 'en'): string {
  if (unit === 'workdays') return lang === 'en' ? `${duration} working day${duration === 1 ? '' : 's'}` : `${duration} 个工作日`
  return lang === 'en' ? `${duration} day${duration === 1 ? '' : 's'}` : `${duration} 天`
}

export function isWorkingDay(value: LocalDate): boolean {
  const weekday = weekdayOf(value)
  return weekday >= 1 && weekday <= 5 && !getPublicHoliday(value)
}

/** 周六 / 周日 / 公众假期的名字;工作日返回 null */
export function nonWorkingReason(value: LocalDate, lang: 'zh' | 'en'): string | null {
  const holiday = getPublicHoliday(value)
  if (holiday) return lang === 'en' ? `a public holiday (${holiday})` : `公众假期（${holiday}）`
  const weekday = weekdayOf(value)
  if (weekday === 6) return lang === 'en' ? 'a Saturday' : '周六'
  if (weekday === 0) return lang === 'en' ? 'a Sunday' : '周日'
  return null
}

/** 从 start(含)起数第 n 个工作日(start 是周末 / 假期就从下一个工作日数起) */
export function nthWorkingDay(start: LocalDate, n: number): LocalDate {
  let cursor = start
  let count = 0
  for (let guard = 0; guard < 4000; guard += 1) {
    if (isWorkingDay(cursor)) {
      count += 1
      if (count >= n) return cursor
    }
    cursor = addDays(cursor, 1)
  }
  return cursor
}

/**
 * REQ-046 / 047:从开始日按各阶段默认工期(周)一口气排好。
 * 勾 Exclude Holidays:每周 5 个工作日;不勾:每周 7 天。0 周的阶段(如「信息收集」)占 1 天。
 * 返回 boundaries(第 0 个 = 开始日,第 i+1 个 = 阶段 i 的结束日)。
 */
export function layoutFromStart(
  start: LocalDate,
  weeks: readonly (number | undefined)[],
  excludeHolidays: boolean
): LocalDate[] {
  const boundaries: LocalDate[] = [start]
  let stageStart = start
  for (const w of weeks) {
    const value = typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : 0
    const end = excludeHolidays
      ? nthWorkingDay(stageStart, Math.max(1, Math.round(value * 5)))
      : addDays(stageStart, Math.max(1, Math.round(value * 7)) - 1)
    boundaries.push(end)
    stageStart = addDays(end, 1)
  }
  return boundaries
}

function unitsBetween(start: LocalDate, end: LocalDate, excludeHolidays: boolean): LocalDate[] {
  const out: LocalDate[] = []
  for (let cursor = start; compareDates(cursor, end) <= 0; cursor = addDays(cursor, 1)) {
    if (!excludeHolidays || isWorkingDay(cursor)) out.push(cursor)
  }
  return out
}

/**
 * 把 [start, end] 按权重分给 n 个阶段(每段至少 1 个单位;单位 = 工作日或日历天)。
 * Reverse plan(权重全 1)和 REQ-047「换成新阶段」(权重 = 默认周数)共用。
 * 最后一个分界点固定是 end;单位不够分时返回 null。
 */
export function distributeByWeights(
  start: LocalDate,
  end: LocalDate,
  weights: readonly number[],
  excludeHolidays: boolean
): LocalDate[] | null {
  const n = weights.length
  if (n < 1 || compareDates(start, end) > 0) return null
  const units = unitsBetween(start, end, excludeHolidays)
  if (units.length < n) return null
  const spare = units.length - n
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0))
  const sum = w.reduce((a, b) => a + b, 0)
  const share = w.map((x) => (sum > 0 ? (spare * x) / sum : spare / n))
  const extra = share.map(Math.floor)
  let left = spare - extra.reduce((a, b) => a + b, 0)
  /* 余数按小数部分从大到小补(同样大的先补前面的) */
  const order = share.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1])
  for (let k = 0; left > 0; k = (k + 1) % n, left -= 1) extra[order[k][1]] += 1
  const boundaries: LocalDate[] = [start]
  let used = 0
  for (let i = 0; i < n; i += 1) {
    used += 1 + extra[i]
    boundaries.push(i === n - 1 ? end : units[used - 1])
  }
  return boundaries
}

/** REQ-048:从开始日起 n 个单位(工作日或日历天)后的结束日(含开始日那天) */
export function endAfterUnits(start: LocalDate, n: number, excludeHolidays: boolean): LocalDate {
  const k = Math.max(1, Math.round(n))
  return excludeHolidays ? nthWorkingDay(start, k) : addDays(start, k - 1)
}
