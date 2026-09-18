import { describe, expect, it } from 'vitest'

import {
  STAGES,
  addDays,
  compareDates,
  deriveSchedules,
  distributeStagesEvenly,
  getBoundaryRange,
  inclusiveDays,
  replaceBoundary,
  type LocalDate
} from './schedule'

describe('schedule date primitives', () => {
  it('keeps the six supplied stage labels verbatim and in order', () => {
    expect(STAGES.map((stage) => stage.name)).toEqual([
      '信息收集（见信息清单）',
      '搭建 3D 建筑模型',
      '出角度草图，客户审阅（含 2–3 轮）',
      '灯光 / 材质渲染草图（含 2–3 轮）',
      '合成 / 调色 / 配景（含 2–3 轮）',
      '导出成品格式，客户签收'
    ])
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

    const schedules = deriveSchedules(boundaries)

    expect(schedules).toHaveLength(STAGES.length)
    expect(schedules[0]).toMatchObject({ start: '2026-04-04', end: '2026-04-05', duration: 2 })
    expect(schedules[1]).toMatchObject({ start: '2026-04-06', end: '2026-04-07', duration: 2 })
    expect(schedules[5]).toMatchObject({ start: '2026-04-20', end: '2026-04-25', duration: 6 })
  })

  it('derives partial schedules for the active stage and future stages', () => {
    const schedules = deriveSchedules(['2026-05-10', '2026-05-12'])

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

    expect(getBoundaryRange(0, boundaries)).toEqual({ min: null, max: '2026-06-04' })
    expect(getBoundaryRange(3, boundaries)).toEqual({ min: '2026-06-09', max: '2026-06-17' })
    expect(getBoundaryRange(6, boundaries)).toEqual({ min: '2026-06-21', max: null })
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

    expect(replaceBoundary(boundaries, 3, '2026-06-10')).toEqual([
      '2026-06-01',
      '2026-06-04',
      '2026-06-08',
      '2026-06-10',
      '2026-06-18',
      '2026-06-20',
      '2026-06-25'
    ])
    expect(replaceBoundary(boundaries, 3, '2026-06-08')).toBeNull()
    expect(replaceBoundary(boundaries, 3, '2026-06-18')).toBeNull()
    expect(boundaries[3]).toBe('2026-06-12')
  })

  it('allows appending only the next chronologically valid boundary', () => {
    expect(replaceBoundary(['2026-06-01'], 1, '2026-06-01')).toEqual(['2026-06-01', '2026-06-01'])
    expect(replaceBoundary(['2026-06-01'], 1, '2026-05-31')).toBeNull()
    expect(replaceBoundary(['2026-06-01'], 3, '2026-06-03')).toBeNull()
  })
})
