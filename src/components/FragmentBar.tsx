'use client';

import React, { useEffect, useState } from 'react';
import { useStore } from './store';
import { canDeleteTemplate, canSaveTemplate } from '@/lib/permissions';
import { projCode } from '@/lib/project';
import { useLang } from '@/lib/i18n';
import { Icon } from './ui';
import { freshChecklist, freshSchedule } from '@/server/fragments';
import type { Project } from '@/lib/types';

interface TplRow { id: number; type: string; name: string; created_by: string }

/* ===== REQ-012 =====
   One bar for both the Schedule and Checklist tabs:
   · 从项目导入 — pull this section from another project (replace / append)
   · 套用模板   — one dropdown listing the built-in reference templates
                  (REQ-018/019) together with user-saved ones
   · 存为模板   — save the current section to the server
   Everything is applied server-side through /api/projects/:id/fragment, so
   templates and projects share the exact same package schema. */
export default function FragmentBar({ p, pkgIdx, kind }: { p: Project; pkgIdx: number; kind: 'schedule' | 'checklist' }) {
  const { projects, me, setToast, refresh, dispatch } = useStore();
  const { lang, t } = useLang();
  const [open, setOpen] = useState<null | 'import' | 'tpl'>(null);
  const [tpls, setTpls] = useState<TplRow[]>([]);
  const [busy, setBusy] = useState(false);
  /* 0917 变更单:复制走一个四步向导(来源 → 范围 → 预览 → 完成),
     存为模板改成页内弹窗,不再弹浏览器原生 prompt。 */
  const [wizard, setWizard] = useState<null | { sourceId?: string; templateId?: number; label: string }>(null);
  const [saveTplOpen, setSaveTplOpen] = useState(false);
  const canWrite = canSaveTemplate(me); // PD / BD / Sales / PM

  const loadTpls = React.useCallback(() => {
    fetch(`/api/user-templates?type=${kind}`).then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setTpls(d.templates || [])).catch(() => {});
  }, [kind]);
  useEffect(() => { loadTpls(); }, [loadTpls]);

  /* 预览不刷新、不提示,只把统计拿回来 */
  async function callFragment(body: Record<string, unknown>) {
    const res = await fetch(`/api/projects/${p.id}/fragment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pkg: pkgIdx, kind, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  }

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    const { ok, data } = await callFragment(body);
    setBusy(false);
    if (!ok) { setToast((data as { error?: string }).error || t('操作失败', 'Failed')); return false; }
    await refresh();
    setOpen(null);
    setToast(t('已应用', 'Applied'));
    return true;
  }

  /* built-in reference templates reuse the existing schedule-style switch
     (REQ-018) / default checklist template, so they sit in the same dropdown. */
  const builtins = kind === 'schedule'
    ? [
        { key: 'weeks', label: t('参考模板:按服务分组(周)', 'Reference: by service (weeks)') },
        { key: 'dates', label: t('参考模板:按日期(Scale Model)', 'Reference: by date (Scale Model)') },
      ]
    : [{ key: 'default', label: t('参考模板:默认信息清单', 'Reference: default checklist') }];

  async function applyBuiltin(key: string) {
    if (kind === 'schedule') {
      const ok = await dispatch(p.id, { type: 'setSchedStyle', value: key as 'weeks' | 'dates' });
      if (ok) { setOpen(null); setToast(t('已套用参考模板', 'Reference template applied')); }
    } else {
      if (!confirm(t('用默认模板恢复本业务的清单?当前信息项/状态/备注将被清空。', 'Restore this package’s checklist from the default template? Current items will be cleared.'))) return;
      const ok = await dispatch(p.id, { type: 'resetChecklist', pkg: pkgIdx });
      if (ok) { setOpen(null); setToast(t('已套用参考模板', 'Reference template applied')); }
    }
  }

  /* 0917 变更单:模板名从页内弹窗来,不再用浏览器原生 prompt。
     withContent = 勾了「同时保存当前内容」—— 不勾就把状态 / 日期 / 备注 /
     参考图洗掉再存,存出来的是一份干净骨架。 */
  async function saveTpl(name: string, withContent: boolean) {
    if (!name.trim()) return;
    const pkg = p.packages[pkgIdx];
    const payload = kind === 'schedule'
      ? { schedule: freshSchedule(pkg.schedule, withContent), schedStyle: p.schedStyle }
      : { checklist: freshChecklist(pkg.checklist, withContent), noCategories: !!pkg.noCategories };
    setBusy(true);
    const res = await fetch('/api/user-templates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: kind, name: name.trim(), payload }),
    });
    setBusy(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setToast(d.error || t('保存失败', 'Save failed')); return; }
    loadTpls();
    setSaveTplOpen(false);
    setToast(withContent ? t('已存为模板(含当前内容)', 'Saved as template (with content)') : t('已存为模板', 'Saved as template'));
  }

  async function delTpl(id: number, name: string) {
    if (!confirm(t(`删除模板「${name}」?`, `Delete template "${name}"?`))) return;
    const res = await fetch(`/api/user-templates/${id}`, { method: 'DELETE' });
    if (!res.ok) { const d = await res.json().catch(() => ({})); setToast(d.error || t('删除失败', 'Delete failed')); return; }
    loadTpls();
    setToast(t('已删除', 'Deleted'));
  }

  const others = projects.filter((x) => x.id !== p.id && !x.archived);

  return (
    <div className="panel" style={{ padding: '10px 14px', marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="mini-label" style={{ fontWeight: 700, color: 'var(--navy900)' }}>
          {kind === 'schedule' ? t('排期来源', 'Schedule source') : t('清单来源', 'Checklist source')}
        </span>
        <button className="btn-line sm" onClick={() => setOpen(open === 'import' ? null : 'import')}>
          <Icon name="layers" size={13} />{t('从项目导入', 'Import from project')}
        </button>
        <button className="btn-line sm" onClick={() => { loadTpls(); setOpen(open === 'tpl' ? null : 'tpl'); }}>
          {t('套用模板', 'Apply template')}
        </button>
        {canWrite && <button className="btn-line sm" onClick={() => setSaveTplOpen(true)} disabled={busy}>{t('存为模板', 'Save as template')}</button>}
        <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>
          {t('导入/套用只影响当前服务包,状态会重置为未开始。', 'Applies to the current service package; progress resets.')}
        </span>
      </div>

      {open === 'import' && (
        <div style={{ marginTop: 10, borderTop: '1px solid var(--row-line)', paddingTop: 10 }}>
          {others.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>{t('没有其它项目可导入。', 'No other projects to import from.')}</div>
          ) : (
            <ImportPicker others={others} lang={lang} t={t} busy={busy}
              onPick={(sourceId, name) => { setWizard({ sourceId, label: name }); setOpen(null); }} />
          )}
        </div>
      )}

      {open === 'tpl' && (
        <div style={{ marginTop: 10, borderTop: '1px solid var(--row-line)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {builtins.map((b) => (
            <div key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="badge" style={{ background: '#fbf0dc', color: '#a8690b' }}>{t('内置', 'Built-in')}</span>
              <span style={{ fontSize: 13, flex: 1 }}>{b.label}</span>
              <button className="btn-line sm" disabled={busy} onClick={() => applyBuiltin(b.key)}>{t('套用', 'Apply')}</button>
              <button className="btn-line sm" disabled title={t('内置参考模板不可删除', 'Built-in reference templates cannot be deleted')} style={{ opacity: 0.4 }}>✕</button>
            </div>
          ))}
          {tpls.map((tp) => (
            <div key={tp.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="badge" style={{ background: 'var(--hover-bg)', color: 'var(--text2)' }}>{t('自定义', 'Saved')}</span>
              <span style={{ fontSize: 13, flex: 1 }}>{tp.name}<span style={{ color: 'var(--text2)', fontSize: 11.5 }}> · {tp.created_by}</span></span>
              <button className="btn-line sm" disabled={busy} onClick={() => { setWizard({ templateId: tp.id, label: tp.name }); setOpen(null); }}>{t('套用…', 'Apply…')}</button>
              {canDeleteTemplate(me, tp.created_by)
                ? <button className="btn-line sm danger" onClick={() => delTpl(tp.id, tp.name)}>✕</button>
                : <button className="btn-line sm" disabled title={t('只有模板创建者或 PD/BD 可以删除', 'Only the author or PD/BD can delete this')} style={{ opacity: 0.4 }}>✕</button>}
            </div>
          ))}
          {tpls.length === 0 && <div style={{ fontSize: 12, color: 'var(--text2)' }}>{t('还没有自定义模板 — 用「存为模板」保存当前内容。', 'No saved templates yet — use "Save as template".')}</div>}
        </div>
      )}

      {wizard && (
        <CopyWizard kind={kind} src={wizard} busy={busy} onClose={() => setWizard(null)}
          onPreview={(withContent) => callFragment({ ...wizard, withContent, preview: true })}
          onApply={async (mode, withContent) => post({ ...wizard, mode, withContent })} />
      )}

      {saveTplOpen && (
        <SaveTemplateModal kind={kind} busy={busy}
          defaultName={`${p.name} · ${kind === 'schedule' ? t('排期', 'Schedule') : t('清单', 'Checklist')}`}
          onCancel={() => setSaveTplOpen(false)} onSave={saveTpl} />
      )}
    </div>
  );
}

/* ===== 0917 变更单:复制向导(来源 → 范围 → 预览 → 完成) =====
   以前是「选个项目,点覆盖/追加」,点下去才知道搬了什么。现在中间加一步预览:
   这次会带进来几个分区 / 几项 / 其中几项是带着内容的,数出来给人看。 */
function CopyWizard({ kind, src, busy, onClose, onPreview, onApply }: {
  kind: 'schedule' | 'checklist';
  src: { sourceId?: string; templateId?: number; label: string };
  busy: boolean;
  onClose: () => void;
  onPreview: (withContent: boolean) => Promise<{ ok: boolean; data: unknown }>;
  onApply: (mode: 'replace' | 'append', withContent: boolean) => Promise<boolean>;
}) {
  const { t } = useLang();
  const [step, setStep] = useState(2);            // 第 1 步(选来源)在外面已经完成
  const [mode, setMode] = useState<'replace' | 'append'>('replace');
  const [withContent, setWithContent] = useState(false);
  const [stat, setStat] = useState<{ groups: number; items: number; withContent: number } | null>(null);
  const [err, setErr] = useState('');

  const sectionName = kind === 'schedule' ? t('排期', 'Schedule') : t('信息清单', 'Checklist');
  const steps = [t('选择来源', 'Source'), t('复制范围', 'Scope'), t('预览', 'Preview'), t('完成', 'Done')];

  async function goPreview() {
    setErr('');
    const { ok, data } = await onPreview(withContent);
    const d = data as { preview?: { groups: number; items: number; withContent: number }; error?: string };
    if (!ok || !d.preview) { setErr(d.error || t('预览失败', 'Preview failed')); return; }
    setStat(d.preview);
    setStep(3);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel" style={{ width: 'min(560px, 92vw)', padding: 0, maxHeight: '88vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}>
        <div className="panel-head" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="panel-title">{t('复制', 'Copy')} · {sectionName}</span>
          <div style={{ flex: 1 }} />
          <button className="btn-line sm" onClick={onClose}>✕</button>
        </div>

        {/* 四步指示条 */}
        <div style={{ display: 'flex', gap: 6, padding: '12px 18px', flexWrap: 'wrap' }}>
          {steps.map((label, i) => {
            const n = i + 1;
            const done = n < step, cur = n === step;
            return (
              <span key={label} className="badge" style={{
                background: cur ? 'var(--navy900)' : done ? '#e6f2ec' : 'var(--hover-bg)',
                color: cur ? '#fff' : done ? '#0f6a48' : 'var(--text2)',
              }}>{done ? '✓' : n}. {label}</span>
            );
          })}
        </div>

        <div style={{ padding: '4px 18px 18px' }}>
          <div style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 12 }}>
            {t('来源', 'Source')}: <b style={{ color: 'var(--navy900)' }}>{src.label}</b>
          </div>

          {step === 2 && (
            <>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>{t('复制范围', 'What to copy')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                <label style={radio}><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                  <span><b>{t('覆盖', 'Replace')}</b> — {t('用来源的内容替换当前这份', 'swap this section for the source')}</span></label>
                <label style={radio}><input type="radio" checked={mode === 'append'} onChange={() => setMode('append')} />
                  <span><b>{t('追加', 'Append')}</b> — {t('接在当前内容后面,现有的不动', 'add after what is already here')}</span></label>
              </div>
              <label style={{ ...radio, alignItems: 'flex-start', borderTop: '1px solid var(--row-line)', paddingTop: 12 }}>
                <input type="checkbox" checked={withContent} onChange={(e) => setWithContent(e.target.checked)} style={{ marginTop: 3 }} />
                <span>
                  <b>{t('连内容一起复制', 'Copy the content too')}</b>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text2)', marginTop: 3, lineHeight: 1.6 }}>
                    {kind === 'schedule'
                      ? t('连状态 / 日期 / 备注 / 指派一起搬。不勾则只带计划骨架,状态回「未开始」、日期按新项目的起始日重排。',
                          'Brings statuses, dates, notes and assignees. Unticked, only the plan skeleton comes across.')
                      : t('连状态 / 日期 / 备注 / 服务器路径 / 参考图 / 收料记录一起搬。不勾则只带分类和信息项名称,是一张空的跟踪表。',
                          'Brings statuses, dates, remarks, server paths, reference images and receiving records. Unticked, you get an empty tracking sheet.')}
                  </span>
                </span>
              </label>
              {err && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 10 }}>{err}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                <button className="btn-line sm" onClick={onClose}>{t('取消', 'Cancel')}</button>
                <button className="btn-navy sm" disabled={busy} onClick={goPreview}>{t('下一步:预览', 'Next: preview')}</button>
              </div>
            </>
          )}

          {step === 3 && stat && (
            <>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>{t('这次会带进来', 'You are about to bring in')}</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                {[[kind === 'schedule' ? t('阶段', 'Phases') : t('分区', 'Sections'), stat.groups],
                  [kind === 'schedule' ? t('排期行', 'Rows') : t('信息项', 'Items'), stat.items],
                  [t('其中含内容', 'with content'), stat.withContent]].map(([l, v]) => (
                  <div key={String(l)} className="panel" style={{ padding: '10px 14px', minWidth: 96 }}>
                    <div className="tnum" style={{ fontSize: 20, fontWeight: 700, color: 'var(--navy900)' }}>{v as number}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>{l as string}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
                {mode === 'replace'
                  ? t('⚠ 覆盖会替换当前这份的全部内容,不能撤销。', '⚠ Replace wipes the current section. This cannot be undone.')
                  : t('追加不会动现有内容,新的接在后面。', 'Append leaves the current content untouched.')}
                <br />
                {withContent
                  ? t('已勾「连内容一起复制」—— 状态和日期会一并带过来。', 'Content is coming across — statuses and dates included.')
                  : t('未勾「连内容一起复制」—— 只带骨架,进度是空的。', 'Skeleton only — progress starts empty.')}
              </div>
              {err && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 10 }}>{err}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                <button className="btn-line sm" onClick={() => setStep(2)}>{t('上一步', 'Back')}</button>
                <button className="btn-navy sm" disabled={busy}
                  onClick={async () => { const ok = await onApply(mode, withContent); if (ok) setStep(4); }}>
                  {busy ? t('应用中…', 'Applying…') : t('确认应用', 'Apply')}
                </button>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--success)', marginBottom: 8 }}>
                ✓ {t('已应用', 'Applied')}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.7 }}>
                {t('内容已经进到当前服务包,可以直接继续编辑。改完之后如果想留着下次用,点「存为模板」。',
                   'It is in the current service package — carry on editing. Use “Save as template” if you want to reuse it later.')}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                <button className="btn-navy sm" onClick={onClose}>{t('完成', 'Done')}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* 0917 变更单:存为模板改页内弹窗(录屏里是浏览器原生 prompt) */
function SaveTemplateModal({ kind, defaultName, busy, onSave, onCancel }: {
  kind: 'schedule' | 'checklist'; defaultName: string; busy: boolean;
  onSave: (name: string, withContent: boolean) => Promise<void>; onCancel: () => void;
}) {
  const { t } = useLang();
  const [name, setName] = useState(defaultName);
  const [withContent, setWithContent] = useState(false);
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="panel" style={{ width: 'min(480px, 92vw)', padding: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="panel-head"><span className="panel-title">{t('存为模板', 'Save as template')}</span></div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: 'var(--text2)', fontWeight: 600 }}>
            {t('模板名称', 'Template name')}
            <input className="in sm" autoFocus aria-label={t('模板名称', 'Template name')} value={name} maxLength={120}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onSave(name.trim(), withContent); }} />
          </label>
          <label style={{ ...radio, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={withContent} onChange={(e) => setWithContent(e.target.checked)} style={{ marginTop: 3 }} />
            <span>
              <b>{t('同时保存当前内容', 'Save the current content too')}</b>
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text2)', marginTop: 3, lineHeight: 1.6 }}>
                {kind === 'schedule'
                  ? t('连状态 / 日期 / 备注一起存。不勾存的是一份干净骨架 —— 给新项目套用时更常用。',
                      'Stores statuses, dates and notes as well. Unticked saves a clean skeleton — usually what you want for new projects.')
                  : t('连状态 / 日期 / 备注 / 路径 / 参考图一起存。不勾存的是一份干净骨架。',
                      'Stores statuses, dates, remarks, paths and reference images. Unticked saves a clean skeleton.')}
              </span>
            </span>
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn-line sm" onClick={onCancel} disabled={busy}>{t('取消', 'Cancel')}</button>
            <button className="btn-navy sm" disabled={busy || !name.trim()} onClick={() => onSave(name.trim(), withContent)}>
              {busy ? t('保存中…', 'Saving…') : t('保存', 'Save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const radio: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, cursor: 'pointer' };

function ImportPicker({ others, lang, t, busy, onPick }: {
  others: Project[]; lang: 'zh' | 'en'; busy: boolean;
  t: (zh: string, en: string) => string; onPick: (sourceId: string, name: string) => void;
}) {
  const [sel, setSel] = useState('');
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <select className="in sm" value={sel} onChange={(e) => setSel(e.target.value)} style={{ minWidth: 240 }}>
        <option value="">{t('— 选择来源项目 —', '— select source project —')}</option>
        {others.map((o) => (
          <option key={o.id} value={o.id}>{projCode(o) ? `${projCode(o)} · ` : ''}{o.name}</option>
        ))}
      </select>
      <button className="btn-navy sm" disabled={!sel || busy}
        onClick={() => onPick(sel, others.find((o) => o.id === sel)?.name || '')}>{t('下一步', 'Next')}</button>
    </div>
  );
}
