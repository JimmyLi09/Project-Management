'use client';

/* ===== AV-017 · 05 打开时载入这条线的正式版本 =====
   原来 05 每次打开都是出厂默认值,存过的方案看不到,改没改也无从谈起。现在
   按「项目 + 业务线」取最新正式版本:页面拿它当起点,外框拿它判断「下一步」
   要不要弹窗保存。 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface SavedConfig<C> {
  loaded: boolean;           // 这个项目这条线已经问过服务器了
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

const EMPTY = { loaded: false, cfg: null, drawingId: null, packVersion: null, version: 0, canSave: false, savedBy: '', savedAt: 0, draft: null, others: [] };

export function useSavedConfig<C>(projectId: string | undefined, line: string) {
  const [s, setS] = useState<SavedConfig<C>>(EMPTY);
  const [tick, setTick] = useState(0);
  const keyRef = useRef('');
  useEffect(() => {
    /* 换项目 / 换线才清空;同一条线的 reload 保留旧值直到新值回来 ——
       清空的那一瞬 dirty 会变 true,自动草稿就可能把刚被正式保存清掉的草稿又存回去 */
    const key = `${projectId}|${line}`;
    if (keyRef.current !== key) { keyRef.current = key; setS(EMPTY); }
    if (!projectId) return;
    let live = true;
    fetch(`/api/av/config?project=${encodeURIComponent(projectId)}&line=${line}`).then((r) => r.json()).then((b) => {
      if (!live) return;
      setS({ loaded: true, cfg: (b.config?.cfg as C) ?? null, drawingId: b.config?.drawingId ?? null,
        packVersion: b.config?.packVersion ?? null, version: Number(b.version) || 0, canSave: !!b.canSave,
        savedBy: b.config?.createdBy ?? '', savedAt: Number(b.config?.createdAt) || 0,
        draft: b.draft ?? null, others: Array.isArray(b.others) ? b.others : [] });
    }).catch(() => { if (live) setS({ ...EMPTY, loaded: true }); });
    return () => { live = false; };
  }, [projectId, line, tick]);
  const reload = useCallback(() => setTick((x) => x + 1), []);
  /* 存成功后直接记下,不必再问一次 */
  const markSaved = useCallback((cfg: C, version: number) => setS((cur) => ({ ...cur, cfg, version, savedAt: Date.now(), draft: null })), []);
  return { ...s, reload, markSaved };
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
   补发也发不出去(断网)或上一次没存上时,关浏览器会弹「有未保存的改动」。 */
type Req = { url: string; init: RequestInit };
export function useAutoDraft(opts: {
  projectId: string | undefined; line: string; payload: unknown; drawingId: number | null;
  enabled: boolean; dirty: boolean; hadDraft: boolean;
  ready: boolean;   // 页面已经把正式版本 / 草稿载入完了;之前的变化不算人改的
}) {
  const { projectId, line, payload, drawingId, enabled, dirty, hadDraft, ready } = opts;
  const [state, setState] = useState<{ at: number; by: string; error: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const exists = useRef(hadDraft);
  const latest = useRef('');
  const pending = useRef<Req | null>(null);   // 排着队、还没发出去的那一次
  const failed = useRef(false);               // 上一次没存上
  useEffect(() => { exists.current = hadDraft; }, [hadDraft, projectId, line]);
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
      ? { url: '/api/av/config/draft', init: { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, line, cfg: payload, drawingId }) } }
      : exists.current ? { url: `/api/av/config/draft?project=${encodeURIComponent(projectId)}&line=${line}`, init: { method: 'DELETE' } } : null;
    if (!req) { base.current = json; pending.current = null; setSaving(false); return; }
    pending.current = req;
    setSaving(true);
    const timer = setTimeout(async () => {
      if (pending.current !== req) return;
      pending.current = null;
      base.current = json;
      const res = await fetch(req.url, req.init).catch(() => null);
      const b = res ? await res.json().catch(() => ({})) : { error: '网络错误' };
      if (res?.ok && req.init.method === 'DELETE') { exists.current = false; failed.current = false; setState(null); }
      else if (res?.ok && b.draft) { exists.current = true; failed.current = false; setState({ at: b.draft.updatedAt, by: b.draft.updatedBy, error: '' }); }
      else {
        failed.current = true;
        if (!pending.current) pending.current = req;   // 关页面时再试一次
        setState((cur) => ({ at: cur?.at ?? 0, by: cur?.by ?? '', error: b.error || '草稿没存上' }));
      }
      setSaving(!!pending.current && pending.current !== req);
    }, 1500);
    return () => clearTimeout(timer);
  }, [json, dirty, enabled, projectId, line, drawingId, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  /* 刚存成正式版本 / 放弃了草稿:当前参数就是新的基准,别再为它存草稿 */
  const reset = useCallback(() => {
    exists.current = false; failed.current = false; pending.current = null; base.current = latest.current; setState(null); setSaving(false);
  }, []);
  return { draftState: state, draftSaving: saving, resetDraft: reset };
}
