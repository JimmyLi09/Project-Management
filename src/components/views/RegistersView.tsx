'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { canEdit, isFull } from '@/lib/permissions';
import { svcName, svcColor } from '@/lib/templates';
import { todayMid, fmtDate, projCode } from '@/lib/project';
import { useLang } from '@/lib/i18n';
import { Icon } from '../ui';
import {
  REGISTERS, registerDef, statusFamily, statusMeta, defaultStatus, recordVal, fieldsOf, formulaText,
  isIncomplete, isExpiring, type RegisterDef, type FieldDef,
} from '@/lib/records';
import type { Project, ServicePackage } from '@/lib/types';

interface Row { p: Project; pi: number; pk: ServicePackage; }
const PAGE = 20;

/* representative date for Year filter + "expiring" watch */
function mainDate(def: RegisterDef, pk: ServicePackage): string {
  const keys = def.kind === 'install' ? ['installation', 'installDate'] : [def.watchDateKey || '', 'completedDate', 'deliveryDate', 'handoverDate'];
  for (const k of keys) { if (k) { const v = recordVal(pk.record, k); if (v) return v; } }
  return '';
}

export default function RegistersView() {
  const { projects, me, dispatch, openProject, refresh, setToast, recordFields } = useStore();
  const { lang, t } = useLang();
  const [svc, setSvc] = useState(REGISTERS[0].svc);
  const [q, setQ] = useState('');
  const [pm, setPm] = useState('');
  const [status, setStatus] = useState('');
  const [year, setYear] = useState('');
  const [page, setPage] = useState(0);
  const [edit, setEdit] = useState<Row | null>(null);
  const [adding, setAdding] = useState(false);
  const [imp, setImp] = useState<ImportPreview | null>(null);
  const canImport = isFull(me);

  /* REQ-023: 把用户改过的字段并进 def —— 下游所有 def.fields(表头、导出、
     导入模板、编辑弹窗…)自动跟着走,不用一处处改。 */
  const baseDef = registerDef(svc)!;
  const def = useMemo<RegisterDef>(() => ({ ...baseDef, fields: fieldsOf(baseDef, recordFields) }), [baseDef, recordFields]);
  const t0 = todayMid();

  const all = useMemo<Row[]>(() => {
    const out: Row[] = [];
    projects.forEach((p) => {
      if (p.archived) return;
      p.packages.forEach((pk, pi) => { if (pk.svc === svc) out.push({ p, pi, pk }); });
    });
    return out;
  }, [projects, svc]);

  const pms = useMemo(() => {
    const s = new Set<string>();
    all.forEach((r) => (r.p.owners || []).forEach((n) => s.add(n)));
    return [...s].sort();
  }, [all]);
  const years = useMemo(() => {
    const s = new Set<string>();
    all.forEach((r) => { const d = mainDate(def, r.pk); const y = d ? d.slice(0, 4) : String(new Date(r.p.created).getFullYear()); if (y) s.add(y); });
    return [...s].sort().reverse();
  }, [all, def]);

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return all.filter((r) => {
      const st = (r.pk.record?.status as string) || defaultStatus(def.kind);
      if (status && st !== status) return false;
      if (pm && !(r.p.owners || []).includes(pm)) return false;
      if (year) { const d = mainDate(def, r.pk); const y = d ? d.slice(0, 4) : String(new Date(r.p.created).getFullYear()); if (y !== year) return false; }
      if (ql) {
        const hay = [r.p.name, r.p.client, recordVal(r.pk.record, 'developer'), recordVal(r.pk.record, 'siteAddress'), recordVal(r.pk.record, 'mainCon')].join(' ').toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
  }, [all, q, pm, status, year, def]);

  // KPIs
  const kpi = useMemo(() => {
    if (def.kind === 'install') {
      const by = (k: string) => all.filter((r) => ((r.pk.record?.status as string) || defaultStatus('install')) === k).length;
      return [
        [t('总数', 'Total'), all.length, 'var(--navy900)'],
        [t('待签收', 'Pending sign-off'), by('pending_signoff'), 'var(--warning)'],
        [t('已签收', 'Signed off'), by('signed_off'), 'var(--success)'],
        [t('待启动', 'Pending launch'), by('pending_launch'), 'var(--info)'],
      ] as const;
    }
    const expiring = all.filter((r) => isExpiring(def, r.pk.record, t0)).length;
    const delivered = all.filter((r) => ((r.pk.record?.status as string) || 'draft') === 'delivered').length;
    const incomplete = all.filter((r) => isIncomplete(def, r.pk.record)).length;
    return [
      [t('总数', 'Total'), all.length, 'var(--navy900)'],
      [t('即将到期', 'Expiring'), expiring, expiring ? 'var(--warning)' : 'var(--navy900)'],
      [t('已交付', 'Delivered'), delivered, 'var(--success)'],
      [t('资料不完整', 'Incomplete'), incomplete, incomplete ? 'var(--danger)' : 'var(--success)'],
    ] as const;
  }, [all, def, t0, t]);

  const pageRows = rows.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.ceil(rows.length / PAGE) || 1;
  React.useEffect(() => { setPage(0); }, [svc, q, pm, status, year]);

  function exportCsv() {
    const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = [t('项目', 'Project'), t('客户', 'Client'), 'PM', t('状态', 'Status'), ...def.fields.map((f) => (lang === 'zh' ? f.zh : f.en))];
    const body = rows.map((r) => {
      const sm = statusMeta(def.kind, (r.pk.record?.status as string) || defaultStatus(def.kind));
      return [(projCode(r.p) ? projCode(r.p) + ' ' : '') + r.p.name, r.p.client || '', (r.p.owners || []).join(' / '), lang === 'zh' ? sm[1] : sm[2],
        ...def.fields.map((f) => (f.type === 'formula' ? formulaText(f, def.fields, r.pk.record) : recordVal(r.pk.record, f.key)).replace(/\n/g, ' '))];
    });
    const csv = [head, ...body].map((r) => r.map(esc).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `register-${svc}-${fmtDate(t0)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <>
      {/* register tabs */}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 18 }}>
        {REGISTERS.map((r) => (
          <button key={r.svc} className={`chip ${svc === r.svc ? 'active' : ''}`} onClick={() => setSvc(r.svc)}
            style={svc === r.svc ? { borderColor: svcColor(r.svc), boxShadow: `inset 0 0 0 1px ${svcColor(r.svc)}` } : undefined}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: svcColor(r.svc), display: 'inline-block' }} />
            {svcName(r.svc, lang)}
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
        <input className="in sm" placeholder={t('搜索项目 / 客户 / Developer', 'Search project / client / developer')} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />
        <select className="in sm" value={pm} onChange={(e) => setPm(e.target.value)} style={{ width: 'auto' }}>
          <option value="">{t('全部 PM', 'All PM')}</option>
          {pms.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select className="in sm" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }}>
          <option value="">{t('全部状态', 'All status')}</option>
          {statusFamily(def.kind).map((s) => <option key={s[0]} value={s[0]}>{lang === 'zh' ? s[1] : s[2]}</option>)}
        </select>
        <select className="in sm" value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 'auto' }}>
          <option value="">{t('全部年份', 'All years')}</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--text2)' }}>{t(`${rows.length} 条`, `${rows.length} rows`)}</span>
        {canEdit(me, projects[0] || ({} as Project)) || isFull(me) ? (
          <button className="btn-line sm" onClick={() => setAdding(true)}><Icon name="plus" size={13} />{t('新增记录', 'Add record')}</button>
        ) : null}
        {canImport && <button className="btn-line sm" onClick={() => fileInput(def, (pv) => setImp(pv))}>{t('导入 CSV', 'Import CSV')}</button>}
        <button className="btn-line sm" onClick={() => downloadTemplate(def, lang)} title={t('下载导入模板', 'Download import template')}>{t('模板', 'Template')}</button>
        <button className="btn-line sm" onClick={exportCsv} disabled={rows.length === 0}><Icon name="download" size={13} />{t('导出 CSV', 'Export CSV')}</button>
      </div>

      {!def.confirmed && (
        <div style={{ fontSize: 12, color: 'var(--text2)', background: '#fbf3e6', border: '1px solid var(--bronze)', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
          {t('本登记表的专属列为建议列,待 PD 确认后可微调(改 src/lib/records.ts 即可)。',
             'Columns for this register are suggested — PD to confirm; tweak in src/lib/records.ts.')}
        </div>
      )}

      {/* table */}
      <div className="panel clip">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr>
                <th style={th}>{t('项目', 'Project')}</th>
                <th style={th}>{t('客户', 'Client')}</th>
                <th style={th}>PM</th>
                <th style={th}>{t('状态', 'Status')}</th>
                {def.fields.map((f) => <th key={f.key} style={th}>{lang === 'zh' ? f.zh : f.en}</th>)}
                <th style={{ ...th, textAlign: 'right' }}>{t('操作', 'Action')}</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr><td style={{ ...cell, color: 'var(--text2)', textAlign: 'center' }} colSpan={5 + def.fields.length}>{t('没有匹配的记录。', 'No matching records.')}</td></tr>
              )}
              {pageRows.map((r) => {
                const rec = r.pk.record;
                const sm = statusMeta(def.kind, (rec?.status as string) || defaultStatus(def.kind));
                const inc = isIncomplete(def, rec);
                const exp = isExpiring(def, rec, t0);
                return (
                  <tr key={`${r.p.id}:${r.pi}`} className="row-hover">
                    <td style={{ ...cell, fontWeight: 600, color: 'var(--navy900)', cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => openProject(r.p.id)}>
                      {projCode(r.p) && <span className="tnum" style={{ color: 'var(--bronze)', marginRight: 6 }}>{projCode(r.p)}</span>}{r.p.name}
                    </td>
                    <td style={{ ...cell, color: 'var(--text2)', whiteSpace: 'nowrap' }}>{r.p.client || '—'}</td>
                    <td style={{ ...cell, whiteSpace: 'nowrap' }}>{(r.p.owners || [])[0] || <span style={{ color: '#b6bfc9' }}>—</span>}</td>
                    <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                      <span className="badge" style={{ background: 'var(--hover-bg)', color: sm[3] }}><span className="bdot" style={{ background: sm[3] }} />{lang === 'zh' ? sm[1] : sm[2]}</span>
                      {exp && <span className="badge" style={{ background: '#fef3c7', color: '#92600a', marginLeft: 4 }}>{t('即将到期', 'expiring')}</span>}
                      {inc && <span className="badge" style={{ background: '#fdecec', color: 'var(--danger)', marginLeft: 4 }}>{t('缺资料', 'incomplete')}</span>}
                    </td>
                    {/* REQ-027: 公式列在这里也是算出来的,和 Job Record 同一份定义、同一个结果 */}
                    {def.fields.map((f) => (
                      <td key={f.key} style={{ ...cell, maxWidth: 220 }}>
                        <CellVal f={f} val={f.type === 'formula' ? formulaText(f, def.fields, rec) : recordVal(rec, f.key)} />
                      </td>
                    ))}
                    <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {canEdit(me, r.p)
                        ? <button className="btn-line sm" style={{ padding: '3px 9px' }} onClick={() => setEdit(r)}>{t('编辑', 'Edit')}</button>
                        : <button className="btn-line sm" style={{ padding: '3px 9px' }} onClick={() => openProject(r.p.id)}>{t('查看', 'View')}</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, padding: '10px 18px', borderTop: '1px solid var(--row-line)' }}>
            <button className="btn-line sm" disabled={page === 0} onClick={() => setPage((x) => x - 1)}>{t('上一页', 'Prev')}</button>
            <span className="tnum" style={{ fontSize: 12.5, color: 'var(--text2)' }}>{page + 1} / {pages}</span>
            <button className="btn-line sm" disabled={page >= pages - 1} onClick={() => setPage((x) => x + 1)}>{t('下一页', 'Next')}</button>
          </div>
        )}
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 12 }}>
        {t('说明:记录来自各项目已有的对应服务包;「新增记录」与 CSV 批量导入为下一阶段(需选项目+事务导入)。',
           'Note: records come from existing service packages on projects. "Add record" and CSV import land in the next stage (need project pick + transactional import).')}
      </div>

      {edit && <EditModal row={edit} def={def} onClose={() => setEdit(null)} onSave={async (patch) => {
        const ok = await dispatch(edit.p.id, { type: 'setRecord', pkg: edit.pi, patch });
        if (ok) setEdit(null);
      }} />}

      {adding && <AddModal def={def} projects={projects.filter((p) => !p.archived)} onClose={() => setAdding(false)}
        onSave={async (projectId, patch) => {
          const ok = await dispatch(projectId, { type: 'addServicePackage', svc: def.svc, patch });
          if (ok) { setAdding(false); setToast(t('已新增记录', 'Record added')); }
        }} />}

      {imp && <ImportModal preview={imp} def={def} onClose={() => setImp(null)}
        onConfirm={async () => {
          try {
            const res = await fetch(`/api/registers/${def.svc}/import`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ rows: imp.rows }),
            });
            const data = await res.json();
            if (!res.ok) { setToast((lang === 'zh' ? '导入失败:' : 'Import failed: ') + (data.error || '')); return; }
            setImp(null);
            await refresh();
            setToast(t(`已导入 ${data.updated} 条`, `Imported ${data.updated}`));
          } catch { setToast(t('导入失败', 'Import failed')); }
        }} />}
    </>
  );
}

interface ImportPreview { rows: { project: string; patch: Record<string, string> }[]; unmatched: string[]; total: number; }

/* open a file picker, parse CSV, resolve headers against the register def */
function fileInput(def: RegisterDef, onReady: (pv: ImportPreview) => void) {
  const el = document.createElement('input');
  el.type = 'file';
  el.accept = '.csv,text/csv';
  el.onchange = () => {
    const f = el.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const grid = parseCsv(String(reader.result || ''));
      if (grid.length < 2) { onReady({ rows: [], unmatched: [], total: 0 }); return; }
      const map = resolveHeaders(def, grid[0]);
      const rows: { project: string; patch: Record<string, string> }[] = [];
      for (let i = 1; i < grid.length; i++) {
        const cols = grid[i];
        let project = '';
        const patch: Record<string, string> = {};
        Object.entries(map).forEach(([idx, m]) => {
          const v = (cols[+idx] || '').trim();
          if (m.kind === 'project') project = v;
          else if (m.kind === 'status') { const k = resolveStatus(def, v); if (k) patch.status = k; }
          else if (m.kind === 'field' && v) patch[m.key!] = v;
        });
        if (project) rows.push({ project, patch });
      }
      onReady({ rows, unmatched: [], total: rows.length });
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

function resolveHeaders(def: RegisterDef, headers: string[]): Record<number, { kind: 'project' | 'status' | 'field'; key?: string }> {
  const byLabel: Record<string, string> = {};
  def.fields.forEach((f) => { byLabel[f.zh.toLowerCase()] = f.key; byLabel[f.en.toLowerCase()] = f.key; byLabel[f.key.toLowerCase()] = f.key; });
  const map: Record<number, { kind: 'project' | 'status' | 'field'; key?: string }> = {};
  headers.forEach((h, idx) => {
    const hl = h.trim().toLowerCase();
    if (['项目', 'project', '项目名称'].includes(hl)) map[idx] = { kind: 'project' };
    else if (['状态', 'status'].includes(hl)) map[idx] = { kind: 'status' };
    else if (byLabel[hl]) map[idx] = { kind: 'field', key: byLabel[hl] };
  });
  return map;
}

function resolveStatus(def: RegisterDef, v: string): string {
  const vl = v.trim().toLowerCase();
  if (!vl) return '';
  const s = statusFamily(def.kind).find((x) => x[0] === vl || x[1].toLowerCase() === vl || x[2].toLowerCase() === vl);
  return s ? s[0] : '';
}

function downloadTemplate(def: RegisterDef, lang: 'zh' | 'en') {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const head = [lang === 'zh' ? '项目' : 'Project', lang === 'zh' ? '状态' : 'Status', ...def.fields.map((f) => (lang === 'zh' ? f.zh : f.en))];
  const example = [lang === 'zh' ? '（填已有项目名称）' : '(existing project name)', statusFamily(def.kind)[0][lang === 'zh' ? 1 : 2], ...def.fields.map(() => '')];
  const csv = [head, example].map((r) => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `register-${def.svc}-template.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function AddModal({ def, projects, onClose, onSave }: { def: RegisterDef; projects: Project[]; onClose: () => void; onSave: (projectId: string, patch: Record<string, string>) => void }) {
  const { lang, t } = useLang();
  const [pid, setPid] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({ status: defaultStatus(def.kind) });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setDraft((x) => ({ ...x, [k]: v }));
  const withSvc = new Set(projects.filter((p) => p.packages.some((pk) => pk.svc === def.svc)).map((p) => p.id));

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ margin: 0 }}>{t('新增记录', 'Add record')} · {svcName(def.svc, lang)}</h2>
          <div style={{ flex: 1 }} />
          <button className="btn-line sm" onClick={onClose}>{t('关闭', 'Close')}</button>
        </div>
        <div className="msub">{t('选择项目并填写资料;若该项目还没有此业务,会自动为其建立。', 'Pick a project and fill the record; the service is created for it if missing.')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '10px 12px', alignItems: 'center', margin: '10px 0 16px' }}>
          <label style={lbl}>{t('项目', 'Project')} <span style={{ color: 'var(--danger)' }}>*</span></label>
          <select className="in sm" value={pid} onChange={(e) => setPid(e.target.value)}>
            <option value="">{t('— 选择项目 —', '— select project —')}</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}{withSvc.has(p.id) ? t('（已有此业务·将更新）', ' (has service · updates)') : ''}</option>)}
          </select>
          <label style={lbl}>{t('状态', 'Status')}</label>
          <select className="in sm" value={draft.status} onChange={(e) => set('status', e.target.value)}>
            {statusFamily(def.kind).map((s) => <option key={s[0]} value={s[0]}>{lang === 'zh' ? s[1] : s[2]}</option>)}
          </select>
          {def.fields.map((f) => (
            <React.Fragment key={f.key}>
              <label style={lbl}>{lang === 'zh' ? f.zh : f.en}{f.required && <span style={{ color: 'var(--danger)' }}> *</span>}</label>
              {f.type === 'textarea'
                ? <textarea className="in sm" value={draft[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} style={{ minHeight: 46 }} />
                : f.type === 'select'
                  ? <select className="in sm" value={draft[f.key] || ''} onChange={(e) => set(f.key, e.target.value)}><option value="">—</option>{(f.options || []).map((o) => <option key={o[0]} value={o[0]}>{lang === 'zh' ? o[1] : o[2]}</option>)}</select>
                  : <input className="in sm" type={f.type === 'date' ? 'date' : 'text'} value={draft[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} />}
            </React.Fragment>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn-line sm" onClick={onClose} disabled={busy}>{t('取消', 'Cancel')}</button>
          <button className="btn-navy sm" disabled={busy || !pid} onClick={async () => { setBusy(true); await onSave(pid, draft); setBusy(false); }}>{busy ? t('保存中…', 'Saving…') : t('新增', 'Add')}</button>
        </div>
      </div>
    </div>
  );
}

function ImportModal({ preview, def, onClose, onConfirm }: { preview: ImportPreview; def: RegisterDef; onClose: () => void; onConfirm: () => void }) {
  const { projects } = useStore();
  const { lang, t } = useLang();
  const [busy, setBusy] = useState(false);
  const names = new Set(projects.filter((p) => !p.archived).map((p) => (p.name || '').trim().toLowerCase()));
  const unmatched = [...new Set(preview.rows.filter((r) => !names.has(r.project.trim().toLowerCase())).map((r) => r.project))];
  const matched = preview.rows.length - preview.rows.filter((r) => !names.has(r.project.trim().toLowerCase())).length;

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ margin: 0 }}>{t('导入预览', 'Import preview')} · {svcName(def.svc, lang)}</h2>
          <div style={{ flex: 1 }} />
          <button className="btn-line sm" onClick={onClose}>{t('关闭', 'Close')}</button>
        </div>
        <div className="msub">{t('按项目名称匹配现有项目;全有或全无——任一行匹配不到,整批不写入。', 'Matched by project name. All-or-nothing — one unmatched row aborts the whole import.')}</div>
        <div style={{ display: 'flex', gap: 20, margin: '14px 0' }}>
          <Stat label={t('总行数', 'Rows')} value={preview.rows.length} />
          <Stat label={t('可匹配', 'Matched')} value={matched} color="var(--success)" />
          <Stat label={t('未匹配', 'Unmatched')} value={unmatched.length} color={unmatched.length ? 'var(--danger)' : 'var(--text2)'} />
        </div>
        {unmatched.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--danger)', background: '#fdecec', borderRadius: 8, padding: '9px 12px', marginBottom: 12 }}>
            {t('以下项目名称在系统中找不到,请先核对(导入会整批失败):', 'These project names were not found — fix them first (the import will fail as a batch):')}
            <div style={{ marginTop: 5, fontWeight: 600 }}>{unmatched.slice(0, 12).join(' · ')}{unmatched.length > 12 ? ' …' : ''}</div>
          </div>
        )}
        {preview.rows.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>{t('没有可导入的行(检查表头是否与模板一致)。', 'No importable rows — check headers match the template.')}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
          <button className="btn-line sm" onClick={onClose} disabled={busy}>{t('取消', 'Cancel')}</button>
          <button className="btn-navy sm" disabled={busy || preview.rows.length === 0 || unmatched.length > 0}
            onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); }}>
            {busy ? t('导入中…', 'Importing…') : t(`确认导入 ${matched} 条`, `Import ${matched}`)}
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

function CellVal({ f, val }: { f: FieldDef; val: string }) {
  if (!val) return <span style={{ color: '#c3ccd4' }}>—</span>;
  if (f.type === 'url') return <a href={val} target="_blank" rel="noreferrer" style={{ color: 'var(--info)', wordBreak: 'break-all', fontSize: 12.5 }}>{val.length > 34 ? val.slice(0, 34) + '…' : val}</a>;
  return <span style={{ fontSize: 12.5, whiteSpace: f.type === 'textarea' ? 'normal' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block', maxWidth: 210 }}>{val}</span>;
}

function EditModal({ row, def, onClose, onSave }: { row: Row; def: RegisterDef; onClose: () => void; onSave: (patch: Record<string, string>) => void }) {
  const { lang, t } = useLang();
  const rec = row.pk.record;
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const d: Record<string, string> = { status: (rec?.status as string) || defaultStatus(def.kind) };
    def.fields.forEach((f) => { d[f.key] = recordVal(rec, f.key); });
    return d;
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setDraft((x) => ({ ...x, [k]: v }));

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ margin: 0 }}>{svcName(row.pk.svc, lang)} · {t('资料', 'Record')}</h2>
          <div style={{ flex: 1 }} />
          <button className="btn-line sm" onClick={onClose}>{t('关闭', 'Close')}</button>
        </div>
        <div className="msub">{row.p.name} · {row.p.client || '—'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '10px 12px', alignItems: 'center', margin: '10px 0 16px' }}>
          <label style={lbl}>{t('状态', 'Status')}</label>
          <select className="in sm" value={draft.status} onChange={(e) => set('status', e.target.value)}>
            {statusFamily(def.kind).map((s) => <option key={s[0]} value={s[0]}>{lang === 'zh' ? s[1] : s[2]}</option>)}
          </select>
          {def.fields.map((f) => (
            <React.Fragment key={f.key}>
              <label style={lbl}>
                {lang === 'zh' ? f.zh : f.en}{f.required && <span style={{ color: 'var(--danger)' }}> *</span>}
                {f.type === 'formula' && <span title={f.formula} style={{ marginLeft: 4, fontSize: 10, color: 'var(--bronze)' }}>ƒ</span>}
              </label>
              {/* REQ-027: 公式字段算出来、只读,随上面的源字段边改边重算 */}
              {f.type === 'formula'
                ? <b className="tnum" style={{ fontSize: 13 }}>{formulaText(f, def.fields, { ...(row.pk.record || {}), ...draft })}</b>
                : f.type === 'textarea'
                ? <textarea className="in sm" value={draft[f.key]} onChange={(e) => set(f.key, e.target.value)} style={{ minHeight: 48 }} />
                : f.type === 'select'
                  ? <select className="in sm" value={draft[f.key]} onChange={(e) => set(f.key, e.target.value)}><option value="">—</option>{(f.options || []).map((o) => <option key={o[0]} value={o[0]}>{lang === 'zh' ? o[1] : o[2]}</option>)}</select>
                  : <input className="in sm" type={f.type === 'date' || f.type === 'number' ? (f.type === 'number' ? 'number' : 'date') : 'text'} value={draft[f.key]} onChange={(e) => set(f.key, e.target.value)} />}
            </React.Fragment>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn-line sm" onClick={onClose} disabled={busy}>{t('取消', 'Cancel')}</button>
          <button className="btn-navy sm" disabled={busy} onClick={async () => { setBusy(true); await onSave(draft); setBusy(false); }}>{busy ? t('保存中…', 'Saving…') : t('保存', 'Save')}</button>
        </div>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: '11px 16px', fontSize: 11, fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase', color: 'var(--text2)', background: 'var(--hover-bg)', textAlign: 'left', whiteSpace: 'nowrap', borderBottom: '1px solid var(--row-line)' };
const cell: React.CSSProperties = { padding: '11px 16px', fontSize: 13, borderTop: '1px solid var(--row-line)' };
const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: 'var(--text2)' };
