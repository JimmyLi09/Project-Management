'use client';

/* ===== REQ-062 · 待我评估(带教人、PD / BD) =====
   学员提交的实操签核、已约的讲解和模拟演练、待定级的新人、课程考核;下面「超过建议时间」;
   最下面「我带的人」:看每个人的关卡,不用提交的实操(面谈、跟会议)可以直接签核,可以开下一级业务路径。
   只能评估自己带的人(PD / BD 可以代打),后端同样判。 */
import React, { useMemo, useState } from 'react';
import { useLang } from '@/lib/i18n';
import { useStore } from '../../store';
import { ASSIST, LEVELS, TRAIN_BIZ, TRAIN_BIZ_KEYS, bizLabel, rubricResult } from '@/lib/train';
import { StageDetail, StageGrid, PersonHeader } from './Mine';
import { findStep, stageLabel, trainAct, type Bundle, type QueueItem } from './shared';

function ScoreForm({ items, pass, onSubmit }: { items: { zh: string; en: string }[]; pass: { avg: number; min: number }; onSubmit: (scores: { s: number; c: string }[], comment: string) => void }) {
  const { lang, t } = useLang();
  const [sc, setSc] = useState<{ s: number; c: string }[]>(items.map(() => ({ s: 0, c: '' })));
  const [comment, setComment] = useState('');
  const r = rubricResult(sc.map((x) => x.s), pass);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }} data-testid="score-form">
      {items.map((it, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 1fr', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12.5 }}>{lang === 'zh' ? it.zh : it.en || it.zh}</span>
          <select className="in sm" value={sc[i].s || ''} data-testid="score-item" data-i={i} onChange={(e) => setSc(sc.map((x, k) => (k === i ? { ...x, s: Number(e.target.value) } : x)))}>
            <option value="">—</option>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <input className="in sm" value={sc[i].c} placeholder={t('这一项的评语(选填)', 'Comment on this item (optional)')} onChange={(e) => setSc(sc.map((x, k) => (k === i ? { ...x, c: e.target.value } : x)))} />
        </div>
      ))}
      <input className="in sm" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('总评(选填)', 'Overall comment (optional)')} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {r.valid && <span data-testid="score-preview" style={{ fontSize: 12.5, fontWeight: 700, color: r.passed ? '#0f6a48' : '#98342b' }}>
          {t('平均', 'Average')} {(Math.round(r.avg * 10) / 10).toFixed(1)} · {r.passed ? t('通过', 'Pass') : t('未通过', 'Not passed')}
          <span style={{ fontWeight: 400, color: 'var(--text2)' }}> ({t(`平均 ≥ ${pass.avg} 且没有一项低于 ${pass.min}`, `average ≥ ${pass.avg} and no item below ${pass.min}`)})</span>
        </span>}
        <div style={{ flex: 1 }} />
        <button className="btn-navy sm" disabled={!r.valid} data-testid="score-submit" onClick={() => onSubmit(sc, comment)}>{t('提交评分', 'Submit scores')}</button>
      </div>
    </div>
  );
}

function PlacementForm({ q, onSubmit }: { q: QueueItem; onSubmit: (bizs: string[], levels: Record<string, number>, comment: string) => void }) {
  const { lang, t } = useLang();
  const [bizs, setBizs] = useState<string[]>([]);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const n = bizs.length;
  const selfName = (v?: string) => ({ none: t('没做过', 'never'), done: t('做过', 'done it'), led: t('独立带过', 'led it') } as Record<string, string>)[v || 'none'];
  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="placement-form">
      {!q.ready && <div style={{ fontSize: 12, color: '#98342b' }}>{t('学员还没做完自评问卷 / 面谈,先完成学习步骤才能定级。', 'The self-assessment / interview is not finished yet — finish the learning steps first.')}</div>}
      <div style={{ fontSize: 12, color: 'var(--text2)' }}>{t('选 2 – 3 个新人期要带的业务;起步级别最高「可协助」(到「可独立」要在 Audax 独立带过项目并复盘)。', 'Pick 2 – 3 services; the starting level can go up to “Can assist” (Independent needs a project run and reviewed at Audax).')}</div>
      {TRAIN_BIZ.map((b) => {
        const on = bizs.includes(b.key);
        return (
          <div key={b.key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 190, cursor: 'pointer' }}>
              <input type="checkbox" checked={on} data-testid="pl-biz" data-biz={b.key} disabled={!on && n >= 3}
                onChange={() => setBizs(on ? bizs.filter((x) => x !== b.key) : [...bizs, b.key])} />
              {lang === 'zh' ? b.zh : b.en}
            </label>
            <span style={{ fontSize: 11.5, color: 'var(--text2)', minWidth: 90 }}>{t('自评:', 'Self: ')}{selfName(q.self?.[b.key])}</span>
            {on && (
              <select className="in sm" value={levels[b.key] ?? 0} data-testid="pl-level" data-biz={b.key} onChange={(e) => setLevels({ ...levels, [b.key]: Number(e.target.value) })}>
                {LEVELS.filter((l) => l.v <= ASSIST).map((l) => <option key={l.v} value={l.v}>{lang === 'zh' ? l.zh : l.en}</option>)}
              </select>
            )}
          </div>
        );
      })}
      <input className="in sm" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('面谈记录 / 说明(选填)', 'Interview notes (optional)')} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: n < 2 || n > 3 ? '#98342b' : 'var(--text2)' }}>{t(`已选 ${n} 个(要 2 – 3 个)`, `${n} chosen (2 – 3 needed)`)}</span>
        <div style={{ flex: 1 }} />
        <button className="btn-navy sm" data-testid="pl-save" disabled={!q.ready || n < 2 || n > 3}
          onClick={() => onSubmit(bizs, Object.fromEntries(bizs.map((k) => [k, levels[k] ?? 0])), comment)}>{t('保存定级', 'Save placement')}</button>
      </div>
    </div>
  );
}

export default function Review({ b, onData }: { b: Bundle; onData: (b: Bundle) => void }) {
  const { lang, t } = useLang();
  const { setToast, allProjects } = useStore();
  const [openQ, setOpenQ] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [who, setWho] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [newBiz, setNewBiz] = useState('');
  const run = async (body: Record<string, unknown>) => {
    const r = await trainAct(body);
    if (!r.ok) { setToast(r.error); return false; }
    onData(r.data); setOpenQ(null); setComment('');
    return true;
  };
  const projName = (id?: string) => allProjects.find((p) => p.id === id)?.name || id || '';
  const qid = (q: QueueItem) => `${q.kind}:${q.user}:${q.key}:${q.id || ''}`;
  const kindName = (k: string) => ({ task: t('实操签核', 'Task sign-off'), present: t('讲解', 'Presentation'), sim: t('模拟演练', 'Simulation'), placement: t('定级', 'Placement'), cexam: t('课程考核', 'Course assessment') } as Record<string, string>)[k] || k;
  const person = b.people.find((p) => p.user === who) || null;
  const cur = person?.stages.find((s) => s.key === sel) || person?.stages.find((s) => s.status === 'open') || person?.stages[0] || null;
  const mine = useMemo(() => b.people.filter((p) => b.me.admin || b.me.mentees.includes(p.user)), [b]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel clip" data-testid="review-queue">
        <div className="panel-head"><span className="panel-title">{t('待我评估', 'Waiting for my assessment')} ({b.queue.length})</span></div>
        {b.queue.length === 0 && <div style={{ padding: 22, fontSize: 13, color: 'var(--text2)' }}>{t('没有待评估的事项。', 'Nothing to assess.')}</div>}
        {b.queue.map((q) => {
          const id = qid(q);
          const step = q.kind === 'cexam' ? null : findStep(b.config, q.key);
          const course = q.kind === 'cexam' ? b.config.courses.find((c) => c.id === q.stage) : null;
          const rubric = step?.rubric ? b.config.rubrics[step.rubric] : course?.exam === 'rubric' ? b.config.rubrics.present : null;
          return (
            <div key={id} data-testid="queue-item" data-kind={q.kind} data-user={q.user} style={{ padding: '12px 18px', borderTop: '1px solid var(--row-line)' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="badge" style={{ background: '#fbf0dc', color: '#a8690b' }}>{kindName(q.kind)}</span>
                <b style={{ fontSize: 13.5 }}>{q.user}</b>
                <span style={{ fontSize: 13 }}>{lang === 'zh' ? q.title.zh : q.title.en || q.title.zh}</span>
                {q.at > 0 && <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{new Date(q.at).toLocaleDateString()}</span>}
                <div style={{ flex: 1 }} />
                <button className="btn-line sm" data-testid="queue-open" onClick={() => { setOpenQ(openQ === id ? null : id); setComment(''); }}>{openQ === id ? t('收起', 'Close') : q.kind === 'task' ? t('签核', 'Review') : q.kind === 'placement' ? t('填定级', 'Place') : t('打分', 'Score')}</button>
              </div>
              {q.kind === 'task' && (q.note || q.project) && (
                <div style={{ fontSize: 12.5, marginTop: 6, color: 'var(--text)' }}>{q.note}{q.project ? <span style={{ color: 'var(--text2)' }}> · {t('项目', 'Project')}:{projName(q.project)}</span> : null}</div>
              )}
              {openQ === id && q.kind === 'task' && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <input className="in sm" style={{ flex: 1, minWidth: 220 }} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('评语(选填)', 'Comment (optional)')} data-testid="task-comment" />
                  <button className="btn-navy sm" data-testid="task-approve" onClick={() => run({ op: 'reviewTask', id: q.id, ok: true, comment })}>✓ {t('通过', 'Approve')}</button>
                  <button className="btn-line sm danger" data-testid="task-return" onClick={() => run({ op: 'reviewTask', id: q.id, ok: false, comment })}>↩ {t('退回', 'Return')}</button>
                </div>
              )}
              {openQ === id && (q.kind === 'present' || q.kind === 'sim') && rubric && (
                <ScoreForm items={rubric.items} pass={b.config.pass} onSubmit={(scores, c) => run({ op: 'score', id: q.id, scores, comment: c })} />
              )}
              {openQ === id && q.kind === 'placement' && (
                <PlacementForm q={q} onSubmit={(bizs, levels, c) => run({ op: 'placement', user: q.user, bizs, levels, comment: c })} />
              )}
              {openQ === id && q.kind === 'cexam' && course && (course.exam === 'rubric' && rubric
                ? <ScoreForm items={rubric.items} pass={b.config.pass} onSubmit={(scores, c) => run({ op: 'courseExam', course: course.id, user: q.user, scores, comment: c })} />
                : <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <input className="in sm" style={{ flex: 1 }} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('评语(选填)', 'Comment (optional)')} />
                    <button className="btn-navy sm" onClick={() => run({ op: 'courseExam', course: course.id, user: q.user, passed: true, comment })}>✓ {t('通过', 'Pass')}</button>
                    <button className="btn-line sm danger" onClick={() => run({ op: 'courseExam', course: course.id, user: q.user, passed: false, comment })}>✗ {t('未通过', 'Not passed')}</button>
                  </div>)}
            </div>
          );
        })}
      </div>

      <div className="panel clip" data-testid="overdue-list">
        <div className="panel-head"><span className="panel-title">{t('超过建议时间', 'Past the suggested date')} ({b.overdue.length})</span><span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{t('只提醒,不自动判不通过;学员在「我的培训」里也看得到', 'A reminder only — nothing fails automatically; learners see it in My training too')}</span></div>
        {b.overdue.length === 0 && <div style={{ padding: 18, fontSize: 12.5, color: 'var(--text2)' }}>{t('没有超时的关。', 'Nothing overdue.')}</div>}
        {b.overdue.map((o) => (
          <div key={o.user + o.stage} data-testid="overdue-row" style={{ display: 'flex', gap: 10, padding: '10px 18px', borderTop: '1px solid var(--row-line)', fontSize: 13, alignItems: 'center' }}>
            <b>{o.user}</b><span>{lang === 'zh' ? `关 ${o.sid.slice(1)} · ${o.title.zh}` : `Stage ${o.sid.slice(1)} · ${o.title.en || o.title.zh}`}{o.track !== 'main' ? ` · ${bizLabel(o.track, lang)}` : ''}</span>
            <div style={{ flex: 1 }} />
            <span className="badge" style={{ background: '#fdecea', color: '#98342b' }}>{t(`已超 ${o.days} 天`, `${o.days} days late`)}</span>
          </div>
        ))}
      </div>

      <div className="panel clip">
        <div className="panel-head"><span className="panel-title">{b.me.admin ? t('在培训里的人', 'People in training') : t('我带的人', 'People I mentor')}</span></div>
        <div style={{ display: 'flex', gap: 6, padding: '10px 14px', flexWrap: 'wrap' }}>
          {mine.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>{t('还没有。', 'None yet.')}</span>}
          {mine.map((p) => (
            <button key={p.user} className={`chip ${who === p.user ? 'active' : ''}`} data-testid="mentee" onClick={() => { setWho(p.user); setSel(null); }}>{p.user}</button>
          ))}
        </div>
      </div>
      {person && (
        <>
          <PersonHeader v={person} />
          <div className="panel" style={{ padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>{t('开下一级业务路径(新人期之外加开业务):', 'Open another service track (outside the induction): ')}</span>
            <select className="in sm" value={newBiz} onChange={(e) => setNewBiz(e.target.value)} data-testid="open-track-biz">
              <option value="">{t('— 选业务 —', '— service —')}</option>
              {TRAIN_BIZ_KEYS.filter((k) => !person.tracks.includes(k)).map((k) => <option key={k} value={k}>{bizLabel(k, lang)}</option>)}
            </select>
            <button className="btn-line sm" disabled={!newBiz} data-testid="open-track" onClick={async () => { if (await run({ op: 'openTrack', user: person.user, biz: newBiz })) setNewBiz(''); }}>＋ {t('开路径', 'Open track')}</button>
          </div>
          <StageGrid v={person} sel={cur?.key || null} onSel={setSel} />
          {cur && (
            <>
              <StageDetail v={person} s={cur} b={b} readOnly onData={onData} />
              {cur.status === 'open' && cur.steps.filter((st) => st.def.kind === 'task' && !st.def.project && st.state !== 'done').map((st) => (
                <div key={st.key} className="panel" style={{ padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12.5 }}>{stageLabel(cur, lang)} · <b>{lang === 'zh' ? st.def.zh : st.def.en}</b></span>
                  <div style={{ flex: 1 }} />
                  <input className="in sm" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('评语(选填)', 'Comment (optional)')} />
                  <button className="btn-navy sm" data-testid="sign-task" data-key={st.key} onClick={() => run({ op: 'signTask', user: person.user, key: st.key, comment })}>✓ {t('直接签核', 'Sign off')}</button>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
