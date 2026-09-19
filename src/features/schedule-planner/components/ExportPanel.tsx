import type { PrintScheduleMeta } from './PrintSchedule'
import { useLang } from '@/lib/i18n'

export interface ExportPanelProps {
  meta: PrintScheduleMeta
  onMetaChange: (patch: Partial<PrintScheduleMeta>) => void
  onExportPdf: () => void
}

export function ExportPanel({ meta, onMetaChange, onExportPdf }: ExportPanelProps) {
  const { t } = useLang()
  return (
    <section className="stage-panel export-panel" aria-label={t('导出 PDF', 'Export PDF')}>
      <div className="panel-heading-row">
        <div>
          <h2>{t('导出 PDF', 'Export PDF')}</h2>
          <p className="panel-intro">{t('填标题和客户信息，导出 production schedule 表格。', 'Fill in the title and client details, then export the production schedule table.')}</p>
        </div>
      </div>

      <div className="export-meta-grid">
        <label className="export-field">
          <span>{t('项目标题', 'Project title')}</span>
          <input
            className="archive-name-input"
            data-testid="export-title-input"
            maxLength={80}
            onChange={(event) => onMetaChange({ title: event.target.value })}
            placeholder={t('如：032 · 152-SUTD Renders — Schedule', 'e.g. 032 · 152-SUTD Renders — Schedule')}
            type="text"
            value={meta.title}
          />
        </label>
        <label className="export-field">
          <span>{t('客户 Client', 'Client')}</span>
          <input
            className="archive-name-input"
            data-testid="export-client-input"
            maxLength={60}
            onChange={(event) => onMetaChange({ client: event.target.value })}
            placeholder={t('如：TS Group', 'e.g. TS Group')}
            type="text"
            value={meta.client}
          />
        </label>
        <label className="export-field">
          <span>{t('服务 Services', 'Services')}</span>
          <input
            className="archive-name-input"
            data-testid="export-services-input"
            maxLength={60}
            onChange={(event) => onMetaChange({ services: event.target.value })}
            placeholder={t('如：CGI', 'e.g. CGI')}
            type="text"
            value={meta.services}
          />
        </label>
        <label className="export-field">
          <span>{t('底部备注', 'Footer note')}</span>
          <input
            className="archive-name-input"
            data-testid="export-note-input"
            maxLength={300}
            onChange={(event) => onMetaChange({ note: event.target.value })}
            type="text"
            value={meta.note}
          />
        </label>
      </div>

      <div className="panel-actions panel-actions-single">
        <button
          className="button button-primary"
          data-testid="export-pdf"
          onClick={onExportPdf}
          type="button"
        >
          {t('导出 PDF', 'Export PDF')}
        </button>
      </div>
      <p className="panel-footnote">{t('导出会打开打印对话框，选择“另存为 PDF”即可。打印版只含排期表格，不含按钮。', 'Exporting opens the print dialog — choose “Save as PDF”. The printed version contains only the schedule table, no buttons.')}</p>
    </section>
  )
}
