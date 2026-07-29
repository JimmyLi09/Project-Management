'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { canEdit } from '@/lib/permissions';
import { svcName, svcColor } from '@/lib/templates';
import { todayMid, fmtDate } from '@/lib/project';
import { useLang } from '@/lib/i18n';
import { Icon } from '../ui';
import {
  REGISTERS, registerDef, statusFamily, statusMeta, defaultStatus, recordVal,
  isIncomplete, isExpiring, type RegisterDef, type FieldDef,
} from '@/lib/records';
import type { Project, ServicePackage } from '@/lib/types';

interface Row { p: Project; pi: number; pk: ServicePackage; }
const PAGE = 20;

/* representative date for Year filter + "expiring" watch */
function mainDate(def: RegisterDef, pk: ServicePackage): string {
  const keys = def.kind === 'install' ? ['installDate'] : [def.watchDateKey || '', 'deliveryDate', 'handoverDate'];
  for (const k of keys) { if (k) { const v = recordVal(pk.record, k); if (v) return v; } }
  return '';
}

export default function RegistersView() {
  const { projects, me, dispatch, openProject } = useStore();
  const { lang, t } = useLang();
  const [svc, setSvc] = useState(REGISTERS[0].svc);
  const [q, setQ] = useState('');
  const [pm, setPm] = useState('');
  const [status, setStatus] = useState('');
  const [year, setYear] = useState('');
  const [page, setPage] = useState(0);
  const [edit, setEdit] = useState<Row | null>(null);

  const def = registerDef(svc)!;
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
        const hay = [r.p.name, r.p.client, recordVal(r.pk.record, 'developer'), recordVal(r.pk.record, 'mainCon')].join(' ').toLowerCase();
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
      return [r.p.name, r.p.client || '', (r.p.owners || []).join(' / '), lang === 'zh' ? sm[1] : sm[2],
        ...def.fields.map((f) => recordVal(r.pk.record, f.key).replace(/\n/g, ' '))];
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
                    <td style={{ ...cell, fontWeight: 600, color: 'var(--navy900)', cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => openProject(r.p.id)}>{r.p.name}</td>
                    <td style={{ ...cell, color: 'var(--text2)', whiteSpace: 'nowrap' }}>{r.p.client || '—'}</td>
                    <td style={{ ...cell, whiteSpace: 'nowrap' }}>{(r.p.owners || [])[0] || <span style={{ color: '#b6bfc9' }}>—</span>}</td>
                    <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                      <span className="badge" style={{ background: 'var(--hover-bg)', color: sm[3] }}><span className="bdot" style={{ background: sm[3] }} />{lang === 'zh' ? sm[1] : sm[2]}</span>
                      {exp && <span className="badge" style={{ background: '#fef3c7', color: '#92600a', marginLeft: 4 }}>{t('即将到期', 'expiring')}</span>}
                      {inc && <span className="badge" style={{ background: '#fdecec', color: 'var(--danger)', marginLeft: 4 }}>{t('缺资料', 'incomplete')}</span>}
                    </td>
                    {def.fields.map((f) => <td key={f.key} style={{ ...cell, maxWidth: 220 }}><CellVal f={f} val={recordVal(rec, f.key)} /></td>)}
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
    </>
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
              <label style={lbl}>{lang === 'zh' ? f.zh : f.en}{f.required && <span style={{ color: 'var(--danger)' }}> *</span>}</label>
              {f.type === 'textarea'
                ? <textarea className="in sm" value={draft[f.key]} onChange={(e) => set(f.key, e.target.value)} style={{ minHeight: 48 }} />
                : f.type === 'select'
                  ? <select className="in sm" value={draft[f.key]} onChange={(e) => set(f.key, e.target.value)}><option value="">—</option>{(f.options || []).map((o) => <option key={o[0]} value={o[0]}>{lang === 'zh' ? o[1] : o[2]}</option>)}</select>
                  : <input className="in sm" type={f.type === 'date' ? 'date' : 'text'} value={draft[f.key]} onChange={(e) => set(f.key, e.target.value)} />}
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
