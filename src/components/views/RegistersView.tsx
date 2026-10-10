'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { canEditIn, isFull } from '@/lib/permissions';
import { SVC, svcName, svcColor } from '@/lib/templates';
import { todayMid, fmtDate, projCode } from '@/lib/project';
import { useLang } from '@/lib/i18n';
import { Icon } from '../ui';
import { jobGroups, jobHeaderMap, jobImportCols, serviceItemOf, svcFromName, JOB_HEAD_EN, JOB_HEAD_ZH, type JobField } from '@/lib/jobRecord';
import type { JobRow, Project } from '@/lib/types';

/* ===== REQ-049 · 项目档案 = 各项目 Job Record 4 栏表汇总 =====
   Job Record 改成一张 4 栏表(Service Item / Detail / Quantity / Special Notes)后,
   这里跨项目读的也是它:所有业务都在(无人机这类自定义业务也一样),按业务分页签,
   可筛选、排序、就地改、导出 CSV;PD / BD 可以按 4 栏表头批量导入。
   原来各业务的登记表字段(pk.record)不删,在每个项目 Job Record 下方「旧字段(只读)」里看;
   上线迁移时有值的字段已经各转成了一行,所以在这里也搜得到。 */

interface Row { p: Project; r: JobRow; svc: string; inProject: boolean; idx: number }
const PAGE = 50;
const yearOf = (p: Project) => (p.delivery || '').slice(0, 4) || String(new Date(p.created).getFullYear());
const SORT_KEYS = ['project', 'client', 'pm', 'svc', 'item', 'detail', 'qty', 'note'] as const;
type SortKey = (typeof SORT_KEYS)[number];

export default function RegistersView() {
  const { projects, me, dispatch, openProject, refresh, setToast } = useStore();
  const { lang, t } = useLang();
  const [svc, setSvc] = useState('all');
  const [q, setQ] = useState('');
  const [pm, setPm] = useState('');
  const [client, setClient] = useState('');   // REQ-020
  const [year, setYear] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);   // REQ-033
  const [editing, setEditing] = useState<string | null>(null);                    // 就地编辑中的格子 rowId:field
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [imp, setImp] = useState<ImportPreview | null>(null);
  const canImport = isFull(me);

  /* 全部行(没归档的项目),页签按业务 */
  const every = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let idx = 0;
    projects.forEach((p) => {
      if (p.archived) return;
      jobGroups(p).forEach((g) => g.rows.forEach((r) => out.push({ p, r, svc: g.svc, inProject: g.inProject, idx: idx++ })));
    });
    return out;
  }, [projects]);
  const tabs = useMemo(() => {
    const n: Record<string, number> = {};
    every.forEach((x) => { n[x.svc] = (n[x.svc] || 0) + 1; });
    const order = Object.keys(SVC);
    return Object.keys(n).sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999)).map((k) => ({ svc: k, n: n[k] }));
  }, [every]);
  const all = useMemo(() => (svc === 'all' ? every : every.filter((x) => x.svc === svc)), [every, svc]);

  const pms = useMemo(() => [...new Set(all.flatMap((x) => x.p.owners || []))].sort(), [all]);
  /* REQ-020: 客户下拉 —— 只列真实出现过的客户 */
  const clients = useMemo(() => [...new Set(all.map((x) => (x.p.client || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')), [all]);
  const years = useMemo(() => [...new Set(all.map((x) => yearOf(x.p)))].sort().reverse(), [all]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return all.filter((x) => {
      if (pm && !(x.p.owners || []).includes(pm)) return false;
      if (client && (x.p.client || '').trim() !== client) return false;
      if (year && yearOf(x.p) !== year) return false;
      if (ql && ![x.p.name, projCode(x.p), x.p.client, x.r.item, x.r.detail, x.r.qty, x.r.note].join(' ').toLowerCase().includes(ql)) return false;
      return true;
    });
  }, [all, q, pm, client, year]);

  /* REQ-033: 点列头排序 —— 一次升序、再点降序、第三次回到默认序;空值一律排最后 */
  const rows = useMemo(() => {
    if (!sort) return filtered;
    const val = (x: Row): string => {
      const v = sort.key === 'project' ? x.p.name : sort.key === 'client' ? x.p.client || '' : sort.key === 'pm' ? (x.p.owners || [])[0] || ''
        : sort.key === 'svc' ? (x.svc ? svcName(x.svc, lang) : '') : x.r[sort.key];
      return v.trim() ? v.toLowerCase() : '￿';
    };
    return [...filtered].sort((a, b) => {
      const va = val(a), vb = val(b);
      return va < vb ? -sort.dir : va > vb ? sort.dir : a.idx - b.idx;
    });
  }, [filtered, sort, lang]);

  const kpi = useMemo(() => {
    const projectsN = new Set(all.map((x) => x.p.id)).size;
    const bare = all.filter((x) => !x.r.detail && !x.r.qty && !x.r.note).length;
    const loose = all.filter((x) => !x.inProject).length;
    return [
      [t('项目', 'Projects'), projectsN, 'var(--navy900)'],
      [t('行数', 'Rows'), all.length, 'var(--navy900)'],
      [t('只有业务名的行', 'Rows with only a service name'), bare, bare ? 'var(--warning)' : 'var(--success)'],
      [t('未对应业务的行', 'Rows not matched to a service'), loose, loose ? 'var(--danger)' : 'var(--success)'],
    ] as const;
  }, [all, t]);

  const pageRows = rows.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.ceil(rows.length / PAGE) || 1;
  React.useEffect(() => { setPage(0); }, [svc, q, pm, year, client, sort]);

  const head = lang === 'zh' ? JOB_HEAD_ZH : JOB_HEAD_EN;
  function exportCsv() {
    const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const h = [t('项目编号', 'Project no.'), t('项目', 'Project'), t('客户', 'Client'), 'PM', t('业务', 'Service'), ...head];
    const body = rows.map((x) => [projCode(x.p), x.p.name, x.p.client || '', (x.p.owners || []).join(' / '), x.svc ? svcName(x.svc, lang) : '', x.r.item, x.r.detail, x.r.qty, x.r.note]);
    const csv = [h, ...body].map((r) => r.map(esc).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `register-${svc}-${fmtDate(todayMid())}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <>
      {/* 页签:全部 + 有行的每种业务 */}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 18 }}>
        <button className={`chip ${svc === 'all' ? 'active' : ''}`} onClick={() => setSvc('all')} data-testid="reg-tab-all">
          {t('全部业务', 'All services')} <span style={{ opacity: 0.6 }}>{every.length}</span>
        </button>
        {tabs.map(({ svc: sv, n }) => (
          <button key={sv || '_'} className={`chip ${svc === sv ? 'active' : ''}`} onClick={() => setSvc(sv)} data-testid={`reg-tab-${sv || 'none'}`}
            style={svc === sv && sv ? { borderColor: svcColor(sv), boxShadow: `inset 0 0 0 1px ${svcColor(sv)}` } : undefined}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: sv ? svcColor(sv) : '#aaa', display: 'inline-block' }} />
            {sv ? svcName(sv, lang) : t('未对应业务', 'Not matched')} <span style={{ opacity: 0.6 }}>{n}</span>
          </button>
        ))}
      </div>

      <div className="kpi-grid four">
        {kpi.map(([label, val, color], i) => (
          <div key={i} className="kpi" style={{ padding: '18px 20px' }}>
            <div className="kpi-label">{label}</div>
            <div className="tnum" style={{ fontSize: 30, fontWeight: 600, color: color as string, marginTop: 6, lineHeight: 1 }}>{val}</div>
          </div>
        ))}
      </div>

      {/* filter bar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <input className="in sm" placeholder={t('搜索项目 / 客户 / 4 栏内容', 'Search project / client / any column')} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} data-testid="reg-search" />
        <select className="in sm" value={pm} onChange={(e) => setPm(e.target.value)} style={{ width: 'auto' }}>
          <option value="">{t('全部 PM', 'All PM')}</option>
          {pms.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select className="in sm" value={client} onChange={(e) => setClient(e.target.value)} style={{ width: 'auto', maxWidth: 200 }} title={t('按客户筛选', 'Filter by client')}>
          <option value="">{t('全部客户', 'All clients')}</option>
          {clients.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="in sm" value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 'auto' }} title={t('按交付年份(没有交付日的按建档年份)', 'By delivery year (creation year if no delivery date)')}>
          <option value="">{t('全部年份', 'All years')}</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        {(q || pm || client || year) && (
          <button className="btn-line sm" onClick={() => { setQ(''); setPm(''); setClient(''); setYear(''); }}>✕ {t('清除筛选', 'Clear filters')}</button>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--text2)' }} data-testid="reg-count">{t(`${rows.length} 行`, `${rows.length} rows`)}</span>
        <button className="btn-line sm" onClick={() => setAdding(true)} data-testid="reg-add"><Icon name="plus" size={13} />{t('新增一行', 'Add row')}</button>
        {canImport && <button className="btn-line sm" onClick={() => fileInput(projects, (pv) => setImp(pv))} data-testid="reg-import">{t('导入 CSV', 'Import CSV')}</button>}
        <button className="btn-line sm" onClick={() => downloadTemplate(svc, lang)} title={t('下载导入模板', 'Download import template')}>{t('模板', 'Template')}</button>
        <button className="btn-line sm" onClick={exportCsv} disabled={rows.length === 0} data-testid="reg-export"><Icon name="download" size={13} />{t('导出 CSV', 'Export CSV')}</button>
      </div>

      <div className="panel clip">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 960 }} data-testid="reg-table">
            <thead>
              <tr>
                <SortTh k="project" label={t('项目', 'Project')} sort={sort} setSort={setSort} />
                <SortTh k="client" label={t('客户', 'Client')} sort={sort} setSort={setSort} />
                <SortTh k="pm" label="PM" sort={sort} setSort={setSort} />
                <SortTh k="svc" label={t('业务', 'Service')} sort={sort} setSort={setSort} />
                {(['item', 'detail', 'qty', 'note'] as const).map((k, i) => <SortTh key={k} k={k} label={JOB_HEAD_EN[i]} sort={sort} setSort={setSort} />)}
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr><td style={{ ...cell, color: 'var(--text2)', textAlign: 'center' }} colSpan={8}>{t('没有匹配的记录。', 'No matching records.')}</td></tr>
              )}
              {pageRows.map((x) => {
                const can = canEditIn(me, x.p, 'record');
                return (
                  <tr key={`${x.p.id}:${x.r.id}`} className="row-hover" data-testid="reg-row">
                    <td style={{ ...cell, fontWeight: 600, color: 'var(--navy900)', cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => openProject(x.p.id)}>{x.p.name}</td>
                    <td style={{ ...cell, color: 'var(--text2)', whiteSpace: 'nowrap' }}>{x.p.client || '—'}</td>
                    <td style={{ ...cell, whiteSpace: 'nowrap' }}>{(x.p.owners || [])[0] || <span style={{ color: '#b6bfc9' }}>—</span>}</td>
                    <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                      {x.svc ? <span className="badge" style={{ background: 'var(--hover-bg)', color: 'var(--text2)' }}><span className="bdot" style={{ background: svcColor(x.svc) }} />{svcName(x.svc, lang)}</span>
                        : <span className="badge" style={{ background: '#fdecec', color: 'var(--danger)' }}>{t('未对应', 'not matched')}</span>}
                    </td>
                    {(['item', 'detail', 'qty', 'note'] as JobField[]).map((f) => {
                      const key = `${x.r.id}:${f}`;
                      return (
                        <td key={f} style={{ ...cell, maxWidth: f === 'qty' ? 110 : 260, padding: editing === key ? 4 : undefined }}>
                          {editing === key ? (
                            <CellEditor val={x.r[f]} multi={f === 'detail' || f === 'note'}
                              onDone={async (v) => {
                                if (v !== x.r[f]) await dispatch(x.p.id, { type: 'editJobRow', id: x.r.id, field: f, value: v });
                                setEditing(null);
                              }}
                              onCancel={() => setEditing(null)} />
                          ) : (
                            <div onClick={() => can && setEditing(key)} title={can ? t('点击就地编辑', 'Click to edit') : undefined} data-testid={`reg-cell-${f}`}
                              style={{ cursor: can ? 'text' : 'default', minHeight: 18 }}>
                              {x.r[f]
                                ? <span title={x.r[f]} style={{ fontSize: 12.5, whiteSpace: f === 'note' || f === 'detail' ? 'pre-wrap' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block', maxWidth: '100%' }}>{x.r[f]}</span>
                                : <span style={{ color: '#c3ccd4' }}>—</span>}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, padding: '10px 18px', borderTop: '1px solid var(--row-line)' }}>
            <button className="btn-line sm" disabled={page === 0} onClick={() => setPage((v) => v - 1)}>{t('上一页', 'Prev')}</button>
            <span className="tnum" style={{ fontSize: 12.5, color: 'var(--text2)' }}>{page + 1} / {pages}</span>
            <button className="btn-line sm" disabled={page >= pages - 1} onClick={() => setPage((v) => v + 1)}>{t('下一页', 'Next')}</button>
          </div>
        )}
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 12 }}>
        {t('说明:这里汇总的是各项目 Job Record 的 4 栏表(Service Item / Detail / Quantity / Special Notes),所有业务都在。加 / 删行、粘贴报价单在项目的 Job Record 页里做;原来各业务登记表的字段在那里「旧字段(只读)」里看。',
          'Note: this lists every project\'s Job Record table (Service Item / Detail / Quantity / Special Notes) for all services. Add / delete rows and paste quotations on the project\'s Job Record tab; the old per-service register fields are under "Old fields (read-only)" there.')}
      </div>

      {adding && <AddModal tabSvc={svc} projects={projects.filter((p) => !p.archived && canEditIn(me, p, 'record'))} onClose={() => setAdding(false)}
        onSave={async (p, sv, values) => {
          if (!p.packages.some((x) => x.svc === sv) && !(await dispatch(p.id, { type: 'addServicePackage', svc: sv, patch: {} }))) return;
          if (await dispatch(p.id, { type: 'addJobRow', svc: sv, values })) { setAdding(false); setToast(t('已新增一行', 'Row added')); }
        }} />}

      {imp && <ImportModal preview={imp} tabSvc={svc} onClose={() => setImp(null)}
        onConfirm={async () => {
          try {
            const res = await fetch(`/api/registers/${encodeURIComponent(svc || 'all')}/import`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jobRows: imp.rows }),
            });
            const data = await res.json();
            if (!res.ok) { setToast((lang === 'zh' ? '导入失败:' : 'Import failed: ') + (data.error || '')); return; }
            setImp(null);
            await refresh();
            setToast(t(`已导入 ${data.rows} 行(${data.updated} 个项目)`, `Imported ${data.rows} rows (${data.updated} projects)`));
          } catch { setToast(t('导入失败', 'Import failed')); }
        }} />}
    </>
  );
}

type ImportRow = { project: string; no: string; svc: string; item: string; detail: string; qty: string; note: string };
interface ImportPreview { rows: ImportRow[]; error?: string; matched: number; unmatched: string[] }

/* 选文件 → 解析 CSV → 认 4 栏表头(中英都认)+ 项目 / 项目编号 / 业务栏 */
function fileInput(projects: Project[], onReady: (pv: ImportPreview) => void) {
  const el = document.createElement('input');
  el.type = 'file';
  el.accept = '.csv,text/csv';
  el.onchange = () => {
    const f = el.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const grid = parseCsv(String(reader.result || ''));
      const m = grid.length ? jobHeaderMap(grid[0]) : null;
      const c = grid.length ? jobImportCols(grid[0]) : { project: -1, no: -1, svc: -1 };
      if (!m || (c.project < 0 && c.no < 0)) {
        onReady({ rows: [], matched: 0, unmatched: [], error: 'head' });
        return;
      }
      const at = (cols: string[], i: number) => (i >= 0 ? (cols[i] || '').trim() : '');
      const rows: ImportRow[] = grid.slice(1).map((cols) => ({
        project: at(cols, c.project), no: at(cols, c.no), svc: at(cols, c.svc),
        item: at(cols, m.item), detail: at(cols, m.detail), qty: at(cols, m.qty), note: at(cols, m.note),
      })).filter((r) => (r.project || r.no) && (r.item || r.detail || r.qty || r.note));
      const live = projects.filter((p) => !p.archived);
      const found = (r: ImportRow) => live.some((p) => (r.no && projCode(p) && String(p.serial) === r.no.replace(/^0+/, '')) || (r.project && p.name.trim().toLowerCase() === r.project.toLowerCase()));
      const bad = rows.filter((r) => !found(r));
      onReady({ rows, matched: rows.length - bad.length, unmatched: [...new Set(bad.map((r) => r.project || r.no))] });
    };
    reader.readAsText(f);
  };
  el.click();
}

/* minimal RFC-4180-ish CSV parser (handles quotes, escaped quotes, CRLF) */
function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let field = '', row: string[] = [], inQ = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function downloadTemplate(svc: string, lang: 'zh' | 'en') {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const zh = lang === 'zh';
  const head = [zh ? '项目' : 'Project', zh ? '业务' : 'Service', ...(zh ? JOB_HEAD_ZH : JOB_HEAD_EN)];
  const sv = svc && svc !== 'all' ? svc : 'cgi';
  const example = [zh ? '(填已有项目名称)' : '(existing project name)', svcName(sv, lang), serviceItemOf(sv), 'Hero - with surrounding', '2', 'at least 5,000 px'];
  const csv = [head, example].map((r) => r.map(esc).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = `register-${svc || 'all'}-template.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function AddModal({ tabSvc, projects, onClose, onSave }: {
  tabSvc: string; projects: Project[]; onClose: () => void;
  onSave: (p: Project, svc: string, values: Record<JobField, string>) => Promise<void>;
}) {
  const { lang, t } = useLang();
  const [pid, setPid] = useState('');
  const [svc, setSvc] = useState(tabSvc !== 'all' && SVC[tabSvc] ? tabSvc : '');
  const [v, setV] = useState<Record<JobField, string>>({ item: '', detail: '', qty: '', note: '' });
  const [busy, setBusy] = useState(false);
  const p = projects.find((x) => x.id === pid);
  const has = (k: string) => !!p?.packages.some((x) => x.svc === k);
  const set = (k: JobField, val: string) => setV((x) => ({ ...x, [k]: val }));

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <h2>{t('新增一行', 'Add row')}</h2>
        <div className="msub">{t('选项目和业务,填 4 栏。项目里还没有这项业务的,会先给它加上(排期和信息清单照常生成)。', 'Pick a project and service and fill the four columns. If the project lacks the service it is added first (schedule and checklist as usual).')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '10px 12px', alignItems: 'center', margin: '10px 0 16px' }}>
          <label style={lbl}>{t('项目', 'Project')} <span style={{ color: 'var(--danger)' }}>*</span></label>
          <select className="in sm" value={pid} onChange={(e) => setPid(e.target.value)} data-testid="reg-add-project">
            <option value="">{t('— 选择项目 —', '— select project —')}</option>
            {projects.map((x) => <option key={x.id} value={x.id}>{projCode(x) ? projCode(x) + ' · ' : ''}{x.name}</option>)}
          </select>
          <label style={lbl}>{t('业务', 'Service')} <span style={{ color: 'var(--danger)' }}>*</span></label>
          <select className="in sm" value={svc} onChange={(e) => setSvc(e.target.value)} data-testid="reg-add-svc">
            <option value="">{t('— 选择业务 —', '— select service —')}</option>
            {Object.keys(SVC).map((k) => <option key={k} value={k}>{svcName(k, lang)}{p && !has(k) ? t('(会新增这项业务)', ' (adds this service)') : ''}</option>)}
          </select>
          {(['item', 'detail', 'qty', 'note'] as JobField[]).map((f, i) => (
            <React.Fragment key={f}>
              <label style={lbl}>{JOB_HEAD_EN[i]}{lang === 'zh' ? ` ${JOB_HEAD_ZH[i]}` : ''}</label>
              {f === 'note' || f === 'detail'
                ? <textarea className="in sm" value={v[f]} onChange={(e) => set(f, e.target.value)} style={{ minHeight: 40 }} data-testid={`reg-add-${f}`} />
                : <input className="in sm" value={v[f]} onChange={(e) => set(f, e.target.value)} data-testid={`reg-add-${f}`}
                  placeholder={f === 'item' && svc ? serviceItemOf(svc) : f === 'qty' ? '2 / 180s / 1 set' : ''} />}
            </React.Fragment>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn-line sm" onClick={onClose} disabled={busy}>{t('取消', 'Cancel')}</button>
          <button className="btn-navy sm" disabled={busy || !p || !svc} data-testid="reg-add-go"
            onClick={async () => { setBusy(true); await onSave(p!, svc, { ...v, item: v.item.trim() || serviceItemOf(svc) }); setBusy(false); }}>
            {busy ? t('保存中…', 'Saving…') : t('新增', 'Add')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportModal({ preview, tabSvc, onClose, onConfirm }: { preview: ImportPreview; tabSvc: string; onClose: () => void; onConfirm: () => Promise<void> }) {
  const { lang, t } = useLang();
  const [busy, setBusy] = useState(false);
  const noSvc = tabSvc === 'all' ? preview.rows.filter((r) => !svcFromName(r.svc) && !svcFromName(r.item)).length : 0;
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 680 }}>
        <h2>{t('导入预览', 'Import preview')} · {tabSvc === 'all' ? t('全部业务', 'All services') : svcName(tabSvc, lang)}</h2>
        <div className="msub">
          {t('认 4 栏表头 Service Item / Detail / Quantity / Special Notes(中文「服务项目 / 明细 / 数量 / 特别说明」也认),按「项目」名称或「项目编号」找项目;有「业务」栏按它归组,没有就归到当前页签的业务。按行追加,全有或全无 —— 任一行出错整批不写入。',
            'Recognises the four headers Service Item / Detail / Quantity / Special Notes (Chinese headers too) and matches projects by "Project" name or "Project no."; a "Service" column decides the group, otherwise the current tab\'s service. Rows are appended, all-or-nothing — one bad row aborts the whole batch.')}
        </div>
        {preview.error === 'head' ? (
          <div style={{ fontSize: 12.5, color: 'var(--danger)', background: '#fdecec', borderRadius: 8, padding: '9px 12px' }}>
            {t('表头认不出:要有「项目」(或「项目编号」)和 Service Item 栏,外加 Detail / Quantity / Special Notes 至少一栏。可以先下载「模板」。',
              'Headers not recognised: need "Project" (or "Project no.") and Service Item, plus at least one of Detail / Quantity / Special Notes. Download the template first.')}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 20, margin: '14px 0' }}>
              <Stat label={t('总行数', 'Rows')} value={preview.rows.length} />
              <Stat label={t('可匹配', 'Matched')} value={preview.matched} color="var(--success)" />
              <Stat label={t('未匹配项目', 'Unmatched projects')} value={preview.unmatched.length} color={preview.unmatched.length ? 'var(--danger)' : 'var(--text2)'} />
            </div>
            {preview.unmatched.length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--danger)', background: '#fdecec', borderRadius: 8, padding: '9px 12px', marginBottom: 12 }}>
                {t('以下项目在系统中找不到,请先核对(导入会整批失败):', 'These projects were not found — fix them first (the import will fail as a batch):')}
                <div style={{ marginTop: 5, fontWeight: 600 }}>{preview.unmatched.slice(0, 12).join(' · ')}{preview.unmatched.length > 12 ? ' …' : ''}</div>
              </div>
            )}
            {noSvc > 0 && (
              <div style={{ fontSize: 12, color: '#92600a', background: '#fef3c7', borderRadius: 8, padding: '9px 12px', marginBottom: 12 }}>
                {t(`有 ${noSvc} 行没有「业务」栏,将按 Service Item 去对项目里的业务;对不上的整批会失败。`, `${noSvc} rows have no Service column and will be matched by Service Item; if any can't be matched the batch fails.`)}
              </div>
            )}
            {preview.rows.length > 0 && (
              <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--row-line)', borderRadius: 6 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <tbody>
                    <tr>{[t('项目', 'Project'), t('业务', 'Service'), ...JOB_HEAD_EN].map((h) => <th key={h} style={{ textAlign: 'left', padding: '5px 7px', background: 'var(--hover-bg)' }}>{h}</th>)}</tr>
                    {preview.rows.slice(0, 30).map((r, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--row-line2)' }}>
                        {[r.project || r.no, r.svc, r.item, r.detail, r.qty, r.note].map((c, j) => <td key={j} style={{ padding: '4px 7px' }}>{c}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {preview.rows.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>{t('没有可导入的行。', 'No importable rows.')}</div>}
          </>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button className="btn-line sm" onClick={onClose} disabled={busy}>{t('取消', 'Cancel')}</button>
          <button className="btn-navy sm" disabled={busy || preview.rows.length === 0 || preview.unmatched.length > 0} data-testid="reg-import-go"
            onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); }}>
            {busy ? t('导入中…', 'Importing…') : t(`确认导入 ${preview.rows.length} 行`, `Import ${preview.rows.length} rows`)}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>{label}</div>
      <div className="tnum" style={{ fontSize: 24, fontWeight: 600, color: color || 'var(--navy900)' }}>{value}</div>
    </div>
  );
}

const th: React.CSSProperties = { padding: '11px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase', color: 'var(--text2)', background: 'var(--hover-bg)', textAlign: 'left', whiteSpace: 'nowrap', borderBottom: '1px solid var(--row-line)' };
const cell: React.CSSProperties = { padding: '10px 14px', fontSize: 13, borderTop: '1px solid var(--row-line)', verticalAlign: 'top' };
const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: 'var(--text2)' };

/* REQ-033: 可点排序的列头(与 REQ-025 项目列表同一手感) */
function SortTh({ k, label, sort, setSort }: {
  k: SortKey; label: string;
  sort: { key: SortKey; dir: 1 | -1 } | null;
  setSort: React.Dispatch<React.SetStateAction<{ key: SortKey; dir: 1 | -1 } | null>>;
}) {
  const on = sort?.key === k;
  return (
    <th style={th}>
      <button
        onClick={() => setSort((s) => (s && s.key === k ? (s.dir === 1 ? { key: k, dir: -1 } : null) : { key: k, dir: 1 }))}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, font: 'inherit', color: on ? 'var(--navy900)' : 'inherit', cursor: 'pointer', background: 'none' }}>
        {label}
        <span style={{ fontSize: 9, opacity: on ? 1 : 0.25 }}>{on ? (sort!.dir === 1 ? '▲' : '▼') : '⇅'}</span>
      </button>
    </th>
  );
}

/* REQ-033: 单元格就地编辑器。回车 / 失焦保存,Esc 取消(多行的栏 Ctrl+Enter 保存) */
function CellEditor({ val, multi, onDone, onCancel }: { val: string; multi: boolean; onDone: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(val);
  const done = React.useRef(false);   // 回车保存后还会再失焦一次:只存一次
  const commit = () => { if (done.current) return; done.current = true; onDone(v.trim()); };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    if (e.key === 'Enter' && (!multi || e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
  };
  return multi
    ? <textarea className="in sm" autoFocus value={v} onKeyDown={keys} onBlur={commit} onChange={(e) => setV(e.target.value)} style={{ width: '100%', minHeight: 46 }} data-testid="reg-editor" />
    : <input className="in sm" autoFocus value={v} onKeyDown={keys} onBlur={commit} onChange={(e) => setV(e.target.value)} style={{ width: '100%' }} data-testid="reg-editor" />;
}
