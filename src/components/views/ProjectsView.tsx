'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { fmtDate, isoDate, missingInvoiceRef, parseISO, projectHealth, projPoints, projStage, schedProgress } from '@/lib/project';
import { canAssign, canCreate, isScopedRole } from '@/lib/permissions';
import InvoiceModal, { invoiceTag } from '../InvoiceModal';
import { focusLabel, focusWantsArchived, matchFocus } from '@/lib/focus';
import { DIFF, SVC, stageIdx, svcColor, svcName } from '@/lib/templates';
import { diffTerm } from '@/lib/terms';
import { useLang } from '@/lib/i18n';
import { Avatar, AvatarStack, Ell, HM, Icon, Pill, ProgressBar } from '../ui';
import type { Project } from '@/lib/types';

type ViewMode = 'cards' | 'compact' | 'list';

export default function ProjectsView({ search = '' }: { search?: string }) {
  const { projects, me, openProject, view, setView, rulesFor } = useStore();
  /* 0922 变更单:从统计 / 汇报某个数字点进来时带的口径。它只是一层预设过滤,
     上面那排 chip 照样能再收窄。 */
  const focus = view.name === 'projects' ? view.focus : undefined;
  const { lang, t } = useLang();
  const [typeFilter, setTypeFilter] = useState('all');
  const [pmFilter, setPmFilter] = useState('all');
  const scoped = isScopedRole(me);   // REQ-043: 只看得到自己项目的角色
  const [showArchived, setShowArchived] = useState(false);
  const [q, setQ] = useState(search);
  /* REQ-045: 搜索默认不搜已归档;底部「另有 N 个已归档项目」点了才并进来。换了关键词就收回去 */
  const [withArch, setWithArch] = useState<string | null>(null);
  const [missOpen, setMissOpen] = useState(false);
  const [fillFor, setFillFor] = useState<Project | null>(null);
  /* R5-1: view/density switcher (大卡片 / 紧凑 / 列表) — persisted per browser */
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'cards';
    return (localStorage.getItem('audax.projectsView') as ViewMode) || 'cards';
  });
  const setView2 = (m: ViewMode) => { setViewMode(m); try { localStorage.setItem('audax.projectsView', m); } catch {} };

  const archivedCount = projects.filter((p) => p.archived).length;

  const pms = useMemo(() => {
    const s = new Set<string>();
    projects.forEach((p) => (p.owners || []).forEach((n) => s.add(n)));
    return [...s];
  }, [projects]);

  const usedTypes = useMemo(() => {
    const s = new Set<string>();
    projects.forEach((p) => p.services.forEach((k) => s.add(k)));
    return [...s];
  }, [projects]);

  /* 「项目总数」那一格点进来时,归档的也在这组里 —— 这时不按归档拆两拨,
     否则列表条数会比卡上的数字少。其余情况照旧:归档是单独一拨。 */
  const needle = q.trim().toLowerCase();
  const searchArch = !!needle && withArch === needle && !showArchived;
  const mixArchived = focusWantsArchived(focus) || searchArch;
  const matches = (p: Project) => {
    if (focus && !matchFocus(p, focus)) return false;
    if (typeFilter !== 'all' && !p.services.includes(typeFilter)) return false;
    if (pmFilter !== 'all' && !(p.owners || []).includes(pmFilter)) return false;
    if (needle && !(p.name + ' ' + p.client + ' ' + (p.owners || []).join(' ') + ' ' + (p.invoiceClose?.invoiceRef || '')).toLowerCase().includes(needle)) return false;
    return true;
  };
  const list = projects.filter((p) => {
    if (!mixArchived && !!p.archived !== showArchived) return false; // archived tab is separate
    return matches(p);
  });
  /* 搜索时,被「默认不看归档」挡掉的有几个 */
  const hiddenArch = needle && !mixArchived && !showArchived ? projects.filter((p) => p.archived && matches(p)).length : 0;
  /* REQ-045: 旧「已开票」开关标过、没有 Invoice 号的 —— 交给 PD / BD 补号 */
  const missing = canAssign(me) ? projects.filter(missingInvoiceRef) : [];
  const archivedInList = list.filter((p) => p.archived).length;
  /* 「总积分」那一格点进来,想看的是谁分最多 —— 只有这一种口径自带排序 */
  if (focus && focus.kind === 'points') {
    list.sort((a, b) => projPoints(b, rulesFor(b.created)) - projPoints(a, rulesFor(a.created)));
  }

  return (
    <>
      {/* 0922 变更单:从统计 / 汇报的数字点进来时,顶上标出「你现在看的是哪一组」
          —— 不然只看到一份变短了的列表,不知道为什么少了一半。✕ 退回全部。 */}
      {focus && (
        <div className="panel" data-testid="focus-bar"
          style={{ padding: '10px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10,
                   fontSize: 12.5, borderColor: 'var(--bronze)' }}>
          <Icon name="filter" size={14} />
          <span style={{ color: 'var(--text2)' }}>{t('筛选中', 'Filtered')}</span>
          <b style={{ color: 'var(--navy900)' }}>{focusLabel(focus, lang)}</b>
          <span className="badge" style={{ background: 'var(--hover-bg)', color: 'var(--text2)' }}>
            {t(`${list.length} 个项目`, `${list.length} project${list.length === 1 ? '' : 's'}`)}
            {mixArchived && archivedInList > 0 &&
              t(`(其中 ${archivedInList} 个已归档)`, ` (${archivedInList} archived)`)}
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn-line sm" data-testid="focus-clear"
            onClick={() => setView({ name: 'projects' })}>✕ {t('清除筛选', 'Clear')}</button>
        </div>
      )}
      {missing.length > 0 && !showArchived && (
        <div className="panel" data-testid="missing-invoice-bar"
          style={{ padding: '10px 16px', marginBottom: 16, fontSize: 12.5, borderColor: 'var(--warning)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span>⚠ {t(`有 ${missing.length} 个项目已标开票但缺 Invoice 号`, `${missing.length} project${missing.length === 1 ? ' is' : 's are'} marked invoiced but missing an invoice number`)}</span>
            <span style={{ color: 'var(--text2)' }}>{t('补号后自动归档', 'adding the number archives them')}</span>
            <div style={{ flex: 1 }} />
            <button className="btn-line sm" data-testid="missing-invoice-toggle" onClick={() => setMissOpen(!missOpen)}>
              {missOpen ? t('收起', 'Collapse') : t('逐个补号', 'Fill in')}
            </button>
          </div>
          {missOpen && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {missing.map((p) => (
                <div key={p.id} data-testid="missing-invoice-row" style={{ display: 'flex', alignItems: 'center', gap: 10, borderTop: '1px solid var(--row-line)', paddingTop: 6 }}>
                  <button style={{ fontWeight: 600, color: 'var(--navy900)', padding: 0 }} onClick={() => openProject(p.id)}>{p.name}</button>
                  <span style={{ color: 'var(--text2)' }}>{p.client || '—'}</span>
                  <div style={{ flex: 1 }} />
                  <button className="btn-navy sm" data-testid="missing-invoice-fill" onClick={() => setFillFor(p)}>{t('补 Invoice 号', 'Add invoice number')}</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {fillFor && <InvoiceModal p={fillFor} onClose={() => setFillFor(null)} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
        <div className="searchbox" style={{ background: 'var(--card)', width: 260 }}>
          <Icon name="search" size={16} />
          <input placeholder={t('搜索项目', 'Search projects')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          <button className={`chip ${typeFilter === 'all' ? 'active' : ''}`} onClick={() => setTypeFilter('all')}>{t('全部', 'All')}</button>
          {usedTypes.map((k) => (
            <button key={k} className={`chip ${typeFilter === k ? 'active' : ''}`} onClick={() => setTypeFilter(k)}>{svcName(k, lang)}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {/* REQ-043: 「全部负责人」这排本来是用来切着看别人手上的活。PM /
              Engineer 现在拿到的就只有自己的项目,这排切了也只剩自己一个人,
              留着反而像还有别人可以看 —— 整排收掉。 */}
          {!scoped && (
            <>
              <button className={`chip ${pmFilter === 'all' ? 'active' : ''}`} onClick={() => setPmFilter('all')}>{t('全部负责人', 'All PMs')}</button>
              {pms.map((n) => (
                <button key={n} className={`chip ${pmFilter === n ? 'active' : ''}`} onClick={() => setPmFilter(n)}>
                  <Avatar name={n} size={20} />{n}
                </button>
              ))}
            </>
          )}
          {/* 这一组本来就含归档,再给一个「只看归档」的开关只会互相打架 */}
          {!focusWantsArchived(focus) && (
            <button data-testid="archived-chip" className={`chip ${showArchived ? 'active' : ''}`} onClick={() => { setShowArchived(!showArchived); setWithArch(null); }} title={t('查看已归档项目', 'View archived projects')}>
              📦 {t('已归档', 'Archived')}{archivedCount ? ` ${archivedCount}` : ''}
            </button>
          )}
          {/* R5-1: 查看 — switch how much of each project is shown */}
          <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }} title={t('查看方式', 'View')}>
            {([['cards', '🔲', t('大卡片', 'Cards')], ['compact', '▦', t('紧凑', 'Compact')], ['list', '≣', t('列表', 'List')]] as [ViewMode, string, string][]).map(([m, ic, lb]) => (
              <button key={m} onClick={() => setView2(m)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 11px', fontSize: 12.5, fontWeight: 600, background: viewMode === m ? 'var(--navy900)' : 'var(--card)', color: viewMode === m ? '#fff' : 'var(--text2)' }}>
                <span>{ic}</span>{lb}
              </button>
            ))}
          </div>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="panel" style={{ padding: 40, textAlign: 'center', color: 'var(--text2)' }}>
          {t('没有匹配的项目。', 'No matching projects.')}
          {canCreate(me) ? t('点右上角「新建项目」创建。', ' Use New Project to create one.') : ''}
        </div>
      ) : viewMode === 'list' ? (
        <ProjectList list={list} onOpen={openProject} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: viewMode === 'compact' ? 'repeat(auto-fill,minmax(230px,1fr))' : 'repeat(auto-fill,minmax(320px,1fr))', gap: viewMode === 'compact' ? 14 : 22 }}>
          {list.map((p) => viewMode === 'compact'
            ? <CompactCard key={p.id} p={p} onOpen={() => openProject(p.id)} />
            : <ProjectCard key={p.id} p={p} onOpen={() => openProject(p.id)} />)}
        </div>
      )}
      {hiddenArch > 0 && (
        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 12.5, color: 'var(--text2)' }}>
          <button className="btn-line sm" data-testid="search-more-archived" onClick={() => setWithArch(needle)}>
            📦 {t(`另有 ${hiddenArch} 个已归档项目`, `${hiddenArch} more in Archived`)}
          </button>
        </div>
      )}
    </>
  );
}

/* R5-1: compact card — no cover image, condensed to fit more per row */
function CompactCard({ p, onOpen }: { p: Project; onOpen: () => void }) {
  const { lang, t } = useLang();
  const sp = schedProgress(p);
  const stage = projStage(p);
  const done = stage === 'complete' || stage === 'invoice';
  const h = done ? 'completed' : projectHealth(p);
  const pm = (p.owners || [])[0];
  const del = parseISO(p.delivery);
  return (
    <div className="panel" onClick={onOpen} style={{ cursor: 'pointer', padding: 15, display: 'flex', flexDirection: 'column', gap: 10 }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-lg)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow)'; }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <Ell style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy900)' }}>
            {p.archived && <span data-testid="archived-tag" className="badge" style={{ background: 'var(--hover-bg)', color: 'var(--text2)', marginRight: 5 }}>📦 {t('已归档', 'Archived')}</span>}{p.name}
          </Ell>
          <Ell style={{ fontSize: 11.5, color: 'var(--text2)' }}>{p.client || '—'}</Ell>
          <InvTag p={p} />
        </div>
        <Pill m={HM[h]} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {p.services.slice(0, 3).map((k) => <span key={k} className="svc-chip" style={{ color: svcColor(k), fontSize: 10.5 }}>{svcName(k, lang)}</span>)}
        {p.services.length > 3 && <span className="svc-chip" style={{ fontSize: 10.5 }}>+{p.services.length - 3}</span>}
      </div>
      <ProgressBar pct={sp.pct} color={svcColor(p.services[0])} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--text2)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{pm ? <Avatar name={pm} size={20} /> : null}{pm || t('未指派', 'No PM')}</span>
        <span className="tnum">{del ? fmtDate(del).slice(0, 6) : '—'}</span>
      </div>
    </div>
  );
}

/* R5-1: list/details view — a dense table, most projects visible at once */
/* REQ-025: Excel 式列头排序 —— 点一次升序,再点降序,第三次回到默认。
   不做独立的排序控件,排序入口就是列头本身。 */
type SortKey = 'name' | 'services' | 'pm' | 'stage' | 'progress' | 'delivery' | 'health';
const HEALTH_ORDER: Record<string, number> = { completed: 0, ontrack: 1, watch: 2, risk: 3, late: 4 };

function ProjectList({ list, onOpen }: { list: Project[]; onOpen: (id: string) => void }) {
  const { lang, t } = useLang();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const th: React.CSSProperties = { padding: '11px 16px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text2)', textAlign: 'left', whiteSpace: 'nowrap' };
  const cols = '2fr 1.4fr 90px 120px 1.1fr 96px 96px';

  const rows = useMemo(() => {
    if (!sort) return list;   // 默认序 = 列表原顺序,也就是按项目编号
    const val = (p: Project): string | number => {
      const stage = projStage(p);
      switch (sort.key) {
        case 'name': return p.name.toLowerCase();
        case 'services': return p.services.map((k) => svcName(k, lang)).join(',').toLowerCase();
        case 'pm': return ((p.owners || [])[0] || '').toLowerCase();
        case 'stage': return stageIdx(stage);
        case 'progress': return schedProgress(p).pct;
        /* 没填交付日的一律排到最后 —— 空值夹在中间最难扫 */
        case 'delivery': return p.delivery || '9999-99-99';
        case 'health': {
          const done = stage === 'complete' || stage === 'invoice';
          return HEALTH_ORDER[done ? 'completed' : projectHealth(p)] ?? 9;
        }
      }
    };
    return [...list].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va < vb) return -sort.dir;
      if (va > vb) return sort.dir;
      return 0;
    });
  }, [list, sort, lang]);

  const Th = ({ k, label }: { k: SortKey; label: string }) => {
    const on = sort?.key === k;
    return (
      <button
        onClick={() => setSort((s) => (s && s.key === k ? (s.dir === 1 ? { key: k, dir: -1 } : null) : { key: k, dir: 1 }))}
        title={t('点击排序;再点反向;第三次恢复默认', 'Click to sort; again to reverse; a third click restores the default')}
        style={{ ...th, display: 'flex', alignItems: 'center', gap: 4, width: '100%', background: 'none', cursor: 'pointer', color: on ? 'var(--navy900)' : 'var(--text2)' }}>
        {label}
        <span style={{ fontSize: 9, opacity: on ? 1 : 0.25 }}>{on ? (sort!.dir === 1 ? '▲' : '▼') : '⇅'}</span>
      </button>
    );
  };

  return (
    <div className="panel clip">
      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, background: 'var(--hover-bg)', borderBottom: '1px solid var(--row-line)' }}>
        <Th k="name" label={t('项目', 'Project')} />
        <Th k="services" label={t('服务', 'Services')} />
        <Th k="pm" label="PM" />
        <Th k="stage" label={t('阶段', 'Stage')} />
        <Th k="progress" label={t('进度', 'Progress')} />
        <Th k="delivery" label={t('交付', 'Delivery')} />
        <Th k="health" label={t('健康', 'Health')} />
      </div>
      {rows.map((p) => {
        const sp = schedProgress(p);
        const stage = projStage(p);
        const done = stage === 'complete' || stage === 'invoice';
        const h = done ? 'completed' : projectHealth(p);
        const pm = (p.owners || [])[0];
        const del = parseISO(p.delivery);
        const stageLabel = { presales: t('售前', 'Presales'), handover: t('交接', 'Handover'), progress: t('进行中', 'Production'), complete: t('完成', 'Complete'), invoice: t('收尾', 'Invoice') }[stage];
        return (
          <div key={p.id} className="row-hover" style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, alignItems: 'center', padding: '13px 16px', borderBottom: '1px solid var(--row-line)', cursor: 'pointer' }} onClick={() => onOpen(p.id)}>
            <div style={{ minWidth: 0 }}>
              <Ell style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--navy900)' }}>
                {p.archived && <span data-testid="archived-tag" className="badge" style={{ background: 'var(--hover-bg)', color: 'var(--text2)', marginRight: 5 }}>📦 {t('已归档', 'Archived')}</span>}{p.name}
              </Ell>
              <Ell style={{ fontSize: 11.5, color: 'var(--text2)' }}>{p.client || '—'}</Ell>
              <InvTag p={p} />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, minWidth: 0 }}>
              {p.services.slice(0, 2).map((k) => <span key={k} className="svc-chip" style={{ color: svcColor(k), fontSize: 10.5 }}>{svcName(k, lang)}</span>)}
              {p.services.length > 2 && <span className="svc-chip" style={{ fontSize: 10.5 }}>+{p.services.length - 2}</span>}
            </div>
            <div>{pm ? <Avatar name={pm} size={26} title={pm} /> : <span style={{ fontSize: 12, color: '#b6bfc9' }}>—</span>}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>{stageLabel}</div>
            <div><ProgressBar pct={sp.pct} color={svcColor(p.services[0])} /></div>
            <div className="tnum" style={{ fontSize: 12.5, color: del && del < new Date() && !done ? 'var(--danger)' : 'var(--text)', fontWeight: 600 }}>{del ? fmtDate(del).slice(0, 6) : '—'}</div>
            <div><Pill m={HM[h]} /></div>
          </div>
        );
      })}
    </div>
  );
}

/* REQ-045: 「已开 Invoice · INV-xxxx · 01-Oct」 */
function InvTag({ p }: { p: Project }) {
  const { lang } = useLang();
  const s = invoiceTag(p, lang);
  return s ? <div data-testid="invoice-tag" title={s} style={{ fontSize: 11.5, color: 'var(--success)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s}</div> : null;
}

/* deterministic navy-toned cover gradient per project */
function coverOf(p: Project): string {
  let h = 0;
  for (const ch of p.id) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  const a = 28 + (h % 12), b = 50 + (h % 14);
  return `linear-gradient(135deg,hsl(210 ${30 + (h % 14)}% ${a * 0.55}%),hsl(${205 + (h % 18)} 24% ${b * 0.72}%))`;
}

function ProjectCard({ p, onOpen }: { p: Project; onOpen: () => void }) {
  const { lang, t } = useLang();
  const sp = schedProgress(p);
  const stage = projStage(p);
  const done = stage === 'complete' || stage === 'invoice';
  const h = done ? 'completed' : projectHealth(p);
  const pm = (p.owners || [])[0];
  const del = parseISO(p.delivery);
  const stageLabel = {
    presales: t('售前', 'Presales'), handover: t('交接', 'Handover'), progress: t('进行中', 'Production'),
    complete: t('完成', 'Complete'), invoice: t('收尾', 'Invoice'),
  }[stage];
  const team = [...new Set(p.packages.flatMap((pk) => pk.schedule.map((r) => r.assignee)).filter(Boolean))];
  return (
    <div className="panel clip" onClick={onOpen}
      style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', transition: 'box-shadow .15s,border-color .15s' }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-lg)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow)'; }}>
      <div style={{ aspectRatio: '16/6.5', background: coverOf(p), position: 'relative', display: 'flex', alignItems: 'flex-end', padding: 14 }}>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(11,35,65,0) 40%,rgba(11,35,65,.55))' }} />
        <div style={{ position: 'absolute', top: 12, right: 12 }}><Pill m={HM[h]} /></div>
        <div style={{ position: 'absolute', top: '46%', left: 0, right: 0, transform: 'translateY(-50%)', textAlign: 'center', fontSize: 30, fontWeight: 700, color: 'rgba(255,255,255,.14)', letterSpacing: '.1em', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden' }}>
          {p.name.split(' ')[0]}
        </div>
        <div style={{ position: 'relative', color: '#fff', fontSize: 11, fontWeight: 600, letterSpacing: '.04em', opacity: .9, textTransform: 'uppercase' }}>
          {p.client || '—'}
        </div>
      </div>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 13, flex: 1 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--navy900)' }}>{p.archived && <span data-testid="archived-tag" className="badge" style={{ background: 'var(--hover-bg)', color: 'var(--text2)', marginRight: 5 }}>📦 {t('已归档', 'Archived')}</span>}{p.name}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 2 }}>{p.client || '—'}</div>
          <InvTag p={p} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {p.services.map((k) => <span key={k} className="svc-chip" style={{ color: svcColor(k) }}>{svcName(k, lang)}</span>)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          {pm ? <Avatar name={pm} size={26} /> : null}
          <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>{pm || t('未指派 PM', 'No PM assigned')} · {stageLabel}</span>
        </div>
        <ProgressBar pct={sp.pct} color={svcColor(p.services[0])} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--row-line)', paddingTop: 12, marginTop: 2 }}>
          <span className="tnum" style={{ fontSize: 12.5, color: 'var(--text2)' }}>
            {t('交付', 'Delivery')} <b style={{ color: del && del < new Date() && !done ? 'var(--danger)' : 'var(--navy900)', fontWeight: 600 }}>{del ? fmtDate(del).slice(0, 6) : '—'}</b>
          </span>
          {team.length > 0 && <AvatarStack names={team} size={24} />}
        </div>
      </div>
    </div>
  );
}

/* ===== New Project modal (opened from the topbar) =====
   REQ-010: sectioned form (客户信息 / 相关公司 / 服务类型 / 项目属性) with
   dynamic add/remove company blocks, each carrying person/phone/email. */
interface CompanyDraft { role: string; company: string; person: string; phone: string; email: string }
const COMPANY_ROLES: [string, string][] = [
  ['总包 Main Con', 'Main Contractor'], ['建筑师 Architect', 'Architect'], ['景观 Landscape', 'Landscape'],
  ['室内 Interior', 'Interior'], ['创意 Creative', 'Creative'],
];

export function NewProjectModal({ onClose }: { onClose: () => void }) {
  const { me, users, createProject, openProject } = useStore();
  const { lang, t } = useLang();
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [quotationNo, setQuotationNo] = useState('');   // REQ-031
  const [services, setServices] = useState<string[]>(['cgi']);
  const [owners, setOwners] = useState(me.role === 'pm' ? me.name : '');
  const [engineer, setEngineer] = useState('');   // REQ-043
  const [difficulty, setDifficulty] = useState('medium');
  const [start, setStart] = useState(isoDate(new Date()));
  const [delivery, setDelivery] = useState('');
  const [buffer, setBuffer] = useState(0);
  const [clientPerson, setClientPerson] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [companies, setCompanies] = useState<CompanyDraft[]>([]);
  const [busy, setBusy] = useState(false);

  function toggleSvc(k: string) {
    setServices((s) => {
      if (s.includes(k)) return s.length > 1 ? s.filter((x) => x !== k) : s;
      return [...s, k];
    });
  }
  const setComp = (i: number, k: keyof CompanyDraft, v: string) =>
    setCompanies((cs) => cs.map((c, ci) => (ci === i ? { ...c, [k]: v } : c)));

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    const p = await createProject({
      name: name.trim(), client, quotationNo: quotationNo.trim(), services,
      owners: owners.split(',').map((s) => s.trim()).filter(Boolean),
      engineer: engineer.trim(),
      difficulty, start, delivery, buffer,
      clientPerson, clientPhone, clientEmail,
      companies: companies.filter((c) => c.company || c.person || c.phone || c.email),
    });
    setBusy(false);
    if (p) { onClose(); openProject(p.id); }
  }

  const pmNames = users.filter((u) => u.role === 'pm' || u.role === 'director' || u.role === 'bd').map((u) => u.name);
  /* REQ-043: 工程师是项目级指派,一个项目一个人。候选名单取 member(平台里
     「工程师 / 团队成员」就是这个角色),PM 也允许 —— 小项目常常 PM 自己兼。 */
  const engNames = users.filter((u) => u.role === 'member' || u.role === 'pm').map((u) => u.name);
  const Section = ({ zh, en }: { zh: string; en: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 10px' }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--navy900)', letterSpacing: '.03em' }}>{t(zh, en)}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--row-line)' }} />
    </div>
  );

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h2>{t('新建项目', 'New Project')}</h2>
        <div className="msub">{t('按分区填写;相关公司按需添加,不必每项都有。', 'Fill in by section; add related companies only as needed.')}</div>
        {/* REQ-031: 报价单号跟项目名同一行 —— 建项目时顺手记下,日后对账好找 */}
        <div className="two">
          <div className="field">
            <label>{t('项目名称', 'Project name')}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('例:Dunearn Road Condo', 'e.g. Dunearn Road Condo')} autoFocus />
          </div>
          <div className="field">
            <label>{t('报价单号 Quotation No.(可选)', 'Quotation No. (optional)')}</label>
            <input value={quotationNo} onChange={(e) => setQuotationNo(e.target.value)} maxLength={60} placeholder="Q-2026-0123" />
          </div>
        </div>

        <Section zh="① 客户信息" en="① Client" />
        <div className="field" style={{ marginBottom: 6 }}><label>{t('客户 公司', 'Client company')}</label>
          <input value={client} onChange={(e) => setClient(e.target.value)} placeholder={t('developer / 客户', 'developer / client')} /></div>
        <div className="two" style={{ marginBottom: 4 }}>
          <div className="field"><label>{t('联系人(可选)', 'Contact (optional)')}</label><input value={clientPerson} onChange={(e) => setClientPerson(e.target.value)} placeholder={t('姓名', 'name')} /></div>
          <div className="field"><label>{t('电话(可选)', 'Phone (optional)')}</label><input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} placeholder="+65 ..." /></div>
          <div className="field"><label>{t('邮箱(可选)', 'Email (optional)')}</label><input value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="name@company.com" /></div>
        </div>

        <Section zh="② 相关公司(按需添加)" en="② Related companies (as needed)" />
        {companies.length === 0 && (
          <div className="msub" style={{ margin: '0 0 8px' }}>{t('没有就不加。点下方按钮添加总包/建筑师/景观等。', 'None? Skip. Use the button below to add Main Con / Architect / Landscape etc.')}</div>
        )}
        {companies.map((c, i) => (
          <div key={i} style={{ border: '1px solid var(--row-line)', borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
            <div className="two" style={{ marginBottom: 4 }}>
              <div className="field">
                <label>{t('角色', 'Role')}</label>
                <input list="company-roles" value={c.role} onChange={(e) => setComp(i, 'role', e.target.value)} placeholder={t('如 总包 / 建筑师…', 'e.g. Main Con / Architect…')} />
              </div>
              <div className="field"><label>{t('公司名', 'Company')}</label><input value={c.company} onChange={(e) => setComp(i, 'company', e.target.value)} /></div>
            </div>
            <div className="two">
              <div className="field"><label>{t('联系人', 'Contact')}</label><input value={c.person} onChange={(e) => setComp(i, 'person', e.target.value)} placeholder={t('姓名', 'name')} /></div>
              <div className="field"><label>{t('电话', 'Phone')}</label><input value={c.phone} onChange={(e) => setComp(i, 'phone', e.target.value)} placeholder="+65 ..." /></div>
              <div className="field"><label>Email</label><input value={c.email} onChange={(e) => setComp(i, 'email', e.target.value)} placeholder="name@company.com" /></div>
            </div>
            <button className="btn-line sm danger" style={{ marginTop: 6 }} onClick={() => setCompanies((cs) => cs.filter((_, ci) => ci !== i))}>− {t('删除此公司', 'Remove company')}</button>
          </div>
        ))}
        <datalist id="company-roles">{COMPANY_ROLES.map(([zh, en]) => <option key={zh} value={lang === 'zh' ? zh : en} />)}</datalist>
        <button className="btn-line sm" style={{ borderStyle: 'dashed', marginBottom: 4 }}
          onClick={() => setCompanies((cs) => [...cs, { role: '', company: '', person: '', phone: '', email: '' }])}>
          ＋ {t('添加相关公司', 'Add company')}
        </button>

        <Section zh="③ 服务类型" en="③ Services" />
        <div className="field">
          <div className="svc-multi">
            {Object.entries(SVC).map(([k, v]) => (
              <button key={k} className={`svc-opt ${services.includes(k) ? 'sel' : ''}`} onClick={() => toggleSvc(k)}>
                <span className="sq" style={{ background: v.color }} />{lang === 'zh' ? v.label : v.en}
              </button>
            ))}
          </div>
          <div className="msub" style={{ marginTop: 4 }}>{t('点选添加/移除;含模板的服务会自动生成排期与信息清单。', 'Click to add/remove; templated services auto-generate a schedule & checklist.')}</div>
        </div>

        <Section zh="④ 项目属性" en="④ Project attributes" />
        <div className="two">
          <div className="field">
            <label>{t('负责 PM(逗号分隔多人)', 'PM (comma-separated)')}</label>
            <input value={owners} onChange={(e) => setOwners(e.target.value)} placeholder={pmNames.slice(0, 2).join(', ') || '张三, 李四'} list="pm-names" />
            <datalist id="pm-names">{pmNames.map((n) => <option key={n} value={n} />)}</datalist>
          </div>
          {/* REQ-043: 指派谁,谁才看得见这个项目 —— 建项目时就填,省得工程师
              上来发现列表是空的。留空也行,之后在项目里补。 */}
          <div className="field">
            <label>{t('工程师(可选,一人)', 'Engineer (optional, one person)')}</label>
            <input value={engineer} onChange={(e) => setEngineer(e.target.value)} placeholder={engNames[0] || t('姓名', 'name')} list="eng-names" />
            <datalist id="eng-names">{engNames.map((n) => <option key={n} value={n} />)}</datalist>
          </div>
          <div className="field">
            <label>{t('难度', 'Difficulty')}</label>
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              {Object.entries(DIFF).map(([k, v]) => <option key={k} value={k}>{diffTerm(k, lang)} · {v[1]}{t('分', ' pts')}</option>)}
            </select>
          </div>
          <div className="field"><label>{t('起始日(=最终信息确认日)', 'Start (= info confirmed date)')}</label><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div className="field"><label>{t('交付日(可空)', 'Delivery (optional)')}</label><input type="date" value={delivery} onChange={(e) => setDelivery(e.target.value)} /></div>
          <div className="field"><label>{t('Buffer 天数', 'Buffer days')}</label><input type="number" min={0} value={buffer} onChange={(e) => setBuffer(parseInt(e.target.value) || 0)} /></div>
        </div>
        <div className="modal-actions">
          <button className="btn-line" onClick={onClose}>{t('取消', 'Cancel')}</button>
          <button className="btn-navy" onClick={submit} disabled={busy}>{busy ? t('创建中…', 'Creating…') : t('创建', 'Create')}</button>
        </div>
      </div>
    </div>
  );
}
