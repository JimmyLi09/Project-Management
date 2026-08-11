'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { canAdmin, canEdit } from '@/lib/permissions';
import { svcName, svcColor } from '@/lib/templates';
import { useLang } from '@/lib/i18n';
import { Icon } from '../ui';
import {
  REGISTERS, registerDef, statusFamily, statusMeta, defaultStatus, recordVal, isIncomplete, fieldsOf, FIELD_TYPES,
  type FieldDef, type FieldType, type RegisterDef,
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

function RecordCard({ p, pk, pkgIdx, def: baseDef, canEd }: {
  p: Project; pk: ServicePackage; pkgIdx: number; def: RegisterDef; canEd: boolean;
}) {
  const { dispatch, me, recordFields } = useStore();
  const { lang, t } = useLang();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  /* REQ-023: 字段可由用户增减 —— 把覆盖并进 def,下游 def.fields 自动跟着走 */
  const [fieldEdit, setFieldEdit] = useState(false);
  const def = useMemo<RegisterDef>(() => ({ ...baseDef, fields: fieldsOf(baseDef, recordFields) }), [baseDef, recordFields]);

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
        {/* REQ-023: 字段定义是全局的(改一次影响该服务类型所有项目),只给 PD/BD */}
        {canAdmin(me) && !editing && (
          <button className="btn-line sm" style={fieldEdit ? { borderColor: 'var(--navy700)', color: 'var(--navy900)', fontWeight: 600 } : undefined}
            onClick={() => setFieldEdit(!fieldEdit)}>
            {fieldEdit ? t('完成', 'Done') : t('增减字段', 'Edit fields')}
          </button>
        )}
      </div>

      {fieldEdit && !editing && <FieldEditor svc={baseDef.svc} builtin={baseDef.fields} current={def.fields} onClose={() => setFieldEdit(false)} />}

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


/* ===== REQ-023 — 每个服务类型的字段增减 / 改名 / 换类型 / 排序 =====
   改的是「服务类型」级别的定义:同一类型下所有项目的 Job Record 与项目档案
   登记表都跟着变(需求要的同源)。字段值挂在各项目自己的 record 上,这里只改
   列定义,不动任何已填的数据 —— 删列时值还在库里,把列加回来数据就回来了。 */
function FieldEditor({ svc, builtin, current, onClose }: {
  svc: string; builtin: FieldDef[]; current: FieldDef[]; onClose: () => void;
}) {
  const { setToast, refreshRecordFields } = useStore();
  const { lang, t } = useLang();
  const [rows, setRows] = useState<FieldDef[]>(() => current.map((f) => ({ ...f })));
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const builtinKeys = new Set(builtin.map((f) => f.key));

  const patch = (i: number, up: Partial<FieldDef>) =>
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...up } : r)));

  function addField() {
    const name = prompt(t('新字段名称(中文)', 'New field name'), '');
    if (!name || !name.trim()) return;
    /* key 用来在 record 里存值,必须字母开头且唯一 —— 自动生成,避免用户手填出错 */
    let base = 'f' + name.trim().replace(/[^A-Za-z0-9]/g, '') .slice(0, 20);
    if (base === 'f') base = 'field';
    let key = base, n = 2;
    const used = new Set(rows.map((r) => r.key));
    while (used.has(key)) key = base + n++;
    setRows((rs) => [...rs, { key, zh: name.trim(), en: name.trim(), type: 'text' }]);
  }

  function removeField(i: number) {
    const f = rows[i];
    const msg = builtinKeys.has(f.key)
      ? t(`「${f.zh}」是内置字段。删除后该服务类型的所有项目(Job Record 与项目档案)都不再显示这一列。\n已填的数据不会被删除,把字段加回来就会重新出现。确定删除?`,
          `"${f.zh}" is a built-in column. Removing it hides it for every project of this service type. Existing values are kept and reappear if you add it back. Remove?`)
      : t(`删除字段「${f.zh}」?已填的数据保留,加回来即可恢复显示。`, `Remove "${f.zh}"? Values are kept and reappear if you add it back.`);
    if (!confirm(msg)) return;
    setRows((rs) => rs.filter((_, k) => k !== i));
  }

  async function save() {
    setBusy(true);
    const res = await fetch('/api/record-fields', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ svc, fields: rows }),
    });
    setBusy(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setToast(d.error || t('保存失败', 'Save failed')); return; }
    await refreshRecordFields();
    setToast(t('字段已更新 — 该业务下所有项目一致', 'Fields updated across this service'));
    onClose();
  }

  async function restore() {
    if (!confirm(t('恢复成出厂默认字段?你的自定义字段定义会丢失(已填数据保留)。', 'Restore the built-in columns? Your custom definitions are lost (values kept).'))) return;
    setBusy(true);
    const res = await fetch(`/api/record-fields?svc=${encodeURIComponent(svc)}`, { method: 'DELETE' });
    setBusy(false);
    if (!res.ok) { setToast(t('恢复失败', 'Restore failed')); return; }
    await refreshRecordFields();
    setToast(t('已恢复默认字段', 'Restored built-in columns'));
    onClose();
  }

  return (
    <div style={{ padding: '14px 18px', background: 'var(--hover-bg)', borderTop: '1px solid var(--row-line)', borderBottom: '1px solid var(--row-line)' }}>
      <div style={{ fontSize: 11.5, color: 'var(--text2)', marginBottom: 10 }}>
        {t('改的是这个业务类型的列定义 —— 保存后,该业务下所有项目的 Job Record 与「项目档案」登记表都会一致。已填的数据不会被删。',
           'These columns apply to every project of this service type, in both Job Record and Project Registers. Existing values are never deleted.')}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {rows.map((f, i) => (
          <div key={f.key}
            onDragOver={(e) => { if (drag !== null) e.preventDefault(); }}
            onDrop={(e) => {
              e.preventDefault();
              if (drag === null || drag === i) return;
              setRows((rs) => { const c = [...rs]; const [m] = c.splice(drag, 1); c.splice(i, 0, m); return c; });
              setDrag(null);
            }}
            style={{
              display: 'grid', gridTemplateColumns: '18px minmax(120px,1.4fr) minmax(110px,1.2fr) 116px 74px 28px',
              gap: 8, alignItems: 'center', background: 'var(--card, #fff)',
              border: '1px solid var(--border)', borderRadius: 8, padding: '7px 9px',
              opacity: drag === i ? 0.45 : 1,
            }}>
            <span draggable onDragStart={() => setDrag(i)} onDragEnd={() => setDrag(null)}
              title={t('拖动排序', 'Drag to reorder')}
              style={{ cursor: 'grab', color: 'var(--text2)', userSelect: 'none', fontSize: 13, textAlign: 'center' }}>⠿</span>
            <input className="in sm" value={f.zh} placeholder={t('中文名', 'Name (ZH)')}
              onChange={(e) => patch(i, { zh: e.target.value })} />
            <input className="in sm" value={f.en} placeholder={t('英文名', 'Name (EN)')}
              onChange={(e) => patch(i, { en: e.target.value })} />
            <select className="in sm" value={f.type}
              onChange={(e) => {
                const type = e.target.value as FieldType;
                patch(i, { type, options: type === 'select' ? (f.options && f.options.length ? f.options : [['optionA', '选项A', 'Option A']]) : undefined });
              }}>
              {FIELD_TYPES.map(([v, zh, en]) => <option key={v} value={v}>{lang === 'zh' ? zh : en}</option>)}
            </select>
            <label style={{ fontSize: 11.5, display: 'inline-flex', gap: 5, alignItems: 'center', color: 'var(--text2)' }}>
              <input type="checkbox" checked={!!f.required} onChange={(e) => patch(i, { required: e.target.checked })} />
              {t('必填', 'Req.')}
            </label>
            <button className="btn-line sm danger" title={t('删除字段', 'Remove field')} onClick={() => removeField(i)}>✕</button>

            {f.type === 'select' && (
              <div style={{ gridColumn: '2 / -1', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'var(--text2)' }}>{t('选项(逗号分隔)', 'Options (comma-separated)')}</span>
                <input className="in sm" style={{ flex: 1, minWidth: 200 }}
                  value={(f.options || []).map((o) => o[1]).join(', ')}
                  placeholder="360, 720, VR, AR"
                  onChange={(e) => patch(i, {
                    options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean)
                      .map((x) => [x, x, x] as [string, string, string]),
                  })} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn-line sm" style={{ borderStyle: 'dashed' }} onClick={addField}>＋ {t('新增字段', 'Add field')}</button>
        <div style={{ flex: 1 }} />
        <button className="btn-line sm" onClick={restore} disabled={busy}>↺ {t('恢复默认', 'Restore default')}</button>
        <button className="btn-line sm" onClick={onClose} disabled={busy}>{t('取消', 'Cancel')}</button>
        <button className="btn-navy sm" onClick={save} disabled={busy || rows.length === 0}>
          {busy ? t('保存中…', 'Saving…') : t('保存字段', 'Save fields')}
        </button>
      </div>
    </div>
  );
}
