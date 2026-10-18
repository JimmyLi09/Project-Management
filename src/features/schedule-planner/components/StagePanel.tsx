import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'

import { formatDisplayDate } from '../domain/calendar'
import { calculateDuration, durationExact, formatDuration, nonWorkingReason } from '../domain/duration'
import {
  MAX_STAGES,
  MIN_STAGES,
  stageName,
  type EditMode,
  type LocalDate,
  type StageSchedule
} from '../domain/schedule'
import { DateField } from './DateField'
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
  /* REQ-046:在右边直接改某阶段的开始 / 结束日。返回 null = 成功;否则是不允许的原因(给人看的一句话) */
  onEditDate?: (index: number, which: 'start' | 'end', date: LocalDate, mode: EditMode) => string | null
  /* REQ-048:直接改工期(当前单位:工作日 / 日历天)。返回 null = 成功 */
  onEditDuration?: (index: number, units: number) => string | null
  /* REQ-048:每行右侧附加内容(负责人 / 状态) */
  stageExtra?: (stage: StageSchedule) => ReactNode
  /* REQ-057:只读 —— 不能改名、删除、拖动、加阶段,也没有 Reset / Confirm / 保存;备注只显示 */
  readOnly?: boolean
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
  onMoveStage,
  onEditDate,
  onEditDuration,
  stageExtra,
  readOnly = false
}: StagePanelProps) {
  const { lang, t } = useLang()
  const unit = excludeHolidays ? 'workdays' : 'days'
  /* 「只移动这一个边界」:默认改结束日时后面整体顺延;勾上就只挤压下一阶段 */
  const [oneBoundary, setOneBoundary] = useState(false)
  /* 每行最近一次改日期的结果:不允许的原因(红)/ 选到周末假期的提醒(黄) */
  const [rowMsg, setRowMsg] = useState<Record<number, { kind: 'error' | 'warn'; text: string }>>({})
  const noStart = !schedules[0]?.start
  function edit(index: number, which: 'start' | 'end', date: LocalDate) {
    if (!onEditDate) return
    const err = onEditDate(index, which, date, oneBoundary ? 'one' : 'shift')
    const off = !err && excludeHolidays ? nonWorkingReason(date, lang) : null
    setRowMsg(err ? { [index]: { kind: 'error', text: err } }
      : off ? { [index]: { kind: 'warn', text: t(`这天是${off}，不算工作日。`, `That day is ${off} — not a working day.`) } } : {})
  }
  const completeCount = schedules.filter((stage) => stage.end).length
  const canAdd = schedules.length < MAX_STAGES
  const canRemove = schedules.length > MIN_STAGES
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  /* REQ-056:卡片默认收起,只显示编号 + 名称 + 日期;点「编辑」展开。可以同时开好几张。
     只是界面状态,不存库 —— 刷新后全部收起。新加的那一张(列表多了一行、多出来的是没见过的阶段)直接展开。 */
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const seen = useRef<Set<string> | null>(null)
  const ids = schedules.map((x) => x.id).join('|')
  useEffect(() => {
    const now = schedules.map((x) => x.id)
    if (seen.current === null) { seen.current = new Set(now); return }
    const fresh = now.filter((id) => !seen.current!.has(id))
    if (fresh.length === 1 && now.length === seen.current.size + 1) setOpen((cur) => new Set(cur).add(fresh[0]))
    seen.current = new Set(now)
  }, [ids]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id: string) => setOpen((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n })
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
            {readOnly ? t('只读', 'Read-only')
              : isDone ? 'All stages are scheduled. Boundaries remain adjustable.' : 'Set dates for each stage in order, from top to bottom.'}
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
          {(() => {
            const total = calculateDuration(schedules[0].start, schedules.at(-1)!.end!, excludeHolidays)
            return (
              <span data-testid="final-total" title={durationExact(total, unit, lang)}>
                {excludeHolidays ? t(`共 ${total} 个工作日`, `${total} working days`) : t(`共 ${total} 天`, `${total} calendar days`)} · {formatDuration(total, unit)}
              </span>
            )
          })()}
        </div>
      )}

      <div className="stage-expand-row">
        <button className="link-button" data-testid="stage-expand-all" onClick={() => setOpen(new Set(schedules.map((x) => x.id)))} type="button">{t('全部展开', 'Expand all')}</button>
        <button className="link-button" data-testid="stage-collapse-all" onClick={() => setOpen(new Set())} type="button">{t('全部收起', 'Collapse all')}</button>
      </div>
      <ol
        className="stage-list"
        data-testid="stage-list"
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setGap(null)
          }
        }}
        onDragOver={readOnly ? undefined : handleListDragOver}
        onDrop={readOnly ? undefined : handleListDrop}
      >
        {schedules.map((stage) => {
          const isActive = activeIndex === stage.index
          const isPreviewStage = isPreview && isActive
          const isComplete = Boolean(stage.start && stage.end) && !isPreviewStage
          const isEditing = editingIndex === stage.index
          const isDragging = dragFrom === stage.index
          const isOpen = open.has(stage.id)
          /* REQ-040: 每阶段备注 —— 跟排期一起存回项目。只有接了后端(传了 onNoteChange)才出现 */
          const noteInput = onNoteChange ? (
            <input
              className="stage-note-input"
              aria-label={t(`阶段 ${stage.index + 1} 备注`, `Stage ${stage.index + 1} note`)}
              data-testid={`stage-note-${stage.index}`}
              maxLength={200}
              placeholder={t('备注(如:客户出差,顺延一周)', 'Note (e.g. client away — pushed back a week)')}
              value={notes?.[stage.id] ?? ''}
              onChange={(event) => onNoteChange(stage.id, event.target.value)}
            />
          ) : null

          return (
            <Fragment key={stage.id}>
              {gap === stage.index && (
                <li className="insert-line" data-testid="insert-line" aria-hidden="true" />
              )}
              <li
                className={`stage-row stage-row-${stage.tone} ${isActive ? 'stage-row-active' : ''} ${isComplete ? 'stage-row-complete' : ''} ${isDragging ? 'stage-row-dragging' : ''} ${isOpen ? 'stage-row-open' : 'stage-row-closed'}`}
                data-testid={`stage-row-${stage.index}`}
                data-open={String(isOpen)}
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
                        value={stageName(stage, lang)}
                      />
                    ) : (
                      <h3
                        data-testid={`stage-name-${stage.index}`}
                        onClick={() => {
                          if (dragFrom === null && !readOnly && isOpen) {
                            setEditingIndex(stage.index)
                          }
                        }}
                        onDoubleClick={() => {
                          if (dragFrom === null && !readOnly) {
                            setEditingIndex(stage.index)
                          }
                        }}
                        onKeyDown={(event) => {
                          if ((event.key === 'Enter' || event.key === ' ') && dragFrom === null && !readOnly) {
                            event.preventDefault()
                            setEditingIndex(stage.index)
                          }
                        }}
                        tabIndex={readOnly ? undefined : 0}
                        title={readOnly ? stageName(stage, lang) : `${stageName(stage, lang)} — ${t('双击改名', 'double-click to rename')}`}
                      >
                        {stageName(stage, lang)}
                      </h3>
                    )}
                    {isActive && <span className="stage-current-label">CURRENT</span>}
                    {isOpen && stage.duration !== null && (
                      <strong className="stage-duration" data-testid={`stage-duration-${stage.index}`} title={durationExact(stage.duration, unit, lang)}>
                        {formatDuration(stage.duration, unit)}
                      </strong>
                    )}
                  </div>
                  {/* REQ-046:第 2 行 = 开始 → 结束两个日期框(点开小日历,也可直接输入)+ 备注 */}
                  {onEditDate && isOpen ? (
                    <div className="stage-row-edit">
                      <DateField
                        excludeHolidays={excludeHolidays}
                        focusMonth={schedules[0]?.start ?? null}
                        highlight={stage.index === 0 && noStart}
                        disabled={stage.index > 0 && !stage.start && noStart}
                        label={t(`阶段 ${stage.index + 1} 开始日期`, `Stage ${stage.index + 1} start date`)}
                        onPick={(d) => edit(stage.index, 'start', d)}
                        placeholder={stage.index === 0 && noStart ? t('选开始日期', 'Pick a start date') : '—'}
                        testid={`stage-start-input-${stage.index}`}
                        value={stage.start}
                      />
                      <span className="stage-arrow" aria-hidden="true">→</span>
                      <DateField
                        excludeHolidays={excludeHolidays}
                        focusMonth={stage.start}
                        disabled={!stage.start}
                        label={t(`阶段 ${stage.index + 1} 结束日期`, `Stage ${stage.index + 1} end date`)}
                        onPick={(d) => edit(stage.index, 'end', d)}
                        placeholder="—"
                        testid={`stage-end-input-${stage.index}`}
                        value={stage.end}
                      />
                      {noteInput}
                    </div>
                  ) : (
                    <div className="stage-row-dates">
                      <span data-testid={`stage-start-${stage.index}`}>{stage.start ? formatDisplayDate(stage.start) : '—'}</span>
                      <span className="stage-arrow" aria-hidden="true">→</span>
                      <span data-testid={`stage-end-${stage.index}`}>{stage.end ? formatDisplayDate(stage.end) : '—'}</span>
                    </div>
                  )}
                  {/* REQ-048:工期可以直接改,改了后面的阶段自动顺延;和默认不一样就标「已改 · 默认 2w」 */}
                  {onEditDuration && isOpen && (() => {
                    const def = typeof stage.weeks === 'number' ? Math.max(1, Math.round(stage.weeks * (excludeHolidays ? 5 : 7))) : null
                    const changed = def !== null && stage.duration !== null && stage.duration !== def
                    const wk = typeof stage.weeks === 'number' ? `${Number.isInteger(stage.weeks) ? stage.weeks : stage.weeks.toFixed(1)}w` : ''
                    return (
                      <div className="stage-row-duration">
                        <span>{t('工期', 'Duration')}</span>
                        <input
                          aria-label={t(`阶段 ${stage.index + 1} 工期`, `Stage ${stage.index + 1} duration`)}
                          data-testid={`stage-days-${stage.index}`}
                          disabled={!stage.start}
                          key={`${stage.id}:${stage.duration ?? ''}`}
                          defaultValue={stage.duration ?? ''}
                          min={1}
                          max={999}
                          type="number"
                          onBlur={(event) => {
                            const n = Number(event.target.value)
                            if (!event.target.value || n === stage.duration) return
                            const err = onEditDuration(stage.index, n)
                            setRowMsg(err ? { [stage.index]: { kind: 'error', text: err } } : {})
                            if (err) event.target.value = String(stage.duration ?? '')
                          }}
                          onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }}
                        />
                        <span>{excludeHolidays ? t('个工作日', 'working days') : t('天', 'days')}</span>
                        {changed
                          ? <span className="stage-changed" data-testid={`stage-changed-${stage.index}`}>{t(`已改 · 默认 ${wk}`, `Changed · default ${wk}`)}</span>
                          : wk && <span className="stage-default">{t(`默认 ${wk}`, `Default ${wk}`)}</span>}
                      </div>
                    )
                  })()}
                  {isOpen && stageExtra && <div className="stage-row-extra">{stageExtra(stage)}</div>}
                  {isOpen && stage.index === 0 && noStart && onEditDate && (
                    <span className="stage-need-hint" data-testid="stage-need-start">{t('选开始日期（在这里选，或在左边日历点一天）', 'Pick a start date (here, or click a day on the calendar)')}</span>
                  )}
                  {rowMsg[stage.index] && (
                    <span className={`stage-row-msg stage-row-msg-${rowMsg[stage.index].kind}`} data-testid={`stage-msg-${stage.index}`}>{rowMsg[stage.index].text}</span>
                  )}
                  {isOpen && !onEditDate && noteInput}
                  {isOpen && readOnly && notes?.[stage.id] && <span className="stage-note-text" data-testid={`stage-note-text-${stage.index}`}>{notes[stage.id]}</span>}
                  {/* REQ-056:展开后底部「收起」「删除阶段」 */}
                  {isOpen && (
                    <div className="stage-card-actions">
                      <button className="button button-primary button-small" data-testid={`stage-collapse-${stage.index}`} onClick={() => toggle(stage.id)} type="button">{t('收起', 'Collapse')}</button>
                      {!readOnly && (
                        <button
                          aria-label={t(`删除阶段 ${stage.index + 1}`, `Delete stage ${stage.index + 1}`)}
                          className="button button-secondary button-small stage-delete-button"
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
                          {t('删除阶段', 'Delete stage')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="stage-side-actions">
                  {!isOpen && (
                    <button className="stage-edit-button" data-testid={`stage-edit-${stage.index}`} onClick={() => toggle(stage.id)} type="button">
                      {readOnly ? t('详情', 'Details') : t('编辑', 'Edit')}
                    </button>
                  )}
                  {!readOnly && <span
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
                  </span>}
                </div>
              </li>
            </Fragment>
          )
        })}
        {gap === schedules.length && (
          <li className="insert-line" data-testid="insert-line" aria-hidden="true" />
        )}
      </ol>

      {onEditDate && (
        <label className="stage-one-boundary" title={t('不勾:改某阶段结束日时,后面各阶段整体顺延(工期不变)。勾上:只挤压下一阶段。', 'Off: changing an end date shifts all later stages (durations kept). On: only the next stage is squeezed.')}>
          <input type="checkbox" checked={oneBoundary} onChange={(e) => setOneBoundary(e.target.checked)} data-testid="stage-one-boundary" />
          {t('只移动这一个边界', 'Move only this boundary')}
        </label>
      )}
      {!readOnly && <div className="stage-manage-row">
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
      </div>}

      {!readOnly && <div className="panel-actions">
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
      </div>}
      {!readOnly && <p className="panel-footnote">Drag boundary points or use arrow keys to fine-tune.</p>}
    </aside>
  )
}
