export type LocalDate = `${number}-${number}-${number}`

export interface StageDefinition {
  id: string
  name: string
  /* REQ-041 的老规矩在这儿再用一次(见 docs/i18n-词条维护.md §3):
     出厂阶段名给一个可选的英文位,EN 界面优先用它。用户一旦改名,这一位就
     丢掉 —— 改过的名字是用户内容,不该拿一句出厂英文去冒充它的翻译。
     老数据没有这一位,读出来是 undefined,自动回落到 name,不需要迁移。 */
  nameEn?: string
  tone: string
}

export interface StageSchedule extends StageDefinition {
  index: number
  start: LocalDate | null
  end: LocalDate | null
  duration: number | null
}

export interface BoundaryRange {
  min: LocalDate | null
  max: LocalDate | null
}

export const STAGE_TONES = ['coral', 'peach', 'sage', 'sky', 'lavender', 'sand'] as const

export type StageTone = (typeof STAGE_TONES)[number]

export function createStageId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto && typeof crypto.randomUUID === 'function') {
    return `stage-${crypto.randomUUID()}`
  }
  return `stage-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
}

export function createStage(name: string, index: number): StageDefinition {
  const trimmed = name.trim()
  return {
    id: createStageId(),
    name: trimmed || `新阶段 ${index + 1}`,
    tone: STAGE_TONES[index % STAGE_TONES.length]
  }
}

/**
 * These labels intentionally stay fixed: the planner is a calendar-first
 * sequencing tool, not an editable project-template form.
 */
export const STAGES: readonly StageDefinition[] = [
  { id: 'brief', name: '信息收集（见信息清单）', nameEn: 'Information gathering (see checklist)', tone: 'coral' },
  { id: 'concept', name: '搭建 3D 建筑模型', nameEn: 'Build the 3D architectural model', tone: 'peach' },
  { id: 'development', name: '出角度草图，客户审阅（含 2–3 轮）', nameEn: 'Angle drafts, client review (2–3 rounds)', tone: 'sage' },
  { id: 'documentation', name: '灯光 / 材质渲染草图（含 2–3 轮）', nameEn: 'Lighting / material draft renders (2–3 rounds)', tone: 'sky' },
  { id: 'delivery', name: '合成 / 调色 / 配景（含 2–3 轮）', nameEn: 'Compositing / grading / entourage (2–3 rounds)', tone: 'lavender' },
  { id: 'handover', name: '导出成品格式，客户签收', nameEn: 'Export final formats, client sign-off', tone: 'sand' }
]

/* 当前语言下这个阶段该显示的名字。没有英文位就回落到 name —— 用户改过名的
   阶段两种语言显示的是同一个名字,这正是「用户内容不翻译」要的效果。 */
export function stageName(stage: { name: string; nameEn?: string }, lang: 'zh' | 'en'): string {
  return lang === 'en' ? (stage.nameEn || stage.name) : stage.name
}

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const MILLISECONDS_PER_DAY = 86_400_000

function parseLocalDate(value: LocalDate): Date {
  const match = LOCAL_DATE_PATTERN.exec(value)

  if (!match) {
    throw new RangeError(`Invalid local date: ${value}`)
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const result = new Date(0)
  result.setHours(12, 0, 0, 0)
  result.setFullYear(year, month - 1, day)

  if (
    result.getFullYear() !== year ||
    result.getMonth() !== month - 1 ||
    result.getDate() !== day
  ) {
    throw new RangeError(`Invalid local date: ${value}`)
  }

  return result
}

function formatLocalDate(date: Date): LocalDate {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}` as LocalDate
}

function toDayNumber(value: LocalDate): number {
  const date = parseLocalDate(value)
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MILLISECONDS_PER_DAY
}

export function addDays(value: LocalDate, amount: number): LocalDate {
  if (!Number.isInteger(amount)) {
    throw new RangeError('Date offsets must be whole calendar days')
  }

  const date = parseLocalDate(value)
  date.setDate(date.getDate() + amount)
  return formatLocalDate(date)
}

export function compareDates(left: LocalDate, right: LocalDate): number {
  const leftDay = toDayNumber(left)
  const rightDay = toDayNumber(right)
  return Math.sign(leftDay - rightDay)
}

export function inclusiveDays(start: LocalDate, end: LocalDate): number {
  return toDayNumber(end) - toDayNumber(start) + 1
}

/** Builds the existing boundary format from an inclusive project range. */
export function distributeStagesEvenly(
  start: LocalDate,
  deadline: LocalDate,
  stageCount: number
): LocalDate[] | null {
  if (!Number.isInteger(stageCount) || stageCount < 1) {
    return null
  }

  const totalDays = inclusiveDays(start, deadline)
  if (totalDays < stageCount) {
    return null
  }

  const baseDays = Math.floor(totalDays / stageCount)
  const extraDays = totalDays % stageCount
  const boundaries: LocalDate[] = [start]
  let assignedDays = 0

  for (let index = 0; index < stageCount; index += 1) {
    assignedDays += baseDays + (index < extraDays ? 1 : 0)
    boundaries.push(addDays(start, assignedDays - 1))
  }

  return boundaries
}

export function deriveSchedules(
  boundaries: readonly LocalDate[],
  stages: readonly StageDefinition[] = STAGES
): StageSchedule[] {
  return stages.map((stage, index) => {
    const start = index === 0
      ? boundaries[0] ?? null
      : boundaries[index] !== undefined
        ? addDays(boundaries[index], 1)
        : null
    const end = boundaries[index + 1] ?? null
    const duration = start && end ? inclusiveDays(start, end) : null

    return {
      ...stage,
      index,
      start,
      end,
      duration
    }
  })
}

export function getBoundaryRange(
  index: number,
  boundaries: readonly LocalDate[],
  stageCount: number = STAGES.length
): BoundaryRange {
  if (!Number.isInteger(index) || index < 0 || index > stageCount) {
    return { min: null, max: null }
  }

  const previous = boundaries[index - 1]
  const next = boundaries[index + 1]

  // The first stage starts on boundary 0, so its end may be the same
  // calendar day. Every subsequent stage begins the day after its previous end.
  const min = index === 0 || !previous
    ? null
    : index === 1
      ? previous
      : addDays(previous, 1)
  const max = index === 0
    ? next ?? null
    : index === stageCount || !next
      ? null
      : addDays(next, -1)

  return { min, max }
}

export function replaceBoundary(
  boundaries: readonly LocalDate[],
  index: number,
  candidate: LocalDate,
  stageCount: number = STAGES.length
): LocalDate[] | null {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index > stageCount ||
    boundaries.length > stageCount + 1 ||
    index > boundaries.length
  ) {
    return null
  }

  // Validate the candidate even when this is the first boundary. This keeps
  // all UI and keyboard paths on one fail-closed domain function.
  parseLocalDate(candidate)

  const range = getBoundaryRange(index, boundaries, stageCount)
  if (range.min && compareDates(candidate, range.min) < 0) {
    return null
  }
  if (range.max && compareDates(candidate, range.max) > 0) {
    return null
  }

  const next = boundaries.slice()
  next[index] = candidate
  return next
}

export const MIN_STAGES = 1
export const MAX_STAGES = 50

function isLocalDateString(value: unknown): value is LocalDate {
  if (typeof value !== 'string') {
    return false
  }
  try {
    parseLocalDate(value as LocalDate)
    return true
  } catch {
    return false
  }
}

export function sanitizeStages(value: unknown): StageDefinition[] | null {
  if (!Array.isArray(value) || value.length < MIN_STAGES || value.length > MAX_STAGES) {
    return null
  }

  const seen = new Set<string>()
  const result: StageDefinition[] = []
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index] as Partial<StageDefinition> | null
    if (!entry || typeof entry !== 'object') {
      return null
    }
    const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, 60) : ''
    if (!name) {
      return null
    }
    const rawId = typeof entry.id === 'string' && entry.id.trim()
      ? entry.id.trim().slice(0, 80)
      : createStageId()
    const id = seen.has(rawId) ? createStageId() : rawId
    seen.add(id)
    const tone = typeof entry.tone === 'string' && (STAGE_TONES as readonly string[]).includes(entry.tone)
      ? entry.tone
      : STAGE_TONES[index % STAGE_TONES.length]
    result.push({ id, name, tone })
  }
  return result
}

export function sanitizeBoundaries(value: unknown, stageCount: number): LocalDate[] | null {
  if (!Array.isArray(value) || value.length > stageCount + 1) {
    return null
  }
  const result: LocalDate[] = []
  for (const entry of value) {
    if (!isLocalDateString(entry)) {
      return null
    }
    result.push(entry)
  }
  // Boundaries must stay non-decreasing; drop the tail once ordering breaks
  // so a hand-edited archive can never corrupt the planner.
  const ordered: LocalDate[] = []
  for (const date of result) {
    if (ordered.length > 0 && compareDates(date, ordered[ordered.length - 1]) < 0) {
      break
    }
    ordered.push(date)
    const rebuilt = ordered.slice()
    // Re-validate each appended boundary against its range.
    const index = ordered.length - 1
    const prefix = ordered.slice(0, index)
    if (!replaceBoundary(prefix, index, date, stageCount)) {
      ordered.pop()
      break
    }
    void rebuilt
  }
  return ordered
}

/**
 * Removing stage `removedIndex` drops its end boundary (`removedIndex + 1`)
 * when that boundary already exists. The remaining boundaries stay ordered
 * because the original sequence was non-decreasing.
 */
export function boundariesAfterStageRemoval(
  boundaries: readonly LocalDate[],
  removedIndex: number
): LocalDate[] {
  const dropAt = removedIndex + 1
  if (dropAt < 0 || dropAt >= boundaries.length) {
    return boundaries.slice()
  }
  return [...boundaries.slice(0, dropAt), ...boundaries.slice(dropAt + 1)]
}

export type ScheduleStatus = 'Done' | 'In progress' | 'Not started'

/** 导出表格用：只看今天落在起止之外的哪一侧，不依赖是否点 Confirm */
export function stageStatus(
  stage: Pick<StageSchedule, 'start' | 'end'>,
  today: LocalDate
): ScheduleStatus {
  if (!stage.start || !stage.end) {
    return 'Not started'
  }
  if (compareDates(today, stage.end) > 0) {
    return 'Done'
  }
  if (compareDates(today, stage.start) >= 0) {
    return 'In progress'
  }
  return 'Not started'
}
