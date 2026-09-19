import { Fragment, useState } from 'react'

import { formatDisplayDate, formatRangeParts } from '../domain/calendar'
import { calculateDuration, formatDuration } from '../domain/duration'
import { MAX_STAGES, MIN_STAGES, type StageSchedule } from '../domain/schedule'
import { useLang } from '@/lib/i18n'

export interface StagePanelProps {
  schedules: readonly StageSchedule[]
  /* REQ-040: 每阶段备注 + 存回项目。两个都可选 —— 独立版不传就跟以前一样。 */
  notes?: Record<string, string>
  onNoteChange?: (stageId: string, note: string) => void
  onSave?: () => void
  saveLabel?: string
  saving?: boolean
  activeIndex: number | null
  isPreview: boolean
  isDone: boolean
  canComplete: boolean
  excludeHolidays: boolean
  onReset: () => void
  onDone: () => void
  onRenameStage: (index: number, name: string) => void
  onAddStage: () => void
  onRemoveStage: (index: number) => void
  onRestoreStages: () => void
  onMoveStage: (fromIndex: number, toIndex: number) => void
}

export function StagePanel({
  schedules,
  notes,
  onNoteChange,
  onSave,
  saveLabel,
  saving,
  activeIndex,
  isPreview,
  isDone,
  canComplete,
  excludeHolidays,
  onReset,
  onDone,
  onRenameStage,
  onAddStage,
  onRemoveStage,
  onRestoreStages,
  onMoveStage
}: StagePanelProps) {
  const { t } = useLang()
  const completeCount = schedules.filter((stage) => stage.end).length
  const canAdd = schedules.length < MAX_STAGES
  const canRemove = schedules.length > MIN_STAGES
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  // gap = 插入线位置：0 = 第一行之前，n = 最后一行之后
  const [gap, setGap] = useState<number | null>(null)

  function resetDrag() {
    setDragFrom(null)
    setGap(null)
  }

  function handleListDragOver(event: React.DragEvent<HTMLOListElement>) {
    event.preventDefault()
    const row = (event.target as Element).closest?.('li[data-drop-index]')
    if (!row) {
      return
    }
    const index = Number(row.getAttribute('data-drop-index'))
    let after = false
    if (typeof event.clientY === 'number' && Number.isFinite(event.clientY)) {
      const rect = row.getBoundingClientRect()
      after = event.clientY - rect.top > rect.height / 2
    }
    const nextGap = index + (after ? 1 : 0)
    if (nextGap !== gap) {
      setGap(nextGap)
    }
  }

  function handleListDrop(event: React.DragEvent<HTMLOListElement>) {
    event.preventDefault()
    if (dragFrom !== null && gap !== null) {
      const to = dragFrom < gap ? gap - 1 : gap
      if (to !== dragFrom) {
        onMoveStage(dragFrom, to)
      }
    }
    resetDrag()
  }

  return (
    <aside className="stage-panel" aria-label="Stage schedule">
      <div className="panel-heading-row">
        <div>
          <h2>{isDone ? 'Schedule complete' : 'Stage Schedule'}</h2>
          <p className="panel-intro">
            {isDone ? 'All stages are scheduled. Boundaries remain adjustable.' : 'Set dates for each stage in order, from top to bottom.'}
          </p>
        </div>
        <span className={`panel-status ${isDone ? 'panel-status-done' : ''}`}>
          {isDone ? 'DONE' : `${completeCount}/${schedules.length}`}
        </span>
      </div>

      {isDone && schedules[0]?.start && schedules.at(-1)?.end && (
        <div className="final-results" data-testid="final-results">
          <span className="final-results-label">FINAL RESULT</span>
          <strong>{formatDisplayDate(schedules[0].start)} <span aria-hidden="true">→</span> {formatDisplayDate(schedules.at(-1)!.end!)}</strong>
          <span>
            {excludeHolidays ? 'Working days' : 'Calendar days'} · {formatDuration(calculateDuration(
              schedules[0].start,
              schedules.at(-1)!.end!,
              excludeHolidays
            ))}
          </span>
        </div>
      )}

      <ol
        className="stage-list"
        data-testid="stage-list"
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setGap(null)
          }
        }}
        onDragOver={handleListDragOver}
        onDrop={handleListDrop}
      >
        {schedules.map((stage) => {
          const isActive = activeIndex === stage.index
          const isPreviewStage = isPreview && isActive
          const isComplete = Boolean(stage.start && stage.end) && !isPreviewStage
          const isEditing = editingIndex === stage.index
          const isDragging = dragFrom === stage.index
          const range = stage.start && stage.end ? formatRangeParts(stage.start, stage.end) : null

          return (
            <Fragment key={stage.id}>
              {gap === stage.index && (
                <li className="insert-line" data-testid="insert-line" aria-hidden="true" />
              )}
              <li
                className={`stage-row stage-row-${stage.tone} ${isActive ? 'stage-row-active' : ''} ${isComplete ? 'stage-row-complete' : ''} ${isDragging ? 'stage-row-dragging' : ''}`}
                data-testid={`stage-row-${stage.index}`}
                data-active={String(isActive)}
                data-complete={String(isComplete)}
                data-drop-index={stage.index}
              >
                <span className="stage-index">{String(stage.index + 1).padStart(2, '0')}</span>
                <div className="stage-row-main">
                  <div className="stage-row-name">
                    {isEditing ? (
                      <input
                        // eslint-disable-next-line jsx-a11y/no-autofocus
                        autoFocus
                        aria-label={t(`阶段 ${stage.index + 1} 名称`, `Stage ${stage.index + 1} name`)}
                        className="stage-name-input"
                        data-testid={`stage-name-input-${stage.index}`}
                        maxLength={60}
                        onBlur={() => setEditingIndex(null)}
                        onChange={(event) => onRenameStage(stage.index, event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === 'Escape') {
                            setEditingIndex(null)
                          }
                        }}
                        type="text"
                        value={stage.name}
                      />
                    ) : (
                      <h3
                        data-testid={`stage-name-${stage.index}`}
                        onClick={() => {
                          if (dragFrom === null) {
                            setEditingIndex(stage.index)
                          }
                        }}
                        onKeyDown={(event) => {
                          if ((event.key === 'Enter' || event.key === ' ') && dragFrom === null) {
                            event.preventDefault()
                            setEditingIndex(stage.index)
                          }
                        }}
                        tabIndex={0}
                        title={t('点击编辑阶段名称', 'Click to rename this stage')}
                      >
                        {stage.name}
                      </h3>
                    )}
                    {isActive && <span className="stage-current-label">CURRENT</span>}
                  </div>
                  <div className="stage-row-dates">
                    <span data-testid={`stage-start-${stage.index}`}>
                      {range ? range.start : stage.start ? formatDisplayDate(stage.start) : '—'}
                    </span>
                    <span className="stage-arrow" aria-hidden="true">→</span>
                    <span data-testid={`stage-end-${stage.index}`}>
                      {range ? range.end : '—'}
                    </span>
                    {stage.duration !== null ? (
                      <strong data-testid={`stage-duration-${stage.index}`}>{formatDuration(stage.duration)}</strong>
                    ) : null}
                  </div>
                  {isActive && (
                    <span className="stage-hint">
                      {isPreviewStage && <span className="preview-label">PREVIEW · </span>}
                      {stage.index === 0 && !stage.start
                        ? 'Select a project start date'
                        : `Select an end date for Stage ${stage.index + 1}`}
                    </span>
                  )}
                  {/* REQ-040: 每阶段备注 —— 跟排期一起存回项目。
                      只有接了后端(传了 onNoteChange)才出现,独立版保持原样。 */}
                  {onNoteChange && (
                    <input
                      className="stage-note-input"
                      aria-label={t(`阶段 ${stage.index + 1} 备注`, `Stage ${stage.index + 1} note`)}
                      data-testid={`stage-note-${stage.index}`}
                      maxLength={200}
                      placeholder={t('备注(如:客户出差,顺延一周)', 'Note (e.g. client away — pushed back a week)')}
                      value={notes?.[stage.id] ?? ''}
                      onChange={(event) => onNoteChange(stage.id, event.target.value)}
                    />
                  )}
                </div>
                <div className="stage-side-actions">
                  <button
                    aria-label={t(`删除阶段 ${stage.index + 1}`, `Delete stage ${stage.index + 1}`)}
                    className="icon-button-small icon-button-small-danger"
                    data-testid={`stage-delete-${stage.index}`}
                    disabled={!canRemove}
                    onClick={() => {
                      if (editingIndex === stage.index) {
                        setEditingIndex(null)
                      }
                      onRemoveStage(stage.index)
                    }}
                    title={canRemove ? t(`删除阶段 ${stage.index + 1}`, `Delete stage ${stage.index + 1}`) : t('至少保留一个阶段', 'Keep at least one stage')}
                    type="button"
                  >
                    ×
                  </button>
                  <span
                    aria-label={t(`拖动排序阶段 ${stage.index + 1}，也可用上下方向键移动`, `Reorder stage ${stage.index + 1} — drag, or use the arrow keys`)}
                    className="drag-handle"
                    data-testid={`stage-drag-${stage.index}`}
                    draggable
                    onDragEnd={resetDrag}
                    onDragStart={(event) => {
                      try {
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', String(stage.index))
                      } catch {
                        // jsdom 等环境没有 dataTransfer，照常进入拖拽态
                      }
                      setDragFrom(stage.index)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowUp' && stage.index > 0) {
                        event.preventDefault()
                        onMoveStage(stage.index, stage.index - 1)
                      } else if (event.key === 'ArrowDown' && stage.index < schedules.length - 1) {
                        event.preventDefault()
                        onMoveStage(stage.index, stage.index + 1)
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    title={t('拖动调整顺序', 'Drag to reorder')}
                  >
                    ⋮⋮
                  </span>
                </div>
              </li>
            </Fragment>
          )
        })}
        {gap === schedules.length && (
          <li className="insert-line" data-testid="insert-line" aria-hidden="true" />
        )}
      </ol>

      <div className="stage-manage-row">
        <button
          className="button button-secondary button-small"
          data-testid="stage-add"
          disabled={!canAdd}
          onClick={onAddStage}
          title={canAdd ? t(`添加阶段（最多 ${MAX_STAGES} 个）`, `Add a stage (max ${MAX_STAGES})`) : t(`已达上限 ${MAX_STAGES} 个`, `Limit of ${MAX_STAGES} reached`)}
          type="button"
        >
          + {t('添加阶段', 'Add stage')}
        </button>
        <button
          className="link-button"
          data-testid="stage-restore"
          onClick={() => {
            setEditingIndex(null)
            onRestoreStages()
          }}
          type="button"
        >
          {t('恢复默认阶段', 'Restore default stages')}
        </button>
      </div>

      <div className="panel-actions">
        <button className="button button-secondary" onClick={onReset} type="button">
          Reset
        </button>
        <button className="button button-primary" disabled={!canComplete} onClick={onDone} type="button">
          {isDone ? 'View Result' : 'Confirm Schedule'}
        </button>
        {/* REQ-040: 存回项目。Confirm 只是本地「排完了」,这一步才落库 ——
            分开是因为拖边界微调的过程中不该每动一下就写一次库。 */}
        {onSave && (
          <button className="button button-primary" disabled={!canComplete || !!saving} onClick={onSave} type="button"
            data-testid="stage-save">
            {saving ? t('保存中…', 'Saving…') : (saveLabel || t('保存到项目', 'Save to project'))}
          </button>
        )}
      </div>
      <p className="panel-footnote">Drag boundary points or use arrow keys to fine-tune.</p>
    </aside>
  )
}
