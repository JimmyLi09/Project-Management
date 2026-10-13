'use client';

import React, { useMemo, useState } from 'react';
import { useLang } from '@/lib/i18n';
import { useStore } from '../store';
import { svcName } from '@/lib/templates';
import { fmtDate, parseISO, pkgSuffix, projCode } from '@/lib/project';
import { extraRowsOf, jobGroups, JOB_HEAD_EN, JOB_HEAD_ZH } from '@/lib/jobRecord';
import { isHw } from '@/lib/jobFormat';
import { baseDefOf, defaultStatus, fieldsOf, fieldVal, formulaText, optionLabel, statusMeta, type FieldDef } from '@/lib/records';
import type { Project, ServicePackage } from '@/lib/types';
import { csvCell } from '@/lib/csv';

/* ===== REQ-039 / REQ-049 / REQ-053: Job Record 整份下载 =====
   和页面上一样分两块:软件业务的 4 栏表(Service Item / Detail / Quantity / Special Notes),
   硬件业务每份一张登记表(字段名 / 值)+ 它下面的额外项目(4 栏)。两种出口,都不引第三方库:
   - PDF:复用 REQ-017 那套 .ex-wrap / @page 打印版式,浏览器「另存为 PDF」;
   - Excel:导出 UTF-8 BOM 的 CSV,一份文件三部分(软件 4 栏行 / 硬件登记表字段 / 硬件额外行),
     Excel 双击直接打开、中文不乱码。(刻意不生成伪装成 .xls 的 HTML —— 新版 Excel 会弹安全警告。) */
export default function JobRecordExport({ p, onClose }: { p: Project; onClose: () => void }) {
  const { lang: appLang } = useLang();
  const { recordFields, jobFormats, avDerived } = useStore();
  const [lang, setLang] = useState<'zh' | 'en'>(appLang);
  const [orient, setOrient] = useState<'portrait' | 'landscape'>('portrait');
  const T = (zh: string, en: string) => (lang === 'zh' ? zh : en);
  const groups = useMemo(() => jobGroups(p, { hw: false, ov: jobFormats }).filter((g) => g.rows.length), [p, jobFormats]);
  const cards = useMemo(() => p.packages.map((pk, i) => ({ pk, i })).filter(({ pk }) => isHw(pk.svc, jobFormats))
    .map(({ pk, i }) => {
      const base = baseDefOf(pk.svc);
      return { pk, i, kind: base.kind, fields: fieldsOf(base, recordFields), extras: extraRowsOf(p, pk) };
    }), [p, jobFormats, recordFields]);
  const head = lang === 'zh' ? JOB_HEAD_ZH : JOB_HEAD_EN;
  const derived = avDerived[p.id];
  const groupName = (svc: string, count: number) =>
    (svc ? svcName(svc, lang) : T('未对应业务', 'Not matched')) + (count > 1 ? ` × ${count}` : '');
  const cardName = (pk: ServicePackage, i: number) => svcName(pk.svc, lang) + (pkgSuffix(p, i) ? ' ' + pkgSuffix(p, i) : '');
  const val = (f: FieldDef, fields: FieldDef[], pk: ServicePackage): string => {
    if (f.type === 'formula') { const v = formulaText(f, fields, pk.record, derived); return v === '—' ? '' : v; }
    const v = fieldVal(f, pk.record, p, derived);
    return f.type === 'select' ? optionLabel(f, v, lang) : v;
  };
  const statusText = (c: (typeof cards)[number]) => {
    const sm = statusMeta(c.kind, (c.pk.record?.status as string) || defaultStatus(c.kind));
    return lang === 'zh' ? sm[1] : sm[2];
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

  /* ── CSV(Excel)── 三部分,每部分自己一行表头;前面都带项目和业务列,Excel 里好筛选 / 透视 */
  function downloadCsv() {
    const lead = [projCode(p) || '', p.name, p.client || ''];
    const leadHead = [T('项目编号', 'Project no.'), T('项目名称', 'Project name'), T('客户', 'Client')];
    const rows: string[][] = [];
    if (groups.length) {
      rows.push([T('软件 · 4 栏', 'Software · 4 columns')]);
      rows.push([...leadHead, T('业务', 'Service'), ...head]);
      groups.forEach((g) => g.rows.forEach((r) => rows.push([...lead, g.svc ? svcName(g.svc, lang) : '', r.item, r.detail, r.qty, r.note])));
    }
    if (cards.length) {
      if (rows.length) rows.push([]);
      rows.push([T('硬件 · 登记表', 'Hardware · register')]);
      rows.push([...leadHead, T('业务', 'Service'), T('字段', 'Field'), T('值', 'Value')]);
      cards.forEach((c) => {
        rows.push([...lead, cardName(c.pk, c.i), T('状态', 'Status'), statusText(c)]);
        c.fields.forEach((f) => rows.push([...lead, cardName(c.pk, c.i), lang === 'zh' ? f.zh : f.en, val(f, c.fields, c.pk)]));
      });
      const extras = cards.filter((c) => c.extras.length);
      if (extras.length) {
        rows.push([]);
        rows.push([T('硬件 · 额外项目', 'Hardware · extra items')]);
        rows.push([...leadHead, T('业务', 'Service'), ...head]);
        extras.forEach((c) => c.extras.forEach((r) => rows.push([...lead, cardName(c.pk, c.i), r.item, r.detail, r.qty, r.note])));
      }
    }
    const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `JobRecord_${(projCode(p) || p.name).replace(/[\\/:*?"<>|]/g, '_')}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const table4 = (rs: { id: string; item: string; detail: string; qty: string; note: string }[]) => (
    <table>
      <colgroup><col style={{ width: '20%' }} /><col style={{ width: '34%' }} /><col style={{ width: '12%' }} /><col /></colgroup>
      <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>
        {rs.map((r) => (
          <tr key={r.id}>
            <td>{r.item}</td>
            <td style={{ whiteSpace: 'pre-wrap' }}>{r.detail}</td>
            <td>{r.qty}</td>
            <td style={{ whiteSpace: 'pre-wrap' }}>{r.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

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

        {groups.length === 0 && cards.length === 0 && <p style={{ fontSize: 12 }}>{T('此项目的 Job Record 还是空的。', 'This Job Record is empty.')}</p>}

        {groups.length > 0 && (
          <>
            {cards.length > 0 && <h2>{T('软件 · 制作类', 'Software · production')}</h2>}
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
          </>
        )}

        {cards.length > 0 && (
          <>
            <h2>{T('硬件 · 安装类', 'Hardware · installation')}</h2>
            {cards.map((c) => (
              <div key={c.pk.id || c.i} style={{ breakInside: 'avoid', marginBottom: 14 }}>
                <h3 style={{ margin: '10px 0 4px' }}>{cardName(c.pk, c.i)} · {T('登记表', 'Register')}<span style={{ fontWeight: 400, fontSize: 11, marginLeft: 8 }}>{statusText(c)}</span></h3>
                {c.fields.length === 0
                  ? <p style={{ fontSize: 12 }}>{T('这项业务还没有登记表字段。', 'This service has no register fields yet.')}</p>
                  : (
                    <table>
                      <colgroup><col style={{ width: '36%' }} /><col /></colgroup>
                      <tbody>
                        {c.fields.map((f) => (
                          <tr key={f.key}>
                            <td style={{ fontWeight: 600 }}>{lang === 'zh' ? f.zh : f.en}{f.type === 'formula' ? ' ƒ' : ''}</td>
                            <td style={{ whiteSpace: 'pre-wrap' }}>{val(f, c.fields, c.pk) || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                {c.extras.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 700, margin: '8px 0 4px' }}>{T('额外项目', 'Extra items')}</div>
                    {table4(c.extras)}
                  </>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
