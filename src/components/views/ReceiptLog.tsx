'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { useLang } from '@/lib/i18n';
import { fmtDate, parseISO } from '@/lib/project';
import { CM } from '../ui';
import { RECEIVE_VIA, viaName } from '@/lib/receipts';
import type { ChecklistStatus, Project, ReceiptRecord } from '@/lib/types';

/* ===== REQ-042: 收料记录 =====
   两块:
   ① ItemReceipts —— 挂在某个信息项下面的历史(Item History),
      最新一条标 Latest 置顶,可追加 / 编辑 / 删除。
   ② ReceivingLog —— 「内部收料记录」整表视图(Document Receiving Log):
      全部项的全部记录摊平成一张表,带路径和备注,可搜索 / 按状态 / 按项筛。
   「对外清单」就是原来那张清单页 —— 它本来就只显示每项最新状态,
   不暴露路径和内部备注,所以不需要再做一套。 */

const statusMeta = (s: string) => CM[s as ChecklistStatus] || { zh: s, label: s, bg: 'var(--hover-bg)', fg: 'var(--text2)' };

export function StatusBadge({ s, lang }: { s: string; lang: 'zh' | 'en' }) {
  const m = statusMeta(s);
  return <span className="badge" style={{ background: m.bg, color: m.fg }}>{lang === 'zh' ? m.zh : m.label}</span>;
}

/* ---------- ① 单项历史 ---------- */
export function ItemReceipts({ p, pkgIdx, gi, ii, receipts, canEd, onClose }: {
  p: Project; pkgIdx: number; gi: number; ii: number;
  receipts: ReceiptRecord[]; canEd: boolean; onClose: () => void;
}) {
  const { dispatch } = useStore();
  const { lang, t } = useLang();
  const [adding, setAdding] = useState(receipts.length === 0);
  const [editId, setEditId] = useState<string | null>(null);

  return (
    <div style={{ padding: '12px 24px 16px 44px', background: 'var(--hover-bg)', borderBottom: '1px solid var(--row-line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy900)' }}>
          {t('收料记录', 'Receiving log')} ({receipts.length})
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>
          {t('每收到一版就追加一条,旧的留在历史里,不会被覆盖。', 'Each delivery is appended — earlier versions stay in the history.')}
        </span>
        <div style={{ flex: 1 }} />
        {canEd && !adding && <button className="btn-navy sm" onClick={() => { setAdding(true); setEditId(null); }}>＋ {t('追加记录', 'Add record')}</button>}
        <button className="btn-line sm" onClick={onClose}>{t('收起', 'Close')}</button>
      </div>

      {adding && canEd && (
        <ReceiptForm lang={lang} onCancel={() => setAdding(false)}
          onSave={async (rec) => { await dispatch(p.id, { type: 'addReceipt', pkg: pkgIdx, gi, ii, rec }); setAdding(false); }} />
      )}

      {receipts.length === 0 && !adding && (
        <div style={{ fontSize: 12.5, color: 'var(--text2)', padding: '6px 0' }}>{t('还没有收料记录。', 'No records yet.')}</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {receipts.map((r, i) => editId === r.id && canEd ? (
          <ReceiptForm key={r.id} lang={lang} init={r} onCancel={() => setEditId(null)}
            onSave={async (rec) => { await dispatch(p.id, { type: 'editReceipt', pkg: pkgIdx, gi, ii, id: r.id, rec }); setEditId(null); }} />
        ) : (
          <div key={r.id} style={{
            border: '1px solid var(--border)', borderRadius: 9, padding: '9px 12px',
            background: 'var(--card,#fff)', borderLeftWidth: i === 0 ? 3 : 1,
            borderLeftColor: i === 0 ? 'var(--navy700)' : 'var(--border)',
          }}>
            <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5 }}>
              {i === 0 && <span className="badge" style={{ background: 'var(--navy900)', color: '#fff' }}>Latest</span>}
              <StatusBadge s={r.status} lang={lang} />
              <span className="tnum" style={{ color: 'var(--text2)' }}>{r.date ? fmtDate(parseISO(r.date)) : '—'}</span>
              <b style={{ minWidth: 0, wordBreak: 'break-all' }}>{r.fileName || t('(未填文件名)', '(no file name)')}</b>
              {r.from && <span style={{ color: 'var(--text2)' }}>· {t('来自', 'from')} {r.from}</span>}
              {r.via && <span style={{ color: 'var(--text2)' }}>· {viaName(r.via, lang)}</span>}
              <div style={{ flex: 1 }} />
              {canEd && (
                <>
                  <button className="btn-line sm" onClick={() => { setEditId(r.id); setAdding(false); }}>{t('编辑', 'Edit')}</button>
                  <button className="btn-line sm danger" onClick={() => {
                    if (!confirm(t(`删除这条收料记录(${r.fileName || r.date || '无文件名'})?不能撤销。`,
                                   `Delete this record (${r.fileName || r.date || 'unnamed'})? This cannot be undone.`))) return;
                    dispatch(p.id, { type: 'removeReceipt', pkg: pkgIdx, gi, ii, id: r.id });
                  }}>✕</button>
                </>
              )}
            </div>
            {(r.path || r.remark) && (
              <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 5, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                {r.path && <span style={{ wordBreak: 'break-all' }}>📁 {r.path}</span>}
                {r.remark && <span style={{ whiteSpace: 'pre-wrap' }}>💬 {r.remark}</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReceiptForm({ init, lang, onSave, onCancel }: {
  init?: ReceiptRecord; lang: 'zh' | 'en';
  onSave: (r: Partial<ReceiptRecord>) => Promise<void>; onCancel: () => void;
}) {
  const { t } = useLang();
  const [d, setD] = useState<Partial<ReceiptRecord>>(() => init
    ? { ...init }
    : { date: new Date().toISOString().slice(0, 10), status: 'received' as ChecklistStatus, fileName: '', from: '', via: 'email', path: '', remark: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof ReceiptRecord, v: string) => setD((x) => ({ ...x, [k]: v }));

  return (
    <div style={{ border: '1px solid var(--navy700)', borderRadius: 9, padding: '11px 13px', background: 'var(--card,#fff)', marginBottom: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 9 }}>
        <label style={fl}>{t('收到日期', 'Date received')}
          <input className="in sm" type="date" aria-label={t('收到日期', 'Date received')} value={d.date || ''} onChange={(e) => set('date', e.target.value)} />
        </label>
        <label style={fl}>{t('文件名称', 'File name')}
          <input className="in sm" aria-label={t('文件名称', 'File name')} value={d.fileName || ''} maxLength={300} placeholder="CAD_v02.dwg" onChange={(e) => set('fileName', e.target.value)} />
        </label>
        <label style={fl}>{t('来自', 'From')}
          <input className="in sm" aria-label={t('来自', 'From')} value={d.from || ''} maxLength={120} placeholder={t('建筑师 / 客户 …', 'Architect / client …')} onChange={(e) => set('from', e.target.value)} />
        </label>
        <label style={fl}>{t('收到方式', 'Received via')}
          <select className="in sm" aria-label={t('收到方式', 'Received via')} value={d.via || ''} onChange={(e) => set('via', e.target.value)}>
            <option value="">—</option>
            {RECEIVE_VIA.map((v) => <option key={v[0]} value={v[0]}>{lang === 'zh' ? v[1] : v[2]}</option>)}
          </select>
        </label>
        <label style={fl}>{t('状态', 'Status')}
          <select className="in sm" aria-label={t('记录状态', 'Record status')} value={d.status || 'received'} onChange={(e) => set('status', e.target.value)}>
            {Object.entries(CM).map(([k, v]) => <option key={k} value={k}>{lang === 'zh' ? v.zh : v.label}</option>)}
          </select>
        </label>
        <label style={{ ...fl, gridColumn: '1 / -1' }}>{t('保存路径(服务器位置)', 'Saved path (server location)')}
          <input className="in sm" aria-label={t('保存路径', 'Saved path')} value={d.path || ''} maxLength={500} placeholder="\\\\server\\projects\\2026\\Lentor\\CAD\\v02" onChange={(e) => set('path', e.target.value)} />
        </label>
        <label style={{ ...fl, gridColumn: '1 / -1' }}>{t('备注', 'Remark')}
          <textarea className="in sm" aria-label={t('记录备注', 'Record remark')} value={d.remark || ''} maxLength={1000} style={{ minHeight: 46 }} onChange={(e) => set('remark', e.target.value)} />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 9, justifyContent: 'flex-end' }}>
        <button className="btn-line sm" disabled={busy} onClick={onCancel}>{t('取消', 'Cancel')}</button>
        <button className="btn-navy sm" disabled={busy}
          onClick={async () => { setBusy(true); await onSave(d); setBusy(false); }}>
          {busy ? t('保存中…', 'Saving…') : (init ? t('保存修改', 'Save') : t('追加这条记录', 'Add record'))}
        </button>
      </div>
    </div>
  );
}

/* ---------- ② 内部收料记录(整表) ---------- */
export function ReceivingLog({ p, pkgIdx, canEd, onOpenItem }: {
  p: Project; pkgIdx: number; canEd: boolean;
  onOpenItem: (gi: number, ii: number) => void;
}) {
  const { lang, t } = useLang();
  const [q, setQ] = useState('');
  const [st, setSt] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const pkg = p.packages[pkgIdx];

  /* 全部项的全部记录摊平成一张表 —— 这是「谁什么时候给了什么」的流水账,
     所以按时间倒序排,而不是按清单顺序。 */
  const rows = useMemo(() => {
    const out: { gi: number; ii: number; item: string; group: string; r: ReceiptRecord; isLatest: boolean }[] = [];
    pkg.checklist.forEach((g, gi) => g.items.forEach((it, ii) => {
      (it.receipts || []).forEach((r, k) => {
        out.push({ gi, ii, item: lang === 'zh' ? it.zh : (it.en || it.zh), group: lang === 'zh' ? g.group : (g.groupEn || g.group), r, isLatest: k === 0 });
      });
    }));
    return out.sort((a, b) => (b.r.date || '').localeCompare(a.r.date || '') || (b.r.at || 0) - (a.r.at || 0));
  }, [pkg, lang]);

  const shown = rows.filter((x) => {
    if (st && x.r.status !== st) return false;
    if (from && (x.r.date || '') < from) return false;
    if (to && (x.r.date || '') > to) return false;
    if (!q.trim()) return true;
    const s = q.trim().toLowerCase();
    return (x.item + x.group + x.r.fileName + x.r.from + x.r.path + x.r.remark).toLowerCase().includes(s);
  });

  function exportCsv() {
    const qt = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const head = [t('分类', 'Section'), t('信息项', 'Item'), t('收到日期', 'Date'), t('文件名称', 'File name'),
      t('来自', 'From'), t('收到方式', 'Via'), t('保存路径', 'Path'), t('状态', 'Status'), t('备注', 'Remark'), t('录入人', 'Logged by')];
    const body = shown.map((x) => [x.group, x.item, x.r.date, x.r.fileName, x.r.from,
      viaName(x.r.via, lang), x.r.path, lang === 'zh' ? statusMeta(x.r.status).zh : statusMeta(x.r.status).label, x.r.remark, x.r.by]);
    const csv = '﻿' + [head, ...body].map((r) => r.map(qt).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    /* REQ-041: 文件名也跟着界面语言走 —— 导出的东西是要发出去的 */
    a.href = url; a.download = `${t('收料记录', 'Receiving log')}_${p.name.replace(/[\\/:*?"<>|]/g, '_')}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="panel" style={{ padding: '12px 16px', display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
        <input className="in sm" style={{ flex: 1, minWidth: 180 }} value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={t('搜索 信息项 / 文件名 / 来自 / 路径 / 备注…', 'Search item, file, sender, path or remark…')} />
        <select className="in sm" style={{ width: 'auto' }} value={st} onChange={(e) => setSt(e.target.value)}>
          <option value="">{t('全部状态', 'All statuses')}</option>
          {Object.entries(CM).map(([k, v]) => <option key={k} value={k}>{lang === 'zh' ? v.zh : v.label}</option>)}
        </select>
        <input className="in sm" type="date" style={{ width: 144 }} value={from} onChange={(e) => setFrom(e.target.value)} title={t('起始日期', 'From')} />
        <span style={{ color: 'var(--text2)' }}>→</span>
        <input className="in sm" type="date" style={{ width: 144 }} value={to} onChange={(e) => setTo(e.target.value)} title={t('结束日期', 'To')} />
        <button className="btn-line sm" onClick={exportCsv} disabled={!shown.length}>⤓ {t('导出 CSV', 'Export CSV')}</button>
      </div>

      <div className="panel clip">
        <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--row-line)', fontSize: 11.5, color: 'var(--text2)' }}>
          {t(`共 ${rows.length} 条记录,当前显示 ${shown.length} 条。这是内部视图 —— 含服务器路径与内部备注,不要直接发给客户。`,
             `${rows.length} records, ${shown.length} shown. Internal view — includes server paths and internal remarks; do not send to clients.`)}
        </div>
        {shown.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
            {rows.length === 0
              ? t('还没有任何收料记录。回「对外清单」页,点某一项的「记录」按钮追加第一条。',
                  'No records yet. Go back to the checklist and add the first one from an item.')
              : t('没有符合筛选条件的记录。', 'No records match the filters.')}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {[t('收到日期', 'Date'), t('信息项', 'Item'), t('文件名称', 'File name'), t('来自 / 方式', 'From / via'),
                  t('保存路径', 'Path'), t('状态', 'Status'), t('备注', 'Remark')].map((h, i) => <th key={i} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {shown.map((x) => (
                <tr key={x.r.id}>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                    <span className="tnum">{x.r.date ? fmtDate(parseISO(x.r.date)) : '—'}</span>
                    {x.isLatest && <span className="badge" style={{ background: 'var(--navy900)', color: '#fff', marginLeft: 6 }}>Latest</span>}
                  </td>
                  <td style={cell}>
                    <button style={{ color: 'var(--info)', textAlign: 'left' }} onClick={() => onOpenItem(x.gi, x.ii)}
                      title={t('回清单页看这一项的全部记录', 'Open this item’s history in the checklist')}>{x.item}</button>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--text2)' }}>{x.group}</span>
                  </td>
                  <td style={{ ...cell, wordBreak: 'break-all' }}>{x.r.fileName || '—'}</td>
                  <td style={cell}>{x.r.from || '—'}{x.r.via ? <span style={{ display: 'block', fontSize: 11, color: 'var(--text2)' }}>{viaName(x.r.via, lang)}</span> : null}</td>
                  <td style={{ ...cell, wordBreak: 'break-all', fontSize: 11.5, color: 'var(--text2)' }}>{x.r.path || '—'}</td>
                  <td style={cell}><StatusBadge s={x.r.status} lang={lang} /></td>
                  <td style={{ ...cell, fontSize: 11.5, color: 'var(--text2)', whiteSpace: 'pre-wrap' }}>{x.r.remark || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const fl: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5, color: 'var(--text2)', fontWeight: 600 };
const th: React.CSSProperties = { textAlign: 'left', padding: '9px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text2)', borderBottom: '1px solid var(--row-line)' };
const cell: React.CSSProperties = { padding: '9px 14px', fontSize: 12.5, borderTop: '1px solid var(--row-line)', verticalAlign: 'top' };
