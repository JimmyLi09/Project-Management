'use client';

/* ===== AV-017 · 05 打开时载入这条线的正式版本 =====
   原来 05 每次打开都是出厂默认值,存过的方案看不到,改没改也无从谈起。现在
   按「项目 + 业务线」取最新正式版本:页面拿它当起点,外框拿它判断「下一步」
   要不要弹窗保存。 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface SavedConfig<C> {
  loaded: boolean;           // 这个项目这条线已经问过服务器了
  failed: boolean;           // 问了但没取到(网络 / 服务器错误):别自动存草稿,免得拿默认值盖掉真草稿
  cfg: C | null;             // 最新正式版本的参数;null = 还没存过
  drawingId: number | null;
  packVersion: string | null;
  version: number;           // 已存了几版(下一版是 version + 1)
  canSave: boolean;
  savedBy: string;           // 最新正式版本谁、什么时候存的
  savedAt: number;
  /* AV-016 ②:我自己还没存成正式版本的自动草稿(没有就是 null);草稿每人一份 */
  draft: { cfg: C; drawingId: number | null; updatedBy: string; updatedAt: number } | null;
  /* 别人的草稿:只提示「Skye 有未保存的草稿」,不载入 */
  others: { by: string; at: number }[];
}

const EMPTY = { loaded: false, failed: false, cfg: null, drawingId: null, packVersion: null, version: 0, canSave: false, savedBy: '', savedAt: 0, draft: null, others: [] };

export function useSavedConfig<C>(projectId: string | undefined, line: string) {
  const key = `${projectId}|${line}`;
  /* 状态里记着它是哪个项目哪条线的:换项目那一次渲染里,旧项目的数据不能冒充新项目「已载入」
     (否则 05 的初始化会把 A 的方案当成 B 的载进来,随后自动草稿 / 下一步把它存进 B) */
  const [s, setS] = useState<SavedConfig<C> & { key: string }>({ ...EMPTY, key: '' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    fetch(`/api/av/config?project=${encodeURIComponent(projectId)}&line=${line}`)
      .then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b?.error || String(r.status)); return b; })
      .then((b) => {
        if (!live) return;
        setS({ key, loaded: true, failed: false, cfg: (b.config?.cfg as C) ?? null, drawingId: b.config?.drawingId ?? null,
          packVersion: b.config?.packVersion ?? null, version: Number(b.version) || 0, canSave: !!b.canSave,
          savedBy: b.config?.createdBy ?? '', savedAt: Number(b.config?.createdAt) || 0,
          draft: b.draft ?? null, others: Array.isArray(b.others) ? b.others : [] });
      })
      /* 同一条线 reload 失败:保留已有的;第一次就失败:标 failed */
      .catch(() => { if (live) setS((cur) => (cur.key === key ? cur : { ...EMPTY, key, loaded: true, failed: true })); });
    return () => { live = false; };
  }, [projectId, line, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(() => setTick((x) => x + 1), []);
  /* 存成功后直接记下,不必再问一次 */
  const markSaved = useCallback((cfg: C, version: number) =>
    setS((cur) => ({ ...cur, cfg, version, savedAt: Date.now(), draft: null })), []);
  const cur: SavedConfig<C> = s.key === key ? s : EMPTY;
  return { ...cur, reload, markSaved };
}

/* 比较两份参数是否相同:键排序、去掉 undefined */
export function sameConfig(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, x]) => [k, norm(x)]));
    }
    return v;
  };
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/* ===== AV-016 ② · 05 自动保存草稿 =====
   停手 1.5 秒就把当前参数存成这条线上「我」的草稿(只有能存方案的人才存);和正式版本
   一样了就把草稿删掉。还没来得及存就切走(换项目 / 换页 / 关浏览器)的,当场补发一次;
   补发也发不出去(断网)或上一次没存上时,关浏览器会弹「有未保存的改动」。

   和正式保存的先后(复查 #68):
   - 草稿带上「基于第几版」(base)。服务器发现这一版之后又是我自己存了正式版本,就不再存
     这份草稿 —— 正式保存时还在路上的那一次,不会把刚清掉的草稿又写回去;
   - 正式保存前 cancel():排队的那一次作废,已经发出去的回来也不认(gen);
   - 存完 reset(存下去的那份参数):以它为基准,保存期间又改的照样会存成草稿。 */
type Req = { url: string; init: RequestInit };
export function useAutoDraft(opts: {
  projectId: string | undefined; line: string; payload: unknown; drawingId: number | null;
  enabled: boolean; dirty: boolean; hadDraft: boolean;
  version: number;  // 页面上的正式版本号(草稿基于它)
  ready: boolean;   // 页面已经把正式版本 / 草稿载入完了;之前的变化不算人改的
}) {
  const { projectId, line, payload, drawingId, enabled, dirty, hadDraft, version, ready } = opts;
  const [state, setState] = useState<{ at: number; by: string; error: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [cleared, setCleared] = useState(false);   // 我的草稿已经没了(改回和正式版本一样 / 放弃 / 存成正式版本)
  const [tick, setTick] = useState(0);
  const exists = useRef(hadDraft);
  const latest = useRef('');
  const pending = useRef<Req | null>(null);   // 排着队、还没发出去的那一次
  const failed = useRef(false);               // 上一次没存上
  const gen = useRef(0);                      // 换项目 / 换线 / reset / cancel 之后,旧请求的回音一律不认
  useEffect(() => { exists.current = hadDraft; }, [hadDraft, projectId, line]);
  useEffect(() => { gen.current++; setState(null); setCleared(false); }, [projectId, line]);
  const json = JSON.stringify(payload);
  latest.current = json;
  /* 载入完那一刻的参数:只是打开看一眼,不存草稿(否则「最后改的人」就成了看的人) */
  const base = useRef<string | null>(null);
  useEffect(() => { base.current = ready ? json : null; }, [ready, projectId, line]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 切走时把排着队的那一次立刻发出去(keepalive:页面关了也会发完) */
  const flush = useCallback(() => {
    const r = pending.current;
    if (!r) return false;
    pending.current = null;
    fetch(r.url, { ...r.init, keepalive: true }).catch(() => null);
    return true;
  }, []);
  useEffect(() => () => { flush(); }, [projectId, line, flush]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      const queued = flush();
      if (failed.current || (queued && typeof navigator !== 'undefined' && !navigator.onLine)) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [flush]);

  useEffect(() => {
    if (!enabled || !projectId || !ready || json === base.current) { pending.current = null; setSaving(false); return; }
    const req: Req | null = dirty
      ? { url: '/api/av/config/draft', init: { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, line, cfg: payload, drawingId, base: version }) } }
      : exists.current ? { url: `/api/av/config/draft?project=${encodeURIComponent(projectId)}&line=${line}`, init: { method: 'DELETE' } } : null;
    if (!req) { base.current = json; pending.current = null; setSaving(false); return; }
    pending.current = req;
    setSaving(true);
    const g = gen.current;
    const timer = setTimeout(async () => {
      if (pending.current !== req) return;
      pending.current = null;
      base.current = json;
      const res = await fetch(req.url, req.init).catch(() => null);
      const b = res ? await res.json().catch(() => ({})) : { error: '网络错误' };
      if (g !== gen.current) return;   // 已经换了项目 / 存了正式版本:这次的结果作废
      if (res?.ok && req.init.method === 'DELETE') { exists.current = false; failed.current = false; setState(null); setCleared(true); }
      else if (res?.ok && b.draft) { exists.current = true; failed.current = false; setCleared(false); setState({ at: b.draft.updatedAt, by: b.draft.updatedBy, error: '' }); }
      else if (res?.ok) { failed.current = false; }   // 服务器认为已被我的正式版本取代,不存
      else {
        failed.current = true;
        if (!pending.current) pending.current = req;   // 关页面时再试一次
        setState((cur) => ({ at: cur?.at ?? 0, by: cur?.by ?? '', error: b.error || '草稿没存上' }));
      }
      setSaving(!!pending.current && pending.current !== req);
    }, 1500);
    return () => clearTimeout(timer);
  }, [json, dirty, enabled, projectId, line, drawingId, ready, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  /* 正式保存之前:排队的作废,在路上的回来也不认 */
  const cancel = useCallback(() => { gen.current++; pending.current = null; setSaving(false); }, []);
  /* 刚存成正式版本 / 放弃了草稿:以存下去的那份参数为基准(不传就用当前的);
     保存期间又改了的,和基准不一样,照样会存成草稿 */
  const reset = useCallback((saved?: unknown) => {
    gen.current++;
    exists.current = false; failed.current = false; pending.current = null;
    base.current = saved !== undefined ? JSON.stringify(saved) : latest.current;
    setState(null); setSaving(false); setCleared(true);
    setTick((x) => x + 1);
  }, []);
  return { draftState: state, draftSaving: saving, draftCleared: cleared, cancelDraft: cancel, resetDraft: reset };
}
