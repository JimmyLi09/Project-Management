'use client';

import React, { useMemo, useState } from 'react';
import { useLang } from '@/lib/i18n';
import { svcName } from '@/lib/templates';
import { fmtDate, parseISO, projCode } from '@/lib/project';
import { jobGroups, JOB_HEAD_EN, JOB_HEAD_ZH } from '@/lib/jobRecord';
import type { Project } from '@/lib/types';

/* ===== REQ-039 / REQ-049: Job Record 整份下载 =====
   导的就是页面上那张 4 栏表(Service Item / Detail / Quantity / Special Notes),所有业务都在,
   自定义的业务(无人机等)也一样。两种出口,都不引第三方库:
   - PDF:复用 REQ-017 那套 .ex-wrap / @page 打印版式,浏览器「另存为 PDF」;
   - Excel:导出 UTF-8 BOM 的 CSV,Excel 双击直接打开、中文不乱码。
     (刻意不生成伪装成 .xls 的 HTML —— 新版 Excel 会弹安全警告。) */
export default function JobRecordExport({ p, onClose }: { p: Project; onClose: () => void }) {
  const { lang: appLang } = useLang();
  const [lang, setLang] = useState<'zh' | 'en'>(appLang);
  const [orient, setOrient] = useState<'portrait' | 'landscape'>('portrait');
  const T = (zh: string, en: string) => (lang === 'zh' ? zh : en);
  const groups = useMemo(() => jobGroups(p).filter((g) => g.rows.length), [p]);
  const head = lang === 'zh' ? JOB_HEAD_ZH : JOB_HEAD_EN;
  const groupName = (svc: string, count: number) =>
    (svc ? svcName(svc, lang) : T('未对应业务', 'Not matched')) + (count > 1 ? ` × ${count}` : '');

  const headerTxt = `${projCode(p) ? projCode(p) + ' · ' : ''}${p.name}`.replace(/"/g, '\\"');
  const pageCss = `
@page {
  size: A4 ${orient};
  margin: 16mm 12mm 18mm;
  @top-left { content: "${headerTxt} — Job Record"; font-size: 9px; color: #999; }
  @bottom-left { content: "Audax Visuals"; font-size: 9px; color: #999; }
  @bottom-right { content: counter(page) " / " counter(pages); font-size: 9px; color: #999; }
}`;

  /* ── CSV(Excel)── 一行一条,前面带项目和业务列,Excel 里好筛选 / 透视 */
  function downloadCsv() {
    const q = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const rows: string[][] = [[T('项目编号', 'Project no.'), T('项目名称', 'Project name'), T('客户', 'Client'), T('业务', 'Service'), ...head]];
    groups.forEach((g) => g.rows.forEach((r) => {
      rows.push([projCode(p) || '', p.name, p.client || '', g.svc ? svcName(g.svc, lang) : '', r.item, r.detail, r.qty, r.note]);
    }));
    const csv = '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `JobRecord_${(projCode(p) || p.name).replace(/[\\/:*?"<>|]/g, '_')}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="ex-wrap">
      <style media="print">{pageCss}</style>
      <div className="ex-actions">
        <button className="btn-line sm" style={lang === 'en' ? { borderColor: 'var(--navy900)' } : undefined} onClick={() => setLang('en')}>English</button>
        <button className="btn-line sm" style={lang === 'zh' ? { borderColor: 'var(--navy900)' } : undefined} onClick={() => setLang('zh')}>中文</button>
        <button className="btn-line sm" onClick={() => setOrient(orient === 'portrait' ? 'landscape' : 'portrait')}>
          {orient === 'portrait' ? T('A4 纵向', 'A4 Portrait') : T('A4 横向', 'A4 Landscape')} ⇄
        </button>
        <button className="btn-line sm" onClick={downloadCsv} data-testid="job-csv">{T('下载 Excel (CSV)', 'Download Excel (CSV)')}</button>
        <button className="btn-navy sm" onClick={() => window.print()}>{T('打印 / 另存 PDF', 'Print / Save PDF')}</button>
        <button className="btn-line sm" onClick={onClose}>{T('关闭', 'Close')}</button>
      </div>

      <div className="ex-doc" style={{ maxWidth: 900, margin: '0 auto', padding: '0 10px' }}>
        <h1>{p.name}</h1>
        <div className="exsub">
          {projCode(p) ? projCode(p) + ' · ' : ''}{p.client || '—'}
          {' · '}{T('交付日', 'Delivery')} {p.delivery ? fmtDate(parseISO(p.delivery)) : '—'}
          {' · '}Job Record
        </div>

        {groups.length === 0 && <p style={{ fontSize: 12 }}>{T('此项目的 Job Record 还是空的。', 'This Job Record is empty.')}</p>}

        {groups.length > 0 && (
          <table>
            <colgroup><col style={{ width: '20%' }} /><col style={{ width: '34%' }} /><col style={{ width: '12%' }} /><col /></colgroup>
            <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {groups.map((g) => (
                <React.Fragment key={g.svc || '_'}>
                  <tr><td colSpan={4} className="grp-h">{groupName(g.svc, g.count)}</td></tr>
                  {g.rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.item}</td>
                      <td style={{ whiteSpace: 'pre-wrap' }}>{r.detail}</td>
                      <td>{r.qty}</td>
                      <td style={{ whiteSpace: 'pre-wrap' }}>{r.note}</td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
