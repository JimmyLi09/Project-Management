'use client';

/* ===== 02 图纸接入 · 03 解析提取 · 04 人工校核 =====
   Pick a project, upload a drawing against it, review the six §4.1 elements the
   drawing service extracted — extracted and reviewed values side by side, with
   provenance — and hand the reviewed values to 05. Every confirmation is saved
   to the project as it happens (spec §10), and passing the gate locks the
   drawing. §1: this is the only quality gate; past it, everything is deterministic. */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {
  finalValue, isPending, REQUIRED_ELEMENTS, toHandoff,
  type DrawingElement, type DrawingSummary, type IngestRecord, type StoredDrawing,
} from '@/av/core/handoff';
import { canReviewDrawing, canUploadDrawing } from '@/lib/permissions';
import { fmtDate } from '@/lib/project';
import { useLang } from '@/lib/i18n';
import { useStore } from '../store';
import { Icon } from '../ui';
import AvSteps from './AvSteps';

const ELEMENT_LABEL: Record<DrawingElement, [string, string]> = {
  led_opening_w: ['屏体开口宽', 'Opening width'],
  led_opening_h: ['屏体开口高', 'Opening height'],
  led_mount_h: ['安装标高', 'Mounting height'],
  led_ctrl_dist: ['控制室距离', 'Control room distance'],
  led_pwr_dist: ['强电井距离', 'Power riser distance'],
  led_view_min: ['最近观看距离', 'Min viewing distance'],
};

const GRADE: Record<StoredDrawing['grade'], { zh: string; en: string; fg: string; bg: string }> = {
  A: { zh: 'A 级 · DXF · 规则读取', en: 'A · DXF · rule-based', fg: 'var(--success)', bg: 'var(--success-bg, #E4EFE9)' },
  B: { zh: 'B 级 · 矢量 PDF · 按比例尺量取', en: 'B · vector PDF · scaled', fg: 'var(--navy700)', bg: 'var(--hover-bg)' },
  C: { zh: 'C 级 · 扫描件 · 仅辅助识别', en: 'C · scan · assist only', fg: 'var(--warning)', bg: 'var(--warning-bg, #FDF7F1)' },
};

const METHOD_LABEL: Record<string, [string, string]> = {
  rule: ['规则', 'Rule'], manual: ['人工', 'Manual'], lookup: ['库查询', 'Lookup'],
  ai_ocr: ['AI · OCR', 'AI · OCR'], ai_vision: ['AI · 视觉', 'AI · vision'],
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init).catch(() => null);
  const body = res ? await res.json().catch(() => ({})) : { error: '网络错误' };
  if (!res?.ok || body.error) throw new Error(body.error || '请求失败');
  return body as T;
}

export default function LedIngestView() {
  const { me, projects, ledProjectId, setLedProjectId, ledIngest, setLedIngest, setLedHandoff, go } = useStore();
  const { t, lang } = useLang();
  const [file, setFile] = useState<File | null>(null);
  const [scale, setScale] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [list, setList] = useState<DrawingSummary[]>([]);
  /* Rule pack the project was opened on (01); null = opened outside 01. */
  const [boundPack, setBoundPack] = useState<string | null>(null);
  /* In-progress corrections, as typed; saved with the record on 确认. */
  const [draft, setDraft] = useState<Partial<Record<DrawingElement, string>>>({});

  /* Spec 01: LED drawings belong to a project carrying an LED service package. */
  const ledProjects = useMemo(
    () => projects.filter((p) => !p.archived && p.packages.some((k) => k.svc === 'led')),
    [projects],
  );
  const project = ledProjects.find((p) => p.id === ledProjectId);
  const mayUpload = !!project && canUploadDrawing(me, project);
  const mayReview = !!project && canReviewDrawing(me, project);
  const locked = !!ledIngest?.reviewed_at;
  const isPdf = !!file && file.name.toLowerCase().endsWith('.pdf');

  const refreshList = useCallback(async () => {
    if (!ledProjectId) { setList([]); return; }
    try {
      setList((await call<{ drawings: DrawingSummary[] }>(`/api/av/drawings?project=${encodeURIComponent(ledProjectId)}`)).drawings);
    } catch (e) { setError((e as Error).message); }
  }, [ledProjectId]);

  useEffect(() => { refreshList(); }, [refreshList]);

  useEffect(() => {
    setBoundPack(null);
    if (!ledProjectId) return;
    call<{ inquiry: { packs: Record<string, string> } | null }>(`/api/av/inquiry?project=${encodeURIComponent(ledProjectId)}`)
      .then((r) => setBoundPack(r.inquiry?.packs.led ?? null))
      .catch(() => setBoundPack(null));
  }, [ledProjectId]);

  function pickProject(id: string) {
    setLedProjectId(id);
    if (ledIngest && ledIngest.project_id !== id) setLedIngest(null);
    setError('');
  }

  async function open(id: number) {
    setError('');
    try { setDraft({}); setLedIngest(await call<StoredDrawing>(`/api/av/drawings/${id}`)); }
    catch (e) { setError((e as Error).message); }
  }

  async function upload() {
    if (!file || !project) return;
    setBusy(true);
    setError('');
    const form = new FormData();
    form.append('project', project.id);
    form.append('file', file);
    if (isPdf && scale.trim()) form.append('scale', scale.trim());
    try {
      setDraft({});
      setLedIngest(await call<StoredDrawing>('/api/av/ingest', { method: 'POST', body: form }));
      refreshList();
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  /* Save one confirm / undo straight away; the server returns the stored drawing. */
  async function save(r: IngestRecord, confirmed: boolean, corrected: number | null) {
    if (!ledIngest) return;
    setError('');
    try {
      const res = await call<{ drawing: StoredDrawing }>('/api/av/review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ledIngest.id, changes: [{ element: r.element, confirmed, corrected }] }),
      });
      setLedIngest(res.drawing);
      refreshList();
    } catch (e) { setError((e as Error).message); }
  }

  function confirm(r: IngestRecord) {
    const typed = draft[r.element];
    const corrected = typed !== undefined && typed.trim() !== '' ? Number(typed) : null;
    if (corrected !== null && !(corrected >= 0)) { setError(t('人工值须为非负数', 'Value must be ≥ 0')); return; }
    save(r, true, corrected);
  }

  function loadInto05(d: StoredDrawing) {
    setLedHandoff(toHandoff(d, project?.name, boundPack ?? undefined));
    go('ledstudio');
  }

  async function submit() {
    if (!ledIngest) return;
    setBusy(true);
    setError('');
    try {
      const res = await call<{ drawing: StoredDrawing; may_enter_configuration: boolean }>('/api/av/review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ledIngest.id, changes: [], submit: true }),
      });
      setLedIngest(res.drawing);
      refreshList();
      if (!res.may_enter_configuration) setError(t('服务端复核未通过：仍有待确认的要素。', 'Server re-check: items still pending.'));
      else loadInto05(res.drawing);
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  const pending = ledIngest ? ledIngest.extractions.filter(isPending) : [];

  return (
    <>
    <AvSteps />
    <div style={{ display: 'grid', gap: 20 }}>

      {/* ── 项目与图纸清单 ─────────────────────────────────────── */}
      <div className="panel clip" style={{ padding: 0 }}>
        <div className="panel-head">
          <span className="panel-title">{t('项目图纸', 'Project drawings')}</span>
          <span style={{ fontSize: 11, color: 'var(--text2)' }}>{t('仅列出含 LED 服务包的项目', 'Projects with an LED service package')}</span>
        </div>
        <div style={{ padding: '16px 18px', display: 'grid', gap: 14 }}>
          <div className="field" style={{ marginBottom: 0, maxWidth: 520 }}>
            <label htmlFor="led-project">{t('项目', 'Project')}</label>
            <select id="led-project" value={ledProjectId} onChange={(e) => pickProject(e.target.value)}>
              <option value="">{t('— 选择项目 —', '— choose a project —')}</option>
              {ledProjects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.client ? ` · ${p.client}` : ''}</option>
              ))}
            </select>
          </div>
          {project && (
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>
              {boundPack
                ? t(`LED 规则包 ${boundPack}（立项时绑定）`, `LED rule pack ${boundPack} (bound at inquiry)`)
                : t('该项目未经 01 立项询价，05 将按最新规则包计算。', 'Not opened through 01; 05 uses the latest rule pack.')}
            </div>
          )}
          {!ledProjects.length && (
            <p style={{ fontSize: 13, color: 'var(--text2)' }}>
              {t('还没有含 LED 服务包的项目。先到「01 立项询价」立项。', 'No LED project yet — open one in 01.')}
            </p>
          )}
        </div>
        {project && (
          list.length ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
                <tbody>
                  <tr>{[t('图纸', 'Drawing'), t('等级', 'Grade'), t('上传', 'Uploaded'), t('校核', 'Review'), ''].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr>
                  {list.map((d) => (
                    <tr key={d.id} style={{ background: ledIngest?.id === d.id ? 'var(--hover-bg)' : undefined }}>
                      <td style={td}>{d.fileName}</td>
                      <td style={td}><span style={{ ...chip, background: GRADE[d.grade].bg, color: GRADE[d.grade].fg }}>{d.grade}</span></td>
                      <td style={{ ...td, color: 'var(--text2)' }}>{d.uploadedBy} · {fmtDate(new Date(d.uploadedAt))}</td>
                      <td style={td}>
                        {d.reviewedAt
                          ? <span style={{ color: 'var(--success)' }}>{t('已校核', 'Reviewed')} · {d.reviewedBy}</span>
                          : <span style={{ color: 'var(--warning)' }}>{d.pending ? t(`待确认 ${d.pending} 项`, `${d.pending} pending`) : t('待提交', 'Ready to submit')}</span>}
                      </td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="btn-line" onClick={() => open(d.id)}>{d.reviewedAt ? t('查看', 'View') : t('打开校核', 'Review')}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ padding: '0 18px 16px', fontSize: 13, color: 'var(--text2)' }}>{t('该项目还没有上传图纸。', 'No drawings uploaded for this project yet.')}</p>
          )
        )}
      </div>

      {/* ── 02 图纸接入与分级 ─────────────────────────────────── */}
      {project && (
        <div className="panel" style={{ padding: 0 }}>
          <div className="panel-head">
            <span className="panel-title">{t('02 · 图纸接入与分级', '02 · Drawing intake')}</span>
            <span style={{ fontSize: 11, color: 'var(--text2)' }}>DXF · PDF · PNG / JPG / TIF</span>
          </div>
          <div style={{ padding: '16px 18px', display: 'grid', gap: 14 }}>
            {mayUpload ? (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div className="field" style={{ marginBottom: 0, flex: '1 1 320px' }}>
                  <label htmlFor="led-file">{t('图纸文件', 'Drawing file')}</label>
                  <input id="led-file" type="file" accept=".dxf,.pdf,.png,.jpg,.jpeg,.tif,.tiff"
                    onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(''); }} />
                </div>
                {isPdf && (
                  <div className="field" style={{ marginBottom: 0, width: 190 }}>
                    <label htmlFor="led-scale">{t('比例尺标定 1 :', 'Scale 1 :')}</label>
                    <input id="led-scale" type="number" min="1" placeholder="50" value={scale} onChange={(e) => setScale(e.target.value)} />
                  </div>
                )}
                <button className="btn-navy" disabled={!file || busy} onClick={upload} style={dim(!file || busy)}>
                  {busy ? t('解析中…', 'Extracting…') : t('上传并解析', 'Upload & extract')}
                </button>
              </div>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--text2)' }}>{t('你不是该项目的负责人，不能为它上传图纸。', 'You cannot upload drawings for this project.')}</p>
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
          </div>
        </div>
      )}

      {error && (
        <div style={{ fontSize: 12.5, padding: '9px 12px', borderRadius: 6, background: 'var(--danger-bg, #FDF0EC)', color: 'var(--danger)' }}>{error}</div>
      )}

      {/* ── 03 解析提取 + 04 人工校核 ────────────────────────── */}
      {ledIngest && project && ledIngest.project_id === project.id && (
        <div className="panel clip" style={{ padding: 0 }}>
          <div className="panel-head">
            <span className="panel-title">{t('03 · 解析结果 / 04 · 人工校核', '03 · Extraction / 04 · Review')}</span>
            <span style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12 }}>
              <span>{ledIngest.drawing}</span>
              <span style={{ ...chip, background: GRADE[ledIngest.grade].bg, color: GRADE[ledIngest.grade].fg }}>
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
                  const editable = mayReview && !locked;
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
                        ) : editable ? (
                          <input className="in sm" type="number" style={{ width: 120 }} aria-label={t(...ELEMENT_LABEL[r.element])}
                            placeholder={r.value === null ? t('补录', 'enter') : String(r.value)}
                            value={typed ?? ''} onChange={(e) => setDraft({ ...draft, [r.element]: e.target.value })} />
                        ) : '—'}
                        {r.corrected !== null && r.corrected_by && (
                          <div style={{ fontSize: 11, color: 'var(--text2)' }}>{r.corrected_by}</div>
                        )}
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
                          {/* floor, not round: 0.846 must not read as "85%" next to an 85% threshold it fails */}
                          {typeof r.prov.confidence === 'number' ? `${Math.floor(r.prov.confidence * 100)}%` : r.prov.confidence}
                        </div>
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {r.confirmed ? (
                          <span style={{ color: 'var(--success)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                            <Icon name="checkSm" size={14} />{t('已确认', 'Confirmed')}
                            {editable && <button style={{ fontSize: 11, color: 'var(--text2)', textDecoration: 'underline' }}
                              onClick={() => save(r, false, null)}>{t('撤销', 'undo')}</button>}
                          </span>
                        ) : editable ? (
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
              {locked ? (
                <span style={{ color: 'var(--success)' }}>
                  {t(`已由 ${ledIngest.reviewed_by} 完成校核并锁定（${fmtDate(new Date(ledIngest.reviewed_at))}）。如需修改请重新上传。`,
                    `Reviewed by ${ledIngest.reviewed_by} and locked.`)}
                </span>
              ) : pending.length ? (
                <span style={{ color: 'var(--warning)' }}>
                  {t(`校核闸门：还有 ${pending.length} 项待确认（置信度低于 ${Math.round(ledIngest.threshold * 100)}% 或未识别）。`,
                    `Gate: ${pending.length} item(s) pending review.`)}
                </span>
              ) : (
                <span style={{ color: 'var(--success)' }}>{t('校核闸门已满足，可提交。', 'Gate satisfied — ready to submit.')}</span>
              )}
              <div style={{ color: 'var(--text2)', fontSize: 11.5 }}>
                {t('每次确认都已保存到项目。这里是唯一的质量闸门，过了这道门后全部是确定性计算；提交后修正值回写样本库。',
                  'Each confirmation is saved to the project. The only quality gate; corrections go to the sample library on submit.')}
              </div>
            </div>
            {locked ? (
              <button className="btn-navy" onClick={() => loadInto05(ledIngest)}>{t('载入 05 方案配置', 'Open in 05')}</button>
            ) : mayReview && (
              <button className="btn-navy" disabled={busy || pending.length > 0} onClick={submit} style={dim(busy || pending.length > 0)}>
                {t('提交校核，进入 05 方案配置', 'Submit & open 05')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
    </>
  );
}

const dim = (disabled: boolean): React.CSSProperties | undefined =>
  disabled ? { opacity: 0.45, cursor: 'not-allowed' } : undefined;

const chip: React.CSSProperties = { padding: '3px 9px', borderRadius: 4, fontWeight: 700, fontSize: 12 };

const th: React.CSSProperties = {
  padding: '10px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
  color: 'var(--text2)', background: 'var(--hover-bg)', textAlign: 'left', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { padding: '10px 14px', borderTop: '1px solid var(--row-line)', verticalAlign: 'top' };
