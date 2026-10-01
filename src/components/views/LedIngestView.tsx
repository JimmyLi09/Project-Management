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
import { canReviewDrawing, canUploadDrawing, isFull } from '@/lib/permissions';
import { fmtDate } from '@/lib/project';
import { useLang } from '@/lib/i18n';
import type { JudgeSummary, JudgeView } from '@/server/avjudge';
import type { UploadSummary } from '@/server/avupload';
import { useStore } from '../store';
import { Icon } from '../ui';
import ImageJudgePanel from './ImageJudgePanel';
import { useFlowRefresh } from './AvFlow';

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
  C: { zh: 'C 级 · 图片 / 扫描件 · 智能判读', en: 'C · picture / scan · recognition', fg: 'var(--warning)', bg: 'var(--warning-bg, #FDF7F1)' },
};

const METHOD_LABEL: Record<string, [string, string]> = {
  rule: ['规则', 'Rule'], manual: ['人工', 'Manual'], lookup: ['库查询', 'Lookup'],
  ai_ocr: ['AI · OCR', 'AI · OCR'], ai_vision: ['AI · 视觉', 'AI · vision'],
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init).catch(() => null);
  const body = res ? await res.json().catch(() => ({})) : { error: '网络错误' };
  if (!res?.ok || body.error) throw Object.assign(new Error(body.error || '请求失败'), { reason: body.reason as string | undefined, archived: !!body.archived });
  return body as T;
}

/* AV-016:解析失败的人话原因,两种语言(服务器给归类,页面按语言显示) */
const REASON: Record<string, [string, string]> = {
  down: ['本机识别服务暂不可用。文件已保存，可稍后重新解析，或直接手填。', 'The local recognition service is unavailable. The file is saved — re-parse later or fill in by hand.'],
  timeout: ['本机识别服务超时。文件已保存，可稍后重新解析，或直接手填。', 'The local recognition service timed out. The file is saved — re-parse later or fill in by hand.'],
  scale: ['比例尺未标定：在右边填上比例（如 1:50 填 50）再重新解析，或直接手填。', 'No scale set: enter it on the right (1:50 → 50) and re-parse, or fill in by hand.'],
  units: ['图纸没有设置单位（毫米 / 米），读不出尺寸。请设计方补上单位后重新上传，或直接手填。', 'The drawing has no units (mm / m) so sizes cannot be read. Ask the designer to set them, or fill in by hand.'],
  type: ['这种文件格式读不了（支持 DXF、PDF、图片）。文件已保存，可以手填。', 'This file type cannot be read (DXF, PDF and pictures are supported). The file is saved — fill in by hand.'],
  broken: ['文件损坏或打不开。请重新导出后上传，或直接手填。', 'The file is damaged or cannot be opened. Export it again and upload, or fill in by hand.'],
  interrupted: ['上次解析被中断（可能是服务器重启）。文件已保存，可以重新解析或手填。', 'The last parse was interrupted (the server may have restarted). The file is saved — re-parse or fill in by hand.'],
  other: ['解析没成功。文件已保存，可以重新解析或手填；仍不行请联系管理员。', 'Parsing did not succeed. The file is saved — re-parse or fill in by hand; contact the admin if it keeps failing.'],
};

export default function LedIngestView() {
  const refreshFlow = useFlowRefresh();
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
  /* AV-015: pictures and scans are judged, not parsed */
  const [judge, setJudge] = useState<JudgeView | null>(null);
  const [judges, setJudges] = useState<JudgeSummary[]>([]);
  /* AV-016 ①:上传过的原件(含解析失败的),以及失败那几份的重新解析比例尺 */
  const [uploads, setUploads] = useState<UploadSummary[]>([]);
  const [rescale, setRescale] = useState<Record<number, string>>({});

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
    if (!ledProjectId) { setList([]); setJudges([]); setUploads([]); return; }
    try {
      const q = encodeURIComponent(ledProjectId);
      const [d, j] = await Promise.all([
        call<{ drawings: DrawingSummary[] }>(`/api/av/drawings?project=${q}`),
        call<{ judges: JudgeSummary[] }>(`/api/av/judge?project=${q}`).catch(() => ({ judges: [] as JudgeSummary[] })),
      ]);
      const u = await call<{ uploads: UploadSummary[] }>(`/api/av/uploads?project=${q}`).catch(() => ({ uploads: [] as UploadSummary[] }));
      setList(d.drawings);
      setJudges(j.judges);
      setUploads(u.uploads);
      refreshFlow();
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
    if (judge && judge.projectId !== id) setJudge(null);
    setError('');
  }

  async function open(id: number) {
    setError('');
    try { setDraft({}); setJudge(null); setLedIngest(await call<StoredDrawing>(`/api/av/drawings/${id}`)); }
    catch (e) { setError((e as Error).message); }
  }

  async function openJudge(id: number) {
    setError('');
    try { setLedIngest(null); setJudge((await call<{ judge: JudgeView }>(`/api/av/judge/${id}`)).judge); }
    catch (e) { setError((e as Error).message); }
  }

  const updateJudge = useCallback((j: JudgeView) => {
    setJudge(j);
    setJudges((cur) => cur.map((x) => (x.id === j.id ? { ...x, status: j.status, engine: j.engine, drawingId: j.drawingId } : x)));
  }, []);

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
      const res = await call<StoredDrawing | { judge: JudgeView }>('/api/av/ingest', { method: 'POST', body: form });
      if ('judge' in res) { setLedIngest(null); setJudge(res.judge); }
      else { setJudge(null); setLedIngest(res); }
    } catch (e) {
      const r = (e as { reason?: string }).reason;
      setError(!(e as { archived?: boolean }).archived ? (e as Error).message
        : r && REASON[r] ? t(`解析没成功：${REASON[r][0]}`, `Parsing did not succeed: ${REASON[r][1]}`)
          : t('解析没成功，但文件已保存到项目，不会丢。可以在上面「项目图纸」里点「重新解析」或「手填」。',
            'Parsing did not succeed, but the file is saved to the project. Use “Re-parse” or “Fill in by hand” under Project drawings above.'));
    }
    refreshList();
    setBusy(false);
  }

  /* AV-016 ①:对留档的原件再解析一次 */
  async function reparse(u: UploadSummary) {
    setBusy(true); setError('');
    try {
      const sc = (rescale[u.id] ?? '').trim();
      const res = await call<StoredDrawing | { judge: JudgeView }>(`/api/av/uploads/${u.id}/reparse`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sc ? { scale: sc } : {}),
      });
      if ('judge' in res) { setLedIngest(null); setJudge(res.judge); }
      else { setJudge(null); setLedIngest(res); }
    } catch (e) {
      const r = (e as { reason?: string }).reason;
      setError(r && REASON[r] ? t(...REASON[r]) : (e as Error).message);
    }
    refreshList();
    setBusy(false);
  }
  /* AV-016 ①「手填」:不再识别,直接开一张手填单,对着原件填,确认后同样带入 05 */
  async function manual(u: UploadSummary) {
    setBusy(true); setError('');
    try {
      const res = await call<{ judge: JudgeView }>(`/api/av/uploads/${u.id}/manual`, { method: 'POST' });
      setLedIngest(null); setJudge(res.judge);
    } catch (e) { setError((e as Error).message); }
    refreshList();
    setBusy(false);
  }
  const mayRemove = isFull(me);   // 删除留档只给 PD / BD
  const failed = uploads.filter((u) => u.status === 'failed');
  /* 正在解析的也列出来(原来看不见,以为没传上) */
  const parsing = uploads.filter((u) => u.status === 'parsing');
  const originalOf = (k: 'drawingId' | 'judgeId', id: number) => uploads.find((u) => u[k] === id);
  const origLink = (u?: UploadSummary) => u && (
    <a href={`/api/av/uploads/${u.id}/file`} style={{ fontSize: 12, color: 'var(--navy700)', textDecoration: 'underline', marginRight: 10 }}
      data-testid={`upload-file-${u.id}`}>{t('原件', 'Original')}</a>
  );

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
    setLedHandoff({ ...toHandoff(d, project?.name, boundPack ?? undefined), projectId: d.project_id, drawingId: d.id });
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
  /* a drawing made from a picture shows as its judgement row, not twice */
  const judged = new Set(judges.map((j) => j.drawingId).filter(Boolean));
  const drawingRows = list.filter((d) => !judged.has(d.id));

  return (
    <>
    <div style={{ display: 'grid', gap: 20 }}>

      {/* ── 项目与图纸清单 ─────────────────────────────────────── */}
      <div className="panel clip" style={{ padding: 0 }}>
        <div className="panel-head">
          <span className="panel-title">{t('项目图纸', 'Project drawings')}</span>
          <span style={{ fontSize: 11, color: 'var(--text2)' }}>{t('仅列出含 LED 服务包的项目', 'Projects with an LED service package')}</span>
        </div>
        <div style={{ padding: '16px 18px', display: 'grid', gap: 14 }}>
          {ledProjectId && !project && (
            <p style={{ fontSize: 13, color: 'var(--text2)' }} data-testid="ingest-no-led">
              {t('这个项目没有 LED 服务包，不用图纸校核；可以直接点下面的「下一步」去 05 方案配置。',
                'This project has no LED package, so there is no drawing review — go straight to 05 with Next below.')}
            </p>
          )}
          {!ledProjectId && (
            <p style={{ fontSize: 13, color: 'var(--text2)' }}>{t('先在上面「当前项目」里选一个项目。', 'Pick a project in the bar above first.')}</p>
          )}
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
          drawingRows.length || judges.length || failed.length || parsing.length ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
                <tbody>
                  <tr>{[t('图纸', 'Drawing'), t('等级', 'Grade'), t('上传', 'Uploaded'), t('校核', 'Review'), ''].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr>
                  {parsing.map((u) => (
                    <tr key={`p${u.id}`} data-testid={`upload-parsing-${u.id}`}>
                      <td style={td}>{u.fileName}</td>
                      <td style={td}><span style={{ ...chip, background: 'var(--hover-bg)', color: 'var(--text2)' }}>{t('留档', 'Kept')}</span></td>
                      <td style={{ ...td, color: 'var(--text2)' }}>{u.uploadedBy} · {fmtDate(new Date(u.uploadedAt))}</td>
                      <td style={{ ...td, color: 'var(--navy700)' }}>{t('解析中…', 'Parsing…')}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{origLink(u)}</td>
                    </tr>
                  ))}
                  {failed.map((u) => (
                    <tr key={`u${u.id}`} data-testid={`upload-failed-${u.id}`} style={{ background: 'var(--danger-bg, #FDF0EC)' }}>
                      <td style={td}>{u.fileName}</td>
                      <td style={td}><span style={{ ...chip, background: 'var(--hover-bg)', color: 'var(--text2)' }}>{t('留档', 'Kept')}</span></td>
                      <td style={{ ...td, color: 'var(--text2)' }}>{u.uploadedBy} · {fmtDate(new Date(u.uploadedAt))}</td>
                      <td style={{ ...td, fontSize: 12.5 }}>
                        <span style={{ ...chip, background: 'var(--danger)', color: '#fff' }} data-testid={`upload-failed-tag-${u.id}`}>{t('解析失败 · 已留档', 'Parse failed · kept')}</span>
                        <div style={{ color: 'var(--danger)', marginTop: 4 }} data-testid={`upload-reason-${u.id}`}>{u.reason && REASON[u.reason] ? t(...REASON[u.reason]) : u.error}</div>
                        {u.detail && <div style={{ color: 'var(--text2)', fontSize: 11, marginTop: 2 }} title={u.detail}>{t('技术原因（仅 PD / BD 可见）：', 'Technical detail (PD / BD only): ')}{u.detail.slice(0, 160)}</div>}
                      </td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {origLink(u)}
                        {mayUpload && u.fileName.toLowerCase().endsWith('.pdf') && (
                          <input className="in sm" style={{ width: 80, marginRight: 6 }} placeholder={t('比例 50', 'scale 50')} value={rescale[u.id] ?? ''}
                            onChange={(e) => setRescale({ ...rescale, [u.id]: e.target.value })} aria-label={t('比例尺', 'Scale')} />
                        )}
                        {mayUpload && <button className="btn-line" disabled={busy} onClick={() => reparse(u)} data-testid={`upload-reparse-${u.id}`}>{t('重新解析', 'Re-parse')}</button>}
                        {mayUpload && <button className="btn-line" style={{ marginLeft: 6 }} disabled={busy} onClick={() => manual(u)} data-testid={`upload-manual-${u.id}`}>{t('手填', 'Fill in by hand')}</button>}
                        {mayRemove && <button style={{ marginLeft: 8, fontSize: 12, color: 'var(--text2)', textDecoration: 'underline' }} disabled={busy}
                          data-testid={`upload-remove-${u.id}`}
                          onClick={async () => {
                            if (!window.confirm(t(`删除「${u.fileName}」这份留档？原件会一起删掉，并记入操作日志。`, `Delete "${u.fileName}" and its original? This is written to the log.`))) return;
                            const res = await fetch(`/api/av/uploads/${u.id}`, { method: 'DELETE' }).catch(() => null);
                            if (!res?.ok) setError((res && (await res.json().catch(() => ({}))).error) || t('删除失败', 'Delete failed'));
                            refreshList();
                          }}>{t('删除', 'Delete')}</button>}
                      </td>
                    </tr>
                  ))}
                  {judges.map((j) => (
                    <tr key={`j${j.id}`} style={{ background: judge?.id === j.id ? 'var(--hover-bg)' : undefined }} data-testid={`judge-list-${j.id}`}>
                      <td style={td}>{j.fileName}</td>
                      <td style={td}><span style={{ ...chip, background: GRADE.C.bg, color: GRADE.C.fg }}>{t('图', 'Pic')}</span></td>
                      <td style={{ ...td, color: 'var(--text2)' }}>{j.createdBy} · {fmtDate(new Date(j.createdAt))}</td>
                      <td style={td}>
                        {j.drawingId
                          ? <span style={{ color: 'var(--success)' }}>{t('已确认，已带入 05', 'Confirmed into 05')}</span>
                          : j.status === 'running'
                            ? <span style={{ color: 'var(--navy700)' }}>{t('识别中…', 'Recognising…')}</span>
                            : <span style={{ color: 'var(--warning)' }}>{j.engine === 'vision' ? t('待确认', 'To confirm') : t('待手填', 'To fill in')}</span>}
                      </td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {origLink(originalOf('judgeId', j.id))}
                        <button className="btn-line" onClick={() => openJudge(j.id)}>{j.drawingId ? t('查看', 'View') : t('打开', 'Open')}</button>
                      </td>
                    </tr>
                  ))}
                  {drawingRows.map((d) => (
                    <tr key={d.id} style={{ background: ledIngest?.id === d.id ? 'var(--hover-bg)' : undefined }}>
                      <td style={td}>{d.fileName}</td>
                      <td style={td}><span style={{ ...chip, background: GRADE[d.grade].bg, color: GRADE[d.grade].fg }}>{d.grade}</span></td>
                      <td style={{ ...td, color: 'var(--text2)' }}>{d.uploadedBy} · {fmtDate(new Date(d.uploadedAt))}</td>
                      <td style={td}>
                        {d.reviewedAt
                          ? <span style={{ color: 'var(--success)' }}>{t('已校核', 'Reviewed')} · {d.reviewedBy}</span>
                          : <span style={{ color: 'var(--warning)' }} data-testid={`drawing-progress-${d.id}`}>
                            {d.flagged ? t(`已确认 ${d.flagged - d.pending} / ${d.flagged}`, `Confirmed ${d.flagged - d.pending} / ${d.flagged}`) + ' · ' : ''}
                            {d.pending ? t(`待确认 ${d.pending} 项`, `${d.pending} pending`) : t('待提交', 'Ready to submit')}</span>}
                      </td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {origLink(originalOf('drawingId', d.id))}
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
            <span style={{ fontSize: 11, color: 'var(--text2)' }}>DXF · PDF · PNG / JPG / TIF · {t('照片 · 截图', 'photos · screenshots')}</span>
          </div>
          <div style={{ padding: '16px 18px', display: 'grid', gap: 14 }}>
            {mayUpload ? (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div className="field" style={{ marginBottom: 0, flex: '1 1 320px' }}>
                  <label htmlFor="led-file">{t('图纸文件', 'Drawing file')}</label>
                  <input id="led-file" type="file" accept=".dxf,.pdf,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff"
                    onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(''); }} />
                </div>
                {isPdf && (
                  <div className="field" style={{ marginBottom: 0, width: 190 }}>
                    <label htmlFor="led-scale">{t('比例尺标定 1 :', 'Scale 1 :')}</label>
                    <input id="led-scale" type="number" min="1" placeholder="50" value={scale} onChange={(e) => setScale(e.target.value)} />
                  </div>
                )}
                <button className="btn-navy" disabled={!file || busy} onClick={upload} style={dim(!file || busy)}>
                  {busy ? t('上传中…', 'Uploading…') : t('上传并解析', 'Upload & extract')}
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
                  {g === 'C' && t('照片、截图、效果图、扫描件：本机视觉模型判断「这是什么、缺什么」，全部要素须人工确认。', 'Photos, screenshots, renders, scans: the local vision model reads them; every element needs confirmation.')}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div style={{ fontSize: 12.5, padding: '9px 12px', borderRadius: 6, background: 'var(--danger-bg, #FDF0EC)', color: 'var(--danger)' }}>{error}</div>
      )}

      {/* ── AV-015 图片智能判读 ─────────────────────────────── */}
      {judge && project && judge.projectId === project.id && (
        <ImageJudgePanel judge={judge} setJudge={updateJudge} mayReview={mayReview}
          onHandoff={(d, pack) => {
            refreshList();
            setLedHandoff({ ...toHandoff(d, project.name, pack ?? undefined), projectId: d.project_id, drawingId: d.id });
            go('ledstudio');
          }} />
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
