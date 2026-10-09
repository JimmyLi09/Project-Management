'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { fmtDate, projCode, todayMid } from '@/lib/project';
import { isDeveloperRole, roleKeyOf } from '@/lib/contactRoles';
import { useLang } from '@/lib/i18n';
import { contactRoleTerm } from '@/lib/terms';
import { Ell, Icon } from '../ui';
import type { Project } from '@/lib/types';

interface Row {
  project: string;
  pid: string;
  code: string;      // REQ-052:项目编号
  year: string;      // REQ-052:项目立项年份
  role: string;      // 键(developer / maincon …)或手填原文
  company: string;
  person: string;
  phone: string;
  email: string;
}

/* R5-4: aggregate every project's contacts (+ legacy client / parties strings
   as a fallback) into one directory, searchable and exportable to CSV/Excel. */
function collect(projects: Project[]): Row[] {
  const out: Row[] = [];
  /* REQ-052:兜底行也用键,和存进库的一样(以前这里写「总包 Main Con」、库里是「总包 Main-con」,筛选里两个总包) */
  const PARTY_ROLES: [keyof Project['parties'], string][] = [
    ['mainContractor', 'maincon'], ['architect', 'architect'],
    ['landscape', 'landscape'], ['interior', 'interior'], ['creative', 'creative'],
  ];
  projects.forEach((p) => {
    if (p.archived) return;
    const seen = new Set<string>();
    const base = { project: p.name, pid: p.id, code: projCode(p), year: projectYear(p) };
    (p.contacts || []).forEach((c) => {
      if (!c.company && !c.person && !c.phone && !c.email && !c.role) return;
      out.push({ ...base, role: roleKeyOf(c.role), company: c.company || '', person: c.person || '', phone: c.phone || '', email: c.email || '' });
      if (c.company) seen.add(c.company.toLowerCase());
    });
    /* fallbacks so projects created before contacts existed still show up */
    if (p.client && !seen.has(p.client.toLowerCase()) && !(p.contacts || []).some((c) => isDeveloperRole(c.role)))
      out.push({ ...base, role: 'developer', company: p.client, person: '', phone: '', email: '' });
    PARTY_ROLES.forEach(([k, key]) => {
      const v = (p.parties || ({} as Project['parties']))[k];
      if (v && !seen.has(v.toLowerCase())) out.push({ ...base, role: key, company: v, person: '', phone: '', email: '' });
    });
  });
  return out;
}

/* REQ-052:年份 = 项目立项年份。项目编号是流水号、不带年份,所以取创建时间的年份 */
export function projectYear(p: Pick<Project, 'created' | 'start'>): string {
  const d = p.created ? new Date(p.created) : p.start ? new Date(p.start) : null;
  return d && !isNaN(d.getTime()) ? String(d.getFullYear()) : '';
}
const projText = (r: Row) => (r.code ? `${r.code} · ${r.project}` : r.project);

export default function ContactsView() {
  const { projects, openProject } = useStore();
  const { lang, t } = useLang();
  const [q, setQ] = useState('');
  const [fRole, setFRole] = useState('');
  const [fCompany, setFCompany] = useState('');
  const [fProject, setFProject] = useState('');
  const [fYear, setFYear] = useState('');
  const rows = useMemo(() => collect(projects), [projects]);

  /* §4: filter options built from the aggregated rows */
  const roleOpts = useMemo(() => [...new Set(rows.map((r) => r.role).filter(Boolean))].sort(), [rows]);
  const companyOpts = useMemo(() => [...new Set(rows.map((r) => r.company).filter(Boolean))].sort(), [rows]);
  const projectOpts = useMemo(() => [...new Set(rows.map((r) => r.project).filter(Boolean))].sort(), [rows]);
  const yearOpts = useMemo(() => [...new Set(rows.map((r) => r.year).filter(Boolean))].sort().reverse(), [rows]);

  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => {
    if (fRole && r.role !== fRole) return false;
    if (fCompany && r.company !== fCompany) return false;
    if (fProject && r.project !== fProject) return false;
    if (fYear && r.year !== fYear) return false;
    if (needle && !(r.project + ' ' + r.code + ' ' + contactRoleTerm(r.role, 'zh') + ' ' + contactRoleTerm(r.role, 'en') + ' ' + r.company + ' ' + r.person + ' ' + r.phone + ' ' + r.email).toLowerCase().includes(needle)) return false;
    return true;
  });
  const filtered = !!(fRole || fCompany || fProject || fYear);

  function downloadCsv() {
    const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    /* REQ-052:和表格同一个列顺序 */
    const header = [t('公司', 'Company'), t('联系人', 'Contact'), t('电话', 'Phone'), t('邮箱', 'Email'), t('年份', 'Year'), t('项目编号', 'Project No.'), t('角色', 'Role')];
    const body = shown.map((r) => [r.company, r.person, r.phone, r.email, r.year, projText(r), r.role ? contactRoleTerm(r.role, lang) : '']);
    const csv = [header, ...body].map((r) => r.map(esc).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `audax-contacts-${fmtDate(todayMid())}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const th: React.CSSProperties = { padding: '12px 18px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text2)', textAlign: 'left', whiteSpace: 'nowrap' };
  const cols = '1.4fr 1fr 1.1fr 1.4fr 64px 1.5fr 0.9fr';

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <div className="searchbox" style={{ background: 'var(--card)', width: 260 }}>
          <Icon name="search" size={16} />
          <input placeholder={t('搜索发展商 / 总包 / 联系人…', 'Search developer / contractor / contact…')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="in sm" value={fRole} onChange={(e) => setFRole(e.target.value)} style={{ width: 'auto' }}>
          <option value="">{t('全部角色', 'All roles')}</option>
          {roleOpts.map((r) => <option key={r} value={r}>{contactRoleTerm(r, lang)}</option>)}
        </select>
        <select className="in sm" value={fCompany} onChange={(e) => setFCompany(e.target.value)} style={{ width: 'auto', maxWidth: 200 }}>
          <option value="">{t('全部公司', 'All companies')}</option>
          {companyOpts.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="in sm" value={fYear} onChange={(e) => setFYear(e.target.value)} style={{ width: 'auto' }} data-testid="contacts-year">
          <option value="">{t('全部年份', 'All years')}</option>
          {yearOpts.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select className="in sm" value={fProject} onChange={(e) => setFProject(e.target.value)} style={{ width: 'auto', maxWidth: 200 }}>
          <option value="">{t('全部项目', 'All projects')}</option>
          {projectOpts.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        {filtered && <button className="btn-line sm" onClick={() => { setFRole(''); setFCompany(''); setFProject(''); setFYear(''); }}>{t('清除', 'Clear')}</button>}
        <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>{t(`共 ${shown.length} 条`, `${shown.length} contacts`)}</div>
        <div style={{ flex: 1 }} />
        <button className="btn-line sm" onClick={downloadCsv} disabled={shown.length === 0}>
          <Icon name="download" size={13} />{t('导出 Excel (CSV)', 'Export Excel (CSV)')}
        </button>
      </div>

      <div className="panel clip">
        <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, background: 'var(--hover-bg)', borderBottom: '1px solid var(--row-line)' }}>
          <div style={th}>{t('公司', 'Company')}</div><div style={th}>{t('联系人', 'Contact')}</div><div style={th}>{t('电话', 'Phone')}</div>
          <div style={th}>{t('邮箱', 'Email')}</div><div style={th}>{t('年份', 'Year')}</div><div style={th}>{t('项目编号', 'Project No.')}</div><div style={th}>{t('角色', 'Role')}</div>
        </div>
        {shown.length === 0 && (
          <div style={{ padding: 36, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>{t('暂无联系人。可在项目详情的「联系人」中添加。', 'No contacts yet — add them in a project’s Contacts panel.')}</div>
        )}
        {shown.map((r, i) => (
          <div key={i} className="row-hover" style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, alignItems: 'center', padding: '13px 18px', borderBottom: '1px solid var(--row-line)' }} data-testid="contact-row">
            <div style={{ fontSize: 13, fontWeight: 600 }}>{r.company || '—'}</div>
            <div style={{ fontSize: 13 }}>{r.person || '—'}</div>
            <div className="tnum" style={{ fontSize: 12.5 }}>{r.phone || '—'}</div>
            <Ell style={{ fontSize: 12.5 }}>
              {r.email ? <a href={`mailto:${r.email}`}>{r.email}</a> : '—'}
            </Ell>
            <div className="tnum" style={{ fontSize: 12.5, color: 'var(--text2)' }}>{r.year || '—'}</div>
            <Ell onClick={() => openProject(r.pid)} style={{ fontSize: 12.5, color: "var(--navy700)", cursor: "pointer" }}>{projText(r)}</Ell>
            <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>{r.role ? contactRoleTerm(r.role, lang) : '—'}</div>
          </div>
        ))}
      </div>
    </>
  );
}
