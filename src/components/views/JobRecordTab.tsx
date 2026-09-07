'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { canAdmin, canDelete, canEdit } from '@/lib/permissions';
import { svcName, svcColor } from '@/lib/templates';
import { fmtDate, parseISO, pkgSuffix, projCode } from '@/lib/project';
import { useLang } from '@/lib/i18n';
import { Icon } from '../ui';
import {
  REGISTERS, registerDef, statusFamily, statusMeta, defaultStatus, recordVal, isIncomplete, fieldsOf, FIELD_TYPES, formulaText, optionLabel,
  type FieldDef, type FieldType, type RegisterDef,
} from '@/lib/records';
import type { Project, ServicePackage } from '@/lib/types';
import JobRecordExport from './JobRecordExport';

/* §2 Job Record — single project view: each service package's business record
   shown as a table. Read-only by default; "总编辑" flips the whole card into an
   edit form with one bottom Save (a single setRecord per package). */
export default function JobRecordTab({ p }: { p: Project }) {
  const { me } = useStore();
  const { lang, t } = useLang();
  const canEd = canEdit(me, p);

  const known = p.packages.filter((pk) => registerDef(pk.svc));
  const other = p.packages.filter((pk) => !registerDef(pk.svc));

  /* REQ-032: 一个「总编辑」管整页 —— 不要每块各自一个铅笔。
     各张资料卡把自己的 进入编辑 / 保存 / 取消 注册进来,页面顶部统一调度;
     保存仍是每个服务包一次 setRecord(服务端本来就是按包写的),
     所以底下每张卡自己的保存按钮也留着,单独改一张时更顺手。 */
  const cardApi = React.useRef<Record<number, { begin: () => void; save: () => Promise<void>; cancel: () => void }>>({});
  const [editAll, setEditAll] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [exporting, setExporting] = useState(false);
  const register = React.useCallback((idx: number, api: { begin: () => void; save: () => Promise<void>; cancel: () => void } | null) => {
    if (api) cardApi.current[idx] = api; else delete cardApi.current[idx];
  }, []);

  if (exporting) return <JobRecordExport p={p} onClose={() => setExporting(false)} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12.5, color: 'var(--text2)', flex: 1, minWidth: 240 }}>
          {t('每个服务的业务资料集中在此维护;与「项目档案」登记表同源,任一处修改即时一致。',
             'Business records for each service live here; the same data powers the cross-project Registers — edit either place, stays in sync.')}
        </div>
        {/* REQ-039: 整份 Job Record 可下载 —— 打印/另存 PDF 与 Excel(CSV) */}
        <button className="btn-line sm" onClick={() => setExporting(true)} disabled={known.length === 0}>
          <Icon name="download" size={13} />{t('下载', 'Download')}
        </button>
        {canEd && known.length > 0 && (editAll ? (
          <>
            <button className="btn-line sm" disabled={savingAll}
              onClick={() => { Object.values(cardApi.current).forEach((a) => a.cancel()); setEditAll(false); }}>
              {t('取消', 'Cancel')}
            </button>
            <button className="btn-navy sm" disabled={savingAll}
              onClick={async () => {
                setSavingAll(true);
                for (const a of Object.values(cardApi.current)) await a.save();
                setSavingAll(false); setEditAll(false);
              }}>
              {savingAll ? t('保存中…', 'Saving…') : t('保存', 'Save')}
            </button>
          </>
        ) : (
          <button className="btn-navy sm" onClick={() => { Object.values(cardApi.current).forEach((a) => a.begin()); setEditAll(true); }}>
            <Icon name="edit" size={13} />{t('总编辑', 'Edit all')}
          </button>
        ))}
      </div>

      {/* REQ-032: 同步自项目创建的信息 —— 表格化、始终只读,它跟着项目走。
          REQ-039: 这一条保留(需求方确认),但每一项都必须在别处改得动 ——
          项目名 / 报价号 / 客户在项目页抬头点一下就能改,交付日在「概览 ·
          交付核算」里改,PM 在「项目团队」里指派。所以这里挂一句话说清楚
          去哪儿改,而不是让人对着一张只读表干瞪眼。 */}
      <div className="panel clip">
        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--row-line)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="panel-title" style={{ fontSize: 14 }}>{t('项目信息', 'Project info')}</span>
          <span className="badge" style={{ background: 'var(--hover-bg)', color: 'var(--text2)' }}>
            {t('同步自项目创建 · 只读', 'Synced from the project · read-only')}
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>
            {t('要改?项目名 / 报价号 / 客户在页面抬头点一下改;交付日在「概览 · 交付核算」;PM 在「概览 · 项目团队」。',
               'To edit: name / quote no. / client in the page header; delivery date under Overview · Delivery Check; PM under Overview · Assigned Team.')}
          </span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {([
              [t('项目编号', 'Project no.'), projCode(p) || '—'],
              [t('项目名称', 'Project name'), p.name],
              [t('客户', 'Client'), p.client || '—'],
              [t('报价号', 'Quotation no.'), p.quotationNo || '—'],
              [t('PM', 'PM'), (p.owners || []).join(' / ') || '—'],
              [t('交付日期', 'Delivery'), p.delivery ? fmtDate(parseISO(p.delivery)) : '—'],
              [t('服务', 'Services'), p.services.map((k) => svcName(k, lang)).join(', ') || '—'],
            ] as [string, string][]).map(([k, v], i) => (
              <tr key={i}>
                <th style={cellK}>{k}</th>
                <td style={cellV}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {p.packages.length === 0 && (
        <div className="panel" style={{ padding: 30, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
          {t('此项目暂无服务包。', 'This project has no service packages yet.')}
        </div>
      )}

      {known.map((pk) => {
        const gi = p.packages.indexOf(pk);
        return <RecordCard key={gi} p={p} pk={pk} pkgIdx={gi} def={registerDef(pk.svc)!} canEd={canEd} register={register} />;
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
  const { dispatch, recordFields } = useStore();
  const { lang, t } = useLang();
  const [svc, setSvc] = useState('');
  const [label, setLabel] = useState('');
  const [spec, setSpec] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  /* REQ-026: 同类业务可以再加一份(两块 LED / 两个沙盘),所以不再排除已有的;
     已经有的在下拉里标一下「已有 N 份」,免得手滑重复添加。 */
  const countOf = (k: string) => p.packages.filter((x) => x.svc === k).length;
  const options = REGISTERS;

  /* REQ-039: 选了业务之后,把这张登记表最前面两个下拉字段(LED 就是
     Screen Resolution / Location)顺手摆出来,添加时一起带进 record ——
     省得加完再进卡片补。哪些字段出现完全跟着字段定义走,PD 在「增减字段」
     里把某列改成下拉,这里就自动多一个选项,不需要改代码。 */
  const baseDef = svc ? registerDef(svc) : undefined;
  const specFields = useMemo(
    () => (baseDef ? fieldsOf(baseDef, recordFields).filter((f) => f.type === 'select').slice(0, 2) : []),
    [baseDef, recordFields],
  );

  return (
    <div className="panel" style={{ padding: '12px 16px', borderStyle: 'dashed' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--navy900)' }}>＋ {t('添加业务', 'Add service')}</span>
        <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{t('制作过程中新增的业务可在此加入', 'Add a service if scope changes during production')}</span>
        <div style={{ flex: 1 }} />
        <select className="in sm" value={svc} onChange={(e) => { setSvc(e.target.value); setSpec({}); }} style={{ width: 'auto' }}>
          <option value="">{t('— 选择业务 —', '— select service —')}</option>
          {options.map((r) => {
            const n = countOf(r.svc);
            return <option key={r.svc} value={r.svc}>{svcName(r.svc, lang)}{n ? t(`（已有 ${n} 份）`, ` (${n} existing)`) : ''}</option>;
          })}
        </select>
        {specFields.map((f) => (
          <select key={f.key} className="in sm" style={{ width: 'auto' }} value={spec[f.key] || ''}
            onChange={(e) => setSpec((s) => ({ ...s, [f.key]: e.target.value }))}>
            <option value="">{t(`— ${f.zh} —`, `— ${f.en} —`)}</option>
            {(f.options || []).map((o) => <option key={o[0]} value={o[0]}>{lang === 'zh' ? o[1] : o[2]}</option>)}
          </select>
        ))}
        <input className="in sm" style={{ width: 150 }} value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder={t('实例名(可空)', 'Instance name (optional)')}
          title={t('同类多份时用来区分,例如「大堂 LED」「入口 LED」;留空则按 ①②③ 标号', 'Distinguishes multiple of the same type, e.g. "Lobby LED"; blank falls back to ①②③')} />
        <button className="btn-navy sm" disabled={busy || !svc}
          onClick={async () => {
            setBusy(true);
            const patch = Object.fromEntries(Object.entries(spec).filter(([, v]) => v));
            await dispatch(p.id, { type: 'addServicePackage', svc, patch, asNew: true, label: label.trim() });
            setBusy(false); setSvc(''); setLabel(''); setSpec({});
          }}>
          {busy ? t('添加中…', 'Adding…') : t('添加', 'Add')}
        </button>
      </div>

      {/* REQ-039:「已添加」列表 —— 同类多块时一眼看清这个项目现在有几份、分别是什么 */}
      {p.packages.length > 0 && (
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--row-line)' }}>
          <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{t('已添加', 'Added')} ({p.packages.length})</span>
          {p.packages.map((pk, i) => {
            const d = registerDef(pk.svc);
            const sel = d ? fieldsOf(d, recordFields).filter((f) => f.type === 'select').slice(0, 2) : [];
            const spec2 = sel.map((f) => optionLabel(f, recordVal(pk.record, f.key), lang)).filter(Boolean).join(' · ');
            return (
              <span key={i} className="badge" style={{ background: 'var(--hover-bg)', color: 'var(--text2)' }}>
                <span className="bdot" style={{ background: svcColor(pk.svc) }} />
                {svcName(pk.svc, lang)}{pkgSuffix(p, i) ? ' ' + pkgSuffix(p, i) : ''}{spec2 ? ' · ' + spec2 : ''}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RecordCard({ p, pk, pkgIdx, def: baseDef, canEd, register }: {
  p: Project; pk: ServicePackage; pkgIdx: number; def: RegisterDef; canEd: boolean;
  register?: (idx: number, api: { begin: () => void; save: () => Promise<void>; cancel: () => void } | null) => void;
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
    def.fields.forEach((f) => { if (f.type !== 'formula') d[f.key] = recordVal(rec, f.key); });
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

  /* REQ-032: 把本卡的 进入编辑 / 保存 / 取消 交给页面级「总编辑」调度。
     依赖里带上 rec 与 def.fields —— 字段或值变了要重新注册,
     否则总编辑保存的会是旧闭包里的 draft 初值。 */
  const beginRef = React.useRef(begin), saveRef = React.useRef(save);
  beginRef.current = begin; saveRef.current = save;
  React.useEffect(() => {
    if (!register || !canEd) return;
    register(pkgIdx, {
      begin: () => beginRef.current(),
      save: async () => { await saveRef.current(); },
      cancel: () => setEditing(false),
    });
    return () => register(pkgIdx, null);
  }, [register, canEd, pkgIdx]);

  const sm = statusMeta(def.kind, status);
  const updated = rec?.updatedAt ? new Date(rec.updatedAt as number) : null;

  return (
    <div className="panel clip">
      <div className="panel-head" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: svcColor(pk.svc) }} />
        {/* REQ-026: 同类有多份时,标题带上实例名或 ①②③ */}
        <span className="panel-title">
          {svcName(pk.svc, lang)}
          {pkgSuffix(p, pkgIdx) && <span style={{ color: 'var(--bronze)', marginLeft: 6 }}>{pkgSuffix(p, pkgIdx)}</span>}
          <span style={{ color: 'var(--text2)', fontWeight: 400 }}> · {t('资料', 'Record')}</span>
        </span>
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
        {/* REQ-032: 卡片上不再各放一个编辑按钮 —— 整页只留顶部那一个「总编辑」,
            需求方明确否掉了分块编辑。 */}
        {/* REQ-023: 字段定义是全局的(改一次影响该服务类型所有项目),只给 PD/BD */}
        {canAdmin(me) && !editing && (
          <button className="btn-line sm" style={fieldEdit ? { borderColor: 'var(--navy700)', color: 'var(--navy900)', fontWeight: 600 } : undefined}
            onClick={() => setFieldEdit(!fieldEdit)}>
            {fieldEdit ? t('完成', 'Done') : t('增减字段', 'Edit fields')}
          </button>
        )}
        {/* REQ-026: 删除这一份业务。整包连排期/信息清单/资料一起没,
            所以只给 Sales / PD / BD,并且说清楚删的是什么。 */}
        {canDelete(me) && !editing && p.packages.length > 1 && (
          <button className="btn-line sm danger" title={t('删除这份业务', 'Remove this service')}
            onClick={async () => {
              const name = svcName(pk.svc, lang) + (pkgSuffix(p, pkgIdx) ? ' ' + pkgSuffix(p, pkgIdx) : '');
              const sched = pk.schedule.length, items = pk.checklist.reduce((n, g) => n + g.items.length, 0);
              if (!confirm(t(
                `删除业务「${name}」?\n它的 ${sched} 个排期阶段、${items} 个信息项和这张资料卡会一起删掉,不能撤销。`,
                `Remove "${name}"? Its ${sched} schedule phases, ${items} checklist items and this record card go with it. This cannot be undone.`))) return;
              await dispatch(p.id, { type: 'removeServicePackage', pkg: pkgIdx });
            }}>✕ {t('删除业务', 'Remove')}</button>
        )}
      </div>

      {fieldEdit && !editing && <FieldEditor svc={baseDef.svc} builtin={baseDef.fields} current={def.fields} onClose={() => setFieldEdit(false)} />}

      {!editing ? (
        /* REQ-027: 按分组渲染,组内两列 —— 尺寸/数量/计算这些相关字段聚在一块,
           不再一长条竖着散开。没设分组的字段归到最前面的「未分组」里照旧显示。 */
        <div style={{ padding: '2px 0 6px' }}>
          {groupFields(def.fields).map(([gname, gfields]) => (
            <div key={gname || '_'}>
              {gname && (
                <div style={{ padding: '10px 18px 4px', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text2)' }}>
                  {gname}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: '0 18px', padding: '0 18px' }}>
                {gfields.map((f) => {
                  const isF = f.type === 'formula';
                  const val = isF ? formulaText(f, def.fields, rec) : recordVal(rec, f.key);
                  const missing = !isF && f.required && !val.trim();
                  /* REQ-039: 关键信息粗体 —— 公式算出来的结果本来就是重点,一并加粗 */
                  const key = !!f.highlight || isF;
                  return (
                    <div key={f.key} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '7px 0', borderBottom: '1px solid var(--row-line)', minWidth: 0 }}>
                      <span style={{ flex: '0 0 40%', fontSize: 12, color: key ? 'var(--navy900)' : 'var(--text2)', fontWeight: key ? 700 : 600 }}>
                        {lang === 'zh' ? f.zh : f.en}
                        {f.required && <span style={{ color: 'var(--danger)' }}> *</span>}
                        {isF && <span title={f.formula} style={{ marginLeft: 5, fontSize: 10, color: 'var(--bronze)' }}>ƒ</span>}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: key ? 700 : 400, background: missing ? 'var(--hl-cell, #fef3c7)' : undefined }}>
                        {isF
                          ? <b className="tnum" style={{ color: val === '—' ? '#b6bfc9' : 'var(--navy900)' }}>{val}</b>
                          : val ? <FieldValue f={f} val={val} lang={lang} />
                          : <span style={{ color: missing ? '#b8860b' : '#b6bfc9', fontWeight: 400 }}>{missing ? t('待补充', 'to fill') : '—'}</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
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
                  <th style={f.highlight ? { ...cellK, color: 'var(--navy900)', fontWeight: 700 } : cellK}>
                    {lang === 'zh' ? f.zh : f.en}{f.required && <span style={{ color: 'var(--danger)' }}> *</span>}
                    {f.type === 'formula' && <span title={f.formula} style={{ marginLeft: 5, fontSize: 10, color: 'var(--bronze)' }}>ƒ</span>}
                  </th>
                  <td style={cellV}>
                    {/* REQ-027: 公式字段是算出来的,编辑态也不给手填 —— 随着上面的
                        源字段边改边重算,所见即保存后的值。 */}
                    {f.type === 'formula' ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                        <b className="tnum">{formulaText(f, def.fields, { ...(rec || {}), ...draft })}</b>
                        <span style={{ fontSize: 11, color: 'var(--text2)' }}>= {f.formula}</span>
                      </span>
                    ) : (
                      <FieldInput f={f} val={draft[f.key] || ''} onChange={(v) => set(f.key, v)} lang={lang} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* 保存 / 取消 统一放在页面顶部,这里不再重复一套 */}
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

function FieldValue({ f, val, lang }: { f: FieldDef; val: string; lang: 'zh' | 'en' }) {
  if (f.type === 'url') return <a href={val} target="_blank" rel="noreferrer" style={{ color: 'var(--info)', wordBreak: 'break-all' }}>{val}</a>;
  if (f.type === 'textarea') return <span style={{ whiteSpace: 'pre-wrap' }}>{val}</span>;
  /* REQ-039: 下拉显示选项名而不是存的 key */
  if (f.type === 'select') return <span>{optionLabel(f, val, lang)}</span>;
  return <span>{val}</span>;
}

function FieldInput({ f, val, onChange, lang }: { f: FieldDef; val: string; onChange: (v: string) => void; lang: 'zh' | 'en' }) {
  if (f.type === 'textarea') return <textarea className="in sm" value={val} onChange={(e) => onChange(e.target.value)} style={{ minHeight: 52 }} />;
  if (f.type === 'select') {
    /* REQ-039: 一个字段从文本改成下拉之后,老数据的值多半不在选项里。
       把它补成一个选项显示出来,不然编辑一进来就是空的 —— 存下去等于把
       历史值抹了。用户重新选一个新选项就自然覆盖掉。 */
    const opts = f.options || [];
    const legacy = val && !opts.some((o) => o[0] === val);
    return (
      <select className="in sm" value={val} onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 220 }}>
        <option value="">—</option>
        {opts.map((o) => <option key={o[0]} value={o[0]}>{lang === 'zh' ? o[1] : o[2]}</option>)}
        {legacy && <option value={val}>{val}（{lang === 'zh' ? '原值' : 'existing'}）</option>}
      </select>
    );
  }
  if (f.type === 'number') return <input className="in sm" type="number" value={val} onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 190 }} />;
  return <input className="in sm" type={f.type === 'date' ? 'date' : 'text'} value={val} onChange={(e) => onChange(e.target.value)} style={f.type === 'date' ? { maxWidth: 190 } : undefined} />;
}

const cellK: React.CSSProperties = { textAlign: 'left', width: '32%', padding: '10px 18px', fontSize: 12.5, fontWeight: 600, color: 'var(--text2)', borderTop: '1px solid var(--row-line)', verticalAlign: 'top' };
const cellV: React.CSSProperties = { padding: '10px 18px', fontSize: 13, borderTop: '1px solid var(--row-line)' };


/* ===== REQ-023 — 每个服务类型的字段增减 / 改名 / 换类型 / 排序 =====
   改的是「服务类型」级别的定义:同一类型下所有项目的 Job Record 与项目档案
   登记表都跟着变(需求要的同源)。字段值挂在各项目自己的 record 上,这里只改
   列定义,不动任何已填的数据 —— 删列时值还在库里,把列加回来数据就回来了。 */
export function FieldEditor({ svc, builtin, current, onClose }: {
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
              display: 'grid', gridTemplateColumns: '18px minmax(120px,1.4fr) minmax(110px,1.2fr) 116px 128px 28px',
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
                patch(i, {
                  type,
                  options: type === 'select' ? (f.options && f.options.length ? f.options : [['optionA', '选项A', 'Option A']]) : undefined,
                  formula: type === 'formula' ? (f.formula || '') : undefined,
                  decimals: type === 'formula' ? (f.decimals ?? 2) : undefined,
                });
              }}>
              {FIELD_TYPES.map(([v, zh, en]) => <option key={v} value={v}>{lang === 'zh' ? zh : en}</option>)}
            </select>
            <label style={{ fontSize: 11.5, display: 'inline-flex', gap: 5, alignItems: 'center', color: 'var(--text2)' }}>
              <input type="checkbox" checked={!!f.required} onChange={(e) => patch(i, { required: e.target.checked })} />
              {t('必填', 'Req.')}
              {/* REQ-039: 关键信息加粗显示 */}
              <input type="checkbox" checked={!!f.highlight} onChange={(e) => patch(i, { highlight: e.target.checked })}
                title={t('标为关键信息 —— 在资料卡和登记表里加粗显示', 'Mark as key info — shown in bold')} />
              {t('重点', 'Key')}
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

            {/* REQ-027: 公式字段 —— 表达式由你自己填,系统不写死任何一条 */}
            {f.type === 'formula' && (
              <div style={{ gridColumn: '2 / -1', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'var(--bronze)', fontWeight: 700 }}>ƒ =</span>
                <input className="in sm" style={{ flex: 1, minWidth: 220, fontFamily: 'ui-monospace, monospace' }}
                  value={f.formula || ''} placeholder="L * H / 1000000"
                  onChange={(e) => patch(i, { formula: e.target.value })} />
                <span style={{ fontSize: 11, color: 'var(--text2)' }}>{t('小数位', 'Decimals')}</span>
                <input className="in sm" type="number" min={0} max={6} style={{ width: 60 }}
                  value={f.decimals ?? 2} onChange={(e) => patch(i, { decimals: Math.max(0, Math.min(6, parseInt(e.target.value) || 0)) })} />
              </div>
            )}
            {f.type === 'formula' && (
              <div style={{ gridColumn: '2 / -1', fontSize: 11, color: 'var(--text2)' }}>
                {t('可用字段:', 'Available fields: ')}
                {rows.filter((r) => r.key !== f.key && r.type !== 'formula').map((r) => r.key).join(' · ') || t('（先加几个数字字段）', '(add number fields first)')}
                <span style={{ marginLeft: 8 }}>{t('只支持 + - * / 与括号。', 'Only + - * / and parentheses.')}</span>
              </div>
            )}

            {/* 分组名:同组字段在资料卡里聚成一块、组内两列 */}
            <div style={{ gridColumn: '2 / -1', display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text2)' }}>{t('分组', 'Group')}</span>
              <input className="in sm" style={{ maxWidth: 200 }} value={f.group || ''}
                placeholder={t('留空 = 不分组', 'blank = ungrouped')}
                list="rf-groups"
                onChange={(e) => patch(i, { group: e.target.value })} />
            </div>
          </div>
        ))}
      </div>

      <datalist id="rf-groups">
        {[...new Set(rows.map((r) => r.group).filter(Boolean))].map((g) => <option key={g} value={g!} />)}
      </datalist>

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


/* REQ-027: 按 group 归拢字段,保持原顺序;未分组的排最前面 */
function groupFields(fields: FieldDef[]): [string, FieldDef[]][] {
  const order: string[] = [];
  const map = new Map<string, FieldDef[]>();
  fields.forEach((f) => {
    const g = f.group || '';
    if (!map.has(g)) { map.set(g, []); order.push(g); }
    map.get(g)!.push(f);
  });
  order.sort((a, b) => (a === '' ? -1 : b === '' ? 1 : 0));   // 未分组的置顶,其余保持出现顺序
  return order.map((g) => [g, map.get(g)!]);
}
