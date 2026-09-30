'use client';

/* ===== AV 历史案例(AV-012 + AV-014)=====
   案例库是公司《All the Project Links》统计表两张 LED 工作表的可检索副本。

   AV-014 加了四样:显示顺序可切换、按年份 / 客户筛选、年份单独一列并新增
   交付日期与保修到期、以及直接在平台上改。

   两件事值得记着:
   · 排序和筛选都是服务端做的 —— 列表有 500 条上限,在前端排只排得到前
     500 条,那是错的。所以点列头是发一次请求,不是本地 sort。
   · 人工改过的值叠在原始导入值上面,重新导入冲不掉(服务端 av_case_edit)。
     导入因此分两步:先出预览,确认了才写。 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { CaseRow } from '@/server/avdb';
import { canEditPrices, canViewPrices } from '@/lib/permissions';
import { fmtDate, parseISO } from '@/lib/project';
import { logText } from '@/lib/logmsg';
import { caseFieldTerm } from '@/lib/terms';
import { useLang } from '@/lib/i18n';
import { useStore } from '../store';

type Library = { count: number; importedBy: string; importedAt: number };
type Facets = { years: { year: string; n: number }[]; clients: { client: string; n: number }[]; warranty: Record<string, number> };
/* 「筛选」浮层里的条件(年份、客户;AV-014 §7 又加了保修状态与交付日期范围) */
type PopFilter = { years: string[]; clients: string[]; warranty: string[]; hFrom: string; hTo: string };
const EMPTY_PF: PopFilter = { years: [], clients: [], warranty: [], hFrom: '', hTo: '' };
/* 保修状态的顺序与叫法 —— 与表格里的标签同一套三档,外加「未填」 */
const WARRANTY_OPTS = [
  { k: 'ok', zh: '在保', en: 'Under warranty' },
  { k: 'soon', zh: '30 天内到期', en: 'Expires within 30 days' },
  { k: 'expired', zh: '已过保', en: 'Expired' },
  { k: 'none', zh: '未填', en: 'Not set' },
] as const;
/** 别的页面(「我的待办」的保修提醒)跳进来时带的预设筛选,见 presetCaseFilter */
export const CASE_PRESET_KEY = 'audax.avcases.preset';
export function presetCaseFilter(p: Partial<PopFilter>, sort?: { k: string; dir: 'asc' | 'desc' }): void {
  try {
    sessionStorage.setItem(CASE_PRESET_KEY, JSON.stringify(p));
    if (sort) localStorage.setItem(SORT_STORE, JSON.stringify(sort));
  } catch { /* 存不上就只是跳过去不带筛选 */ }
}
type LogRow = { at: number; by: string; k: string; p: Record<string, unknown> };
type Sibling = { caseKey: string; widthMm: number | null; heightMm: number | null; handover: string | null; warrantyMonths: number };
type Preview = {
  added: number; updated: number; manualFields: number; manualScreens: number;
  handoverKept: number; removed: number; keptMissing: number;
};

const EMPTY = { q: '', status: '', pitchMin: '', pitchMax: '', sqmMin: '', sqmMax: '' };
const SORT_STORE = 'audax.avcases.sort';
const DEFAULT_WARRANTY_MONTHS = 12;

/* 排序字段与它的默认方向 + 两个方向各怎么念(AV-014 §3.1) */
const SORTS = [
  { k: 'sqm', zh: '面积', en: 'Area', def: 'desc', up: ['小→大', 'low→high'], down: ['大→小', 'high→low'] },
  { k: 'year', zh: '年份', en: 'Year', def: 'desc', up: ['旧→新', 'old→new'], down: ['新→旧', 'new→old'] },
  { k: 'handover', zh: 'Handover date', en: 'Handover date', def: 'desc', up: ['早→晚', 'early→late'], down: ['晚→早', 'late→early'] },
  { k: 'expire', zh: 'Expire Warranty', en: 'Expire Warranty', def: 'asc', up: ['近→远', 'soon→later'], down: ['远→近', 'later→soon'] },
  { k: 'name', zh: '项目名', en: 'Project', def: 'asc', up: ['A→Z', 'A→Z'], down: ['Z→A', 'Z→A'] },
  { k: 'client', zh: '客户', en: 'Client', def: 'asc', up: ['A→Z', 'A→Z'], down: ['Z→A', 'Z→A'] },
  { k: 'pitch', zh: '点间距', en: 'Pitch', def: 'asc', up: ['小→大', 'low→high'], down: ['大→小', 'high→low'] },
  { k: 'kw', zh: '功耗', en: 'Power', def: 'desc', up: ['小→大', 'low→high'], down: ['大→小', 'high→low'] },
] as const;
type SortKey = typeof SORTS[number]['k'];
const sortDef = (k: string) => SORTS.find((s) => s.k === k) ?? SORTS[0];

/* 抽屉里的字段排布,与原型一致 */
type EditField = { k: keyof CaseRow | 'warrantyMonths'; type?: 'number' | 'date' | 'select' | 'textarea'; full?: boolean };
const EDIT_FIELDS: (EditField | { sec: 'spec' | 'handover' })[] = [
  { k: 'name', full: true }, { k: 'client' }, { k: 'year', type: 'number' },
  { k: 'address', full: true }, { k: 'status', type: 'select' }, { k: 'refNo' },
  { sec: 'spec' },
  { k: 'widthMm', type: 'number' }, { k: 'heightMm', type: 'number' }, { k: 'sqm', type: 'number' }, { k: 'pitch', type: 'number' },
  { k: 'product', full: true }, { k: 'modules', type: 'number' }, { k: 'kw', type: 'number' },
  { k: 'powerCable' }, { k: 'dataCable' },
  { k: 'remarks', full: true, type: 'textarea' },
  { sec: 'handover' },
  { k: 'handover', type: 'date' }, { k: 'warrantyMonths', type: 'number' },
];

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init).catch(() => null);
  const body = res ? await res.json().catch(() => ({})) : { error: '网络错误' };
  if (!res?.ok || body.error) throw new Error(body.error || '请求失败');
  return body as T;
}

const n = (v: number | null, digits = 2) => (v === null ? '—' : String(Math.round(v * 10 ** digits) / 10 ** digits));
const DAY = 86_400_000;
/* 统计表里有来源的字段(交付日期与保修期没有,只可能是人工填的) */
const HAS_SOURCE = new Set(['name', 'client', 'year', 'address', 'status', 'refNo', 'widthMm', 'heightMm',
  'sqm', 'pitch', 'product', 'modules', 'kw', 'powerCable', 'dataCable', 'remarks']);
const revertBtn: React.CSSProperties = { marginLeft: 6, padding: '1px 7px', fontSize: 11, fontWeight: 400 };

/* badge 在这个平台上是「自带底色」的,所以配色都写明。 */
const TAG = {
  ok: { background: '#e3f3ec', color: 'var(--success)' },
  warn: { background: '#fdf0da', color: 'var(--warning)' },
  bad: { background: '#fbe0e0', color: 'var(--danger)' },
  manual: { background: '#f6ecdf', color: 'var(--bronze)' },
  chip: { background: '#eef3fa', color: 'var(--info)' },
} as const;

/** 保修状态:> 30 天在保,0–30 天快到期,已过则过保(AV-014 §3.3)。 */
function warranty(expire: string | null): { tag: React.CSSProperties; zh: string; en: string } | null {
  const d = parseISO(expire);
  if (!d) return null;
  const today = new Date();
  const days = Math.round((d.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / DAY);
  if (days < 0) return { tag: TAG.bad, zh: '已过保', en: 'Expired' };
  if (days <= 30) return { tag: TAG.warn, zh: `${days} 天后到期`, en: `expires in ${days}d` };
  return { tag: TAG.ok, zh: '在保', en: 'Under warranty' };
}

export default function AvCasesView() {
  const { me } = useStore();
  const { t, lang } = useLang();
  const [filter, setFilter] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [pf, setPf] = useState<PopFilter>(EMPTY_PF);
  const [sort, setSort] = useState<{ k: SortKey; dir: 'asc' | 'desc' }>({ k: 'sqm', dir: 'desc' });
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [total, setTotal] = useState(0);
  const [library, setLibrary] = useState<Library | null>(null);
  const [facets, setFacets] = useState<Facets>({ years: [], clients: [], warranty: {} });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editing, setEditing] = useState<CaseRow | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  /* 这次保存要把哪些字段退回统计表的值(§3.4 之外的一处补充,见 editCase) */
  const [revert, setRevert] = useState<string[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  /* 同项目的其它屏,与「同步交付日期 / 保修期」勾选(AV-014 §7) */
  const [siblings, setSiblings] = useState<Sibling[]>([]);
  const [syncProject, setSyncProject] = useState(false);
  const [popOpen, setPopOpen] = useState(false);
  const [draft, setDraft] = useState<PopFilter>(EMPTY_PF);
  const [clientQ, setClientQ] = useState('');
  const [pending, setPending] = useState<{ file: File; preview: Preview } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /* 上次选的顺序记在本地(§3.1) */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SORT_STORE);
      if (!raw) return;
      const s = JSON.parse(raw) as { k?: string; dir?: string };
      if (SORTS.some((x) => x.k === s.k) && (s.dir === 'asc' || s.dir === 'desc')) setSort({ k: s.k as SortKey, dir: s.dir });
    } catch { /* 隐私模式下读不到,用默认顺序就好 */ }
  }, []);
  /* 从别的页面带着筛选条件跳进来(「我的待办」里点保修提醒)。读一次就删,
     之后自己点进来的还是干净的列表。 */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CASE_PRESET_KEY);
      if (!raw) return;
      sessionStorage.removeItem(CASE_PRESET_KEY);
      setPf({ ...EMPTY_PF, ...(JSON.parse(raw) as Partial<PopFilter>) });
    } catch { /* 读不到就按默认列表 */ }
  }, []);
  const setSortSaved = (s: { k: SortKey; dir: 'asc' | 'desc' }) => {
    setSort(s);
    try { localStorage.setItem(SORT_STORE, JSON.stringify(s)); } catch { /* 存不上不影响使用 */ }
  };

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams(Object.entries(applied).filter(([, v]) => v.trim()));
      if (pf.years.length) qs.set('years', pf.years.join(','));
      if (pf.clients.length) qs.set('clients', pf.clients.join(','));
      if (pf.warranty.length) qs.set('warranty', pf.warranty.join(','));
      if (pf.hFrom) qs.set('handoverFrom', pf.hFrom);
      if (pf.hTo) qs.set('handoverTo', pf.hTo);
      qs.set('sort', sort.k); qs.set('dir', sort.dir);
      const r = await call<{ cases: CaseRow[]; total: number; library: Library; facets: Facets }>(`/api/av/cases?${qs}`);
      setCases(r.cases); setTotal(r.total); setLibrary(r.library); setFacets(r.facets);
    } catch (e) { setError((e as Error).message); }
  }, [applied, pf, sort]);
  useEffect(() => { if (canViewPrices(me)) load(); }, [load, me]);

  if (!canViewPrices(me)) {
    return <div className="panel" style={{ padding: '18px 20px', fontSize: 13, color: 'var(--text2)' }}>{t('当前角色无权查看历史案例。', 'Your role cannot see past cases.')}</div>;
  }
  const canEdit = canEditPrices(me);

  /* ---- 导入:先预览,确认才写(§4)---- */
  async function preview(file: File) {
    setError(''); setMsg(''); setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file); form.append('dryRun', '1');
      const r = await call<{ preview: Preview }>('/api/av/cases', { method: 'POST', body: form });
      setPending({ file, preview: r.preview });
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }
  async function confirmImport() {
    if (!pending) return;
    setError(''); setBusy(true);
    try {
      const form = new FormData();
      form.append('file', pending.file);
      const r = await call<{ imported: number; sheets: Record<string, number | null> }>('/api/av/cases', { method: 'POST', body: form });
      const per = Object.entries(r.sheets).map(([s, k]) => `${s} ${k ?? t('缺', 'missing')}`).join(' · ');
      const p = pending.preview;
      setMsg(t(`已导入 ${r.imported} 块屏（${per}）。保留人工修改 ${p.manualFields} 个字段。`,
        `Imported ${r.imported} screens (${per}). ${p.manualFields} manual fields kept.`));
      setPending(null);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  /* ---- 编辑 ---- */
  async function openEdit(c: CaseRow) {
    setEditing(c); setError('');
    const f: Record<string, string> = {};
    for (const it of EDIT_FIELDS) {
      if ('sec' in it) continue;
      const v = (c as unknown as Record<string, unknown>)[it.k];
      f[it.k as string] = v == null ? '' : String(v);
    }
    setForm(f);
    setRevert([]);
    setLog([]);
    setSiblings([]); setSyncProject(false);
    try {
      const r = await call<{ log: LogRow[]; siblings?: Sibling[] }>(`/api/av/cases?caseKey=${encodeURIComponent(c.caseKey)}`);
      setLog(r.log ?? []);
      setSiblings(r.siblings ?? []);
    } catch { /* 修改记录读不到不该挡住编辑 */ }
  }
  async function save() {
    if (!editing) return;
    setBusy(true); setError('');
    try {
      const r = await call<{ case: CaseRow; changes: { field: string }[]; synced: number }>('/api/av/cases', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseKey: editing.caseKey, fields: form, revert, syncProject: syncProject && siblings.length > 0 }),
      });
      const base = r.changes.length
        ? t(`已保存 ${r.changes.length} 处修改。`, `Saved ${r.changes.length} change(s).`)
        : t('这块屏没有改动。', 'Nothing changed on this screen.');
      setMsg(r.synced
        ? base + t(` 交付日期与保修期已同步到本项目其它 ${r.synced} 块屏。`, ` Handover and warranty synced to ${r.synced} other screen(s) of this project.`)
        : base);
      setEditing(null);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  /* 抽屉底部实时算出来的到期日 */
  const liveExpire = (() => {
    const d = parseISO(form.handover || null);
    const m = Number(form.warrantyMonths || DEFAULT_WARRANTY_MONTHS);
    if (!d || !Number.isFinite(m)) return null;
    const e = new Date(d); e.setMonth(e.getMonth() + m);
    return { date: e, months: m, w: warranty(e.toISOString().slice(0, 10)) };
  })();
  /* 面积与长×高对不上就提醒(统计表本身有 6 行是这样,AV-012 记过) */
  const sqmWarn = (() => {
    const w = Number(form.widthMm), h = Number(form.heightMm), s = Number(form.sqm);
    if (!w || !h || !s) return '';
    const calc = w * h / 1e6;
    return Math.abs(calc - s) > 0.05 * s
      ? t(`长 × 高 = ${n(calc)} ㎡，与填写的面积不一致`, `Width × height = ${n(calc)} ㎡, which differs from the area entered`) : '';
  })();

  const input = (k: keyof typeof EMPTY, label: string, w: number, ph = '') => (
    <div className="field" style={{ marginBottom: 0, width: w }}>
      <label htmlFor={`case-${k}`}>{label}</label>
      <input id={`case-${k}`} type={k === 'q' ? 'search' : 'number'} step="any" placeholder={ph} value={filter[k]}
        onChange={(e) => setFilter({ ...filter, [k]: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') setApplied(filter); }} />
    </div>
  );

  const head = (label: string, key?: SortKey, extra?: React.CSSProperties) => {
    if (!key) return <th style={{ ...th, ...extra }}>{label}</th>;
    const on = sort.k === key;
    return (
      <th style={{ ...th, ...extra, cursor: 'pointer', color: on ? 'var(--navy900)' : undefined }}
        data-sort={key} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        onClick={() => setSortSaved(on ? { k: key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { k: key, dir: sortDef(key).def as 'asc' | 'desc' })}>
        {label}<span style={{ marginLeft: 3, opacity: on ? 1 : 0.4 }}>{on ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
      </th>
    );
  };

  const chips = [
    ...pf.years.map((y) => ({ key: `y${y}`, label: `${t('年份', 'Year')}：${y === 'none' ? t('未填', 'blank') : y}`, rm: () => setPf({ ...pf, years: pf.years.filter((x) => x !== y) }) })),
    ...pf.clients.map((c) => ({ key: `c${c}`, label: `${t('客户', 'Client')}：${c}`, rm: () => setPf({ ...pf, clients: pf.clients.filter((x) => x !== c) }) })),
    ...pf.warranty.map((w) => {
      const o = WARRANTY_OPTS.find((x) => x.k === w);
      return { key: `w${w}`, label: `${t('保修', 'Warranty')}：${o ? t(o.zh, o.en) : w}`, rm: () => setPf({ ...pf, warranty: pf.warranty.filter((x) => x !== w) }) };
    }),
    ...(pf.hFrom || pf.hTo ? [{
      key: 'h', rm: () => setPf({ ...pf, hFrom: '', hTo: '' }),
      label: `Handover：${pf.hFrom ? fmtDate(parseISO(pf.hFrom)) : '…'} – ${pf.hTo ? fmtDate(parseISO(pf.hTo)) : '…'}`,
    }] : []),
  ];

  return (
    <div className="panel clip" style={{ padding: 0 }}>
      <div className="panel-head">
        <span className="panel-title">{t('LED 历史案例', 'Past LED projects')}
          <span style={{ fontWeight: 400, color: 'var(--text2)', fontSize: 12 }}> · {library?.count ?? 0} {t('块屏', 'screens')}
            {library?.importedAt ? ` · ${t('导入于', 'imported')} ${fmtDate(new Date(library.importedAt))} · ${library.importedBy}` : ''}</span>
        </span>
        {canEdit && (
          <span style={{ display: 'flex', gap: 8 }}>
            <button className={editMode ? 'btn-navy' : 'btn-line'} onClick={() => setEditMode(!editMode)}>
              {editMode ? t('完成编辑', 'Done editing') : t('编辑', 'Edit')}
            </button>
            <input ref={fileRef} type="file" accept=".xlsx" hidden aria-label={t('统计表文件', 'Workbook file')}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) preview(f); }} />
            <button className="btn-navy" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? t('读取中…', 'Reading…') : t('导入项目统计表（xlsx）', 'Import project workbook (xlsx)')}
            </button>
          </span>
        )}
      </div>

      {editMode && (
        <div style={{ margin: '10px 18px 0', padding: '8px 12px', borderRadius: 7, background: 'var(--hover-bg)', fontSize: 12.5 }}>
          {t('编辑模式：点每行最左边的「编辑」改这一块屏。改过的字段会标「已人工修改」，重新导入统计表时保留。',
            'Editing: use the Edit button on a row. Changed fields are marked as manual and survive re-importing the workbook.')}
        </div>
      )}

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
          <button className="btn-line" onClick={() => { setFilter(EMPTY); setApplied(EMPTY); setPf(EMPTY_PF); }}>{t('清空', 'Clear')}</button>
          <div style={{ position: 'relative' }}>
            <button className="btn-line" aria-expanded={popOpen}
              onClick={() => { setDraft(pf); setClientQ(''); setPopOpen(!popOpen); }}>
              {t('筛选', 'Filter')}{chips.length ? ` · ${chips.length}` : ''}
            </button>
            {popOpen && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 40, width: 360,
                background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10,
                boxShadow: 'var(--shadow-lg)', padding: 14,
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{t('年份', 'Year')}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                  {facets.years.map((y) => {
                    const on = draft.years.includes(y.year);
                    return (
                      <button key={y.year} className={on ? 'btn-navy' : 'btn-line'} style={{ padding: '3px 10px', fontSize: 12, borderRadius: 14 }}
                        onClick={() => setDraft({ ...draft, years: on ? draft.years.filter((x) => x !== y.year) : [...draft.years, y.year] })}>
                        {y.year === 'none' ? `${t('未填年份', 'No year')} (${y.n})` : y.year}
                      </button>
                    );
                  })}
                  {!facets.years.length && <span style={{ fontSize: 12, color: 'var(--text2)' }}>{t('案例库为空', 'Library is empty')}</span>}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{t('保修状态', 'Warranty')}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                  {WARRANTY_OPTS.map((o) => {
                    const on = draft.warranty.includes(o.k);
                    return (
                      <button key={o.k} className={on ? 'btn-navy' : 'btn-line'} style={{ padding: '3px 10px', fontSize: 12, borderRadius: 14 }}
                        data-warranty={o.k}
                        onClick={() => setDraft({ ...draft, warranty: on ? draft.warranty.filter((x) => x !== o.k) : [...draft.warranty, o.k] })}>
                        {t(o.zh, o.en)} ({facets.warranty[o.k] ?? 0})
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{t('交付日期（Handover date）', 'Handover date')}</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12, fontSize: 12 }}>
                  <input type="date" aria-label={t('交付日期从', 'Handover from')} value={draft.hFrom}
                    onChange={(e) => setDraft({ ...draft, hFrom: e.target.value })} style={{ flex: 1 }} />
                  <span>–</span>
                  <input type="date" aria-label={t('交付日期到', 'Handover to')} value={draft.hTo}
                    onChange={(e) => setDraft({ ...draft, hTo: e.target.value })} style={{ flex: 1 }} />
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{t('客户', 'Client')}
                  {draft.clients.length ? <span style={{ fontWeight: 400, color: 'var(--text2)' }}> · {t('已选', 'selected')} {draft.clients.length}</span> : null}</div>
                <input type="search" value={clientQ} onChange={(e) => setClientQ(e.target.value)} placeholder={t('搜索客户…', 'Search clients…')}
                  style={{ width: '100%', marginBottom: 6 }} aria-label={t('搜索客户', 'Search clients')} />
                <div style={{ maxHeight: 190, overflow: 'auto', border: '1px solid var(--row-line)', borderRadius: 7, padding: '4px 8px' }}>
                  {facets.clients.filter((c) => !clientQ.trim() || c.client.toLowerCase().includes(clientQ.trim().toLowerCase())).map((c) => (
                    <label key={c.client} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0', fontSize: 12.5, cursor: 'pointer' }}>
                      <input type="checkbox" checked={draft.clients.includes(c.client)}
                        onChange={(e) => setDraft({ ...draft, clients: e.target.checked ? [...draft.clients, c.client] : draft.clients.filter((x) => x !== c.client) })} />
                      <span style={{ flex: 1 }}>{c.client}</span>
                      <span style={{ color: 'var(--text2)', fontSize: 11.5 }}>{c.n} {t('块屏', 'screens')}</span>
                    </label>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                  <button className="btn-line" onClick={() => setDraft(EMPTY_PF)}>{t('重置', 'Reset')}</button>
                  <button className="btn-navy" onClick={() => {
                    /* 起止填反了就对调,别让人对着空表猜哪里错了 */
                    const d = draft.hFrom && draft.hTo && draft.hFrom > draft.hTo ? { ...draft, hFrom: draft.hTo, hTo: draft.hFrom } : draft;
                    setPf(d); setPopOpen(false);
                  }}>{t('应用', 'Apply')}</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {chips.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {chips.map((c) => (
              <span key={c.key} className="badge" style={{ ...TAG.chip, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                {c.label}
                <button onClick={c.rm} aria-label={t(`移除 ${c.label}`, `Remove ${c.label}`)}
                  style={{ border: 0, background: 'none', cursor: 'pointer', font: 'inherit', padding: 0 }}>×</button>
              </span>
            ))}
            <button className="btn-line" style={{ padding: '2px 9px', fontSize: 12 }}
              onClick={() => setPf(EMPTY_PF)}>{t('清除全部筛选', 'Clear all filters')}</button>
          </div>
        )}

        {/* 显示顺序(§3.1) */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5 }}>
          <strong>{t('显示顺序', 'Order by')}</strong>
          <select aria-label={t('显示顺序', 'Order by')} value={sort.k}
            onChange={(e) => { const k = e.target.value as SortKey; setSortSaved({ k, dir: sortDef(k).def as 'asc' | 'desc' }); }}>
            {SORTS.map((s) => <option key={s.k} value={s.k}>{t(s.zh, s.en)}</option>)}
          </select>
          <button className="btn-line" style={{ padding: '4px 10px', fontWeight: 700, minWidth: 96 }}
            onClick={() => setSortSaved({ ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}>
            {sort.dir === 'asc' ? '↑ ' : '↓ '}{t(...(sort.dir === 'asc' ? sortDef(sort.k).up : sortDef(sort.k).down) as [string, string])}
          </button>
          <span style={{ color: 'var(--text2)' }}>{t('也可以直接点列头，再点一次反向', 'Or click a column header; click again to reverse')}</span>
        </div>

        <p style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
          {t('案例来自公司《All the Project Links》统计表的 LED 进行中、已完成两张工作表，每行一块屏，同一项目的多块屏分行列出。点间距从型号栏识别（如 P1.56 COB），型号未写点间距的屏在按点间距筛选时不出现。Handover date 与保修期在「编辑」里手填，Expire Warranty = Handover date + 保修期，自动计算。',
            'From the two LED sheets of the company project workbook, one row per screen. Pitch is read from the model column; screens without it drop out of pitch filters. Handover date and warranty months are entered by hand under Edit; Expire Warranty is computed from them.')}
        </p>
        {msg && <div style={{ fontSize: 12.5, color: 'var(--success)' }}>{msg}</div>}
        {error && <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>{error}</div>}
      </div>

      {library?.count === 0 ? (
        <p style={{ padding: '0 18px 18px', fontSize: 13, color: 'var(--text2)' }}>
          {canEdit ? t('案例库为空，请导入项目统计表。', 'The library is empty. Import the project workbook.') : t('案例库为空，请 PD / BD 导入项目统计表。', 'The library is empty; PD / BD can import the workbook.')}
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 1420 }}>
            <thead>
              <tr>
                {editMode && <th style={th} aria-label={t('操作', 'Actions')} />}
                {head(t('项目', 'Project'), 'name')}
                {head(t('客户', 'Client'), 'client')}
                {head(t('年份', 'Year'), 'year')}
                {head(t('状态', 'Status'))}
                {head(t('尺寸 (mm)', 'Size (mm)'))}
                {head(t('面积 ㎡', 'Area ㎡'), 'sqm')}
                {head(t('点间距', 'Pitch'), 'pitch')}
                {head(t('型号', 'Model'))}
                {head(t('模组', 'Modules'))}
                {head(t('功耗 kW', 'Power kW'), 'kw')}
                {head(t('电源线', 'Power cables'))}
                {head(t('数据线', 'Data cables'))}
                {head('Handover date', 'handover')}
                {head('Expire Warranty', 'expire')}
                {head(t('备注', 'Remarks'))}
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => {
                const w = warranty(c.expire);
                const derivedYear = c.year === null && c.effYear !== null;
                return (
                  <tr key={c.caseKey}>
                    {editMode && (
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <button className="btn-line" style={{ padding: '3px 9px', fontSize: 12 }} onClick={() => openEdit(c)}>
                          {t('编辑', 'Edit')}
                        </button>
                      </td>
                    )}
                    <td style={{ ...td, minWidth: 180, maxWidth: 260 }}>
                      <div style={{ fontWeight: 600 }}>{c.name}</div>
                      {c.address && <div style={{ color: 'var(--text2)', fontSize: 11.5 }}>{c.address}</div>}
                      {c.refNo && <div style={{ color: 'var(--text2)', fontSize: 11.5 }}>{t('表内编号', 'Sheet ref.')} #{c.refNo}</div>}
                      {c.manualFields.length > 0 && (
                        <div><span className="badge" style={TAG.manual} title={c.manualFields.map((f) => caseFieldTerm(f, lang)).join('、')}>
                          {t(`已人工修改 · ${c.manualFields.length} 项`, `${c.manualFields.length} manual field(s)`)}
                        </span></div>
                      )}
                      {c.missing && (
                        <div><span className="badge" style={TAG.warn} title={t('统计表里已经没有这块屏了，因为有人工修改所以留着', 'No longer in the workbook; kept because it has manual edits')}>
                          {t('不在最新统计表', 'Not in latest workbook')}
                        </span></div>
                      )}
                    </td>
                    <td style={{ ...td, minWidth: 100, maxWidth: 160 }}>{c.client || '—'}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }} className="tnum">
                      {c.effYear === null ? '—' : (
                        <span style={derivedYear ? { color: 'var(--text2)' } : undefined}
                          title={derivedYear ? t('统计表没有年份，按 Handover date 显示', 'No year in the workbook; shown from the handover date') : undefined}>
                          {c.effYear}
                        </span>
                      )}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{c.status === 'ongoing' ? t('进行中', 'Ongoing') : t('已完成', 'Completed')}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }} className="tnum">{c.widthMm !== null && c.heightMm !== null ? `${n(c.widthMm, 0)} × ${n(c.heightMm, 0)}` : '—'}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }} className="tnum">{n(c.sqm)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{c.pitch === null ? '—' : `P${c.pitch}`}</td>
                    <td style={{ ...td, minWidth: 120, maxWidth: 200 }}>{c.product || '—'}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }} className="tnum">{c.modules ?? '—'}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }} className="tnum">{n(c.kw)}</td>
                    <td style={{ ...td, minWidth: 80, maxWidth: 140 }}>{c.powerCable || '—'}</td>
                    <td style={{ ...td, maxWidth: 140 }}>{c.dataCable || '—'}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {c.handover ? <>{fmtDate(parseISO(c.handover))}
                        <div style={{ color: 'var(--text2)', fontSize: 11.5 }}>{t(`保修 ${c.warrantyMonths} 个月`, `${c.warrantyMonths} months`)}</div></>
                        : <span style={{ color: 'var(--text2)' }}>{t('未填', 'Not set')}</span>}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {c.expire ? <>{fmtDate(parseISO(c.expire))}
                        {w && <div><span className="badge" style={w.tag}>{t(w.zh, w.en)}</span></div>}</>
                        : <span style={{ color: 'var(--text2)' }}>—</span>}
                    </td>
                    <td style={{ ...td, color: 'var(--text2)', minWidth: 160, maxWidth: 280 }}>{c.remarks || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p style={{ padding: '10px 18px', fontSize: 12, color: 'var(--text2)' }}>
            {total > cases.length ? t(`共 ${total} 个匹配，显示前 ${cases.length} 个，请收窄条件。`, `${total} matches; showing the first ${cases.length}.`) : t(`共 ${total} 个匹配。`, `${total} matches.`)}
          </p>
        </div>
      )}

      {/* ---- 编辑一块屏 ---- */}
      {editing && (
        <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div className="modal" style={{ maxWidth: 720 }}>
            <h2>{t('编辑这块屏', 'Edit this screen')}</h2>
            <div className="msub">{editing.name}{editing.widthMm && editing.heightMm ? ` · ${n(editing.widthMm, 0)} × ${n(editing.heightMm, 0)}` : ''}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
              {EDIT_FIELDS.map((it, i) => {
                if ('sec' in it) return (
                  <div key={`s${i}`} style={{ gridColumn: '1/-1', marginTop: 6, paddingTop: 10, borderTop: '1px dashed var(--border)', fontWeight: 700, fontSize: 12.5 }}>
                    {it.sec === 'spec' ? t('屏幕规格', 'Screen specification') : t('交付与保修', 'Handover and warranty')}
                  </div>
                );
                const k = it.k as string;
                const manual = editing.manualFields.includes(k);
                return (
                  <div className="field" key={k} style={{ marginBottom: 0, gridColumn: it.full ? '1/-1' : undefined }}>
                    <label htmlFor={`ed-${k}`}>{caseFieldTerm(k, lang)}
                      {manual && <span className="badge" style={{ ...TAG.manual, marginLeft: 6 }}>{t('已人工修改', 'Manual')}</span>}
                      {/* 统计表里有来源的字段才谈得上「恢复」;交付日期 / 保修期
                          没有来源,清空输入框本身就等于不改了。 */}
                      {manual && HAS_SOURCE.has(k) && (revert.includes(k)
                        ? <button type="button" className="btn-line" style={revertBtn}
                          onClick={() => setRevert(revert.filter((x) => x !== k))}>{t('撤销恢复', 'Undo revert')}</button>
                        : <button type="button" className="btn-line" style={revertBtn}
                          onClick={() => setRevert([...revert, k])}>{t('恢复统计表的值', 'Revert to workbook')}</button>)}</label>
                    {it.type === 'select' ? (
                      <select id={`ed-${k}`} value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })}>
                        <option value="ongoing">{t('进行中', 'Ongoing')}</option>
                        <option value="completed">{t('已完成', 'Completed')}</option>
                      </select>
                    ) : it.type === 'textarea' ? (
                      <textarea id={`ed-${k}`} rows={2} value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                    ) : (
                      <input id={`ed-${k}`} type={it.type === 'date' ? 'date' : it.type === 'number' ? 'number' : 'text'} step="any"
                        disabled={revert.includes(k)}
                        placeholder={k === 'warrantyMonths' ? String(DEFAULT_WARRANTY_MONTHS) : undefined}
                        value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                    )}
                    {revert.includes(k) && <div style={{ fontSize: 11.5, color: 'var(--info)', marginTop: 3 }}>
                      {t('保存后这一栏回到统计表的值', 'On save this field goes back to the workbook value')}</div>}
                    {k === 'sqm' && sqmWarn && <div style={{ fontSize: 11.5, color: 'var(--warning)', marginTop: 3 }}>{sqmWarn}</div>}
                  </div>
                );
              })}
              {siblings.length > 0 && (
                <label style={{ gridColumn: '1/-1', display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={syncProject} onChange={(e) => setSyncProject(e.target.checked)}
                    style={{ marginTop: 2 }} data-testid="case-sync" />
                  <span>
                    {t(`把交付日期与保修期同步到本项目其它 ${siblings.length} 块屏`,
                      `Also apply the handover date and warranty to the other ${siblings.length} screen(s) of this project`)}
                    <span style={{ display: 'block', color: 'var(--text2)', fontSize: 11.5 }}>
                      {siblings.map((s) => {
                        const size = s.widthMm && s.heightMm ? `${n(s.widthMm, 0)} × ${n(s.heightMm, 0)}` : t('尺寸未填', 'no size');
                        const now = s.handover ? fmtDate(parseISO(s.handover)) : t('未填', 'not set');
                        return `${size}（${t('现在', 'now')} ${now} · ${s.warrantyMonths} ${t('个月', 'mo')}）`;
                      }).join('；')}
                    </span>
                  </span>
                </label>
              )}
              <div style={{ gridColumn: '1/-1', background: 'var(--hover-bg)', borderRadius: 7, padding: '8px 10px', fontSize: 12.5 }}>
                {liveExpire
                  ? <>Expire Warranty（{t('自动', 'computed')}）= {fmtDate(parseISO(form.handover))} + {liveExpire.months} {t('个月', 'months')} = <b>{fmtDate(liveExpire.date)}</b>
                    {liveExpire.w && <span className="badge" style={{ ...liveExpire.w.tag, marginLeft: 6 }}>{t(liveExpire.w.zh, liveExpire.w.en)}</span>}</>
                  : t(`Expire Warranty（自动）：填了 Handover date 后按保修期自动算出，保修期默认 ${DEFAULT_WARRANTY_MONTHS} 个月。`,
                    `Expire Warranty is computed once a handover date is set; warranty defaults to ${DEFAULT_WARRANTY_MONTHS} months.`)}
              </div>
              {log.length > 0 && (
                <div style={{ gridColumn: '1/-1', marginTop: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{t('修改记录', 'Edit history')}</div>
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
                    {log.map((e, i) => (
                      <li key={i}>{fmtDate(new Date(e.at))} · {e.by} · {logText({ text: String(e.p.text ?? ''), k: e.k, p: e.p as never }, lang)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {error && <div style={{ fontSize: 12.5, color: 'var(--danger)', marginTop: 10 }}>{error}</div>}
            <div className="modal-actions">
              <span style={{ marginRight: 'auto', fontSize: 12, color: 'var(--text2)', alignSelf: 'center' }}>
                {t('修改会留痕（谁、何时、改前改后）', 'Edits are logged: who, when, before and after')}
              </span>
              <button className="btn-line" onClick={() => setEditing(null)}>{t('取消', 'Cancel')}</button>
              <button className="btn-navy" disabled={busy} onClick={save}>{busy ? t('保存中…', 'Saving…') : t('保存', 'Save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- 重新导入 · 预览(§4)---- */}
      {pending && (
        <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) setPending(null); }}>
          <div className="modal">
            <h2>{t('重新导入统计表 · 预览', 'Re-import workbook · preview')}</h2>
            <div className="msub">{pending.file.name}</div>
            <ul style={{ margin: '8px 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.9 }}>
              <li>{t(`新增 ${pending.preview.added} 块屏`, `${pending.preview.added} screens added`)}</li>
              <li>{t(`按统计表更新 ${pending.preview.updated} 块屏`, `${pending.preview.updated} screens updated from the workbook`)}</li>
              <li>{t(`保留人工修改 ${pending.preview.manualFields} 个字段（涉及 ${pending.preview.manualScreens} 块屏）`,
                `${pending.preview.manualFields} manual fields kept (${pending.preview.manualScreens} screens)`)}</li>
              <li>{t(`保留手填的 Handover date ${pending.preview.handoverKept} 块屏`, `${pending.preview.handoverKept} screens keep their handover date`)}</li>
              <li>{t(`统计表里已没有的屏：移除 ${pending.preview.removed} 块（没人改过），保留并标「不在最新统计表」${pending.preview.keptMissing} 块`,
                `Gone from the workbook: ${pending.preview.removed} removed (untouched), ${pending.preview.keptMissing} kept and flagged`)}</li>
            </ul>
            <div style={{ background: 'var(--hover-bg)', borderRadius: 7, padding: '8px 10px', fontSize: 12.5, lineHeight: 1.7 }}>
              {t('规则：统计表是正本，没人改过的字段一律以最新统计表为准；人工改过的字段、手填的 Handover date 与保修期一律保留。若新统计表的值已与人工值相同，那条「已人工修改」标记自动清掉。',
                'The workbook is the record: untouched fields follow it. Manually edited fields, handover dates and warranty months are kept. When the workbook catches up with a manual value, the manual mark clears itself.')}
            </div>
            {error && <div style={{ fontSize: 12.5, color: 'var(--danger)', marginTop: 10 }}>{error}</div>}
            <div className="modal-actions">
              <button className="btn-line" onClick={() => setPending(null)}>{t('取消', 'Cancel')}</button>
              <button className="btn-navy" disabled={busy} onClick={confirmImport}>{busy ? t('导入中…', 'Importing…') : t('确认导入', 'Confirm import')}</button>
            </div>
          </div>
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
