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
  const name = typeof entry.name === 'string' && entry.name.trim()
    ? entry.name.trim().slice(0, 60)
    : '未命名存档'
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
  boundaries: readonly LocalDate[]
): ScheduleArchive {
  const label = name.trim().slice(0, 60) || `存档 ${new Date().toLocaleString('zh-CN')}`
  return {
    id: createArchiveId(),
    name: label,
    savedAt: new Date().toISOString(),
    stages: stages.map((stage) => ({ ...stage })),
    boundaries: boundaries.slice()
  }
}

export function formatArchiveDate(iso: string): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) {
    return iso
  }
  try {
    return new Intl.DateTimeFormat('zh-CN', {
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
