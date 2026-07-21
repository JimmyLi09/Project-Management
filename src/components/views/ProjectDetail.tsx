'use client';

import React, { useState } from 'react';
import { useStore } from '../store';
import {
  deliverySlack, fmtDate, infoProgress, nextFreeze, overdueItems, parseISO,
  pkgProgress, pkgStart, planDates, plannedFinish, projectHealth, projPoints,
  projStage, schedProgress, todayMid,
} from '@/lib/project';
import { canAssign, canCommercial, canEdit, isFull } from '@/lib/permissions';
import { DIFF, STAGES, stageIdx, svcColor, svcName } from '@/lib/templates';
import { useLang } from '@/lib/i18n';
import { Avatar, HM, Icon, Pill, ProgressBar, TM } from '../ui';
import ScheduleTab from './ScheduleTab';
import ChecklistTab from './ChecklistTab';
import ExportOverlay from './ExportOverlay';
import TransferModal from '../TransferModal';
import type { Project } from '@/lib/types';

export default function ProjectDetail() {
  const { projects, view, setView, me, dispatch, removeProject, go, users } = useStore();
  const { lang, t } = useLang();
  const [showExport, setShowExport] = useState(false);
  const [transferFrom, setTransferFrom] = useState<string | null>(null);
  const p = projects.find((x) => x.id === view.pid);
  if (!p) {
    return <div className="panel" style={{ padding: 40, textAlign: 'center', color: 'var(--text2)' }}>{t('项目加载中…', 'Loading project…')}</div>;
  }

  const ed = canEdit(me, p);
  const tab = view.tab || 'overview';
  const pkgIdx = Math.min(view.pkg || 0, p.packages.length - 1);
  const stage = projStage(p);
  const done = stage === 'complete' || stage === 'invoice';
  const h = done ? 'completed' : projectHealth(p);
  const ci = stageIdx(stage);
  const del = parseISO(p.delivery);
  const t0 = todayMid();
  const daysLeft = del ? Math.round((del.getTime() - t0.getTime()) / 86400000) : null;

  const setTab = (tb: 'overview' | 'schedule' | 'checklist') => setView({ ...view, tab: tb });
  const pmUsers = users.filter((u) => u.role === 'pm' || u.role === 'member');

  return (
    <>
      {/* header card */}
      <div className="panel" style={{ padding: '22px 24px 0', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', paddingBottom: 18 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--navy900)', letterSpacing: '-.01em' }}>{p.name}</h1>
              <Pill m={HM[h]} />
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--text2)', marginTop: 4 }}>
              {p.client || '—'} · PM {(p.owners || []).join(', ') || t('未指派', 'unassigned')}
              {p.start ? <> · {t('起', 'from')} {fmtDate(parseISO(p.start))}</> : null}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
              {p.services.map((k) => <span key={k} className="svc-chip" style={{ color: svcColor(k), padding: '3px 9px', fontSize: 11.5 }}>{svcName(k, lang)}</span>)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start' }}>
            <div style={{ textAlign: 'right' }}>
              <div className="mini-label">{t('交付', 'Delivery')}</div>
              <div className="tnum" style={{ fontSize: 22, fontWeight: 600, color: daysLeft !== null && daysLeft < 0 && !done ? 'var(--danger)' : 'var(--navy900)' }}>
                {del ? fmtDate(del).slice(0, 6) : '—'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                {daysLeft === null ? t('未设交付日', 'no delivery date')
                  : done ? t('已完成', 'completed')
                  : daysLeft >= 0 ? t(`还剩 ${daysLeft} 天`, `${daysLeft} days left`)
                  : t(`逾期 ${-daysLeft} 天`, `${-daysLeft} days over`)}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn-line sm" onClick={() => setShowExport(true)}><Icon name="download" size={13} />{t('导出', 'Export')}</button>
              {stage === 'complete' && canCommercial(me, p) && (
                <button className="btn-line sm" onClick={() => dispatch(p.id, { type: 'toggleInvoiced' })}>{t('标记开票/收尾', 'Mark invoiced')}</button>
              )}
              {p.invoiced && canCommercial(me, p) && (
                <button className="btn-line sm" onClick={() => dispatch(p.id, { type: 'toggleInvoiced' })}>{t('撤销开票', 'Undo invoiced')}</button>
              )}
              {isFull(me) && (
                <button className="btn-line sm danger" onClick={async () => {
                  if (confirm(t('确认删除此项目?对所有协作成员生效。', 'Delete this project for everyone?'))) { if (await removeProject(p.id)) go('projects'); }
                }}>{t('删除', 'Delete')}</button>
              )}
            </div>
          </div>
        </div>
        <div className="detail-tabs">
          <button className={`detail-tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>{t('概览', 'Overview')}</button>
          <button className={`detail-tab ${tab === 'schedule' ? 'active' : ''}`} onClick={() => setTab('schedule')}>{t('排期', 'Schedule')}</button>
          <button className={`detail-tab ${tab === 'checklist' ? 'active' : ''}`} onClick={() => setTab('checklist')}>{t('信息清单', 'Checklist')}</button>
        </div>
      </div>

      {/* lifecycle steps */}
      <div className="stage-steps">
        {STAGES.map((s, i) => (
          <div key={s[0]} className={`stage-step ${i < ci ? 'done' : i === ci ? 'cur' : ''}`}>
            <span className="num">{i + 1}</span>{lang === 'zh' ? s[1] : s[2]}
          </div>
        ))}
      </div>

      {/* PD/BD management bar */}
      {canAssign(me, p) && (
        <div className="panel" style={{ padding: '14px 20px', marginBottom: 20, display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="mini-label">PM</span>
            {(p.owners || []).map((n) => (
              <span key={n} className="chip" style={{ height: 30 }}>
                <Avatar name={n} size={18} />{n}
                <button style={{ color: 'var(--text2)', fontWeight: 700 }} onClick={() => dispatch(p.id, { type: 'removeOwner', name: n })}>✕</button>
              </span>
            ))}
            <button className="btn-line sm" onClick={() => {
              const hint = pmUsers.map((u) => u.name).join(' / ');
              const nm = prompt(t(`指派 PM 的名字:${hint ? `\n(已有账号: ${hint})` : ''}`, `PM name to assign:${hint ? `\n(accounts: ${hint})` : ''}`));
              if (nm && nm.trim()) dispatch(p.id, { type: 'addOwner', name: nm.trim() });
            }}>+ {t('指派', 'Assign')}</button>
            {(p.owners || []).length > 0 && (
              <button className="btn-line sm" title={t('休假/离职时把项目移交他人', 'Hand the project to someone else')}
                onClick={() => {
                  let f = p.owners[0];
                  if (p.owners.length > 1) {
                    const pick = prompt(t(`转出哪位?(${p.owners.join(' / ')})`, `Transfer from whom? (${p.owners.join(' / ')})`), p.owners[0]);
                    if (!pick || !p.owners.includes(pick.trim())) return;
                    f = pick.trim();
                  }
                  setTransferFrom(f);
                }}>⇄ {t('转交', 'Transfer')}</button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mini-label">{t('难度', 'Difficulty')}</span>
            <select className="in sm" value={p.difficulty} onChange={(e) => dispatch(p.id, { type: 'setDiff', value: e.target.value })}>
              {Object.entries(DIFF).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mini-label">{t('积分', 'Points')}</span>
            <input type="number" min={0} className="in sm" style={{ width: 70 }} defaultValue={projPoints(p)} key={projPoints(p)}
              onBlur={(e) => { const v = parseInt(e.target.value) || 0; if (v !== projPoints(p)) dispatch(p.id, { type: 'setPoints', value: v }); }} />
          </div>
        </div>
      )}
      {!ed && (
        <div className="panel" style={{ padding: '11px 18px', marginBottom: 20, fontSize: 12.5, color: 'var(--text2)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <Icon name="lock" size={14} />
          {me.role === 'sales'
            ? t('销售视角:可编辑售前/开票与商业信息;生产内容只读。', 'Sales view: presales/invoice and commercial info editable; production read-only.')
            : me.role === 'member'
            ? t('团队成员:仅可勾选指派给你(👤)的任务。', 'Member: you can only tick tasks assigned 👤 to you.')
            : t('你对此项目为只读(服务端按角色强制)。', 'Read-only for you (enforced server-side).')}
        </div>
      )}

      {tab === 'overview' && <OverviewTab p={p} onSchedule={(pkg) => setView({ ...view, tab: 'schedule', pkg })} />}
      {tab === 'schedule' && <ScheduleTab p={p} pkgIdx={pkgIdx} onExport={() => setShowExport(true)} onPkg={(i) => setView({ ...view, pkg: i })} />}
      {tab === 'checklist' && <ChecklistTab p={p} pkgIdx={pkgIdx} onExport={() => setShowExport(true)} onPkg={(i) => setView({ ...view, pkg: i })} />}
      {showExport && <ExportOverlay p={p} onClose={() => setShowExport(false)} />}
      {transferFrom && (
        <TransferModal from={transferFrom} pid={p.id} onClose={() => setTransferFrom(null)} />
      )}
    </>
  );
}

function OverviewTab({ p, onSchedule }: { p: Project; onSchedule: (pkg: number) => void }) {
  const { lang, t } = useLang();
  const sp = schedProgress(p);
  const ip = infoProgress(p);
  const od = overdueItems(p);
  const nf = nextFreeze(p);
  const slack = deliverySlack(p);
  const fin = plannedFinish(p);
  const t0 = todayMid();
  const [logOpen, setLogOpen] = useState(false);
  const log = p.log || [];

  const risks: { title: string; detail: string; color: string; icon: string }[] = [];
  od.slice(0, 4).forEach((o) => risks.push({
    title: t(`${o.row.task} 逾期 ${o.days} 天`, `${o.row.taskEn || o.row.task} — ${o.days}d overdue`),
    detail: `${svcName(o.pkg.svc, lang)} · ${t('应完成', 'due')} ${fmtDate(o.due)}`,
    color: 'var(--danger)', icon: 'alert',
  }));
  p.packages.forEach((pk) => pk.schedule.forEach((r) => {
    if (r.status === 'block') risks.push({
      title: t(`${r.task} 受阻`, `${r.taskEn || r.task} — blocked`),
      detail: `${svcName(pk.svc, lang)}${r.note ? ' · ' + r.note : ''}`,
      color: 'var(--warning)', icon: 'clock',
    });
  }));
  if (nf && !risks.length) risks.push({
    title: t(`下一冻结点:${nf.row.phase}`, `Next freeze point: ${nf.row.phase}`),
    detail: `${svcName(nf.svc, lang)}${nf.date ? ' · ' + fmtDate(nf.date) : ''} — ${t('冻结前须客户确认', 'client sign-off required before freeze')}`,
    color: 'var(--bronze)', icon: 'lock',
  });

  const team = [...new Set(p.packages.flatMap((pk) => pk.schedule.map((r) => r.assignee)).filter(Boolean))];
  const blockCount = p.packages.reduce((a, pk) => a + pk.schedule.filter((r) => r.status === 'block').length, 0);

  return (
    <div className="grid-2col" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 20, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
        <div className="panel clip">
          <div className="panel-head" style={{ padding: '16px 22px' }}>
            <span className="panel-title" style={{ fontSize: 15 }}>{t('服务包', 'Service Packages')}</span>
            <span className="tnum" style={{ fontSize: 12.5, color: 'var(--text2)' }}>{sp.done}/{sp.total} · {sp.pct}%</span>
          </div>
          {p.packages.map((pk, pi) => {
            const pr = pkgProgress(pk);
            const pd = planDates(pk, pkgStart(p, pk));
            let end: Date | null = null;
            for (let i = pd.length - 1; i >= 0; i--) if (pd[i]) { end = pd[i]!.end; break; }
            const pkOver = pk.schedule.some((r, i) => r.status !== 'done' && pd[i] && pd[i]!.end < t0);
            const st = pr.pct >= 100 ? TM.done : pkOver ? TM.block : pr.pct > 0 ? TM.wip : TM.todo;
            return (
              <div key={pi} className="row-hover" onClick={() => onSchedule(pi)}
                style={{ display: 'grid', gridTemplateColumns: '1.4fr 34px 1fr 110px', gap: 14, alignItems: 'center', padding: '15px 22px', borderBottom: '1px solid var(--row-line)', cursor: 'pointer' }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--navy900)' }}>{svcName(pk.svc, lang)}</div>
                  <div className="tnum" style={{ fontSize: 11.5, color: 'var(--text2)' }}>
                    {pkgStart(p, pk) ? fmtDate(parseISO(pkgStart(p, pk))).slice(0, 6) : '—'} → {pk.delivery ? fmtDate(parseISO(pk.delivery)).slice(0, 6) : end ? fmtDate(end).slice(0, 6) : '—'} · {pk.buffer || 0}d buffer
                  </div>
                </div>
                <div>{pk.owner ? <Avatar name={pk.owner} size={28} /> : null}</div>
                <ProgressBar pct={pr.pct} color={svcColor(pk.svc)} />
                <div style={{ justifySelf: 'end' }}><Pill m={st} /></div>
              </div>
            );
          })}
        </div>

        <div className="panel clip">
          <div className="panel-head" style={{ padding: '16px 22px' }}>
            <span className="panel-title" style={{ fontSize: 15 }}>{t('风险与受阻', 'Risks & Blockers')}</span>
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>{od.length + blockCount} {t('项', 'open')}</span>
          </div>
          {risks.length === 0 && <div style={{ padding: 22, textAlign: 'center', fontSize: 13, color: 'var(--text2)' }}>{t('无逾期与受阻 — 按计划进行。', 'No open risks — on track.')}</div>}
          {risks.slice(0, 6).map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, padding: '15px 22px', borderBottom: '1px solid var(--row-line)' }}>
              <span style={{ color: r.color, flexShrink: 0, marginTop: 1, display: 'flex' }}><Icon name={r.icon} size={16} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{r.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{r.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="panel" style={{ padding: 20 }}>
          <div className="panel-title" style={{ fontSize: 15, marginBottom: 14 }}>{t('交付核算', 'Delivery Check')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
            <Row k={t('计划完成', 'Planned finish')} v={fin ? fmtDate(fin) : '—'} />
            <Row k={t('交付日', 'Required delivery')} v={p.delivery ? fmtDate(parseISO(p.delivery)) : '—'} />
            <Row k="Buffer" v={t(`${p.buffer || 0} 天`, `${p.buffer || 0} days`)} />
            <Row k={t('信息确认', 'Info checklist')} v={`${ip.done}/${ip.total} · ${ip.pct}%`} />
            <Row k={t('积分', 'Points')} v={String(projPoints(p))} />
            <div style={{ borderTop: '1px solid var(--row-line)', paddingTop: 10, fontWeight: 600, color: slack === null ? 'var(--text2)' : slack >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {slack === null ? t('填交付日后自动核算', 'Set a delivery date to auto-check')
                : slack >= 0 ? t(`✓ 富余 ${slack} 天(含 buffer)`, `✓ ${slack} days slack (incl. buffer)`)
                : t(`⚠ 超出 ${-slack} 天 — 需压缩或提前拿资料`, `⚠ ${-slack} days over — compress or get info earlier`)}
            </div>
          </div>
        </div>

        <div className="panel" style={{ padding: 20 }}>
          <div className="panel-title" style={{ fontSize: 15, marginBottom: 8 }}><Icon name="users" style={{ color: 'var(--navy700)' }} />{t('项目团队', 'Assigned Team')}</div>
          {(p.owners || []).map((n) => (
            <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0', borderTop: '1px solid var(--row-line2)' }}>
              <Avatar name={n} size={30} />
              <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 600 }}>{n}</div><div style={{ fontSize: 11.5, color: 'var(--text2)' }}>{t('项目经理', 'Project Manager')}</div></div>
            </div>
          ))}
          {team.map((n) => (
            <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0', borderTop: '1px solid var(--row-line2)' }}>
              <Avatar name={n} size={30} />
              <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 600 }}>{n}</div><div style={{ fontSize: 11.5, color: 'var(--text2)' }}>{t('制作', 'Production')}</div></div>
              <span className="tnum" style={{ fontSize: 11.5, color: 'var(--text2)' }}>
                {p.packages.reduce((a, pk) => a + pk.schedule.filter((r) => r.assignee === n && r.status !== 'done').length, 0)} {t('项未完成', 'open')}
              </span>
            </div>
          ))}
          {(p.owners || []).length === 0 && team.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--text2)', padding: '8px 0' }}>{t('尚未指派人员', 'No one assigned yet')}</div>}
        </div>

        <div className="panel" style={{ padding: 20 }}>
          <div className="panel-title" style={{ fontSize: 15, marginBottom: 8, cursor: 'pointer' }} onClick={() => setLogOpen(!logOpen)}>
            {t('操作记录', 'Recent Activity')}
            <span className="tnum" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text2)', fontWeight: 500 }}>{log.length}</span>
          </div>
          {(logOpen ? log.slice(0, 20) : log.slice(0, 5)).map((e, i) => (
            <div key={i} style={{ display: 'flex', gap: 11, padding: '8px 0', borderTop: '1px solid var(--row-line2)' }}>
              <Avatar name={e.by} size={24} />
              <div style={{ flex: 1, lineHeight: 1.4, minWidth: 0 }}>
                <div style={{ fontSize: 12.5 }}><b style={{ fontWeight: 600 }}>{e.by}</b> {e.text}</div>
                <div className="tnum" style={{ fontSize: 11, color: 'var(--text2)' }}>{fmtDate(new Date(e.at))} {new Date(e.at).toTimeString().slice(0, 5)}</div>
              </div>
            </div>
          ))}
          {log.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--text2)', padding: '8px 0' }}>{t('暂无操作记录', 'No activity yet')}</div>}
          {log.length > 5 && (
            <button className="btn-line sm" style={{ marginTop: 8 }} onClick={() => setLogOpen(!logOpen)}>
              {logOpen ? t('收起', 'Collapse') : t(`查看更多 (${log.length})`, `Show more (${log.length})`)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
      <span style={{ color: 'var(--text2)' }}>{k}</span>
      <span className="tnum" style={{ fontWeight: 600 }}>{v}</span>
    </div>
  );
}
