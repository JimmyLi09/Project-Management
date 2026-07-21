'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { overdueItems, staleInfo } from '@/lib/project';
import { canDecide, canEdit } from '@/lib/permissions';
import { svcColor } from '@/lib/templates';
import { StageTag } from './parts';

const UF: [keyof UFields, string, string, string][] = [
  ['done', '本周完成', 'This week done', '#3F7A4E'],
  ['nextNodes', '下周关键节点', 'Next key nodes', '#2C6E8F'],
  ['risks', '当前风险', 'Current risks', '#D98A2B'],
  ['needDirector', '需 Director 决定', 'Needs Director', '#C4453B'],
  ['clientPending', '客户待确认', 'Client pending', '#8E7CC3'],
  ['budget', '预算 / 变更风险', 'Budget / change', '#B26A2E'],
];
type UFields = { done: string; nextNodes: string; risks: string; needDirector: string; clientPending: string; budget: string };

const DS: Record<string, [string, string]> = {
  pending: ['ds-pending', '待决定 Pending'],
  approved: ['ds-approved', '已批准 Approved'],
  rejected: ['ds-rejected', '已驳回 Rejected'],
  needinfo: ['ds-needinfo', '需补充 Need info'],
};

export default function DirectorUpdateView() {
  const { projects, me, dispatch, openProject } = useStore();
  const [filter, setFilter] = useState('');

  const pms = useMemo(() => {
    const s = new Set<string>();
    projects.forEach((p) => (p.owners || []).forEach((n) => s.add(n)));
    return [...s];
  }, [projects]);

  const list = filter ? projects.filter((p) => (p.owners || []).includes(filter)) : projects;
  const isDirector = canDecide(me);

  return (
    <>
      <div className="page-head"><h1>向上汇报</h1><span className="en">DIRECTOR UPDATE</span></div>
      <p className="sub">
        {isDirector
          ? '一屏读完所有 PM 周报。红框=有待你决定的事项或逾期;右上角显示更新新鲜度(>7天黄 / >14天红)。可直接在下方写决策并置状态。'
          : '填写六个标准字段,Director 会统一看到并回批决策。请保持每周更新。'}
      </p>
      <div className="toolbar">
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>只看负责人:</span>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">全部负责人 All</option>
          {pms.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      {list.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>没有匹配的项目。</div>
      )}
      {list.map((p) => {
        const u = p.update || ({} as typeof p.update);
        const ed = canEdit(me, p);
        const st = staleInfo(u);
        const odc = overdueItems(p).length;
        const flag = !!(u.needDirector && u.dStatus === 'pending') || !!odc;
        const [dcls, dtxt] = DS[u.dStatus] || DS.pending;
        return (
          <div key={p.id} className={`du-card ${flag ? 'flag' : ''}`}>
            <div className="du-head">
              <span className="stripe" style={{ width: 4, height: 16, borderRadius: 2, background: svcColor(p.services[0]) }} />
              <span className="pn" style={{ cursor: 'pointer' }} onClick={() => openProject(p.id)}>{p.name}</span>
              <StageTag p={p} />
              {flag && (
                <span className="flagchip">
                  {u.needDirector && u.dStatus === 'pending' ? '待决定' : ''}
                  {u.needDirector && u.dStatus === 'pending' && odc ? ' · ' : ''}
                  {odc ? `逾期${odc}` : ''}
                </span>
              )}
              <span className="own">负责 {(p.owners || []).join(', ') || '—'}</span>
              <span className={`stale ${st.cls}`} style={{ marginLeft: 'auto' }}>{st.txt}</span>
            </div>
            <div className="du-body">
              {UF.map(([f, zh, en, col]) => {
                const val = (u as unknown as UFields)[f] || '';
                return (
                  <div key={f} className="du-f">
                    <div className="k"><span className="dot" style={{ background: col }} />{zh} · {en}</div>
                    {ed ? (
                      <textarea
                        placeholder="…"
                        defaultValue={val}
                        onBlur={(e) => {
                          if (e.target.value !== val) dispatch(p.id, { type: 'editUpdate', field: f, value: e.target.value });
                        }}
                      />
                    ) : (
                      <div className={`ro ${val ? '' : 'empty'}`}>{val || '—'}</div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="decision">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <b style={{ fontSize: 12.5 }}>Director 决策闭环 Decision</b>
                <span className={`dstat ${dcls}`}>{dtxt}</span>
                {u.dBy && <span style={{ fontSize: 11, color: 'var(--faint)' }} className="mono">{u.dBy} · {u.dDate}</span>}
              </div>
              {isDirector ? (
                <>
                  <div className="k">批复 Decision</div>
                  <textarea
                    defaultValue={u.dDecision || ''}
                    placeholder="Director 的决定 / 指示…"
                    onBlur={(e) => {
                      if (e.target.value !== (u.dDecision || '')) dispatch(p.id, { type: 'setDecision', field: 'dDecision', value: e.target.value });
                    }}
                  />
                  <div style={{ marginTop: 8 }}>
                    <span className="k" style={{ display: 'inline' }}>状态 Status</span>{' '}
                    <select
                      value={u.dStatus || 'pending'}
                      onChange={(e) => dispatch(p.id, { type: 'setDecision', field: 'dStatus', value: e.target.value })}
                    >
                      {Object.entries(DS).map(([k, v]) => <option key={k} value={k}>{v[1]}</option>)}
                    </select>
                  </div>
                </>
              ) : (
                <div className={`ro ${u.dDecision ? '' : 'empty'}`}>{u.dDecision || '（尚无批复）'}</div>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
