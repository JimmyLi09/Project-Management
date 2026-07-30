'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { canEdit } from '@/lib/permissions';
import { svcName, svcColor } from '@/lib/templates';
import { useLang } from '@/lib/i18n';
import { Icon } from '../ui';
import {
  REGISTERS, registerDef, statusFamily, statusMeta, defaultStatus, recordVal, isIncomplete,
  type FieldDef, type RegisterDef,
} from '@/lib/records';
import type { Project, ServicePackage } from '@/lib/types';

/* §2 Job Record — single project view: each service package's business record
   shown as a table. Read-only by default; "总编辑" flips the whole card into an
   edit form with one bottom Save (a single setRecord per package). */
export default function JobRecordTab({ p }: { p: Project }) {
  const { me } = useStore();
  const { t } = useLang();
  const canEd = canEdit(me, p);

  const known = p.packages.filter((pk) => registerDef(pk.svc));
  const other = p.packages.filter((pk) => !registerDef(pk.svc));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>
        {t('每个服务的业务资料集中在此维护;与「项目档案」登记表同源,任一处修改即时一致。',
           'Business records for each service live here; the same data powers the cross-project Registers — edit either place, stays in sync.')}
      </div>

      {p.packages.length === 0 && (
        <div className="panel" style={{ padding: 30, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
          {t('此项目暂无服务包。', 'This project has no service packages yet.')}
        </div>
      )}

      {known.map((pk) => {
        const gi = p.packages.indexOf(pk);
        return <RecordCard key={gi} p={p} pk={pk} pkgIdx={gi} def={registerDef(pk.svc)!} canEd={canEd} />;
      })}

      {other.map((pk) => {
        const gi = p.packages.indexOf(pk);
        return (
          <div key={gi} className="panel" style={{ padding: '14px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: svcColor(pk.svc) }} />
              <span style={{ fontSize: 14, fontWeight: 700 }}>{svcName(pk.svc, 'zh')}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6 }}>
              {t('该服务类型暂无资料登记表(仅 7 类业务有:沙盘/LED/投影/3D/MAXHUB/AV/其他)。',
                 'No register defined for this service type (only the 7 business types have one).')}
            </div>
          </div>
        );
      })}

      {canEd && <AddServiceBar p={p} />}
    </div>
  );
}

/* add a business/service to the project mid-flight (production scope changed).
   Only offers the 7 register services the project doesn't already have. */
function AddServiceBar({ p }: { p: Project }) {
  const { dispatch } = useStore();
  const { lang, t } = useLang();
  const [svc, setSvc] = useState('');
  const [busy, setBusy] = useState(false);
  const have = new Set(p.packages.map((pk) => pk.svc));
  const options = REGISTERS.filter((r) => !have.has(r.svc));
  if (options.length === 0) return null;

  return (
    <div className="panel" style={{ padding: '12px 16px', borderStyle: 'dashed' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--navy900)' }}>＋ {t('添加业务', 'Add service')}</span>
        <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{t('制作过程中新增的业务可在此加入', 'Add a service if scope changes during production')}</span>
        <div style={{ flex: 1 }} />
        <select className="in sm" value={svc} onChange={(e) => setSvc(e.target.value)} style={{ width: 'auto' }}>
          <option value="">{t('— 选择业务 —', '— select service —')}</option>
          {options.map((r) => <option key={r.svc} value={r.svc}>{svcName(r.svc, lang)}</option>)}
        </select>
        <button className="btn-navy sm" disabled={busy || !svc}
          onClick={async () => { setBusy(true); await dispatch(p.id, { type: 'addServicePackage', svc, patch: {} }); setBusy(false); setSvc(''); }}>
          {busy ? t('添加中…', 'Adding…') : t('添加', 'Add')}
        </button>
      </div>
    </div>
  );
}

function RecordCard({ p, pk, pkgIdx, def, canEd }: {
  p: Project; pk: ServicePackage; pkgIdx: number; def: RegisterDef; canEd: boolean;
}) {
  const { dispatch } = useStore();
  const { lang, t } = useLang();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const rec = pk.record;
  const status = (rec?.status as string) || defaultStatus(def.kind);
  const incomplete = isIncomplete(def, rec);
  const fam = statusFamily(def.kind);

  function begin() {
    const d: Record<string, string> = { status };
    def.fields.forEach((f) => { d[f.key] = recordVal(rec, f.key); });
    setDraft(d);
    setEditing(true);
  }
  async function save() {
    setBusy(true);
    const ok = await dispatch(p.id, { type: 'setRecord', pkg: pkgIdx, patch: draft });
    setBusy(false);
    if (ok) setEditing(false);
  }
  const set = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const sm = statusMeta(def.kind, status);
  const updated = rec?.updatedAt ? new Date(rec.updatedAt as number) : null;

  return (
    <div className="panel clip">
      <div className="panel-head" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: svcColor(pk.svc) }} />
        <span className="panel-title">{svcName(pk.svc, lang)} · {t('资料', 'Record')}</span>
        {!def.confirmed && (
          <span className="badge" style={{ background: '#fbf0dc', color: '#a8690b', fontSize: 10.5 }}>{t('列待PD确认', 'cols draft')}</span>
        )}
        {incomplete && !editing && (
          <span className="badge" style={{ background: '#fef3c7', color: '#92600a', fontSize: 10.5 }}><Icon name="alert" size={11} />{t('资料不完整', 'incomplete')}</span>
        )}
        <div style={{ flex: 1 }} />
        {!editing && (
          <span className="badge" style={{ background: 'var(--hover-bg)', color: sm[3] }}>
            <span className="bdot" style={{ background: sm[3] }} />{lang === 'zh' ? sm[1] : sm[2]}
          </span>
        )}
        {canEd && !editing && (
          <button className="btn-line sm" onClick={begin}><Icon name="edit" size={13} />{t('总编辑', 'Edit all')}</button>
        )}
      </div>

      {!editing ? (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {def.fields.map((f) => {
              const val = recordVal(rec, f.key);
              const missing = f.required && !val.trim();
              return (
                <tr key={f.key}>
                  <th style={cellK}>{lang === 'zh' ? f.zh : f.en}{f.required && <span style={{ color: 'var(--danger)' }}> *</span>}</th>
                  <td style={{ ...cellV, background: missing ? 'var(--hl-cell, #fef3c7)' : undefined }}>
                    {val ? <FieldValue f={f} val={val} /> : <span style={{ color: missing ? '#b8860b' : '#b6bfc9' }}>{missing ? t('待补充', 'to fill') : '—'}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div style={{ padding: '4px 0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <th style={cellK}>{t('状态', 'Status')}</th>
                <td style={cellV}>
                  <select className="in sm" value={draft.status || ''} onChange={(e) => set('status', e.target.value)} style={{ maxWidth: 220 }}>
                    {fam.map((s) => <option key={s[0]} value={s[0]}>{lang === 'zh' ? s[1] : s[2]}</option>)}
                  </select>
                </td>
              </tr>
              {def.fields.map((f) => (
                <tr key={f.key}>
                  <th style={cellK}>{lang === 'zh' ? f.zh : f.en}{f.required && <span style={{ color: 'var(--danger)' }}> *</span>}</th>
                  <td style={cellV}><FieldInput f={f} val={draft[f.key] || ''} onChange={(v) => set(f.key, v)} lang={lang} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 18px', borderTop: '1px solid var(--row-line)' }}>
            <button className="btn-line sm" onClick={() => setEditing(false)} disabled={busy}>{t('取消', 'Cancel')}</button>
            <button className="btn-navy sm" onClick={save} disabled={busy}>{busy ? t('保存中…', 'Saving…') : t('保存', 'Save')}</button>
          </div>
        </div>
      )}

      {updated && !editing && (
        <div style={{ padding: '8px 18px', fontSize: 11, color: 'var(--text2)', borderTop: '1px solid var(--row-line)' }}>
          {t('最后更新', 'Updated')} {updated.toLocaleDateString()} {updated.toTimeString().slice(0, 5)}
        </div>
      )}
    </div>
  );
}

function FieldValue({ f, val }: { f: FieldDef; val: string }) {
  if (f.type === 'url') return <a href={val} target="_blank" rel="noreferrer" style={{ color: 'var(--info)', wordBreak: 'break-all' }}>{val}</a>;
  if (f.type === 'textarea') return <span style={{ whiteSpace: 'pre-wrap' }}>{val}</span>;
  return <span>{val}</span>;
}

function FieldInput({ f, val, onChange, lang }: { f: FieldDef; val: string; onChange: (v: string) => void; lang: 'zh' | 'en' }) {
  if (f.type === 'textarea') return <textarea className="in sm" value={val} onChange={(e) => onChange(e.target.value)} style={{ minHeight: 52 }} />;
  if (f.type === 'select') return (
    <select className="in sm" value={val} onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 220 }}>
      <option value="">—</option>
      {(f.options || []).map((o) => <option key={o[0]} value={o[0]}>{lang === 'zh' ? o[1] : o[2]}</option>)}
    </select>
  );
  return <input className="in sm" type={f.type === 'date' ? 'date' : 'text'} value={val} onChange={(e) => onChange(e.target.value)} style={f.type === 'date' ? { maxWidth: 190 } : undefined} />;
}

const cellK: React.CSSProperties = { textAlign: 'left', width: '32%', padding: '10px 18px', fontSize: 12.5, fontWeight: 600, color: 'var(--text2)', borderTop: '1px solid var(--row-line)', verticalAlign: 'top' };
const cellV: React.CSSProperties = { padding: '10px 18px', fontSize: 13, borderTop: '1px solid var(--row-line)' };
