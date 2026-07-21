'use client';

/* Template admin (PD/BD): edit the original production Schedule & Checklist
   templates per service. Changes apply to NEW projects only — existing
   projects keep the template they were created with. */

import React, { useEffect, useState } from 'react';
import { useLang } from '@/lib/i18n';
import type { Template, TplChecklistGroup, TplScheduleRow } from '@/lib/templates';

interface SvcRow { key: string; label: string; en: string; color: string; customized: boolean }

export default function TemplatesView() {
  const { t } = useLang();
  const [services, setServices] = useState<SvcRow[]>([]);
  const [editing, setEditing] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch('/api/templates');
    if (res.ok) setServices((await res.json()).services);
  };
  useEffect(() => { load(); }, []);

  if (editing) return <TemplateEditor svc={editing} onBack={() => { setEditing(null); load(); }} />;

  return (
    <>
      <div className="panel" style={{ padding: '12px 18px', marginBottom: 18, fontSize: 12.5, color: 'var(--text2)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <span>ℹ️</span>
        <span>{t('这里编辑的是「原始模板」。修改只影响之后新建的项目;已建项目保持创建时的模板不变。带「已定制」标记的服务表示已改过,可随时「恢复默认」。',
          'You are editing the original templates. Changes affect NEW projects only; existing projects keep the template they were built with. A "Customized" tag means it has been edited — you can reset to default anytime.')}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 14 }}>
        {services.map((s) => (
          <div key={s.key} className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: s.color }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy900)' }}>{s.label}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>{s.en}</div>
              </div>
              {s.customized && (
                <span className="badge" style={{ background: '#fff3e4', color: '#8f5b1d' }}>{t('已定制', 'Customized')}</span>
              )}
            </div>
            <button className="btn-line sm" onClick={() => setEditing(s.key)}>{t('编辑模板', 'Edit template')}</button>
          </div>
        ))}
      </div>
    </>
  );
}

function TemplateEditor({ svc, onBack }: { svc: string; onBack: () => void }) {
  const { t } = useLang();
  const [tpl, setTpl] = useState<Template | null>(null);
  const [customized, setCustomized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = async () => {
    const res = await fetch(`/api/templates?svc=${svc}`);
    if (res.ok) { const d = await res.json(); setTpl(structuredClone(d.effective)); setCustomized(d.customized); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [svc]);

  if (!tpl) return <div className="panel" style={{ padding: 30, color: 'var(--text2)' }}>{t('加载中…', 'Loading…')}</div>;

  const setSched = (rows: TplScheduleRow[]) => setTpl({ ...tpl, schedule: rows });
  const setCheck = (groups: TplChecklistGroup[]) => setTpl({ ...tpl, checklist: groups });

  async function save() {
    setBusy(true); setMsg('');
    const res = await fetch('/api/templates', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ svc, template: tpl }),
    });
    setBusy(false);
    setMsg(res.ok ? t('✓ 已保存', '✓ Saved') : t('保存失败', 'Save failed'));
    if (res.ok) setCustomized(true);
  }
  async function reset() {
    if (!confirm(t('恢复为系统默认模板?你的定制会被清除。', 'Reset to the built-in default? Your customization will be removed.'))) return;
    const res = await fetch(`/api/templates?svc=${svc}`, { method: 'DELETE' });
    if (res.ok) { setCustomized(false); await load(); setMsg(t('✓ 已恢复默认', '✓ Reset to default')); }
  }

  const editRow = (i: number, field: number, value: string | number | boolean) => {
    const rows = tpl.schedule.map((r) => [...r] as TplScheduleRow);
    (rows[i][field] as string | number | boolean) = value;
    setSched(rows);
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className="btn-line sm" onClick={onBack}>← {t('返回', 'Back')}</button>
        {customized && <span className="badge" style={{ background: '#fff3e4', color: '#8f5b1d' }}>{t('已定制', 'Customized')}</span>}
        <div style={{ flex: 1 }} />
        {msg && <span style={{ fontSize: 12.5, color: msg.startsWith('✓') ? 'var(--success)' : 'var(--danger)' }}>{msg}</span>}
        {customized && <button className="btn-line sm danger" onClick={reset}>{t('恢复默认', 'Reset to default')}</button>}
        <button className="btn-navy sm" onClick={save} disabled={busy}>{busy ? t('保存中…', 'Saving…') : t('保存模板', 'Save template')}</button>
      </div>

      {/* schedule editor */}
      <div className="panel clip" style={{ marginBottom: 18 }}>
        <div className="panel-head"><span className="panel-title" style={{ fontSize: 15 }}>{t('排期阶段 Schedule', 'Schedule phases')}</span></div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
            <tbody>
              <tr style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text2)', background: 'var(--hover-bg)' }}>
                <th style={thL}>#</th><th style={thL}>{t('阶段名(中/EN)', 'Phase (ZH/EN)')}</th><th style={thL}>{t('任务(中)', 'Task ZH')}</th><th style={thL}>Task EN</th>
                <th style={thL}>{t('角色', 'Owner')}</th><th style={thL}>{t('周', 'Wk')}</th><th style={thL}>{t('冻结点提示', 'Gate note')}</th><th style={thL}>❄</th><th style={thL}></th>
              </tr>
              {tpl.schedule.map((r, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--row-line)' }}>
                  <td style={tdL}><input className="in sm" style={{ width: 42 }} value={String(r[0])} onChange={(e) => editRow(i, 0, e.target.value)} /></td>
                  <td style={tdL}>
                    <input className="in sm" style={{ width: 90, marginBottom: 4 }} value={r[1]} onChange={(e) => editRow(i, 1, e.target.value)} placeholder={t('阶段中', 'ZH')} />
                  </td>
                  <td style={tdL}><input className="in sm" style={{ minWidth: 150 }} value={r[2]} onChange={(e) => editRow(i, 2, e.target.value)} /></td>
                  <td style={tdL}><input className="in sm" style={{ minWidth: 150 }} value={r[3]} onChange={(e) => editRow(i, 3, e.target.value)} /></td>
                  <td style={tdL}><input className="in sm" style={{ width: 92 }} value={r[4]} onChange={(e) => editRow(i, 4, e.target.value)} /></td>
                  <td style={tdL}><input className="in sm" type="number" step={0.5} min={0} style={{ width: 56 }} value={r[5]} onChange={(e) => editRow(i, 5, parseFloat(e.target.value) || 0)} /></td>
                  <td style={tdL}><input className="in sm" style={{ minWidth: 160 }} value={r[7]} onChange={(e) => editRow(i, 7, e.target.value)} /></td>
                  <td style={{ ...tdL, textAlign: 'center' }}><input type="checkbox" checked={!!r[8]} onChange={(e) => editRow(i, 8, e.target.checked)} title={t('冻结点', 'Freeze point')} /></td>
                  <td style={tdL}><button style={{ color: 'var(--danger)', fontWeight: 700 }} title={t('删除', 'Delete')} onClick={() => setSched(tpl.schedule.filter((_, k) => k !== i))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: 12 }}>
          <button className="btn-line sm" onClick={() => setSched([...tpl.schedule, [String(tpl.schedule.length), t('新阶段', 'New'), t('新阶段', 'New phase'), 'New phase', 'Audax', 1, '—', ' ', false]])}>
            + {t('添加阶段', 'Add phase')}
          </button>
        </div>
      </div>

      {/* checklist editor */}
      <div className="panel clip">
        <div className="panel-head"><span className="panel-title" style={{ fontSize: 15 }}>{t('信息清单 Checklist', 'Checklist')}</span></div>
        {tpl.checklist.map((g, gi) => (
          <div key={gi} style={{ borderTop: '1px solid var(--row-line)', padding: '12px 16px' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <input className="in sm" style={{ width: 150 }} value={g[0]} placeholder={t('栏目中', 'Group ZH')}
                onChange={(e) => { const gs = structuredClone(tpl.checklist); gs[gi][0] = e.target.value; setCheck(gs); }} />
              <input className="in sm" style={{ width: 150 }} value={g[1]} placeholder="Group EN"
                onChange={(e) => { const gs = structuredClone(tpl.checklist); gs[gi][1] = e.target.value; setCheck(gs); }} />
              <input className="in sm" type="color" style={{ width: 40, padding: 2 }} value={g[2]}
                onChange={(e) => { const gs = structuredClone(tpl.checklist); gs[gi][2] = e.target.value; setCheck(gs); }} />
              <div style={{ flex: 1 }} />
              <button style={{ color: 'var(--danger)', fontWeight: 700, fontSize: 12 }} onClick={() => setCheck(tpl.checklist.filter((_, k) => k !== gi))}>{t('删除栏目', 'Delete group')} ✕</button>
            </div>
            {g[3].map((it, ii) => (
              <div key={ii} style={{ display: 'flex', gap: 6, marginBottom: 5, paddingLeft: 12 }}>
                <input className="in sm" style={{ flex: 1 }} value={it[0]} placeholder={t('信息项中', 'Item ZH')}
                  onChange={(e) => { const gs = structuredClone(tpl.checklist); gs[gi][3][ii][0] = e.target.value; setCheck(gs); }} />
                <input className="in sm" style={{ flex: 1 }} value={it[1]} placeholder="Item EN"
                  onChange={(e) => { const gs = structuredClone(tpl.checklist); gs[gi][3][ii][1] = e.target.value; setCheck(gs); }} />
                <button style={{ color: 'var(--danger)', fontWeight: 700 }} onClick={() => { const gs = structuredClone(tpl.checklist); gs[gi][3] = gs[gi][3].filter((_, k) => k !== ii); setCheck(gs); }}>✕</button>
              </div>
            ))}
            <button className="btn-line sm" style={{ marginLeft: 12, marginTop: 4 }} onClick={() => { const gs = structuredClone(tpl.checklist); gs[gi][3].push([t('新信息项', 'New item'), 'New item']); setCheck(gs); }}>
              + {t('信息项', 'Item')}
            </button>
          </div>
        ))}
        <div style={{ padding: 12 }}>
          <button className="btn-line sm" onClick={() => setCheck([...tpl.checklist, [t('新栏目', 'New group'), 'New group', '#607080', [[t('新信息项', 'New item'), 'New item']]]])}>
            + {t('添加栏目', 'Add group')}
          </button>
        </div>
      </div>
    </>
  );
}

const thL: React.CSSProperties = { padding: '8px 8px', textAlign: 'left', fontWeight: 700 };
const tdL: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'top' };
