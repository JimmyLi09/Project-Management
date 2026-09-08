'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { useLang } from '@/lib/i18n';
import { canDeleteKb, canEditKb } from '@/lib/permissions';
import { SVC, STAGES, svcColor } from '@/lib/templates';
import { Icon } from '../ui';
import {
  KB_CATEGORIES, catName, diffLines, excerpt, matchDoc,
  type KbDoc, type KbVersion,
} from '@/lib/kb';
import Markdown from '../Markdown';
import { invalidateKbCache } from '../KbLinks';

/* ===== REQ-035: 运营中心 · 知识库 =====
   左边分类 + 搜索,右边看 / 改一篇文档。核心是三件事:
   ① 每次保存留一版,能看历史、能比对、能回退;
   ② 已有文件能导进来(.docx/.xlsx/文本解析成正文,其余作为附件);
   ③ 能导出(Word 单篇 / 按分类打包,PDF 走浏览器打印)。
   正文是 Markdown,渲染成真实 React 元素 —— 见 components/Markdown.tsx,
   全程不碰 dangerouslySetInnerHTML。 */
export default function KnowledgeView() {
  const { me, setToast } = useStore();
  const { lang, t } = useLang();
  const canEd = canEditKb(me);

  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState<string>('');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const load = React.useCallback(async () => {
    invalidateKbCache();   // 文档变了,资料卡 / 工作流那边的「相关文档」要跟着更新
    const r = await fetch('/api/kb');
    if (r.ok) setDocs((await r.json()).docs as KbDoc[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(
    () => docs.filter((d) => (!cat || d.category === cat) && matchDoc(d, q)),
    [docs, cat, q],
  );
  const countOf = (c: string) => docs.filter((d) => d.category === c).length;
  const open = docs.find((d) => d.id === openId) || null;

  async function create() {
    const title = prompt(t('新文档标题', 'New document title'), '');
    if (!title || !title.trim()) return;
    const r = await fetch('/api/kb', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), category: cat || 'other', body: '' }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setToast(d.error || t('新建失败', 'Create failed')); return; }
    await load();
    setOpenId(d.doc.id);
  }

  if (open) return <DocPage doc={open} onBack={() => setOpenId(null)} onChanged={load} />;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '210px 1fr', gap: 18, alignItems: 'start' }}>
      <div className="panel" style={{ padding: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text2)', padding: '4px 8px 8px' }}>
          {t('分类', 'Categories')}
        </div>
        {[['', t('全部', 'All'), docs.length] as [string, string, number],
          ...KB_CATEGORIES.map((c) => [c[0], lang === 'zh' ? c[1] : c[2], countOf(c[0])] as [string, string, number])]
          .map(([k, label, n]) => (
            <button key={k || '_all'} onClick={() => setCat(k)}
              style={{
                display: 'flex', width: '100%', gap: 8, alignItems: 'center', padding: '7px 9px', borderRadius: 7,
                fontSize: 12.5, textAlign: 'left', fontWeight: cat === k ? 700 : 500,
                background: cat === k ? 'var(--navy900)' : 'transparent',
                color: cat === k ? '#fff' : 'var(--text)',
              }}>
              <span style={{ flex: 1 }}>{label}</span>
              <span className="tnum" style={{ fontSize: 11, opacity: 0.7 }}>{n}</span>
            </button>
          ))}
        {cat && (
          <a className="btn-line sm" style={{ display: 'block', marginTop: 10, textAlign: 'center' }}
            href={`/api/kb/cat:${encodeURIComponent(cat)}/export`}
            title={t('把这个分类下的文档打包成一个 zip(每篇一个 Word)', 'Download every doc in this category as one zip of Word files')}>
            ⤓ {t('整类导出', 'Export category')}
          </a>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="panel" style={{ padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="in sm" style={{ flex: 1, minWidth: 200 }} value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={t('搜索标题 / 正文 / 标签…', 'Search title, body or tags…')} />
          {canEd && <button className="btn-line sm" onClick={() => setImporting(!importing)}>⤒ {t('导入文件', 'Import')}</button>}
          {canEd && <button className="btn-navy sm" onClick={create}>＋ {t('新建文档', 'New doc')}</button>}
        </div>

        {importing && canEd && <ImportPanel defaultCat={cat || 'other'} onDone={async (id) => { setImporting(false); await load(); setOpenId(id); }} />}

        {loading && <div className="panel" style={{ padding: 30, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>{t('加载中…', 'Loading…')}</div>}

        {!loading && shown.length === 0 && (
          <div className="panel" style={{ padding: 34, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
            {docs.length === 0
              ? t('知识库还是空的。把现有的 SOP / 培训资料「导入文件」进来,或直接新建一篇。',
                  'The knowledge base is empty. Import your existing SOPs / training files, or write a new doc.')
              : t('没有匹配的文档。', 'No matching documents.')}
          </div>
        )}

        {shown.map((d) => (
          <button key={d.id} className="panel" onClick={() => setOpenId(d.id)}
            style={{ padding: '14px 18px', textAlign: 'left', display: 'block', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--navy900)' }}>{d.title}</span>
              <span className="badge" style={{ background: 'var(--hover-bg)', color: 'var(--text2)' }}>{catName(d.category, lang)}</span>
              {d.tags.map((tg) => <span key={tg} className="badge" style={{ background: '#eef2f7', color: '#4a5b6c' }}>#{tg}</span>)}
              {d.attachments.length > 0 && <span className="badge" style={{ background: '#eef2f7', color: '#4a5b6c' }}>📎 {d.attachments.length}</span>}
              <div style={{ flex: 1 }} />
              <span className="tnum" style={{ fontSize: 11, color: 'var(--text2)' }}>
                v{d.version} · {d.updatedBy} · {new Date(d.updatedAt).toLocaleDateString()}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 6 }}>{excerpt(d.body) || t('(空文档)', '(empty)')}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---- 导入 ---- */
function ImportPanel({ defaultCat, onDone }: { defaultCat: string; onDone: (id: string) => void }) {
  const { setToast } = useStore();
  const { lang, t } = useLang();
  const [mode, setMode] = useState<'parse' | 'attach'>('parse');
  const [cat, setCat] = useState(defaultCat);
  const [busy, setBusy] = useState(false);
  const inp = useRef<HTMLInputElement>(null);

  async function go(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true);
    let lastId = '';
    const notes: string[] = [];
    for (const f of Array.from(files).slice(0, 20)) {
      const fd = new FormData();
      fd.append('file', f); fd.append('mode', mode); fd.append('category', cat);
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
    <div className="panel" style={{ padding: '14px 18px', borderStyle: 'dashed' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--navy900)' }}>{t('导入已有文件', 'Import existing files')}</span>
        <label style={{ fontSize: 12.5, display: 'inline-flex', gap: 5, alignItems: 'center' }}>
          <input type="radio" checked={mode === 'parse'} onChange={() => setMode('parse')} />
          {t('解析为正文', 'Parse into the body')}
        </label>
        <label style={{ fontSize: 12.5, display: 'inline-flex', gap: 5, alignItems: 'center' }}>
          <input type="radio" checked={mode === 'attach'} onChange={() => setMode('attach')} />
          {t('作为附件', 'Keep as attachment')}
        </label>
        <span style={{ fontSize: 12.5 }}>{t('归类到', 'Category')}
          <select className="in sm" style={{ width: 'auto', marginLeft: 6 }} value={cat} onChange={(e) => setCat(e.target.value)}>
            {KB_CATEGORIES.map((c) => <option key={c[0]} value={c[0]}>{lang === 'zh' ? c[1] : c[2]}</option>)}
          </select>
        </span>
        <div style={{ flex: 1 }} />
        <input ref={inp} type="file" multiple hidden onChange={(e) => go(e.target.files)}
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
function DocPage({ doc, onBack, onChanged }: { doc: KbDoc; onBack: () => void; onChanged: () => Promise<void> }) {
  const { me, setToast } = useStore();
  const { lang, t } = useLang();
  const canEd = canEditKb(me);

  const [d, setD] = useState<KbDoc>(doc);
  const [versions, setVersions] = useState<KbVersion[]>([]);
  const [editing, setEditing] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [cmp, setCmp] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ title: d.title, titleEn: d.titleEn, category: d.category as string, tags: d.tags.join(', '), body: d.body, summary: '', svc: d.anchors.svc, stage: d.anchors.stage });
  const ta = useRef<HTMLTextAreaElement>(null);

  const reload = React.useCallback(async () => {
    const r = await fetch(`/api/kb/${d.id}`);
    if (!r.ok) return;
    const j = await r.json();
    setD(j.doc); setVersions(j.versions);
  }, [d.id]);
  useEffect(() => { reload(); }, [reload]);

  function begin() {
    setDraft({ title: d.title, titleEn: d.titleEn, category: d.category, tags: d.tags.join(', '), body: d.body, summary: '', svc: d.anchors.svc, stage: d.anchors.stage });
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
    if (!r.ok) { setToast(t('删除失败', 'Delete failed')); return; }
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
    <div className="ex-print-doc" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel kb-bar" style={{ padding: '12px 18px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn-line sm" onClick={onBack}>← {t('返回', 'Back')}</button>
        <span style={{ fontSize: 12, color: 'var(--text2)' }}>
          v{d.version} · {t('最后修改', 'updated')} {d.updatedBy} {new Date(d.updatedAt).toLocaleString()}
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn-line sm" onClick={() => setHistOpen(!histOpen)}>{t('版本历史', 'History')} ({versions.length})</button>
        <a className="btn-line sm" href={`/api/kb/${d.id}/export?fmt=docx`}>⤓ Word</a>
        <a className="btn-line sm" href={`/api/kb/${d.id}/export?fmt=md`}>⤓ Markdown</a>
        <button className="btn-line sm" onClick={() => window.print()}>⎙ {t('打印 / PDF', 'Print / PDF')}</button>
        {canEd && !editing && <button className="btn-navy sm" onClick={begin}><Icon name="edit" size={13} />{t('编辑', 'Edit')}</button>}
        {canEd && editing && <button className="btn-line sm" disabled={busy} onClick={() => setEditing(false)}>{t('取消', 'Cancel')}</button>}
        {canEd && editing && <button className="btn-navy sm" disabled={busy} onClick={save}>{busy ? t('保存中…', 'Saving…') : t('保存(留一版)', 'Save (new version)')}</button>}
        {canDeleteKb(me) && !editing && <button className="btn-line sm danger" onClick={del}>✕ {t('删除', 'Delete')}</button>}
      </div>

      {histOpen && (
        <div className="panel clip kb-bar">
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
                    {canEd && v.version !== d.version && (
                      <button className="btn-line sm" style={{ marginLeft: 6 }} onClick={() => revert(v.version)}>↺ {t('回退', 'Revert')}</button>
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
                  }}>{l.kind} {l.text || ' '}</div>
                ))}
              </pre>
            </div>
          )}
        </div>
      )}

      {!editing ? (
        <div className="panel" style={{ padding: '22px 26px' }}>
          <h1 style={{ fontSize: 23, fontWeight: 700, color: 'var(--navy900)', margin: '0 0 4px' }}>{d.title}</h1>
          {d.titleEn && <div style={{ fontSize: 13.5, color: 'var(--text2)' }}>{d.titleEn}</div>}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0 18px' }}>
            <span className="badge" style={{ background: 'var(--hover-bg)', color: 'var(--text2)' }}>{catName(d.category, lang)}</span>
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
          {d.body.trim()
            ? <Markdown src={d.body} />
            : <div style={{ color: 'var(--text2)', fontSize: 13 }}>{t('这篇还没有正文 —— 点右上角「编辑」开始写。', 'No content yet — hit Edit to start writing.')}</div>}

          <Attachments doc={d} canEd={canEd} onUpload={upload} busy={busy}
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
            <label style={fieldL}>{t('分类', 'Category')}
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

function Attachments({ doc, canEd, onUpload, onRemoved, busy }: {
  doc: KbDoc; canEd: boolean; busy: boolean;
  onUpload: (f: FileList | null) => void; onRemoved: () => Promise<void>;
}) {
  const { t } = useLang();
  const { setToast } = useStore();
  const inp = useRef<HTMLInputElement>(null);
  if (!canEd && doc.attachments.length === 0) return null;
  return (
    <div style={{ marginTop: 22, paddingTop: 14, borderTop: '1px solid var(--row-line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text2)' }}>{t('附件', 'Attachments')} ({doc.attachments.length})</span>
        <div style={{ flex: 1 }} />
        {canEd && (
          <>
            <input ref={inp} type="file" multiple hidden onChange={(e) => onUpload(e.target.files)} />
            <button className="btn-line sm kb-bar" disabled={busy} onClick={() => inp.current?.click()}>＋ {t('添加附件', 'Add file')}</button>
          </>
        )}
      </div>
      {doc.attachments.map((f) => (
        <div key={f.id} style={{ display: 'flex', gap: 9, alignItems: 'center', padding: '7px 0', borderTop: '1px solid var(--row-line2)', fontSize: 12.5 }}>
          <span>📎</span>
          <a href={`/api/kb/files/${f.id}`} style={{ flex: 1, color: 'var(--info)' }}>{f.name}</a>
          <span className="tnum" style={{ color: 'var(--text2)', fontSize: 11 }}>{(f.size / 1024).toFixed(0)} KB</span>
          {canEd && (
            <button className="btn-line sm danger kb-bar" onClick={async () => {
              if (!confirm(t(`删除附件「${f.name}」?`, `Delete attachment "${f.name}"?`))) return;
              const r = await fetch(`/api/kb/files/${f.id}`, { method: 'DELETE' });
              if (!r.ok) { setToast(t('删除失败', 'Delete failed')); return; }
              await onRemoved();
            }}>✕</button>
          )}
        </div>
      ))}
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
