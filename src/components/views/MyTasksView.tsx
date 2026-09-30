'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import {
  fmtDate, parseISO, pendingWorkflowAction, pkgStart, planDates, projectHealth,
  projStage, schedProgress, todayMid,
} from '@/lib/project';
import { canEditPrices, canRowEdit } from '@/lib/permissions';
import type { CaseRow } from '@/server/avdb';
import { presetCaseFilter } from './AvCasesView';
import { STAGES, stageColor, stageIdx, svcName } from '@/lib/templates';
import { useLang } from '@/lib/i18n';
import { Avatar, Ell, HM, Icon, Pill, TM } from '../ui';
import type { PlanDate } from '@/lib/project';
import type { Project, ScheduleRow } from '@/lib/types';

interface Item { p: Project; r: ScheduleRow; i: number; pi: number; svc: string; d: PlanDate | null; year: string }
const GRID = '24px 1fr 52px 96px 92px 32px';

export default function MyTasksView() {
  const { projects, me, dispatch, openProject, setView } = useStore();
  const { lang, t } = useLang();
  const [filter, setFilter] = useState<'all' | 'overdue' | 'wip'>('all');
  const [year, setYear] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const t0 = todayMid();
  const seesAll = me.role === 'director' || me.role === 'bd' || me.role === 'sales';

  const workflowTodos = useMemo(() => {
    const out: { p: Project; label: string; labelEn: string }[] = [];
    projects.forEach((p) => { if (p.archived) return; const a = pendingWorkflowAction(p, me); if (a) out.push({ p, label: a.label, labelEn: a.labelEn }); });
    return out;
  }, [projects, me]);

  const items = useMemo(() => {
    const out: Item[] = [];
    projects.forEach((p) => {
      if (p.archived) return;
      // REQ-004 #11: hide tasks from 未开始 (presales) projects
      if (projStage(p) === 'presales') return;
      const isOwner = (p.owners || []).includes(me.name);
      p.packages.forEach((pk, pi) => {
        const pd = planDates(pk, pkgStart(p, pk));
        pk.schedule.forEach((r, i) => {
          if (r.status === 'done') return;
          let mine: boolean;
          if (seesAll) mine = true;
          else if (me.role === 'member') mine = r.assignee === me.name;
          else if (me.role === 'viewer') mine = false;
          else mine = isOwner || r.assignee === me.name;
          if (mine) {
            const d = pd[i];
            const yr = String((d ? d.end : new Date(p.created)).getFullYear());
            out.push({ p, r, i, pi, svc: pk.svc, d, year: yr });
          }
        });
      });
    });
    return out.sort((a, b) => (a.d?.end.getTime() || 9e15) - (b.d?.end.getTime() || 9e15));
  }, [projects, me, seesAll]);

  const years = useMemo(() => [...new Set(items.map((x) => x.year))].sort().reverse(), [items]);
  const overdueN = items.filter((x) => x.d && x.d.end < t0).length;
  const shown = items.filter((x) => {
    if (year && x.year !== year) return false;
    if (filter === 'overdue') return x.d && x.d.end < t0;
    if (filter === 'wip') return x.r.status === 'wip';
    return true;
  });

  const selP = sel ? projects.find((p) => p.id === sel) || null : null;

  /* AV-014 §7:保修 30 天内到期的屏 —— 提醒 BD 联系客户续保 / 售后回访。
     给能编辑历史案例的人(PD / BD)看;数据来自案例库,口径与那一页的
     「30 天内到期」筛选同一个(服务端同一段 SQL)。读不到就不显示,不挡待办。 */
  const [expiring, setExpiring] = useState<CaseRow[]>([]);
  const [expiringTotal, setExpiringTotal] = useState(0);
  /* 这一轮已经联系过客户的,收起来放一行,可展开撤销 */
  const [contacted, setContacted] = useState<CaseRow[]>([]);
  const [showContacted, setShowContacted] = useState(false);
  const loadExpiring = React.useCallback(() => {
    if (!canEditPrices(me)) return;
    const get = (c: string) => fetch(`/api/av/cases?warranty=soon&contacted=${c}&sort=expire&dir=asc`)
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    Promise.all([get('0'), get('1')]).then(([a, b]) => {
      if (a?.cases) { setExpiring(a.cases); setExpiringTotal(a.total); }
      if (b?.cases) setContacted(b.cases);
    });
  }, [me]);
  useEffect(() => { loadExpiring(); }, [loadExpiring]);
  const markContacted = async (c: CaseRow, on: boolean) => {
    const r = await fetch('/api/av/cases/remind', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseKey: c.caseKey, contacted: on }),
    }).catch(() => null);
    if (r?.ok) loadExpiring();
  };
  const daysLeft = (iso: string | null) => {
    const d = parseISO(iso);
    return d ? Math.round((d.getTime() - t0.getTime()) / 86_400_000) : null;
  };
  const openExpiring = () => {
    presetCaseFilter({ warranty: ['soon'] }, { k: 'expire', dir: 'asc' });
    setView({ name: 'avlibrary', sub: 'cases' });
  };

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,220px)) 1fr', gap: 20, marginBottom: 20, alignItems: 'center' }}>
        {/* REQ-034: 两张卡可点 —— 点了直接切到对应筛选,和下面的「全部 / 逾期」按钮联动。
            当前选中的那张给个高亮边,免得点完看不出发生了什么。 */}
        <button className="kpi" style={{ padding: '18px 20px', textAlign: 'left', cursor: 'pointer', border: filter === 'all' ? '1.5px solid var(--navy700)' : undefined }}
          title={t('查看全部未完成任务', 'Show all open tasks')}
          onClick={() => setFilter('all')}>
          <div className="kpi-label">{t('未完成任务', 'Open Tasks')}</div>
          <div className="tnum" style={{ fontSize: 32, fontWeight: 600, color: 'var(--navy900)', marginTop: 6, lineHeight: 1 }}>{items.length}</div>
        </button>
        <button className="kpi" style={{ padding: '18px 20px', textAlign: 'left', cursor: 'pointer', border: filter === 'overdue' ? '1.5px solid var(--navy700)' : undefined }}
          title={t('只看逾期任务', 'Show overdue only')}
          onClick={() => setFilter('overdue')}>
          <div className="kpi-label">{t('逾期', 'Overdue')}</div>
          <div className="tnum" style={{ fontSize: 32, fontWeight: 600, color: overdueN ? 'var(--danger)' : 'var(--success)', marginTop: 6, lineHeight: 1 }}>{overdueN}</div>
        </button>
        <div style={{ display: 'flex', gap: 7, justifySelf: 'end', flexWrap: 'wrap', alignItems: 'center' }}>
          <button className={`chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>{t('全部', 'All')}</button>
          <button className={`chip ${filter === 'overdue' ? 'active' : ''}`} onClick={() => setFilter('overdue')}>{t('逾期', 'Overdue')}</button>
          <button className={`chip ${filter === 'wip' ? 'active' : ''}`} onClick={() => setFilter('wip')}>{t('进行中', 'In Progress')}</button>
          <select className="in sm" value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 'auto' }}>
            <option value="">{t('全部年份', 'All years')}</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {workflowTodos.length > 0 && (
        <div className="panel clip" style={{ marginBottom: 18, borderColor: 'var(--bronze)' }}>
          <div className="panel-head" style={{ background: '#fbf3e6' }}>
            <span className="panel-title"><Icon name="flag" style={{ color: 'var(--bronze)' }} />{t('需要我处理(工作流)', 'Waiting on me (workflow)')} <span className="badge" style={{ background: 'var(--bronze)', color: '#fff', marginLeft: 6 }}>{workflowTodos.length}</span></span>
          </div>
          {workflowTodos.slice(0, 6).map(({ p, label, labelEn }) => (
            <div key={p.id} className="row-hover" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 20px', borderTop: '1px solid var(--row-line)', cursor: 'pointer' }} onClick={() => openProject(p.id)}>
              <span className="badge" style={{ background: '#fbf0dc', color: '#a8690b', flexShrink: 0 }}>{lang === 'zh' ? label : labelEn}</span>
              <div style={{ minWidth: 0 }}>
                <Ell style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy900)' }}>{p.name}</Ell>
              </div>
              <div style={{ flex: 1 }} />
              <Icon name="back" size={15} style={{ transform: 'rotate(180deg)', color: 'var(--text2)' }} />
            </div>
          ))}
        </div>
      )}

      {(expiring.length > 0 || contacted.length > 0) && (
        <div className="panel clip" style={{ marginBottom: 18, borderColor: 'var(--warning)' }} data-testid="warranty-remind">
          <div className="panel-head" style={{ background: '#fdf6e9' }}>
            <span className="panel-title"><Icon name="alert" style={{ color: 'var(--warning)' }} />
              {t('保修即将到期 · 联系客户续保 / 回访', 'Warranty expiring soon · contact the client')}
              <span className="badge" style={{ background: 'var(--warning)', color: '#fff', marginLeft: 6 }}>{expiringTotal}</span>
            </span>
            <button className="btn-line" style={{ padding: '3px 10px', fontSize: 12 }} onClick={openExpiring}>
              {t('在历史案例里看全部', 'Open in past projects')}
            </button>
          </div>
          {expiring.length === 0 && (
            <div style={{ padding: '11px 20px', borderTop: '1px solid var(--row-line)', fontSize: 12.5, color: 'var(--success)' }}>
              {t('30 天内到期的屏都已联系过。', 'Every screen expiring within 30 days has been followed up.')}
            </div>
          )}
          {expiring.slice(0, 6).map((c) => {
            const d = daysLeft(c.expire);
            return (
              <div key={c.caseKey} className="row-hover" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 20px', borderTop: '1px solid var(--row-line)', cursor: 'pointer' }}
                onClick={openExpiring}>
                <span className="badge" style={{ background: '#fdf0da', color: 'var(--warning)', flexShrink: 0 }}>
                  {d === 0 ? t('今天到期', 'expires today') : t(`${d} 天后到期`, `in ${d}d`)}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Ell style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy900)' }}>{c.name}</Ell>
                  <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>
                    {c.client || '—'}
                    {c.widthMm && c.heightMm ? ` · ${Math.round(c.widthMm)} × ${Math.round(c.heightMm)} mm` : ''}
                    {` · ${t('到期', 'expires')} ${fmtDate(parseISO(c.expire))}`}
                  </div>
                </div>
                <button className="btn-line" style={{ padding: '3px 10px', fontSize: 12, flexShrink: 0 }} data-testid="mark-contacted"
                  title={t('联系过客户后点这里,这一轮到期就不再提醒', 'Click once the client has been contacted; no more reminders for this expiry')}
                  onClick={(e) => { e.stopPropagation(); markContacted(c, true); }}>
                  {t('已联系', 'Contacted')}
                </button>
                <Icon name="back" size={15} style={{ transform: 'rotate(180deg)', color: 'var(--text2)' }} />
              </div>
            );
          })}
          {contacted.length > 0 && (
            <div style={{ borderTop: '1px solid var(--row-line)', padding: '8px 20px', fontSize: 12 }}>
              <button onClick={() => setShowContacted(!showContacted)} data-testid="toggle-contacted"
                style={{ border: 0, background: 'none', color: 'var(--text2)', cursor: 'pointer', font: 'inherit', padding: 0 }}>
                {showContacted ? '▾ ' : '▸ '}{t(`另有 ${contacted.length} 块本轮已联系`, `${contacted.length} more already contacted`)}
              </button>
              {showContacted && contacted.map((c) => (
                <div key={c.caseKey} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0 0 14px', color: 'var(--text2)' }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {c.name} · {t('到期', 'expires')} {fmtDate(parseISO(c.expire))} · {c.contactedBy} {c.contactedAt ? fmtDate(new Date(c.contactedAt)) : ''}
                  </span>
                  <button className="btn-line" style={{ padding: '1px 8px', fontSize: 11.5 }} onClick={() => markContacted(c, false)}>
                    {t('撤销', 'Undo')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* task list (left) + project info panel (right) */}
      <div className="grid-2col" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.7fr) minmax(260px,1fr)', gap: 18, alignItems: 'start' }}>
        <div className="panel clip">
          <div className="table-head" style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12 }}>
            <div /><div>{t('任务', 'Task')}</div><div>{t('年', 'Yr')}</div><div>{t('到期', 'Due')}</div><div>{t('状态', 'Status')}</div><div />
          </div>
          {shown.length === 0 && (
            <div style={{ padding: 34, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
              ✓ {t('没有匹配的待办。', 'No matching tasks.')}
              {me.role === 'member' ? t('(成员只看被指派👤给自己的任务)', ' (Members see only tasks assigned 👤 to them.)') : ''}
            </div>
          )}
          {shown.map((x, xi) => {
            const over = x.d && x.d.end < t0;
            const rowEd = canRowEdit(me, x.p, x.r);
            const active = sel === x.p.id;
            return (
              <div key={xi} className="row-hover" style={{
                display: 'grid', gridTemplateColumns: GRID, gap: 12, alignItems: 'center',
                padding: '13px 18px', borderBottom: '1px solid var(--row-line)',
                borderLeft: `3px solid ${active ? 'var(--navy700)' : over ? 'var(--danger)' : 'transparent'}`,
                background: active ? 'var(--hover-bg)' : undefined,
              }}>
                <button className={`ckbox ${rowEd ? '' : 'locked'}`}
                  onClick={rowEd ? () => dispatch(x.p.id, { type: 'toggleDone', pkg: x.pi, idx: x.i }) : undefined} />
                <div style={{ minWidth: 0, cursor: 'pointer' }} onClick={() => setSel(x.p.id)}>
                  <Ell style={{ fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {x.r.assignee && <Avatar name={x.r.assignee} size={20} />}
                    {lang === 'zh' ? x.r.task : x.r.taskEn || x.r.task}
                  </Ell>
                  <Ell style={{ fontSize: 11, color: 'var(--text2)' }}>
                    {x.p.name}{x.p.packages.length > 1 ? ` · ${svcName(x.svc, lang)}` : ''}
                  </Ell>
                </div>
                <div className="tnum" style={{ fontSize: 11.5, color: 'var(--text2)' }}>{x.year}</div>
                <div className="tnum" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 500, color: over ? 'var(--danger)' : 'var(--text2)' }}>
                  {over && <Icon name="alert" size={12} />}
                  {x.d ? fmtDate(x.d.end).slice(0, 6) : '—'}
                </div>
                <div><Pill m={TM[x.r.status]} /></div>
                <button aria-label="Open project" onClick={() => openProject(x.p.id)}
                  style={{ width: 28, height: 28, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="edit" size={12} />
                </button>
              </div>
            );
          })}
        </div>

        {/* right: selected project info (REQ-004 #15/#7) */}
        <ProjectInfoPanel p={selP} onOpen={openProject} />
      </div>
    </>
  );
}

function ProjectInfoPanel({ p, onOpen }: { p: Project | null; onOpen: (id: string) => void }) {
  const { t, lang } = useLang();
  const t0 = todayMid();
  if (!p) {
    return (
      <div className="panel" style={{ padding: 26, textAlign: 'center', color: 'var(--text2)', fontSize: 12.5, position: 'sticky', top: 12 }}>
        {t('点选左侧任务,在此查看所属项目信息。', 'Select a task to see its project here.')}
      </div>
    );
  }
  const stage = projStage(p);
  const done = stage === 'complete' || stage === 'invoice';
  const h = done ? 'completed' : projectHealth(p);
  const sp = schedProgress(p);
  const del = parseISO(p.delivery);
  const daysLeft = del ? Math.round((del.getTime() - t0.getTime()) / 86400000) : null;
  const st = STAGES[stageIdx(stage)];
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderTop: '1px solid var(--row-line)', fontSize: 12.5 }}>
      <span style={{ color: 'var(--text2)' }}>{k}</span><span style={{ fontWeight: 500, textAlign: 'right' }}>{v}</span>
    </div>
  );
  return (
    <div className="panel" style={{ padding: '16px 18px', position: 'sticky', top: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--navy900)' }}>{p.name}</span>
      </div>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', margin: '8px 0 4px' }}>
        <span className="badge" style={{ background: 'var(--hover-bg)', color: stageColor(stage) }}><span className="bdot" style={{ background: stageColor(stage) }} />{lang === 'zh' ? st[1] : st[2]}</span>
        <Pill m={HM[h]} />
      </div>
      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--text2)', marginBottom: 4 }}>
          <span>{t('排期进度', 'Schedule')}</span><span className="tnum">{sp.done}/{sp.total} · {sp.pct}%</span>
        </div>
        <div style={{ height: 7, borderRadius: 4, background: 'var(--row-line)', overflow: 'hidden' }}>
          <div style={{ width: `${sp.pct}%`, height: '100%', background: 'var(--navy700)', borderRadius: 4 }} />
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <Row k={t('客户', 'Client')} v={p.client || '—'} />
        <Row k={t('负责人', 'PM')} v={(p.owners || []).join(', ') || '—'} />
        <Row k={t('总包', 'Main Con')} v={p.parties?.mainContractor || '—'} />
        <Row k={t('交付日', 'Delivery')} v={<span className="tnum">{del ? fmtDate(del) : '—'}{daysLeft != null && <span style={{ color: daysLeft < 0 ? 'var(--danger)' : 'var(--text2)', marginLeft: 6 }}>{daysLeft < 0 ? t(`逾期 ${-daysLeft} 天`, `${-daysLeft}d over`) : t(`剩 ${daysLeft} 天`, `${daysLeft}d left`)}</span>}</span>} />
        <Row k={t('服务', 'Services')} v={p.services.map((s) => svcName(s, lang)).join(', ')} />
      </div>
      <button className="btn-navy sm" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }} onClick={() => onOpen(p.id)}>
        {t('打开项目详情', 'Open project')} →
      </button>
    </div>
  );
}
