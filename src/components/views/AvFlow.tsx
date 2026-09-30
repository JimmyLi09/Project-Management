'use client';

/* ===== AV-017 · 流程外框(01、02–04、05、06、07 每一页都套这一层)=====
   用户 0930:「需要增加后退,上面的几个大步骤需要保留;整个流程有点不顺。」
   所以每一步的页面都是同一个样子:

     ‹ 后退 · 返回 AV 工作台 · 当前项目(整个流程只在这里选一次)· 最近更新
     01 → 07 步骤条(每步状态、锁定原因;与 AV 工作台同一套判定 server/avflow.ts)
     页面正文(05 的业务线标签、06 / 07 的两档标签在步骤条下方)
     底部:‹ 上一步:xx    当前状态 / 不能前进的原因    下一步:xx ›

   05 → 06 的「下一步」要先把方案存成正式版本:05 的四个业务线页面各自通过
   useFlowGuard 告诉外框「改没改、能不能存、存下来是第几版、怎么存」,外框弹窗
   确认后替它存,再进 06。 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { projectLines } from '@/av/core/lines';
import { fmtDate } from '@/lib/project';
import { useLang } from '@/lib/i18n';
import type { ProjectFlow, StepKey, StepState } from '@/server/avflow';
import { useStore, type View } from '../store';

export interface FlowGuard {
  line: string;
  dirty: boolean;           // 和最新正式版本不一样(或者还没有正式版本)
  canSave: boolean;
  nextVersion: number;      // 存下去是 vN
  blocked: string | null;   // 存不了的原因(排布无解等)
  save: () => Promise<boolean>;
}

const Ctx = createContext<{ setGuard: (g: FlowGuard | null) => void; refresh: () => void; flow: ProjectFlow | null } | null>(null);

/* 05 的业务线页面调用:每次渲染把最新的状态交给外框 */
export function useFlowGuard(g: FlowGuard | null) {
  const c = useContext(Ctx);
  const ref = useRef(g);
  ref.current = g;
  const key = g ? `${g.line}|${g.dirty}|${g.canSave}|${g.nextVersion}|${g.blocked}` : '';
  useEffect(() => {
    if (!c) return;
    c.setGuard(ref.current ? { ...ref.current, save: () => ref.current!.save() } : null);
  }, [c, key]);
  useEffect(() => () => c?.setGuard(null), [c]);
}

/* 存完方案、确认完成本之后让步骤条重新取一次状态 */
export const useFlowRefresh = () => useContext(Ctx)?.refresh ?? (() => {});

type Step = { key: StepKey; no: string; zh: string; en: string };
const STEPS: Step[] = [
  { key: 's1', no: '01', zh: '立项询价', en: 'Inquiry' },
  { key: 's2', no: '02–04', zh: '图纸 · 解析 · 校核', en: 'Drawings & review' },
  { key: 's5', no: '05', zh: '方案配置', en: 'Configuration' },
  { key: 's6', no: '06', zh: '成本核算', en: 'Costing' },
  { key: 's7', no: '07', zh: '报价审批', en: 'Quotation' },
];

export const stepOf = (v: View): StepKey | null =>
  v.name === 'avinquiry' ? 's1' : v.name === 'ledingest' ? 's2' : v.name === 'avconfig' ? 's5'
    : v.name === 'avcostquote' ? (v.sub === 'quote' ? 's7' : 's6') : null;

/* 05 进来时落在这个项目上次的业务线 */
const LINE_KEY = (pid: string) => `audax.avLine.${pid}`;
export const rememberLine = (pid: string, line: string) => { try { if (pid) localStorage.setItem(LINE_KEY(pid), line); } catch { /* ignore */ } };
const lastLine = (pid: string) => { try { return localStorage.getItem(LINE_KEY(pid)) || undefined; } catch { return undefined; } };

const TONE: Record<StepState | 'cur', { bg: string; fg: string; bd: string }> = {
  cur: { bg: 'var(--navy900)', fg: '#fff', bd: 'var(--navy900)' },
  done: { bg: 'var(--success-bg, #E4EFE9)', fg: 'var(--success)', bd: 'transparent' },
  draft: { bg: 'var(--warning-bg, #FDF7F1)', fg: 'var(--warning)', bd: 'transparent' },
  pending: { bg: 'var(--warning-bg, #FDF7F1)', fg: 'var(--warning)', bd: 'transparent' },
  todo: { bg: 'transparent', fg: 'var(--text)', bd: 'transparent' },
  lock: { bg: 'transparent', fg: 'var(--text2)', bd: 'transparent' },
  na: { bg: 'transparent', fg: 'var(--text2)', bd: 'transparent' },
};

export default function AvFlow({ children }: { children: React.ReactNode }) {
  const { view, setView, projects, ledProjectId, setLedProjectId, canBack, back, setToast } = useStore();
  const { t, lang } = useLang();
  const tt = (s: { zh: string; en: string }) => (lang === 'zh' ? s.zh : s.en);
  const step = stepOf(view)!;
  const [flow, setFlow] = useState<ProjectFlow | null>(null);
  const [guard, setGuard] = useState<FlowGuard | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((x) => x + 1), []);

  /* 顶栏的项目:看得见的、有 AV 业务线的项目(REQ-043 的可见性由 /api/projects 管) */
  const avProjects = useMemo(
    () => projects.filter((p) => !p.archived && projectLines(p.packages.map((k) => k.svc)).length > 0),
    [projects],
  );
  const project = avProjects.find((p) => p.id === ledProjectId);

  useEffect(() => {
    if (!project) { setFlow(null); return; }
    let live = true;
    fetch(`/api/av/flow?project=${encodeURIComponent(project.id)}`).then((r) => r.json())
      .then((b) => { if (live) setFlow(b.flow ?? null); }).catch(() => { if (live) setFlow(null); });
    return () => { live = false; };
  }, [project, view.name, view.sub, tick]);

  const target = (k: StepKey): View => {
    if (k === 's1') return { name: 'avinquiry' };
    if (k === 's2') return { name: 'ledingest' };
    if (k === 's5') return { name: 'avconfig', sub: view.line || (project ? lastLine(project.id) : undefined) || flow?.lines[0]?.line };
    if (k === 's6') return { name: 'avcostquote', sub: 'cost', ...(view.name === 'avconfig' && view.sub ? { line: view.sub } : view.line ? { line: view.line } : {}) };
    return { name: 'avcostquote', sub: 'quote' };
  };
  const status = (k: StepKey) => flow?.steps[k];
  const locked = (k: StepKey) => status(k)?.state === 'lock';

  function goStep(k: StepKey) {
    if (k === step) return;
    const s = status(k);
    if (s?.state === 'lock') { setToast(tt(s)); return; }
    setView(target(k));
  }

  const i = STEPS.findIndex((s) => s.key === step);
  const prev = STEPS[i - 1];
  const next = STEPS[i + 1];

  async function onNext() {
    if (!next) return;
    if (!project && step !== 's1') { setToast(t('先在上面选一个项目。', 'Pick a project above first.')); return; }
    if (step === 's5' && guard) {
      if (!guard.canSave) {
        setToast(t('你没有保存方案的权限，只能查看；需项目 PM 或 PD / BD 保存方案后才能核算。', 'You cannot save designs; the project PM or PD / BD must save it before costing.'));
        setView(target('s6'));
        return;
      }
      if (guard.blocked) { setToast(guard.blocked); return; }
      if (guard.dirty) { setAsking(true); return; }
    }
    if (locked(next.key)) { setToast(tt(status(next.key)!)); return; }
    setView(target(next.key));
  }

  async function confirmSave() {
    if (!guard) return;
    setBusy(true);
    const ok = await guard.save();
    setBusy(false);
    setAsking(false);
    if (!ok) return;
    refresh();
    setToast(t(`已保存方案 v${guard.nextVersion}，进入成本核算。`, `Design v${guard.nextVersion} saved; on to costing.`));
    setView({ name: 'avcostquote', sub: 'cost', line: guard.line });
  }

  /* 底部中间那一句:当前状态 / 不能前进的原因 */
  const gate = (() => {
    if (!project && step !== 's1') return t('先在上面选一个项目', 'Pick a project above');
    if (step === 's5' && guard) {
      if (guard.blocked) return guard.blocked;
      if (guard.dirty) return guard.nextVersion > 1
        ? t(`有改动未存成正式版本（下一个是 v${guard.nextVersion}）`, `Unsaved changes (next version v${guard.nextVersion})`)
        : t('还没有保存正式版本', 'No saved version yet');
      return t(`正式版本 v${guard.nextVersion - 1} 已保存`, `Version v${guard.nextVersion - 1} saved`);
    }
    if (!next) return t('最后一步', 'Last step');
    const nx = status(next.key);
    if (nx?.state === 'lock') return tt(nx);
    const me = status(step);
    return me ? tt(me) : '';
  })();

  /* 必须 memo:useFlowGuard 的 effect 依赖它,每次渲染换一个新对象就会来回触发 */
  const ctx = useMemo(() => ({ setGuard, refresh, flow }), [refresh, flow]);

  return (
    <Ctx.Provider value={ctx}>
      <div className="av-mod av-flow" data-testid="av-flow">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <button className="btn-line sm" disabled={!canBack} onClick={back} data-testid="flow-back"
            title={canBack ? '' : t('已经是第一页', 'Nothing to go back to')} style={!canBack ? { opacity: 0.45 } : undefined}>
            ‹ {t('后退', 'Back')}
          </button>
          <button className="btn-line sm" onClick={() => setView({ name: 'avhome' })} data-testid="flow-home">{t('返回 AV 工作台', 'AV workbench')}</button>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: 'var(--text2)', marginLeft: 6 }}>
            {t('当前项目', 'Project')}
            <select id="av-project" className="in sm" value={project ? project.id : ''} data-testid="flow-project"
              onChange={(e) => setLedProjectId(e.target.value)} style={{ minWidth: 260, color: 'var(--text)' }}>
              <option value="">{t('— 选择项目 —', '— choose a project —')}</option>
              {avProjects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.client ? ` · ${p.client}` : ''}</option>)}
            </select>
          </label>
          <span style={{ fontSize: 12, color: 'var(--text2)' }} data-testid="flow-last">
            {flow?.lastUpdate ? t(`最近更新：${fmtDate(new Date(flow.lastUpdate.at))} ${new Date(flow.lastUpdate.at).toTimeString().slice(0, 5)} · ${flow.lastUpdate.by}`,
              `Last update: ${fmtDate(new Date(flow.lastUpdate.at))} ${new Date(flow.lastUpdate.at).toTimeString().slice(0, 5)} · ${flow.lastUpdate.by}`) : ''}
          </span>
        </div>

        <nav aria-label={t('AV 方案流程', 'AV workflow')} data-testid="flow-steps"
          style={{ display: 'flex', gap: 4, flexWrap: 'wrap', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 4, marginBottom: 16 }}>
          {STEPS.map((s) => {
            const cur = s.key === step;
            const st = status(s.key);
            const tone = TONE[cur ? 'cur' : st?.state ?? 'todo'];
            const lock = st?.state === 'lock';
            return (
              <button key={s.key} onClick={() => goStep(s.key)} data-testid={`flow-step-${s.key}`} data-state={cur ? 'cur' : st?.state ?? ''} data-status={st?.state ?? ''}
                title={lock ? tt(st!) : ''} aria-current={cur ? 'step' : undefined}
                style={{ flex: '1 1 150px', textAlign: 'left', padding: '7px 12px', borderRadius: 7, border: `1px solid ${tone.bd}`,
                  background: tone.bg, color: tone.fg, cursor: lock ? 'not-allowed' : 'pointer', font: 'inherit', opacity: lock || st?.state === 'na' ? 0.6 : 1 }}>
                <span className="tnum" style={{ fontSize: 11, fontWeight: 700, opacity: 0.8 }}>{s.no}</span>{' '}
                <span style={{ fontSize: 13, fontWeight: 600 }}>{t(s.zh, s.en)}</span>
                <span style={{ display: 'block', fontSize: 11, marginTop: 1, opacity: 0.85 }}>
                  {cur ? t('当前', 'Current') : st ? `${st.state === 'done' ? '✓ ' : st.state === 'lock' ? '🔒 ' : ''}${tt(st)}` : ' '}
                </span>
              </button>
            );
          })}
        </nav>

        {children}

        <div data-testid="flow-foot" style={{ position: 'sticky', bottom: 0, zIndex: 5, marginTop: 20, display: 'flex', gap: 12, alignItems: 'center',
          padding: '10px 14px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 -4px 14px rgba(0,0,0,.05)' }}>
          {prev ? (
            <button className="btn-line sm" onClick={() => goStep(prev.key)} data-testid="flow-prev">‹ {t(`上一步：${prev.no} ${prev.zh}`, `Back: ${prev.no} ${prev.en}`)}</button>
          ) : <span />}
          <span style={{ flex: 1, textAlign: 'center', fontSize: 12.5, color: 'var(--text2)' }} data-testid="flow-gate">{gate}</span>
          {next && (
            <button className="btn-navy sm" onClick={onNext} data-testid="flow-next"
              style={(!project && step !== 's1') || (step !== 's5' && locked(next.key)) ? { opacity: 0.45 } : undefined}>
              {t(`下一步：${next.no} ${next.zh}`, `Next: ${next.no} ${next.en}`)} ›
            </button>
          )}
        </div>
      </div>

      {asking && guard && (
        <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget && !busy) setAsking(false); }}>
          <div className="modal" style={{ maxWidth: 440 }} data-testid="flow-save-modal">
            <h2>{t('保存方案并进入成本核算？', 'Save the design and go to costing?')}</h2>
            <div className="msub">
              {t(`当前方案将保存为正式版本 v${guard.nextVersion}，06 成本核算按 v${guard.nextVersion} 计算。`,
                `The current design will be saved as version v${guard.nextVersion}; 06 costs it from v${guard.nextVersion}.`)}
            </div>
            <div className="modal-actions">
              <button className="btn-line" disabled={busy} onClick={() => setAsking(false)} data-testid="flow-save-no">{t('再改改', 'Keep editing')}</button>
              <button className="btn-navy" disabled={busy} onClick={confirmSave} data-testid="flow-save-yes">
                {busy ? t('保存中…', 'Saving…') : t(`保存 v${guard.nextVersion} 并进入 06`, `Save v${guard.nextVersion} & open 06`)}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
