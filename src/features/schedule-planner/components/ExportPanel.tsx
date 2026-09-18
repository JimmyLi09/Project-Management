import type { PrintScheduleMeta } from './PrintSchedule'

export interface ExportPanelProps {
  meta: PrintScheduleMeta
  onMetaChange: (patch: Partial<PrintScheduleMeta>) => void
  onExportPdf: () => void
}

export function ExportPanel({ meta, onMetaChange, onExportPdf }: ExportPanelProps) {
  return (
    <section className="stage-panel export-panel" aria-label="导出 PDF">
      <div className="panel-heading-row">
        <div>
          <h2>导出 PDF</h2>
          <p className="panel-intro">填标题和客户信息，导出 production schedule 表格。</p>
        </div>
      </div>

      <div className="export-meta-grid">
        <label className="export-field">
          <span>项目标题</span>
          <input
            className="archive-name-input"
            data-testid="export-title-input"
            maxLength={80}
            onChange={(event) => onMetaChange({ title: event.target.value })}
            placeholder="如：032 · 152-SUTD Renders — Schedule"
            type="text"
            value={meta.title}
          />
        </label>
        <label className="export-field">
          <span>客户 Client</span>
          <input
            className="archive-name-input"
            data-testid="export-client-input"
            maxLength={60}
            onChange={(event) => onMetaChange({ client: event.target.value })}
            placeholder="如：TS Group"
            type="text"
            value={meta.client}
          />
        </label>
        <label className="export-field">
          <span>服务 Services</span>
          <input
            className="archive-name-input"
            data-testid="export-services-input"
            maxLength={60}
            onChange={(event) => onMetaChange({ services: event.target.value })}
            placeholder="如：CGI"
            type="text"
            value={meta.services}
          />
        </label>
        <label className="export-field">
          <span>底部备注</span>
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
          导出 PDF
        </button>
      </div>
      <p className="panel-footnote">导出会打开打印对话框，选择“另存为 PDF”即可。打印版只含排期表格，不含按钮。</p>
    </section>
  )
}
