'use client';

/* ===== AV-015 图片智能判读 =====
   A picture (site photo, screenshot, render, scanned sheet) uploaded in 02. The
   local vision model says what it is and reads what is written on it; this
   screen shows that as candidates, asks for what is missing (a fixed rule
   table), and lets the kernel suggest a pitch. Nothing here is decided by the
   model: every value is confirmed by a person, and 05 computes from there.

   When the local service is not there the same screen becomes a manual form
   (with OCR numbers to assign when OCR is installed). No install command ever
   shows up here — the admin sees the technical detail, everyone else a plain
   sentence. */

import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  asks, finalOf, itemOf, meetsVd01, settle,
  type Ask, type ImageKind, type Intent, type ItemKey, type JudgeItem, type JudgeReview,
} from '@/av/core/imagejudge';
import type { StoredDrawing } from '@/av/core/handoff';
import type { JudgeView } from '@/server/avjudge';
import { fmtDate } from '@/lib/project';
import { useLang } from '@/lib/i18n';

type Tx = (zh: string, en: string) => string;

const KIND: Record<ImageKind, [string, string]> = {
  drawing: ['施工图', 'Drawing'], drawing_screenshot: ['施工图截图', 'Drawing screenshot'], site_photo: ['现场照片', 'Site photo'],
  render: ['效果图 / 概念图', 'Render / concept'], screenshot: ['其他截图', 'Screenshot'], unrelated: ['与 LED 屏无关', 'Not about an LED screen'],
};
const ITEM: Record<ItemKey, [string, string]> = {
  led_opening_w: ['屏宽', 'Width'], led_opening_h: ['屏高', 'Height'], led_mount_h: ['离地高度', 'Mounting height'],
  led_view_min: ['最近观看距离', 'Min viewing distance'], led_ctrl_dist: ['控制室距离', 'Control room distance'],
  led_pwr_dist: ['配电箱距离', 'Power board distance'], shape: ['形状', 'Shape'], mount: ['安装方式', 'Mounting'],
  pitch_hint: ['图上写的点间距', 'Pitch on the picture'], ratio: ['画面比例', 'Aspect ratio'],
};
const SHAPE: Record<string, [string, string]> = {
  flat: ['平面', 'Flat'], concave: ['内凹弧形', 'Concave curve'], convex: ['外凸弧形', 'Convex curve'], corner: ['转角', 'Corner'], irregular: ['异形', 'Irregular'],
};
const MOUNT: Record<string, [string, string]> = {
  recessed: ['嵌入墙体', 'Recessed'], wall: ['挂墙', 'Wall-mounted'], floor: ['落地', 'Floor-standing'], hanging: ['吊装', 'Hung'], truss: ['桁架', 'Truss'],
};
const INTENTS: [Intent, [string, string], [string, string]][] = [
  ['site', ['要施工的现场', 'A site we will build'], ['按图上的尺寸出方案', 'Design from the sizes on the picture']],
  ['ref', ['参考效果（客户想要类似的）', 'Reference (client wants something similar)'], ['尺寸按我们现场的来，图只用来参考形状、效果', 'Sizes come from our site; the picture only shows the look']],
  ['other', ['只是资料 / 其他', 'Just information'], ['不进入方案', 'Not used for a design']],
];

/* Plain words for why the local model did not read this picture (§5). */
function fallbackText(j: JudgeView, t: Tx): string {
  if (j.fallback === 'by_hand') return t('解析失败的留档，按你的选择改为手填：对照原件填好尺寸，确认后同样带入 05。', 'Failed upload, switched to manual entry as you chose: fill in the sizes from the original, then confirm into 05.');
  if (j.fallback === 'bad_image') return t('这种图片格式读不了，已改为手填；可以另存为 JPG / PNG 再上传。', 'This picture format cannot be read; switched to manual entry. Save it as JPG / PNG and upload again.');
  if (j.fallback === 'vision_off') return t('本机视觉模型已被管理员关闭，已改为手填。', 'The local vision model is switched off by the admin; switched to manual entry.');
  const via = j.engine === 'ocr' ? t('已退回文字识别，只读出了图上的文字', 'fell back to text recognition (numbers only)') : t('已改为手填', 'switched to manual entry');
  if (j.fallback === 'vision_timeout') return t(`本机识别超时，${via}；请联系管理员。`, `Local recognition timed out, ${via}; please contact the admin.`);
  return t(`本机识别服务暂不可用，${via}；请联系管理员。`, `The local recognition service is unavailable, ${via}; please contact the admin.`);
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init).catch(() => null);
  const body = res ? await res.json().catch(() => ({})) : { error: '网络错误' };
  if (!res?.ok || body.error) throw new Error(body.error || '请求失败');
  return body as T;
}

const conf = (c: number): [string, string, string] => (c >= 0.7 ? ['var(--success)', '高', 'high'] : c >= 0.5 ? ['var(--warning)', '中', 'mid'] : ['var(--danger)', '低', 'low']);

export default function ImageJudgePanel({ judge, setJudge, mayReview, onHandoff }: {
  judge: JudgeView;
  setJudge: (j: JudgeView) => void;
  mayReview: boolean;
  onHandoff: (d: StoredDrawing, pack: string | null) => void;
}) {
  const { t, lang } = useLang();
  const tt = (p: [string, string]) => (lang === 'zh' ? p[0] : p[1]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const idRef = useRef(judge.id);
  const topRef = useRef<HTMLDivElement>(null);

  /* a new picture: bring the panel into view (it sits below the upload form) */
  useEffect(() => { topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [judge.id]);

  /* poll while the model is reading */
  useEffect(() => {
    idRef.current = judge.id;
    if (judge.status !== 'running') return;
    const timer = setInterval(async () => {
      try {
        const r = await call<{ judge: JudgeView }>(`/api/av/judge/${judge.id}`);
        if (idRef.current === r.judge.id) setJudge(r.judge);
      } catch { /* keep polling */ }
    }, 2000);
    return () => clearInterval(timer);
  }, [judge.id, judge.status, setJudge]);

  useEffect(() => { setDraft({}); setError(''); }, [judge.id, judge.status]);

  const r = judge.result;
  const rv = judge.review;
  const handed = judge.drawingId > 0;
  const editable = mayReview && !handed && judge.status === 'done';

  async function patch(next: Partial<JudgeReview>) {
    setError('');
    try { setJudge((await call<{ judge: JudgeView }>(`/api/av/judge/${judge.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) })).judge); }
    catch (e) { setError((e as Error).message); }
  }
  const answer = (k: string, v: string) => patch({ answers: { ...rv.answers, [k]: v } });

  async function rerun(page: number) {
    setBusy(true); setError('');
    try { setJudge((await call<{ judge: JudgeView }>(`/api/av/judge/${judge.id}/rerun`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page }) })).judge); }
    catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  async function handoff() {
    setBusy(true); setError('');
    try {
      const res = await call<{ drawing: StoredDrawing; pack: string | null; judge: JudgeView }>(`/api/av/judge/${judge.id}/handoff`, { method: 'POST' });
      setJudge(res.judge);
      onHandoff(res.drawing, res.pack);
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  async function open05() {
    try {
      const d = await call<StoredDrawing>(`/api/av/drawings/${judge.drawingId}`);
      const inq = await call<{ inquiry: { packs: Record<string, string> } | null }>(`/api/av/inquiry?project=${encodeURIComponent(judge.projectId)}`).catch(() => ({ inquiry: null }));
      onHandoff(d, inq.inquiry?.packs.led ?? null);
    } catch (e) { setError((e as Error).message); }
  }

  const s = useMemo(() => (r ? settle(r, rv, judge.suggestedPitch, judge.mod) : null), [r, rv, judge.suggestedPitch, judge.mod]);
  const questions = useMemo(() => (r ? asks(r, rv) : []), [r, rv]);

  /* ── engine line ── */
  const engineBox = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)', fontSize: 12.5 }}
      data-testid="judge-engine">
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: judge.status === 'running' || judge.engine === 'vision' ? 'var(--success)' : 'var(--danger)' }} />
      {judge.status === 'running' ? (
        <><b>{t('识别引擎：本机视觉模型', 'Engine: local vision model')}</b><span style={{ color: 'var(--text2)' }}>{t('免费 · 图片不出内网', 'free · stays on the intranet')}</span></>
      ) : judge.engine === 'vision' ? (
        <><b>{t('识别引擎：本机视觉模型', 'Engine: local vision model')}</b>
          <span style={{ color: 'var(--text2)' }}>{t(`免费 · 图片不出内网 · 本张用时 ${Math.round(judge.ms / 1000)} 秒`, `free · stays on the intranet · ${Math.round(judge.ms / 1000)} s`)}</span></>
      ) : (
        <><b>{t('本机视觉模型没有用上', 'Local vision model not used')}</b>
          <span style={{ color: 'var(--text2)' }}>{judge.engine === 'ocr' ? t('已退回文字识别 + 手填', 'fell back to OCR + manual') : t('已改为手填', 'manual entry')}</span></>
      )}
    </div>
  );

  const thumb = (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
      {judge.pages > 0
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={`/api/av/judge/${judge.id}/image?page=${judge.page}`} alt={judge.fileName} style={{ display: 'block', width: '100%', height: 'auto' }} />
        : <div style={{ padding: 30, fontSize: 12, color: 'var(--text2)', textAlign: 'center' }}>{t('图片无法显示', 'Picture cannot be shown')}</div>}
    </div>
  );

  const pagePicker = judge.pages > 1 && (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, marginTop: 8 }}>
      <span style={{ color: 'var(--text2)' }}>{t(`共 ${judge.totalPages} 页，读的是第 ${judge.page} 页`, `${judge.totalPages} pages; reading page ${judge.page}`)}</span>
      {editable && Array.from({ length: judge.pages }, (_, i) => i + 1).filter((p) => p !== judge.page).map((p) => (
        <button key={p} className="btn-line sm" disabled={busy} onClick={() => rerun(p)}>{t(`改读第 ${p} 页`, `Read page ${p}`)}</button>
      ))}
    </div>
  );

  /* ── running ── */
  if (judge.status === 'running') {
    const secs = Math.round(judge.elapsedMs / 1000);
    const phase = judge.phase === 'queued' ? t('排队中（前面还有图片在识别）', 'Queued behind another picture')
      : judge.phase === 'load' ? t('正在加载模型、看图…（没有显卡时第一张要几分钟）', 'Loading the model and looking… (minutes without a GPU)')
        : t('正在读图上的文字和数字…', 'Reading the text and numbers…');
    return (
      <div className="panel" style={{ padding: 0 }} data-testid="judge-running" ref={topRef}>
        <div className="panel-head"><span className="panel-title">{t('03 · 图片智能判读', '03 · Picture recognition')}</span>{engineBox}</div>
        <div style={{ padding: '16px 18px', display: 'grid', gridTemplateColumns: 'minmax(0,300px) minmax(0,1fr)', gap: 16 }}>
          {thumb}
          <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
            <b>{judge.fileName}</b>
            <div style={{ fontSize: 13 }}>{phase}</div>
            <div style={{ height: 6, background: 'var(--hover-bg)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(95, judge.phase === 'read' ? 30 + judge.chars / 20 : 12)}%`, height: '100%', background: 'var(--navy700)', transition: 'width .6s' }} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text2)' }} className="tnum">
              {t(`已用 ${secs} 秒。可以离开这一页去做别的事，识别在服务器上继续。`, `${secs} s so far. You can leave this page; recognition continues on the server.`)}
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (!r || !s) return null;

  /* ── rows ── */
  const confirmable = new Set(r.items.filter((i) => i.value !== null && i.key !== 'ratio').map((i) => i.key));
  const pending = [...confirmable].filter((k) => !rv.confirmed[k]).length;

  const setValue = (k: ItemKey, v: number | string | null) =>
    patch({ values: { ...rv.values, [k]: v }, confirmed: confirmable.has(k) ? { ...rv.confirmed, [k]: true } : rv.confirmed });
  const confirm = (k: ItemKey, on: boolean) => patch({ confirmed: { ...rv.confirmed, [k]: on } });

  const valueCell = (i: JudgeItem) => {
    const v = finalOf(r, rv, i.key);
    if (i.key === 'shape' || i.key === 'mount') {
      const map = i.key === 'shape' ? SHAPE : MOUNT;
      return editable ? (
        <select className="in sm" value={typeof v === 'string' ? v : ''} aria-label={tt(ITEM[i.key])} data-testid={`judge-val-${i.key}`}
          onChange={(e) => setValue(i.key, e.target.value)}>
          <option value="" disabled>{t('— 请选 —', '— choose —')}</option>
          {Object.entries(map).map(([k, l]) => <option key={k} value={k}>{tt(l)}</option>)}
        </select>
      ) : <span>{typeof v === 'string' && map[v] ? tt(map[v]) : '—'}</span>;
    }
    if (i.key === 'ratio') return <span>{String(i.value ?? '—')}</span>;
    if (v === null && i.value === null) return <span style={{ color: 'var(--text2)' }}>—</span>;
    const typed = draft[i.key];
    return editable ? (
      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
        <input className="in sm tnum" type="number" step="any" style={{ width: 96 }} aria-label={tt(ITEM[i.key])} data-testid={`judge-val-${i.key}`}
          value={typed ?? String(v ?? '')} onChange={(e) => setDraft({ ...draft, [i.key]: e.target.value })}
          onBlur={() => {
            if (typed === undefined) return;
            const n = typed.trim() === '' ? null : Number(typed);
            if (n !== null && !(n >= 0)) { setError(t('须为非负数', 'Must be ≥ 0')); return; }
            if (n !== v) setValue(i.key, n);
          }} />
        <span style={{ fontSize: 12, color: 'var(--text2)' }}>{i.key === 'pitch_hint' ? 'mm' : i.unit}</span>
      </span>
    ) : <span className="tnum">{v ?? '—'} {i.unit}</span>;
  };

  const intentRef = rv.intent === 'ref';
  const kindTag = r.kind ? tt(KIND[r.kind]) : null;
  const dxfAsk = questions.find((q) => q.id === 'dxf');
  const readW = itemOf(r, 'led_opening_w')?.value;
  const readH = itemOf(r, 'led_opening_h')?.value;
  const viewM = s.view;
  const cheapest = judge.pitchOptions.filter((o) => meetsVd01(o.pitch, viewM)).sort((a, b) => a.rank - b.rank)[0]?.pitch ?? null;
  const drawn = finalOf(r, rv, 'pitch_hint');
  const isCurve = s.curve !== null || finalOf(r, rv, 'shape') === 'concave' || finalOf(r, rv, 'shape') === 'convex';

  const askInput = (k: string, unit: string, width = 100, placeholder = '') => (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <input className="in sm tnum" type="number" step="any" min="0" style={{ width }} disabled={!editable} data-testid={`judge-ask-${k}`}
        placeholder={placeholder} value={draft[`a_${k}`] ?? (rv.answers as Record<string, string>)[k] ?? ''}
        onChange={(e) => setDraft({ ...draft, [`a_${k}`]: e.target.value })}
        onBlur={() => { const v = draft[`a_${k}`]; if (v !== undefined && v !== ((rv.answers as Record<string, string>)[k] ?? '')) answer(k, v.trim()); }} />
      <span style={{ fontSize: 12, color: 'var(--text2)' }}>{unit}</span>
    </span>
  );
  const choice = (k: string, v: string, label: string) => {
    const on = (rv.answers as Record<string, string>)[k] === v;
    return (
      <button key={v} className={`chip${on ? ' active' : ''}`} style={{ height: 28 }} disabled={!editable} data-testid={`judge-ans-${k}-${v}`}
        onClick={() => answer(k, v)}>{label}</button>
    );
  };

  const askBody = (q: Ask) => {
    switch (q.id) {
      case 'size':
        return <>
          {t('宽', 'W')} {askInput('size_w', '', 100)} × {t('高', 'H')} {askInput('size_h', 'mm', 100)}
          {intentRef && typeof readW === 'number' && typeof readH === 'number' && editable && (
            <button className="btn-line sm" data-testid="judge-use-read-size"
              onClick={() => patch({ answers: { ...rv.answers, size_w: String(readW), size_h: String(readH) } })}>
              {t(`沿用图上尺寸 ${readW} × ${readH}`, `Use the picture's ${readW} × ${readH}`)}
            </button>
          )}
        </>;
      case 'arc':
        return <>{choice('arc', 'arc', t('弧长', 'Arc'))}{choice('arc', 'chord', t('弦长', 'Chord'))}{choice('arc', 'unknown', t('不知道，去现场量', 'Unknown — measure on site'))}</>;
      case 'rad':
        return <>{choice('radKind', 'radius', t('半径', 'Radius'))}{choice('radKind', 'rise', t('弧高（矢高）', 'Rise'))}{askInput('rad', 'mm')}</>;
      case 'view': {
        const est = itemOf(r, 'led_view_min');
        return askInput('view', 'm', 110, est?.estimated && est.value !== null ? t(`AI 估 ${est.value}`, `AI est. ${est.value}`) : '');
      }
      case 'mount_h':
        return askInput('mountH', 'mm', 110);
      case 'maint':
        return <>{choice('maint', 'rear', t('有，后维护', 'Yes — rear service'))}{choice('maint', 'front', t('没有，需前维护', 'No — front service'))}</>;
      case 'dist':
        return <>{t('控制室', 'Control room')} {askInput('ctrl', 'm', 80)} {t('配电箱', 'Power board')} {askInput('pwr', 'm', 80)}</>;
      default:
        return null;
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16 }} data-testid="judge-panel" ref={topRef}>
      {/* ── 它是什么 ── */}
      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head">
          <span className="panel-title">{t('03 · 它是什么', '03 · What it is')}
            {kindTag && <span style={{ ...tag, background: 'var(--hover-bg)', color: 'var(--navy700)' }} data-testid="judge-kind">{kindTag}</span>}
            {r.kind && <span style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 400 }}>{t(`把握 ${Math.round(r.kindConfidence * 100)}%`, `${Math.round(r.kindConfidence * 100)}% sure`)}</span>}
          </span>
          {engineBox}
        </div>
        <div style={{ padding: '16px 18px', display: 'grid', gridTemplateColumns: 'minmax(0,320px) minmax(0,1fr)', gap: 16 }}>
          <div>{thumb}{pagePicker}</div>
          <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
            {r.engine !== 'vision' && (
              <div style={box('danger')} data-testid="judge-fallback">
                <b>{fallbackText(judge, t)}</b>
                {r.engine === 'manual' && <div style={{ marginTop: 4 }}>{t('请在下面直接填写，流程不受影响。', 'Fill in below; the flow carries on.')}</div>}
                {judge.detail !== undefined && judge.detail && (
                  <div style={{ marginTop: 6, fontSize: 11.5, opacity: 0.8 }}>{t('技术细节（仅管理员可见）：', 'Detail (admins only): ')}{judge.detail}</div>
                )}
                {editable && judge.fallback !== 'bad_image' && (
                  <div style={{ marginTop: 8 }}><button className="btn-line sm" disabled={busy} onClick={() => rerun(judge.page)} data-testid="judge-rerun">{t('重新识别', 'Try again')}</button></div>
                )}
              </div>
            )}
            {r.engine === 'vision' && (
              <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '6px 10px', fontSize: 13 }}>
                <b style={{ color: 'var(--text2)' }}>{t('图片类型', 'Type')}</b>
                <span>{kindTag ?? '—'}<span style={ai}>{t('AI 判断', 'AI')}</span></span>
                <b style={{ color: 'var(--text2)' }}>{t('场景', 'Scene')}</b>
                <span>{[r.env === 'indoor' ? t('室内', 'Indoor') : r.env === 'outdoor' ? t('室外', 'Outdoor') : '', r.space, r.description].filter(Boolean).join(' · ') || '—'}<span style={ai}>{t('AI 判断', 'AI')}</span></span>
                {r.otherText.length > 0 && <><b style={{ color: 'var(--text2)' }}>{t('图上其他文字', 'Other text')}</b><span>{r.otherText.join(' · ')}</span></>}
              </div>
            )}
            {dxfAsk && <div style={box('warning')} data-testid="judge-dxf">{t(dxfAsk.zh, dxfAsk.en)}</div>}
            {r.kind === 'render' && !s.width && (
              <div style={box('warning')}>{t('图上没有任何尺寸。模型不会编造尺寸，请在下面补充，或上传施工图。', 'No dimensions on the picture. The model does not invent sizes — please add them below or upload a drawing.')}</div>
            )}
            <div style={{ fontWeight: 700, marginTop: 4 }}>{t('这张图的用途', 'What is this picture for')} <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text2)' }}>{t('（AI 先猜，请你确认）', '(AI guesses, you confirm)')}</span></div>
            <div style={{ display: 'grid', gap: 6 }}>
              {INTENTS.map(([v, label, desc]) => (
                <label key={v} data-testid={`judge-intent-${v}`} style={{ display: 'flex', gap: 8, padding: '7px 10px', borderRadius: 8, cursor: editable ? 'pointer' : 'default',
                  border: `1px solid ${rv.intent === v ? 'var(--navy700)' : 'var(--border)'}`, background: rv.intent === v ? 'var(--hover-bg)' : 'var(--card)' }}>
                  <input type="radio" name={`intent-${judge.id}`} checked={rv.intent === v} disabled={!editable} onChange={() => patch({ intent: v })} />
                  <span><b>{tt(label)}</b>{r.intentGuess === v && <span style={ai}>{t('AI 猜的', 'AI guess')}</span>}<br />
                    <span style={{ fontSize: 12, color: 'var(--text2)' }}>{tt(desc)}</span></span>
                </label>
              ))}
            </div>
            {r.intentWhy && <div style={{ fontSize: 12, color: 'var(--text2)' }}>{r.intentWhy}</div>}
          </div>
        </div>
      </div>

      {/* ── 读到的信息 ── */}
      <div className="panel clip" style={{ padding: 0 }}>
        <div className="panel-head">
          <span className="panel-title">{t('03 · 读到的信息', '03 · What was read')}</span>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>{t('全部是候选值，逐项确认后才能进入 05（C 级规则，把握度不超过 75%）', 'All candidates — confirm each before 05 (C-grade: at most 75% sure)')}</span>
        </div>
        {r.ocr.length > 0 && (
          <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--row-line)' }} data-testid="judge-ocr">
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{t('文字识别读到的数字', 'Numbers found by OCR')}</div>
            <table style={{ borderCollapse: 'collapse', fontSize: 13 }}><tbody>
              <tr><th style={th}>{t('图上文字', 'Text')}</th><th style={th}>{t('这是什么？', 'What is it?')}</th></tr>
              {r.ocr.map((o, i) => {
                const cur = o.mm !== null && String(o.mm) === rv.answers.size_w ? 'w' : o.mm !== null && String(o.mm) === rv.answers.size_h ? 'h' : '';
                return (
                  <tr key={i}><td style={td}>{o.text}</td><td style={td}>
                    {o.mm === null ? <span style={{ color: 'var(--text2)' }}>{t('不是尺寸', 'Not a size')}</span> : (
                      <select className="in sm" value={cur} disabled={!editable} data-testid={`judge-ocr-${i}`}
                        onChange={(e) => {
                          const a = { ...rv.answers };
                          if (a.size_w === String(o.mm)) delete a.size_w;
                          if (a.size_h === String(o.mm)) delete a.size_h;
                          if (e.target.value === 'w') a.size_w = String(o.mm);
                          if (e.target.value === 'h') a.size_h = String(o.mm);
                          patch({ answers: a });
                        }}>
                        <option value="">{t('不是尺寸', 'Not a size')}</option>
                        <option value="w">{t('屏宽', 'Width')}</option>
                        <option value="h">{t('屏高', 'Height')}</option>
                      </select>
                    )} {o.mm !== null && <span style={{ fontSize: 12, color: 'var(--text2)' }}>= {o.mm} mm</span>}
                  </td></tr>
                );
              })}
            </tbody></table>
          </div>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 820 }}>
            <tbody>
              <tr>{[t('要素', 'Item'), t('读到的值', 'Value'), t('来源', 'Source'), t('把握', 'Confidence'), t('确认', 'Confirm')].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
              {r.items.map((i) => {
                const needs = confirmable.has(i.key);
                const done = !!rv.confirmed[i.key];
                const [fg, zh, en] = conf(i.confidence);
                const refSize = intentRef && (i.key === 'led_opening_w' || i.key === 'led_opening_h') && i.value !== null;
                return (
                  <tr key={i.key} data-testid={`judge-row-${i.key}`} style={{ background: needs && !done ? 'var(--warning-bg, #FDF7F1)' : undefined }}>
                    <td style={td}><b>{tt(ITEM[i.key])}</b>
                      {i.key === 'led_opening_w' && isCurve && <div style={{ fontSize: 11.5, color: 'var(--warning)' }}>⚠ {t('弧形屏：这个宽是弦长还是弧长，下面要回答', 'Curved: is this the chord or the arc? Answer below')}</div>}
                      {refSize && <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>{t('参考图上的尺寸，仅供参考', "The reference picture's size, for reference only")}</div>}
                    </td>
                    <td style={td}>{valueCell(i)}{i.estimated && i.value !== null && <span style={{ ...tag, background: 'var(--warning-bg, #FDF7F1)', color: 'var(--warning)', marginLeft: 6 }} data-testid={`judge-est-${i.key}`}>{t('估', 'est.')}</span>}</td>
                    <td style={{ ...td, fontSize: 12, color: 'var(--text2)', maxWidth: 320 }}>
                      {i.dropped ? <span style={{ color: 'var(--warning)' }}>⚠ {i.dropped}</span>
                        : i.key in rv.values && rv.values[i.key] !== i.value ? t('人工修改', 'Changed by hand')
                          : i.source || (i.raw ? t(`读自「${i.raw}」`, `Read from "${i.raw}"`) : (i.value === null ? t('图上看不出', 'Not on the picture') : ''))}
                    </td>
                    <td style={td}>{i.value !== null && <span style={{ ...tag, color: fg, border: `1px solid ${fg}` }} className="tnum">{lang === 'zh' ? zh : en} {Math.round(i.confidence * 100)}%</span>}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {!needs ? <span style={{ color: 'var(--text2)' }}>—</span>
                        : done ? <span style={{ color: 'var(--success)' }}>{t('已确认', 'Confirmed')}{editable && <button style={{ marginLeft: 6, fontSize: 11, color: 'var(--text2)', textDecoration: 'underline' }} onClick={() => confirm(i.key, false)}>{t('撤销', 'undo')}</button>}</span>
                          : editable ? <button className="btn-line sm" data-testid={`judge-ok-${i.key}`} onClick={() => confirm(i.key, true)}>{t('确认', 'Confirm')}</button>
                            : <span style={{ color: 'var(--warning)' }}>{t('待确认', 'Pending')}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 还缺什么 ── */}
      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head"><span className="panel-title">{t('还缺什么', 'What is missing')} <span style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 400 }}>{t('（系统按规则表自动列出，不是 AI 列的）', '(listed by a fixed rule table, not by the AI)')}</span></span></div>
        <div style={{ padding: '14px 18px', display: 'grid', gap: 8 }} data-testid="judge-asks">
          {questions.filter((q) => q.id !== 'dxf').map((q) => (
            <div key={q.id} data-testid={`judge-q-${q.id}`} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', background: 'var(--card)' }}>
              <b style={{ display: 'block', marginBottom: 6 }}>{t(q.zh, q.en)}</b>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>{askBody(q)}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 4 }}>{t(q.whyZh, q.whyEn)}</div>
            </div>
          ))}
          {!questions.filter((q) => q.id !== 'dxf').length && <div style={{ fontSize: 13, color: 'var(--text2)' }}>{t('没有要补充的。', 'Nothing missing.')}</div>}
        </div>
      </div>

      {/* ── 方案建议 ── */}
      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head"><span className="panel-title">{t('方案建议', 'Suggestion')} <span style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 400 }}>{t('（由计算内核按规则给出，不是 AI 给的）', '(from the kernel’s rules, not from the AI)')}</span></span></div>
        <div style={{ padding: '14px 18px', display: 'grid', gap: 10 }}>
          <div style={{ fontWeight: 700 }}>{t('点间距', 'Pixel pitch')}</div>
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>
            {viewM !== null
              ? t(`规则 LED-VD-01：点间距(mm) ≤ 最近观看距离(m)。最近观看距离 ${viewM} m → 可选 ≤ P${viewM}。`, `LED-VD-01: pitch (mm) ≤ viewing distance (m). ${viewM} m → up to P${viewM}.`)
              : t('先填「最近观看距离」，系统才能按规则筛点间距。', 'Enter the viewing distance first so the rule can filter pitches.')}
          </div>
          {typeof drawn === 'number' && (
            <div style={box(viewM !== null && !meetsVd01(drawn, viewM) ? 'danger' : 'success')} data-testid="judge-drawn-pitch">
              {t(`图上写明点间距 P${drawn}，以图为准。`, `The picture states P${drawn}; it takes precedence.`)}{' '}
              {viewM === null ? t('填了最近观看距离后校验是否满足 LED-VD-01。', 'Checked against LED-VD-01 once the viewing distance is in.')
                : meetsVd01(drawn, viewM) ? t(`满足 LED-VD-01（${viewM} m ≥ ${drawn}）。`, `Meets LED-VD-01 (${viewM} m ≥ ${drawn}).`)
                  : t(`不满足 LED-VD-01：最近观看距离 ${viewM} m 小于 ${drawn}，近距离会看到颗粒。`, `Fails LED-VD-01: ${viewM} m < ${drawn}; pixels visible up close.`)}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} data-testid="judge-pitches">
            {judge.pitchOptions.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>{r.env === 'outdoor' ? t('价格库里还没有室外型号。', 'No outdoor products in the price library yet.') : t('价格库里还没有 LED 型号，先到价格库导入。', 'No LED products in the price library yet.')}</span>}
            {judge.pitchOptions.map((o) => {
              const ok = meetsVd01(o.pitch, viewM);
              const on = s.pitch !== null && Math.abs(s.pitch - o.pitch) < 1e-9;
              return (
                <button key={o.pitch} data-testid={`judge-pitch-${o.pitch}`} disabled={!ok || !editable}
                  title={ok ? '' : t('不满足最近观看距离', 'Fails the viewing distance')}
                  onClick={() => patch({ pitch: o.pitch })}
                  style={{ textAlign: 'left', minWidth: 120, padding: '8px 12px', borderRadius: 8, cursor: ok && editable ? 'pointer' : 'not-allowed', opacity: ok ? 1 : 0.45,
                    border: `1px solid ${on ? 'var(--navy700)' : 'var(--border)'}`, background: on ? 'var(--hover-bg)' : 'var(--card)', boxShadow: on ? '0 0 0 1px var(--navy700) inset' : undefined }}>
                  <b>{o.label}</b>
                  <small style={{ display: 'block', color: 'var(--text2)' }}>
                    {!ok ? t('不满足观看距离', 'Too coarse') : o.pitch === cheapest && viewM !== null ? t('满足规则中最省的', 'Cheapest that meets the rule') : t('满足规则', 'Meets the rule')}
                    {' · '}{t(`${o.items} 个型号`, `${o.items} products`)}
                  </small>
                </button>
              );
            })}
          </div>
          {(s.snap.w.length > 0 || s.snap.h.length > 0) && (
            <div style={box('warning')} data-testid="judge-snap">
              <div>{t(`05 按整模组（${judge.mod[0]} × ${judge.mod[1]} mm）排箱体，请选取整后的尺寸：`, `05 tiles whole modules (${judge.mod[0]} × ${judge.mod[1]} mm); pick the rounded size:`)}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
                {s.snap.w.length > 0 && <>{t(`宽 ${s.tileWidth} →`, `W ${s.tileWidth} →`)} {s.snap.w.map((v) => <button key={v} className="btn-line sm" disabled={!editable} data-testid={`judge-snapw-${v}`} onClick={() => answer('snapW', String(v))}>{v}</button>)}</>}
                {s.snap.h.length > 0 && <>{t(`高 ${s.height} →`, `H ${s.height} →`)} {s.snap.h.map((v) => <button key={v} className="btn-line sm" disabled={!editable} data-testid={`judge-snaph-${v}`} onClick={() => answer('snapH', String(v))}>{v}</button>)}</>}
              </div>
            </div>
          )}
          {isCurve && (
            <div style={box('warning')} data-testid="judge-curve">
              {t('弧形屏：05 方案配置按弧长平铺排箱体、算功耗和线材；弧形箱体 / 柔性模组与弧形钢结构的费用，在 06 成本核算里单独列一项「待询价」。',
                'Curved screen: 05 tiles along the arc length for cabinets, power and cables; curved cabinets / flexible modules and curved steel get their own "to be quoted" line in 06.')}
              {s.curve && s.curve.given === 'chord' && <div style={{ marginTop: 4 }} className="tnum">{t(`弦长 ${s.curve.width} mm → 弧长 ${s.curve.arc} mm（确定性换算）`, `Chord ${s.curve.width} mm → arc ${s.curve.arc} mm (computed)`)}</div>}
            </div>
          )}
          <div style={{ fontWeight: 700, marginTop: 4 }}>{t('类似的历史案例', 'Similar past cases')} <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text2)' }}>{t('（从「资料库 › 历史案例」按面积、点间距、形状找）', '(from the case library by area, pitch and shape)')}</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: 8 }} data-testid="judge-cases">
            {judge.cases.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>{t('没有找到面积相近的案例。', 'No case of a similar size.')}</span>}
            {judge.cases.map((c, i) => (
              <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 12, background: 'var(--card)' }}>
                <b>{c.name}</b>{c.client ? ` · ${c.client}` : ''}<br />
                {[c.pitch !== null ? `P${c.pitch}` : '', c.widthMm && c.heightMm ? `${c.widthMm} × ${c.heightMm}` : '', c.curved ? t('弧形', 'curved') : '',
                  c.status === 'completed' ? t('已完成', 'completed') : t('进行中', 'ongoing')].filter(Boolean).join(' · ')}
              </div>
            ))}
          </div>
        </div>

        {/* ── gate ── */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '12px 18px', borderTop: '1px solid var(--border)', background: 'var(--hover-bg)', borderRadius: '0 0 12px 12px' }}>
          <div style={{ flex: 1, fontSize: 12.5 }} data-testid="judge-gate">
            {handed ? (
              <span style={{ color: 'var(--success)' }}>{t(`已由 ${judge.handedBy} 确认并带入 05（${fmtDate(new Date(judge.handedAt))}），每个值都标「来自图片 · 已人工确认」。`,
                `Confirmed into 05 by ${judge.handedBy}; every value is marked "from the picture · confirmed".`)}</span>
            ) : judge.gate?.ok ? (
              <span style={{ color: 'var(--success)' }}>{t('可以进入 05。', 'Ready for 05.')}</span>
            ) : (
              <span style={{ color: 'var(--warning)' }}>
                {pending > 0 && <b>{t(`还有 ${pending} 项未确认。`, `${pending} item(s) to confirm. `)}</b>}
                {(judge.gate?.reasons ?? []).filter((x) => !x.startsWith('还有')).join('；')}
              </span>
            )}
          </div>
          {handed ? (
            <button className="btn-navy" onClick={open05} data-testid="judge-open05">{t('打开 05 方案配置', 'Open 05')}</button>
          ) : mayReview ? (
            <button className="btn-navy" disabled={busy || !judge.gate?.ok} data-testid="judge-handoff" onClick={handoff}
              style={busy || !judge.gate?.ok ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}>
              {t('带入 05 方案配置（草案）', 'Open as a 05 draft')}
            </button>
          ) : <span style={{ fontSize: 12, color: 'var(--text2)' }}>{t('由项目 PM 确认', 'The project PM confirms')}</span>}
        </div>
      </div>
      {error && <div style={box('danger')} data-testid="judge-error">{error}</div>}
    </div>
  );
}

const tag: React.CSSProperties = { display: 'inline-block', padding: '1px 8px', borderRadius: 10, fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap' };
const ai: React.CSSProperties = { fontSize: 11, color: '#5b21b6', fontWeight: 600, marginLeft: 6 };
const box = (k: 'danger' | 'warning' | 'success'): React.CSSProperties => ({
  fontSize: 12.5, lineHeight: 1.7, padding: '9px 12px', borderRadius: 8,
  background: k === 'danger' ? 'var(--danger-bg, #FDF0EC)' : k === 'warning' ? 'var(--warning-bg, #FDF7F1)' : 'var(--success-bg, #E4EFE9)',
  color: k === 'danger' ? 'var(--danger)' : k === 'warning' ? 'var(--warning)' : 'var(--success)',
});
const th: React.CSSProperties = {
  padding: '9px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
  color: 'var(--text2)', background: 'var(--hover-bg)', textAlign: 'left', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { padding: '9px 12px', borderTop: '1px solid var(--row-line)', verticalAlign: 'top' };
