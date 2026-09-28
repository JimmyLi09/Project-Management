import {
  sanitizeBoundaries,
  sanitizeStages,
  type LocalDate,
  type StageDefinition
} from './schedule'

export interface ScheduleArchive {
  id: string
  name: string
  savedAt: string
  stages: StageDefinition[]
  boundaries: LocalDate[]
}

export const ARCHIVE_STORAGE_KEY = 'stage-calendar-planner:archives:v1'
export const MAX_ARCHIVES = 30

function createArchiveId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
}

function readStorage(): string | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null
    }
    return localStorage.getItem(ARCHIVE_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStorage(value: string): void {
  try {
    if (typeof localStorage === 'undefined') {
      return
    }
    localStorage.setItem(ARCHIVE_STORAGE_KEY, value)
  } catch {
    // Quota or privacy mode: archives simply stay in memory for this session.
  }
}

export function sanitizeArchive(value: unknown): ScheduleArchive | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const entry = value as Record<string, unknown>
  const stages = sanitizeStages(entry.stages)
  if (!stages) {
    return null
  }
  const boundaries = sanitizeBoundaries(entry.boundaries, stages.length)
  if (!boundaries) {
    return null
  }
  /* 修数据用的兜底:正常路径下 buildArchive 一定给了名字,走到这儿说明
     读到的是一条残缺记录。两语都不合适(它不属于任何一种界面语言),
     用一个中性符号,免得给用户一个看着像正经名字的假名字。 */
  const name = typeof entry.name === 'string' && entry.name.trim()
    ? entry.name.trim().slice(0, 60)
    : '—'
  const id = typeof entry.id === 'string' && entry.id.trim()
    ? entry.id.trim().slice(0, 80)
    : createArchiveId()
  const savedAt = typeof entry.savedAt === 'string' && !Number.isNaN(Date.parse(entry.savedAt))
    ? entry.savedAt
    : new Date().toISOString()
  return { id, name, savedAt, stages, boundaries }
}

export function loadArchives(): ScheduleArchive[] {
  const raw = readStorage()
  if (!raw) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    const seen = new Set<string>()
    const result: ScheduleArchive[] = []
    for (const item of parsed) {
      const archive = sanitizeArchive(item)
      if (!archive || seen.has(archive.id)) {
        continue
      }
      seen.add(archive.id)
      result.push(archive)
    }
    return result.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt)).slice(0, MAX_ARCHIVES)
  } catch {
    return []
  }
}

export function persistArchives(archives: readonly ScheduleArchive[]): void {
  writeStorage(JSON.stringify(archives.slice(0, MAX_ARCHIVES)))
}

export function buildArchive(
  name: string,
  stages: readonly StageDefinition[],
  boundaries: readonly LocalDate[],
  lang: 'zh' | 'en' = 'zh'
): ScheduleArchive {
  /* 没起名时的兜底名是**落库的值**,不是界面文案 —— 存下去之后就固定了,
     不会跟着以后切语言变。所以按存的那一刻的界面语言写一个,合情合理。 */
  const label = name.trim().slice(0, 60)
    || (lang === 'en'
      ? `Version ${new Date().toLocaleString('en-GB')}`
      : `存档 ${new Date().toLocaleString('zh-CN')}`)
  return {
    id: createArchiveId(),
    name: label,
    savedAt: new Date().toISOString(),
    stages: stages.map((stage) => ({ ...stage })),
    boundaries: boundaries.slice()
  }
}

/* 存档时间的显示格式跟着界面语言走 —— 这是显示,不是落库的值。
   存的一直是 ISO 字符串,两种语言看到的是同一个时刻的两种写法。 */
const DATE_LOCALE: Record<'zh' | 'en', string> = { zh: 'zh-CN', en: 'en-GB' }

export function formatArchiveDate(iso: string, lang: 'zh' | 'en' = 'zh'): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) {
    return iso
  }
  try {
    return new Intl.DateTimeFormat(DATE_LOCALE[lang] || DATE_LOCALE.zh, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(time))
  } catch {
    return iso
  }
}
