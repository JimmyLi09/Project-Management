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

/**
 * Durations below a full week stay in days. A seven-day duration is the
 * compact one-week boundary, and longer values use half-week increments that
 * always truncate instead of rounding up.
 */
export function formatDuration(duration: number): string {
  if (!Number.isFinite(duration) || duration < 0) {
    return '—'
  }
  if (duration < 7) {
    return `${duration}d`
  }

  const displayWeeks = Math.floor((duration / 7) * 2) / 2
  const value = Number.isInteger(displayWeeks) ? String(displayWeeks) : displayWeeks.toFixed(1)
  return `${value}w`
}
