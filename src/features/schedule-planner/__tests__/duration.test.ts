import { describe, expect, it } from 'vitest'

import { calculateDuration, distributeByWeights, durationExact, formatDuration, isWorkingDay, layoutFromStart, nonWorkingReason, workingDaysInclusive } from '../domain/duration'
import { addDays, type LocalDate } from '../domain/schedule'

describe('duration rules', () => {
  it('counts weekdays and excludes Singapore public holidays by default', () => {
    expect(workingDaysInclusive('2026-04-04' as LocalDate, '2026-04-09' as LocalDate)).toBe(4)
    expect(workingDaysInclusive('2026-05-27' as LocalDate, '2026-06-01' as LocalDate)).toBe(2)
    expect(calculateDuration('2026-04-06' as LocalDate, '2026-04-12' as LocalDate)).toBe(5)
  })

  it('uses calendar days when holiday exclusion is disabled', () => {
    expect(calculateDuration('2026-04-06' as LocalDate, '2026-04-12' as LocalDate, false)).toBe(7)
  })

  /* 日历天(不勾 Exclude Holidays):7 天 = 1 周,半周向下取整 —— 原来的逻辑和预期都保留 */
  it('formats calendar-day durations as days below a week and floored half-weeks above', () => {
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

/* REQ-046:勾了 Exclude Holidays 时按工作日折周(5 = 1w,0.5 周四舍五入);不勾按日历天(原逻辑) */
describe('REQ-046 working-week display', () => {
  it('5 working days = 1 week; rounds to the nearest half week', () => {
    expect(formatDuration(4, 'workdays')).toBe('4d')
    expect(formatDuration(5, 'workdays')).toBe('1w')
    expect(formatDuration(6, 'workdays')).toBe('1w')
    expect(formatDuration(7, 'workdays')).toBe('1.5w')
    expect(formatDuration(10, 'workdays')).toBe('2w')
    expect(formatDuration(25, 'workdays')).toBe('5w')
    expect(durationExact(10, 'workdays', 'zh')).toBe('10 个工作日')
    expect(durationExact(14, 'days', 'en')).toBe('14 days')
  })

  it('Sep 27 – Oct 11, 2026 (Sun → Sun) is 10 working days = 2w, not 1w', () => {
    const n = calculateDuration('2026-09-27' as LocalDate, '2026-10-11' as LocalDate, true)
    expect(n).toBe(10)
    expect(formatDuration(n, 'workdays')).toBe('2w')
    expect(formatDuration(calculateDuration('2026-09-27' as LocalDate, '2026-10-11' as LocalDate, false), 'days')).toBe('2w')
  })

  it('a stage starting or ending on a Sunday counts only the weekdays inside', () => {
    expect(workingDaysInclusive('2026-10-04' as LocalDate, '2026-10-09' as LocalDate)).toBe(5)   // Sun → Fri
    expect(workingDaysInclusive('2026-10-05' as LocalDate, '2026-10-11' as LocalDate)).toBe(5)   // Mon → Sun
  })

  it('skips public holidays (Deepavali 2026-11-08 is a Sunday, in lieu Mon 11-09)', () => {
    expect(workingDaysInclusive('2026-11-09' as LocalDate, '2026-11-13' as LocalDate)).toBe(
      isWorkingDay('2026-11-09' as LocalDate) ? 5 : 4)
    expect(workingDaysInclusive('2026-12-21' as LocalDate, '2026-12-27' as LocalDate)).toBe(4)   // Christmas Fri 12-25
    expect(nonWorkingReason('2026-12-25' as LocalDate, 'zh')).toBe('公众假期（Christmas Day）')
    expect(nonWorkingReason('2026-10-03' as LocalDate, 'zh')).toBe('周六')
    expect(nonWorkingReason('2026-10-05' as LocalDate, 'zh')).toBeNull()
  })

  it('lays out stages from a start date by their default weeks', () => {
    /* 新 CGI 流程 0 / 1 / 1 / 2 / 1 周,从 Sun Sep 27 起(工作日) */
    const b = layoutFromStart('2026-09-27' as LocalDate, [0, 1, 1, 2, 1], true)
    expect(b).toEqual(['2026-09-27', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-26', '2026-11-02'])
    /* 日历天:7 天一周,0 周 = 1 天 */
    expect(layoutFromStart('2026-09-27' as LocalDate, [0, 1], false)).toEqual(['2026-09-27', '2026-09-27', '2026-10-04'])
  })

  it('distributes by weights over working days, at least one unit each, deadline kept', () => {
    const b = distributeByWeights('2026-10-05' as LocalDate, '2026-10-30' as LocalDate, [1, 1, 1, 1], true)!
    expect(b[0]).toBe('2026-10-05')
    expect(b.at(-1)).toBe('2026-10-30')
    expect(b).toHaveLength(5)
    expect(distributeByWeights('2026-10-03' as LocalDate, '2026-10-04' as LocalDate, [1], true)).toBeNull()   // 只有周末
    const w = distributeByWeights('2026-10-05' as LocalDate, '2026-11-06' as LocalDate, [0, 1, 1, 2, 1], true)!
    expect(workingDaysInclusive(addDays(w[3], 1), w[4])).toBeGreaterThan(workingDaysInclusive(addDays(w[2], 1), w[3]))
  })
})
