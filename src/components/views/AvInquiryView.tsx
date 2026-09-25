'use client';

/* ===== 01 立项询价 =====
   Open a project for the AV platform: project facts, the business lines it
   involves, and the rule pack each line is bound to from here on (§5: a project
   keeps the version it was created with). Only LED has a published rule pack in
   phase 1; the other lines are shown, reserved (§2.2). */

import React, { useState } from 'react';

import { isAvailable, LINES } from '@/av/core/lines';
import type { BusinessLine } from '@/av/core/types';
import { canCreate } from '@/lib/permissions';
import { useLang } from '@/lib/i18n';
import { useStore } from '../store';
import AvSteps from './AvSteps';

export default function AvInquiryView() {
  const { me, refresh, setLedProjectId, setLedIngest, go } = useStore();
  const { t } = useLang();
  const [form, setForm] = useState({ name: '', client: '', location: '', delivery: '', notes: '' });
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
        <AvSteps />
        <div className="panel" style={{ padding: '18px 20px', fontSize: 13, color: 'var(--text2)' }}>
          {t('立项询价由销售、PD 或 BD 发起。你可以在「02–04 图纸 · 解析 · 校核」里处理已立项的项目。',
            'Inquiries are opened by Sales, PD or BD.')}
        </div>
      </>
    );
  }

  return (
    <form onSubmit={submit}>
      <AvSteps />
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
                    {ok ? t(`规则包 ${l.pack}`, `pack ${l.pack}`) : t('规则包未发布 · 架构预留', 'no rule pack yet')}
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
