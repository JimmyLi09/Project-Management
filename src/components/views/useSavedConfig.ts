'use client';

/* ===== AV-017 · 05 打开时载入这条线的正式版本 =====
   原来 05 每次打开都是出厂默认值,存过的方案看不到,改没改也无从谈起。现在
   按「项目 + 业务线」取最新正式版本:页面拿它当起点,外框拿它判断「下一步」
   要不要弹窗保存。 */

import { useCallback, useEffect, useState } from 'react';

export interface SavedConfig<C> {
  loaded: boolean;           // 这个项目这条线已经问过服务器了
  cfg: C | null;             // 最新正式版本的参数;null = 还没存过
  drawingId: number | null;
  packVersion: string | null;
  version: number;           // 已存了几版(下一版是 version + 1)
  canSave: boolean;
}

const EMPTY = { loaded: false, cfg: null, drawingId: null, packVersion: null, version: 0, canSave: false };

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
        packVersion: b.config?.packVersion ?? null, version: Number(b.version) || 0, canSave: !!b.canSave });
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
