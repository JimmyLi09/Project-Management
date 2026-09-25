'use client';

/* ===== AV 价格库 =====
   Editable price list for costing. Prices change, so the library starts empty
   and is filled by import (the 2026 LED cost book, from the PDF) or by hand;
   every price edit is kept in the item's history, and cost sheets keep their own
   snapshot of what they used. Only PD / BD edit (管理员, §11). */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { PriceItem } from '@/av/core/pricing';
import { canEditPrices, canViewPrices } from '@/lib/permissions';
import { fmtDate } from '@/lib/project';
import { useLang } from '@/lib/i18n';
import { useStore } from '../store';

type Draft = Partial<Omit<PriceItem, 'costPrice' | 'listPrice'>> & { costPrice?: string | number | null; listPrice?: string | number | null };

const EMPTY: Draft = { categoryLabel: '', model: '', pitch: '', moduleSize: '', cabinetSize: '', unit: '㎡', costPrice: '', listPrice: '', validUntil: '' };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init).catch(() => null);
  const body = res ? await res.json().catch(() => ({})) : { error: '网络错误' };
  if (!res?.ok || body.error) throw new Error(body.error || '请求失败');
  return body as T;
}

const money = (v: number | null) => (v === null ? '—' : `$${v.toLocaleString('en-US')}`);

export default function AvPricesView() {
  const { me } = useStore();
  const { t } = useLang();
  const mayEdit = canEditPrices(me);
  const [line, setLine] = useState<'led' | 'projector' | 'elv'>('led');
  const [items, setItems] = useState<PriceItem[]>([]);
  const [floor, setFloor] = useState<number | null>(null);
  const [floorDraft, setFloorDraft] = useState('');
  const [cat, setCat] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [adding, setAdding] = useState(false);
  const [history, setHistory] = useState<{ id: number; rows: { cost_price: number | null; list_price: number | null; valid_until: string; changed_by: string; changed_at: number }[] } | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setItems((await call<{ items: PriceItem[] }>(`/api/av/prices?line=${line}`)).items);
      const f = (await call<{ marginFloor: number }>('/api/av/settings')).marginFloor;
      setFloor(f);
      setFloorDraft(String(Math.round(f * 1000) / 10));
    } catch (e) { setError((e as Error).message); }
  }, [line]);
  useEffect(() => { if (canViewPrices(me)) load(); }, [load, me]);
  useEffect(() => { setCat(''); setEditing(null); setAdding(false); setHistory(null); setMsg(''); }, [line]);

  const categories = useMemo(() => [...new Map(items.map((i) => [i.categoryLabel, i.categoryLabel])).keys()], [items]);
  const shown = cat ? items.filter((i) => i.categoryLabel === cat) : items;

  if (!canViewPrices(me)) {
    return <div className="panel" style={{ padding: '18px 20px', fontSize: 13, color: 'var(--text2)' }}>{t('当前角色无权查看价格库。', 'Your role cannot see the price library.')}</div>;
  }

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setError(''); setMsg('');
    try { await fn(); if (ok) setMsg(ok); await load(); }
    catch (e) { setError((e as Error).message); }
  }

  const importPdf = () => run(async () => {
    const r = await call<{ added: number; skipped: number }>('/api/av/prices', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ import: 'led-2026-04' }),
    });
    setMsg(t(`已导入 ${r.added} 条，跳过已存在的 ${r.skipped} 条。`, `Imported ${r.added}, skipped ${r.skipped}.`));
  });

  const saveFloor = () => run(() => call('/api/av/settings', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ marginFloor: Number(floorDraft) / 100 }),
  }), t('毛利下限已更新。', 'Margin floor updated.'));

  const save = () => run(async () => {
    const item = { ...draft, line };
    if (editing !== null) await call(`/api/av/prices/${editing}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item }) });
    else await call('/api/av/prices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item }) });
    setEditing(null); setAdding(false); setDraft(EMPTY);
  }, t('已保存。', 'Saved.'));

  const toggleActive = (i: PriceItem) => run(() => call(`/api/av/prices/${i.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { active: !i.active } }),
  }));

  async function showHistory(id: number) {
    if (history?.id === id) { setHistory(null); return; }
    try { setHistory({ id, rows: (await call<{ history: NonNullable<typeof history>['rows'] }>(`/api/av/prices/${id}`)).history }); }
    catch (e) { setError((e as Error).message); }
  }

  const field = (k: keyof Draft, w: number, type = 'text', ph = '') => (
    <input className="in sm" type={type} style={{ width: w }} placeholder={ph} value={(draft[k] as string | number | null | undefined) ?? ''}
      onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} aria-label={String(k)} />
  );

  const editRow = (key: string) => (
    <tr key={key} style={{ background: 'var(--hover-bg)' }}>
      <td style={td}>{field('categoryLabel', 130, 'text', t('类别 *', 'Category *'))}</td>
      <td style={td}>{field('model', 110, 'text', t('型号', 'Model'))}</td>
      <td style={td}>{field('pitch', 90, 'text', line === 'projector' ? '12000 lm' : line === 'elv' ? '650 W' : 'P2')}</td>
      <td style={td}>{field('moduleSize', 100)}</td>
      <td style={td}>{field('cabinetSize', 130)}</td>
      <td style={td}>{field('unit', 50, 'text', '㎡')}</td>
      <td style={td}>{field('costPrice', 90, 'number', t('待定', 'tbd'))}</td>
      <td style={td}>{field('listPrice', 90, 'number', t('待定', 'tbd'))}</td>
      <td style={td}>{field('validUntil', 140, 'date')}</td>
      <td style={{ ...td, whiteSpace: 'nowrap' }} colSpan={2}>
        <button className="btn-navy" onClick={save}>{t('保存', 'Save')}</button>{' '}
        <button className="btn-line" onClick={() => { setEditing(null); setAdding(false); setDraft(EMPTY); }}>{t('取消', 'Cancel')}</button>
      </td>
    </tr>
  );

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head">
          <span className="panel-title">{t('公司参数', 'Company parameters')}</span>
        </div>
        <div style={{ padding: '14px 18px', display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ marginBottom: 0, width: 200 }}>
            <label htmlFor="floor">{t('毛利下限 %', 'Margin floor %')}</label>
            <input id="floor" type="number" step="0.1" value={floorDraft} readOnly={!mayEdit} onChange={(e) => setFloorDraft(e.target.value)} />
          </div>
          {mayEdit && floor !== null && Number(floorDraft) / 100 !== floor && <button className="btn-navy" onClick={saveFloor}>{t('保存', 'Save')}</button>}
          <p style={{ fontSize: 12, color: 'var(--text2)', maxWidth: 560, lineHeight: 1.7 }}>
            {t('成本核算的「提交前检查」用它判断毛利是否达标。默认 18% 取自 06 原型。', 'Used by the pre-submit check in 06. Default 18% from the prototype.')}
          </p>
        </div>
      </div>

      <div className="panel clip" style={{ padding: 0 }}>
        <div className="panel-head">
          <span className="panel-title" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <select className="in sm" value={line} onChange={(e) => setLine(e.target.value as 'led' | 'projector' | 'elv')} aria-label={t('业务线', 'Line')}>
              <option value="led">{t('LED 价格库', 'LED price library')}</option>
              <option value="projector">{t('投影价格库', 'Projection price library')}</option>
              <option value="elv">{t('弱电价格库', 'ELV price library')}</option>
            </select>
            <span style={{ fontWeight: 400, color: 'var(--text2)', fontSize: 12 }}>· {items.length} {t('条', 'items')}</span></span>
          {mayEdit && (
            <span style={{ display: 'flex', gap: 8 }}>
              {line === 'led' && <button className="btn-line" onClick={importPdf}>{t('导入 2026 LED 价格表（PDF）', 'Import 2026 LED cost book')}</button>}
              <button className="btn-navy" onClick={() => { setAdding(true); setEditing(null); setDraft(EMPTY); }}>{t('新增条目', 'Add item')}</button>
            </span>
          )}
        </div>

        <div style={{ padding: '12px 18px', display: 'grid', gap: 10 }}>
          <p style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
            {line === 'led'
              ? t('成本价取 PDF 的 Partner Price，售价取 MSRP；价格会变，可随时修改，每次改价都留有历史。价格留空表示待定价，成本表会拦住未定价的条目。线材、控制系统、钢结构、安装人工等不在 PDF 中，需要逐条添加。',
                'Cost = Partner Price, sell = MSRP. Every price change is kept in history. Blank prices block costing.')
              : line === 'elv'
              ? t('弱电暂无价格表，逐条录入。功放的「规格」栏填功率（如 650 W），成本核算据此核对是否满足每区负载；六类线按箱（305 m）、录像硬盘按 TB、门禁按套、其余按台 / 个 / 只计价。',
                'No price list yet. Put amplifier power in the spec column (e.g. 650 W); Cat6 per 305 m box, storage per TB.')
              : t('投影暂无价格表，逐条录入。投影机的「规格」栏填亮度（如 12000 lm），成本核算据此核对是否满足单机所需亮度；幕布按 ㎡、信号线按根、吊架与融合处理器按套计价。',
                'No price list yet. Put brightness in the spec column (e.g. 12000 lm) for projectors.')}
          </p>
          {categories.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {['', ...categories].map((c) => (
                <button key={c || 'all'} className="btn-line" onClick={() => setCat(c)}
                  style={c === cat ? { background: 'var(--navy900)', color: '#fff', borderColor: 'var(--navy900)' } : undefined}>
                  {c || t('全部', 'All')}
                </button>
              ))}
            </div>
          )}
          {msg && <div style={{ fontSize: 12.5, color: 'var(--success)' }}>{msg}</div>}
          {error && <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>{error}</div>}
        </div>

        {items.length === 0 && !adding ? (
          <p style={{ padding: '0 18px 18px', fontSize: 13, color: 'var(--text2)' }}>
            {line === 'led' ? t('价格库为空。可导入 2026 年 LED 价格表，或逐条添加。', 'The library is empty. Import the 2026 LED cost book or add items.') : t('投影价格库为空，请逐条添加。', 'The projection library is empty.')}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 1180 }}>
              <tbody>
                <tr>
                  {[t('类别', 'Category'), t('型号', 'Model'), line === 'projector' ? t('规格 / 亮度', 'Spec / lumens') : line === 'elv' ? t('规格 / 功率', 'Spec / power') : t('点间距', 'Pitch'), t('模组尺寸', 'Module'), t('箱体 / 产品尺寸', 'Cabinet / product'),
                    t('单位', 'Unit'), t('成本价 Partner', 'Cost (Partner)'), t('售价 MSRP', 'Sell (MSRP)'), t('有效期至', 'Valid until'), t('更新', 'Updated'), ''].map((h, i) => <th key={i} style={th}>{h}</th>)}
                </tr>
                {adding && editRow('new')}
                {shown.map((i) => editing === i.id ? editRow(`e${i.id}`) : (
                  <React.Fragment key={i.id}>
                    <tr style={{ opacity: i.active ? 1 : 0.5 }}>
                      <td style={td}>{i.categoryLabel}</td>
                      <td style={td}>{i.model || '—'}</td>
                      <td style={td}>{i.pitch || '—'}</td>
                      <td style={td}>{i.moduleSize || '—'}</td>
                      <td style={td}>{i.cabinetSize || '—'}</td>
                      <td style={td}>{i.unit}</td>
                      <td style={{ ...td, textAlign: 'right' }} className="tnum">{i.costPrice === null ? <span style={{ color: 'var(--warning)' }}>{t('待定价', 'tbd')}</span> : money(i.costPrice)}</td>
                      <td style={{ ...td, textAlign: 'right' }} className="tnum">{i.listPrice === null ? <span style={{ color: 'var(--warning)' }}>{t('待定价', 'tbd')}</span> : money(i.listPrice)}</td>
                      <td style={td}>{i.validUntil || '—'}</td>
                      <td style={{ ...td, color: 'var(--text2)', whiteSpace: 'nowrap' }}>{i.updatedBy} · {fmtDate(new Date(i.updatedAt))}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <button style={link} onClick={() => showHistory(i.id)}>{t('历史', 'History')}</button>
                        {mayEdit && <>
                          {' · '}<button style={link} onClick={() => { setEditing(i.id); setAdding(false); setDraft({ ...i }); }}>{t('编辑', 'Edit')}</button>
                          {' · '}<button style={link} onClick={() => toggleActive(i)}>{i.active ? t('停用', 'Disable') : t('启用', 'Enable')}</button>
                        </>}
                      </td>
                    </tr>
                    {history?.id === i.id && (
                      <tr><td colSpan={11} style={{ ...td, background: 'var(--hover-bg)', fontSize: 12 }}>
                        {history.rows.map((h, k) => (
                          <div key={k} className="tnum">
                            {fmtDate(new Date(h.changed_at))} · {h.changed_by} · {t('成本', 'cost')} {money(h.cost_price)} · {t('售价', 'sell')} {money(h.list_price)}{h.valid_until ? ` · ${t('有效期至', 'until')} ${h.valid_until}` : ''}
                          </div>
                        ))}
                        <div style={{ color: 'var(--text2)', marginTop: 4 }}>{i.source}</div>
                      </td></tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const link: React.CSSProperties = { fontSize: 12, color: 'var(--navy700)', textDecoration: 'underline' };
const th: React.CSSProperties = {
  padding: '9px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
  color: 'var(--text2)', background: 'var(--hover-bg)', textAlign: 'left', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { padding: '8px 12px', borderTop: '1px solid var(--row-line)', verticalAlign: 'top' };
