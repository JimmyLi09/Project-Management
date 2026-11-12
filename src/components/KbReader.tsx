'use client';

/* ===== REQ-061 · 附件全屏阅读器 =====
   点附件名就打开,不再直接下载。PDF 和 Word / Excel / PPT(服务器转好的 PDF)用 pdf.js 画;
   图片直接看、可缩放;txt / md / csv 纯文本;别的显示「这种文件不能在线看」和下载按钮。
   pdf.js 随项目打包(pdfjs-dist,worker 也是本地文件),服务器在局域网,不走外网 CDN。
   键盘:← → 翻页,Esc 关闭。 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLang } from '@/lib/i18n';
import { fmtSize } from '@/lib/kbPreview';
import type { KbAttachment } from '@/lib/kb';

interface Info {
  id: string; name: string; size: number;
  kind: 'pdf' | 'image' | 'office' | 'text' | 'none';
  status: 'ready' | 'pending' | 'failed' | 'nosoffice' | 'unsupported';
  pages: number | null; error: string; text?: string; truncated?: boolean;
}

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy: () => Promise<void> };
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown; transform?: number[] }) => { promise: Promise<void>; cancel: () => void };
};

type PdfOpts = { url: string; withCredentials?: boolean; isEvalSupported?: boolean; cMapUrl?: string; cMapPacked?: boolean; standardFontDataUrl?: string };
let pdfjsP: Promise<{ getDocument: (o: PdfOpts) => { promise: Promise<PdfDoc> } }> | null = null;
function loadPdfjs() {
  if (!pdfjsP) {
    pdfjsP = import('pdfjs-dist/legacy/build/pdf.mjs').then((m) => {
      const lib = m as unknown as { GlobalWorkerOptions: { workerSrc: string } };
      lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
      return m as never;
    });
  }
  return pdfjsP;
}

export default function KbReader({ files, start, onClose, canRetry, onOpenMap }: {
  files: KbAttachment[]; start: number; onClose: () => void; canRetry?: boolean; onOpenMap?: () => void;
}) {
  const { t } = useLang();
  const [idx, setIdx] = useState(start);
  const [info, setInfo] = useState<Info | null>(null);
  const [err, setErr] = useState('');
  const [nonce, setNonce] = useState(0);   // 重试后重新问一次状态
  const f = files[idx];

  /* 这个附件是什么、能不能看;Office 还在转就每 2 秒问一次 */
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout> | null = null;
    setInfo(null); setErr('');
    const ask = async () => {
      const r = await fetch(`/api/kb/files/${f.id}/preview?info=1`).catch(() => null);
      if (!alive) return;
      if (!r || !r.ok) { setErr(t('读取失败', 'Could not load')); return; }
      const j = (await r.json()) as Info;
      setInfo(j);
      if (j.kind === 'office' && j.status === 'pending') timer = setTimeout(ask, 2000);
    };
    ask();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [f.id, nonce]);   // eslint-disable-line react-hooks/exhaustive-deps

  const showPdf = !!info && info.status === 'ready' && (info.kind === 'pdf' || info.kind === 'office');
  const [pdfState, setPdfState] = useState<{ page: number; pages: number; zoom: number }>({ page: 1, pages: info?.pages || 0, zoom: 1 });
  const pdfApi = useRef<{ go: (n: number) => void; zoom: (z: number | 'fit') => void } | null>(null);
  const [imgZoom, setImgZoom] = useState<number | 'fit'>('fit');
  useEffect(() => { setImgZoom('fit'); }, [f.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowRight' && showPdf) { e.preventDefault(); pdfApi.current?.go(pdfState.page + 1); }
      else if (e.key === 'ArrowLeft' && showPdf) { e.preventDefault(); pdfApi.current?.go(pdfState.page - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showPdf, pdfState.page]);

  const zoomPct = showPdf ? Math.round(pdfState.zoom * 100) : imgZoom === 'fit' ? null : Math.round(imgZoom * 100);
  const btn: React.CSSProperties = { background: '#2a3038', color: '#e8ecf0', border: '1px solid #3a424c', borderRadius: 6, padding: '5px 10px', fontSize: 12.5, cursor: 'pointer', minHeight: 30 };
  const dis = (on: boolean): React.CSSProperties => (on ? btn : { ...btn, opacity: 0.35, cursor: 'default' });
  const [jump, setJump] = useState('');

  return (
    <div data-testid="kb-reader" role="dialog" aria-modal="true"
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#1b1f24', display: 'flex', flexDirection: 'column', color: '#e8ecf0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid #2c333b', flexWrap: 'wrap' }}>
        <button style={btn} onClick={onClose} data-testid="kb-reader-close">✕ {t('关闭', 'Close')}</button>
        <span data-testid="kb-reader-name" style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '36vw' }}>{f.name}</span>
        <span data-testid="kb-reader-size" style={{ fontSize: 12, color: '#9aa4ae', whiteSpace: 'nowrap' }}>{fmtSize(f.size)}</span>
        <div style={{ flex: 1 }} />
        {showPdf && (
          <>
            <button style={dis(pdfState.page > 1)} disabled={pdfState.page <= 1} onClick={() => pdfApi.current?.go(pdfState.page - 1)} data-testid="kb-reader-prev" title={t('上一页', 'Previous page')}>‹</button>
            <span style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input value={jump || String(pdfState.page)} onChange={(e) => setJump(e.target.value.replace(/\D/g, ''))} data-testid="kb-reader-page"
                onKeyDown={(e) => { if (e.key === 'Enter') { pdfApi.current?.go(Number(jump) || pdfState.page); setJump(''); (e.target as HTMLInputElement).blur(); } }}
                onBlur={() => setJump('')} title={t('输入页码回车跳页', 'Type a page number and press Enter')}
                style={{ width: 38, textAlign: 'center', background: '#2a3038', color: '#fff', border: '1px solid #3a424c', borderRadius: 5, padding: '4px 2px', fontSize: 12.5 }} />
              / <span data-testid="kb-reader-pages">{pdfState.pages || '…'}</span>
            </span>
            <button style={dis(pdfState.page < pdfState.pages)} disabled={pdfState.page >= pdfState.pages} onClick={() => pdfApi.current?.go(pdfState.page + 1)} data-testid="kb-reader-next" title={t('下一页', 'Next page')}>›</button>
          </>
        )}
        {(showPdf || (info?.kind === 'image' && info.status === 'ready')) && (
          <>
            <button style={btn} data-testid="kb-reader-zoom-out" title={t('缩小', 'Zoom out')}
              onClick={() => (showPdf ? pdfApi.current?.zoom(Math.max(0.3, pdfState.zoom - 0.2)) : setImgZoom((z) => Math.max(0.2, (z === 'fit' ? 1 : z) - 0.25)))}>－</button>
            <span data-testid="kb-reader-zoom" style={{ fontSize: 12.5, minWidth: 44, textAlign: 'center' }}>{zoomPct == null ? t('适合', 'Fit') : `${zoomPct}%`}</span>
            <button style={btn} data-testid="kb-reader-zoom-in" title={t('放大', 'Zoom in')}
              onClick={() => (showPdf ? pdfApi.current?.zoom(Math.min(4, pdfState.zoom + 0.2)) : setImgZoom((z) => Math.min(5, (z === 'fit' ? 1 : z) + 0.25)))}>＋</button>
            <button style={btn} data-testid="kb-reader-fit" onClick={() => (showPdf ? pdfApi.current?.zoom('fit') : setImgZoom('fit'))}>{t('适合宽度', 'Fit width')}</button>
          </>
        )}
        {files.length > 1 && (
          <>
            <button style={dis(idx > 0)} disabled={idx <= 0} onClick={() => setIdx(idx - 1)} data-testid="kb-reader-prev-file">{t('上一个附件', 'Previous file')}</button>
            <button style={dis(idx < files.length - 1)} disabled={idx >= files.length - 1} onClick={() => setIdx(idx + 1)} data-testid="kb-reader-next-file">{t('下一个附件', 'Next file')}</button>
          </>
        )}
        <a href={`/api/kb/files/${f.id}`} data-testid="kb-reader-download"
          style={{ ...btn, background: '#fff', color: '#15202b', fontWeight: 700, textDecoration: 'none' }}>⤓ {t('下载', 'Download')}</a>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {err && <Center>{err}</Center>}
        {!err && !info && <Center>{t('加载中…', 'Loading…')}</Center>}
        {info && showPdf && (
          <PdfView key={f.id} url={`/api/kb/files/${f.id}/preview`} apiRef={pdfApi} onState={setPdfState} />
        )}
        {info && info.kind === 'image' && info.status === 'ready' && (
          <div style={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: imgZoom === 'fit' ? 'center' : 'flex-start', padding: 20 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img data-testid="kb-reader-img" src={`/api/kb/files/${f.id}/preview`} alt={f.name}
              style={imgZoom === 'fit' ? { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', background: '#fff' } : { width: `${imgZoom * 100}%`, maxWidth: 'none', background: '#fff' }} />
          </div>
        )}
        {info && info.kind === 'text' && (
          <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', justifyContent: 'center' }}>
            <pre data-testid="kb-reader-text" style={{ background: '#fff', color: '#1d2329', padding: '24px 28px', borderRadius: 6, maxWidth: 980, width: '100%', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, lineHeight: 1.6, margin: 0 }}>
              {info.text}{info.truncated ? `\n\n… ${t('(只显示前 512KB,完整内容请下载)', '(first 512KB only — download for the full file)')}` : ''}
            </pre>
          </div>
        )}
        {info && info.kind === 'office' && info.status !== 'ready' && (
          <Center testid="kb-reader-status">
            {info.status === 'pending' && <><div style={{ fontSize: 15, fontWeight: 600 }}>⏳ {t('正在生成预览…', 'Generating the preview…')}</div><div style={sub}>{t('Word / Excel / PPT 由服务器转成 PDF 来看,一般几秒到一分钟。这里会自动刷新。', 'Word / Excel / PowerPoint files are converted to PDF on the server — usually a few seconds to a minute. This refreshes by itself.')}</div></>}
            {info.status === 'failed' && <><div style={{ fontSize: 15, fontWeight: 600 }}>{t('预览生成失败,可以下载查看', 'The preview could not be generated — download the file to view it')}</div>{info.error && <div style={sub}>{info.error}</div>}
              {canRetry && <button style={{ ...btn, marginTop: 14 }} data-testid="kb-reader-retry" onClick={async () => { await fetch(`/api/kb/files/${f.id}/preview`, { method: 'POST' }); setNonce((n) => n + 1); }}>↻ {t('重试', 'Retry')}</button>}</>}
            {info.status === 'nosoffice' && <><div style={{ fontSize: 15, fontWeight: 600 }}>{t('服务器还没装预览组件,可以下载查看', 'The preview component is not installed on the server yet — download the file to view it')}</div><div style={sub}>{t('Word / Excel / PPT 要在服务器上装 LibreOffice 才能在线看;PDF 和图片不受影响。', 'Word / Excel / PowerPoint previews need LibreOffice on the server; PDFs and images are not affected.')}</div></>}
          </Center>
        )}
        {info && (info.kind === 'none' || info.status === 'unsupported') && (
          <Center testid="kb-reader-status">
            <div style={{ fontSize: 15, fontWeight: 600 }}>{t('这种文件不能在线看', 'This file type cannot be viewed online')}</div>
            <div style={sub}>{t('可以点右上角「下载」打开。', 'Use Download (top right) to open it.')}</div>
            {f.isMap && onOpenMap && <button style={{ ...btn, marginTop: 14 }} onClick={() => { onClose(); onOpenMap(); }}>🗺 {t('打开知识库首页的流程地图', 'Open the map on the knowledge base home')}</button>}
          </Center>
        )}
      </div>
      <div style={{ padding: '6px 14px', fontSize: 11.5, color: '#9aa4ae', borderTop: '1px solid #2c333b' }}>
        {t(`附件 ${idx + 1} / ${files.length}`, `File ${idx + 1} of ${files.length}`)} · {t('← → 翻页 · Esc 关闭', '← → turn pages · Esc closes')}
      </div>
    </div>
  );
}

const sub: React.CSSProperties = { fontSize: 12.5, color: '#9aa4ae', marginTop: 8, maxWidth: 520, textAlign: 'center', lineHeight: 1.6 };
function Center({ children, testid }: { children: React.ReactNode; testid?: string }) {
  return <div data-testid={testid} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 30, textAlign: 'center' }}>{children}</div>;
}

/* PDF:左边缩略图(可收起),右边一页一页往下排。看到哪页才画哪页(大文件不卡)。 */
function PdfView({ url, apiRef, onState }: {
  url: string;
  apiRef: React.MutableRefObject<{ go: (n: number) => void; zoom: (z: number | 'fit') => void } | null>;
  onState: (s: { page: number; pages: number; zoom: number }) => void;
}) {
  const { t } = useLang();
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [size1, setSize1] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [thumbs, setThumbs] = useState(true);
  const [err, setErr] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true; let d: PdfDoc | null = null;
    loadPdfjs().then((lib) => lib.getDocument({
      url, withCredentials: true,
      isEvalSupported: false,                                   // 不用 eval / new Function 画字体
      cMapUrl: '/api/kb/pdfjs/cmaps/', cMapPacked: true,          // 中文 PDF 的字符映射表,本地提供
      standardFontDataUrl: '/api/kb/pdfjs/standard_fonts/',
    }).promise).then(async (x) => {
      d = x;
      if (!alive) { x.destroy(); return; }
      const p1 = await x.getPage(1);
      const v = p1.getViewport({ scale: 1 });
      setSize1({ w: v.width, h: v.height });
      setDoc(x);
    }).catch((e) => { if (alive) setErr(String(e?.message || e)); });
    return () => { alive = false; if (d) d.destroy(); };
  }, [url]);

  const fit = useCallback(() => {
    if (!size1 || !box.current) return 1;
    return Math.max(0.3, Math.min(4, (box.current.clientWidth - 48) / size1.w));
  }, [size1]);
  useEffect(() => { if (size1 && zoom == null) setZoom(fit()); }, [size1, zoom, fit]);

  const go = useCallback((n: number) => {
    if (!doc) return;
    const p = Math.max(1, Math.min(doc.numPages, n));
    box.current?.querySelector(`[data-page="${p}"]`)?.scrollIntoView({ block: 'start' });
    setPage(p);
  }, [doc]);
  useEffect(() => { apiRef.current = { go, zoom: (z) => setZoom(z === 'fit' ? fit() : z) }; }, [go, fit, apiRef]);
  useEffect(() => { if (doc && zoom) onState({ page, pages: doc.numPages, zoom }); }, [doc, page, zoom, onState]);

  /* 滚动时更新「第几页」:取视口里最靠上的那一页 */
  useEffect(() => {
    const el = box.current;
    if (!el || !doc) return;
    const onScroll = () => {
      const top = el.getBoundingClientRect().top;
      let best = 1, bestD = Infinity;
      el.querySelectorAll<HTMLElement>('[data-page]').forEach((p) => {
        const d = Math.abs(p.getBoundingClientRect().top - top - 20);
        if (d < bestD) { bestD = d; best = Number(p.dataset.page); }
      });
      setPage(best);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [doc]);

  if (err) return <Center>{t('PDF 打不开:', 'Could not open the PDF: ')}{err}</Center>;
  const pages = doc ? Array.from({ length: doc.numPages }, (_, i) => i + 1) : [];
  return (
    <>
      {doc && size1 && (
        <div data-testid="kb-reader-thumbs" style={{ width: thumbs ? 132 : 26, flexShrink: 0, borderRight: '1px solid #2c333b', overflow: 'auto', background: '#202429', position: 'relative' }}>
          <button onClick={() => setThumbs(!thumbs)} title={thumbs ? t('收起缩略图', 'Hide thumbnails') : t('展开缩略图', 'Show thumbnails')} data-testid="kb-reader-thumbs-toggle"
            style={{ position: 'sticky', top: 0, width: '100%', background: '#202429', color: '#9aa4ae', border: 'none', padding: '4px 0', cursor: 'pointer', fontSize: 12, zIndex: 1 }}>{thumbs ? '«' : '»'}</button>
          {thumbs && pages.map((n) => (
            <button key={n} onClick={() => go(n)} data-testid="kb-reader-thumb"
              style={{ display: 'block', margin: '6px auto 10px', padding: 0, border: n === page ? '2px solid #4a8fe0' : '2px solid transparent', borderRadius: 4, background: 'none', cursor: 'pointer' }}>
              <PageCanvas doc={doc} n={n} scale={100 / size1.w} w={100} h={(100 * size1.h) / size1.w} />
              <div style={{ fontSize: 10.5, color: '#9aa4ae', textAlign: 'right', paddingRight: 4 }}>{n}</div>
            </button>
          ))}
        </div>
      )}
      <div ref={box} style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
        {!doc && <Center>{t('加载中…', 'Loading…')}</Center>}
        {doc && size1 && zoom && pages.map((n) => (
          <div key={n} data-page={n} style={{ margin: '0 auto 18px', width: size1.w * zoom }}>
            <PageCanvas doc={doc} n={n} scale={zoom} w={size1.w * zoom} h={size1.h * zoom} testid="kb-reader-canvas" />
          </div>
        ))}
      </div>
    </>
  );
}

/* 一页:进入视口才画(高分屏按 devicePixelRatio 画清楚) */
function PageCanvas({ doc, n, scale, w, h, testid }: { doc: PdfDoc; n: number; scale: number; w: number; h: number; testid?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!seen) return;
    let task: { cancel: () => void } | null = null, alive = true;
    doc.getPage(n).then((p) => {
      if (!alive || !ref.current) return;
      const dpr = window.devicePixelRatio || 1;
      const vp = p.getViewport({ scale });
      const c = ref.current;
      c.width = Math.floor(vp.width * dpr); c.height = Math.floor(vp.height * dpr);
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const r = p.render({ canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      task = r;
      r.promise.then(() => { if (ref.current) ref.current.dataset.rendered = '1'; }).catch(() => { /* 换缩放时取消,正常 */ });
    });
    return () => { alive = false; task?.cancel(); };
  }, [seen, doc, n, scale]);
  const style = useMemo<React.CSSProperties>(() => ({ width: w, height: h, display: 'block', background: '#fff', boxShadow: '0 1px 6px rgba(0,0,0,.35)' }), [w, h]);
  return <canvas ref={ref} style={style} data-testid={testid} data-n={n} />;
}
