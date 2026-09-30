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
  /* AV-016 ②:还没存成正式版本的自动草稿(没有就是 null) */
  draft: { cfg: C; drawingId: number | null; updatedBy: string; updatedAt: number } | null;
}

const EMPTY = { loaded: false, cfg: null, drawingId: null, packVersion: null, version: 0, canSave: false, draft: null };

export function useSavedConfig<C>(projectId: string | undefined, line: string) {
  const [s, setS] = useState<SavedConfig<C>>(EMPTY);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setS(EMPTY);
    if (!projectId) return;
    let live = true;
    fetch(`/api/av/config?project=${encodeURIComponent(projectId)}&line=${line}`).then((r) => r.json()).then((b) => {
      if (!live) return;
      setS({ loaded: true, cfg: (b.config?.cfg as C) ?? null, drawingId: b.config?.drawingId ?? null,
        packVersion: b.config?.packVersion ?? null, version: Number(b.version) || 0, canSave: !!b.canSave,
        draft: b.draft ?? null });
    }).catch(() => { if (live) setS({ ...EMPTY, loaded: true }); });
    return () => { live = false; };
  }, [projectId, line, tick]);
  const reload = useCallback(() => setTick((x) => x + 1), []);
  /* 存成功后直接记下,不必再问一次 */
  const markSaved = useCallback((cfg: C, version: number) => setS((cur) => ({ ...cur, cfg, version })), []);
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
   停手 1.2 秒就把当前参数存成这条线的草稿(只有能存方案的人才存);和正式版本
   一样了就把草稿删掉。返回最近一次存草稿的时间,页面上显示「草稿已自动保存 · 19:40」。 */
export function useAutoDraft(opts: {
  projectId: string | undefined; line: string; payload: unknown; drawingId: number | null;
  enabled: boolean; dirty: boolean; hadDraft: boolean;
  ready: boolean;   // 页面已经把正式版本 / 草稿载入完了;之前的变化不算人改的
}) {
  const { projectId, line, payload, drawingId, enabled, dirty, hadDraft, ready } = opts;
  const [state, setState] = useState<{ at: number; by: string; error: string } | null>(null);
  const exists = useRef(hadDraft);
  useEffect(() => { exists.current = hadDraft; }, [hadDraft, projectId, line]);
  const json = JSON.stringify(payload);
  /* 载入完那一刻的参数:只是打开看一眼,不存草稿(否则「最后改的人」就成了看的人) */
  const base = useRef<string | null>(null);
  useEffect(() => { base.current = ready ? json : null; }, [ready, projectId, line]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!enabled || !projectId || !ready || json === base.current) return;
    const timer = setTimeout(async () => {
      base.current = json;
      if (!dirty) {
        if (!exists.current) return;
        await fetch(`/api/av/config/draft?project=${encodeURIComponent(projectId)}&line=${line}`, { method: 'DELETE' }).catch(() => null);
        exists.current = false;
        setState(null);
        return;
      }
      const res = await fetch('/api/av/config/draft', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, line, cfg: payload, drawingId }),
      }).catch(() => null);
      const b = res ? await res.json().catch(() => ({})) : { error: '网络错误' };
      if (res?.ok && b.draft) { exists.current = true; setState({ at: b.draft.updatedAt, by: b.draft.updatedBy, error: '' }); }
      else setState((cur) => ({ at: cur?.at ?? 0, by: cur?.by ?? '', error: b.error || '草稿没存上' }));
    }, 1200);
    return () => clearTimeout(timer);
  }, [json, dirty, enabled, projectId, line, drawingId, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const reset = useCallback(() => { exists.current = false; setState(null); }, []);
  return { draftState: state, resetDraft: reset };
}
