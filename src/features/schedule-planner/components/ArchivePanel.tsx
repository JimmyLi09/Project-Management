import { useState } from 'react'

import { formatArchiveDate, type ScheduleArchive } from '../domain/archives'

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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  return (
    <section className="stage-panel archive-panel" aria-label="存档与读档">
      <div className="panel-heading-row">
        <div>
          <h2>存档 / 读档</h2>
          <p className="panel-intro">存档保存在本机浏览器，可随时读档继续调整。</p>
        </div>
      </div>

      <div className="archive-save-row">
        <input
          aria-label="存档名称"
          className="archive-name-input"
          data-testid="archive-name-input"
          maxLength={60}
          onChange={(event) => onDraftNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canSave) {
              onSave()
            }
          }}
          placeholder="存档名称，如：A项目-初版"
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
          保存存档
        </button>
      </div>

      {archives.length === 0 ? (
        <p className="archive-empty" data-testid="archive-empty">暂无存档，先在日历上排好日期再保存。</p>
      ) : (
        <ul className="archive-list" data-testid="archive-list">
          {archives.map((archive) => (
            <li className="archive-item" data-testid={`archive-item-${archive.id}`} key={archive.id}>
              <div className="archive-item-main">
                <strong className="archive-item-name">{archive.name}</strong>
                <span className="archive-item-meta">
                  {formatArchiveDate(archive.savedAt)} · {archive.stages.length} 阶段 · {archive.boundaries.length} 边界点
                </span>
              </div>
              <div className="archive-item-actions">
                <button
                  className="link-button"
                  data-testid={`archive-load-${archive.id}`}
                  onClick={() => onLoad(archive.id)}
                  type="button"
                >
                  读档
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
                      确认删？
                    </button>
                    <button
                      className="link-button"
                      onClick={() => setConfirmDeleteId(null)}
                      type="button"
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <button
                    className="link-button link-button-danger"
                    data-testid={`archive-delete-${archive.id}`}
                    onClick={() => setConfirmDeleteId(archive.id)}
                    type="button"
                  >
                    删除
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
