'use client';

import React, { useState } from 'react';
import { useStore } from '../store';
import {
  deliverySlack, fmtDate, infoProgress, nextFreeze, overdueItems, parseISO,
  plannedFinish, projPoints, projStage, schedProgress, stageName,
} from '@/lib/project';
import { canAssign, canCommercial, canEdit, canMeta, isFull } from '@/lib/permissions';
import { DIFF, STAGES, stageColor, stageIdx, svcColor, svcLabel } from '@/lib/templates';
import ScheduleTab from './ScheduleTab';
import ChecklistTab from './ChecklistTab';
import ExportOverlay from './ExportOverlay';
import type { Project } from '@/lib/types';

export default function ProjectDetail() {
  const { projects, view, setView, me, dispatch, removeProject, go, users } = useStore();
  const [showExport, setShowExport] = useState(false);
  const p = projects.find((x) => x.id === view.pid);
  if (!p) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
        项目加载中… <a className="back" onClick={() => go('board')}>← 返回看板</a>
      </div>
    );
  }

  const ed = canEdit(me, p);
  const tab = view.tab || 'overview';
  const pkgIdx = Math.min(view.pkg || 0, p.packages.length - 1);
  const curStage = projStage(p);
  const ci = stageIdx(curStage);
  const pr = p.parties || ({} as Project['parties']);
  const parties = ([
    ['总包', pr.mainContractor], ['建筑师', pr.architect], ['景观师', pr.landscape],
    ['室内设计', pr.interior], ['创意代理', pr.creative],
  ] as [string, string][]).filter((x) => x[1]);

  const setTab = (t: 'overview' | 'schedule' | 'checklist') => setView({ ...view, tab: t });
  const setPkg = (i: number) => setView({ ...view, pkg: i });

  const pmUsers = users.filter((u) => u.role === 'pm' || u.role === 'member');

  return (
    <>
      <a className="back" onClick={() => go('board')}>← 返回看板</a>
      <div className="pv-head">
        <h1>{p.name}</h1>
        {p.services.map((k) => (
          <span key={k} className="svc" style={{ background: `${svcColor(k)}1a`, color: svcColor(k) }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: svcColor(k), marginRight: 4 }} />
            {svcLabel(k)}
          </span>
        ))}
        <span className="client">{p.client || '—'}{p.start ? ' · 起 ' + fmtDate(parseISO(p.start)) : ''}</span>
        <div style={{ flex: 1 }} />
        <button className="btn ghost sm" onClick={() => setShowExport(true)}>导出 Export</button>
        {isFull(me) && (
          <button
            className="btn danger sm"
            onClick={async () => {
              if (confirm('确认删除此项目?对所有协作成员生效。')) {
                if (await removeProject(p.id)) go('board');
              }
            }}
          >
            删除
          </button>
        )}
      </div>
      <div className="stepper">
        {STAGES.map((s, i) => (
          <div key={s[0]} className={`step ${i < ci ? 'done' : i === ci ? 'cur' : ''}`}>
            {s[1]}<small>{s[2]}</small>
          </div>
        ))}
      </div>
      <div className="step-note">
        阶段跟随进展自动更新:指派PM→交接;开始制作→进行中;全部完成→完成。
        {curStage === 'complete' && canCommercial(me, p) && (
          <button className="btn ghost sm" onClick={() => dispatch(p.id, { type: 'toggleInvoiced' })}>标记「开票/收尾」</button>
        )}
        {p.invoiced && canCommercial(me, p) && (
          <button className="btn ghost sm" onClick={() => dispatch(p.id, { type: 'toggleInvoiced' })}>撤销开票</button>
        )}
      </div>
      {parties.length > 0 && (
        <div className="meta-line">
          {parties.map((x) => <span key={x[0]}><span className="k">{x[0]}</span>{x[1]}</span>)}
        </div>
      )}
      {canAssign(me, p) && (
        <div className="access">
          <div>
            <span className="k" style={{ fontFamily: 'var(--mono)' }}>负责 PM</span>{' '}
            {(p.owners || []).length === 0 && <span style={{ color: 'var(--faint)' }}>未指派</span>}
            {(p.owners || []).map((n) => (
              <span key={n} className="chipname">
                {n} <button onClick={() => dispatch(p.id, { type: 'removeOwner', name: n })}>✕</button>
              </span>
            ))}
            <button
              className="btn ghost sm"
              onClick={() => {
                const hint = pmUsers.map((u) => u.name).join(' / ');
                const nm = prompt(`指派 PM 的名字:${hint ? `\n(已有账号: ${hint})` : ''}`);
                if (nm && nm.trim()) dispatch(p.id, { type: 'addOwner', name: nm.trim() });
              }}
            >
              + 指派 PM
            </button>
          </div>
          <div>
            <span className="k" style={{ fontFamily: 'var(--mono)' }}>难度</span>{' '}
            <select
              value={p.difficulty}
              onChange={(e) => dispatch(p.id, { type: 'setDiff', value: e.target.value })}
              style={{ padding: '5px 8px', border: '1px solid var(--line)', borderRadius: 7 }}
            >
              {Object.entries(DIFF).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}
            </select>
          </div>
          <div>
            <span className="k" style={{ fontFamily: 'var(--mono)' }}>积分(PD/BD制定)</span>{' '}
            <input
              type="number" min={0} defaultValue={projPoints(p)} key={projPoints(p)}
              onBlur={(e) => { const v = parseInt(e.target.value) || 0; if (v !== projPoints(p)) dispatch(p.id, { type: 'setPoints', value: v }); }}
              style={{ width: 70, padding: '5px 8px', border: '1px solid var(--line)', borderRadius: 7 }}
            />{' '}
            <span style={{ color: 'var(--faint)', fontSize: 11 }}>默认=难度×服务数</span>
          </div>
        </div>
      )}
      {!ed && (
        <div className="ro-note">
          {me.role === 'sales'
            ? '🔓 销售视角:可编辑「售前 Presales / 开票 Invoice」阶段与商业信息;生产内容可查看但不可编辑,也不参与人员安排。'
            : me.role === 'member'
            ? '🔒 团队成员:仅可勾选指派给你(👤)的任务。'
            : '🔒 你对此项目为只读(服务端按角色强制)。'}
        </div>
      )}
      <div className="tabs">
        <button className={`tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>概览 Overview</button>
        <button className={`tab ${tab === 'schedule' ? 'active' : ''}`} onClick={() => setTab('schedule')}>排期 Schedule</button>
        <button className={`tab ${tab === 'checklist' ? 'active' : ''}`} onClick={() => setTab('checklist')}>信息清单 Checklist</button>
      </div>
      {p.packages.length > 1 && (tab === 'schedule' || tab === 'checklist') && (
        <div className="pill-bar">
          {p.packages.map((pk, i) => (
            <button
              key={i}
              className={`pill ${i === pkgIdx ? 'sel' : ''}`}
              style={i === pkgIdx ? { background: svcColor(pk.svc), borderColor: svcColor(pk.svc), color: '#fff' } : undefined}
              onClick={() => setPkg(i)}
            >
              {svcLabel(pk.svc)}
            </button>
          ))}
        </div>
      )}
      {tab === 'overview' && <OverviewTab p={p} />}
      {tab === 'schedule' && <ScheduleTab p={p} pkgIdx={pkgIdx} onExport={() => setShowExport(true)} />}
      {tab === 'checklist' && <ChecklistTab p={p} pkgIdx={pkgIdx} onExport={() => setShowExport(true)} />}
      {showExport && <ExportOverlay p={p} onClose={() => setShowExport(false)} />}
    </>
  );
}

function OverviewTab({ p }: { p: Project }) {
  const sp = schedProgress(p);
  const ip = infoProgress(p);
  const od = overdueItems(p);
  const nf = nextFreeze(p);
  const primary = svcColor(p.services[0]);
  const slack = deliverySlack(p);
  const fin = plannedFinish(p);
  const sn = stageName(p);
  const [logOpen, setLogOpen] = useState(false);
  const log = p.log || [];

  return (
    <>
      <div className="ov-hero">
        <div className="hero-main">
          <div className="hero-lab">总进度 Overall</div>
          <div className="hero-pct" style={{ color: primary }}>{sp.pct}<small>%</small></div>
          <div className="bar" style={{ maxWidth: 280, marginTop: 8 }}><i style={{ width: `${sp.pct}%`, background: primary }} /></div>
          <div className="mono" style={{ color: 'var(--muted)', marginTop: 6, fontSize: 12 }}>
            {sp.done}/{sp.total} 阶段 · {p.packages.length} 个服务
          </div>
        </div>
        <div className="hero-side">
          <div className="hero-stage" style={{ background: stageColor(projStage(p)) }}>
            <span>当前阶段 Stage</span><b>{sn[1]}</b><small>{sn[2]}</small>
          </div>
          <div className="hero-mini">
            <div><div className="hero-lab">信息确认</div><div className="mini-num">{ip.pct}%</div></div>
            <div><div className="hero-lab">逾期</div><div className="mini-num" style={{ color: od.length ? 'var(--red)' : 'var(--green)' }}>{od.length}</div></div>
            <div><div className="hero-lab">积分</div><div className="mini-num">{projPoints(p)}</div></div>
          </div>
        </div>
      </div>
      <div className="ov-oneline">
        {slack === null
          ? <>计划完成 <b>{fin ? fmtDate(fin) : '—'}</b> · 未设交付日</>
          : slack >= 0
          ? <>计划完成 <b>{fmtDate(fin)}</b> · <b style={{ color: 'var(--green)' }}>交付富余 {slack} 天</b></>
          : <>计划完成 <b>{fmtDate(fin)}</b> · <b style={{ color: 'var(--red)' }}>交付超出 {-slack} 天</b></>}
        {' '}&nbsp;·&nbsp;{' '}
        {od.length
          ? <span style={{ color: 'var(--red)', fontWeight: 700 }}>⚠ {od.length} 个阶段逾期 — 详见「排期」</span>
          : nf
          ? <>下一冻结点 <b>{nf.row.phase}{p.packages.length > 1 ? `(${svcLabel(nf.svc)})` : ''}</b>{nf.date ? ' · ' + fmtDate(nf.date) : ''}</>
          : <span style={{ color: 'var(--green)', fontWeight: 700 }}>✓ 无逾期,冻结点已清</span>}
      </div>
      <div className="actlog">
        <div className="ah" onClick={() => setLogOpen(!logOpen)}>
          🕓 操作记录 Activity log
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)' }}>
            最近 {Math.min(log.length, 12)} / {log.length}
          </span>
        </div>
        {logOpen && (
          log.length === 0
            ? <div className="arow" style={{ color: 'var(--faint)' }}>暂无操作记录</div>
            : log.slice(0, 12).map((e, i) => (
                <div key={i} className="arow">
                  <span className="who">{e.by}</span>
                  <span>{e.text}</span>
                  <span className="tm">{fmtDate(new Date(e.at))} {new Date(e.at).toTimeString().slice(0, 5)}</span>
                </div>
              ))
        )}
      </div>
    </>
  );
}
