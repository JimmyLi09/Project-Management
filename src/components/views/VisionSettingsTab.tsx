'use client';

/* ===== AV-015 §3 · 规则设置 › 识别服务 (PD / BD) =====
   The local vision model the 02–04 picture flow uses: on / off, which model,
   where Ollama listens (this machine or the intranet only), how long a picture
   may take, and when an idle model is unloaded. 「检测状态」 answers the four
   questions an admin has: is the service up, is the model there, GPU or CPU,
   and how long did the last picture take. Technical detail belongs here, not
   on a colleague's screen. */

import React, { useEffect, useState } from 'react';
import { fmtDate } from '@/lib/project';
import { useLang } from '@/lib/i18n';
import type { VisionSettings, VisionStatus } from '@/server/avvision';

type LastRun = { at: number; ms: number; model: string; engine: string; fallback: string } | null;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init).catch(() => null);
  const body = res ? await res.json().catch(() => ({})) : { error: '网络错误' };
  if (!res?.ok || body.error) throw new Error(body.error || '请求失败');
  return body as T;
}

export default function VisionSettingsTab() {
  const { t } = useLang();
  const [s, setS] = useState<VisionSettings | null>(null);
  const [last, setLast] = useState<LastRun>(null);
  const [status, setStatus] = useState<VisionStatus | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    call<{ settings: VisionSettings; lastRun: LastRun }>('/api/av/vision')
      .then((r) => { setS(r.settings); setLast(r.lastRun); })
      .catch((e) => setError((e as Error).message));
  }, []);

  async function save() {
    if (!s) return;
    setBusy('save'); setError(''); setMsg('');
    try {
      const r = await call<{ settings: VisionSettings }>('/api/av/vision', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) });
      setS(r.settings); setMsg(t('已保存。', 'Saved.'));
    } catch (e) { setError((e as Error).message); }
    setBusy('');
  }

  async function check(warm: boolean) {
    setBusy(warm ? 'warm' : 'check'); setError(''); setMsg('');
    try {
      const r = await call<{ status: VisionStatus; lastRun: LastRun }>('/api/av/vision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ warm }) });
      setStatus(r.status); setLast(r.lastRun);
    } catch (e) { setError((e as Error).message); }
    setBusy('');
  }

  if (!s) return <div className="panel" style={{ padding: 18, fontSize: 13, color: error ? 'var(--danger)' : 'var(--text2)' }}>{error || t('加载中…', 'Loading…')}</div>;

  const set = <K extends keyof VisionSettings>(k: K, v: VisionSettings[K]) => setS({ ...s, [k]: v });
  const ok = (b: boolean) => <span style={{ color: b ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>{b ? '●' : '○'}</span>;
  const proc = status && {
    gpu: t('显卡（GPU）', 'GPU'), cpu: t('处理器（CPU，较慢）', 'CPU (slower)'), mixed: t('显卡 + 处理器（显存不够，部分在 CPU）', 'GPU + CPU (not enough VRAM)'),
    not_loaded: t('模型未加载 —— 点「预热并检测」才知道', 'Not loaded — use "Warm up & check" to find out'), unknown: t('查不到', 'Unknown'),
  }[status.processor];

  return (
    <div style={{ display: 'grid', gap: 16 }} data-testid="vision-settings">
      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head">
          <span className="panel-title">{t('识别服务（本机视觉模型）', 'Recognition service (local vision model)')}</span>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>{t('免费 · 开源模型 · 图片不出内网', 'Free · open model · pictures stay on the intranet')}</span>
        </div>
        <div style={{ padding: '16px 18px', display: 'grid', gap: 12, maxWidth: 640 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={s.enabled} onChange={(e) => set('enabled', e.target.checked)} data-testid="vision-enabled" />
            {t('启用本机视觉模型（关掉后图片一律退回文字识别 / 手填）', 'Use the local vision model (off: pictures go to OCR / manual entry)')}
          </label>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="vision-model">{t('模型名', 'Model')}</label>
            <input id="vision-model" value={s.model} onChange={(e) => set('model', e.target.value)} />
            <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 4 }}>
              {t('默认 qwen2.5vl:7b（Apache-2.0，可商用）。换模型前确认许可证允许商用 —— Qwen2.5-VL 3B 是「仅研究用途」许可，不能用。',
                'Default qwen2.5vl:7b (Apache-2.0, commercial use allowed). Check the licence before switching — Qwen2.5-VL 3B is research-only.')}
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="vision-url">{t('服务地址', 'Service address')}</label>
            <input id="vision-url" value={s.url} onChange={(e) => set('url', e.target.value)} />
            <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 4 }}>{t('只能是本机（127.0.0.1）或公司内网地址。', 'This machine (127.0.0.1) or an intranet address only.')}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="vision-timeout">{t('超时（秒）', 'Timeout (s)')}</label>
              <input id="vision-timeout" type="number" min={30} max={900} value={s.timeoutSec} onChange={(e) => set('timeoutSec', Number(e.target.value))} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="vision-keep">{t('空闲多少分钟后卸载模型', 'Unload after idle (min)')}</label>
              <input id="vision-keep" type="number" min={0} max={720} value={s.keepAliveMin} onChange={(e) => set('keepAliveMin', Number(e.target.value))} />
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>
            {t('模型常驻约占 6 GB 内存；服务器 16 GB，空闲卸载可以把内存还给平台。超时后这张图自动改为手填。',
              'A loaded model holds ~6 GB of RAM; unloading when idle gives it back. A picture over the timeout falls back to manual entry.')}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn-navy sm" disabled={!!busy} onClick={save} data-testid="vision-save">{t('保存', 'Save')}</button>
            {s.updatedBy && <span style={{ fontSize: 12, color: 'var(--text2)' }}>{t(`上次由 ${s.updatedBy} 修改`, `Last changed by ${s.updatedBy}`)} · {fmtDate(new Date(s.updatedAt))}</span>}
            {msg && <span style={{ color: 'var(--success)', fontSize: 12.5 }}>{msg}</span>}
          </div>
        </div>
      </div>

      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head">
          <span className="panel-title">{t('检测状态', 'Status')}</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="btn-line sm" disabled={!!busy} onClick={() => check(false)} data-testid="vision-check">{busy === 'check' ? t('检测中…', 'Checking…') : t('检测状态', 'Check')}</button>
            <button className="btn-line sm" disabled={!!busy} onClick={() => check(true)} data-testid="vision-warm">{busy === 'warm' ? t('加载模型中…', 'Loading…') : t('预热并检测（加载模型）', 'Warm up & check')}</button>
          </span>
        </div>
        <div style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: '150px 1fr', gap: '8px 12px', fontSize: 13 }} data-testid="vision-status">
          {status ? <>
            <b>{t('服务', 'Service')}</b>
            <span>{ok(status.service.ok)} {status.service.ok ? t(`在运行 · Ollama ${status.service.version}`, `Running · Ollama ${status.service.version}`) : t('连不上', 'Not reachable')}
              {status.service.error && <span style={{ color: 'var(--text2)', fontSize: 12 }}> · {status.service.error}</span>}</span>
            <b>{t('模型', 'Model')}</b>
            <span>{ok(status.model.installed)} {status.settings.model}{' '}
              {status.model.installed
                ? <span style={{ color: 'var(--text2)', fontSize: 12 }}>· {[status.model.params, status.model.quant, status.model.sizeGb !== null ? `${status.model.sizeGb} GB` : '', status.model.license].filter(Boolean).join(' · ')}</span>
                : status.service.ok && <span style={{ color: 'var(--danger)', fontSize: 12 }}>· {t('没装 —— 按上线操作单拉取模型', 'not installed — pull it per the runbook')}</span>}
            </span>
            <b>{t('用什么跑', 'Runs on')}</b><span>{proc}{status.vramGb ? ` · ${t('显存', 'VRAM')} ${status.vramGb} GB` : ''}</span>
            <b>{t('文字识别（OCR）', 'OCR')}</b><span>{ok(status.ocr)} {status.ocr ? t('已安装（视觉模型不可用时退回它）', 'Installed (fallback)') : t('没装（视觉模型不可用时直接手填）', 'Not installed (falls back to manual)')}</span>
            <b>{t('服务地址', 'Address')}</b><span>{ok(status.urlLocal)} {status.settings.url}</span>
          </> : <span style={{ gridColumn: '1 / -1', color: 'var(--text2)' }}>{t('点「检测状态」查看服务在不在、模型装没装、用 GPU 还是 CPU。', 'Press "Check" to see whether the service and model are there, and GPU or CPU.')}</span>}
          <b>{t('最近一次识别', 'Last picture')}</b>
          <span>{last ? <>{fmtDate(new Date(last.at))} · {last.engine === 'vision'
            ? t(`本机视觉模型 ${last.model}，用时 ${Math.round(last.ms / 1000)} 秒`, `local model ${last.model}, ${Math.round(last.ms / 1000)} s`)
            : t(`没用上视觉模型（${last.fallback || '—'}），改为${last.engine === 'ocr' ? '文字识别' : '手填'}`, `vision model not used (${last.fallback || '—'}), ${last.engine}`)}</> : t('还没有识别过图片', 'No picture yet')}</span>
        </div>
      </div>
      {error && <div style={{ fontSize: 12.5, padding: '9px 12px', borderRadius: 6, background: 'var(--danger-bg, #FDF0EC)', color: 'var(--danger)' }}>{error}</div>}
    </div>
  );
}
