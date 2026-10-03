'use client';

/* ===== 01 立项询价 =====
   Open a project for the AV platform: project facts, the business lines it
   involves, and the rule pack each line is bound to from here on (§5: a project
   keeps the version it was created with). Only LED has a published rule pack in
   phase 1; the other lines are shown, reserved (§2.2). */

import React, { useEffect, useRef, useState } from 'react';

import { isAvailable, LINES, projectLines } from '@/av/core/lines';
import type { BusinessLine } from '@/av/core/types';
import { canCreate, canEdit, canMeta } from '@/lib/permissions';
import { useLang } from '@/lib/i18n';
import { PC_LABEL, USE_LABEL } from '@/av/core/controller';
import type { Project } from '@/lib/types';
import { useStore } from '../store';
import { useFlowRefresh } from './AvFlow';

/* AV-016:选了项目进 01 = 编辑这个项目的立项信息(改了自动保存);
   「＋ 新建询价」(工作台右上角、本页右上角)= 空白表单立新项目 */
export default function AvInquiryView() {
  const { view, projects, ledProjectId } = useStore();
  const project = view.sub === 'new' ? undefined
    : projects.find((p) => p.id === ledProjectId && !p.archived && projectLines(p.packages.map((k) => k.svc)).length > 0);
  return project ? <EditInquiry key={project.id} project={project} /> : <NewInquiry />;
}

function NewInquiry() {
  const { me, refresh, setLedProjectId, setLedIngest, go } = useStore();
  const { t } = useLang();
  const [form, setForm] = useState({ name: '', client: '', location: '', delivery: '', notes: '', play_use: '', pc_by: '' });
  const [lines, setLines] = useState<BusinessLine[]>(['led']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });
  const toggle = (l: BusinessLine) => setLines(lines.includes(l) ? lines.filter((x) => x !== l) : [...lines, l]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await fetch('/api/av/inquiry', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, lines }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : { error: t('网络错误', 'Network error') };
    setBusy(false);
    if (!res?.ok || body.error) { setError(body.error || t('立项失败', 'Could not open the project')); return; }
    await refresh();
    setLedIngest(null);
    setLedProjectId(body.project.id);
    go('ledingest');
  }

  if (!canCreate(me)) {
    return (
      <>
        <div className="panel" style={{ padding: '18px 20px', fontSize: 13, color: 'var(--text2)' }}>
          {t('立项询价由销售、PD 或 BD 发起。你可以在「02–04 图纸 · 解析 · 校核」里处理已立项的项目。',
            'Inquiries are opened by Sales, PD or BD.')}
        </div>
      </>
    );
  }

  return (
    <form onSubmit={submit}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,380px)', gap: 20, alignItems: 'start' }}>

        <div className="panel" style={{ padding: 0 }}>
          <div className="panel-head"><span className="panel-title">{t('项目信息', 'Project')}</span></div>
          <div style={{ padding: '16px 18px', display: 'grid', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="inq-name">{t('项目名称', 'Project name')} *</label>
                <input id="inq-name" required value={form.name} onChange={set('name')} placeholder={t('如：滨海 showroom 视听系统', 'e.g. Harbourfront showroom AV')} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="inq-client">{t('客户 / 甲方', 'Client')}</label>
                <input id="inq-client" value={form.client} onChange={set('client')} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="inq-location">{t('项目地点', 'Location')}</label>
                <input id="inq-location" value={form.location} onChange={set('location')} placeholder="Singapore" />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="inq-delivery">{t('期望交付日期', 'Target delivery')}</label>
                <input id="inq-delivery" type="date" value={form.delivery} onChange={set('delivery')} />
              </div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="inq-notes">{t('需求补充说明', 'Requirements')}</label>
              <textarea id="inq-notes" rows={3} value={form.notes} onChange={set('notes')}
                placeholder={t('如：主展厅 LED 主屏，需含控制室', 'e.g. main hall LED wall, with control room')} />
            </div>
            {lines.includes('led') && (
              <LedSignalQuestions value={form} onChange={(k, v) => setForm((f) => ({ ...f, [k]: v, ...(k === 'play_use' && v !== 'meeting' && v !== 'both' ? { pc_by: '' } : {}) }))} disabled={false} />
            )}
          </div>
        </div>

        <div className="panel" style={{ padding: 0 }}>
          <div className="panel-head"><span className="panel-title">{t('业务线选择', 'Business lines')}</span></div>
          <div style={{ padding: '16px 18px', display: 'grid', gap: 10 }}>
            {LINES.map((l) => {
              const ok = isAvailable(l);
              const on = lines.includes(l.line);
              return (
                <label key={l.line} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 6, fontSize: 14,
                  border: `1px solid ${on ? 'var(--navy700)' : 'var(--border)'}`, background: on ? 'var(--hover-bg)' : 'var(--card)',
                  color: ok ? 'var(--text)' : 'var(--text2)', cursor: ok ? 'pointer' : 'not-allowed',
                }}>
                  <input type="checkbox" checked={on} disabled={!ok} onChange={() => toggle(l.line)} style={{ width: 17, height: 17 }} />
                  <span style={{ fontWeight: 500 }}>{t(l.label, l.en)}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: ok ? 'var(--navy700)' : 'var(--text2)' }}>
                    {ok ? t(`规则包 ${l.pack}${l.draft ? ' · 草案，不可正式报价' : ''}`, `pack ${l.pack}${l.draft ? ' · draft' : ''}`) : t('规则包未发布 · 架构预留', 'no rule pack yet')}
                  </span>
                </label>
              );
            })}
            <p style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
              {t('勾选的业务线在项目里各生成一个服务包，并锁定当前规则包版本；之后规则包升级不影响本项目。多条业务线将在同一项目下合并报价（第二期），共用同一套公司参数。',
                'Each line becomes a service package bound to its current rule pack. Combined quotation arrives in phase 2.')}
            </p>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 20, display: 'flex', gap: 14, alignItems: 'flex-start', padding: '14px 18px', borderRadius: 8,
        background: 'var(--warning-bg, #FDF7F1)', border: '1px solid var(--border)' }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--warning)', marginTop: 6, flexShrink: 0 }} />
        <p style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--text)' }}>
          {t('立项提醒：请优先向甲方或设计院索取 ', 'Ask the client or designer for ')}<strong>{t('DXF 源文件', 'the DXF source')}</strong>
          {t('。源文件识别准确率可达 90% 以上，矢量 PDF 约 75–85%，扫描件仅 60–75% 且需全量人工校核。这一个动作对后续工作量的影响大于任何系统优化。',
            ' first. DXF extracts at 90%+, vector PDF at 75–85%, scans at 60–75% with full manual review.')}
        </p>
      </div>

      {error && (
        <div style={{ marginTop: 14, fontSize: 12.5, padding: '9px 12px', borderRadius: 6, background: 'var(--danger-bg, #FDF0EC)', color: 'var(--danger)' }}>{error}</div>
      )}

      <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
        <button type="submit" className="btn-navy" disabled={busy || !lines.length}
          style={busy || !lines.length ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}>
          {busy ? t('立项中…', 'Opening…') : t('立项，下一步：上传图纸', 'Open project → drawings')}
        </button>
      </div>
    </form>
  );
}

/* ===== AV-016 · 01 编辑已有项目:改了约 1.5 秒自动保存 =====
   不再需要记得点保存。业务线和规则包立项时就定了(换规则包会改变已算好的方案),这里只读。 */
type Fields = { name: string; client: string; location: string; delivery: string; notes: string; play_use: string; pc_by: string };
function EditInquiry({ project }: { project: Project }) {
  const { me, refresh, setView } = useStore();
  const { t } = useLang();
  const refreshFlow = useFlowRefresh();
  const may = canMeta(me, project);
  const [inq, setInq] = useState<{ location: string; notes: string; lines: BusinessLine[]; packs: Partial<Record<BusinessLine, string>> } | null | undefined>(undefined);
  const [form, setForm] = useState<Fields>({ name: project.name, client: project.client || '', location: '', delivery: project.delivery || '', notes: '', play_use: '', pc_by: '' });
  const [st, setSt] = useState<{ saving: boolean; at: number; error: string }>({ saving: false, at: 0, error: '' });
  /* 服务器上现在的值(最后一次读到 / 存上的)。只发和它不一样的字段 —— 别人在项目页刚改的
     客户名,这边没动过就不会被旧值盖回去(复查 #68) */
  const base = useRef<Fields | null>(null);
  const pending = useRef<string | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());   // 一次存完再存下一次,先发的不会后到

  useEffect(() => {
    let live = true;
    fetch(`/api/av/inquiry?project=${encodeURIComponent(project.id)}`).then((r) => r.json()).then((b) => {
      if (!live) return;
      const i = b.inquiry ?? null;
      setInq(i);
      setForm((f) => {
        const next = { ...f, location: i?.location ?? '', notes: i?.notes ?? '', play_use: i?.answers?.play_use ?? '', pc_by: i?.answers?.pc_by ?? '' };
        base.current = next;
        return next;
      });
    }).catch(() => { if (live) { setInq(null); base.current = form; } });
    return () => { live = false; };
  }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 别人改了项目名 / 客户 / 交付日期(store 每 30 秒刷新一次):这边没动过的字段跟着更新 */
  useEffect(() => {
    const b = base.current;
    if (!b) return;
    const fresh: Partial<Fields> = { name: project.name, client: project.client || '', delivery: project.delivery || '' };
    const adopt = (Object.keys(fresh) as (keyof Fields)[]).filter((k) => fresh[k] !== b[k] && form[k] === b[k]);
    if (!adopt.length) return;
    const patch = Object.fromEntries(adopt.map((k) => [k, fresh[k]])) as Partial<Fields>;
    base.current = { ...b, ...patch };
    setForm((f) => ({ ...f, ...patch }));
  }, [project.name, project.client, project.delivery]); // eslint-disable-line react-hooks/exhaustive-deps

  const json = JSON.stringify(form);
  const send = (body: string, keepalive = false) =>
    fetch('/api/av/inquiry', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body, keepalive });
  useEffect(() => {
    const b0 = base.current;
    if (!may || !b0) return;
    const diff = (Object.keys(form) as (keyof Fields)[]).filter((k) => form[k] !== b0[k]);
    if (!diff.length) { pending.current = null; return; }
    if (!form.name.trim()) { pending.current = null; setSt((s) => ({ ...s, saving: false, error: t('项目名称不能为空', 'Project name is required') })); return; }
    const sent = Object.fromEntries(diff.map((k) => [k, form[k]])) as Partial<Fields>;
    const body = JSON.stringify({ projectId: project.id, ...sent });
    pending.current = body;
    setSt((s) => ({ ...s, saving: true, error: '' }));
    const timer = setTimeout(() => {
      if (pending.current !== body) return;
      pending.current = null;
      base.current = { ...(base.current ?? b0), ...sent };
      chain.current = chain.current.then(async () => {
        const res = await send(body).catch(() => null);
        const r = res ? await res.json().catch(() => ({})) : { error: t('网络错误', 'Network error') };
        if (res?.ok) { setSt({ saving: false, at: r.savedAt || Date.now(), error: '' }); refresh(); refreshFlow(); }
        else {
          /* 没存上:基准退回去,下次改动连这几项一起再发;关页面时也会再试一次 */
          base.current = { ...(base.current ?? b0), ...Object.fromEntries(diff.map((k) => [k, b0[k]])) };
          pending.current = pending.current ?? body;
          setSt({ saving: false, at: 0, error: r.error || t('没保存上，请重试', 'Not saved — please try again') });
        }
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [json, may]); // eslint-disable-line react-hooks/exhaustive-deps
  /* 切走 / 关浏览器时,排着队的那一次当场发出去 */
  useEffect(() => {
    const flush = () => { const b = pending.current; if (b) { pending.current = null; send(b, true).catch(() => null); } };
    const h = (e: BeforeUnloadEvent) => { const had = !!pending.current; flush(); if (had && !navigator.onLine) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => { window.removeEventListener('beforeunload', h); flush(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const lines = projectLines(project.packages.map((k) => k.svc), inq?.lines);
  const missing = !form.delivery;
  const ro = !may || inq === undefined;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, fontSize: 12.5, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text2)' }}>{may ? t('编辑立项信息，改了会自动保存。', 'Editing the inquiry — changes save automatically.') : t('只读：立项信息由项目负责人、销售或 PD / BD 修改。', 'Read-only: the project lead, Sales or PD / BD edit the inquiry.')}</span>
        {st.saving && <span style={{ color: 'var(--warning)' }} data-testid="inq-autosave">{t('● 正在保存…', '● Saving…')}</span>}
        {!st.saving && st.at > 0 && <span style={{ color: 'var(--success)' }} data-testid="inq-autosave">{t(`✓ 已自动保存 · ${new Date(st.at).toTimeString().slice(0, 5)}`, `✓ Saved automatically · ${new Date(st.at).toTimeString().slice(0, 5)}`)}</span>}
        {st.error && <span style={{ color: 'var(--danger)' }} data-testid="inq-autosave-error">{st.error}</span>}
        {canCreate(me) && (
          <button className="btn-line sm" style={{ marginLeft: 'auto' }} onClick={() => setView({ name: 'avinquiry', sub: 'new' })} data-testid="inq-new">
            ＋ {t('新建询价', 'New inquiry')}
          </button>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,380px)', gap: 20, alignItems: 'start' }}>
        <div className="panel" style={{ padding: 0 }}>
          <div className="panel-head"><span className="panel-title">{t('项目信息', 'Project')}</span></div>
          <div style={{ padding: '16px 18px', display: 'grid', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="inq-name">{t('项目名称', 'Project name')} *</label>
                <input id="inq-name" value={form.name} onChange={set('name')} disabled={ro} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="inq-client">{t('客户 / 甲方', 'Client')}</label>
                <input id="inq-client" value={form.client} onChange={set('client')} disabled={ro} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="inq-location">{t('项目地点', 'Location')}</label>
                <input id="inq-location" value={form.location} onChange={set('location')} disabled={ro || !inq} placeholder="Singapore" />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="inq-delivery">{t('期望交付日期', 'Target delivery')} *</label>
                <input id="inq-delivery" type="date" value={form.delivery} onChange={set('delivery')} disabled={ro || !canEdit(me, project)}
                  title={!ro && !canEdit(me, project) ? t('交付日期由项目负责人或 PD / BD 修改（和项目页一样）', 'The delivery date is changed by the project lead or PD / BD') : undefined}
                  style={missing ? { borderColor: 'var(--warning)' } : undefined} />
                {missing && <span style={{ fontSize: 11.5, color: 'var(--warning)' }} data-testid="inq-missing">{t('还没填：工作台会显示「缺立项信息」。', 'Missing: the workbench shows “Details missing”.')}</span>}
              </div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="inq-notes">{t('需求补充说明', 'Requirements')}</label>
              <textarea id="inq-notes" rows={3} value={form.notes} onChange={set('notes')} disabled={ro || !inq} />
            </div>
            {lines.some((l) => l.line === 'led') && (
              <LedSignalQuestions value={form} disabled={ro || !inq}
                onChange={(k, v) => setForm((f) => ({ ...f, [k]: v, ...(k === 'play_use' && v !== 'meeting' && v !== 'both' ? { pc_by: '' } : {}) }))} />
            )}
          </div>
        </div>
        <div className="panel" style={{ padding: 0 }}>
          <div className="panel-head"><span className="panel-title">{t('业务线', 'Business lines')}</span></div>
          <div style={{ padding: '16px 18px', display: 'grid', gap: 8, fontSize: 13.5 }}>
            {lines.map((l) => (
              <div key={l.line} style={{ display: 'flex', gap: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 6 }}>
                <span style={{ fontWeight: 500 }}>{t(l.label, l.en)}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text2)' }}>{t('规则包', 'pack')} {inq?.packs?.[l.line] ?? l.pack ?? '—'}</span>
              </div>
            ))}
            <p style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
              {t('业务线和规则包在立项时就定下了，这里不改；要加业务线请新建询价，或在项目里加服务包。', 'Lines and rule packs are fixed when the project is opened.')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===== AV-019 §2.6 · LED 的信号源两问 =====
   「这块屏主要播放什么？」;选会议 / 演示或两者都有时再问「电脑由谁提供？」。
   05 按它推荐控制器和信号源(还没答 / 还不确定 → 先按会议 / 演示给,标「待确认」)。 */
function LedSignalQuestions({ value, onChange, disabled }: {
  value: { play_use: string; pc_by: string };
  onChange: (k: 'play_use' | 'pc_by', v: string) => void;
  disabled: boolean;
}) {
  const { t, lang } = useLang();
  const k = (pair: [string, string]) => (lang === 'en' ? pair[1] : pair[0]);
  const radio = (name: 'play_use' | 'pc_by', v: string, label: string) => (
    <label key={v} style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: disabled ? 'default' : 'pointer', fontSize: 13 }}>
      <input type="radio" name={`inq-${name}`} checked={value[name] === v} disabled={disabled} onChange={() => onChange(name, v)} data-testid={`inq-${name}-${v}`} />
      {label}
    </label>
  );
  return (
    <div style={{ display: 'grid', gap: 12, borderTop: '1px solid var(--row-line)', paddingTop: 12 }} data-testid="inq-led-signal">
      <div style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t('LED · 这块屏主要播放什么？', 'LED · What will the screen mainly play?')}</span>
        {(Object.keys(USE_LABEL) as (keyof typeof USE_LABEL)[]).map((u) => radio('play_use', u, k(USE_LABEL[u])))}
      </div>
      {(value.play_use === 'meeting' || value.play_use === 'both') && (
        <div style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t('电脑由谁提供？', 'Who provides the PC?')}</span>
          {(Object.keys(PC_LABEL) as (keyof typeof PC_LABEL)[]).map((u) => radio('pc_by', u, k(PC_LABEL[u])))}
        </div>
      )}
      <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{t('05 会据此推荐控制器和信号源（接电脑 / 播放盒 / 媒体播放器）。', '05 uses this to recommend the controller and signal source (PC / player box / media player).')}</span>
    </div>
  );
}

