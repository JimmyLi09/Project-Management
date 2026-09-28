import { formatExportDate, todayLocalDate } from '../domain/calendar'
import { formatDuration } from '../domain/duration'
import {
  compareDates,
  type LocalDate,
  stageName,
  type StageSchedule,
  stageStatus
} from '../domain/schedule'
import { useLang } from '@/lib/i18n'

export interface PrintScheduleMeta {
  title: string
  client: string
  services: string
  note: string
}

export const DEFAULT_EXPORT_NOTE =
  'Note: Incomplete information may affect the delivery schedule; repeated revisions after confirmation may incur additional charges.'

export interface PrintScheduleProps {
  meta: PrintScheduleMeta
  schedules: readonly StageSchedule[]
}

function projectStatus(
  start: LocalDate | null,
  end: LocalDate | null,
  today: LocalDate
): string {
  if (!start || !end) {
    return 'Not started'
  }
  if (compareDates(today, end) > 0) {
    return 'Done'
  }
  if (compareDates(today, start) >= 0) {
    return 'In progress'
  }
  return 'Not started'
}

function formatPrintDuration(duration: number): string {
  const compact = formatDuration(duration)
  if (compact === '—') {
    return compact
  }
  const value = compact.slice(0, -1)
  const unit = compact.endsWith('w') ? 'week' : 'day'
  return `${value} ${unit}${value === '1' ? '' : 's'}`
}

export function PrintSchedule({ meta, schedules }: PrintScheduleProps) {
  const { lang, t } = useLang()
  const today = todayLocalDate()
  const title = meta.title.trim() || t('项目排期', 'Production schedule')
  const projectStart = schedules[0]?.start ?? null
  const projectEnd = schedules.at(-1)?.end ?? null
  const subtitleParts = [
    meta.client.trim() ? `Client: ${meta.client.trim()}` : null,
    meta.services.trim() ? `Services: ${meta.services.trim()}` : null,
    `Stage: ${projectStatus(projectStart, projectEnd, today)}`
  ].filter((part): part is string => part !== null)
  const sectionTitle = meta.services.trim()
    ? `${meta.services.trim()} — Production Schedule`
    : 'Production Schedule'

  return (
    <div className="print-schedule" data-testid="print-schedule" aria-hidden="true">
      <h1 className="print-title">{title}</h1>
      <p className="print-subtitle">{subtitleParts.join(' · ')}</p>

      <h2 className="print-section">{sectionTitle}</h2>
      <table className="print-table">
        <thead>
          <tr>
            <th className="print-col-index">#</th>
            <th>Phase / Task</th>
            <th className="print-col-date">Start</th>
            <th className="print-col-date">Due</th>
            <th className="print-col-duration">Duration</th>
            <th className="print-col-status">Status</th>
          </tr>
        </thead>
        <tbody>
          {schedules.map((stage) => (
            <tr key={stage.id} data-testid={`print-row-${stage.index}`}>
              <td>{stage.index}</td>
              <td>{stageName(stage, lang)}</td>
              <td>{stage.start ? formatExportDate(stage.start) : '—'}</td>
              <td>{stage.end ? formatExportDate(stage.end) : '—'}</td>
              <td>{stage.duration !== null ? formatPrintDuration(stage.duration) : '—'}</td>
              <td>{stageStatus(stage, today)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {meta.note.trim() && (
        <p className="print-note" data-testid="print-note">{meta.note.trim()}</p>
      )}

      <p className="print-footer" data-testid="print-footer">
        Audax Visuals · Exported {formatExportDate(today)}
      </p>
    </div>
  )
}
