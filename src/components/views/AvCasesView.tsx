'use client';

/* ===== AV 历史案例 =====
   Search past LED projects by keyword, pitch and area — ported from
   avcost-phase1's 历史案例检索. The library is a copy of the two LED sheets of
   the company's project statistics workbook; PD / BD re-import the workbook to
   refresh it (the whole copy is replaced). */

import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { HistCase } from '@/server/avdb';
import { canEditPrices, canViewPrices } from '@/lib/permissions';
import { fmtDate } from '@/lib/project';
import { useLang } from '@/lib/i18n';
import { useStore } from '../store';

type Library = { count: number; importedBy: string; importedAt: number };
const EMPTY = { q: '', status: '', pitchMin: '', pitchMax: '', sqmMin: '', sqmMax: '' };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init).catch(() => null);
  const body = res ? await res.json().catch(() => ({})) : { error: '网络错误' };
  if (!res?.ok || body.error) throw new Error(body.error || '请求失败');
  return body as T;
}

const n = (v: number | null, digits = 2) => (v === null ? '—' : String(Math.round(v * 10 ** digits) / 10 ** digits));

export default function AvCasesView() {
  const { me } = useStore();
  const { t } = useLang();
  const [filter, setFilter] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [cases, setCases] = useState<HistCase[]>([]);
  const [total, setTotal] = useState(0);
  const [library, setLibrary] = useState<Library | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams(Object.entries(applied).filter(([, v]) => v.trim()));
      const r = await call<{ cases: HistCase[]; total: number; library: Library }>(`/api/av/cases?${qs}`);
      setCases(r.cases); setTotal(r.total); setLibrary(r.library);
    } catch (e) { setError((e as Error).message); }
  }, [applied]);
  useEffect(() => { if (canViewPrices(me)) load(); }, [load, me]);

  if (!canViewPrices(me)) {
    return <div className="panel" style={{ padding: '18px 20px', fontSize: 13, color: 'var(--text2)' }}>{t('当前角色无权查看历史案例。', 'Your role cannot see past cases.')}</div>;
  }

  async function importBook(file: File) {
    setError(''); setMsg(''); setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await call<{ imported: number; sheets: Record<string, number | null> }>('/api/av/cases', { method: 'POST', body: form });
      const per = Object.entries(r.sheets).map(([s, k]) => `${s} ${k ?? t('缺', 'missing')}`).join(' · ');
      setMsg(t(`已导入 ${r.imported} 块屏（${per}），案例库已整体替换。`, `Imported ${r.imported} screens (${per}); the library was replaced.`));
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  const input = (k: keyof typeof EMPTY, label: string, w: number, ph = '') => (
    <div className="field" style={{ marginBottom: 0, width: w }}>
      <label htmlFor={`case-${k}`}>{label}</label>
      <input id={`case-${k}`} type={k === 'q' ? 'search' : 'number'} step="any" placeholder={ph} value={filter[k]}
        onChange={(e) => setFilter({ ...filter, [k]: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') setApplied(filter); }} />
    </div>
  );

  return (
    <div className="panel clip" style={{ padding: 0 }}>
      <div className="panel-head">
        <span className="panel-title">{t('LED 历史案例', 'Past LED projects')}
          <span style={{ fontWeight: 400, color: 'var(--text2)', fontSize: 12 }}> · {library?.count ?? 0} {t('块屏', 'screens')}
            {library?.importedAt ? ` · ${t('导入于', 'imported')} ${fmtDate(new Date(library.importedAt))} · ${library.importedBy}` : ''}</span>
        </span>
        {canEditPrices(me) && (
          <span>
            <input ref={fileRef} type="file" accept=".xlsx" hidden aria-label={t('统计表文件', 'Workbook file')}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importBook(f); }} />
            <button className="btn-navy" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? t('导入中…', 'Importing…') : t('导入项目统计表（xlsx）', 'Import project workbook (xlsx)')}
            </button>
          </span>
        )}
      </div>

      <div style={{ padding: '12px 18px', display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          {input('q', t('关键词', 'Keyword'), 240, t('项目 / 客户 / 地址 / 型号 / 编号', 'Project / client / address / model'))}
          <div className="field" style={{ marginBottom: 0, width: 110 }}>
            <label htmlFor="case-status">{t('状态', 'Status')}</label>
            <select id="case-status" value={filter.status} onChange={(e) => { const f = { ...filter, status: e.target.value }; setFilter(f); setApplied(f); }}>
              <option value="">{t('全部', 'All')}</option>
              <option value="ongoing">{t('进行中', 'Ongoing')}</option>
              <option value="completed">{t('已完成', 'Completed')}</option>
            </select>
          </div>
          {input('pitchMin', t('点间距 ≥ (mm)', 'Pitch ≥ (mm)'), 110)}
          {input('pitchMax', t('点间距 ≤ (mm)', 'Pitch ≤ (mm)'), 110)}
          {input('sqmMin', t('面积 ≥ (㎡)', 'Area ≥ (㎡)'), 100)}
          {input('sqmMax', t('面积 ≤ (㎡)', 'Area ≤ (㎡)'), 100)}
          <button className="btn-navy" onClick={() => setApplied(filter)}>{t('检索', 'Search')}</button>
          <button className="btn-line" onClick={() => { setFilter(EMPTY); setApplied(EMPTY); }}>{t('清空', 'Clear')}</button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
          {t('案例来自公司《All the Project Links》统计表的 LED 进行中、已完成两张工作表，每行一块屏，同一项目的多块屏分行列出。点间距从型号栏识别（如 P1.56 COB），型号未写点间距的屏在按点间距筛选时不出现。按面积从大到小排列。',
            'From the two LED sheets of the company project workbook, one row per screen. Pitch is read from the model column; screens without it drop out of pitch filters. Largest first.')}
        </p>
        {msg && <div style={{ fontSize: 12.5, color: 'var(--success)' }}>{msg}</div>}
        {error && <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>{error}</div>}
      </div>

      {library?.count === 0 ? (
        <p style={{ padding: '0 18px 18px', fontSize: 13, color: 'var(--text2)' }}>
          {canEditPrices(me) ? t('案例库为空，请导入项目统计表。', 'The library is empty. Import the project workbook.') : t('案例库为空，请 PD / BD 导入项目统计表。', 'The library is empty; PD / BD can import the workbook.')}
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 1180 }}>
            <tbody>
              <tr>
                {[t('项目', 'Project'), t('客户', 'Client'), t('状态', 'Status'), t('尺寸 (mm)', 'Size (mm)'), t('面积 ㎡', 'Area ㎡'), t('点间距', 'Pitch'),
                  t('型号', 'Model'), t('模组', 'Modules'), t('功耗 kW', 'Power kW'), t('电源线', 'Power cables'), t('数据线', 'Data cables'), t('备注', 'Remarks')].map((h, i) => <th key={i} style={th}>{h}</th>)}
              </tr>
              {cases.map((c) => (
                <tr key={c.id}>
                  <td style={{ ...td, minWidth: 180, maxWidth: 260 }}><div style={{ fontWeight: 600 }}>{c.name}</div>{c.address && <div style={{ color: 'var(--text2)', fontSize: 11.5 }}>{c.address}</div>}</td>
                  <td style={{ ...td, minWidth: 100, maxWidth: 160 }}>{c.client || '—'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{c.status === 'ongoing' ? t('进行中', 'Ongoing') : t('已完成', 'Completed')}{c.year ? ` · ${c.year}` : ''}{c.refNo ? ` · #${c.refNo}` : ''}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }} className="tnum">{c.widthMm !== null && c.heightMm !== null ? `${n(c.widthMm, 0)} × ${n(c.heightMm, 0)}` : '—'}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }} className="tnum">{n(c.sqm)}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{c.pitch === null ? '—' : `P${c.pitch}`}</td>
                  <td style={{ ...td, minWidth: 120, maxWidth: 200 }}>{c.product || '—'}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }} className="tnum">{c.modules ?? '—'}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }} className="tnum">{n(c.kw)}</td>
                  <td style={{ ...td, minWidth: 80, maxWidth: 140 }}>{c.powerCable || '—'}</td>
                  <td style={{ ...td, maxWidth: 140 }}>{c.dataCable || '—'}</td>
                  <td style={{ ...td, color: 'var(--text2)', minWidth: 160, maxWidth: 280 }}>{c.remarks || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ padding: '10px 18px', fontSize: 12, color: 'var(--text2)' }}>
            {total > cases.length ? t(`共 ${total} 个匹配，显示前 ${cases.length} 个，请收窄条件。`, `${total} matches; showing the first ${cases.length}.`) : t(`共 ${total} 个匹配。`, `${total} matches.`)}
          </p>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '9px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em',
  color: 'var(--text2)', background: 'var(--hover-bg)', textAlign: 'left', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { padding: '8px 12px', borderTop: '1px solid var(--row-line)', verticalAlign: 'top', overflowWrap: 'break-word' };
