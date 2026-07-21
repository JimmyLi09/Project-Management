'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { fmtDate, isoDate, parseISO, projectHealth, projStage, schedProgress } from '@/lib/project';
import { canCreate } from '@/lib/permissions';
import { DIFF, SVC, svcColor, svcName } from '@/lib/templates';
import { useLang } from '@/lib/i18n';
import { Avatar, AvatarStack, HM, Icon, Pill, ProgressBar } from '../ui';
import type { Project } from '@/lib/types';

export default function ProjectsView({ search = '' }: { search?: string }) {
  const { projects, me, openProject } = useStore();
  const { lang, t } = useLang();
  const [typeFilter, setTypeFilter] = useState('all');
  const [pmFilter, setPmFilter] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [q, setQ] = useState(search);

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

  const list = projects.filter((p) => {
    if (!!p.archived !== showArchived) return false; // archived tab is separate
    if (typeFilter !== 'all' && !p.services.includes(typeFilter)) return false;
    if (pmFilter !== 'all' && !(p.owners || []).includes(pmFilter)) return false;
    const needle = q.trim().toLowerCase();
    if (needle && !(p.name + ' ' + p.client + ' ' + (p.owners || []).join(' ')).toLowerCase().includes(needle)) return false;
    return true;
  });

  return (
    <>
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
          <button className={`chip ${pmFilter === 'all' ? 'active' : ''}`} onClick={() => setPmFilter('all')}>{t('全部负责人', 'All PMs')}</button>
          {pms.map((n) => (
            <button key={n} className={`chip ${pmFilter === n ? 'active' : ''}`} onClick={() => setPmFilter(n)}>
              <Avatar name={n} size={20} />{n}
            </button>
          ))}
          <button className={`chip ${showArchived ? 'active' : ''}`} onClick={() => setShowArchived(!showArchived)} title={t('查看已归档项目', 'View archived projects')}>
            📦 {t('已归档', 'Archived')}{archivedCount ? ` ${archivedCount}` : ''}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 22 }}>
        {list.map((p) => <ProjectCard key={p.id} p={p} onOpen={() => openProject(p.id)} />)}
        {list.length === 0 && (
          <div className="panel" style={{ padding: 40, textAlign: 'center', color: 'var(--text2)', gridColumn: '1 / -1' }}>
            {t('没有匹配的项目。', 'No matching projects.')}
            {canCreate(me) ? t('点右上角「新建项目」创建。', ' Use New Project to create one.') : ''}
          </div>
        )}
      </div>
    </>
  );
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
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--navy900)' }}>{p.name}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 2 }}>{p.client || '—'}</div>
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

/* ===== New Project modal (opened from the topbar) ===== */
export function NewProjectModal({ onClose }: { onClose: () => void }) {
  const { me, users, createProject, openProject } = useStore();
  const { lang, t } = useLang();
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [services, setServices] = useState<string[]>(['cgi']);
  const [owners, setOwners] = useState(me.role === 'pm' ? me.name : '');
  const [difficulty, setDifficulty] = useState('medium');
  const [start, setStart] = useState(isoDate(new Date()));
  const [delivery, setDelivery] = useState('');
  const [buffer, setBuffer] = useState(0);
  const [mainContractor, setMainContractor] = useState('');
  const [architect, setArchitect] = useState('');
  const [landscape, setLandscape] = useState('');
  const [interior, setInterior] = useState('');
  const [creative, setCreative] = useState('');
  const [busy, setBusy] = useState(false);

  function toggleSvc(k: string) {
    setServices((s) => {
      if (s.includes(k)) return s.length > 1 ? s.filter((x) => x !== k) : s;
      return [...s, k];
    });
  }

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    const p = await createProject({
      name: name.trim(), client, services,
      owners: owners.split(',').map((s) => s.trim()).filter(Boolean),
      difficulty, start, delivery, buffer,
      mainContractor, architect, landscape, interior, creative,
    });
    setBusy(false);
    if (p) { onClose(); openProject(p.id); }
  }

  const pmNames = users.filter((u) => u.role === 'pm' || u.role === 'director' || u.role === 'bd').map((u) => u.name);

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h2>{t('新建项目', 'New Project')}</h2>
        <div className="msub">{t('选择一个或多个服务;含模板的服务会自动生成排期与信息清单。', 'Pick one or more services; templated services auto-generate a schedule and checklist.')}</div>
        <div className="field">
          <label>{t('项目名称', 'Project name')}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('例:Dunearn Road Condo', 'e.g. Dunearn Road Condo')} autoFocus />
        </div>
        <div className="field">
          <label>{t('服务(可多选)', 'Services (multi-select)')}</label>
          <div className="svc-multi">
            {Object.entries(SVC).map(([k, v]) => (
              <button key={k} className={`svc-opt ${services.includes(k) ? 'sel' : ''}`} onClick={() => toggleSvc(k)}>
                <span className="sq" style={{ background: v.color }} />{lang === 'zh' ? v.label : v.en}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>{t('客户', 'Client')}</label>
          <input value={client} onChange={(e) => setClient(e.target.value)} placeholder={t('developer / 客户', 'developer / client')} />
        </div>
        <div className="two">
          <div className="field"><label>{t('总包', 'Main contractor')}</label><input value={mainContractor} onChange={(e) => setMainContractor(e.target.value)} /></div>
          <div className="field"><label>{t('建筑师', 'Architect')}</label><input value={architect} onChange={(e) => setArchitect(e.target.value)} /></div>
          <div className="field"><label>{t('景观师', 'Landscape architect')}</label><input value={landscape} onChange={(e) => setLandscape(e.target.value)} /></div>
          <div className="field"><label>{t('室内设计', 'Interior designer')}</label><input value={interior} onChange={(e) => setInterior(e.target.value)} /></div>
          <div className="field"><label>{t('创意代理', 'Creative agency')}</label><input value={creative} onChange={(e) => setCreative(e.target.value)} /></div>
          <div className="field">
            <label>{t('负责 PM(逗号分隔多人)', 'PM (comma-separated)')}</label>
            <input value={owners} onChange={(e) => setOwners(e.target.value)} placeholder={pmNames.slice(0, 2).join(', ') || '张三, 李四'} list="pm-names" />
            <datalist id="pm-names">{pmNames.map((n) => <option key={n} value={n} />)}</datalist>
          </div>
        </div>
        <div className="two">
          <div className="field">
            <label>{t('难度', 'Difficulty')}</label>
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              {Object.entries(DIFF).map(([k, v]) => <option key={k} value={k}>{v[0]} · {v[1]}{t('分', ' pts')}</option>)}
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
