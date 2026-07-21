'use client';

import React, { useState } from 'react';
import { useStore } from '../store';
import { infoProgress, projectHealth, schedProgress, isoDate } from '@/lib/project';
import { canCreate, canEdit } from '@/lib/permissions';
import { DIFF, SVC, svcColor } from '@/lib/templates';
import { HealthTag, StageTag, SvcTag } from './parts';

export default function ProjectsView() {
  const { projects, me, openProject } = useStore();
  const [showNew, setShowNew] = useState(false);

  return (
    <>
      <div className="page-head"><h1>项目卡片</h1><span className="en">PROJECTS</span></div>
      <p className="sub">{canCreate(me) ? '你可以创建项目。' : '仅销售 / PD / BD 可创建项目;你可编辑被指派的项目。'}</p>
      <div className="grid">
        {projects.map((p) => {
          const sp = schedProgress(p);
          const ip = infoProgress(p);
          const h = projectHealth(p);
          const ed = canEdit(me, p);
          const primary = svcColor(p.services[0]);
          return (
            <div key={p.id} className="card" onClick={() => openProject(p.id)}>
              <div className="cstripe" style={{ background: primary }} />
              <div className="body">
                <h3>{p.name}</h3>
                <div className="client">
                  {p.client || '—'} · 负责 {(p.owners || []).join(', ') || '—'}{ed ? '' : ' · 只读'}
                </div>
                <div className="row1">
                  {p.services.slice(0, 3).map((k) => <SvcTag key={k} k={k} />)}
                  <StageTag p={p} />
                  <HealthTag h={h} />
                </div>
                <div className="metrics">
                  <div className="metric">
                    <div className="lab">排期</div>
                    <div className="bar"><i style={{ width: `${sp.pct}%`, background: primary }} /></div>
                    <div className="pct">{sp.done}/{sp.total}·{sp.pct}%</div>
                  </div>
                  <div className="metric">
                    <div className="lab">信息</div>
                    <div className="bar"><i style={{ width: `${ip.pct}%`, background: '#2C6E8F' }} /></div>
                    <div className="pct">{ip.done}/{ip.total}·{ip.pct}%</div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {canCreate(me) && (
          <button className="newcard" onClick={() => setShowNew(true)}>
            <div><div className="plus">+</div>新建项目 New Project</div>
          </button>
        )}
      </div>
      {showNew && <NewProjectModal onClose={() => setShowNew(false)} />}
    </>
  );
}

function NewProjectModal({ onClose }: { onClose: () => void }) {
  const { me, users, createProject, openProject } = useStore();
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
        <h2>新建项目 New Project</h2>
        <div className="msub">选择一个或多个服务;含模板的服务会自动生成排期与清单,其余用通用模板。</div>
        <div className="field">
          <label>项目名称 Project name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例:Dunearn Road Condo" autoFocus />
        </div>
        <div className="field">
          <label>服务(可多选) Services</label>
          <div className="svc-multi">
            {Object.entries(SVC).map(([k, v]) => (
              <button key={k} className={`svc-opt ${services.includes(k) ? 'sel' : ''}`} onClick={() => toggleSvc(k)}>
                <span className="sq" style={{ background: v.color }} />{v.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>客户 Client</label>
          <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="developer / 客户" />
        </div>
        <div className="two">
          <div className="field"><label>总包 Main contractor</label><input value={mainContractor} onChange={(e) => setMainContractor(e.target.value)} /></div>
          <div className="field"><label>建筑师 Architect</label><input value={architect} onChange={(e) => setArchitect(e.target.value)} /></div>
          <div className="field"><label>景观师 Landscape Architect</label><input value={landscape} onChange={(e) => setLandscape(e.target.value)} /></div>
          <div className="field"><label>室内设计 Interior Designer</label><input value={interior} onChange={(e) => setInterior(e.target.value)} /></div>
          <div className="field"><label>创意代理 Creative agency</label><input value={creative} onChange={(e) => setCreative(e.target.value)} /></div>
          <div className="field">
            <label>负责 PM(逗号分隔多人)</label>
            <input value={owners} onChange={(e) => setOwners(e.target.value)} placeholder={pmNames.slice(0, 2).join(', ') || '张三, 李四'} list="pm-names" />
            <datalist id="pm-names">{pmNames.map((n) => <option key={n} value={n} />)}</datalist>
          </div>
        </div>
        <div className="two">
          <div className="field">
            <label>难度 Difficulty</label>
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              {Object.entries(DIFF).map(([k, v]) => <option key={k} value={k}>{v[0]} · {v[1]}分</option>)}
            </select>
          </div>
          <div className="field"><label>起始日期(=最终信息确认日)</label><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div className="field"><label>交付日 Required delivery(可空)</label><input type="date" value={delivery} onChange={(e) => setDelivery(e.target.value)} /></div>
          <div className="field"><label>Buffer 天(留白)</label><input type="number" min={0} value={buffer} onChange={(e) => setBuffer(parseInt(e.target.value) || 0)} /></div>
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>取消</button>
          <button className="btn" onClick={submit} disabled={busy}>{busy ? '创建中…' : '创建 Create'}</button>
        </div>
      </div>
    </div>
  );
}
