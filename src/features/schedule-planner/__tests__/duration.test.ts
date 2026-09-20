import { describe, expect, it } from 'vitest'

import { calculateDuration, formatDuration, workingDaysInclusive } from './duration'
import type { LocalDate } from './schedule'

describe('duration rules', () => {
  it('counts weekdays and excludes Singapore public holidays by default', () => {
    expect(workingDaysInclusive('2026-04-04' as LocalDate, '2026-04-09' as LocalDate)).toBe(4)
    expect(workingDaysInclusive('2026-05-27' as LocalDate, '2026-06-01' as LocalDate)).toBe(2)
    expect(calculateDuration('2026-04-06' as LocalDate, '2026-04-12' as LocalDate)).toBe(5)
  })

  it('uses calendar days when holiday exclusion is disabled', () => {
    expect(calculateDuration('2026-04-06' as LocalDate, '2026-04-12' as LocalDate, false)).toBe(7)
  })

  it('formats short durations as days and longer durations as floored half-weeks', () => {
    expect(formatDuration(6)).toBe('6d')
    expect(formatDuration(7)).toBe('1w')
    expect(formatDuration(8)).toBe('1w')
    expect(formatDuration(11)).toBe('1.5w')
    expect(formatDuration(13)).toBe('1.5w')
    expect(formatDuration(14)).toBe('2w')
    expect(formatDuration(20)).toBe('2.5w')
    expect(formatDuration(27)).toBe('3.5w')
  })
})
