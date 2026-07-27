'use client';

/* ===== AI ArchViz Director — Model-Direct: self-contained client-only store =====
   Sibling to LangProvider (src/lib/i18n.tsx), not wired into the project/user
   StoreProvider (src/components/store.tsx) — this feature has no server
   persistence or permission-system hook (see plan). State + a simulated
   render/AI pipeline live entirely here, with a light localStorage cache so
   a reload doesn't lose the last run. */

import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import type {
  AnalysisRun, ArchModel, ArchvizScreen, DesignerAction, DesignerActionType, DesignerLabel,
  RunStage, Shot,
} from '@/lib/archviz/types';
import { RUN_STAGES } from '@/lib/archviz/types';
import { generateShots, newModel } from '@/lib/archviz/mockData';

const LS_KEY = 'audax:archviz:v1';

interface Persisted {
  models: ArchModel[];
  runs: AnalysisRun[];
  shots: Shot[];
  actions: DesignerAction[];
}

interface ArchvizStore extends Persisted {
  screen: ArchvizScreen;
  activeRunId?: string;
  activeShotId?: string;
  compareIds: string[];

  activeRun?: AnalysisRun;
  activeModel?: ArchModel;
  runShots: Shot[]; // shots belonging to activeRunId, sorted by rank
  boardShots: Shot[]; // runShots deduped to the best-scoring shot per camGroup
  activeShot?: Shot;

  startAnalysis: (modelName: string, dcc: ArchModel['dcc'], presetIds: string[]) => void;
  goNew: () => void;
  goBoard: () => void;
  openDetail: (shotId: string) => void;
  goCompare: (ids?: string[]) => void;
  toggleCompareSelect: (shotId: string) => void;
  clearCompare: () => void;

  setFavorite: (shotId: string, val: boolean) => void;
  setLabel: (shotId: string, label: DesignerLabel) => void;
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

function loadPersisted(): Persisted {
  if (typeof localStorage === 'undefined') return { models: [], runs: [], shots: [], actions: [] };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { models: [], runs: [], shots: [], actions: [] };
    const p = JSON.parse(raw);
    return {
      models: p.models || [], runs: p.runs || [], shots: p.shots || [], actions: p.actions || [],
    };
  } catch {
    return { models: [], runs: [], shots: [], actions: [] };
  }
}

export function ArchvizProvider({ children }: { children: React.ReactNode }) {
  const [models, setModels] = useState<ArchModel[]>([]);
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [actions, setActions] = useState<DesignerAction[]>([]);
  const [screen, setScreen] = useState<ArchvizScreen>('new');
  const [activeRunId, setActiveRunId] = useState<string>();
  const [activeShotId, setActiveShotId] = useState<string>();
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const hydrated = useRef(false);

  useEffect(() => {
    const p = loadPersisted();
    setModels(p.models); setRuns(p.runs); setShots(p.shots); setActions(p.actions);
    if (p.runs.length) {
      const last = p.runs[p.runs.length - 1];
      setActiveRunId(last.id);
      setScreen(last.stage === 'completed' ? 'board' : 'new');
    }
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    try { localStorage.setItem(LS_KEY, JSON.stringify({ models, runs, shots, actions })); } catch { /* ignore */ }
  }, [models, runs, shots, actions]);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const startAnalysis = useCallback((modelName: string, dcc: ArchModel['dcc'], presetIds: string[]) => {
    timers.current.forEach(clearTimeout);
    timers.current = [];

    const model = newModel(modelName || '未命名模型', dcc);
    const cameraCount = 12 + Math.floor(Math.random() * 6);
    const total = cameraCount * Math.max(1, presetIds.length);
    const run: AnalysisRun = {
      id: 'run_' + Math.random().toString(36).slice(2, 9),
      modelId: model.id,
      lightingPresetIds: presetIds,
      stage: 'queued',
      rendered: 0,
      total,
      createdAt: Date.now(),
    };
    const fullShots = generateShots(run.id, presetIds, Math.floor(Math.random() * 1e9), cameraCount);
    // reveal order: as-generated (camera turntable order), not final rank —
    // mirrors "已渲染+评分的角度即时上屏" (partial results stream in before ranking)
    const revealOrder = [...fullShots].sort((a, b) => a.id.localeCompare(b.id));

    setModels((m) => [...m, model]);
    setRuns((r) => [...r, run]);
    setShots((s) => s.filter((sh) => sh.runId !== run.id));
    setActiveRunId(run.id);
    setScreen('progress');

    const setRunStage = (stage: RunStage, rendered?: number) => {
      setRuns((rs) => rs.map((r) => (r.id === run.id ? { ...r, stage, rendered: rendered ?? r.rendered } : r)));
    };
    const schedule = (fn: () => void, delay: number) => {
      const id = setTimeout(fn, delay);
      timers.current.push(id);
      return id;
    };

    let t = 0;
    const preStages: RunStage[] = ['queued', 'sampling', 'lighting'];
    preStages.forEach((stage) => {
      t += 450;
      schedule(() => setRunStage(stage), t);
    });

    t += 500;
    schedule(() => setRunStage('rendering', 0), t);
    revealOrder.forEach((shot, i) => {
      t += 180 + Math.random() * 140;
      schedule(() => {
        setShots((s) => [...s, shot]);
        setRunStage('rendering', i + 1);
      }, t);
    });

    t += 500;
    schedule(() => setRunStage('pre_scoring'), t);
    t += 700;
    schedule(() => setRunStage('vision_eval'), t);
    t += 800;
    schedule(() => setRunStage('ranking'), t);
    t += 500;
    schedule(() => {
      setRuns((rs) => rs.map((r) => (r.id === run.id ? { ...r, stage: 'completed', completedAt: Date.now() } : r)));
    }, t);
  }, []);

  const goNew = useCallback(() => { setScreen('new'); }, []);
  const goBoard = useCallback(() => { setScreen('board'); setCompareIds([]); }, []);
  const openDetail = useCallback((shotId: string) => {
    setActiveShotId(shotId); setScreen('detail');
    setActions((a) => [...a, { id: 'act_' + Math.random().toString(36).slice(2, 8), shotId, type: 'view_detail', at: Date.now() }]);
  }, []);
  const goCompare = useCallback((ids?: string[]) => {
    if (ids) setCompareIds(ids);
    setScreen('compare');
  }, []);
  const toggleCompareSelect = useCallback((shotId: string) => {
    setCompareIds((ids) => (ids.includes(shotId) ? ids.filter((i) => i !== shotId) : ids.length >= 4 ? ids : [...ids, shotId]));
  }, []);
  const clearCompare = useCallback(() => setCompareIds([]), []);

  const logAction = useCallback((shotId: string, type: DesignerActionType) => {
    setActions((a) => [...a, { id: 'act_' + Math.random().toString(36).slice(2, 8), shotId, type, at: Date.now() }]);
  }, []);

  const setFavorite = useCallback((shotId: string, val: boolean) => {
    setShots((ss) => ss.map((s) => (s.id === shotId ? { ...s, favorite: val } : s)));
    logAction(shotId, val ? 'favorite' : 'unfavorite');
  }, [logAction]);

  const setLabel = useCallback((shotId: string, label: DesignerLabel) => {
    setShots((ss) => ss.map((s) => (s.id === shotId ? { ...s, label } : s)));
    const map: Partial<Record<DesignerLabel, DesignerActionType>> = {
      promoted: 'promote', demoted: 'demote', rejected: 'reject', hero: 'mark_hero',
    };
    if (map[label]) logAction(shotId, map[label]!);
  }, [logAction]);

  const requestRecapture = useCallback((shotId: string) => {
    logAction(shotId, 'request_recapture');
  }, [logAction]);

  const runShots = useMemo(
    () => shots.filter((s) => s.runId === activeRunId).sort((a, b) => a.rank - b.rank),
    [shots, activeRunId],
  );
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
    models, runs, shots, actions, screen, activeRunId, activeShotId, compareIds,
    activeRun: runs.find((r) => r.id === activeRunId),
    activeModel: models.find((m) => m.id === runs.find((r) => r.id === activeRunId)?.modelId),
    runShots, boardShots,
    activeShot: shots.find((s) => s.id === activeShotId),
    startAnalysis, goNew, goBoard, openDetail, goCompare, toggleCompareSelect, clearCompare,
    setFavorite, setLabel, requestRecapture, logAction, variantsOf,
  }), [
    models, runs, shots, actions, screen, activeRunId, activeShotId, compareIds, runShots, boardShots,
    startAnalysis, goNew, goBoard, openDetail, goCompare, toggleCompareSelect, clearCompare,
    setFavorite, setLabel, requestRecapture, logAction, variantsOf,
  ]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export { RUN_STAGES };
