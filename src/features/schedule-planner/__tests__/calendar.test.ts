import { describe, expect, it } from 'vitest'

import {
  buildMonthGrid,
  formatDisplayDate,
  formatMonthHeading,
  formatRangeParts,
  isDateInRange,
  monthFromDate,
  shiftMonth,
  todayLocalDate
} from './calendar'

describe('calendar month helpers', () => {
  it('returns the current local month cursor for today', () => {
    expect(monthFromDate(todayLocalDate())).toEqual({
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1
    })
  })

  it('builds complete Monday-first week rows with adjacent-month dates', () => {
    const days = buildMonthGrid({ year: 2026, month: 2 })

    expect(days).toHaveLength(42)
    expect(days[0]).toMatchObject({ date: '2026-01-26', isCurrentMonth: false, row: 0, column: 0 })
    expect(days.find((day) => day.date === '2026-02-01')).toMatchObject({
      isCurrentMonth: true,
      column: 6
    })
    expect(days.at(-1)).toMatchObject({ date: '2026-03-08', isCurrentMonth: false })
  })

  it('handles leap-year dates and month rollover', () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 })
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 })
    expect(buildMonthGrid({ year: 2028, month: 2 }).some((day) => day.date === '2028-02-29')).toBe(true)
  })

  it('checks inclusive range membership and stable English display formatting', () => {
    expect(isDateInRange('2026-03-05', '2026-03-05', '2026-03-10')).toBe(true)
    expect(isDateInRange('2026-03-10', '2026-03-05', '2026-03-10')).toBe(true)
    expect(isDateInRange('2026-03-11', '2026-03-05', '2026-03-10')).toBe(false)
    expect(isDateInRange('2026-03-11', null, '2026-03-10')).toBe(false)
    expect(formatDisplayDate('2026-03-05')).toBe('Mar 5, 2026')
    expect(formatMonthHeading({ year: 2026, month: 3 })).toBe('March 2026')
  })

  it('formats compact range parts for single-line rows', () => {
    expect(formatRangeParts('2026-09-10', '2026-09-12')).toEqual({
      start: 'Sep 10',
      end: 'Sep 12, 2026'
    })
    expect(formatRangeParts('2026-09-30', '2026-10-02')).toEqual({
      start: 'Sep 30, 2026',
      end: 'Oct 2, 2026'
    })
    expect(formatRangeParts('2026-12-31', '2027-01-02')).toEqual({
      start: 'Dec 31, 2026',
      end: 'Jan 2, 2027'
    })
  })
})
