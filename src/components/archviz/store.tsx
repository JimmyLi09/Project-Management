'use client';

/* ===== AI ArchViz Director — Model-Direct: client store backed by the real
   API (src/app/api/archviz/**) =====
   Sibling to LangProvider (src/lib/i18n.tsx), not wired into the project/user
   StoreProvider (src/components/store.tsx) — this feature has its own
   backend (a separate archviz.db) and no permission-system hook, matching
   the Phase-1 plan's "self-contained module" decision. All fabrication
   (mockData.generateShots/newModel) is gone — a real upload creates a real
   `models` row, a real analysis run queues real render_jobs that a real
   worker process (scripts/archviz/stub-worker.mjs today, dcc-scripts/ once
   deployed) fulfills over HTTP, and this store just polls server state. */

import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import type {
  AnalysisRun, ArchModel, ArchvizScreen, DesignerActionType, DesignerLabel, RunStage, Shot,
} from '@/lib/archviz/types';
import { RUN_STAGES } from '@/lib/archviz/types';

interface ArchvizStore {
  screen: ArchvizScreen;
  shots: Shot[];
  activeShotId?: string;
  compareIds: string[];
  error?: string;
  busy: boolean;

  activeRun?: AnalysisRun;
  activeModel?: ArchModel;
  runShots: Shot[]; // sorted by rank
  boardShots: Shot[]; // runShots deduped to the best-scoring shot per camGroup
  activeShot?: Shot;

  startAnalysis: (file: File, name: string, presetIds: string[]) => Promise<void>;
  goNew: () => void;
  goBoard: () => void;
  openDetail: (shotId: string) => void;
  goCompare: (ids?: string[]) => void;
  toggleCompareSelect: (shotId: string) => void;
  clearCompare: () => void;

  setFavorite: (shotId: string, val: boolean) => void;
  setLabel: (shotId: string, label: Exclude<DesignerLabel, 'none'>) => void;
  requestRecapture: (shotId: string) => void;
  logAction: (shotId: string, type: DesignerActionType) => void;
  variantsOf: (camGroup: string) => Shot[];
}

const Ctx = createContext<ArchvizStore | null>(null);
export const useArchviz = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('archviz store missing');
  return s;
};

const LABEL_TO_ACTION: Record<Exclude<DesignerLabel, 'none'>, DesignerActionType> = {
  promoted: 'promote', demoted: 'demote', rejected: 'reject', hero: 'mark_hero',
};

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return body.error || `请求失败 (${res.status})`;
}

export function ArchvizProvider({ children }: { children: React.ReactNode }) {
  const [screen, setScreen] = useState<ArchvizScreen>('new');
  const [model, setModel] = useState<ArchModel>();
  const [run, setRun] = useState<AnalysisRun>();
  const [shots, setShots] = useState<Shot[]>([]);
  const [activeShotId, setActiveShotId] = useState<string>();
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = undefined; }
  }, []);

  const startPolling = useCallback((runId: string) => {
    stopPolling();
    const tick = async () => {
      try {
        const [runRes, shotsRes] = await Promise.all([
          fetch(`/api/archviz/runs/${runId}`),
          fetch(`/api/archviz/runs/${runId}/shots`),
        ]);
        if (runRes.ok) {
          const { run: r } = await runRes.json();
          setRun(r);
          if (r.stage === 'completed') stopPolling();
        }
        if (shotsRes.ok) {
          const { shots: s } = await shotsRes.json();
          setShots(s);
        }
      } catch {
        // transient network hiccup — next tick retries; don't stop polling
      }
    };
    tick();
    pollTimer.current = setInterval(tick, 1000);
  }, [stopPolling]);

  useEffect(() => stopPolling, [stopPolling]);

  const startAnalysis = useCallback(async (file: File, name: string, presetIds: string[]) => {
    setError(undefined);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('name', name);
      const modelRes = await fetch('/api/archviz/models', { method: 'POST', body: form });
      if (!modelRes.ok) throw new Error(await readError(modelRes));
      const { model: newModel } = await modelRes.json() as { model: ArchModel };

      const runRes = await fetch('/api/archviz/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: newModel.id, lightingPresetIds: presetIds }),
      });
      if (!runRes.ok) throw new Error(await readError(runRes));
      const { run: newRun } = await runRes.json() as { run: AnalysisRun };

      setModel(newModel);
      setRun(newRun);
      setShots([]);
      setScreen('progress');
      startPolling(newRun.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [startPolling]);

  const goNew = useCallback(() => { setScreen('new'); }, []);
  const goBoard = useCallback(() => { setScreen('board'); setCompareIds([]); }, []);
  const openDetail = useCallback((shotId: string) => { setActiveShotId(shotId); setScreen('detail'); }, []);
  const goCompare = useCallback((ids?: string[]) => {
    if (ids) setCompareIds(ids);
    setScreen('compare');
  }, []);
  const toggleCompareSelect = useCallback((shotId: string) => {
    setCompareIds((ids) => (ids.includes(shotId) ? ids.filter((i) => i !== shotId) : ids.length >= 4 ? ids : [...ids, shotId]));
  }, []);
  const clearCompare = useCallback(() => setCompareIds([]), []);

  const postAction = useCallback(async (shotId: string, type: DesignerActionType) => {
    try {
      const res = await fetch(`/api/archviz/shots/${shotId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      if (res.ok) {
        const { shot } = await res.json() as { shot: Shot };
        setShots((ss) => ss.map((s) => (s.id === shotId ? shot : s)));
      }
    } catch {
      // best-effort — designer actions aren't safety-critical, don't surface a toast per click
    }
  }, []);

  const logAction = useCallback((shotId: string, type: DesignerActionType) => { void postAction(shotId, type); }, [postAction]);
  const setFavorite = useCallback((shotId: string, val: boolean) => { void postAction(shotId, val ? 'favorite' : 'unfavorite'); }, [postAction]);
  // re-sending the same label action toggles it back to 'none' server-side (src/app/api/archviz/shots/[id]/actions)
  const setLabel = useCallback((shotId: string, label: Exclude<DesignerLabel, 'none'>) => { void postAction(shotId, LABEL_TO_ACTION[label]); }, [postAction]);
  const requestRecapture = useCallback((shotId: string) => { void postAction(shotId, 'request_recapture'); }, [postAction]);

  const runShots = useMemo(() => [...shots].sort((a, b) => a.rank - b.rank), [shots]);
  const boardShots = useMemo(() => {
    const bestPerGroup = new Map<string, Shot>();
    runShots.forEach((s) => {
      const cur = bestPerGroup.get(s.camGroup);
      if (!cur || s.overallScore > cur.overallScore) bestPerGroup.set(s.camGroup, s);
    });
    return [...bestPerGroup.values()].sort((a, b) => a.rank - b.rank);
  }, [runShots]);

  const variantsOf = useCallback((camGroup: string) => shots.filter((s) => s.camGroup === camGroup), [shots]);

  const store = useMemo<ArchvizStore>(() => ({
    screen, shots, activeShotId, compareIds, error, busy,
    activeRun: run, activeModel: model, runShots, boardShots,
    activeShot: shots.find((s) => s.id === activeShotId),
    startAnalysis, goNew, goBoard, openDetail, goCompare, toggleCompareSelect, clearCompare,
    setFavorite, setLabel, requestRecapture, logAction, variantsOf,
  }), [
    screen, shots, activeShotId, compareIds, error, busy, run, model, runShots, boardShots,
    startAnalysis, goNew, goBoard, openDetail, goCompare, toggleCompareSelect, clearCompare,
    setFavorite, setLabel, requestRecapture, logAction, variantsOf,
  ]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export { RUN_STAGES };
export type { RunStage };
