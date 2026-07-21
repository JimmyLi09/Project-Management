'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { overdueItems, projectHealth, projStage, staleInfo } from '@/lib/project';
import { canDecide, canEdit } from '@/lib/permissions';
import { useLang } from '@/lib/i18n';
import { Avatar, HM, Icon, Pill } from '../ui';

const UF: [keyof UFields, string, string][] = [
  ['done', '本周完成', 'Done this week'],
  ['nextNodes', '下周关键节点', 'Next key nodes'],
  ['risks', '当前风险', 'Current risks'],
  ['needDirector', '需 Director 决定', 'Needs Director'],
  ['clientPending', '客户待确认', 'Client pending'],
  ['budget', '预算 / 变更风险', 'Budget / change'],
];
type UFields = { done: string; nextNodes: string; risks: string; needDirector: string; clientPending: string; budget: string };

export default function DirectorUpdateView() {
  const { projects, me, dispatch, openProject } = useStore();
  const { lang, t } = useLang();
  const [filter, setFilter] = useState('all');
  const isDirector = canDecide(me);

  const pms = useMemo(() => {
    const s = new Set<string>();
    projects.forEach((p) => (p.owners || []).forEach((n) => s.add(n)));
    return [...s];
  }, [projects]);

  const list = filter === 'all' ? projects : projects.filter((p) => (p.owners || []).includes(filter));

  const pendingDecisions = projects.filter((p) => p.update?.needDirector && p.update.dStatus === 'pending');
  const staleCount = projects.filter((p) => staleInfo(p.update).cls !== 'stale-ok' && (p.owners || []).length).length;
  const overdueProjects = projects.filter((p) => overdueItems(p).length).length;

  return (
    <>
      <div className="kpi-grid">
        <MiniKpi label={t('待决策', 'Awaiting decision')} value={String(pendingDecisions.length)} color={pendingDecisions.length ? 'var(--bronze)' : 'var(--navy900)'} sub={t('需 Director 批复的事项', 'items needing a Director decision')} />
        <MiniKpi label={t('周报未更新', 'Stale updates')} value={String(staleCount)} color={staleCount ? 'var(--warning)' : 'var(--navy900)'} sub={t('超过 7 天未更新的项目', 'projects not updated for 7+ days')} />
        <MiniKpi label={t('有逾期的项目', 'Projects overdue')} value={String(overdueProjects)} color={overdueProjects ? 'var(--danger)' : 'var(--navy900)'} sub={t('存在逾期阶段的项目', 'projects with overdue phases')} />
      </div>

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 20 }}>
        <button className={`chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>{t('全部负责人', 'All PMs')}</button>
        {pms.map((n) => (
          <button key={n} className={`chip ${filter === n ? 'active' : ''}`} onClick={() => setFilter(n)}>
            <Avatar name={n} size={20} />{n}
          </button>
        ))}
      </div>

      <div className="grid-2col" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 20, alignItems: 'start' }}>
        <div className="panel clip">
          <div className="panel-head"><span className="panel-title">{t('每周项目汇报', 'Weekly Project Updates')}</span></div>
          {list.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>{t('没有匹配的项目。', 'No matching projects.')}</div>}
          {list.map((p) => {
            const u = p.update || ({} as typeof p.update);
            const ed = canEdit(me, p);
            const st = staleInfo(u, lang);
            const stage = projStage(p);
            const h = stage === 'complete' || stage === 'invoice' ? 'completed' : projectHealth(p);
            const pm = (p.owners || [])[0];
            return (
              <div key={p.id} style={{ padding: '18px 22px', borderBottom: '1px solid var(--row-line)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    {pm ? <Avatar name={pm} size={30} /> : <Avatar name="?" size={30} />}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy900)', cursor: 'pointer' }} onClick={() => openProject(p.id)}>{p.name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>
                        {pm || t('未指派', 'unassigned')} · <span style={{ color: st.cls === 'stale-ok' ? 'var(--text2)' : st.cls === 'stale-warn' ? 'var(--warning)' : 'var(--danger)' }}>{st.txt}</span>
                      </div>
                    </div>
                  </div>
                  <Pill m={HM[h]} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px', fontSize: 12.5 }}>
                  {UF.map(([f, zh, en]) => {
                    const val = (u as unknown as UFields)[f] || '';
                    return (
                      <div key={f}>
                        <span style={{ color: 'var(--text2)' }}>{t(zh, en)}: </span>
                        {ed ? (
                          <EditableText value={val} onSave={(v) => dispatch(p.id, { type: 'editUpdate', field: f, value: v })} />
                        ) : (
                          <span style={{ color: val ? 'var(--text)' : '#b6bfc9' }}>{val || '—'}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {u.dDecision && (
                  <div style={{ marginTop: 10, fontSize: 12.5, background: 'var(--hover-bg)', border: '1px solid var(--row-line)', borderRadius: 8, padding: '8px 11px' }}>
                    <span style={{ color: 'var(--bronze)', fontWeight: 600 }}>Director:</span> {u.dDecision}
                    <span style={{ color: 'var(--text2)', fontSize: 11 }} className="tnum"> · {u.dBy} {u.dDate}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="panel clip">
          <div className="panel-head">
            <span className="panel-title"><Icon name="flag" style={{ color: 'var(--bronze)' }} />{t('待决策', 'Awaiting Decision')}</span>
          </div>
          {pendingDecisions.length === 0 && (
            <div style={{ padding: 26, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>✓ {t('暂无待决策事项', 'Nothing awaiting decision')}</div>
          )}
          {pendingDecisions.map((p) => (
            <DecisionCard key={p.id} pid={p.id} name={p.name} ask={p.update.needDirector} canAct={isDirector} />
          ))}
        </div>
      </div>
    </>
  );
}

function DecisionCard({ pid, name, ask, canAct }: { pid: string; name: string; ask: string; canAct: boolean }) {
  const { dispatch, openProject } = useStore();
  const { t } = useLang();
  const [note, setNote] = useState('');

  async function decide(status: 'approved' | 'rejected' | 'needinfo') {
    if (note.trim()) await dispatch(pid, { type: 'setDecision', field: 'dDecision', value: note.trim() });
    await dispatch(pid, { type: 'setDecision', field: 'dStatus', value: status });
  }

  return (
    <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--row-line)' }}>
      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{ask.split('\n')[0]}</div>
      <div style={{ fontSize: 12, color: 'var(--text2)', margin: '4px 0 11px', cursor: 'pointer' }} onClick={() => openProject(pid)}>{name}</div>
      {canAct ? (
        <>
          <textarea className="in" placeholder={t('批复 / 指示…', 'Decision note…')} value={note} onChange={(e) => setNote(e.target.value)} style={{ marginBottom: 9, minHeight: 40 }} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-navy sm" onClick={() => decide('approved')}>{t('批准', 'Approve')}</button>
            <button className="btn-line sm" onClick={() => decide('needinfo')}>{t('需补充', 'Need info')}</button>
            <button className="btn-line sm danger" onClick={() => decide('rejected')}>{t('驳回', 'Reject')}</button>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text2)' }}>{t('等待 PD/BD 批复', 'Waiting for PD/BD decision')}</div>
      )}
    </div>
  );
}

function EditableText({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const { t } = useLang();
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <span
        style={{ color: value ? 'var(--text)' : '#b6bfc9', cursor: 'text', borderBottom: '1px dashed var(--border)' }}
        onClick={() => setEditing(true)}
        title={t('点击编辑', 'Click to edit')}
      >
        {value || t('点击填写…', 'Click to fill in…')}
      </span>
    );
  }
  return (
    <textarea
      className="in" autoFocus defaultValue={value}
      style={{ marginTop: 4, minHeight: 40, fontSize: 12.5 }}
      onBlur={(e) => { setEditing(false); if (e.target.value !== value) onSave(e.target.value); }}
    />
  );
}

function MiniKpi({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <div className="kpi" style={{ padding: '20px 22px' }}>
      <div className="kpi-label">{label}</div>
      <div className="tnum" style={{ fontSize: 34, fontWeight: 600, color: color || 'var(--navy900)', marginTop: 6, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6 }}>{sub}</div>
    </div>
  );
}
