'use client';

import React, { useEffect, useState } from 'react';
import { useStore } from './store';
import { canDeleteTemplate, canSaveTemplate } from '@/lib/permissions';
import { projCode } from '@/lib/project';
import { useLang } from '@/lib/i18n';
import { Icon } from './ui';
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
  const canWrite = canSaveTemplate(me); // PD / BD / Sales / PM

  const loadTpls = React.useCallback(() => {
    fetch(`/api/user-templates?type=${kind}`).then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setTpls(d.templates || [])).catch(() => {});
  }, [kind]);
  useEffect(() => { loadTpls(); }, [loadTpls]);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    const res = await fetch(`/api/projects/${p.id}/fragment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pkg: pkgIdx, kind, ...body }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setToast(data.error || t('操作失败', 'Failed')); return false; }
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

  async function saveTpl() {
    const name = prompt(t('模板名称', 'Template name'), `${p.name} · ${kind === 'schedule' ? t('排期', 'Schedule') : t('清单', 'Checklist')}`);
    if (!name || !name.trim()) return;
    const pkg = p.packages[pkgIdx];
    const payload = kind === 'schedule'
      ? { schedule: pkg.schedule, schedStyle: p.schedStyle }
      : { checklist: pkg.checklist, noCategories: !!pkg.noCategories };
    setBusy(true);
    const res = await fetch('/api/user-templates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: kind, name: name.trim(), payload }),
    });
    setBusy(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setToast(d.error || t('保存失败', 'Save failed')); return; }
    loadTpls();
    setToast(t('已存为模板', 'Saved as template'));
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
        {canWrite && <button className="btn-line sm" onClick={saveTpl} disabled={busy}>{t('存为模板', 'Save as template')}</button>}
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
              onPick={(sourceId, mode) => post({ sourceId, mode })} />
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
              <button className="btn-line sm" disabled={busy} onClick={() => post({ templateId: tp.id, mode: 'replace' })}>{t('覆盖套用', 'Replace')}</button>
              <button className="btn-line sm" disabled={busy} onClick={() => post({ templateId: tp.id, mode: 'append' })}>{t('追加', 'Append')}</button>
              {canDeleteTemplate(me, tp.created_by)
                ? <button className="btn-line sm danger" onClick={() => delTpl(tp.id, tp.name)}>✕</button>
                : <button className="btn-line sm" disabled title={t('只有模板创建者或 PD/BD 可以删除', 'Only the author or PD/BD can delete this')} style={{ opacity: 0.4 }}>✕</button>}
            </div>
          ))}
          {tpls.length === 0 && <div style={{ fontSize: 12, color: 'var(--text2)' }}>{t('还没有自定义模板 — 用「存为模板」保存当前内容。', 'No saved templates yet — use "Save as template".')}</div>}
        </div>
      )}
    </div>
  );
}

function ImportPicker({ others, lang, t, busy, onPick }: {
  others: Project[]; lang: 'zh' | 'en'; busy: boolean;
  t: (zh: string, en: string) => string; onPick: (sourceId: string, mode: 'replace' | 'append') => void;
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
      <button className="btn-navy sm" disabled={!sel || busy} onClick={() => onPick(sel, 'replace')}>{t('覆盖导入', 'Replace')}</button>
      <button className="btn-line sm" disabled={!sel || busy} onClick={() => onPick(sel, 'append')}>{t('追加导入', 'Append')}</button>
    </div>
  );
}
