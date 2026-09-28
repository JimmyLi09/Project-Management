import { addDays, compareDates, type LocalDate } from './schedule'

export interface MonthCursor {
  year: number
  month: number
}

export interface CalendarDay {
  date: LocalDate
  day: number
  isCurrentMonth: boolean
  isToday: boolean
  row: number
  column: number
}

/** 日历可视行数（CSS 高度与滚轮步长都以它为准） */
export const CALENDAR_VISIBLE_ROWS = 8

function toLocalDate(year: number, month: number, day: number): LocalDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` as LocalDate
}

function partsFromDate(value: LocalDate): { year: number; month: number; day: number } {
  const [year, month, day] = value.split('-').map(Number)
  return { year, month, day }
}

export function todayLocalDate(): LocalDate {
  const today = new Date()
  return toLocalDate(today.getFullYear(), today.getMonth() + 1, today.getDate())
}

export function monthFromDate(value: LocalDate): MonthCursor {
  const { year, month } = partsFromDate(value)
  return { year, month }
}

export function shiftMonth(cursor: MonthCursor, amount: number): MonthCursor {
  if (!Number.isInteger(amount)) {
    throw new RangeError('Month offsets must be whole months')
  }

  const offset = cursor.month - 1 + amount
  const year = cursor.year + Math.floor(offset / 12)
  const month = ((offset % 12) + 12) % 12 + 1
  return { year, month }
}

export function buildCalendarDays(
  startDate: LocalDate,
  cellCount: number,
  currentMonth: MonthCursor
): CalendarDay[] {
  if (!Number.isInteger(cellCount) || cellCount < 1) {
    throw new RangeError('Calendar cell counts must be positive whole numbers')
  }

  const today = todayLocalDate()
  return Array.from({ length: cellCount }, (_, offset) => {
    const date = addDays(startDate, offset)
    const parts = partsFromDate(date)
    return {
      date,
      day: parts.day,
      isCurrentMonth: parts.year === currentMonth.year && parts.month === currentMonth.month,
      isToday: date === today,
      row: Math.floor(offset / 7),
      column: offset % 7
    }
  })
}

export function buildMonthGrid(cursor: MonthCursor): CalendarDay[] {
  const firstDate = toLocalDate(cursor.year, cursor.month, 1)
  const firstWeekday = new Date(cursor.year, cursor.month - 1, 1).getDay()
  const leadingDays = (firstWeekday + 6) % 7
  // Keep a stable six-week content grid. The viewport can show five rows while
  // the final row remains available through the calendar scrollbar.
  const cellCount = 42
  const gridStart = addDays(firstDate, -leadingDays)
  return buildCalendarDays(gridStart, cellCount, cursor)
}

export function isDateInRange(
  date: LocalDate,
  start: LocalDate | null,
  end: LocalDate | null
): boolean {
  if (!start || !end) {
    return false
  }

  return compareDates(date, start) >= 0 && compareDates(date, end) <= 0
}

export function formatDisplayDate(value: LocalDate): string {
  const { year, month, day } = partsFromDate(value)
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(
    new Date(year, month - 1, 1)
  )
  return `${monthName} ${day}, ${year}`
}

export function formatMonthShort(value: LocalDate): string {
  const { year, month } = partsFromDate(value)
  return new Intl.DateTimeFormat('en-US', { month: 'short' })
    .format(new Date(year, month - 1, 1))
    .toUpperCase()
}

export function formatMonthHeading(cursor: MonthCursor): string {
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(
    new Date(cursor.year, cursor.month - 1, 1)
  )
  return `${monthName} ${cursor.year}`
}

const EXPORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** 导出表格专用：08-Sep-2026 */
export function formatExportDate(value: LocalDate): string {
  const { year, month, day } = partsFromDate(value)
  return `${String(day).padStart(2, '0')}-${EXPORT_MONTHS[month - 1]}-${year}`
}

function shortMonth(year: number, month: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(year, month - 1, 1))
}

/**
 * 右侧横排单行用的紧凑起止：同月同年开始只写 "Sep 10"，
 * 即 "Sep 10 → Sep 12, 2026"；跨月跨年起止都写全。
 */
export function formatRangeParts(start: LocalDate, end: LocalDate): { start: string; end: string } {
  const s = partsFromDate(start)
  const e = partsFromDate(end)
  const endFull = `${shortMonth(e.year, e.month)} ${e.day}, ${e.year}`
  if (s.year === e.year && s.month === e.month) {
    return { start: `${shortMonth(s.year, s.month)} ${s.day}`, end: endFull }
  }
  return { start: formatDisplayDate(start), end: endFull }
}
