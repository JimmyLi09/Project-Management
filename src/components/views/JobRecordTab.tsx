'use client';

import React, { useMemo, useState } from 'react';
import { useStore, useWho } from '../store';
import { canAdmin, canDelete, canEditIn } from '@/lib/permissions';
import { SVC, svcName, svcColor } from '@/lib/templates';
import { fmtDate, parseISO, pkgSuffix } from '@/lib/project';
import { useLang } from '@/lib/i18n';
import { Icon } from '../ui';
import {
  baseDefOf, hasRecordDef, statusFamily, statusMeta, defaultStatus, recordVal, fieldVal, isIncomplete, fieldsOf, FIELD_TYPES, formulaText, optionLabel,
  isDerivedKey, isOverridden, derivedVal,
  type FieldDef, type FieldType, type RegisterDef,
} from '@/lib/records';
import type { AvDerived } from '@/lib/records';
import { jobGroups, rowsFromPaste, JOB_HEAD_EN, JOB_HEAD_ZH, type JobField } from '@/lib/jobRecord';
import type { JobRow, Project, ServicePackage } from '@/lib/types';
import JobRecordExport from './JobRecordExport';
import KbLinks from '../KbLinks';
import { fieldGroupTerm } from '@/lib/terms';

/* ===== REQ-049 · Job Record = 一张 4 栏表 =====
   Service Item / Detail / Quantity / Special Notes,和 Sales 报价表一致,内容全部自定义。
   行按业务分组(同类两份显示「LED × 2」),每组「＋ 加一行」,每种业务至少保留 1 行。
   可以从 Excel 复制报价单的 4 栏(或 3 栏)直接粘贴到表上,按行追加并归到对应业务。
   原来各业务登记表的字段不删,在下面「旧字段(只读)」里看。 */
export default function JobRecordTab({ p }: { p: Project }) {
  const { lang, t } = useLang();
  const { me } = useStore();
  const canEd = canEditIn(me, p, 'record');   // REQ-051: 再过权限表
  const [exporting, setExporting] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [legacyOpen, setLegacyOpen] = useState(false);

  /* 旧字段:有值的业务才列出来(没值的没什么可查) */
  const legacy = p.packages.map((pk, i) => ({ pk, i })).filter(({ pk }) =>
    hasRecordDef(pk.svc) && Object.entries(pk.record || {}).some(([k, v]) => k !== 'status' && k !== 'updatedAt' && String(v ?? '').trim()));

  if (exporting) return <JobRecordExport p={p} onClose={() => setExporting(false)} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12.5, color: 'var(--text2)', flex: 1, minWidth: 240 }}>
          {t('Job Record 只保留 4 栏（Service Item / Detail / Quantity / Special Notes），和 Sales 报价表一致；内容全部自定义。「项目档案」读的也是这张表。',
             'Job Record keeps four columns (Service Item / Detail / Quantity / Special Notes), same as the sales quotation; all content is free-form. The Registers page reads this table too.')}
        </div>
        {canEd && (
          <button className="btn-line sm" onClick={() => setPasteOpen(true)} data-testid="job-paste-btn">
            📋 {t('从报价单粘贴', 'Paste from quotation')}
          </button>
        )}
        <button className="btn-line sm" onClick={() => setExporting(true)} data-testid="job-export">
          <Icon name="download" size={13} />{t('下载', 'Download')}
        </button>
      </div>

      {/* REQ-032: 同步自项目创建的信息 —— 表格化、始终只读,它跟着项目走 */}
      <div className="panel clip">
        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--row-line)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="panel-title" style={{ fontSize: 14 }}>{t('项目信息', 'Project info')}</span>
          <span className="badge" style={{ background: 'var(--hover-bg)', color: 'var(--text2)' }}>
            {t('同步自项目创建 · 只读', 'Synced from the project · read-only')}
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>
            {t('要改?项目名 / 报价号 / 客户在页面抬头点一下改;交付日在「概览 · 交付核算」;PM 在「概览 · 项目团队」。',
               'To edit: name / quote no. / client in the page header; delivery date under Overview · Delivery Check; PM under Overview · Assigned Team.')}
          </span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {([
              [t('项目名称', 'Project name'), p.name],
              [t('客户', 'Client'), p.client || '—'],
              [t('报价号', 'Quotation no.'), p.quotationNo || '—'],
              [t('PM', 'PM'), (p.owners || []).join(' / ') || '—'],
              [t('交付日期', 'Delivery'), p.delivery ? fmtDate(parseISO(p.delivery)) : '—'],
              [t('服务', 'Services'), p.services.map((k) => svcName(k, lang)).join(', ') || '—'],
            ] as [string, string][]).map(([k, v], i) => (
              <tr key={i}>
                <th style={cellK}>{k}</th>
                <td style={cellV}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <JobTable p={p} canEd={canEd} />

      <ServicesBar p={p} canEd={canEd} />

      {legacy.length > 0 && (
        <div className="panel" style={{ padding: '10px 16px' }} data-testid="job-legacy">
          <button className="link-button" style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy900)' }} onClick={() => setLegacyOpen((v) => !v)} data-testid="job-legacy-toggle">
            {legacyOpen ? '▾' : '▸'} {t(`旧字段（只读）· ${legacy.length} 份业务`, `Old fields (read-only) · ${legacy.length} services`)}
          </button>
          <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 4 }}>
            {t('改版前各业务登记表里填的字段，原样保留供查历史；上线时有值的字段已经各转成了上面的一行。',
              'Fields from the per-service registers before this change, kept for reference; each filled field became a row above at go-live.')}
          </div>
          {legacyOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>
              {legacy.map(({ pk, i }) => <RecordCard key={i} p={p} pk={pk} pkgIdx={i} def={baseDefOf(pk.svc)} canEd={false} legacy />)}
            </div>
          )}
        </div>
      )}

      {pasteOpen && <PasteModal p={p} onClose={() => setPasteOpen(false)} />}
    </div>
  );
}

/* ---------- 4 栏表 ---------- */
const COL_W = ['20%', '34%', '12%', 'auto'];
const FIELDS: JobField[] = ['item', 'detail', 'qty', 'note'];

function JobTable({ p, canEd }: { p: Project; canEd: boolean }) {
  const { dispatch, setToast } = useStore();
  const { lang, t } = useLang();
  const groups = useMemo(() => jobGroups(p), [p]);
  const head = JOB_HEAD_EN;
  const svcsInProject = groups.filter((g) => g.inProject).map((g) => g.svc);

  /* 在表上粘贴 Excel 复制的几栏(带 Tab):整段按行追加,不填进某一格 */
  async function onPaste(e: React.ClipboardEvent) {
    if (!canEd) return;
    const text = e.clipboardData.getData('text/plain');
    if (!/\t/.test(text)) return;   // 只是一段普通文字:照常贴进格子
    e.preventDefault();
    const n = rowsFromPaste(text, p).length;
    if (!n) { setToast(t('没有认出可以导入的行', 'No rows recognised')); return; }
    if (await dispatch(p.id, { type: 'pasteJobRows', text })) setToast(t(`已从报价单追加 ${n} 行`, `${n} rows added from the quotation`));
  }

  function remove(r: JobRow, inProject: boolean, count: number) {
    if (inProject && count <= 1) { setToast(t('每个业务至少保留一行', 'Each service keeps at least one row')); return; }
    dispatch(p.id, { type: 'removeJobRow', id: r.id });
  }

  const th: React.CSSProperties = { padding: '9px 10px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text2)', background: 'var(--hover-bg)', textAlign: 'left' };
  const td: React.CSSProperties = { padding: '5px 6px', borderTop: '1px solid var(--row-line)', verticalAlign: 'top', fontSize: 13 };
  return (
    <div className="panel clip" onPaste={onPaste} data-testid="job-table">
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>{COL_W.map((w, i) => <col key={i} style={{ width: w }} />)}{canEd && <col style={{ width: 34 }} />}</colgroup>
        <thead>
          <tr>{head.map((h, i) => <th key={i} style={th}>{h}{lang === 'zh' && <span style={{ fontWeight: 500, marginLeft: 4, textTransform: 'none' }}>{JOB_HEAD_ZH[i]}</span>}</th>)}{canEd && <th style={th} />}</tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <React.Fragment key={g.svc || '_'}>
              <tr data-testid={`job-group-${g.svc || 'none'}`}>
                <td colSpan={canEd ? 5 : 4} style={{ padding: '7px 10px', background: '#faf8f4', borderTop: '1px solid var(--row-line)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: 'var(--navy900)', flex: 1, flexWrap: 'wrap' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: g.svc ? svcColor(g.svc) : '#aaa' }} />
                    {g.svc ? svcName(g.svc, lang) : t('未对应业务', 'Not matched to a service')}
                    {g.count > 1 && <span>× {g.count}</span>}
                    {g.svc && !g.inProject && <span style={{ fontWeight: 400, color: 'var(--text2)' }}>{t('（项目里已没有这项业务）', '(service no longer in the project)')}</span>}
                    <span style={{ fontWeight: 400, color: 'var(--text2)' }}>· {t(`${g.rows.length} 行`, `${g.rows.length} rows`)}</span>
                  </span>
                  {canEd && g.inProject && (
                    <button className="btn-line sm" style={{ padding: '2px 9px' }} data-testid={`job-add-${g.svc}`}
                      onClick={() => dispatch(p.id, { type: 'addJobRow', svc: g.svc })}>＋ {t('加一行', 'Add row')}</button>
                  )}
                  </div>
                </td>
              </tr>
              {g.rows.map((r) => (
                <tr key={r.id} data-testid="job-row" data-svc={g.svc}>
                  {FIELDS.map((f) => (
                    <td key={f} style={td}>
                      {canEd
                        ? <Cell row={r} field={f} p={p} />
                        : <div style={{ padding: '4px 4px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: r[f] ? 'var(--text)' : '#b6bfc9' }}>{r[f] || '—'}</div>}
                      {f === 'item' && canEd && !g.inProject && (
                        <select className="in sm" style={{ marginTop: 4, width: '100%' }} value="" data-testid="job-move"
                          onChange={(e) => e.target.value && dispatch(p.id, { type: 'editJobRow', id: r.id, field: 'svc', value: e.target.value })}>
                          <option value="">{t('归到业务…', 'Move to service…')}</option>
                          {svcsInProject.map((s) => <option key={s} value={s}>{svcName(s, lang)}</option>)}
                        </select>
                      )}
                    </td>
                  ))}
                  {canEd && (
                    <td style={{ ...td, textAlign: 'center' }}>
                      <button title={t('删除这一行', 'Delete this row')} data-testid="job-del" style={{ color: 'var(--danger)', fontWeight: 700, padding: '4px 6px' }}
                        onClick={() => remove(r, g.inProject, g.rows.length)}>×</button>
                    </td>
                  )}
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      <div style={{ padding: '8px 12px', fontSize: 11.5, color: 'var(--text2)', borderTop: '1px solid var(--row-line)' }}>
        {t('Quantity 是文字，可以写「2」「180s」「1 set」「5 spots」。从 Excel 复制报价单的几栏，直接在表上 Ctrl+V 就按行追加。',
          'Quantity is free text — "2", "180s", "1 set", "5 spots". Copy columns from the quotation in Excel and press Ctrl+V on the table to append them.')}
      </div>
      {/* REQ-035 内嵌调用:这几种业务下挂的知识库文档 */}
      {groups.filter((g) => g.inProject).map((g) => <KbLinks key={g.svc} svc={g.svc} compact />)}
    </div>
  );
}

function Cell({ row, field, p }: { row: JobRow; field: JobField; p: Project }) {
  const { dispatch } = useStore();
  const { t } = useLang();
  const ph: Record<JobField, [string, string]> = {
    item: ['如 Perspectives', 'e.g. Perspectives'], detail: ['如 Hero - with surrounding', 'e.g. Hero - with surrounding'],
    qty: ['如 2 / 180s', 'e.g. 2 / 180s'], note: ['', ''],
  };
  const save = (v: string) => { if (v !== row[field]) dispatch(p.id, { type: 'editJobRow', id: row.id, field, value: v }); };
  const common = {
    className: 'in sm', defaultValue: row[field], placeholder: t(...ph[field]),
    'data-testid': `job-cell-${field}`, style: { width: '100%' } as React.CSSProperties,
  };
  const k = `${row.id}:${field}:${row[field]}`;   // 别人改了 / 服务端回来的值不同 → 重新挂载显示新值
  /* 多行的两栏按内容给高度(最多 6 行),长说明不用点进去才看得全 */
  const per = field === 'detail' ? 46 : 40;
  const rows = Math.min(6, String(row[field] || '').split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / per)), 0) || 1);
  return field === 'note' || field === 'detail'
    ? <textarea key={k} {...common} rows={rows} style={{ ...common.style, minHeight: 30, resize: 'vertical' }} onBlur={(e) => save(e.target.value)} />
    : <input key={k} {...common} onBlur={(e) => save(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

/* 打开一个框粘贴:先预览会追加哪些行、归到哪个业务,再确认 */
function PasteModal({ p, onClose }: { p: Project; onClose: () => void }) {
  const { dispatch, setToast } = useStore();
  const { lang, t } = useLang();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => (text.trim() ? rowsFromPaste(text, p) : []), [text, p]);
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 820 }}>
        <h2>{t('从报价单粘贴', 'Paste from quotation')}</h2>
        <div className="msub">{t('在 Excel 里选中报价单的 Service Item / Detail / Quantity / Special Notes 几栏（3 栏也行：没有 Quantity），复制后粘贴到下面。按行追加；Service Item 对得上已有业务的归到那一组，Service Item 空着的接上一行。',
          'In Excel, select the Service Item / Detail / Quantity / Special Notes columns (3 also works — no Quantity), copy, and paste below. Rows are appended; a Service Item matching a service goes to that group, a blank one continues the row above.')}</div>
        <textarea className="in" style={{ width: '100%', minHeight: 120, fontFamily: 'monospace', fontSize: 12 }} value={text}
          onChange={(e) => setText(e.target.value)} placeholder={t('在这里 Ctrl+V', 'Ctrl+V here')} data-testid="job-paste-area" />
        {rows.length > 0 && (
          <div style={{ maxHeight: 260, overflow: 'auto', marginTop: 10, border: '1px solid var(--row-line)', borderRadius: 6 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <tbody>
                <tr>{['', ...JOB_HEAD_EN].map((h, i) => <th key={i} style={{ textAlign: 'left', padding: '5px 7px', background: 'var(--hover-bg)' }}>{h || t('归到', 'Goes to')}</th>)}</tr>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--row-line2)' }}>
                    <td style={{ padding: '4px 7px', whiteSpace: 'nowrap', color: r.svc ? svcColor(r.svc) : 'var(--danger)', fontWeight: 600 }}>{r.svc ? svcName(r.svc, lang) : t('未对应', 'not matched')}</td>
                    <td style={{ padding: '4px 7px' }}>{r.item}</td><td style={{ padding: '4px 7px' }}>{r.detail}</td>
                    <td style={{ padding: '4px 7px' }}>{r.qty}</td><td style={{ padding: '4px 7px', whiteSpace: 'pre-wrap' }}>{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="modal-actions">
          <span style={{ flex: 1, fontSize: 12, color: 'var(--text2)' }}>{text.trim() ? t(`认出 ${rows.length} 行`, `${rows.length} rows recognised`) : ''}</span>
          <button className="btn-line" onClick={onClose}>{t('取消', 'Cancel')}</button>
          <button className="btn-navy" disabled={!rows.length || busy} data-testid="job-paste-go"
            onClick={async () => {
              setBusy(true);
              const ok = await dispatch(p.id, { type: 'pasteJobRows', text });
              setBusy(false);
              if (ok) { setToast(t(`已从报价单追加 ${rows.length} 行`, `${rows.length} rows added from the quotation`)); onClose(); }
            }}>{busy ? t('处理中…', 'Working…') : t(`追加 ${rows.length} 行`, `Append ${rows.length} rows`)}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- 这个项目的业务:加 / 删(制作过程中范围变了) ---------- */
function ServicesBar({ p, canEd }: { p: Project; canEd: boolean }) {
  const { dispatch, me } = useStore();
  const { lang, t } = useLang();
  const [svc, setSvc] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const countOf = (k: string) => p.packages.filter((x) => x.svc === k).length;
  const delOk = canDelete(me) && p.packages.length > 1;

  async function removePkg(i: number) {
    const pk = p.packages[i];
    const name = svcName(pk.svc, lang) + (pkgSuffix(p, i) ? ' ' + pkgSuffix(p, i) : '');
    const sched = pk.schedule.length;
    const sameLeft = p.packages.some((x, j) => j !== i && x.svc === pk.svc);
    const own = sameLeft ? 0 : (p.checklist || []).reduce((n, g) => n + g.items.filter((it) => (it.svcs || []).length === 1 && it.svcs![0] === pk.svc).length, 0);
    if (!confirm(t(
      `删除业务「${name}」?\n它的 ${sched} 个排期阶段会一起删掉,不能撤销。\n信息清单里只属于它的 ${own} 项移到「已移除的项」(可恢复),共用的项保留。\nJob Record 里这项业务的行留着(标「项目里已没有这项业务」),需要的话自己删。`,
      `Remove "${name}"? Its ${sched} schedule phases go with it. This cannot be undone.\nIts ${own} checklist-only items move to “Removed” (restorable); shared items stay.\nIts Job Record rows stay (marked "service no longer in the project") — delete them yourself if needed.`))) return;
    await dispatch(p.id, { type: 'removeServicePackage', pkg: i });
  }

  return (
    <div className="panel" style={{ padding: '12px 16px', borderStyle: 'dashed' }} data-testid="job-services">
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--navy900)' }}>{t('这个项目的业务', 'Services in this project')}</span>
        {p.packages.map((pk, i) => (
          <span key={i} className="badge" style={{ background: 'var(--hover-bg)', color: 'var(--text2)' }}>
            <span className="bdot" style={{ background: svcColor(pk.svc) }} />
            {svcName(pk.svc, lang)}{pkgSuffix(p, i) ? ' ' + pkgSuffix(p, i) : ''}
            {delOk && <button title={t('删除这份业务', 'Remove this service')} style={{ marginLeft: 4, color: 'var(--danger)', fontWeight: 700 }} onClick={() => removePkg(i)} data-testid={`job-pkg-del-${i}`}>×</button>}
          </span>
        ))}
      </div>
      {canEd && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--row-line)' }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--navy900)' }}>＋ {t('添加业务', 'Add service')}</span>
          <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{t('加一个业务 = 加一组 1 行（Service Item 预填业务名，其余自己填）；排期和信息清单照常生成', 'Adding a service adds one row (Service Item pre-filled); its schedule and checklist are created as usual')}</span>
          <div style={{ flex: 1 }} />
          <select className="in sm" value={svc} onChange={(e) => setSvc(e.target.value)} style={{ width: 'auto' }} data-testid="job-add-svc">
            <option value="">{t('— 选择业务 —', '— select service —')}</option>
            {Object.keys(SVC).map((k) => <option key={k} value={k}>{svcName(k, lang)}{countOf(k) ? t(`（已有 ${countOf(k)} 份）`, ` (${countOf(k)} existing)`) : ''}</option>)}
          </select>
          <input className="in sm" style={{ width: 150 }} value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder={t('实例名(可空)', 'Instance name (optional)')}
            title={t('同类多份时用来区分,例如「大堂 LED」「入口 LED」;留空则按 ①②③ 标号', 'Distinguishes multiple of the same type, e.g. "Lobby LED"; blank falls back to ①②③')} />
          <button className="btn-navy sm" disabled={busy || !svc} data-testid="job-add-svc-go"
            onClick={async () => {
              setBusy(true);
              await dispatch(p.id, { type: 'addServicePackage', svc, patch: {}, asNew: true, label: label.trim() });
              setBusy(false); setSvc(''); setLabel('');
            }}>{busy ? t('添加中…', 'Adding…') : t('添加', 'Add')}</button>
        </div>
      )}
    </div>
  );
}

function RecordCard({ p, pk, pkgIdx, def: baseDef, canEd, register, legacy }: {
  p: Project; pk: ServicePackage; pkgIdx: number; def: RegisterDef; canEd: boolean; legacy?: boolean;
  register?: (idx: number, api: { begin: () => void; save: () => Promise<void>; cancel: () => void } | null) => void;
}) {
  const { dispatch, me, recordFields, avDerived } = useStore();
  const { lang, t } = useLang();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  /* REQ-023: 字段可由用户增减 —— 把覆盖并进 def,下游 def.fields 自动跟着走 */
  const [fieldEdit, setFieldEdit] = useState(false);
  const def = useMemo<RegisterDef>(() => ({ ...baseDef, fields: fieldsOf(baseDef, recordFields) }), [baseDef, recordFields]);

  const rec = pk.record;
  /* REQ-039:这个项目 LED 方案配置算出来的那几个数 */
  const derived = avDerived[p.id];
  const status = (rec?.status as string) || defaultStatus(def.kind);
  const incomplete = isIncomplete(def, rec, undefined, p);
  const fam = statusFamily(def.kind);

  function begin() {
    const d: Record<string, string> = { status };
    def.fields.forEach((f) => { if (f.type !== 'formula') d[f.key] = fieldVal(f, rec, p, derived); });
    setDraft(d);
    setEditing(true);
  }
  async function save() {
    setBusy(true);
    const ok = await dispatch(p.id, { type: 'setRecord', pkg: pkgIdx, patch: draft });
    setBusy(false);
    if (ok) setEditing(false);
  }
  const set = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  /* REQ-032: 把本卡的 进入编辑 / 保存 / 取消 交给页面级「总编辑」调度。
     依赖里带上 rec 与 def.fields —— 字段或值变了要重新注册,
     否则总编辑保存的会是旧闭包里的 draft 初值。 */
  const beginRef = React.useRef(begin), saveRef = React.useRef(save);
  beginRef.current = begin; saveRef.current = save;
  React.useEffect(() => {
    if (!register || !canEd) return;
    register(pkgIdx, {
      begin: () => beginRef.current(),
      save: async () => { await saveRef.current(); },
      cancel: () => setEditing(false),
    });
    return () => register(pkgIdx, null);
  }, [register, canEd, pkgIdx]);

  const sm = statusMeta(def.kind, status);
  const updated = rec?.updatedAt ? new Date(rec.updatedAt as number) : null;

  return (
    <div className="panel clip">
      <div className="panel-head" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: svcColor(pk.svc) }} />
        {/* REQ-026: 同类有多份时,标题带上实例名或 ①②③ */}
        <span className="panel-title">
          {svcName(pk.svc, lang)}
          {pkgSuffix(p, pkgIdx) && <span style={{ color: 'var(--bronze)', marginLeft: 6 }}>{pkgSuffix(p, pkgIdx)}</span>}
          <span style={{ color: 'var(--text2)', fontWeight: 400 }}> · {t('资料', 'Record')}</span>
        </span>
        {!def.confirmed && (
          <span className="badge" style={{ background: '#fbf0dc', color: '#a8690b', fontSize: 10.5 }}>{t('列待PD确认', 'cols draft')}</span>
        )}
        {incomplete && !editing && (
          <span className="badge" style={{ background: '#fef3c7', color: '#92600a', fontSize: 10.5 }}><Icon name="alert" size={11} />{t('资料不完整', 'incomplete')}</span>
        )}
        <div style={{ flex: 1 }} />
        {!editing && (
          <span className="badge" style={{ background: 'var(--hover-bg)', color: sm[3] }}>
            <span className="bdot" style={{ background: sm[3] }} />{lang === 'zh' ? sm[1] : sm[2]}
          </span>
        )}
        {/* REQ-032: 卡片上不再各放一个编辑按钮 —— 整页只留顶部那一个「总编辑」,
            需求方明确否掉了分块编辑。 */}
        {/* REQ-023: 字段定义是全局的(改一次影响该服务类型所有项目),只给 PD/BD */}
        {canAdmin(me) && !editing && !legacy && (
          <button className="btn-line sm" style={fieldEdit ? { borderColor: 'var(--navy700)', color: 'var(--navy900)', fontWeight: 600 } : undefined}
            onClick={() => setFieldEdit(!fieldEdit)}>
            {fieldEdit ? t('完成', 'Done') : t('增减字段', 'Edit fields')}
          </button>
        )}
        {/* REQ-026: 删除这一份业务。整包连排期/信息清单/资料一起没,
            所以只给 Sales / PD / BD,并且说清楚删的是什么。 */}
        {canDelete(me) && !editing && !legacy && p.packages.length > 1 && (
          <button className="btn-line sm danger" title={t('删除这份业务', 'Remove this service')}
            onClick={async () => {
              const name = svcName(pk.svc, lang) + (pkgSuffix(p, pkgIdx) ? ' ' + pkgSuffix(p, pkgIdx) : '');
              const sched = pk.schedule.length;
              /* REQ-044: 信息清单是项目共用的 —— 删业务只去掉这个服务的标签;只属于它的项
                 移到「已移除的项」(可恢复),和别的服务共用的项留着 */
              const sameLeft = p.packages.some((x, i) => i !== pkgIdx && x.svc === pk.svc);
              const own = sameLeft ? 0 : (p.checklist || []).reduce((n, g) => n + g.items.filter((it) => (it.svcs || []).length === 1 && it.svcs![0] === pk.svc).length, 0);
              if (!confirm(t(
                `删除业务「${name}」?\n它的 ${sched} 个排期阶段和这张资料卡会一起删掉,不能撤销。\n信息清单里只属于它的 ${own} 项移到「已移除的项」(可恢复),共用的项保留。`,
                `Remove "${name}"? Its ${sched} schedule phases and this record card go with it. This cannot be undone.\nIts ${own} checklist-only items move to “Removed” (restorable); shared items stay.`))) return;
              await dispatch(p.id, { type: 'removeServicePackage', pkg: pkgIdx });
            }}>✕ {t('删除业务', 'Remove')}</button>
        )}
      </div>

      {fieldEdit && !editing && <FieldEditor svc={baseDef.svc} builtin={baseDef.fields} current={def.fields} onClose={() => setFieldEdit(false)} />}

      {!editing ? (
        /* REQ-027: 按分组渲染,组内两列 —— 尺寸/数量/计算这些相关字段聚在一块,
           不再一长条竖着散开。没设分组的字段归到最前面的「未分组」里照旧显示。 */
        <div style={{ padding: '2px 0 6px' }}>
          {groupFields(def.fields).map(([gname, gfields]) => (
            <div key={gname || '_'}>
              {gname && (
                <div style={{ padding: '10px 18px 4px', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text2)' }}>
                  {/* REQ-041: 出厂分组名是「中文 English」混排的一串,EN 下只留英文 */}
                  {fieldGroupTerm(gname, lang)}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: '0 18px', padding: '0 18px' }}>
                {gfields.map((f) => {
                  const isF = f.type === 'formula';
                  const val = isF ? formulaText(f, def.fields, rec, derived) : fieldVal(f, rec, p, derived);
                  const missing = !isF && f.required && !val.trim();
                  /* REQ-039: 关键信息粗体 —— 公式算出来的结果本来就是重点,一并加粗 */
                  const key = !!f.highlight || isF;
                  return (
                    <div key={f.key} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '7px 0', borderBottom: '1px solid var(--row-line)', minWidth: 0 }}>
                      <span style={{ flex: '0 0 40%', fontSize: 12, color: key ? 'var(--navy900)' : 'var(--text2)', fontWeight: key ? 700 : 600 }}>
                        {lang === 'zh' ? f.zh : f.en}
                        {f.required && <span style={{ color: 'var(--danger)' }}> *</span>}
                        {isF && <span title={f.formula} style={{ marginLeft: 5, fontSize: 10, color: 'var(--bronze)' }}>ƒ</span>}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: key ? 700 : 400, background: missing ? 'var(--hl-cell, #fef3c7)' : undefined }}>
                        {isF
                          ? <b className="tnum" style={{ color: val === '—' ? '#b6bfc9' : 'var(--navy900)' }}>{val}</b>
                          : val ? <FieldValue f={f} val={val} lang={lang} />
                          : <span style={{ color: missing ? '#b8860b' : '#b6bfc9', fontWeight: 400 }}>{missing ? t('待补充', 'to fill') : '—'}</span>}
                        {/* REQ-039:这个数是方案配置带过来的,还是人改过的 */}
                        <DerivedMark fkey={f.key} rec={rec} d={derived} />
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ padding: '4px 0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <th style={cellK}>{t('状态', 'Status')}</th>
                <td style={cellV}>
                  <select className="in sm" value={draft.status || ''} onChange={(e) => set('status', e.target.value)} style={{ maxWidth: 220 }}>
                    {fam.map((s) => <option key={s[0]} value={s[0]}>{lang === 'zh' ? s[1] : s[2]}</option>)}
                  </select>
                </td>
              </tr>
              {def.fields.map((f) => (
                <tr key={f.key}>
                  <th style={f.highlight ? { ...cellK, color: 'var(--navy900)', fontWeight: 700 } : cellK}>
                    {lang === 'zh' ? f.zh : f.en}{f.required && <span style={{ color: 'var(--danger)' }}> *</span>}
                    {f.type === 'formula' && <span title={f.formula} style={{ marginLeft: 5, fontSize: 10, color: 'var(--bronze)' }}>ƒ</span>}
                  </th>
                  <td style={cellV}>
                    {/* REQ-027: 公式字段是算出来的,编辑态也不给手填 —— 随着上面的
                        源字段边改边重算,所见即保存后的值。 */}
                    {f.type === 'formula' ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                        <b className="tnum">{formulaText(f, def.fields, { ...(rec || {}), ...draft })}</b>
                        <span style={{ fontSize: 11, color: 'var(--text2)' }}>= {f.formula}</span>
                      </span>
                    ) : (
                      <FieldInput f={f} val={draft[f.key] || ''} onChange={(v) => set(f.key, v)} lang={lang} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* 保存 / 取消 统一放在页面顶部,这里不再重复一套 */}
        </div>
      )}

      {/* REQ-035 内嵌调用:这个业务类型下挂的知识库文档,就地列出来 */}
      {!editing && !legacy && <KbLinks svc={pk.svc} compact />}

      {updated && !editing && (
        <div style={{ padding: '8px 18px', fontSize: 11, color: 'var(--text2)', borderTop: '1px solid var(--row-line)' }}>
          {t('最后更新', 'Updated')} {updated.toLocaleDateString()} {updated.toTimeString().slice(0, 5)}
        </div>
      )}
    </div>
  );
}

function FieldValue({ f, val, lang }: { f: FieldDef; val: string; lang: 'zh' | 'en' }) {
  if (f.type === 'url') return <a href={val} target="_blank" rel="noreferrer" style={{ color: 'var(--info)', wordBreak: 'break-all' }}>{val}</a>;
  if (f.type === 'textarea') return <span style={{ whiteSpace: 'pre-wrap' }}>{val}</span>;
  /* REQ-039: 下拉显示选项名而不是存的 key */
  if (f.type === 'select') return <span>{optionLabel(f, val, lang)}</span>;
  return <span>{val}</span>;
}

function FieldInput({ f, val, onChange, lang }: { f: FieldDef; val: string; onChange: (v: string) => void; lang: 'zh' | 'en' }) {
  if (f.type === 'textarea') return <textarea className="in sm" value={val} onChange={(e) => onChange(e.target.value)} style={{ minHeight: 52 }} />;
  if (f.type === 'select') {
    /* REQ-039: 一个字段从文本改成下拉之后,老数据的值多半不在选项里。
       把它补成一个选项显示出来,不然编辑一进来就是空的 —— 存下去等于把
       历史值抹了。用户重新选一个新选项就自然覆盖掉。 */
    const opts = f.options || [];
    const legacy = val && !opts.some((o) => o[0] === val);
    return (
      <select className="in sm" value={val} onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 220 }}>
        <option value="">—</option>
        {opts.map((o) => <option key={o[0]} value={o[0]}>{lang === 'zh' ? o[1] : o[2]}</option>)}
        {legacy && <option value={val}>{val}（{lang === 'zh' ? '原值' : 'existing'}）</option>}
      </select>
    );
  }
  if (f.type === 'number') return <input className="in sm" type="number" value={val} onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 190 }} />;
  return <input className="in sm" type={f.type === 'date' ? 'date' : 'text'} value={val} onChange={(e) => onChange(e.target.value)} style={f.type === 'date' ? { maxWidth: 190 } : undefined} />;
}

const cellK: React.CSSProperties = { textAlign: 'left', width: '32%', padding: '10px 18px', fontSize: 12.5, fontWeight: 600, color: 'var(--text2)', borderTop: '1px solid var(--row-line)', verticalAlign: 'top' };
const cellV: React.CSSProperties = { padding: '10px 18px', fontSize: 13, borderTop: '1px solid var(--row-line)' };


/* ===== REQ-023 — 每个服务类型的字段增减 / 改名 / 换类型 / 排序 =====
   改的是「服务类型」级别的定义:同一类型下所有项目的 Job Record 与项目档案
   登记表都跟着变(需求要的同源)。字段值挂在各项目自己的 record 上,这里只改
   列定义,不动任何已填的数据 —— 删列时值还在库里,把列加回来数据就回来了。 */
export function FieldEditor({ svc, builtin, current, onClose }: {
  svc: string; builtin: FieldDef[]; current: FieldDef[]; onClose: () => void;
}) {
  const { setToast, refreshRecordFields } = useStore();
  const { lang, t } = useLang();
  const [rows, setRows] = useState<FieldDef[]>(() => current.map((f) => ({ ...f })));
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const builtinKeys = new Set(builtin.map((f) => f.key));

  const patch = (i: number, up: Partial<FieldDef>) =>
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...up } : r)));

  function addField() {
    const name = prompt(t('新字段名称(中文)', 'New field name'), '');
    if (!name || !name.trim()) return;
    /* key 用来在 record 里存值,必须字母开头且唯一 —— 自动生成,避免用户手填出错 */
    let base = 'f' + name.trim().replace(/[^A-Za-z0-9]/g, '') .slice(0, 20);
    if (base === 'f') base = 'field';
    let key = base, n = 2;
    const used = new Set(rows.map((r) => r.key));
    while (used.has(key)) key = base + n++;
    setRows((rs) => [...rs, { key, zh: name.trim(), en: name.trim(), type: 'text' }]);
  }

  function removeField(i: number) {
    const f = rows[i];
    const msg = builtinKeys.has(f.key)
      ? t(`「${f.zh}」是内置字段。删除后该服务类型的所有项目(Job Record 与项目档案)都不再显示这一列。\n已填的数据不会被删除,把字段加回来就会重新出现。确定删除?`,
          `"${f.zh}" is a built-in column. Removing it hides it for every project of this service type. Existing values are kept and reappear if you add it back. Remove?`)
      : t(`删除字段「${f.zh}」?已填的数据保留,加回来即可恢复显示。`, `Remove "${f.zh}"? Values are kept and reappear if you add it back.`);
    if (!confirm(msg)) return;
    setRows((rs) => rs.filter((_, k) => k !== i));
  }

  async function save() {
    setBusy(true);
    const res = await fetch('/api/record-fields', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ svc, fields: rows }),
    });
    setBusy(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setToast(d.error || t('保存失败', 'Save failed')); return; }
    await refreshRecordFields();
    setToast(t('字段已更新 — 该业务下所有项目一致', 'Fields updated across this service'));
    onClose();
  }

  async function restore() {
    if (!confirm(t('恢复成出厂默认字段?你的自定义字段定义会丢失(已填数据保留)。', 'Restore the built-in columns? Your custom definitions are lost (values kept).'))) return;
    setBusy(true);
    const res = await fetch(`/api/record-fields?svc=${encodeURIComponent(svc)}`, { method: 'DELETE' });
    setBusy(false);
    if (!res.ok) { setToast(t('恢复失败', 'Restore failed')); return; }
    await refreshRecordFields();
    setToast(t('已恢复默认字段', 'Restored built-in columns'));
    onClose();
  }

  return (
    <div style={{ padding: '14px 18px', background: 'var(--hover-bg)', borderTop: '1px solid var(--row-line)', borderBottom: '1px solid var(--row-line)' }}>
      <div style={{ fontSize: 11.5, color: 'var(--text2)', marginBottom: 10 }}>
        {t('改的是这个业务类型的列定义 —— 保存后,该业务下所有项目的 Job Record 与「项目档案」登记表都会一致。已填的数据不会被删。',
           'These columns apply to every project of this service type, in both Job Record and Project Registers. Existing values are never deleted.')}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {rows.map((f, i) => (
          <div key={f.key}
            onDragOver={(e) => { if (drag !== null) e.preventDefault(); }}
            onDrop={(e) => {
              e.preventDefault();
              if (drag === null || drag === i) return;
              setRows((rs) => { const c = [...rs]; const [m] = c.splice(drag, 1); c.splice(i, 0, m); return c; });
              setDrag(null);
            }}
            style={{
              display: 'grid', gridTemplateColumns: '18px minmax(120px,1.4fr) minmax(110px,1.2fr) 116px 128px 28px',
              gap: 8, alignItems: 'center', background: 'var(--card, #fff)',
              border: '1px solid var(--border)', borderRadius: 8, padding: '7px 9px',
              opacity: drag === i ? 0.45 : 1,
            }}>
            <span draggable onDragStart={() => setDrag(i)} onDragEnd={() => setDrag(null)}
              title={t('拖动排序', 'Drag to reorder')}
              style={{ cursor: 'grab', color: 'var(--text2)', userSelect: 'none', fontSize: 13, textAlign: 'center' }}>⠿</span>
            <input className="in sm" value={f.zh} placeholder={t('中文名', 'Name (ZH)')}
              onChange={(e) => patch(i, { zh: e.target.value })} />
            <input className="in sm" value={f.en} placeholder={t('英文名', 'Name (EN)')}
              onChange={(e) => patch(i, { en: e.target.value })} />
            <select className="in sm" value={f.type}
              onChange={(e) => {
                const type = e.target.value as FieldType;
                patch(i, {
                  type,
                  options: type === 'select' ? (f.options && f.options.length ? f.options : [['optionA', '选项A', 'Option A']]) : undefined,
                  formula: type === 'formula' ? (f.formula || '') : undefined,
                  decimals: type === 'formula' ? (f.decimals ?? 2) : undefined,
                });
              }}>
              {FIELD_TYPES.map(([v, zh, en]) => <option key={v} value={v}>{lang === 'zh' ? zh : en}</option>)}
            </select>
            <label style={{ fontSize: 11.5, display: 'inline-flex', gap: 5, alignItems: 'center', color: 'var(--text2)' }}>
              <input type="checkbox" checked={!!f.required} onChange={(e) => patch(i, { required: e.target.checked })} />
              {t('必填', 'Req.')}
              {/* REQ-039: 关键信息加粗显示 */}
              <input type="checkbox" checked={!!f.highlight} onChange={(e) => patch(i, { highlight: e.target.checked })}
                title={t('标为关键信息 —— 在资料卡和登记表里加粗显示', 'Mark as key info — shown in bold')} />
              {t('重点', 'Key')}
            </label>
            <button className="btn-line sm danger" title={t('删除字段', 'Remove field')} onClick={() => removeField(i)}>✕</button>

            {f.type === 'select' && (
              <div style={{ gridColumn: '2 / -1', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'var(--text2)' }}>{t('选项(逗号分隔)', 'Options (comma-separated)')}</span>
                <input className="in sm" style={{ flex: 1, minWidth: 200 }}
                  value={(f.options || []).map((o) => o[1]).join(', ')}
                  placeholder="360, 720, VR, AR"
                  onChange={(e) => patch(i, {
                    options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean)
                      .map((x) => [x, x, x] as [string, string, string]),
                  })} />
              </div>
            )}

            {/* REQ-027: 公式字段 —— 表达式由你自己填,系统不写死任何一条 */}
            {f.type === 'formula' && (
              <div style={{ gridColumn: '2 / -1', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'var(--bronze)', fontWeight: 700 }}>ƒ =</span>
                <input className="in sm" style={{ flex: 1, minWidth: 220, fontFamily: 'ui-monospace, monospace' }}
                  value={f.formula || ''} placeholder="L * H / 1000000"
                  onChange={(e) => patch(i, { formula: e.target.value })} />
                <span style={{ fontSize: 11, color: 'var(--text2)' }}>{t('小数位', 'Decimals')}</span>
                <input className="in sm" type="number" min={0} max={6} style={{ width: 60 }}
                  value={f.decimals ?? 2} onChange={(e) => patch(i, { decimals: Math.max(0, Math.min(6, parseInt(e.target.value) || 0)) })} />
              </div>
            )}
            {f.type === 'formula' && (
              <div style={{ gridColumn: '2 / -1', fontSize: 11, color: 'var(--text2)' }}>
                {t('可用字段:', 'Available fields: ')}
                {rows.filter((r) => r.key !== f.key && r.type !== 'formula').map((r) => r.key).join(' · ') || t('（先加几个数字字段）', '(add number fields first)')}
                <span style={{ marginLeft: 8 }}>{t('只支持 + - * / 与括号。', 'Only + - * / and parentheses.')}</span>
              </div>
            )}

            {/* 分组名:同组字段在资料卡里聚成一块、组内两列 */}
            <div style={{ gridColumn: '2 / -1', display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text2)' }}>{t('分组', 'Group')}</span>
              <input className="in sm" style={{ maxWidth: 200 }} value={f.group || ''}
                placeholder={t('留空 = 不分组', 'blank = ungrouped')}
                list="rf-groups"
                onChange={(e) => patch(i, { group: e.target.value })} />
            </div>
          </div>
        ))}
      </div>

      <datalist id="rf-groups">
        {[...new Set(rows.map((r) => r.group).filter(Boolean))].map((g) => <option key={g} value={g!} />)}
      </datalist>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn-line sm" style={{ borderStyle: 'dashed' }} onClick={addField}>＋ {t('新增字段', 'Add field')}</button>
        <div style={{ flex: 1 }} />
        <button className="btn-line sm" onClick={restore} disabled={busy}>↺ {t('恢复默认', 'Restore default')}</button>
        <button className="btn-line sm" onClick={onClose} disabled={busy}>{t('取消', 'Cancel')}</button>
        <button className="btn-navy sm" onClick={save} disabled={busy || rows.length === 0}>
          {busy ? t('保存中…', 'Saving…') : t('保存字段', 'Save fields')}
        </button>
      </div>
    </div>
  );
}


/* REQ-027: 按 group 归拢字段,保持原顺序;未分组的排最前面 */
function groupFields(fields: FieldDef[]): [string, FieldDef[]][] {
  const order: string[] = [];
  const map = new Map<string, FieldDef[]>();
  fields.forEach((f) => {
    const g = f.group || '';
    if (!map.has(g)) { map.set(g, []); order.push(g); }
    map.get(g)!.push(f);
  });
  order.sort((a, b) => (a === '' ? -1 : b === '' ? 1 : 0));   // 未分组的置顶,其余保持出现顺序
  return order.map((g) => [g, map.get(g)!]);
}

/* REQ-039:资料卡上数量 L/H、电源线、数据线由 LED 方案配置带过来。带过来的标
   一个淡淡的「配」;人改过、且和带过来的不一样,标「已人工调整」,把原来那个
   数留在 hover 里 —— 不留就没人知道改之前是多少,也没法判断该信哪个。 */
function DerivedMark({ fkey, rec, d }: { fkey: string; rec: ServicePackage['record']; d?: AvDerived }) {
  const { t } = useLang();
  if (!d || !isDerivedKey(fkey)) return null;
  const dv = derivedVal(fkey, d);
  if (dv == null) return null;
  const when = new Date(d.at).toLocaleDateString();
  if (isOverridden(fkey, rec, d)) {
    return (
      <span className="badge" data-testid="derived-override"
        title={t(`方案配置算出来是 ${dv}(${d.packVersion} · ${when})`, `Configuration computed ${dv} (${d.packVersion} · ${when})`)}
        style={{ background: '#fdf3eb', color: '#8A4A17', marginLeft: 6 }}>
        {t('已人工调整', 'edited')}
      </span>
    );
  }
  if (recordVal(rec, fkey).trim()) return null;
  return (
    <span className="badge" data-testid="derived-auto"
      title={t(`来自 LED 方案配置(${d.packVersion} · ${when})`, `From the LED configuration (${d.packVersion} · ${when})`)}
      style={{ background: 'var(--hover-bg)', color: 'var(--text2)', marginLeft: 6 }}>
      {t('配', 'auto')}
    </span>
  );
}
