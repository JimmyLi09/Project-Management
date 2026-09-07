'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { useLang } from '@/lib/i18n';
import { svcName } from '@/lib/templates';
import { fmtDate, parseISO, pkgSuffix, projCode } from '@/lib/project';
import {
  registerDef, statusMeta, defaultStatus, recordVal, fieldsOf, formulaText, optionLabel,
  type FieldDef, type RegisterDef,
} from '@/lib/records';
import type { Project, ServicePackage } from '@/lib/types';

/* ===== REQ-039: Job Record 整份下载 =====
   两种出口,都不引第三方库:
   - PDF:复用 REQ-017 那套 .ex-wrap / @page 打印版式,浏览器「另存为 PDF」;
   - Excel:导出 UTF-8 BOM 的 CSV,Excel 双击直接打开、中文不乱码。
     (刻意不生成伪装成 .xls 的 HTML —— 新版 Excel 会弹安全警告。)
   两边取值走的都是 fieldsOf + formulaText,和界面上看到的一模一样,
   公式列导出的是算出来的结果,不是表达式。 */
export default function JobRecordExport({ p, onClose }: { p: Project; onClose: () => void }) {
  const { lang: appLang } = useLang();
  const { recordFields } = useStore();
  const [lang, setLang] = useState<'zh' | 'en'>(appLang);
  const [orient, setOrient] = useState<'portrait' | 'landscape'>('portrait');
  const T = (zh: string, en: string) => (lang === 'zh' ? zh : en);

  /* 只导有登记表的业务 —— 其余的没有资料可导 */
  const cards = useMemo(() => p.packages
    .map((pk, i) => ({ pk, i, base: registerDef(pk.svc) }))
    .filter((x): x is { pk: ServicePackage; i: number; base: RegisterDef } => !!x.base)
    .map((x) => ({ ...x, fields: fieldsOf(x.base, recordFields) })), [p.packages, recordFields]);

  /* 一个字段导出成什么文字。公式要拿到同卡所有字段才算得出来,所以带上 fields;
     导出的是算好的结果,不是表达式。 */
  const val = (f: FieldDef, fields: FieldDef[], rec: ServicePackage['record']): string => {
    if (f.type === 'formula') { const v = formulaText(f, fields, rec); return v === '—' ? '' : v; }
    const raw = recordVal(rec, f.key);
    if (!raw) return '';
    if (f.type === 'date') { const d = parseISO(raw); return d ? fmtDate(d) : raw; }
    if (f.type === 'select') return optionLabel(f, raw, lang);
    return raw;
  };

  const headerTxt = `${projCode(p) ? projCode(p) + ' · ' : ''}${p.name}`.replace(/"/g, '\\"');
  const pageCss = `
@page {
  size: A4 ${orient};
  margin: 16mm 12mm 18mm;
  @top-left { content: "${headerTxt} — Job Record"; font-size: 9px; color: #999; }
  @bottom-left { content: "Audax Visuals"; font-size: 9px; color: #999; }
  @bottom-right { content: counter(page) " / " counter(pages); font-size: 9px; color: #999; }
}`;

  /* ── CSV(Excel)──
     一行一个字段,带上业务列 —— 一个项目可能有多块 LED(REQ-026),
     摊平成长表比横向拼列稳,Excel 里也好做筛选/透视。 */
  function downloadCsv() {
    const q = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const rows: string[][] = [[
      T('项目编号', 'Project no.'), T('项目名称', 'Project name'), T('客户', 'Client'),
      T('业务', 'Service'), T('实例', 'Instance'), T('状态', 'Status'),
      T('字段', 'Field'), T('值', 'Value'),
    ]];
    cards.forEach(({ pk, i, base, fields }) => {
      const st = (pk.record?.status as string) || defaultStatus(base.kind);
      const sm = statusMeta(base.kind, st);
      fields.forEach((f) => {
        rows.push([
          projCode(p) || '', p.name, p.client || '',
          svcName(pk.svc, lang), pkgSuffix(p, i) || '', lang === 'zh' ? sm[1] : sm[2],
          lang === 'zh' ? f.zh : f.en, val(f, fields, pk.record),
        ]);
      });
    });
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
        <button className="btn-line sm" onClick={downloadCsv}>{T('下载 Excel (CSV)', 'Download Excel (CSV)')}</button>
        <button className="btn-navy sm" onClick={() => window.print()}>{T('打印 / 另存 PDF', 'Print / Save PDF')}</button>
        <button className="btn-line sm" onClick={onClose}>{T('关闭', 'Close')}</button>
      </div>

      <div className="ex-doc" style={{ maxWidth: 860, margin: '0 auto', padding: '0 10px' }}>
        <h1>{p.name}</h1>
        <div className="exsub">
          {projCode(p) ? projCode(p) + ' · ' : ''}{p.client || '—'}
          {' · '}{T('交付日', 'Delivery')} {p.delivery ? fmtDate(parseISO(p.delivery)) : '—'}
          {' · '}Job Record
        </div>

        {cards.length === 0 && <p style={{ fontSize: 12 }}>{T('此项目暂无可导出的业务资料。', 'No business records to export.')}</p>}

        {cards.map(({ pk, i, base, fields }) => {
          const st = (pk.record?.status as string) || defaultStatus(base.kind);
          const sm = statusMeta(base.kind, st);
          return (
            <div key={i}>
              <h2>
                {svcName(pk.svc, lang)}{pkgSuffix(p, i) ? ' ' + pkgSuffix(p, i) : ''}
                <span style={{ float: 'right', fontSize: 11, fontWeight: 400, color: '#666' }}>{lang === 'zh' ? sm[1] : sm[2]}</span>
              </h2>
              <table>
                <tbody>
                  {fields.map((f) => {
                    const v = val(f, fields, pk.record);
                    return (
                      <tr key={f.key}>
                        <th style={{ width: '34%', fontWeight: f.highlight || f.type === 'formula' ? 700 : 600 }}>
                          {lang === 'zh' ? f.zh : f.en}
                        </th>
                        <td style={{ fontWeight: f.highlight || f.type === 'formula' ? 700 : 400, whiteSpace: f.type === 'textarea' ? 'pre-wrap' : undefined }}>
                          {v || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
