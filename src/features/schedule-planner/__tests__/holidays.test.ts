import { describe, expect, it } from 'vitest'

import { getPublicHoliday, isPublicHoliday } from './holidays'
import type { LocalDate } from './schedule'

describe('Singapore public holidays', () => {
  it('recognizes gazetted dates with names', () => {
    expect(getPublicHoliday('2026-12-25' as LocalDate)).toBe('Christmas Day')
    expect(getPublicHoliday('2026-02-17' as LocalDate)).toBe('Chinese New Year')
    expect(getPublicHoliday('2027-03-10' as LocalDate)).toBe('Hari Raya Puasa')
    expect(getPublicHoliday('2025-10-20' as LocalDate)).toBe('Deepavali')
  })

  it('includes Monday observed days for Sunday holidays', () => {
    expect(getPublicHoliday('2026-06-01' as LocalDate)).toBe('Vesak Day (in lieu)')
    expect(getPublicHoliday('2026-08-10' as LocalDate)).toBe('National Day (in lieu)')
    expect(getPublicHoliday('2027-02-08' as LocalDate)).toBe('Chinese New Year (in lieu)')
  })

  it('returns null for ordinary days and unknown years', () => {
    expect(isPublicHoliday('2026-12-24' as LocalDate)).toBe(false)
    expect(getPublicHoliday('2026-12-24' as LocalDate)).toBeNull()
    expect(getPublicHoliday('2030-01-01' as LocalDate)).toBeNull()
  })
})
