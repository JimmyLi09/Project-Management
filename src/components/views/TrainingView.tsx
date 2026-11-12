'use client';

/* ===== REQ-062 · 新人培训 =====
   页签(按身份出现):
   - 我的培训:新人主线 + 业务路径的关卡(学员);最下面「其他培训」= REQ-036 的老路径,功能不变
   - 待我评估:带教人、PD / BD
   - 能力矩阵:PD / BD(全部)、带教人(自己和带的人)、PM(只看自己);其他角色没有
   - 路径与评分表:PD / BD 编辑;带教人维护题库;PM 可以看
   - 6 个月课程:PD / BD、带教人、名单里的人
   - 其他培训管理:REQ-036 的路径管理(PD / BD;Senior PM / PM Director 只改题目)
   数据都从 /api/train 一次拿(这个人能看到的范围由后端定),操作走 POST /api/train。 */
import React, { useCallback, useEffect, useState } from 'react';
import { useLang } from '@/lib/i18n';
import LegacyTraining from './TrainingLegacy';
import MyTraining from './training/Mine';
import Review from './training/Review';
import Matrix from './training/Matrix';
import Paths from './training/Paths';
import Courses from './training/Courses';
import type { Bundle } from './training/shared';

type Tab = 'mine' | 'review' | 'matrix' | 'paths' | 'courses' | 'legacy';

export default function TrainingView() {
  const { t } = useLang();
  const [b, setB] = useState<Bundle | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('mine');
  const load = useCallback(async () => {
    const r = await fetch('/api/train');
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error || t('加载失败', 'Could not load')); return; }
    setB(await r.json());
  }, [t]);
  useEffect(() => { load(); }, [load]);

  if (err) return <div className="panel" style={{ padding: 30, color: 'var(--danger)' }}>{err}</div>;
  if (!b) return <div className="panel" style={{ padding: 34, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>{t('加载中…', 'Loading…')}</div>;

  const reviewer = b.me.admin || b.me.mentees.length > 0;
  const inCourse = b.config.courses.some((c) => c.participants.includes(b.me.name));
  const tabs: [Tab, string, number?][] = [
    ['mine', t('我的培训', 'My training')],
    ...(reviewer ? [['review', t('待我评估', 'To assess'), b.queue.length] as [Tab, string, number]] : []),
    ...(b.me.matrix ? [['matrix', t('能力矩阵', 'Competency matrix')] as [Tab, string]] : []),
    ...(b.me.admin || b.me.eligible || b.me.role === 'pm' ? [['paths', t('路径与评分表', 'Paths & rubrics')] as [Tab, string]] : []),
    ...(b.me.admin || b.me.eligible || inCourse ? [['courses', t('6 个月课程', '6-month courses')] as [Tab, string]] : []),
    ...(b.me.admin || b.me.quiz ? [['legacy', t('其他培训管理', 'Other training (manage)')] as [Tab, string]] : []),
  ];
  const cur = tabs.some(([k]) => k === tab) ? tab : 'mine';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="detail-tabs" style={{ borderTop: 'none' }}>
        {tabs.map(([k, label, n]) => (
          <button key={k} className={`detail-tab${cur === k ? ' active' : ''}`} data-testid={`tr-tab-${k}`} onClick={() => setTab(k)}>
            {label}{n ? <span className="badge tnum" style={{ marginLeft: 6, background: 'var(--navy900)', color: '#fff', padding: '1px 7px', fontSize: 11 }}>{n}</span> : null}
          </button>
        ))}
      </div>
      {cur === 'mine' && <MyTraining b={b} onData={setB} legacy={<LegacyTraining only="mine" />} />}
      {cur === 'review' && <Review b={b} onData={setB} />}
      {cur === 'matrix' && <Matrix b={b} onData={setB} />}
      {cur === 'paths' && <Paths b={b} onData={setB} />}
      {cur === 'courses' && <Courses b={b} onData={setB} />}
      {cur === 'legacy' && <LegacyTraining only="admin" />}
    </div>
  );
}
