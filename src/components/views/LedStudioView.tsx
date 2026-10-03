'use client';

/* ===== 05 方案配置 + 05b 出图 =====
   The LED word-entry form, the deterministic engine's output with its
   calculation chain, and the layout / wiring drawing — spec v1.0 §4–§9.

   Nothing is computed here. Every number on this screen comes from
   src/av/core, which is framework-free and separately tested. */

import React, { useEffect, useMemo, useRef, useState } from 'react';

import { bomCsv } from '@/av/core/bom';
import { compute } from '@/av/core/compute';
import { calcBasis, type CalcRow } from '@/av/core/calc';
import { assertExportable, buildDrawing, LAYER_TOGGLES } from '@/av/core/drawing';
import { getRulePack, LATEST_LED_PACK, ledPackUpgradable, listRulePacks } from '@/av/core/rulepack';
import { toSvg } from '@/av/core/svg';
import { toHandoff, type DrawingElement, type DrawingSummary, type Handoff, type StoredDrawing } from '@/av/core/handoff';
import { manualLabel } from '@/av/core/override';
import type { LedConfig, ScreenType, Severity, Size, TraceNode, WiringOverride } from '@/av/core/types';
import { canCostProject, canExportLed } from '@/lib/permissions';
import { useLang } from '@/lib/i18n';
import { fmtDate } from '@/lib/project';
import { useStore } from '../store';
import { Icon } from '../ui';
import { useFlowGuard, useFlowRefresh } from './AvFlow';
import DraftNotice from './DraftNotice';
import LedWiringPanel from './LedWiringPanel';
import LedCtrlCard from './LedCtrlCard';
import { sameConfig, useAutoDraft, useSavedConfig } from './useSavedConfig';

const SEVERITY: Record<Severity, { bg: string; fg: string; zh: string; en: string }> = {
  block: { bg: 'var(--danger-bg, #FDF0EC)', fg: 'var(--danger)', zh: '阻断', en: 'Blocking' },
  warn: { bg: 'var(--warning-bg, #FDF7F1)', fg: 'var(--warning)', zh: '告警', en: 'Warning' },
  info: { bg: 'var(--hover-bg)', fg: 'var(--text2)', zh: '提示', en: 'Note' },
};

function defaultConfig(packVersion: string, type: ScreenType): LedConfig {
  const p = getRulePack(packVersion).profiles[type];
  return {
    led_opening_w: 4480, led_opening_h: 2560,
    led_screen_type: type, led_pitch: 2, led_cabinet: p.primary,
    led_refresh: 3840, led_nits: type === 'out_fixed' ? 5000 : 800,
    led_install: 'steel', led_maintain: 'front',
    led_ctrl_brand: 'novastar', led_power_cable: '3*2.5',
  };
}

const parseLib = (s: string): Size[] =>
  s.split(',').map((part) => part.trim().toLowerCase().split(/[x×*]/).map(Number))
    .filter((n) => n.length === 2 && n[0] > 0 && n[1] > 0)
    .map((n) => [n[0], n[1]] as Size);

const fmtLib = (lib: Size[]) => lib.map((s) => `${s[0]}x${s[1]}`).join(', ');

export default function LedStudioView() {
  const { me, projects, ledProjectId, ledHandoff, setLedHandoff, setView, go } = useStore();
  const { t, lang } = useLang();
  const refreshFlow = useFlowRefresh();

  const [packVersion, setPackVersion] = useState(LATEST_LED_PACK);
  const [cfg, setCfg] = useState<LedConfig>(() => defaultConfig(LATEST_LED_PACK, 'in_fixed'));
  const [libText, setLibText] = useState(() => fmtLib(getRulePack(LATEST_LED_PACK).profiles.in_fixed.cabLib));
  const [openTrace, setOpenTrace] = useState<string | null>(null);
  /* Values handed over by 04 人工校核, with their provenance (§9). Those fields
     are read-only here: the drawing, not this form, is their source. */
  const [fromDrawing, setFromDrawing] = useState<Handoff | null>(null);
  /* AV-017:这一屏的数据是怎么来的 —— 载入了正式版本 / 从 04 自动带入 / 04 刚提交带过来 */
  const [origin, setOrigin] = useState<'' | 'saved' | 'auto' | 'explicit' | 'draft'>('');
  /* AV-016 ②:这个项目的正式版本 / 草稿已经载入完(之后的改动才算人改的,才自动存草稿) */
  const [ready, setReady] = useState(false);

  /* AV-017:项目取流程顶栏的那一个(带 LED 服务包的才算) */
  const project = projects.find((p) => p.id === ledProjectId && !p.archived && p.packages.some((k) => k.svc === 'led'));
  const saved = useSavedConfig<LedConfig>(project?.id, 'led');
  const maySave = !!project && canCostProject(me, project);

  /* AV-019:项目立项时绑定的 LED 规则包。旧项目保持原版本;用户点「升级」后这次保存换成最新一版 */
  const [boundOf, setBound] = useState<{ pid: string; pack: string | null }>({ pid: '', pack: null });
  const [upgradeOf, setUpgrade] = useState('');   // 点了升级的项目 id
  const bound = project && boundOf.pid === project.id ? boundOf.pack : null;
  const upgrade = !!project && upgradeOf === project.id && ledPackUpgradable(bound);
  useEffect(() => {
    if (!project) return;
    const pid = project.id;
    let live = true;
    fetch(`/api/av/inquiry?project=${encodeURIComponent(pid)}`).then((r) => r.json())
      .then((b) => { if (live) setBound({ pid, pack: b?.inquiry?.packs?.led ?? null }); })
      .catch(() => { if (live) setBound({ pid, pack: null }); });
    return () => { live = false; };
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 这个项目最新一张已校核的图纸:05 没有正式版本时自动带入它 */
  /* 记着是哪个项目的:换项目那一次渲染里,旧项目的结果不能当成新项目的 */
  const [reviewedOf, setReviewed] = useState<{ pid: string; loaded: boolean; d: DrawingSummary | null }>({ pid: '', loaded: false, d: null });
  const reviewed = reviewedOf.pid === project?.id ? reviewedOf : { pid: '', loaded: false, d: null };
  useEffect(() => {
    if (!project) return;
    const pid = project.id;
    let live = true;
    fetch(`/api/av/drawings?project=${encodeURIComponent(pid)}`).then((r) => r.json())
      .then((b) => { if (live) setReviewed({ pid, loaded: true, d: ((b.drawings ?? []) as DrawingSummary[]).find((x) => x.reviewedAt > 0) ?? null }); })
      .catch(() => { if (live) setReviewed({ pid, loaded: true, d: null }); });
    return () => { live = false; };
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (h: Handoff) => {
    /* AV-015: a picture also settles the pitch (kernel's choice under LED-VD-01), maintenance and the curve */
    setCfg((prev) => {
      const { led_curve: _drop, ...rest } = prev;
      return { ...rest, ...h.fields, ...(h.extra ?? {}) };
    });
    if (h.packVersion) setPackVersion(h.packVersion);
    setFromDrawing(h);
  };

  async function loadDrawing(id: number): Promise<Handoff | null> {
    if (!project) return null;
    const d = await fetch(`/api/av/drawings/${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) as StoredDrawing | null;
    if (!d) return null;
    const inq = await fetch(`/api/av/inquiry?project=${encodeURIComponent(project.id)}`).then((r) => r.json()).catch(() => ({}));
    return { ...toHandoff(d, project.name, inq?.inquiry?.packs?.led ?? undefined), projectId: d.project_id, drawingId: d.id };
  }
  async function carryFrom(id: number) {
    const h = await loadDrawing(id);
    if (h) { apply(h); setOrigin('auto'); }
  }

  /* 04 刚提交 / 图片判读刚确认:明确带过来的值优先 */
  const explicit = useRef(false);
  useEffect(() => {
    if (!ledHandoff) return;
    explicit.current = true;
    apply(ledHandoff);
    setOrigin('explicit');
    setLedHandoff(null);
  }, [ledHandoff, setLedHandoff]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 打开 05 / 换项目:有正式版本就载入它;没有就从 04 最新校核结果自动带入;都没有就出厂默认 */
  const initFor = useRef('');
  useEffect(() => { setReady(false); }, [project?.id]);
  useEffect(() => {
    if (!project || !saved.loaded || !reviewed.loaded || initFor.current === project.id) return;
    initFor.current = project.id;
    if (explicit.current) { explicit.current = false; setReady(true); return; }
    (async () => {
      if (saved.draft) {
        /* AV-016 ②:上次没存成正式版本的草稿优先 */
        const c = saved.draft.cfg;
        setCfg(c);
        if (saved.packVersion) setPackVersion(saved.packVersion);
        setLibText(fmtLib(c.led_cab_lib ?? getRulePack(saved.packVersion ?? LATEST_LED_PACK).profiles[c.led_screen_type].cabLib));
        setFromDrawing(saved.draft.drawingId ? await loadDrawing(saved.draft.drawingId) : null);
        setOrigin('draft');
      } else if (saved.cfg) {
        const c = saved.cfg;
        setCfg(c);
        if (saved.packVersion) setPackVersion(saved.packVersion);
        setLibText(fmtLib(c.led_cab_lib ?? getRulePack(saved.packVersion ?? LATEST_LED_PACK).profiles[c.led_screen_type].cabLib));
        setFromDrawing(saved.drawingId ? await loadDrawing(saved.drawingId) : null);
        setOrigin('saved');
      } else if (reviewed.d) {
        await carryFrom(reviewed.d.id);
      } else {
        setCfg(defaultConfig(LATEST_LED_PACK, 'in_fixed'));
        setFromDrawing(null);
        setOrigin('');
      }
      setReady(true);
    })();
  }, [project, saved.loaded, reviewed.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const locked = (k: DrawingElement) => !!fromDrawing && k in fromDrawing.fields;

  /* §10 config_result — save this configuration against the project; the
     server recomputes it with the same core. Returns whether it saved (the
     flow frame's 05 → 06 「下一步」 waits on it). */
  const [savedMsg, setSaved] = useState('');
  async function saveToProject(): Promise<boolean> {
    if (!project) return false;
    cancelDraft();   // 排队 / 在路上的草稿作废,别在正式版本之后又写回去
    setSaved('');
    const res = await fetch('/api/av/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, drawingId: fromDrawing?.drawingId ?? null, cfg: payload, upgradePack: upgrade }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : { error: t('网络错误', 'Network error') };
    const ok = !!res?.ok && !body.error;
    setSaved(ok ? `ok:${body.version}` : `✕ ${body.error || t('保存失败', 'Save failed')}`);
    if (ok && body.packVersion) { setBound({ pid: project.id, pack: body.packVersion }); setUpgrade(''); }
    if (ok) { saved.markSaved(payload, Number(body.version) || saved.version + 1); resetDraft(payload); saved.reload(); refreshFlow(); }
    return ok;
  }

  /* 有项目时按立项绑定的规则包算(服务端保存也用它);没项目的试算才用下拉框选的 */
  const packV = bound ? (upgrade ? LATEST_LED_PACK : bound) : packVersion;
  const pack = getRulePack(packV);
  const profile = pack.profiles[cfg.led_screen_type];
  const lib = useMemo(() => parseLib(libText), [libText]);
  const [modW, modH] = cfg.led_mod ?? [profile.modW, profile.modH];

  /* 弧形只随已确认的图片判读走(服务端没带图纸就删掉它);改为手动输入后也不再带,
     否则和存下来的正式版本永远对不上,05 会一直显示「有改动」 */
  const payload = useMemo(() => ({ ...cfg, led_curve: fromDrawing?.drawingId ? cfg.led_curve : undefined, led_cab_lib: lib.length ? lib : undefined }),
    [cfg, lib, fromDrawing]);
  const result = useMemo(
    () => compute(payload, packV, fromDrawing?.prov),
    [payload, packV, fromDrawing],
  );
  /* AV-017:和最新正式版本比,改没改 —— 05 的「下一步」据此决定要不要弹窗保存 */
  /* 箱体库等于参数组默认值时,存没存这一项都一样(演示数据、老方案就没存) */
  const canon = (c: LedConfig) => {
    const def = getRulePack(packV).profiles[c.led_screen_type]?.cabLib;
    const lib2 = c.led_cab_lib;
    return { ...c, led_cab_lib: !lib2 || (def && sameConfig(lib2, def)) ? undefined : lib2 };
  };
  const dirty = !saved.cfg || !sameConfig(canon(payload), canon(saved.cfg)) || upgrade;
  useFlowGuard(project && saved.loaded ? {
    line: 'led', dirty, canSave: maySave, nextVersion: saved.version + 1,
    blocked: !result.layout ? t('排布无解，不能保存：先按右边的阻断提示调整屏体尺寸或箱体库', 'No layout — fix the blocking findings before saving')
      : result.manualBlock ? (lang === 'en' ? result.manualBlock.en : result.manualBlock.zh) : null,
    save: saveToProject,
  } : null);
  const { draftState, draftSaving, draftCleared, cancelDraft, resetDraft } = useAutoDraft({
    projectId: project?.id, line: 'led', payload, drawingId: fromDrawing?.drawingId ?? null,
    enabled: maySave && !saved.failed, dirty, hadDraft: !!saved.draft, version: saved.version, ready,
  });
  useEffect(() => { if (draftState?.at) refreshFlow(); }, [draftState?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  async function discardDraft() {
    if (!project || !saved.cfg) return;
    await fetch(`/api/av/config/draft?project=${encodeURIComponent(project.id)}&line=led`, { method: 'DELETE' }).catch(() => null);
    const c = saved.cfg;
    setReady(false);
    setCfg(c);
    setLibText(fmtLib(c.led_cab_lib ?? getRulePack(saved.packVersion ?? LATEST_LED_PACK).profiles[c.led_screen_type].cabLib));
    setFromDrawing(saved.drawingId ? await loadDrawing(saved.drawingId) : null);
    setOrigin('saved');
    resetDraft();
    saved.reload();
    refreshFlow();
    setReady(true);
  }
  /* AV-018:带入的字段下写「来自图片判读 · 01-Oct」(日期 = 那张图校核 / 带入的日子) */
  const srcDay = reviewed.d && fromDrawing?.drawingId === reviewed.d.id && reviewed.d.reviewedAt ? ` · ${fmtDate(new Date(reviewed.d.reviewedAt)).slice(0, 6)}` : '';
  const srcLabel = fromDrawing?.notes ? t(`来自图片判读${srcDay}`, `From the picture reading${srcDay}`) : t(`来自图纸 · 04 已确认${srcDay}`, `From drawing · 04 confirmed${srcDay}`);
  const src = (k: DrawingElement) => locked(k) && <span style={{ display: 'block', fontSize: 11, color: 'var(--success)', marginTop: 3 }} data-testid={`led-src-${k}`}>{srcLabel}</span>;
  /* 图纸校核有更新:换了一张图、或同一张图之后又校核过。AV-018:有草稿时也要提示(原来只看正式版本) */
  const baseAt = origin === 'draft' ? (saved.draft?.updatedAt ?? 0) : saved.savedAt;
  const newerDrawing = !!reviewed.d && (origin === 'saved' || origin === 'draft')
    && (fromDrawing?.drawingId ? reviewed.d.id !== fromDrawing.drawingId || reviewed.d.reviewedAt > baseAt : reviewed.d.reviewedAt > baseAt);
  const drawing = useMemo(
    () => buildDrawing(result, { project: fromDrawing?.project ?? project?.name ?? fromDrawing?.drawing ?? t('方案配置', 'Configuration') }),
    [result, t, fromDrawing, project?.name],
  );
  /* AV-019 §2.1:图层开关 + 适应宽度 / 100%(记在这台浏览器上) */
  const [hidden, setHidden] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('led.hiddenLayers') || '[]'); } catch { return []; }
  });
  const [zoom, setZoom] = useState<'fit' | 'full'>('fit');
  const toggleLayer = (key: string) => setHidden((prev) => {
    const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
    try { localStorage.setItem('led.hiddenLayers', JSON.stringify(next)); } catch { /* 无痕模式等 */ }
    return next;
  });
  const svg = useMemo(() => {
    if (!drawing) return '';
    const off = new Set<string>(LAYER_TOGGLES.filter((x) => hidden.includes(x.key)).flatMap((x) => x.layers));
    return toSvg({ ...drawing, layers: drawing.layers.map((l) => (off.has(l.name) ? { ...l, entities: [] } : l)) }, { fit: zoom === 'fit' });
  }, [drawing, hidden, zoom]);
  const fullSvg = useMemo(() => (drawing ? toSvg(drawing) : ''), [drawing]);
  const calc = useMemo(() => calcBasis(result, lang === 'en' ? 'en' : 'zh'), [result, lang]);
  const [openCalc, setOpenCalc] = useState<string | null>(null);

  const set = <K extends keyof LedConfig>(key: K, value: LedConfig[K]) =>
    setCfg((prev) => ({ ...prev, [key]: value }));

  /* AV-019 §2.3 人工调整 */
  const setOverride = (f: (prev: WiringOverride | undefined) => WiringOverride | undefined) => setCfg((prev) => {
    const { led_wiring_override: old, ...rest } = prev;
    const ov = f(old);
    return ov ? { ...rest, led_wiring_override: ov } : rest;
  });
  /* 输入变了对不上:去掉这份调整、回到自动结果,并提示(已存的历史版本里还留着) */
  const [staleNote, setStaleNote] = useState('');
  useEffect(() => {
    if (!result.manualStale) return;
    setStaleNote(manualLabel(result.manualStale));
    setOverride(() => undefined);
  }, [result.manualStale]); // eslint-disable-line react-hooks/exhaustive-deps
  /* 换走法:网线的人工调整不再适用,去掉网线那一半(电源的保留) */
  function setDataMode(m: 'row' | 'snake') {
    setCfg((prev) => {
      const ov = prev.led_wiring_override;
      const next = { ...prev, led_data_mode: m };
      if (!ov?.data) return next;
      if (!ov.power) { const { led_wiring_override: _drop, ...rest } = next; return rest; }
      return { ...next, led_wiring_override: { ...ov, data: false, ports: undefined } };
    });
  }

  /* Switching the screen type reloads that parameter group's defaults (§3.1). */
  function switchType(type: ScreenType) {
    const p = pack.profiles[type];
    setCfg((prev) => ({ ...prev, led_screen_type: type, led_cabinet: p.primary, led_mod: undefined }));
    setLibText(fmtLib(p.cabLib));
  }

  function download(name: string, body: BlobPart, mime: string) {
    const url = URL.createObjectURL(new Blob([body], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportFile(kind: 'svg' | 'bom' | 'dxf' | 'proposal', lang: 'zh' | 'en' = 'zh') {
    try {
      assertExportable(result);
    } catch (e) {
      alert((e as Error).message);
      return;
    }
    if (!drawing || !result.layout) return;
    if (kind === 'svg') download('led-layout.svg', fullSvg, 'image/svg+xml');
    else if (kind === 'bom') download('led-cabinets.csv', bomCsv(result.layout), 'text/csv;charset=utf-8');
    else {
      /* DXF and the Word proposal are rendered by the drawing service; the server recomputes and re-applies the export gate */
      const title = fromDrawing?.project ?? fromDrawing?.drawing ?? '';   // the server names an untitled export in the document's language
      const res = await fetch('/api/av/export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, lang, cfg: { ...cfg, led_cab_lib: lib.length ? lib : undefined }, packVersion: packV, title, client: project?.client ?? '', projectId: project?.id }),
      }).catch(() => null);
      if (!res?.ok) {
        const body = res ? await res.json().catch(() => ({})) : {};
        alert(body.error || t('导出失败', 'Export failed'));
        return;
      }
      const blob = await res.blob();
      download(kind === 'dxf' ? 'led-layout.dxf' : `led-proposal-${lang}.docx`, blob, blob.type);
    }
  }

  const trace = result.trace;
  const tile = (key: string, label: [string, string], render: (n: TraceNode) => string) => {
    const node = trace[key];
    if (!node) return null;
    const text = render(node);
    return (
      <button key={key} className="kpi" style={{ textAlign: 'left', cursor: 'pointer', padding: '16px 18px',
        outline: openTrace === key ? '2px solid var(--navy700)' : undefined }}
        onClick={() => setOpenTrace(openTrace === key ? null : key)}
        title={t('展开计算链', 'Expand calculation chain')}>
        <div className="kpi-label">{t(label[0], label[1])}</div>
        <div className="kpi-value tnum" style={{ fontSize: text.length > 6 ? 22 : 30, whiteSpace: 'nowrap' }}>{text}</div>
        <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
          {node.prov.rule ? `rule · ${node.prov.rule}` : node.prov.method}
        </div>
      </button>
    );
  };

  return (
    <>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,330px) minmax(0,1fr)', gap: 20, alignItems: 'start' }}>

      {/* ── 参数 ─────────────────────────────────────────────── */}
      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head"><span className="panel-title">{t('LED 词条', 'LED fields')}</span></div>
        <div style={{ padding: '16px 18px', display: 'grid', gap: 12 }}>

          <div style={{ fontSize: 12, lineHeight: 1.7, padding: '9px 11px', borderRadius: 6, background: 'var(--hover-bg)', display: 'grid', gap: 6 }} data-testid="led-origin">
            {!project ? (
              <span style={{ color: 'var(--text2)' }}>{t('顶栏还没选带 LED 的项目：可以试算，不能保存。', 'No LED project picked above: scratch only, cannot save.')}</span>
            ) : fromDrawing ? (
              <span>
                {origin === 'auto'
                  ? t('已从 04 校核结果自动带入（不用再点「从图纸导入」）：', 'Carried in from the 04 review automatically: ')
                  : fromDrawing.notes ? t('已载入图片判读结果（来自图片 · 已人工确认）：', 'Loaded from a picture (confirmed by hand): ')
                    : t('已载入校核结果：', 'Loaded from review: ')}
                <strong>{fromDrawing.drawing}</strong>{t('。图纸带入字段只读。', '. Drawing fields are read-only.')}{' '}
                <button style={{ fontSize: 12, textDecoration: 'underline', color: 'var(--text2)' }}
                  onClick={() => setFromDrawing(null)}>{t('改为手动输入', 'Switch to manual')}</button>
              </span>
            ) : origin === 'saved' ? (
              <span>{t(`已载入正式版本 v${saved.version}（手动输入）。`, `Loaded saved version v${saved.version} (manual entry).`)}</span>
            ) : (
              <span style={{ color: 'var(--text2)' }}>{t('手动输入。', 'Manual entry.')}</span>
            )}
            {project && (
              <DraftNotice testid="led-draft" saved={saved} restored={origin === 'draft'} state={draftState} saving={draftSaving} cleared={draftCleared}
                onDiscard={saved.cfg && maySave ? discardDraft : null} />
            )}
            {project && origin === 'saved' && fromDrawing && <span>{t(`已载入正式版本 v${saved.version}。`, `Loaded saved version v${saved.version}.`)}</span>}
            {newerDrawing && (
              <span style={{ color: 'var(--warning)' }} data-testid="led-newer-drawing">
                {t('图纸校核有更新，是否重新带入？', 'The drawing review has changed — carry it in again?')}{' '}
                <button style={{ textDecoration: 'underline', color: 'var(--navy700)', fontSize: 12 }} onClick={() => carryFrom(reviewed.d!.id)}>{t('重新带入', 'Carry in')}</button>
              </span>
            )}
            {project && (
              <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {reviewed.d
                  ? <button style={{ fontSize: 12, textDecoration: 'underline', color: 'var(--navy700)' }} data-testid="led-recarry"
                      onClick={() => carryFrom(reviewed.d!.id)}>{t('重新从图纸带入', 'Carry in from the drawing again')}</button>
                  : <button style={{ fontSize: 12, textDecoration: 'underline', color: 'var(--navy700)' }}
                      onClick={() => go('ledingest')}>{t('去 02–04 上传图纸', 'Upload a drawing in 02–04')}</button>}
              </span>
            )}
            {!!fromDrawing?.notes?.length && (
              <div style={{ display: 'grid', gap: 4, color: 'var(--warning)' }} data-testid="led-image-notes">
                {fromDrawing.notes.map((n) => <div key={n}>· {n}</div>)}
              </div>
            )}
            {maySave && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn-navy sm" disabled={!result.layout || !!result.manualBlock} onClick={saveToProject} data-testid="led-save"
                  title={result.manualBlock ? (lang === 'en' ? result.manualBlock.en : result.manualBlock.zh) : undefined}
                  style={!result.layout || result.manualBlock ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}>
                  {t('保存方案到项目', 'Save to project')}
                </button>
                {result.manualBlock && <span style={{ color: 'var(--danger)' }}>{t('人工调整有违规：已自动存草稿，改好后才能存正式版本', 'Manual wiring breaks the rules: kept as a draft; fix it to save a version')}</span>}
                {savedMsg.startsWith('ok') && (
                  <span style={{ color: 'var(--success)' }}>
                    {t(`已保存为正式版本 v${savedMsg.slice(3)}。`, `Saved as v${savedMsg.slice(3)}. `)}
                    <button style={{ textDecoration: 'underline', color: 'var(--navy700)', fontSize: 12 }}
                      onClick={() => setView({ name: 'avcostquote', sub: 'cost', line: 'led' })}>{t('去 06 成本核算', 'Open 06 costing')}</button>
                  </span>
                )}
                {savedMsg.startsWith('✕') && <span style={{ color: 'var(--danger)' }}>{savedMsg}</span>}
              </div>
            )}
          </div>

          <Field label={t('规则包', 'Rule pack')}>
            <select value={packV} onChange={(e) => setPackVersion(e.target.value)} disabled={!!bound || !!fromDrawing?.packVersion} data-testid="led-pack">
              {listRulePacks().map((p) => <option key={p.version} value={p.version}>{p.version}</option>)}
            </select>
            {(bound || fromDrawing?.packVersion) && (
              <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
                {t('立项时绑定，锁定不可改（历史项目按创建时版本计算）', 'Bound at inquiry; locked')}
              </div>
            )}
          </Field>

          <Field label={t('屏体类型（参数组）', 'Screen type (parameter group)')}>
            <select value={cfg.led_screen_type} onChange={(e) => switchType(e.target.value as ScreenType)}>
              {Object.values(pack.profiles).map((p) => (
                <option key={p.code} value={p.code}>
                  {p.label} · {p.wSqm} W/㎡ {p.calibrated ? '' : t('（待校准）', '(uncalibrated)')}
                </option>
              ))}
            </select>
          </Field>

          {!profile.calibrated && (
            <div style={{ fontSize: 12, lineHeight: 1.7, padding: '9px 11px', borderRadius: 6,
              background: SEVERITY.warn.bg, color: SEVERITY.warn.fg }}>{profile.note}</div>
          )}

          <Two>
            <Field label={t('屏体开口宽 mm', 'Opening W mm')}>
              <input type="number" value={cfg.led_opening_w} readOnly={locked('led_opening_w')} onChange={(e) => set('led_opening_w', +e.target.value)} />
              {src('led_opening_w')}
            </Field>
            <Field label={t('屏体开口高 mm', 'Opening H mm')}>
              <input type="number" value={cfg.led_opening_h} readOnly={locked('led_opening_h')} onChange={(e) => set('led_opening_h', +e.target.value)} />
              {src('led_opening_h')}
            </Field>
            <Field label={t('模组宽 mm', 'Module W mm')}>
              <input type="number" value={modW} onChange={(e) => set('led_mod', [+e.target.value, modH])} />
            </Field>
            <Field label={t('模组高 mm', 'Module H mm')}>
              <input type="number" value={modH} onChange={(e) => set('led_mod', [modW, +e.target.value])} />
            </Field>
          </Two>

          <Field label={t('箱体库（宽×高，逗号分隔）', 'Cabinet library')}>
            <input value={libText} onChange={(e) => setLibText(e.target.value)} />
          </Field>

          <Field label={t('主力箱体', 'Primary cabinet')}>
            <select value={`${cfg.led_cabinet[0]}x${cfg.led_cabinet[1]}`}
              onChange={(e) => set('led_cabinet', parseLib(e.target.value)[0] ?? cfg.led_cabinet)}>
              {lib.map((s) => <option key={`${s[0]}x${s[1]}`} value={`${s[0]}x${s[1]}`}>{s[0]} × {s[1]}</option>)}
            </select>
          </Field>

          <Two>
            <Field label={t('点间距 P', 'Pitch P')}>
              <input type="number" step="0.01" value={cfg.led_pitch} onChange={(e) => set('led_pitch', +e.target.value)} />
            </Field>
            <Field label={t('亮度 nit', 'Brightness nit')}>
              <input type="number" value={cfg.led_nits} onChange={(e) => set('led_nits', +e.target.value)} />
            </Field>
            <Field label={t('刷新率 Hz', 'Refresh Hz')}>
              <select value={cfg.led_refresh} onChange={(e) => set('led_refresh', +e.target.value as 1920 | 3840)}>
                <option value={1920}>1920</option><option value={3840}>3840</option>
              </select>
            </Field>
            <Field label={t('电源线规格', 'Power cable')}>
              <input value={cfg.led_power_cable} onChange={(e) => set('led_power_cable', e.target.value)} />
            </Field>
            <Field label={t('网线走法', 'Data cabling')}>
              <select value={cfg.led_data_mode ?? 'row'} onChange={(e) => setDataMode(e.target.value as 'row' | 'snake')}
                disabled={result.wiring?.algo === 'columns'} data-testid="led-data-mode">
                <option value="row">{t('每行一条', 'One run per row')}</option>
                <option value="snake">{t('蛇形按带载', 'Serpentine by load')}</option>
              </select>
              {result.wiring?.algo === 'columns' && <span style={{ display: 'block', fontSize: 11, color: 'var(--text2)', marginTop: 3 }}>{t('led@1.0 按每行条数公式，升级后可选', 'led@1.0 uses the per-row formula; upgrade to choose')}</span>}
            </Field>
            <Field label={t('安装方式', 'Installation')}>
              <select value={cfg.led_install} onChange={(e) => set('led_install', e.target.value as LedConfig['led_install'])}>
                <option value="steel">{t('钢结构', 'Steel frame')}</option>
                <option value="wall">{t('壁挂', 'Wall mount')}</option>
                <option value="hoist">{t('吊装', 'Hoisted')}</option>
              </select>
            </Field>
            <Field label={t('维护方式', 'Maintenance')}>
              <select value={cfg.led_maintain} onChange={(e) => set('led_maintain', e.target.value as LedConfig['led_maintain'])}>
                <option value="front">{t('前维护', 'Front')}</option>
                <option value="rear">{t('后维护', 'Rear')}</option>
              </select>
            </Field>
            <Field label={t('控制系统', 'Control system')}>
              <select value={cfg.led_ctrl_brand} onChange={(e) => set('led_ctrl_brand', e.target.value as LedConfig['led_ctrl_brand'])}>
                <option value="novastar">{t('诺瓦', 'NovaStar')}</option>
                <option value="colorlight">{t('卡莱特', 'Colorlight')}</option>
                <option value="other">{t('其他', 'Other')}</option>
              </select>
            </Field>
          </Two>

          <div className="section-label" style={{ marginTop: 4 }}>{t('图纸带入（04 校核后只读）', 'From 04 review')}</div>
          <Two>
            <Field label={t('安装标高 mm', 'Mount height mm')}>
              <input type="number" value={cfg.led_mount_h ?? ''} placeholder="—" readOnly={locked('led_mount_h')}
                onChange={(e) => set('led_mount_h', e.target.value === '' ? undefined : +e.target.value)} />
              {src('led_mount_h')}
            </Field>
            <Field label={t('最近观看距离 m', 'Min viewing dist m')}>
              <input type="number" step="0.1" value={cfg.led_view_min ?? ''} placeholder={fromDrawing?.pending?.includes('led_view_min') ? t('待补', 'to fill') : '—'} readOnly={locked('led_view_min')}
                onChange={(e) => set('led_view_min', e.target.value === '' ? undefined : +e.target.value)} />
              {src('led_view_min')}
            </Field>
            <Field label={t('控制室距离 m', 'Control room m')}>
              <input type="number" step="0.1" value={cfg.led_ctrl_dist ?? ''} placeholder={fromDrawing?.pending?.includes('led_ctrl_dist') ? t('待补', 'to fill') : '—'} readOnly={locked('led_ctrl_dist')}
                onChange={(e) => set('led_ctrl_dist', e.target.value === '' ? undefined : +e.target.value)} />
              {src('led_ctrl_dist')}
            </Field>
            <Field label={t('强电井距离 m', 'Power riser m')}>
              <input type="number" step="0.1" value={cfg.led_pwr_dist ?? ''} placeholder={fromDrawing?.pending?.includes('led_pwr_dist') ? t('待补', 'to fill') : '—'} readOnly={locked('led_pwr_dist')}
                onChange={(e) => set('led_pwr_dist', e.target.value === '' ? undefined : +e.target.value)} />
              {src('led_pwr_dist')}
            </Field>
          </Two>

          <div style={{ fontSize: 11, lineHeight: 1.8, color: 'var(--text2)', borderTop: '1px solid var(--row-line)', paddingTop: 10 }}>
            {t('公司参数', 'Company')} · {t('单回路', 'Circuit')} {pack.company.circuitKw} kW<br />
            {t('控制系统', 'Control')} · {pack.control.brand} · {pack.control.dataPx.toLocaleString()} px/{t('数据线', 'run')}
          </div>
        </div>
      </div>

      {/* ── 结果与出图 ───────────────────────────────────────── */}
      <div style={{ display: 'grid', gap: 20 }}>

        <div className="panel" style={{ padding: 0 }}>
          <div className="panel-head">
            <span className="panel-title">{t('计算结果', 'Results')}</span>
            <span style={{ fontSize: 11, color: 'var(--text2)' }}>
              {t('点击任一数值展开计算链', 'Click a value to expand its chain')}
            </span>
          </div>
          <div style={{ padding: '16px 18px' }}>
            {ledPackUpgradable(bound) && (
              <div data-testid="led-upgrade" style={{ fontSize: 12.5, lineHeight: 1.75, padding: '9px 12px', borderRadius: 6, marginBottom: 14,
                background: upgrade ? 'var(--hover-bg)' : SEVERITY.warn.bg, color: upgrade ? 'var(--text)' : SEVERITY.warn.fg }}>
                {upgrade ? (
                  <>
                    {t(`正在按规则包 ${LATEST_LED_PACK} 预览。保存后本项目改用 ${LATEST_LED_PACK}，存为新版本；历史版本仍按 ${bound} 不变。`,
                      `Previewing on rule pack ${LATEST_LED_PACK}. Saving switches this project to ${LATEST_LED_PACK} as a new version; earlier versions stay on ${bound}.`)}{' '}
                    <button style={{ textDecoration: 'underline', fontSize: 12 }} onClick={() => setUpgrade('')} data-testid="led-upgrade-undo">{t('不升级', 'Keep current pack')}</button>
                  </>
                ) : (
                  <>
                    {t(`本项目按规则包 ${bound} 计算（立项时绑定）：电源按整列分组、分完不逐路校核，可能超过单回路上限。${LATEST_LED_PACK} 按箱体逐路分配并加了计算依据，可以在重新保存时升级。`,
                      `This project is computed on rule pack ${bound} (bound at inquiry): circuits are grouped by whole column and not checked one by one, so a circuit may exceed the limit. ${LATEST_LED_PACK} assigns cabinets circuit by circuit and shows the calculation basis — you can upgrade when you save again.`)}{' '}
                    {maySave && <button style={{ textDecoration: 'underline', color: 'var(--navy700)', fontSize: 12 }} onClick={() => setUpgrade(project!.id)} data-testid="led-upgrade-go">{t(`预览并升级到 ${LATEST_LED_PACK}`, `Preview and upgrade to ${LATEST_LED_PACK}`)}</button>}
                  </>
                )}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 11 }}>
              {tile('sqm', ['面积 ㎡', 'Area ㎡'], (n) => n.value.toFixed(2))}
              {tile('mods', ['模组', 'Modules'], (n) => `${n.value}`)}
              {tile('px', ['分辨率', 'Resolution'], () => `${trace.px_w?.value}×${trace.px_h?.value}`)}
              {tile('kw', ['功耗 kW', 'Power kW'], (n) => n.value.toFixed(2))}
              {tile('n_power_cable', ['电源线（含备用）', 'Power cables'], (n) => `${n.value}`)}
              {tile('n_data_cable', ['数据线（含备用）', 'Data cables'], (n) => `${n.value}`)}
            </div>

            {openTrace && trace[openTrace] && (
              <div style={{ marginTop: 14, borderTop: '1px solid var(--row-line)', paddingTop: 12 }}>
                <div className="section-label">{t('计算链', 'Calculation chain')}</div>
                <TraceChain trace={trace} start={openTrace} />
              </div>
            )}

            {result.findings.length > 0 && (
              <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
                {result.findings.map((f) => (
                  <div key={f.code} style={{ fontSize: 12.5, lineHeight: 1.75, padding: '9px 12px', borderRadius: 6,
                    background: SEVERITY[f.severity].bg, color: SEVERITY[f.severity].fg }}>
                    <strong>{f.code}</strong> · {lang === 'zh' ? SEVERITY[f.severity].zh : SEVERITY[f.severity].en}
                    {f.gate === 'export' && ` · ${t('仅拦导出', 'export only')}`} — {f.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* AV-019 §2.5 控制与信号源建议 */}
        {result.layout && (
          <LedCtrlCard projectId={project?.id ?? null} payload={payload} packVersion={packV} model={cfg.led_ctrl_model}
            onModel={(m) => setCfg((prev) => { const { led_ctrl_model: _old, ...rest } = prev; return m ? { ...rest, led_ctrl_model: m } : rest; })}
            onInquiry={project ? () => go('avinquiry') : null} />
        )}

        <div className="panel" style={{ padding: 0 }}>
          <div className="panel-head">
            <span className="panel-title">{t('拼接与线路图', 'Layout & wiring')}</span>
            {canExportLed(me) && result.layout && (
              <span style={{ display: 'flex', gap: 8 }}>
                <button className="btn-line" onClick={() => exportFile('svg')}><Icon name="download" size={14} /> SVG</button>
                <button className="btn-line" onClick={() => exportFile('bom')}><Icon name="download" size={14} /> {t('箱体清单', 'Cabinets')}</button>
                <button className="btn-line" onClick={() => exportFile('dxf')}><Icon name="download" size={14} /> DXF</button>
                <button className="btn-line" onClick={() => exportFile('proposal', 'zh')}><Icon name="download" size={14} /> {t('技术方案（中文）', 'Proposal (Chinese)')}</button>
                <button className="btn-line" onClick={() => exportFile('proposal', 'en')}><Icon name="download" size={14} /> {t('技术方案（英文）', 'Proposal (English)')}</button>
              </span>
            )}
          </div>
          <div style={{ padding: '14px 18px' }}>
            {result.layout ? (
              <>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, marginBottom: 10 }} data-testid="led-layers">
                  <span style={{ color: 'var(--text2)' }}>{t('图层', 'Layers')}</span>
                  {LAYER_TOGGLES.map((x) => (
                    <label key={x.key} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                      <input type="checkbox" checked={!hidden.includes(x.key)} onChange={() => toggleLayer(x.key)} data-testid={`led-layer-${x.key}`} />
                      {lang === 'en' ? x.en : x.zh}
                    </label>
                  ))}
                  <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
                    {(['fit', 'full'] as const).map((z) => (
                      <button key={z} className={zoom === z ? 'btn-navy sm' : 'btn-line sm'} onClick={() => setZoom(z)} data-testid={`led-zoom-${z}`}>
                        {z === 'fit' ? t('适应宽度', 'Fit width') : '100%'}
                      </button>
                    ))}
                  </span>
                </div>
                {staleNote && (
                  <div data-testid="led-manual-stale" style={{ fontSize: 12.5, lineHeight: 1.7, padding: '8px 12px', borderRadius: 6, marginBottom: 10, background: SEVERITY.warn.bg, color: SEVERITY.warn.fg }}>
                    {t(`输入已变，人工调整（${staleNote}）已失效，已回到自动结果；原调整留在历史版本里。`,
                      `The inputs changed, so the manual wiring (${staleNote}) no longer fits; back to the automatic result. Saved versions keep the old adjustment.`)}{' '}
                    <button style={{ textDecoration: 'underline', fontSize: 12 }} onClick={() => setStaleNote('')}>{t('知道了', 'OK')}</button>
                  </div>
                )}
                {result.manualBlock && (
                  <div data-testid="led-manual-block" style={{ fontSize: 12.5, lineHeight: 1.7, padding: '8px 12px', borderRadius: 6, marginBottom: 10, background: SEVERITY.block.bg, color: SEVERITY.block.fg }}>
                    {lang === 'en' ? result.manualBlock.en : result.manualBlock.zh}
                  </div>
                )}
                {drawing && (
                  <LedWiringPanel result={result} drawing={drawing} svg={svg} zoom={zoom} by={me?.name ?? ''}
                    override={cfg.led_wiring_override} onOverride={setOverride} />
                )}
                <CalcTable rows={calc} open={openCalc} setOpen={setOpenCalc} />
                {canExportLed(me) && (
                  <p style={{ fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.8, marginTop: 10 }}>
                    {t('DXF 由服务端制图服务渲染：R2010 / 单位 mm / 十个图层（箱体编号、箱体尺寸单独成层），可直接在 AutoCAD 中打开；说明栏带同一份计算依据。',
                      'DXF is rendered on the server: R2010, mm, ten layers (cabinet IDs and sizes on their own layers); the notes panel carries the same calculation basis.')}
                  </p>
                )}
              </>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--text2)' }}>
                {t('排布无解，无法出图。请按上方阻断提示调整屏体尺寸或箱体库。',
                  'No layout solution — resolve the blocking findings above.')}
              </p>
            )}
          </div>
        </div>

        {result.layout && (
          <div className="panel clip" style={{ padding: 0 }}>
            <div className="panel-head"><span className="panel-title">{t('箱体清单', 'Cabinet list')}</span></div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                <tr>
                  {[t('规格', 'Size'), t('数量', 'Qty'), t('模组数/只', 'Modules ea.'), t('状态', 'Status')].map((h) => (
                    <th key={h} style={{ padding: '10px 18px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em',
                      textTransform: 'uppercase', color: 'var(--text2)', background: 'var(--hover-bg)', textAlign: 'left' }}>{h}</th>
                  ))}
                </tr>
                {result.layout.bom.map((b) => (
                  <tr key={`${b.w}x${b.h}`}>
                    <td style={cellStyle}>{b.w} × {b.h}</td>
                    <td style={cellStyle} className="tnum">{b.count}</td>
                    <td style={cellStyle} className="tnum">{b.mods}</td>
                    <td style={{ ...cellStyle, color: b.inLib ? 'var(--success)' : 'var(--warning)' }}>
                      {b.inLib ? t('库内标准', 'In library') : t('库外，需定制', 'Custom build')}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td style={{ ...cellStyle, fontWeight: 700 }}>{t('合计', 'Total')}</td>
                  <td style={{ ...cellStyle, fontWeight: 700 }} className="tnum">{result.layout.cells.length}</td>
                  <td style={cellStyle} colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
    </>
  );
}

const cellStyle: React.CSSProperties = { padding: '10px 18px', borderTop: '1px solid var(--row-line)' };

/* AV-019 §2.2 计算依据表:和技术方案、DXF 说明栏同一份数据(src/av/core/calc.ts) */
function CalcTable({ rows, open, setOpen }: { rows: CalcRow[]; open: string | null; setOpen: (k: string | null) => void }) {
  const { t } = useLang();
  if (!rows.length) return null;
  const th: React.CSSProperties = { padding: '8px 10px', fontSize: 11, fontWeight: 700, color: 'var(--text2)', textAlign: 'left', background: 'var(--hover-bg)' };
  const td: React.CSSProperties = { padding: '8px 10px', borderTop: '1px solid var(--row-line)', verticalAlign: 'top' };
  return (
    <div style={{ marginTop: 14 }} data-testid="led-calc">
      <div className="section-label">{t('计算依据', 'Calculation basis')}
        <span style={{ fontWeight: 400, color: 'var(--text2)', marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>
          {t('点一行看用到的参数 · 技术方案和 DXF 说明栏是同一份', 'Click a row for its parameters · same table as the proposal and the DXF notes')}
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <tbody>
            <tr>{[t('项目', 'Item'), t('计算', 'Calculation'), t('结果', 'Result'), t('来源', 'Source')].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
            {rows.map((r) => (
              <React.Fragment key={r.key}>
                <tr onClick={() => r.params?.length && setOpen(open === r.key ? null : r.key)} style={{ cursor: r.params?.length ? 'pointer' : undefined }} data-testid={`led-calc-${r.key}`}>
                  <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 600 }}>{r.params?.length ? (open === r.key ? '▾ ' : '▸ ') : ''}{r.item}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 12 }}>{r.formula}</td>
                  <td style={{ ...td, fontWeight: 600, color: r.ok === false ? 'var(--danger)' : r.ok ? 'var(--success)' : undefined }} className="tnum">{r.result}</td>
                  <td style={{ ...td, color: 'var(--text2)', fontSize: 11.5 }}>{r.source}</td>
                </tr>
                {open === r.key && r.params && (
                  <tr><td colSpan={4} style={{ ...td, borderTop: 'none', paddingTop: 0, fontSize: 11.5, color: 'var(--text2)' }}>
                    {r.params.map((p) => <div key={p}>· {p}</div>)}
                  </td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* The app's own .field styling: label above, full-width input / select. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field" style={{ marginBottom: 0, minWidth: 0 }}>
      <label>{label}</label>
      {children}
    </div>
  );
}

export const Two = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 11 }}>{children}</div>
);

/* A9 追溯视图 — expand a value to its inputs, and theirs, down to the sources. */
export function TraceChain({ trace, start }: { trace: Record<string, TraceNode>; start: string }) {
  const { t } = useLang();
  const rows: { node: TraceNode; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (key: string, depth: number) => {
    const node = trace[key];
    if (!node || seen.has(key)) return;
    seen.add(key);
    rows.push({ node, depth });
    node.inputs.forEach((k) => walk(k, depth + 1));
  };
  walk(start, 0);

  return (
    <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
      {rows.map(({ node, depth }) => (
        <div key={node.key} style={{ fontSize: 12, lineHeight: 1.7, paddingLeft: depth * 18,
          color: depth === 0 ? 'var(--text1)' : 'var(--text2)' }}>
          <span className="tnum" style={{ fontWeight: depth === 0 ? 700 : 400 }}>
            {node.key} = {Number(node.value.toPrecision(10))} {node.unit}
          </span>
          {' · '}
          <span>{node.prov.rule ? `rule · ${node.prov.rule}` : node.prov.method}</span>
          {' · '}
          <span>{typeof node.prov.confidence === 'number'
            ? `${t('置信', 'confidence')} ${node.prov.confidence}`
            : node.prov.confidence}</span>
          {' · '}
          <span>{node.prov.source}</span>
          {node.prov.note ? <span style={{ color: 'var(--warning)' }}> · {node.prov.note}</span> : null}
        </div>
      ))}
    </div>
  );
}
