'use client';

/* ===== 资料库 · 投影常数确认(AV-020 §3.7) =====
   prj@0.2 的每个常数:值、来源(公司填写 / 样本反推 / 草案 / 行业常规 / 公司常量)、依据,
   谁在什么时候确认的。PD 逐项确认,全部确认后发布 prj@1.0:新项目绑 1.0,导出不再标
   「部分常数待校准」,prj@0.2 的项目在 05 可升级。改数值不在这里 —— 要出新版本。 */

import React, { useCallback, useEffect, useState } from 'react';

import { PRJ_SOURCE_LABEL, prjConstValue, type PrjConstSource } from '@/av/core/prj/rulepack';
import { fmtDate } from '@/lib/project';
import { useLang } from '@/lib/i18n';

interface Row { key: string; zh: string; en: string; unit: string; value: unknown; src: PrjConstSource; note: string; noteEn: string; confirmed: { by: string; at: number } | null }
interface State { pack: string; releasePack: string; latest: string; release: { pack: string; by: string; at: number } | null; constants: Row[]; allConfirmed: boolean; canConfirm: boolean }

export default function PrjConstantsView() {
  const { t, lang } = useLang();
  const en = lang === 'en';
  const [st, setSt] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/av/prj-pack').catch(() => null);
    const b = res ? await res.json().catch(() => ({})) : { error: t('网络错误', 'Network error') };
    if (!res?.ok || b.error) setError(b.error || t('加载失败', 'Could not load'));
    else setSt(b);
  }, [t]);
  useEffect(() => { load(); }, [load]);

  async function post(body: Record<string, unknown>) {
    setBusy(true); setError('');
    const res = await fetch('/api/av/prj-pack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, lang }) }).catch(() => null);
    const b = res ? await res.json().catch(() => ({})) : { error: t('网络错误', 'Network error') };
    setBusy(false);
    if (!res?.ok || b.error) setError(b.error || t('没保存上', 'Not saved'));
    else setSt(b);
  }
  const publish = () => {
    if (!st) return;
    const ok = window.confirm(t(
      `发布 ${st.releasePack}？\n\n· 之后新建的投影项目绑 ${st.releasePack}，导出的 DXF / 技术方案不再标「部分常数待校准」；\n· 已有 ${st.pack} 项目结果不变，05 里可以升级；\n· 发布后这里不能撤回（回退见上线操作单）。`,
      `Publish ${st.releasePack}?\n\n· New projection projects bind ${st.releasePack}; exports are no longer marked uncalibrated.\n· Existing ${st.pack} projects keep their results and can upgrade in 05.\n· This cannot be undone here (see the deployment sheet for rollback).`));
    if (ok) post({ publish: true });
  };

  if (!st) return <div className="panel" style={{ padding: '16px 18px', fontSize: 13, color: error ? 'var(--danger)' : 'var(--text2)' }}>{error || t('加载中…', 'Loading…')}</div>;
  const done = st.constants.filter((c) => c.confirmed).length;
  const th: React.CSSProperties = { padding: '9px 12px', fontSize: 11, fontWeight: 700, color: 'var(--text2)', background: 'var(--hover-bg)', textAlign: 'left', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '9px 12px', borderTop: '1px solid var(--row-line)', verticalAlign: 'top', fontSize: 12.5 };
  const stamp = (c: { by: string; at: number }) => `${c.by} · ${fmtDate(new Date(c.at))}`;

  return (
    <div className="panel" style={{ padding: 0 }} data-testid="prj-const">
      <div className="panel-head" style={{ flexWrap: 'wrap', gap: 10 }}>
        <span className="panel-title">{t(`投影规则包常数 · ${st.pack}`, `Projection rule pack constants · ${st.pack}`)}</span>
        <span style={{ fontSize: 12, color: 'var(--text2)' }} data-testid="prj-const-progress">
          {st.release
            ? t(`${st.release.pack} 已发布 · ${stamp(st.release)}`, `${st.release.pack} published · ${stamp(st.release)}`)
            : t(`已确认 ${done} / ${st.constants.length}`, `${done} of ${st.constants.length} confirmed`)}
        </span>
        {st.canConfirm && !st.release && (
          <button className="btn-navy sm" style={{ marginLeft: 'auto', ...(st.allConfirmed ? {} : { opacity: 0.45, cursor: 'not-allowed' }) }} disabled={!st.allConfirmed || busy}
            onClick={publish} data-testid="prj-const-publish" title={st.allConfirmed ? undefined : t('全部常数确认后才能发布', 'Confirm every constant first')}>
            {t(`发布 ${st.releasePack}`, `Publish ${st.releasePack}`)}
          </button>
        )}
      </div>
      <div style={{ padding: '10px 18px', fontSize: 12, color: 'var(--text2)', lineHeight: 1.75 }}>
        {t('这些数决定台数、画面、照度、机位、用电和 06 的配套数量，现在都是从三个完工样本（MY014 / 114 / MY016）和填写表反推的初值。PD 逐项核对后点「确认」；全部确认后发布正式版。要改某个数值请联系开发：改值会出新版本，已有项目的结果不变。',
          'These numbers drive projector count, image size, illuminance, positions, power and the 06 quantities. They are initial values derived from three finished projects and the questionnaire. The PD checks each and confirms; once all are confirmed the release can be published. To change a value, ask development: a change is a new version and existing projects keep their results.')}
        {!st.canConfirm && <> {t('（只有 PD 能确认和发布）', '(Only the PD confirms and publishes.)')}</>}
      </div>
      {error && <div style={{ margin: '0 18px 10px', fontSize: 12.5, color: 'var(--danger)' }}>{error}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
          <tbody>
            <tr>{[t('常数', 'Constant'), t('值', 'Value'), t('来源', 'Source'), t('依据', 'Basis'), t('状态', 'Status'), ''].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr>
            {st.constants.map((c) => (
              <tr key={c.key} data-testid={`prj-const-${c.key}`}>
                <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{en ? c.en : c.zh}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }} className="tnum">{prjConstValue(c.value)}{c.unit ? ` ${c.unit}` : ''}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{PRJ_SOURCE_LABEL[c.src][en ? 1 : 0]}</td>
                <td style={{ ...td, color: 'var(--text2)' }}>{en ? c.noteEn : c.note}</td>
                <td style={{ ...td, whiteSpace: 'nowrap', color: c.confirmed || st.release ? 'var(--success)' : 'var(--warning)' }}>
                  {c.confirmed ? t(`✓ 已确认 · ${stamp(c.confirmed)}`, `✓ Confirmed · ${stamp(c.confirmed)}`) : t('待确认', 'To confirm')}
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                  {st.canConfirm && !st.release && (
                    <button className={c.confirmed ? 'btn-line sm' : 'btn-navy sm'} disabled={busy} onClick={() => post({ key: c.key, confirmed: !c.confirmed })} data-testid={`prj-const-btn-${c.key}`}>
                      {c.confirmed ? t('取消确认', 'Undo') : t('确认', 'Confirm')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
