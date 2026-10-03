'use client';

/* ===== AV-019 §2.5 / §2.6 · 05「控制与信号源建议」卡 =====
   推荐型号、为什么(逐条满足的条件)、备选型号;可以手动改选(标「人工选择」)。
   选型在服务端做(设备库 + 01 的回答,和保存方案、技术方案同一套),页面只显示。 */

import React, { useEffect, useRef, useState } from 'react';

import { KIND_LABEL, PC_LABEL, USE_LABEL, type CtrlAdvice, type CtrlCheck, type CtrlDevice } from '@/av/core/controller';
import type { LedConfig } from '@/av/core/types';
import { useLang } from '@/lib/i18n';

type Dev = Omit<CtrlDevice, 'price'> & { priced: boolean };
type Pick = { device: Dev; checks: CtrlCheck[] };
type Advice = Omit<CtrlAdvice, 'primary' | 'alternates' | 'media' | 'pc'> & { primary: Pick | null; alternates: Pick[]; media: Dev | null; pc: Dev | null };
type Resp = { advice: Advice | null; answers: { play_use?: keyof typeof USE_LABEL | null; pc_by?: keyof typeof PC_LABEL | null }; models: Dev[] };

export default function LedCtrlCard({ projectId, payload, packVersion, model, onModel, onInquiry }: {
  projectId: string | null;
  payload: LedConfig;
  packVersion: string;
  model: string | undefined;
  onModel: (m: string | undefined) => void;
  onInquiry: (() => void) | null;
}) {
  const { t, lang } = useLang();
  const L = (x: { zh: string; en: string }) => (lang === 'en' ? x.en : x.zh);
  const k = (pair: [string, string]) => (lang === 'en' ? pair[1] : pair[0]);
  const [data, setData] = useState<Resp | null>(null);
  const seq = useRef(0);
  const key = JSON.stringify([projectId, payload, packVersion]);
  useEffect(() => {
    const my = ++seq.current;
    const h = setTimeout(() => {
      fetch('/api/av/controllers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, cfg: payload, packVersion }) })
        .then((r) => (r.ok ? r.json() : null)).then((b) => { if (my === seq.current) setData(b); }).catch(() => {});
    }, 350);
    return () => clearTimeout(h);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const a = data?.advice;
  const ans = data?.answers ?? {};
  const devName = (d: Dev) => `${d.model} · ${k(KIND_LABEL[d.kind])}${d.priced ? '' : t(' · 待报价', ' · to be quoted')}`;
  return (
    <div className="panel" style={{ padding: 0 }} data-testid="led-ctrl">
      <div className="panel-head">
        <span className="panel-title">{t('控制与信号源建议', 'Control & signal source')}</span>
        {a?.pending && <span className="tag" style={{ color: 'var(--warning)' }} data-testid="led-ctrl-pending">{t('待确认', 'To be confirmed')}</span>}
      </div>
      <div style={{ padding: '14px 18px', display: 'grid', gap: 10, fontSize: 13 }}>
        {!data ? <span style={{ color: 'var(--text2)' }}>{t('计算中…', 'Working…')}</span> : !a ? (
          <span style={{ color: 'var(--text2)' }}>{t('排布无解，或设备库里还没有控制系统型号。', 'No layout, or no control-system models in the device library.')}</span>
        ) : (
          <>
            <div style={{ color: 'var(--text2)', fontSize: 12 }} data-testid="led-ctrl-answers">
              {t('01 · 主要播放：', '01 · Content: ')}{ans.play_use ? k(USE_LABEL[ans.play_use]) : t('还没答', 'not answered')}
              {(ans.play_use === 'meeting' || ans.play_use === 'both') && <>{t(' · 电脑：', ' · PC: ')}{ans.pc_by ? k(PC_LABEL[ans.pc_by]) : t('还没答', 'not answered')}</>}
              {onInquiry && <> · <button style={{ textDecoration: 'underline', color: 'var(--navy700)', fontSize: 12 }} onClick={onInquiry}>{t('去 01 修改', 'Edit in 01')}</button></>}
            </div>
            <div><strong>{t('信号源：', 'Signal: ')}</strong>{L(a.signal)}</div>
            {a.primary ? (
              <div data-testid="led-ctrl-primary">
                <div style={{ fontSize: 16, fontWeight: 700 }}>
                  {a.primary.device.model} <span style={{ fontWeight: 400, fontSize: 13, color: 'var(--text2)' }}>{k(KIND_LABEL[a.primary.device.kind])}</span>
                  {a.manual && <span style={{ fontSize: 12, color: 'var(--warning)', marginLeft: 8 }}>{t('人工选择', 'Chosen by hand')}</span>}
                  {!a.primary.device.priced && <span style={{ fontSize: 12, color: 'var(--warning)', marginLeft: 8 }}>{t('待报价', 'To be quoted')}</span>}
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
                  {a.primary.checks.map((c) => (
                    <span key={c.zh} style={{ color: c.ok ? 'var(--success)' : 'var(--danger)' }}>{c.ok ? '✓' : '✕'} {L(c)}</span>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ color: 'var(--danger)' }} data-testid="led-ctrl-fail">{a.fail && L(a.fail)}</div>
            )}
            {(a.needMedia || a.needPc) && (
              <div>
                {a.needMedia && <div>＋ {t('媒体播放器（HDMI 输出）1 台', 'Media player (HDMI out) × 1')}{a.media && !a.media.priced ? t(' · 待报价', ' · to be quoted') : ''}{!a.media ? t(' · 设备库里还没有这一项', ' · not in the device library yet') : ''}</div>}
                {a.needPc && <div>＋ {t('播控电脑 1 台（我们报）', 'Playback PC × 1 (quoted by us)')}{a.pc && !a.pc.priced ? t(' · 待报价', ' · to be quoted') : ''}</div>}
              </div>
            )}
            <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text2)', fontSize: 12.5, lineHeight: 1.7 }}>
              {a.reason.map((r) => <li key={r.zh}>{L(r)}</li>)}
            </ul>
            {a.alternates.length > 0 && (
              <div style={{ fontSize: 12.5 }}>{t('备选：', 'Alternatives: ')}{a.alternates.map((x) => x.device.model).join(' / ')}</div>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5 }}>
              <span>{t('改选型号', 'Choose another')}</span>
              <select value={model ?? ''} onChange={(e) => onModel(e.target.value || undefined)} data-testid="led-ctrl-model">
                <option value="">{t('按推荐', 'Recommended')}</option>
                {(data.models ?? []).map((d) => <option key={d.model} value={d.model}>{devName(d)}</option>)}
              </select>
              <span style={{ color: 'var(--text2)' }}>{t('结果进 06：控制器、媒体播放器、播控电脑各一行；没价格标「待报价」，不阻断。', '06 gets a row each for controller, media player and PC; unpriced rows say "to be quoted" and do not block.')}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
