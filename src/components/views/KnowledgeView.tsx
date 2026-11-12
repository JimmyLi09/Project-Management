'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { useLang } from '@/lib/i18n';
import { canDeleteKb, canDeleteKbFile, canEditKb, canEditKbDoc, canManageKbPreviews, canRevertKb, canUpdateKbMap } from '@/lib/permissions';
import { SVC, STAGES, svcColor } from '@/lib/templates';
import { Icon } from '../ui';
import {
  KB_CATEGORIES, catName, diffLines, excerpt, matchDoc,
  type KbAttachment, type KbDoc, type KbVersion,
} from '@/lib/kb';
import { KB_BIZ, KB_SECS, bizDef, isBiz, isSec, secName, secsFor, type KbBiz, type KbSec } from '@/lib/bizMap';
import { fileBadge, fmtSize, previewKind } from '@/lib/kbPreview';
import Markdown from '../Markdown';
import { invalidateKbCache } from '../KbLinks';
import KbReader from '../KbReader';

/* ===== REQ-035: 运营中心 · 知识库 =====
   左边分类 + 搜索,右边看 / 改一篇文档。核心是三件事:
   ① 每次保存留一版,能看历史、能比对、能回退;
   ② 已有文件能导进来(.docx/.xlsx/文本解析成正文,其余作为附件);
   ③ 能导出(Word 单篇 / 按分类打包,PDF 走浏览器打印)。
   正文是 Markdown,渲染成真实 React 元素 —— 见 components/Markdown.tsx,
   全程不碰 dangerouslySetInnerHTML。

   REQ-061 改版:首页是「Audax 业务流程地图」(sandbox iframe),文档按「业务 × 板块」归类
   (bizMap.ts,原来的 6 个分类保留作「原分类」筛选),附件点名字打开全屏阅读器(KbReader)。
   PM 只能改自己建的文档、删自己上传的附件;删文档、更新地图、恢复旧版本只有 PD / BD。 */
type Tab = 'map' | 'docs' | 'secs';
type BizFilter = '' | KbBiz | 'none';

export default function KnowledgeView() {
  const { me, setToast, view } = useStore();
  const { t } = useLang();
  const canAdd = canEditKb(me);

  const [tab, setTab] = useState<Tab>('map');
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [biz, setBiz] = useState<BizFilter>('');
  const [sec, setSec] = useState<'' | KbSec>('');
  const [cat, setCat] = useState<string>('');
  const [q, setQ] = useState('');
  /* REQ-063:别的页面(修改记录的 E5 模板链接)带 sub = 'doc:<id>' 进来,直接打开那篇 */
  const linked = view.sub?.startsWith('doc:') ? view.sub.slice(4) : null;
  const [openId, setOpenId] = useState<string | null>(linked);
  useEffect(() => { if (linked) setOpenId(linked); }, [linked]);

  const load = React.useCallback(async () => {
    invalidateKbCache();   // 文档变了,资料卡 / 工作流那边的「相关文档」要跟着更新
    const r = await fetch('/api/kb');
    if (r.ok) setDocs((await r.json()).docs as KbDoc[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const goDocs = (b: BizFilter, s: '' | KbSec = '') => { setBiz(b); setSec(s); setOpenId(null); setTab('docs'); };
  const open = docs.find((d) => d.id === openId) || null;

  const head = (
    <div className="detail-tabs" style={{ marginBottom: 14, borderTop: 'none', borderBottom: '1px solid var(--border)' }}>
      {([['map', t('流程地图', 'Process map')], ['docs', t('文档', 'Documents')], ['secs', t('板块清单', 'Sections')]] as [Tab, string][]).map(([k, label]) => (
        <button key={k} className={`detail-tab ${tab === k && !open ? 'active' : ''}`} data-testid={`kb-tab-${k}`} onClick={() => { setOpenId(null); setTab(k); }}>{label}</button>
      ))}
    </div>
  );

  if (open) {
    return (
      <>{head}<DocPage doc={open} onBack={() => setOpenId(null)} onChanged={load} onOpenMap={() => { setOpenId(null); setTab('map'); }} /></>
    );
  }
  return (
    <>
      {head}
      {tab === 'map' && <MapHome docs={docs} onDocs={goDocs} onChanged={load} />}
      {tab === 'docs' && (
        <DocsList docs={docs} loading={loading} biz={biz} setBiz={(b) => { setBiz(b); setSec(''); }} sec={sec} setSec={setSec}
          cat={cat} setCat={setCat} q={q} setQ={setQ} canAdd={canAdd} onOpen={setOpenId} onChanged={load} setToast={setToast} />
      )}
      {tab === 'secs' && <SecsPage docs={docs} />}
    </>
  );
}

/* 每个业务、每个板块各有几篇(未归类不算)。给地图上的「📄 文档 n」和筛选条用 */
function countMap(docs: KbDoc[]) {
  const c: Record<string, Record<string, number>> = {};
  for (const d of docs) {
    if (!d.biz || !d.sec) continue;
    (c[d.biz] ||= {})[d.sec] = (c[d.biz][d.sec] || 0) + 1;
  }
  return c;
}

/* ---------- ① 首页:流程地图 ---------- */
interface MapMeta { version: number; name: string; size: number; at: number; by: string; note: string }
function MapHome({ docs, onDocs, onChanged }: { docs: KbDoc[]; onDocs: (b: BizFilter, s?: '' | KbSec) => void; onChanged: () => Promise<void> }) {
  const { me, setToast } = useStore();
  const { lang, t } = useLang();
  const [meta, setMeta] = useState<{ map: MapMeta | null; versions: MapMeta[] } | null>(null);
  const [cur, setCur] = useState<KbBiz>('overview');
  const [histOpen, setHistOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const inp = useRef<HTMLInputElement>(null);
  const counts = useMemo(() => countMap(docs), [docs]);
  const bizCount = (b: KbBiz) => docs.filter((d) => d.biz === b).length;

  const loadMeta = React.useCallback(async () => {
    const r = await fetch('/api/kb/map');
    if (r.ok) setMeta(await r.json());
  }, []);
  useEffect(() => { loadMeta(); }, [loadMeta]);

  const post = React.useCallback((m: object) => { frame.current?.contentWindow?.postMessage(m, '*'); }, []);
  /* 只认来自地图 iframe 的消息,并校验格式 */
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const m = e.data as { type?: unknown; biz?: unknown; sec?: unknown };
      if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
      if (m.type === 'audax-kb:ready') {
        post({ type: 'audax-kb:counts', counts, lang });
        if (isBiz(m.biz)) setCur(m.biz);
        if (cur !== 'overview' && cur !== 'other') post({ type: 'audax-kb:biz', biz: cur });
      } else if (m.type === 'audax-kb:biz-changed' && isBiz(m.biz)) {
        setCur((c) => (c === 'other' && m.biz === 'overview' ? c : (m.biz as KbBiz)));
      } else if (m.type === 'audax-kb:docs' && isBiz(m.biz) && isSec(m.sec)) {
        onDocs(m.biz, m.sec);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [counts, lang, cur, onDocs, post]);
  useEffect(() => { post({ type: 'audax-kb:counts', counts, lang }); }, [counts, lang, post]);

  const pick = (b: KbBiz) => { setCur(b); post({ type: 'audax-kb:biz', biz: bizDef(b)?.onMap ? b : 'overview' }); };

  async function upload(f: File | undefined) {
    if (!f) return;
    if (!/\.html?$/i.test(f.name)) { setToast(t('地图要是 .html 文件', 'The map must be an .html file')); return; }
    setBusy(true);
    const fd = new FormData(); fd.append('file', f);
    const r = await fetch('/api/kb/map', { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setToast(j.error || t('上传失败', 'Upload failed')); return; }
    setMeta({ map: j.map, versions: j.versions });
    await onChanged();
    setToast(t(`地图已更新 — 第 ${j.version} 版`, `Map updated — version ${j.version}`));
  }
  async function restore(v: number) {
    if (!confirm(t(`把地图恢复到第 ${v} 版?当前这一版留在历史里。`, `Restore the map to version ${v}? The current version stays in the history.`))) return;
    const r = await fetch('/api/kb/map/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: v }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setToast(j.error || t('恢复失败', 'Restore failed')); return; }
    setMeta({ map: j.map, versions: j.versions });
    await onChanged();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="panel" style={{ padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--navy900)', marginRight: 4 }}>{t('业务', 'Service')}</span>
        {KB_BIZ.map((b) => (
          <button key={b.key} className={`chip ${cur === b.key ? 'active' : ''}`} data-testid={`kb-map-biz-${b.key}`} onClick={() => pick(b.key)}>
            <span className="bdot" style={{ background: cur === b.key ? '#fff' : b.color }} />{lang === 'zh' ? b.zh : b.en} <span style={{ opacity: 0.6, marginLeft: 3 }}>{bizCount(b.key)}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="btn-line sm" data-testid="kb-map-all-docs" onClick={() => onDocs(cur)}>{t('这个业务的全部文档', 'All documents for this service')} →</button>
      </div>
      <div className="panel" style={{ padding: '8px 14px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: 'var(--text2)' }}>
        {meta?.map
          ? <span data-testid="kb-map-meta">🗺 {meta.map.name} · {t(`第 ${meta.map.version} 版`, `v${meta.map.version}`)} · {meta.map.by} · {new Date(meta.map.at).toLocaleDateString()}</span>
          : <span>{meta ? t('还没有流程地图。', 'No process map yet.') : t('加载中…', 'Loading…')}</span>}
        <div style={{ flex: 1 }} />
        {meta && meta.versions.length > 0 && (
          <button className="btn-line sm" data-testid="kb-map-history-btn" onClick={() => setHistOpen(!histOpen)}>{t('地图版本', 'Map versions')} ({meta.versions.length})</button>
        )}
        {canUpdateKbMap(me) && (
          <>
            <input ref={inp} type="file" accept=".html,.htm,text/html" hidden data-testid="kb-map-file" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
            <button className="btn-line sm" disabled={busy} data-testid="kb-map-update" onClick={() => inp.current?.click()}>⤒ {busy ? t('上传中…', 'Uploading…') : t('更新地图', 'Update map')}</button>
          </>
        )}
      </div>
      {histOpen && meta && (
        <div className="panel clip" data-testid="kb-map-history">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {meta.versions.map((v, i) => (
                <tr key={v.version}>
                  <td style={cell}><b>v{v.version}</b>{i === 0 && <span style={{ color: 'var(--text2)' }}> ({t('当前', 'current')})</span>}</td>
                  <td style={cell}>{v.name}</td>
                  <td style={cell}>{v.by} · {new Date(v.at).toLocaleString()}</td>
                  <td style={{ ...cell, color: 'var(--text2)' }}>{v.note || '—'} · {fmtSize(v.size)}</td>
                  <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <a className="btn-line sm" href={`/api/kb/map/html?v=${v.version}`} target="_blank" rel="noopener noreferrer">{t('打开', 'Open')}</a>
                    {canUpdateKbMap(me) && i > 0 && <button className="btn-line sm" style={{ marginLeft: 6 }} data-testid={`kb-map-restore-${v.version}`} onClick={() => restore(v.version)}>↺ {t('恢复', 'Restore')}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 11.5, color: 'var(--text2)', padding: '8px 18px' }}>{t('留最近 10 版。恢复会把那一版存成新的一版。', 'The last 10 versions are kept. Restoring saves that version as a new one.')}</div>
        </div>
      )}
      {meta?.map && (
        <iframe ref={frame} key={meta.map.version} src={`/api/kb/map/html?t=${meta.map.version}`} title={meta.map.name} data-testid="kb-map-frame"
          sandbox="allow-scripts allow-popups" referrerPolicy="no-referrer"
          style={{ width: '100%', height: 'calc(100vh - 250px)', minHeight: 560, border: '1px solid var(--border)', borderRadius: 12, background: '#fff' }} />
      )}
    </div>
  );
}

/* ---------- ② 文档:业务 × 板块 ---------- */
function DocsList({ docs, loading, biz, setBiz, sec, setSec, cat, setCat, q, setQ, canAdd, onOpen, onChanged, setToast }: {
  docs: KbDoc[]; loading: boolean; biz: BizFilter; setBiz: (b: BizFilter) => void; sec: '' | KbSec; setSec: (s: '' | KbSec) => void;
  cat: string; setCat: (c: string) => void; q: string; setQ: (s: string) => void; canAdd: boolean;
  onOpen: (id: string) => void; onChanged: () => Promise<void>; setToast: (s: string) => void;
}) {
  const { me } = useStore();
  const { lang, t } = useLang();
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const inBiz = (d: KbDoc) => (biz === '' ? true : biz === 'none' ? !d.biz : d.biz === biz);
  const base = docs.filter((d) => inBiz(d) && (!cat || d.category === cat) && matchDoc(d, q));
  const shown = base.filter((d) => !sec || d.sec === sec);
  const secChoices: KbSec[] = biz === 'none' ? [] : biz === '' ? KB_SECS.map((s) => s.key) : secsFor(biz);
  const bizRows: [BizFilter, string, number, string?][] = [
    ['', t('全部', 'All'), docs.length],
    ...KB_BIZ.map((b) => [b.key, lang === 'zh' ? b.zh : b.en, docs.filter((d) => d.biz === b.key).length, b.color] as [BizFilter, string, number, string]),
  ];
  const noneN = docs.filter((d) => !d.biz).length;

  async function genAll() {
    const r = await fetch('/api/kb/previews', { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    setToast(r.ok ? t(`已排队 ${j.queued} 个附件,在后台一个一个转`, `${j.queued} files queued — converting one at a time in the background`) : (j.error || t('失败', 'Failed')));
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 18, alignItems: 'start' }}>
      <div className="panel" style={{ padding: 12 }} data-testid="kb-biz-list">
        <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text2)', padding: '4px 8px 8px' }}>{t('业务', 'Service')}</div>
        {bizRows.map(([k, label, n, color]) => (
          <button key={k || '_all'} onClick={() => setBiz(k)} data-testid={`kb-biz-${k || 'all'}`} data-n={n}
            style={{ display: 'flex', width: '100%', gap: 8, alignItems: 'center', padding: '7px 9px', borderRadius: 7, fontSize: 12.5, textAlign: 'left',
              fontWeight: biz === k ? 700 : 500, background: biz === k ? 'var(--navy900)' : 'transparent', color: biz === k ? '#fff' : 'var(--text)' }}>
            {color && <span className="bdot" style={{ background: color }} />}
            <span style={{ flex: 1 }}>{label}</span>
            <span className="tnum" style={{ fontSize: 11, opacity: 0.7 }}>{n}</span>
          </button>
        ))}
        <button onClick={() => setBiz('none')} data-testid="kb-biz-none" data-n={noneN}
          style={{ display: 'flex', width: '100%', gap: 8, alignItems: 'center', padding: '7px 9px', borderRadius: 7, fontSize: 12.5, textAlign: 'left', marginTop: 4,
            fontWeight: biz === 'none' ? 700 : 500, background: biz === 'none' ? '#b85c1e' : 'transparent', color: biz === 'none' ? '#fff' : '#b85c1e' }}>
          <span style={{ flex: 1 }}>{t('未归类', 'Unclassified')}</span>
          <span className="tnum" style={{ fontSize: 11, opacity: 0.8 }}>{noneN}</span>
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <div className="panel" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="in sm" style={{ flex: 1, minWidth: 200 }} value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={t('搜索标题 / 正文 / 标签…', 'Search title, body or tags…')} data-testid="kb-search" />
            <select className="in sm" style={{ width: 'auto' }} value={cat} onChange={(e) => setCat(e.target.value)} data-testid="kb-cat-filter"
              title={t('原来的 6 个分类', 'The original 6 categories')}>
              <option value="">{t('原分类:全部', 'Original category: all')}</option>
              {KB_CATEGORIES.map((c) => <option key={c[0]} value={c[0]}>{t('原分类:', 'Original: ')}{lang === 'zh' ? c[1] : c[2]}</option>)}
            </select>
            {cat && (
              <a className="btn-line sm" href={`/api/kb/cat:${encodeURIComponent(cat)}/export`}
                title={t('把这个分类下的文档打包成一个 zip(每篇一个 Word)', 'Download every doc in this category as one zip of Word files')}>⤓ {t('整类导出', 'Export category')}</a>
            )}
            {canManageKbPreviews(me) && <button className="btn-line sm" data-testid="kb-gen-previews" onClick={genAll}
              title={t('把还没有预览的 Word / Excel / PPT 附件都排队转成 PDF', 'Queue every Word / Excel / PowerPoint attachment that has no preview yet')}>{t('生成全部预览', 'Generate all previews')}</button>}
            {canAdd && <button className="btn-line sm" data-testid="kb-import-btn" onClick={() => setImporting(!importing)}>⤒ {t('导入文件', 'Import')}</button>}
            {canAdd && <button className="btn-navy sm" data-testid="kb-new-btn" onClick={() => setCreating(true)}>＋ {t('新建文档', 'New doc')}</button>}
          </div>
          {secChoices.length > 0 && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }} data-testid="kb-sec-bar">
              <span style={{ fontSize: 12, color: 'var(--text2)', marginRight: 4 }}>{t('板块', 'Section')}</span>
              <button className={`chip ${!sec ? 'active' : ''}`} onClick={() => setSec('')} data-testid="kb-sec-all">{t('全部', 'All')}</button>
              {secChoices.map((k) => (
                <button key={k} className={`chip ${sec === k ? 'active' : ''}`} onClick={() => setSec(k)} data-testid={`kb-sec-${k}`} data-n={base.filter((d) => d.sec === k).length}>
                  <b style={{ marginRight: 4 }}>{k}</b>{secName(k, lang)} <span style={{ opacity: 0.6, marginLeft: 3 }}>{base.filter((d) => d.sec === k).length}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {importing && canAdd && <ImportPanel defBiz={biz === '' || biz === 'none' ? '' : biz} defSec={sec} onDone={async (id) => { setImporting(false); await onChanged(); onOpen(id); }} />}
        {creating && <NewDocModal defBiz={biz === '' || biz === 'none' ? '' : biz} defSec={sec} onClose={() => setCreating(false)}
          onDone={async (id) => { setCreating(false); await onChanged(); onOpen(id); }} />}

        {loading && <div className="panel" style={{ padding: 30, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>{t('加载中…', 'Loading…')}</div>}
        {!loading && shown.length === 0 && (
          <div className="panel" style={{ padding: 34, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
            {docs.length === 0
              ? t('知识库还是空的。把现有的 SOP / 培训资料「导入文件」进来,或直接新建一篇。', 'The knowledge base is empty. Import your existing SOPs / training files, or write a new doc.')
              : t('没有匹配的文档。', 'No matching documents.')}
          </div>
        )}
        {shown.length > 0 && (
          <div className="panel clip" data-testid="kb-doc-list">
            {shown.map((d) => <DocRow key={d.id} d={d} onOpen={() => onOpen(d.id)} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function BizSecTags({ d }: { d: KbDoc }) {
  const { lang, t } = useLang();
  const b = bizDef(d.biz);
  return (
    <>
      {b ? <span className="badge" data-testid="kb-tag-biz" style={{ background: '#eef2f7', color: b.color }}>{lang === 'zh' ? b.zh : b.en}</span>
        : <span className="badge" data-testid="kb-tag-biz" style={{ background: '#fdf1e6', color: '#b85c1e' }}>{t('未归类', 'Unclassified')}</span>}
      {d.sec && <span className="badge" data-testid="kb-tag-sec" style={{ background: 'var(--hover-bg)', color: 'var(--text)' }}>
        <b style={{ background: 'var(--navy900)', color: '#fff', borderRadius: 999, padding: '0 5px', marginRight: 5, fontSize: 10.5 }}>{d.sec}</b>{secName(d.sec, lang)}</span>}
      <span className="badge" data-testid="kb-tag-cat" style={{ background: 'var(--hover-bg)', color: 'var(--text2)' }}>{t('原分类:', 'Original: ')}{catName(d.category, lang)}</span>
    </>
  );
}

function DocRow({ d, onOpen }: { d: KbDoc; onOpen: () => void }) {
  const { t } = useLang();
  const first = d.attachments[0];
  const badge = fileBadge(first?.name || (d.body.trim() ? 'x.txt' : ''), d.isMap);
  return (
    <button onClick={onOpen} data-testid="kb-doc-row" data-id={d.id}
      style={{ display: 'flex', gap: 12, alignItems: 'center', width: '100%', textAlign: 'left', padding: '12px 16px', borderBottom: '1px solid var(--row-line)', background: 'none' }}>
      <span style={{ width: 30, height: 36, borderRadius: 4, background: badge.color, color: '#fff', fontSize: 9.5, fontWeight: 800, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 4, flexShrink: 0 }}>{badge.label}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--navy900)' }} data-testid="kb-doc-title">{d.title}</span>
          {d.isMap && <span className="badge" style={{ background: '#fff3e4', color: '#b85c1e' }}>{t('首页', 'Home')}</span>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 5, alignItems: 'center' }}>
          <BizSecTags d={d} />
          {d.tags.map((tg) => <span key={tg} className="badge" style={{ background: '#eef2f7', color: '#4a5b6c' }}>#{tg}</span>)}
          {d.attachments.length > 0 && <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>📎 {d.attachments.length}</span>}
        </div>
        {!d.isMap && d.body.trim() && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 5 }}>{excerpt(d.body)}</div>}
      </div>
      <span className="tnum" style={{ fontSize: 11.5, color: 'var(--text2)', whiteSpace: 'nowrap' }}>{d.updatedBy} · {new Date(d.updatedAt).toLocaleDateString()}</span>
    </button>
  );
}

/* 业务 → 板块两个下拉:非「总览」只列 B / C / D(后端同样校验) */
function BizSecPick({ biz, sec, onChange }: { biz: string; sec: string; onChange: (b: string, s: string) => void }) {
  const { lang, t } = useLang();
  const choices = biz ? secsFor(biz) : [];
  return (
    <>
      <label style={fieldL}>{t('业务', 'Service')}
        <select className="in sm" value={biz} data-testid="kb-pick-biz"
          onChange={(e) => { const b = e.target.value; onChange(b, b && sec && secsFor(b).includes(sec as KbSec) ? sec : ''); }}>
          <option value="">{t('未归类', 'Unclassified')}</option>
          {KB_BIZ.map((b) => <option key={b.key} value={b.key}>{lang === 'zh' ? b.zh : b.en}</option>)}
        </select>
      </label>
      <label style={fieldL}>{t('板块', 'Section')}
        <select className="in sm" value={sec} disabled={!biz} data-testid="kb-pick-sec" onChange={(e) => onChange(biz, e.target.value)}>
          <option value="">{biz ? t('不选板块', 'No section') : t('先选业务', 'Pick a service first')}</option>
          {choices.map((k) => <option key={k} value={k}>{k} · {secName(k, lang)}</option>)}
        </select>
      </label>
    </>
  );
}

function NewDocModal({ defBiz, defSec, onClose, onDone }: { defBiz: string; defSec: string; onClose: () => void; onDone: (id: string) => void }) {
  const { setToast } = useStore();
  const { lang, t } = useLang();
  const [title, setTitle] = useState('');
  const [biz, setBiz] = useState(defBiz);
  const [sec, setSec] = useState(defBiz && defSec && secsFor(defBiz).includes(defSec as KbSec) ? defSec : '');
  const [cat, setCat] = useState('other');
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!title.trim()) { setToast(t('请填标题', 'Enter a title')); return; }
    setBusy(true);
    const r = await fetch('/api/kb', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim(), category: cat, body: '', biz: biz || null, sec: sec || null }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setToast(d.error || t('新建失败', 'Create failed')); return; }
    onDone(d.doc.id);
  }
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 520 }} data-testid="kb-new-modal">
        <h2>{t('新建文档', 'New document')}</h2>
        <div style={{ display: 'grid', gap: 12 }}>
          <label style={fieldL}>{t('标题', 'Title')}<input className="in sm" autoFocus value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} data-testid="kb-new-title" /></label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <BizSecPick biz={biz} sec={sec} onChange={(b, s) => { setBiz(b); setSec(s); }} />
          </div>
          <label style={fieldL}>{t('原分类(可不改)', 'Original category (optional)')}
            <select className="in sm" value={cat} onChange={(e) => setCat(e.target.value)}>
              {KB_CATEGORIES.map((c) => <option key={c[0]} value={c[0]}>{lang === 'zh' ? c[1] : c[2]}</option>)}
            </select>
          </label>
        </div>
        <div className="modal-actions">
          <button className="btn-line" onClick={onClose}>{t('取消', 'Cancel')}</button>
          <button className="btn-navy" disabled={busy} onClick={go} data-testid="kb-new-ok">{busy ? t('创建中…', 'Creating…') : t('创建', 'Create')}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- ③ 板块清单(只读说明) ---------- */
function SecsPage({ docs }: { docs: KbDoc[] }) {
  const { lang, t } = useLang();
  const th: React.CSSProperties = { ...cell, fontSize: 11, fontWeight: 700, color: 'var(--text2)', background: 'var(--hover-bg)', textTransform: 'uppercase' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} data-testid="kb-secs-page">
      <div className="panel" style={{ padding: '12px 16px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy900)', marginBottom: 8 }}>
          {t('9 个业务', '9 services')} <span style={{ fontWeight: 400, color: 'var(--text2)', fontSize: 12 }}>· {t('前 8 个和流程地图的标签一一对应;「其他业务」放地图上没有单独标签的。', 'The first 8 match the tabs on the process map; “Other services” holds what has no tab of its own.')}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {KB_BIZ.map((b) => <span key={b.key} className="badge" style={{ background: 'var(--hover-bg)', color: 'var(--text)', padding: '5px 10px' }}><span className="bdot" style={{ background: b.color }} />{b.zh} <span style={{ color: 'var(--text2)', marginLeft: 4 }}>{b.en}</span></span>)}
        </div>
      </div>
      <div className="panel clip">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>{t('板块', 'Section')}</th><th style={th}>{t('名称', 'Name')}</th><th style={th}>{t('放在哪里', 'Where')}</th><th style={th}>{t('里面放什么(按流程地图)', 'What goes here (from the map)')}</th><th style={{ ...th, textAlign: 'right' }}>{t('文档数', 'Docs')}</th></tr></thead>
          <tbody>
            {KB_SECS.map((s) => (
              <tr key={s.key} data-testid="kb-secs-row">
                <td style={cell}><b>{s.key}</b></td>
                <td style={cell}><div style={{ fontWeight: 600 }}>{s.zh}</div><div style={{ fontSize: 11.5, color: 'var(--text2)' }}>{s.en}</div></td>
                <td style={cell}><span className="badge" style={{ background: s.overviewOnly ? 'var(--hover-bg)' : '#eaf1fb', color: s.overviewOnly ? 'var(--text2)' : '#2f6fb0' }}>{s.overviewOnly ? t('只在总览 / 通用', 'Overview only') : t('总览 + 每个业务', 'Overview + every service')}</span></td>
                <td style={cell}>{lang === 'zh' ? s.what : s.whatEn}</td>
                <td style={{ ...cell, textAlign: 'right' }} className="tnum">{docs.filter((d) => d.sec === s.key).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel clip">
        <div className="panel-head"><span className="panel-title">{t('平台里的业务怎么对到这 9 个', 'How the platform\'s services map to these 9')}</span></div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>{t('知识库业务', 'Knowledge base service')}</th><th style={th}>{t('平台里的业务(项目用的)', 'Platform services (used on projects)')}</th></tr></thead>
          <tbody>
            {KB_BIZ.map((b) => (
              <tr key={b.key}>
                <td style={cell}>{lang === 'zh' ? b.zh : b.en}</td>
                <td style={cell}>{b.svcs.length ? b.svcs.map((s) => (lang === 'zh' ? SVC[s]?.label : SVC[s]?.en) || s).join(lang === 'zh' ? '、' : ', ') : t('不分业务的制度、模板、培训', 'Company-wide policies, templates and training')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---- 导入 ---- */
function ImportPanel({ defBiz, defSec, onDone }: { defBiz: string; defSec: string; onDone: (id: string) => void }) {
  const { setToast } = useStore();
  const { lang, t } = useLang();
  const [mode, setMode] = useState<'parse' | 'attach'>('parse');
  const [cat, setCat] = useState('other');
  const [biz, setBiz] = useState(defBiz);
  const [sec, setSec] = useState(defBiz && defSec && secsFor(defBiz).includes(defSec as KbSec) ? defSec : '');
  const [busy, setBusy] = useState(false);
  const inp = useRef<HTMLInputElement>(null);

  async function go(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true);
    let lastId = '';
    const notes: string[] = [];
    for (const f of Array.from(files).slice(0, 20)) {
      const fd = new FormData();
      fd.append('file', f); fd.append('mode', mode); fd.append('category', cat); fd.append('biz', biz); fd.append('sec', sec);
      const r = await fetch('/api/kb/import', { method: 'POST', body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { notes.push(`${f.name}: ${d.error || t('导入失败', 'failed')}`); continue; }
      lastId = d.doc.id;
      if (d.note) notes.push(d.note);
    }
    setBusy(false);
    if (notes.length) setToast(notes.join(' / '));
    if (lastId) onDone(lastId);
  }

  return (
    <div className="panel" style={{ padding: '14px 18px', borderStyle: 'dashed' }} data-testid="kb-import-panel">
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--navy900)', alignSelf: 'center' }}>{t('导入已有文件', 'Import existing files')}</span>
        <label style={{ fontSize: 12.5, display: 'inline-flex', gap: 5, alignItems: 'center', alignSelf: 'center' }}>
          <input type="radio" checked={mode === 'parse'} onChange={() => setMode('parse')} />{t('解析为正文', 'Parse into the body')}
        </label>
        <label style={{ fontSize: 12.5, display: 'inline-flex', gap: 5, alignItems: 'center', alignSelf: 'center' }}>
          <input type="radio" checked={mode === 'attach'} onChange={() => setMode('attach')} />{t('作为附件', 'Keep as attachment')}
        </label>
        <BizSecPick biz={biz} sec={sec} onChange={(b, s) => { setBiz(b); setSec(s); }} />
        <label style={fieldL}>{t('原分类', 'Original category')}
          <select className="in sm" value={cat} onChange={(e) => setCat(e.target.value)}>
            {KB_CATEGORIES.map((c) => <option key={c[0]} value={c[0]}>{lang === 'zh' ? c[1] : c[2]}</option>)}
          </select>
        </label>
        <div style={{ flex: 1 }} />
        <input ref={inp} type="file" multiple hidden onChange={(e) => go(e.target.files)} data-testid="kb-import-file"
          accept=".docx,.xlsx,.pdf,.md,.txt,.csv,image/*" />
        <button className="btn-navy sm" disabled={busy} onClick={() => inp.current?.click()}>
          {busy ? t('导入中…', 'Importing…') : t('选择文件(可多选)', 'Choose files')}
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 8, lineHeight: 1.7 }}>
        {t('能解析成正文的:Word(.docx)、Excel(.xlsx)、.md / .txt / .csv —— 段落、列表、表格都会转成正文。',
           'Parsed into the body: Word (.docx), Excel (.xlsx), .md / .txt / .csv — paragraphs, lists and tables come through.')}
        <br />
        {t('PDF 和图片没有正文解析,会原件存成附件(选「解析为正文」也一样,不会丢文件)。',
           'PDFs and images have no text extraction — the original is kept as an attachment either way, nothing is lost.')}
      </div>
    </div>
  );
}

/* ---- 单篇:阅读 / 编辑 / 版本 ---- */
function DocPage({ doc, onBack, onChanged, onOpenMap }: { doc: KbDoc; onBack: () => void; onChanged: () => Promise<void>; onOpenMap: () => void }) {
  const { me, setToast } = useStore();
  const { lang, t } = useLang();

  const [d, setD] = useState<KbDoc>(doc);
  const canEd = canEditKbDoc(me, d);
  const [versions, setVersions] = useState<KbVersion[]>([]);
  const [editing, setEditing] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [cmp, setCmp] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ title: d.title, titleEn: d.titleEn, category: d.category as string, tags: d.tags.join(', '), body: d.body, summary: '', svc: d.anchors.svc, stage: d.anchors.stage, biz: d.biz || '', sec: d.sec || '' });
  const ta = useRef<HTMLTextAreaElement>(null);

  const reload = React.useCallback(async () => {
    const r = await fetch(`/api/kb/${d.id}`);
    if (!r.ok) return;
    const j = await r.json();
    setD(j.doc); setVersions(j.versions);
  }, [d.id]);
  useEffect(() => { reload(); }, [reload]);

  function begin() {
    setDraft({ title: d.title, titleEn: d.titleEn, category: d.category, tags: d.tags.join(', '), body: d.body, summary: '', svc: d.anchors.svc, stage: d.anchors.stage, biz: d.biz || '', sec: d.sec || '' });
    setEditing(true);
  }

  async function save() {
    setBusy(true);
    const r = await fetch(`/api/kb/${d.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: draft.title, titleEn: draft.titleEn, category: draft.category,
        tags: draft.tags.split(',').map((x) => x.trim()).filter(Boolean),
        body: draft.body, summary: draft.summary,
        anchors: { svc: draft.svc, stage: draft.stage },
        biz: draft.biz || null, sec: draft.sec || null,
      }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setToast(j.error || t('保存失败', 'Save failed')); return; }
    setD(j.doc); setVersions(j.versions); setEditing(false);
    await onChanged();
    setToast(t(`已保存 — 第 ${j.doc.version} 版`, `Saved — version ${j.doc.version}`));
  }

  async function revert(v: number) {
    if (!confirm(t(`回退到第 ${v} 版?当前内容不会丢 —— 回退会存成新的一版。`, `Revert to version ${v}? Nothing is lost — the revert is saved as a new version.`))) return;
    const r = await fetch(`/api/kb/${d.id}/versions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: v }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setToast(j.error || t('回退失败', 'Revert failed')); return; }
    setD(j.doc); setVersions(j.versions); setCmp(null);
    await onChanged();
    setToast(t(`已回退到第 ${v} 版`, `Reverted to version ${v}`));
  }

  async function del() {
    if (!confirm(t(`删除文档「${d.title}」?连同它的 ${versions.length} 个历史版本和附件一起删掉,不能撤销。`,
                   `Delete "${d.title}"? Its ${versions.length} versions and attachments go with it. This cannot be undone.`))) return;
    const r = await fetch(`/api/kb/${d.id}`, { method: 'DELETE' });
    if (!r.ok) { const j = await r.json().catch(() => ({})); setToast(j.error || t('删除失败', 'Delete failed')); return; }
    await onChanged();
    onBack();
  }

  async function upload(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true);
    for (const f of Array.from(files).slice(0, 10)) {
      const fd = new FormData();
      fd.append('file', f); fd.append('mode', 'attach'); fd.append('category', d.category);
      /* 附件挂到当前这篇上,不新建文档 —— 走文档自己的上传口 */
      const r = await fetch(`/api/kb/${d.id}/files`, { method: 'POST', body: fd });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setToast(j.error || t('上传失败', 'Upload failed')); }
    }
    setBusy(false);
    await reload(); await onChanged();
  }

  const ins = (before: string, after = '') => {
    const el = ta.current;
    if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd;
    const body = draft.body;
    const next = body.slice(0, s) + before + body.slice(s, e) + after + body.slice(e);
    setDraft((x) => ({ ...x, body: next }));
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = s + before.length + (e - s) + after.length; });
  };

  return (
    <div className="ex-print-doc" style={{ display: 'flex', flexDirection: 'column', gap: 14 }} data-testid="kb-doc-page">
      <div className="panel kb-bar" style={{ padding: '12px 18px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn-line sm" onClick={onBack}>← {t('返回', 'Back')}</button>
        <span style={{ fontSize: 12, color: 'var(--text2)' }}>
          v{d.version} · {t('最后修改', 'updated')} {d.updatedBy} {new Date(d.updatedAt).toLocaleString()}
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn-line sm" data-testid="kb-history-btn" onClick={() => setHistOpen(!histOpen)}>{t('版本历史', 'History')} ({versions.length})</button>
        <a className="btn-line sm" href={`/api/kb/${d.id}/export?fmt=docx`}>⤓ Word</a>
        <a className="btn-line sm" href={`/api/kb/${d.id}/export?fmt=md`}>⤓ Markdown</a>
        <button className="btn-line sm" onClick={() => window.print()}>⎙ {t('打印 / PDF', 'Print / PDF')}</button>
        {canEd && !editing && <button className="btn-navy sm" data-testid="kb-edit-btn" onClick={begin}><Icon name="edit" size={13} />{t('编辑', 'Edit')}</button>}
        {canEd && editing && <button className="btn-line sm" disabled={busy} onClick={() => setEditing(false)}>{t('取消', 'Cancel')}</button>}
        {canEd && editing && <button className="btn-navy sm" disabled={busy} data-testid="kb-save-btn" onClick={save}>{busy ? t('保存中…', 'Saving…') : t('保存(留一版)', 'Save (new version)')}</button>}
        {canDeleteKb(me) && !d.isMap && !editing && <button className="btn-line sm danger" data-testid="kb-delete-btn" onClick={del}>✕ {t('删除', 'Delete')}</button>}
      </div>

      {histOpen && (
        <div className="panel clip kb-bar" data-testid="kb-history">
          <div className="panel-head"><span className="panel-title">{t('版本历史', 'Version history')}</span></div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {versions.map((v) => (
                <tr key={v.version}>
                  <td style={cell}><b>v{v.version}</b>{v.version === d.version && <span style={{ color: 'var(--text2)' }}> ({t('当前', 'current')})</span>}</td>
                  <td style={cell}>{v.by} · {new Date(v.at).toLocaleString()}</td>
                  <td style={{ ...cell, color: 'var(--text2)' }}>{v.summary || '—'}</td>
                  <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn-line sm" onClick={() => setCmp(cmp === v.version ? null : v.version)}>
                      {cmp === v.version ? t('收起', 'Close') : t('对比当前', 'Diff vs current')}
                    </button>
                    {canRevertKb(me) && v.version !== d.version && (
                      <button className="btn-line sm" style={{ marginLeft: 6 }} data-testid={`kb-revert-${v.version}`} onClick={() => revert(v.version)}>↺ {t('回退', 'Revert')}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {cmp != null && (
            <div style={{ padding: '10px 18px', borderTop: '1px solid var(--row-line)', background: 'var(--hover-bg)' }}>
              <div style={{ fontSize: 11.5, color: 'var(--text2)', marginBottom: 6 }}>
                {t(`第 ${cmp} 版 → 当前(第 ${d.version} 版)`, `v${cmp} → current (v${d.version})`)}
              </div>
              <pre style={{ margin: 0, fontSize: 12, lineHeight: 1.6, fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap', maxHeight: 420, overflow: 'auto' }}>
                {diffLines(versions.find((v) => v.version === cmp)?.body || '', d.body).map((l, i) => (
                  <div key={i} style={{
                    background: l.kind === '+' ? '#e6f4ea' : l.kind === '-' ? '#fdecea' : undefined,
                    color: l.kind === '+' ? '#0f6a48' : l.kind === '-' ? '#98342b' : 'var(--text2)',
                  }}>{l.kind} {l.text || ' '}</div>
                ))}
              </pre>
            </div>
          )}
        </div>
      )}

      {!editing ? (
        <div className="panel" style={{ padding: '22px 26px' }}>
          <h1 style={{ fontSize: 23, fontWeight: 700, color: 'var(--navy900)', margin: '0 0 4px' }} data-testid="kb-doc-h1">{d.title}</h1>
          {d.titleEn && <div style={{ fontSize: 13.5, color: 'var(--text2)' }}>{d.titleEn}</div>}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0 18px' }}>
            <BizSecTags d={d} />
            {d.tags.map((tg) => <span key={tg} className="badge" style={{ background: '#eef2f7', color: '#4a5b6c' }}>#{tg}</span>)}
            {d.anchors.svc.map((s) => (
              <span key={s} className="badge" style={{ background: '#eef2f7', color: svcColor(s) }}>
                <span className="bdot" style={{ background: svcColor(s) }} />{lang === 'zh' ? SVC[s]?.label : SVC[s]?.en}
              </span>
            ))}
            {d.anchors.stage.map((s) => {
              const f = STAGES.find((x) => x[0] === s);
              return <span key={s} className="badge" style={{ background: '#eef2f7', color: '#4a5b6c' }}>◷ {f ? (lang === 'zh' ? f[1] : f[2]) : s}</span>;
            })}
          </div>
          {d.isMap && (
            <div className="panel" style={{ padding: '10px 14px', marginBottom: 14, background: '#fff8ef', borderColor: '#f0d9bd', display: 'flex', gap: 10, alignItems: 'center' }}>
              <span>🗺 {t('这一篇就是知识库首页的流程地图。', 'This document is the process map on the knowledge base home page.')}</span>
              <button className="btn-line sm" onClick={onOpenMap}>{t('打开流程地图', 'Open the map')} →</button>
            </div>
          )}
          {d.body.trim()
            ? <Markdown src={d.body} />
            : <div style={{ color: 'var(--text2)', fontSize: 13 }}>{canEd ? t('这篇还没有正文 —— 点右上角「编辑」开始写;或者直接点下面的附件在线阅读。', 'No content yet — hit Edit to start writing, or open an attachment below.') : t('这篇没有正文,点下面的附件在线阅读。', 'No body text — open an attachment below.')}</div>}

          <Attachments doc={d} canAdd={canEditKb(me)} onUpload={upload} busy={busy} onOpenMap={onOpenMap}
            onRemoved={async () => { await reload(); await onChanged(); }} />
        </div>
      ) : (
        <div className="panel kb-bar" style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
            <label style={fieldL}>{t('标题', 'Title')}
              <input className="in sm" value={draft.title} maxLength={200} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <label style={fieldL}>{t('英文标题(可空)', 'English title (optional)')}
              <input className="in sm" value={draft.titleEn} maxLength={200} onChange={(e) => setDraft({ ...draft, titleEn: e.target.value })} />
            </label>
            <BizSecPick biz={draft.biz} sec={draft.sec} onChange={(b, s) => setDraft({ ...draft, biz: b, sec: s })} />
            <label style={fieldL}>{t('原分类', 'Original category')}
              <select className="in sm" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                {KB_CATEGORIES.map((c) => <option key={c[0]} value={c[0]}>{lang === 'zh' ? c[1] : c[2]}</option>)}
              </select>
            </label>
            <label style={fieldL}>{t('标签(逗号分隔)', 'Tags (comma-separated)')}
              <input className="in sm" value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} placeholder="LED, 安装, SOP" />
            </label>
          </div>

          {/* 内嵌调用:挂到服务类型 / 工作流阶段上,在那些地方就地列出来 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12 }}>
            <div>
              <div style={labelS}>{t('关联业务(在该业务的资料卡里就地显示)', 'Linked services (shown on their Job Record card)')}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {Object.keys(SVC).map((k) => (
                  <button key={k} className="badge" onClick={() => setDraft((x) => ({ ...x, svc: x.svc.includes(k) ? x.svc.filter((y) => y !== k) : [...x.svc, k] }))}
                    style={{ background: draft.svc.includes(k) ? 'var(--navy900)' : 'var(--hover-bg)', color: draft.svc.includes(k) ? '#fff' : 'var(--text2)', cursor: 'pointer' }}>
                    {lang === 'zh' ? SVC[k].label : SVC[k].en}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={labelS}>{t('关联流程阶段', 'Linked workflow stages')}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {STAGES.map((s) => (
                  <button key={s[0]} className="badge" onClick={() => setDraft((x) => ({ ...x, stage: x.stage.includes(s[0]) ? x.stage.filter((y) => y !== s[0]) : [...x.stage, s[0]] }))}
                    style={{ background: draft.stage.includes(s[0]) ? 'var(--navy900)' : 'var(--hover-bg)', color: draft.stage.includes(s[0]) ? '#fff' : 'var(--text2)', cursor: 'pointer' }}>
                    {lang === 'zh' ? s[1] : s[2]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
            {([['# ', '', 'H1'], ['## ', '', 'H2'], ['**', '**', 'B'], ['*', '*', 'I'], ['- ', '', '•'],
               ['1. ', '', '1.'], ['> ', '', '❝'], ['`', '`', '</>'],
               ['\n| A | B |\n| --- | --- |\n| 1 | 2 |\n', '', '⊞'], ['[', '](https://)', '🔗']] as [string, string, string][])
              .map(([b, a, label]) => (
                <button key={label} className="btn-line sm" style={{ minWidth: 34 }} onClick={() => ins(b, a)} title={label}>{label}</button>
              ))}
            <span style={{ fontSize: 11.5, color: 'var(--text2)', marginLeft: 6 }}>
              {t('正文是 Markdown;图片用「插入图片」按钮,会嵌进正文。', 'The body is Markdown; use Insert image to embed a picture.')}
            </span>
            <ImageButton onInsert={(mdImg) => ins(mdImg)} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 14 }}>
            <textarea ref={ta} className="in" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              style={{ minHeight: 420, fontFamily: 'ui-monospace, monospace', fontSize: 12.5, lineHeight: 1.7 }} />
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', minHeight: 420, overflow: 'auto', background: 'var(--card,#fff)' }}>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 8 }}>{t('预览', 'Preview')}</div>
              <Markdown src={draft.body} />
            </div>
          </div>

          <label style={fieldL}>{t('这次改了什么(会记进版本历史)', 'What changed (recorded in the history)')}
            <input className="in sm" value={draft.summary} maxLength={200} onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
              placeholder={t('例如:补充 DB Box 位置确认步骤', 'e.g. added the DB Box sign-off step')} />
          </label>
        </div>
      )}
    </div>
  );
}

/* 附件:点名字(或「预览」)打开全屏阅读器;下载是旁边一个小按钮。
   Word / Excel / PPT 旁边写预览状态。PM 只能删自己上传的。 */
function Attachments({ doc, canAdd, onUpload, onRemoved, busy, onOpenMap }: {
  doc: KbDoc; canAdd: boolean; busy: boolean; onOpenMap: () => void;
  onUpload: (f: FileList | null) => void; onRemoved: () => Promise<void>;
}) {
  const { t } = useLang();
  const { me, setToast } = useStore();
  const inp = useRef<HTMLInputElement>(null);
  const [reader, setReader] = useState<number | null>(null);
  if (!canAdd && doc.attachments.length === 0) return null;
  const status = (f: KbAttachment) => {
    const k = previewKind(f.name);
    if (f.isMap) return t('首页地图(当前版本)', 'Home map (current version)');
    if (k === 'none') return t('这种格式不能预览', 'Cannot be previewed');
    if (k !== 'office') return '';
    const p = doc.previews?.[f.id];
    if (!p) return '';
    return p.status === 'ok' ? t('已转成预览', 'Preview ready') : p.status === 'pending' ? `⏳ ${t('正在生成预览…', 'Generating preview…')}` : p.status === 'failed' ? t('预览生成失败', 'Preview failed') : '';
  };
  return (
    <div style={{ marginTop: 22, paddingTop: 14, borderTop: '1px solid var(--row-line)' }} data-testid="kb-attachments">
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text2)' }}>{t('附件', 'Attachments')} ({doc.attachments.length})</span>
        <div style={{ flex: 1 }} />
        {canAdd && (
          <>
            <input ref={inp} type="file" multiple hidden onChange={(e) => onUpload(e.target.files)} data-testid="kb-add-file" />
            <button className="btn-line sm kb-bar" disabled={busy} onClick={() => inp.current?.click()}>＋ {t('添加附件', 'Add file')}</button>
          </>
        )}
      </div>
      {doc.attachments.map((f, i) => {
        const b = fileBadge(f.name, f.isMap);
        const none = previewKind(f.name) === 'none' && !f.isMap;
        return (
          <div key={f.id} data-testid="kb-file-row" data-name={f.name} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--row-line2)', fontSize: 12.5 }}>
            <span style={{ width: 26, height: 30, borderRadius: 3, background: b.color, color: '#fff', fontSize: 8.5, fontWeight: 800, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 3, flexShrink: 0 }}>{b.label}</span>
            <button onClick={() => setReader(i)} data-testid="kb-file-open" style={{ background: 'none', padding: 0, color: 'var(--info)', fontWeight: 600, textAlign: 'left', cursor: 'pointer' }}>{f.name}</button>
            <span data-testid="kb-file-status" style={{ fontSize: 11.5, color: 'var(--text2)', flex: 1 }}>{status(f)}</span>
            <span className="tnum" style={{ color: 'var(--text2)', fontSize: 11 }}>{fmtSize(f.size)}</span>
            <button className="btn-line sm kb-bar" disabled={none} onClick={() => setReader(i)} data-testid="kb-file-preview">👁 {t('预览', 'Preview')}</button>
            <a className="btn-line sm kb-bar" href={`/api/kb/files/${f.id}`} data-testid="kb-file-download">⤓ {t('下载', 'Download')}</a>
            {canDeleteKbFile(me, f) && !f.isMap && (
              <button className="btn-line sm danger kb-bar" data-testid="kb-file-delete" onClick={async () => {
                if (!confirm(t(`删除附件「${f.name}」?`, `Delete attachment "${f.name}"?`))) return;
                const r = await fetch(`/api/kb/files/${f.id}`, { method: 'DELETE' });
                if (!r.ok) { const j = await r.json().catch(() => ({})); setToast(j.error || t('删除失败', 'Delete failed')); return; }
                await onRemoved();
              }}>✕</button>
            )}
          </div>
        );
      })}
      {reader != null && <KbReader files={doc.attachments} start={reader} onClose={() => setReader(null)} canRetry={canManageKbPreviews(me)} onOpenMap={onOpenMap} />}
    </div>
  );
}

/* 图片:读成 data URI 直接嵌进正文。大图先缩到 1600px 宽 ——
   一篇文档塞几张原图会把正文撑到几 MB,列表页就跟着变慢。 */
function ImageButton({ onInsert }: { onInsert: (md: string) => void }) {
  const { t } = useLang();
  const { setToast } = useStore();
  const inp = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={inp} type="file" accept="image/*" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        if (f.size > 8 * 1024 * 1024) { setToast(t('图片超过 8MB', 'Image over 8MB')); return; }
        const url = await shrink(f);
        onInsert(`\n![${f.name}](${url})\n`);
      }} />
      <button className="btn-line sm" onClick={() => inp.current?.click()}>🖼 {t('插入图片', 'Insert image')}</button>
    </>
  );
}

function shrink(file: File): Promise<string> {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => {
      const src = String(fr.result);
      const img = new Image();
      img.onload = () => {
        const max = 1600;
        if (img.width <= max) { resolve(src); return; }
        const c = document.createElement('canvas');
        c.width = max; c.height = Math.round((img.height * max) / img.width);
        const ctx = c.getContext('2d');
        if (!ctx) { resolve(src); return; }
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => resolve(src);
      img.src = src;
    };
    fr.readAsDataURL(file);
  });
}

const cell: React.CSSProperties = { textAlign: 'left', padding: '9px 18px', fontSize: 12.5, borderTop: '1px solid var(--row-line)' };
const fieldL: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: 'var(--text2)', fontWeight: 600 };
const labelS: React.CSSProperties = { fontSize: 12, color: 'var(--text2)', fontWeight: 600, marginBottom: 6 };
