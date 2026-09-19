import { useState } from 'react'

import { formatArchiveDate, type ScheduleArchive } from '../domain/archives'
import { useLang } from '@/lib/i18n'

export interface ArchivePanelProps {
  archives: readonly ScheduleArchive[]
  draftName: string
  onDraftNameChange: (value: string) => void
  onSave: () => void
  onLoad: (id: string) => void
  onDelete: (id: string) => void
  canSave: boolean
}

export function ArchivePanel({
  archives,
  draftName,
  onDraftNameChange,
  onSave,
  onLoad,
  onDelete,
  canSave
}: ArchivePanelProps) {
  const { t } = useLang()
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  return (
    <section className="stage-panel archive-panel" aria-label={t('存档与读档', 'Saved versions')}>
      <div className="panel-heading-row">
        <div>
          <h2>{t('存档 / 读档', 'Save / restore')}</h2>
          <p className="panel-intro">{t('存档保存在项目里,可随时读档继续调整。', 'Versions are saved with the project and can be restored any time.')}</p>
        </div>
      </div>

      <div className="archive-save-row">
        <input
          aria-label={t('存档名称', 'Version name')}
          className="archive-name-input"
          data-testid="archive-name-input"
          maxLength={60}
          onChange={(event) => onDraftNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canSave) {
              onSave()
            }
          }}
          placeholder={t('存档名称，如：A项目-初版', 'Version name, e.g. Phase 1 — first pass')}
          type="text"
          value={draftName}
        />
        <button
          className="button button-secondary button-small"
          data-testid="archive-save"
          disabled={!canSave}
          onClick={onSave}
          type="button"
        >
          {t('保存存档', 'Save version')}
        </button>
      </div>

      {archives.length === 0 ? (
        <p className="archive-empty" data-testid="archive-empty">{t('暂无存档，先在日历上排好日期再保存。', 'No saved versions yet — set the dates on the calendar first, then save.')}</p>
      ) : (
        <ul className="archive-list" data-testid="archive-list">
          {archives.map((archive) => (
            <li className="archive-item" data-testid={`archive-item-${archive.id}`} key={archive.id}>
              <div className="archive-item-main">
                <strong className="archive-item-name">{archive.name}</strong>
                <span className="archive-item-meta">
                  {formatArchiveDate(archive.savedAt)} · {archive.stages.length} {t('阶段', 'stages')} · {archive.boundaries.length} {t('边界点', 'boundaries')}
                </span>
              </div>
              <div className="archive-item-actions">
                <button
                  className="link-button"
                  data-testid={`archive-load-${archive.id}`}
                  onClick={() => onLoad(archive.id)}
                  type="button"
                >
                  {t('读档', 'Restore')}
                </button>
                {confirmDeleteId === archive.id ? (
                  <>
                    <button
                      className="link-button link-button-danger"
                      data-testid={`archive-delete-confirm-${archive.id}`}
                      onClick={() => {
                        onDelete(archive.id)
                        setConfirmDeleteId(null)
                      }}
                      type="button"
                    >
                      {t('确认删？', 'Delete?')}
                    </button>
                    <button
                      className="link-button"
                      onClick={() => setConfirmDeleteId(null)}
                      type="button"
                    >
                      {t('取消', 'Cancel')}
                    </button>
                  </>
                ) : (
                  <button
                    className="link-button link-button-danger"
                    data-testid={`archive-delete-${archive.id}`}
                    onClick={() => setConfirmDeleteId(archive.id)}
                    type="button"
                  >
                    {t('删除', 'Delete')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
