import { describe, expect, it } from 'vitest'

import {
  STAGES,
  LEGACY_CGI_STAGE_IDS,
  isLegacyCgiStages,
  setStageEnd,
  setStageStart,
  addDays,
  compareDates,
  deriveSchedules,
  distributeStagesEvenly,
  getBoundaryRange,
  inclusiveDays,
  replaceBoundary,
  type LocalDate
} from '../domain/schedule'

/* 通用规则按 6 个阶段测(REQ-047 之前的默认阶段数);默认阶段本身另测 */
const SIX = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, tone: 'coral' }))

describe('schedule date primitives', () => {
  it('REQ-047: the standalone default is the new CGI flow (5 stages, weeks 0/1/1/2/1)', () => {
    expect(STAGES.map((stage) => stage.name)).toEqual([
      '信息收集：收到模型资料（见信息清单）',
      '白膜角度小样',
      '角度 shortlist + AI 效果图，确定角度与大效果（含 1–2 轮）',
      '带材质、模型的后期图（参考大效果，含 2–3 轮）',
      '导出成品格式，客户签收'
    ])
    expect(STAGES.map((stage) => stage.weeks)).toEqual([0, 1, 1, 2, 1])
  })

  it('adds calendar days without shifting across month boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('compares local dates and calculates inclusive duration', () => {
    expect(compareDates('2026-04-04', '2026-04-04')).toBe(0)
    expect(compareDates('2026-04-03', '2026-04-04')).toBeLessThan(0)
    expect(compareDates('2026-04-05', '2026-04-04')).toBeGreaterThan(0)
    expect(inclusiveDays('2026-04-04', '2026-04-04')).toBe(1)
    expect(inclusiveDays('2026-04-04', '2026-04-09')).toBe(6)
  })

  it('derives six starts, ends, and durations from seven boundaries', () => {
    const boundaries: LocalDate[] = [
      '2026-04-04',
      '2026-04-05',
      '2026-04-07',
      '2026-04-10',
      '2026-04-14',
      '2026-04-19',
      '2026-04-25'
    ]

    const schedules = deriveSchedules(boundaries, SIX)

    expect(schedules).toHaveLength(6)
    expect(schedules[0]).toMatchObject({ start: '2026-04-04', end: '2026-04-05', duration: 2 })
    expect(schedules[1]).toMatchObject({ start: '2026-04-06', end: '2026-04-07', duration: 2 })
    expect(schedules[5]).toMatchObject({ start: '2026-04-20', end: '2026-04-25', duration: 6 })
  })

  it('derives partial schedules for the active stage and future stages', () => {
    const schedules = deriveSchedules(['2026-05-10', '2026-05-12'], SIX)

    expect(schedules[0]).toMatchObject({ start: '2026-05-10', end: '2026-05-12', duration: 3 })
    expect(schedules[1]).toMatchObject({ start: '2026-05-13', end: null, duration: null })
    expect(schedules[2]).toMatchObject({ start: null, end: null, duration: null })
  })

  it('splits an inclusive date range across the existing stages and keeps the deadline fixed', () => {
    expect(distributeStagesEvenly('2026-10-01', '2026-10-14', 6)).toEqual([
      '2026-10-01',
      '2026-10-03',
      '2026-10-06',
      '2026-10-08',
      '2026-10-10',
      '2026-10-12',
      '2026-10-14'
    ])
  })

  it('requires at least one calendar day per stage for reverse planning', () => {
    expect(distributeStagesEvenly('2026-10-01', '2026-10-06', 6)).toEqual([
      '2026-10-01', '2026-10-01', '2026-10-02', '2026-10-03',
      '2026-10-04', '2026-10-05', '2026-10-06'
    ])
    expect(distributeStagesEvenly('2026-10-01', '2026-10-05', 6)).toBeNull()
    expect(distributeStagesEvenly('2026-10-06', '2026-10-01', 6)).toBeNull()
  })

  it('returns the valid inclusive range for every adjustable boundary', () => {
    const boundaries: LocalDate[] = [
      '2026-06-01',
      '2026-06-04',
      '2026-06-08',
      '2026-06-12',
      '2026-06-18',
      '2026-06-20',
      '2026-06-25'
    ]

    expect(getBoundaryRange(0, boundaries, 6)).toEqual({ min: null, max: '2026-06-04' })
    expect(getBoundaryRange(3, boundaries, 6)).toEqual({ min: '2026-06-09', max: '2026-06-17' })
    expect(getBoundaryRange(6, boundaries, 6)).toEqual({ min: '2026-06-21', max: null })
  })

  it('replaces a boundary immutably only inside its constrained range', () => {
    const boundaries: LocalDate[] = [
      '2026-06-01',
      '2026-06-04',
      '2026-06-08',
      '2026-06-12',
      '2026-06-18',
      '2026-06-20',
      '2026-06-25'
    ]

    expect(replaceBoundary(boundaries, 3, '2026-06-10', 6)).toEqual([
      '2026-06-01',
      '2026-06-04',
      '2026-06-08',
      '2026-06-10',
      '2026-06-18',
      '2026-06-20',
      '2026-06-25'
    ])
    expect(replaceBoundary(boundaries, 3, '2026-06-08', 6)).toBeNull()
    expect(replaceBoundary(boundaries, 3, '2026-06-18', 6)).toBeNull()
    expect(boundaries[3]).toBe('2026-06-12')
  })

  it('allows appending only the next chronologically valid boundary', () => {
    expect(replaceBoundary(['2026-06-01'], 1, '2026-06-01', 6)).toEqual(['2026-06-01', '2026-06-01'])
    expect(replaceBoundary(['2026-06-01'], 1, '2026-05-31', 6)).toBeNull()
    expect(replaceBoundary(['2026-06-01'], 3, '2026-06-03', 6)).toBeNull()
  })
})

/* REQ-046:右侧直接改开始 / 结束日 */
describe('REQ-046 editing a stage start / end from the right panel', () => {
  const b: LocalDate[] = ['2026-09-27', '2026-10-11', '2026-10-18', '2026-10-25']   // 3 stages
  it('moving an end date shifts every later stage by the same amount (default)', () => {
    expect(setStageEnd(b, 0, '2026-10-18')).toEqual({ boundaries: ['2026-09-27', '2026-10-18', '2026-10-25', '2026-11-01'] })
  })
  it('"only this boundary" squeezes the next stage instead, never to zero days', () => {
    expect(setStageEnd(b, 0, '2026-10-15', 'one')).toEqual({ boundaries: ['2026-09-27', '2026-10-15', '2026-10-18', '2026-10-25'] })
    expect(setStageEnd(b, 0, '2026-10-18', 'one')).toEqual({ error: 'squeezeNext' })
  })
  it('an end before the start is refused', () => {
    expect(setStageEnd(b, 1, '2026-10-11')).toEqual({ error: 'endBeforeStart' })
    expect(setStageEnd(b, 0, '2026-09-26')).toEqual({ error: 'endBeforeStart' })
  })
  it('a start date moves the previous end; stage 01 start moves the whole plan', () => {
    expect(setStageStart(b, 1, '2026-10-10')).toEqual({ boundaries: ['2026-09-27', '2026-10-09', '2026-10-18', '2026-10-25'] })
    expect(setStageStart(b, 1, '2026-09-27')).toEqual({ error: 'squeezePrev' })
    expect(setStageStart(b, 1, '2026-10-19')).toEqual({ error: 'startAfterEnd' })
    expect(setStageStart(b, 0, '2026-10-04')).toEqual({ boundaries: ['2026-10-04', '2026-10-18', '2026-10-25', '2026-11-01'] })
  })
  it('recognises the pre-REQ-047 CGI stage set', () => {
    expect(isLegacyCgiStages(LEGACY_CGI_STAGE_IDS.map((id) => ({ id })))).toBe(true)
    expect(isLegacyCgiStages(STAGES)).toBe(false)
  })
})
