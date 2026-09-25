'use client';

/* ===== 02 图纸接入 · 03 解析提取 · 04 人工校核 =====
   Upload a drawing, see the six §4.1 elements the drawing service extracted with
   their provenance, confirm or correct them side by side, and hand the
   reviewed values to 05. §1: this is the only quality gate — past it, every
   number is deterministic. */

import React, { useState } from 'react';

import {
  finalValue, isPending, REQUIRED_ELEMENTS, toHandoff,
  type DrawingElement, type IngestRecord, type IngestResult,
} from '@/av/core/handoff';
import { canReviewDrawing, canUploadDrawing } from '@/lib/permissions';
import { useLang } from '@/lib/i18n';
import { useStore } from '../store';
import { Icon } from '../ui';

const ELEMENT_LABEL: Record<DrawingElement, [string, string]> = {
  led_opening_w: ['屏体开口宽', 'Opening width'],
  led_opening_h: ['屏体开口高', 'Opening height'],
  led_mount_h: ['安装标高', 'Mounting height'],
  led_ctrl_dist: ['控制室距离', 'Control room distance'],
  led_pwr_dist: ['强电井距离', 'Power riser distance'],
  led_view_min: ['最近观看距离', 'Min viewing distance'],
};

const GRADE: Record<IngestResult['grade'], { zh: string; en: string; fg: string; bg: string }> = {
  A: { zh: 'A 级 · DXF · 规则读取', en: 'A · DXF · rule-based', fg: 'var(--success)', bg: 'var(--success-bg, #E4EFE9)' },
  B: { zh: 'B 级 · 矢量 PDF · 按比例尺量取', en: 'B · vector PDF · scaled', fg: 'var(--navy700)', bg: 'var(--hover-bg)' },
  C: { zh: 'C 级 · 扫描件 · 仅辅助识别', en: 'C · scan · assist only', fg: 'var(--warning)', bg: 'var(--warning-bg, #FDF7F1)' },
};

const METHOD_LABEL: Record<string, [string, string]> = {
  rule: ['规则', 'Rule'], manual: ['人工', 'Manual'], lookup: ['库查询', 'Lookup'],
  ai_ocr: ['AI · OCR', 'AI · OCR'], ai_vision: ['AI · 视觉', 'AI · vision'],
};

export default function LedIngestView() {
  const { me, ledIngest, setLedIngest, setLedHandoff, go } = useStore();
  const { t, lang } = useLang();
  const [file, setFile] = useState<File | null>(null);
  const [scale, setScale] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /* In-progress corrections, as typed; applied to the record on 确认. */
  const [draft, setDraft] = useState<Partial<Record<DrawingElement, string>>>({});

  const mayUpload = canUploadDrawing(me);
  const mayReview = canReviewDrawing(me);
  const isPdf = !!file && file.name.toLowerCase().endsWith('.pdf');

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError('');
    const form = new FormData();
    form.append('file', file);
    if (isPdf && scale.trim()) form.append('scale', scale.trim());
    const res = await fetch('/api/av/ingest', { method: 'POST', body: form }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : { error: t('网络错误', 'Network error') };
    setBusy(false);
    if (!res?.ok || body.error) { setError(body.error || t('解析失败', 'Extraction failed')); return; }
    setDraft({});
    setLedIngest(body as IngestResult);
  }

  function update(element: DrawingElement, patch: Partial<IngestRecord>) {
    if (!ledIngest) return;
    setLedIngest({
      ...ledIngest,
      extractions: ledIngest.extractions.map((r) => (r.element === element ? { ...r, ...patch } : r)),
    });
  }

  function confirm(r: IngestRecord) {
    const typed = draft[r.element];
    const corrected = typed !== undefined && typed.trim() !== '' ? Number(typed) : null;
    if (corrected !== null && !(corrected >= 0)) { setError(t('人工值须为非负数', 'Value must be ≥ 0')); return; }
    setError('');
    update(r.element, { confirmed: true, corrected: corrected !== null && corrected !== r.value ? corrected : null });
  }

  async function submit() {
    if (!ledIngest) return;
    setBusy(true);
    setError('');
    const res = await fetch('/api/av/review', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ledIngest),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : { error: t('网络错误', 'Network error') };
    setBusy(false);
    if (!res?.ok || body.error) { setError(body.error || t('提交失败', 'Submit failed')); return; }
    if (!body.may_enter_configuration) {
      setError(t('服务端复核未通过：仍有待确认的要素。', 'Server re-check: items still pending.'));
      return;
    }
    setLedHandoff(toHandoff(body.reviewed as IngestResult));
    setLedIngest(null);
    go('ledstudio');
  }

  const pending = ledIngest ? ledIngest.extractions.filter(isPending) : [];

  return (
    <div style={{ display: 'grid', gap: 20 }}>

      {/* ── 02 图纸接入与分级 ─────────────────────────────────── */}
      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head">
          <span className="panel-title">{t('02 · 图纸接入与分级', '02 · Drawing intake')}</span>
          <span style={{ fontSize: 11, color: 'var(--text2)' }}>DXF · PDF · PNG / JPG / TIF</span>
        </div>
        <div style={{ padding: '16px 18px', display: 'grid', gap: 14 }}>
          {mayUpload ? (
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="field" style={{ marginBottom: 0, flex: '1 1 320px' }}>
                <label>{t('图纸文件', 'Drawing file')}</label>
                <input type="file" accept=".dxf,.pdf,.png,.jpg,.jpeg,.tif,.tiff"
                  onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(''); }} />
              </div>
              {isPdf && (
                <div className="field" style={{ marginBottom: 0, width: 190 }}>
                  <label>{t('比例尺标定 1 :', 'Scale 1 :')}</label>
                  <input type="number" min="1" placeholder="50" value={scale} onChange={(e) => setScale(e.target.value)} />
                </div>
              )}
              <button className="btn-navy" disabled={!file || busy} onClick={upload} style={dim(!file || busy)}>
                {busy ? t('解析中…', 'Extracting…') : t('上传并解析', 'Upload & extract')}
              </button>
            </div>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--text2)' }}>{t('当前角色无上传图纸权限。', 'Your role cannot upload drawings.')}</p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
            {(['A', 'B', 'C'] as const).map((g) => (
              <div key={g} style={{ fontSize: 12, lineHeight: 1.7, padding: '9px 12px', borderRadius: 6, background: GRADE[g].bg, color: GRADE[g].fg }}>
                <strong>{lang === 'zh' ? GRADE[g].zh : GRADE[g].en}</strong><br />
                {g === 'A' && t('读取实体坐标与图层，不需模型。', 'Entity coordinates and layers; no model.')}
                {g === 'B' && t('须先填写图框比例，比例尺不做推断。', 'Enter the drawing scale first; never inferred.')}
                {g === 'C' && t('OCR 结果仅作参考，全部要素须人工确认（§13.2）。', 'OCR is advisory; every element needs confirmation.')}
              </div>
            ))}
          </div>
          {error && (
            <div style={{ fontSize: 12.5, padding: '9px 12px', borderRadius: 6, background: 'var(--danger-bg, #FDF0EC)', color: 'var(--danger)' }}>{error}</div>
          )}
        </div>
      </div>

      {/* ── 03 解析提取 + 04 人工校核 ────────────────────────── */}
      {ledIngest && (
        <div className="panel clip" style={{ padding: 0 }}>
          <div className="panel-head">
            <span className="panel-title">{t('03 · 解析结果 / 04 · 人工校核', '03 · Extraction / 04 · Review')}</span>
            <span style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12 }}>
              <span>{ledIngest.drawing}</span>
              <span style={{ padding: '3px 9px', borderRadius: 4, background: GRADE[ledIngest.grade].bg, color: GRADE[ledIngest.grade].fg, fontWeight: 700 }}>
                {ledIngest.grade} {t('级', '')}
              </span>
            </span>
          </div>

          {ledIngest.notes.length > 0 && (
            <div style={{ padding: '10px 18px 0', display: 'grid', gap: 4 }}>
              {ledIngest.notes.map((n) => <div key={n} style={{ fontSize: 12, color: 'var(--text2)' }}>· {n}</div>)}
            </div>
          )}

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 980 }}>
              <tbody>
                <tr>
                  {[t('要素', 'Element'), t('系统值', 'Extracted'), t('人工值', 'Reviewed'), t('来源', 'Source'),
                    t('方法', 'Method'), t('置信度', 'Confidence'), t('状态', 'Status')].map((h) => <th key={h} style={th}>{h}</th>)}
                </tr>
                {ledIngest.extractions.map((r) => {
                  const open = isPending(r);
                  const conf = typeof r.prov.confidence === 'number' ? r.prov.confidence : 1;
                  const required = REQUIRED_ELEMENTS.includes(r.element);
                  const typed = draft[r.element];
                  const blankRequired = required && r.value === null && (typed ?? '').trim() === '';
                  return (
                    <tr key={r.element} style={{ background: open ? 'var(--warning-bg, #FDF7F1)' : undefined }}>
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{t(...ELEMENT_LABEL[r.element])}{required && <span style={{ color: 'var(--danger)' }}> *</span>}</div>
                        <div style={{ fontSize: 11, color: 'var(--text2)' }}>{r.element}</div>
                      </td>
                      <td style={td} className="tnum">{r.value === null ? <span style={{ color: 'var(--text2)' }}>{t('未识别', 'Not found')}</span> : `${r.value} ${r.unit}`}</td>
                      <td style={{ ...td, width: 150 }}>
                        {r.confirmed ? (
                          <span className="tnum">{finalValue(r) === null ? t('暂缺', 'n/a') : `${finalValue(r)} ${r.unit}`}
                            {r.corrected !== null && <span style={{ fontSize: 11, color: 'var(--warning)' }}> {t('已修正', 'corrected')}</span>}
                          </span>
                        ) : mayReview ? (
                          <input className="in sm" type="number" style={{ width: 120 }}
                            placeholder={r.value === null ? t('补录', 'enter') : String(r.value)}
                            value={typed ?? ''} onChange={(e) => setDraft({ ...draft, [r.element]: e.target.value })} />
                        ) : '—'}
                      </td>
                      <td style={{ ...td, fontSize: 12, maxWidth: 320 }}>
                        <div>{r.prov.source}</div>
                        {r.prov.note && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{r.prov.note}</div>}
                      </td>
                      <td style={{ ...td, fontSize: 12 }}>
                        {t(...(METHOD_LABEL[r.prov.method] ?? [r.prov.method, r.prov.method]))}
                        {r.prov.rule && <div style={{ fontSize: 11, color: 'var(--text2)' }}>{r.prov.rule}</div>}
                      </td>
                      <td style={{ ...td, width: 130 }}>
                        <div style={{ height: 6, background: 'var(--hover-bg)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.round(conf * 100)}%`, height: '100%',
                            background: conf >= ledIngest.threshold ? 'var(--success)' : 'var(--warning)' }} />
                        </div>
                        <div className="tnum" style={{ fontSize: 11, color: 'var(--text2)', marginTop: 3 }}>
                          {typeof r.prov.confidence === 'number' ? `${Math.round(r.prov.confidence * 100)}%` : r.prov.confidence}
                        </div>
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {r.confirmed ? (
                          <span style={{ color: 'var(--success)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                            <Icon name="checkSm" size={14} />{t('已确认', 'Confirmed')}
                            {mayReview && <button style={{ fontSize: 11, color: 'var(--text2)', textDecoration: 'underline' }}
                              onClick={() => update(r.element, { confirmed: false, corrected: null })}>{t('撤销', 'undo')}</button>}
                          </span>
                        ) : mayReview ? (
                          <button className="btn-line" disabled={blankRequired} onClick={() => confirm(r)} style={dim(blankRequired)}
                            title={blankRequired ? t('必填项须先补录数值', 'Enter a value first') : ''}>
                            {r.value === null && (typed ?? '').trim() === '' ? t('确认暂缺', 'Confirm n/a') : t('确认', 'Confirm')}
                          </button>
                        ) : (
                          <span style={{ color: open ? 'var(--warning)' : 'var(--text2)' }}>{open ? t('待 PM 校核', 'Awaiting PM') : t('无需校核', 'OK')}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ padding: '14px 18px', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--row-line)' }}>
            <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.7 }}>
              {pending.length ? (
                <span style={{ color: 'var(--warning)' }}>
                  {t(`校核闸门：还有 ${pending.length} 项待确认（置信度低于 ${Math.round(ledIngest.threshold * 100)}% 或未识别）。`,
                    `Gate: ${pending.length} item(s) pending review.`)}
                </span>
              ) : (
                <span style={{ color: 'var(--success)' }}>{t('校核闸门已满足，可进入 05 方案配置。', 'Gate satisfied — ready for 05.')}</span>
              )}
              <div style={{ color: 'var(--text2)', fontSize: 11.5 }}>
                {t('这里是唯一的质量闸门，过了这道门后全部是确定性计算。修正值会回写样本库。',
                  'The only quality gate; everything after it is deterministic. Corrections are written back as samples.')}
              </div>
            </div>
            {mayReview && (
              <button className="btn-navy" disabled={busy || pending.length > 0} onClick={submit} style={dim(busy || pending.length > 0)}>
                {t('提交校核，进入 05 方案配置', 'Submit & open 05')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const dim = (disabled: boolean): React.CSSProperties | undefined =>
  disabled ? { opacity: 0.45, cursor: 'not-allowed' } : undefined;

const th: React.CSSProperties = {
  padding: '10px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
  color: 'var(--text2)', background: 'var(--hover-bg)', textAlign: 'left', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { padding: '10px 14px', borderTop: '1px solid var(--row-line)', verticalAlign: 'top' };
