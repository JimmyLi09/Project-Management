import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type UIEvent as ReactUIEvent
} from 'react'

import {
  buildCalendarDays,
  buildMonthGrid,
  CALENDAR_VISIBLE_ROWS,
  formatDisplayDate,
  formatMonthShort,
  formatMonthHeading,
  isDateInRange,
  monthFromDate,
  todayLocalDate,
  type CalendarDay,
  type MonthCursor
} from '../domain/calendar'
import {
  addDays,
  boundariesAfterStageRemoval,
  createStage,
  deriveSchedules,
  distributeStagesEvenly,
  inclusiveDays,
  type LocalDate,
  MAX_STAGES,
  replaceBoundary,
  type StageDefinition,
  stageName,
  STAGES
} from '../domain/schedule'
import {
  buildArchive,
  loadArchives,
  persistArchives,
  type ScheduleArchive
} from '../domain/archives'
import { getPublicHoliday } from '../domain/holidays'
import { calculateDuration, formatDuration } from '../domain/duration'
import { ArchivePanel } from './ArchivePanel'
import { ExportPanel } from './ExportPanel'
import { DEFAULT_EXPORT_NOTE, PrintSchedule, type PrintScheduleMeta } from './PrintSchedule'
import { StagePanel } from './StagePanel'
import { useLang } from '@/lib/i18n'

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

/** gutter 月块左侧 accent 条，按月份固定取色，滚动拼接也稳定 */
const GUTTER_ACCENTS = ['#33414f', '#9a7730', '#4f8f76', '#7a6197'] as const

interface MonthGutterBlock {
  key: string
  startWeek: number
  length: number
  monthLabel: string
  year: number
  accent: string
}

function buildGutterBlocks(weeks: CalendarDay[][]): MonthGutterBlock[] {
  const blocks: MonthGutterBlock[] = []
  for (let w = 0; w < weeks.length; w += 1) {
    const week = weeks[w]
    if (week.length === 0) {
      continue
    }
    // 周四一定落在该周天数占多数的月份
    const thursday = week[3] ?? week[0]
    const cursor = monthFromDate(thursday.date)
    const key = `${cursor.year}-${cursor.month}`
    const current = blocks.at(-1)
    if (current && current.key === key) {
      current.length += 1
    } else {
      blocks.push({
        key,
        startWeek: w,
        length: 1,
        monthLabel: formatMonthShort(thursday.date),
        year: cursor.year,
        accent: GUTTER_ACCENTS[(cursor.year * 12 + cursor.month) % GUTTER_ACCENTS.length]
      })
    }
  }
  return blocks
}

function buildInitialCalendarDays(cursor: MonthCursor): CalendarDay[] {
  const first = buildMonthGrid(cursor)
  const last = first.at(-1)
  if (!last) {
    return first
  }
  return [...first, ...buildCalendarDays(addDays(last.date, 1), 14, cursor)]
}

function classNames(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(' ')
}

function stageForDate(date: LocalDate, schedules: ReturnType<typeof deriveSchedules>) {
  return schedules.find((stage) => isDateInRange(date, stage.start, stage.end)) ?? null
}

function resolveDateFromPointer(event: PointerEvent): LocalDate | null {
  const pointTarget = typeof document.elementFromPoint === 'function'
    ? document.elementFromPoint(event.clientX, event.clientY)
    : null
  const eventTarget = event.target instanceof Element ? event.target : null
  const dateTarget = pointTarget?.closest('[data-date]') ?? eventTarget?.closest('[data-date]')
  const date = dateTarget?.getAttribute('data-date')
  return date ? date as LocalDate : null
}

interface DragState {
  index: number
  pointerId: number
  targetDate: LocalDate | null
  draftDate: LocalDate | null
}

/* ===== REQ-040:接入 Audax =====
   交互一行没改 —— 下面这组 props 全是可选的,一个都不传时行为与独立版
   逐字一致(这也是为什么原来的用法 <CalendarPlanner /> 还能直接跑)。
   传了就把「本地状态 + localStorage 存档」换成「读写项目数据」:
     initial*   打开排期页时从项目带进来的 boundaries / 阶段 / 每阶段备注
     onSave     Confirm 或手动保存时写回项目
     archives / onArchivesChange  存档升级成项目级版本,不再进浏览器本地
   备注是本次新增的字段,挂在阶段上,跟排期一起存。 */
export interface CalendarPlannerProps {
  initialStages?: StageDefinition[]
  initialBoundaries?: LocalDate[]
  initialNotes?: Record<string, string>
  archives?: ScheduleArchive[]
  onArchivesChange?: (next: ScheduleArchive[]) => void
  onSave?: (payload: {
    stages: StageDefinition[]
    boundaries: LocalDate[]
    notes: Record<string, string>
  }) => void | Promise<void>
  saveLabel?: string
  busy?: boolean
}

export function CalendarPlanner({
  initialStages,
  initialBoundaries,
  initialNotes,
  archives: archivesProp,
  onArchivesChange,
  onSave,
  saveLabel,
  busy,
}: CalendarPlannerProps = {}) {
  const { lang, t } = useLang()
  const initialCursorRef = useRef<MonthCursor>(monthFromDate(todayLocalDate()))
  const initialCursor = initialCursorRef.current
  const [stages, setStages] = useState<StageDefinition[]>(
    () => (initialStages && initialStages.length ? initialStages.map((stage) => ({ ...stage })) : STAGES.map((stage) => ({ ...stage })))
  )
  const [boundaries, setBoundaries] = useState<LocalDate[]>(() => (initialBoundaries ? initialBoundaries.slice() : []))
  /* REQ-040: 每阶段备注(stageId → 文字),跟排期一起存回项目 */
  const [notes, setNotes] = useState<Record<string, string>>(() => ({ ...(initialNotes || {}) }))
  const [saving, setSaving] = useState(false)
  const [excludeHolidays, setExcludeHolidays] = useState(true)
  const [reverseOpen, setReverseOpen] = useState(false)
  const [reverseStart, setReverseStart] = useState('')
  const [reverseDeadline, setReverseDeadline] = useState('')
  const [reversePickTarget, setReversePickTarget] = useState<'start' | 'deadline' | null>(null)
  const [reverseError, setReverseError] = useState<string | null>(null)
  const [cursor, setCursor] = useState<MonthCursor>(initialCursor)
  // 首屏铺满 8 个可见行（6 周标准块 + 2 周），免得一进来就有两行空白
  const [calendarDays, setCalendarDays] = useState<CalendarDay[]>(() => buildInitialCalendarDays(initialCursor))
  const [hoverDate, setHoverDate] = useState<LocalDate | null>(null)
  const [isDone, setIsDone] = useState(false)
  const [drag, setDrag] = useState<DragState | null>(null)
  /* 接了后端就用项目级存档,没接才回落到 localStorage(独立版的老行为) */
  const [localArchives, setLocalArchives] = useState<ScheduleArchive[]>(() => (archivesProp ? [] : loadArchives()))
  const archives = archivesProp ?? localArchives
  const setArchives = (updater: (cur: ScheduleArchive[]) => ScheduleArchive[]) => {
    const next = updater(archives)
    if (onArchivesChange) onArchivesChange(next)
    else { setLocalArchives(next); persistArchives(next) }
  }
  const [archiveName, setArchiveName] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [exportMeta, setExportMeta] = useState<PrintScheduleMeta>({
    title: '',
    client: '',
    services: '',
    note: DEFAULT_EXPORT_NOTE
  })
  /* 外面换了项目(或别人改了排期后刷新),把带进来的数据同步到本地状态。
     只在「传进来的东西真的变了」时跑,免得把用户正在拖的边界打回去。 */
  const syncKey = JSON.stringify([initialBoundaries, initialStages?.map((x) => x.id + x.name), initialNotes])
  const lastSync = useRef(syncKey)
  useEffect(() => {
    if (lastSync.current === syncKey) return
    lastSync.current = syncKey
    if (initialStages && initialStages.length) setStages(initialStages.map((x) => ({ ...x })))
    if (initialBoundaries) setBoundaries(initialBoundaries.slice())
    setNotes({ ...(initialNotes || {}) })
  }, [syncKey, initialStages, initialBoundaries, initialNotes])

  const calendarGridRef = useRef<HTMLDivElement>(null)
  const pendingBoundaryFocus = useRef<number | null>(null)
  const wheelLockUntil = useRef(0)
  const pendingScrollAdjustment = useRef(0)
  const pendingScrollAfterAppend = useRef(0)
  const lastScrollTop = useRef(0)

  const days = useMemo(() => calendarDays.map((day) => {
    const dayMonth = monthFromDate(day.date)
    return {
      ...day,
      isCurrentMonth: dayMonth.year === cursor.year && dayMonth.month === cursor.month
    }
  }), [calendarDays, cursor])
  const weeks = useMemo(() => {
    const result: CalendarDay[][] = []
    for (let offset = 0; offset < days.length; offset += 7) {
      result.push(days.slice(offset, offset + 7))
    }
    return result
  }, [days])
  const gutterBlocks = useMemo(() => buildGutterBlocks(weeks), [weeks])
  const stageCount = stages.length
  const activeBoundaryIndex = boundaries.length < stageCount + 1 ? boundaries.length : null
  const activeStageIndex = boundaries.length === 0
    ? 0
    : boundaries.length < stageCount + 1
      ? boundaries.length - 1
      : null
  const selectionPreviewBoundaries = !reverseOpen && activeBoundaryIndex !== null && !drag && hoverDate
    ? replaceBoundary(boundaries, activeBoundaryIndex, hoverDate, stageCount)
    : null
  const dragPreviewBoundaries = drag?.draftDate
    ? replaceBoundary(boundaries, drag.index, drag.draftDate, stageCount)
    : null
  const isPreview = Boolean(selectionPreviewBoundaries || dragPreviewBoundaries)
  const displayBoundaries = dragPreviewBoundaries ?? selectionPreviewBoundaries ?? boundaries
  // 正在预览的阶段（悬停选日期 / 拖边界点）：色带用虚线区别于已定稿
  const previewStageIndex = drag
    ? Math.max(0, drag.index - 1)
    : selectionPreviewBoundaries && activeBoundaryIndex !== null
      ? Math.max(0, activeBoundaryIndex - 1)
      : null
  const schedules = useMemo(() => deriveSchedules(displayBoundaries, stages).map((stage) => ({
    ...stage,
    duration: stage.start && stage.end
      ? calculateDuration(stage.start, stage.end, excludeHolidays)
      : null
  })), [displayBoundaries, stages, excludeHolidays])
  const canComplete = boundaries.length === stageCount + 1

  useLayoutEffect(() => {
    if (pendingBoundaryFocus.current === null) {
      return
    }

    const index = pendingBoundaryFocus.current
    const handle = document.querySelector<HTMLButtonElement>(`[data-testid="boundary-handle-${index}"]`)
    if (handle) {
      handle.focus()
      pendingBoundaryFocus.current = null
    }
  }, [boundaries, cursor])

  useLayoutEffect(() => {
    if (pendingScrollAdjustment.current === 0 && pendingScrollAfterAppend.current === 0) {
      return
    }

    const grid = calendarGridRef.current
    if (grid) {
      if (pendingScrollAdjustment.current > 0) {
        grid.scrollTop += pendingScrollAdjustment.current
      }
      if (pendingScrollAfterAppend.current > 0) {
        grid.scrollTop = Math.min(
          grid.scrollHeight - grid.clientHeight,
          grid.scrollTop + pendingScrollAfterAppend.current
        )
      }
      lastScrollTop.current = grid.scrollTop
    }
    pendingScrollAdjustment.current = 0
    pendingScrollAfterAppend.current = 0
  }, [calendarDays.length])

  useEffect(() => {
    const grid = calendarGridRef.current
    if (!grid) {
      return
    }

    const handleWheel = (event: WheelEvent) => handleCalendarWheel(event)
    grid.addEventListener('wheel', handleWheel, { passive: false })
    return () => grid.removeEventListener('wheel', handleWheel)
  }, [calendarDays.length, cursor])

  function handleDateClick(date: LocalDate) {
    if (reverseOpen) {
      if (reversePickTarget === 'start') {
        setReverseStart(date)
        setReversePickTarget('deadline')
      } else if (reversePickTarget === 'deadline') {
        setReverseDeadline(date)
        setReversePickTarget(null)
      }
      setReverseError(null)
      return
    }

    if (activeBoundaryIndex === null) {
      return
    }

    const next = replaceBoundary(boundaries, activeBoundaryIndex, date, stageCount)
    if (!next) {
      return
    }

    setBoundaries(next)
    setHoverDate(null)
    setIsDone(false)
  }

  function handleReset() {
    setBoundaries([])
    setHoverDate(null)
    setDrag(null)
    setIsDone(false)
    setNotice(null)
  }

  function handleToggleReversePlan() {
    if (reverseOpen) {
      setReverseOpen(false)
      setReverseStart('')
      setReverseDeadline('')
      setReversePickTarget(null)
    } else {
      setReverseStart(boundaries[0] ?? '')
      setReverseDeadline(canComplete ? boundaries[stageCount] : '')
      setReversePickTarget('start')
      setReverseOpen(true)
      setHoverDate(null)
      setDrag(null)
    }
    setReverseError(null)
  }

  function handleApplyReversePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!reverseStart || !reverseDeadline) {
      setReverseError('Enter both dates.')
      return
    }

    let next: LocalDate[] | null = null
    try {
      next = distributeStagesEvenly(reverseStart as LocalDate, reverseDeadline as LocalDate, stageCount)
    } catch {
      setReverseError('Enter valid dates.')
      return
    }
    if (!next) {
      setReverseError(`Allow at least ${stageCount} calendar days for ${stageCount} stages.`)
      return
    }

    const startCursor = monthFromDate(next[0])
    setBoundaries(next)
    setCursor(startCursor)
    setCalendarDays(buildInitialCalendarDays(startCursor))
    setReverseOpen(false)
    setReversePickTarget(null)
    setReverseError(null)
    setHoverDate(null)
    setDrag(null)
    setIsDone(false)
    setNotice(null)
    requestAnimationFrame(() => {
      const grid = calendarGridRef.current
      if (grid) {
        grid.scrollTop = 0
        lastScrollTop.current = 0
      }
    })
  }

  function handleHover(date: LocalDate) {
    if (reverseOpen || activeBoundaryIndex === null) {
      return
    }

    setHoverDate(date)
  }

  function handleRenameStage(index: number, name: string) {
    const nextName = name.slice(0, 60)
    setStages((current) => current.map((stage, position) => {
      if (position !== index) return stage
      /* 改过名就把出厂英文位丢掉:用户自己写的名字是内容,拿一句出厂英文
         当它的翻译只会驴唇不对马嘴。丢掉之后两种语言显示同一个名字。 */
      const { nameEn: _drop, ...rest } = stage
      return { ...rest, name: nextName }
    }))
    setIsDone(false)
  }

  function handleAddStage() {
    setStages((current) => {
      if (current.length >= MAX_STAGES) {
        return current
      }
      return [...current, createStage(t(`新阶段 ${current.length + 1}`, `New stage ${current.length + 1}`), current.length)]
    })
    setIsDone(false)
    setNotice(null)
  }

  function handleRemoveStage(index: number) {
    setStages((current) => {
      if (current.length <= 1 || index < 0 || index >= current.length) {
        return current
      }
      return current.filter((_, position) => position !== index)
    })
    setBoundaries((current) => boundariesAfterStageRemoval(current, index))
    setHoverDate(null)
    setDrag(null)
    setIsDone(false)
  }

  function handleRestoreStages() {
    setStages(STAGES.map((stage) => ({ ...stage })))
    setBoundaries((current) => current.slice(0, STAGES.length + 1))
    setHoverDate(null)
    setDrag(null)
    setIsDone(false)
    setNotice(t('已恢复默认 6 阶段。', 'Restored the default 6 stages.'))
  }

  function handleMoveStage(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) {
      return
    }
    setStages((current) => {
      if (fromIndex < 0 || fromIndex >= current.length || toIndex < 0 || toIndex >= current.length) {
        return current
      }
      const next = current.slice()
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
    setHoverDate(null)
    setDrag(null)
    setIsDone(false)
    setNotice(null)
  }

  function handleSaveArchive() {
    const archive = buildArchive(archiveName, stages, boundaries)
    setArchives((current) => [archive, ...current].slice(0, 30))
    setArchiveName('')
    setNotice(t(`已保存存档「${archive.name}」。`, `Saved version “${archive.name}”.`))
  }

  function handleLoadArchive(id: string) {
    const archive = archives.find((entry) => entry.id === id)
    if (!archive) {
      return
    }
    setStages(archive.stages.map((stage) => ({ ...stage })))
    setBoundaries(archive.boundaries.slice())
    setHoverDate(null)
    setDrag(null)
    setIsDone(false)
    const first = archive.boundaries[0]
    if (first) {
      setCursor(monthFromDate(first))
    }
    setNotice(t(`已读档「${archive.name}」。`, `Restored version “${archive.name}”.`))
  }

  function handleDeleteArchive(id: string) {
    setArchives((current) => current.filter((entry) => entry.id !== id))
    setNotice(t('已删除存档。', 'Version deleted.'))
  }

  function handleExportPdf() {
    setNotice(null)
    if (typeof window !== 'undefined' && typeof window.print === 'function') {
      window.print()
    }
  }

  function handleCalendarWheel(event: WheelEvent) {
    const now = Date.now()
    if (now < wheelLockUntil.current || Math.abs(event.deltaY) < 2) {
      return
    }

    event.preventDefault()
    wheelLockUntil.current = now + 180

    const grid = calendarGridRef.current
    if (!grid) {
      return
    }

    const direction = event.deltaY > 0 ? 1 : -1
    const maxScroll = Math.max(0, grid.scrollHeight - grid.clientHeight)
    const rowStep = Math.max(1, grid.clientHeight / CALENDAR_VISIBLE_ROWS)
    const atStart = grid.scrollTop <= 1
    const atEnd = grid.scrollTop >= maxScroll - 1

    if (direction > 0 && atEnd) {
      pendingScrollAfterAppend.current = rowStep
      appendCalendarRows()
    } else if (direction < 0 && atStart) {
      // 前追加固定 42 格（6 整行），滚动补偿同样按 6 行算，视图不跳
      pendingScrollAdjustment.current = rowStep * 6
      prependCalendarRows()
    } else {
      const nextScrollTop = Math.min(maxScroll, Math.max(0, grid.scrollTop + direction * rowStep))
      grid.scrollTop = nextScrollTop
    }

    setHoverDate(null)
  }

  function appendCalendarRows() {
    setCalendarDays((current) => {
      const lastDay = current.at(-1)
      if (!lastDay) {
        pendingScrollAfterAppend.current = 0
        return current
      }

      return [...current, ...buildCalendarDays(addDays(lastDay.date, 1), 42, cursor)]
    })
  }

  function prependCalendarRows() {
    setCalendarDays((current) => {
      const firstDay = current[0]
      if (!firstDay) {
        pendingScrollAdjustment.current = 0
        return current
      }

      return [
        ...buildCalendarDays(addDays(firstDay.date, -42), 42, cursor),
        ...current
      ]
    })
  }

  function handleCalendarScroll(event: ReactUIEvent<HTMLDivElement>) {
    const grid = event.currentTarget
    const rowHeight = Math.max(1, grid.clientHeight / CALENDAR_VISIBLE_ROWS)
    const currentScrollTop = grid.scrollTop
    const movingDown = currentScrollTop > lastScrollTop.current + 1
    const movingUp = currentScrollTop < lastScrollTop.current - 1
    lastScrollTop.current = currentScrollTop

    // 8 行视口很深，中线经常落在下月；改用首个完整可见周的周四
    // （周四必定落在该周天数占多数的月份），月份跟随才不飘。
    const weekCount = Math.max(1, Math.floor(days.length / 7))
    const firstVisibleRow = Math.floor(currentScrollTop / rowHeight)
    const referenceRow = Math.min(firstVisibleRow + 1, weekCount - 1)
    const referenceDay = days[referenceRow * 7 + 3] ?? days[referenceRow * 7]
    if (referenceDay) {
      const nextCursor = monthFromDate(referenceDay.date)
      setCursor((current) => current.year === nextCursor.year && current.month === nextCursor.month
        ? current
        : nextCursor)
    }

    const maxScroll = Math.max(0, grid.scrollHeight - grid.clientHeight)
    const nearEnd = maxScroll - currentScrollTop <= rowHeight * 2
    const nearStart = currentScrollTop <= rowHeight * 2

    if (movingDown && nearEnd && pendingScrollAfterAppend.current === 0) {
      appendCalendarRows()
    }

    if (movingUp && nearStart && pendingScrollAdjustment.current === 0) {
      pendingScrollAdjustment.current = rowHeight * 6
      prependCalendarRows()
    }
  }

  function handleToday() {
    const today = todayLocalDate()
    const todayCursor = monthFromDate(today)
    const nextDays = buildInitialCalendarDays(todayCursor)

    setCursor(todayCursor)
    setCalendarDays(nextDays)
    setHoverDate(null)
    setDrag(null)

    // The grid is rebuilt around the current month so the button also works
    // after the user has scrolled through many appended calendar rows.
    requestAnimationFrame(() => {
      const grid = calendarGridRef.current
      if (!grid) {
        return
      }

      const todayIndex = nextDays.findIndex((day) => day.date === today)
      const rowHeight = Math.max(1, grid.clientHeight / CALENDAR_VISIBLE_ROWS)
      const todayRow = todayIndex >= 0 ? Math.floor(todayIndex / 7) : 0
      grid.scrollTop = Math.max(0, (todayRow - 1) * rowHeight)
      lastScrollTop.current = grid.scrollTop
    })
  }

  function keepDateVisible(date: LocalDate) {
    const selectedMonth = monthFromDate(date)
    if (selectedMonth.year !== cursor.year || selectedMonth.month !== cursor.month) {
      setCursor(selectedMonth)
    }
  }

  function handleBoundaryKeyDown(index: number, event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return
    }

    event.preventDefault()
    const current = boundaries[index]
    if (!current) {
      return
    }

    const candidate = addDays(current, event.key === 'ArrowLeft' ? -1 : 1)
    const next = replaceBoundary(boundaries, index, candidate, stageCount)
    if (!next) {
      return
    }

    pendingBoundaryFocus.current = index
    setBoundaries(next)
    setIsDone(false)
    keepDateVisible(candidate)
  }

  function handleBoundaryPointerDown(index: number, event: ReactPointerEvent<HTMLButtonElement>) {
    if (activeBoundaryIndex !== null || !boundaries[index]) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setHoverDate(null)
    setDrag({
      index,
      pointerId: event.pointerId,
      targetDate: boundaries[index],
      draftDate: boundaries[index]
    })
  }

  useEffect(() => {
    if (!drag) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId) {
        return
      }

      const candidate = resolveDateFromPointer(event)
      const valid = candidate ? replaceBoundary(boundaries, drag.index, candidate, stageCount) : null
      setDrag((current) => current && current.pointerId === event.pointerId
        ? { ...current, targetDate: candidate, draftDate: valid ? candidate : null }
        : current)
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId) {
        return
      }

      const candidate = resolveDateFromPointer(event)
      const next = candidate ? replaceBoundary(boundaries, drag.index, candidate, stageCount) : null
      if (next) {
        setBoundaries(next)
        setIsDone(false)
        keepDateVisible(candidate!)
      }
      setDrag(null)
      setHoverDate(null)
    }

    const handlePointerCancel = (event: PointerEvent) => {
      if (event.pointerId === drag.pointerId) {
        setDrag(null)
        setHoverDate(null)
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
    }
  }, [boundaries, cursor, drag, stageCount])

  return (
    <div className="planner-shell">
      <div className="planner-layout">
        <section className="calendar-card" aria-label="Project calendar">
          <h2 className="sr-only" data-testid="calendar-month-heading">{formatMonthHeading(cursor)}</h2>
          <div className="calendar-instruction" aria-live="polite">
            <span className="instruction-dot" aria-hidden="true" />
            <span className="instruction-text">{reverseOpen
              ? reversePickTarget === 'start'
                ? 'Select Project start on the calendar.'
                : reversePickTarget === 'deadline'
                  ? 'Select Deadline on the calendar.'
                  : 'Click Apply to generate the schedule.'
              : drag?.targetDate && !drag.draftDate
              ? 'This date would make a stage shorter than one day.'
              : activeStageIndex === null
                ? `${stageCount + 1} boundary points are set. Adjust as needed.`
              : activeStageIndex === 0 && boundaries.length === 0
                ? 'Select a date to start the project.'
                : `Select the end date for Stage ${activeStageIndex + 1}.`}</span>
            <div className="calendar-instruction-actions">
              {isPreview && <span className="instruction-preview">PREVIEW</span>}
              {activeBoundaryIndex === null && <span className="adjust-mode-chip" data-testid="adjust-mode">ADJUST MODE</span>}
              <button
                aria-expanded={reverseOpen}
                className="today-button"
                onClick={handleToggleReversePlan}
                type="button"
              >
                Reverse plan
              </button>
              <button className="today-button" data-testid="today-button" onClick={handleToday} type="button">
                Today
              </button>
              <label className="holiday-toggle">
                <input
                  checked={excludeHolidays}
                  data-testid="exclude-holidays-toggle"
                  onChange={(event) => setExcludeHolidays(event.target.checked)}
                  type="checkbox"
                />
                <span>Exclude Holidays</span>
              </label>
            </div>
          </div>
          {reverseOpen && (
            <form className="reverse-plan-form" onSubmit={handleApplyReversePlan}>
              <label className={reversePickTarget === 'start' ? 'reverse-date-active' : undefined}>
                <span>Project start</span>
                <input
                  aria-invalid={reverseError ? true : undefined}
                  onChange={(event) => {
                    setReverseStart(event.target.value)
                    setReversePickTarget('deadline')
                    setReverseError(null)
                  }}
                  onFocus={() => setReversePickTarget('start')}
                  type="date"
                  value={reverseStart}
                />
              </label>
              <label className={reversePickTarget === 'deadline' ? 'reverse-date-active' : undefined}>
                <span>Deadline</span>
                <input
                  aria-invalid={reverseError ? true : undefined}
                  onChange={(event) => {
                    setReverseDeadline(event.target.value)
                    setReversePickTarget(null)
                    setReverseError(null)
                  }}
                  onFocus={() => setReversePickTarget('deadline')}
                  type="date"
                  value={reverseDeadline}
                />
              </label>
              <button className="reverse-plan-apply" type="submit">Apply</button>
              {reverseError && <p className="reverse-plan-error" role="alert">{reverseError}</p>}
            </form>
          )}
          {notice && (
            <div className="calendar-notice" data-testid="planner-notice" role="status">
              {notice}
            </div>
          )}

          <div className="weekday-row" aria-hidden="true">
            <div className="weekday-corner" />
            {WEEKDAYS.map((weekday, index) => <span className={index > 4 ? 'weekday-weekend' : undefined} key={weekday}>{weekday}</span>)}
          </div>

          <div className="calendar-scroll-frame">
            <div ref={calendarGridRef} className="calendar-grid" onScroll={handleCalendarScroll} role="grid" aria-label={`${formatMonthHeading(cursor)} calendar`}>
              {weeks.map((weekDays, weekIndex) => {
                const gutter = gutterBlocks.find((block) => block.startWeek === weekIndex)
                return (
                  <Fragment key={weekDays[0]?.date ?? `week-${weekIndex}`}>
                    {gutter && (
                      <div
                        aria-hidden="true"
                        className="month-gutter"
                        data-testid={`month-gutter-${gutter.key}`}
                        style={{
                          gridRow: `${weekIndex + 1} / span ${gutter.length}`,
                          borderLeftColor: gutter.accent
                        }}
                      >
                        <span className="month-gutter-mon">{gutter.monthLabel}</span>
                        <span className="month-gutter-year">{gutter.year}</span>
                      </div>
                    )}
                    {weekDays.map((day) => renderCalendarDay({
                      day,
                      lang,
                      gridRow: weekIndex + 1,
                      schedules,
                      displayBoundaries,
                      activeBoundaryIndex,
                      isAdjusting: activeBoundaryIndex === null && !reverseOpen,
                      reverseStart: reverseOpen ? reverseStart : '',
                      reverseDeadline: reverseOpen ? reverseDeadline : '',
                      dragTarget: drag?.targetDate ?? null,
                      dragDate: drag?.draftDate ?? null,
                      previewStageIndex,
                      stageCount,
                      onClick: handleDateClick,
                      onHover: handleHover,
                      onLeave: () => setHoverDate(null),
                      onBoundaryKeyDown: handleBoundaryKeyDown,
                      onBoundaryPointerDown: handleBoundaryPointerDown
                    }))}
                  </Fragment>
                )
              })}
            </div>
          </div>

          <div className="calendar-legend" aria-label="Calendar legend">
            <span><i className="legend-dot legend-dot-boundary" />Stage boundary</span>
            <span><i className="legend-dot legend-dot-today" />Today</span>
            <span><i className="legend-dot legend-dot-holiday" />Public holiday (SG)</span>
            {isPreview && <span><i className="legend-dot legend-dot-preview" />Preview</span>}
          </div>
        </section>

        <div className="planner-side">
          <StagePanel
            activeIndex={activeStageIndex}
            canComplete={canComplete}
            excludeHolidays={excludeHolidays}
            isDone={isDone}
            isPreview={isPreview}
            onAddStage={handleAddStage}
            onDone={() => setIsDone(true)}
            onMoveStage={handleMoveStage}
            onRemoveStage={handleRemoveStage}
            onRenameStage={handleRenameStage}
            onReset={handleReset}
            onRestoreStages={handleRestoreStages}
            notes={notes}
            onNoteChange={onSave ? (stageId, note) => setNotes((cur) => ({ ...cur, [stageId]: note })) : undefined}
            onSave={onSave ? async () => {
              setSaving(true)
              try { await onSave({ stages, boundaries, notes }) } finally { setSaving(false) }
            } : undefined}
            saveLabel={saveLabel}
            saving={saving || busy}
            schedules={schedules}
          />
          <ArchivePanel
            archives={archives}
            canSave={boundaries.length > 0}
            draftName={archiveName}
            onDelete={handleDeleteArchive}
            onDraftNameChange={setArchiveName}
            onLoad={handleLoadArchive}
            onSave={handleSaveArchive}
          />
          <ExportPanel
            meta={exportMeta}
            onExportPdf={handleExportPdf}
            onMetaChange={(patch) => setExportMeta((current) => ({ ...current, ...patch }))}
          />
        </div>
      </div>
      <PrintSchedule meta={exportMeta} schedules={schedules} />
    </div>
  )
}

interface CalendarDayProps {
  day: CalendarDay
  /* 阶段名要按语言显示,而这是个普通函数不是组件,用不了 hook —— 传进来 */
  lang: 'zh' | 'en'
  gridRow: number
  schedules: ReturnType<typeof deriveSchedules>
  displayBoundaries: readonly LocalDate[]
  activeBoundaryIndex: number | null
  isAdjusting: boolean
  reverseStart: string
  reverseDeadline: string
  dragTarget: LocalDate | null
  dragDate: LocalDate | null
  previewStageIndex: number | null
  stageCount: number
  onClick: (date: LocalDate) => void
  onHover: (date: LocalDate) => void
  onLeave: () => void
  onBoundaryKeyDown: (index: number, event: ReactKeyboardEvent<HTMLButtonElement>) => void
  onBoundaryPointerDown: (index: number, event: ReactPointerEvent<HTMLButtonElement>) => void
}

function renderCalendarDay({
  day,
  lang,
  gridRow,
  schedules,
  displayBoundaries,
  activeBoundaryIndex,
  isAdjusting,
  reverseStart,
  reverseDeadline,
  dragTarget,
  dragDate,
  previewStageIndex,
  stageCount,
  onClick,
  onHover,
  onLeave,
  onBoundaryKeyDown,
  onBoundaryPointerDown
}: CalendarDayProps) {
  const stage = stageForDate(day.date, schedules)
  const markers = schedules.flatMap((schedule) => {
    const stageMarkers: Array<{ date: LocalDate; boundaryIndex: number | null; label: string; type: 'start' | 'end' }> = []
    if (schedule.start) {
      stageMarkers.push({
        date: schedule.start,
        boundaryIndex: schedule.index === 0 ? 0 : null,
        label: `Stage ${String(schedule.index + 1).padStart(2, '0')} start`,
        type: 'start'
      })
    }
    if (schedule.end) {
      stageMarkers.push({
        date: schedule.end,
        boundaryIndex: schedule.index + 1,
        label: `Stage ${String(schedule.index + 1).padStart(2, '0')} end`,
        type: 'end'
      })
    }
    return stageMarkers
  }).filter((marker) => marker.date === day.date)
  const adjustableMarkers = markers.filter(
    (marker): marker is typeof marker & { boundaryIndex: number } => marker.boundaryIndex !== null
  )
  const boundaryIndices = adjustableMarkers.map((marker) => marker.boundaryIndex)
  const boundaryIndex = boundaryIndices[0] ?? null
  const isPreviewBoundary = boundaryIndex !== null && boundaryIndex === activeBoundaryIndex
  const isDragDate = dragDate === day.date
  const isInvalidDragTarget = dragTarget === day.date && dragDate !== day.date
  const holidayName = getPublicHoliday(day.date)
  const dateLabel = `${formatDisplayDate(day.date)}${day.isToday ? ' (today)' : ''}${!day.isCurrentMonth ? ' (outside current month)' : ''}${holidayName ? ` (SG public holiday: ${holidayName})` : ''}`
  const isSingleDayStage = stage?.start === day.date && stage.end === day.date

  return (
    <div
      className={classNames(
        'calendar-cell',
        !day.isCurrentMonth && 'calendar-cell-outside',
        day.isToday && 'calendar-cell-today',
        day.column > 4 && 'calendar-cell-weekend',
        holidayName && 'calendar-cell-holiday',
        reverseStart === day.date && 'calendar-cell-reverse-start',
        reverseDeadline === day.date && 'calendar-cell-reverse-deadline',
        stage && `calendar-cell-stage-${stage.tone}`,
        markers.length > 0 && 'calendar-cell-boundary',
        isDragDate && 'calendar-cell-drag-preview',
        isInvalidDragTarget && 'calendar-cell-drag-invalid'
      )}
      data-date={day.date}
      key={day.date}
      style={{ gridRow }}
      role="gridcell"
    >
      {stage && (
        <span
          aria-hidden="true"
          className={classNames(
            'stage-band',
            `stage-band-${stage.tone}`,
            boundaryIndex !== null && 'stage-band-boundary',
            isDragDate && 'stage-band-preview',
            previewStageIndex === stage.index && 'stage-band-preview',
            stage.start === day.date && 'stage-band-start',
            isSingleDayStage && 'stage-band-single-day'
          )}
          data-stage-band={stage.index}
        >
          {stage.start === day.date && stage.duration !== null && (
            <span
              className="stage-band-label"
              style={{ maxWidth: !isSingleDayStage && stage.end
                ? `min(560px, calc(${Math.min(7 - day.column, inclusiveDays(day.date, stage.end)) * 100}% - 16px))`
                : undefined }}
              title={stageName(stage, lang)}
            >
              {isSingleDayStage ? (
                <>
                  <span className="stage-band-single-meta">
                    {String(stage.index + 1).padStart(2, '0')} · {formatDuration(stage.duration)}
                  </span>
                  <span className="stage-band-single-name">{stageName(stage, lang)}</span>
                </>
              ) : (
                <>{String(stage.index + 1).padStart(2, '0')} · {stageName(stage, lang)} · {formatDuration(stage.duration)}</>
              )}
            </span>
          )}
        </span>
      )}
      <button
        aria-label={`${dateLabel}${reverseStart === day.date ? ' (reverse plan start)' : ''}${reverseDeadline === day.date ? ' (reverse plan deadline)' : ''}`}
        className={classNames('date-button', isPreviewBoundary && 'date-button-preview')}
        data-date={day.date}
        data-testid={`date-cell-${day.date}`}
        onClick={() => onClick(day.date)}
        onFocus={() => onHover(day.date)}
        onMouseEnter={() => onHover(day.date)}
        onMouseLeave={onLeave}
        type="button"
      >
        <span className="date-number">
          {day.day === 1 ? <><span className="date-month-label">{formatMonthShort(day.date)}</span> 1</> : day.day}
        </span>
        {holidayName && (
          <span className="holiday-label" data-testid={`holiday-label-${day.date}`} title={holidayName}>
            {holidayName}
          </span>
        )}
      </button>
      {adjustableMarkers.map((marker, stackPosition) => {
        const stackedNodeStyle = isSingleDayStage
          ? { top: `${4 + stackPosition * 15}px`, left: 'auto', right: '6px', transform: 'none' }
          : adjustableMarkers.length > 1
            ? { top: `${37 + stackPosition * 16}px` }
            : undefined
        const nodeClassName = classNames(
          'boundary-node',
          marker.type === 'start' && 'boundary-node-start',
          marker.type === 'end' && 'boundary-node-end',
          isSingleDayStage && 'boundary-node-single-day',
          marker.boundaryIndex !== null && isPreviewBoundary && 'boundary-node-preview',
          marker.boundaryIndex !== null && isAdjusting && 'boundary-node-handle',
          isDragDate && 'boundary-node-dragging'
        )
        const nodeLabel = `${marker.label}, ${formatDisplayDate(day.date)}`
        if (!isAdjusting) {
          return null
        }

        return (
          <button
            aria-label={`Adjust ${nodeLabel}`}
            className={nodeClassName}
            data-boundary-index={marker.boundaryIndex}
            data-date={day.date}
            data-testid={`boundary-handle-${marker.boundaryIndex}`}
            key={`${marker.label}-${marker.date}`}
            onKeyDown={(event) => onBoundaryKeyDown(marker.boundaryIndex, event)}
            onPointerDown={(event) => onBoundaryPointerDown(marker.boundaryIndex, event)}
            style={stackedNodeStyle}
            type="button"
          >
            <span className="boundary-dot" aria-hidden="true" />
            {(marker.boundaryIndex === 0 || marker.boundaryIndex === stageCount) && (
              <span className="boundary-label">{marker.boundaryIndex === 0 ? 'START' : 'END'}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default CalendarPlanner
