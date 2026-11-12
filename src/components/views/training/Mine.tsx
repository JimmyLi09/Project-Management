'use client';

/* ===== REQ-062 · 我的培训(学员) =====
   上面:关 0、关 1 两个框;下面每个所选业务一行、关 2 – 4 三个框(已过关 / 定级免修 / 进行中 / 未解锁)。
   点一个框看这一关的学习步骤和过关评估。未解锁的关只能看,不能提交;学习步骤做完才能约评估 / 开始测验。
   带教人 / PD / BD 看学员时也用这一套(readOnly,操作在「待我评估」里)。 */
import React, { useEffect, useMemo, useState } from 'react';
import { useLang } from '@/lib/i18n';
import { useStore } from '../../store';
import Markdown from '../../Markdown';
import KbReader from '../../KbReader';
import { TRAIN_BIZ, bizLabel, type PersonView, type StageView, type StepView } from '@/lib/train';
import type { KbDoc } from '@/lib/kb';
import type { QuizQuestion } from '@/lib/training';
import { KindTag, LvBadge, ScoreLine, StatusTag, fmtDay, stageLabel, stepStateText, trainAct, type Bundle } from './shared';

export function StageGrid({ v, sel, onSel }: { v: PersonView; sel: string | null; onSel: (key: string) => void }) {
  const { lang, t } = useLang();
  const main = v.stages.filter((s) => s.track === 'main');
  const box = (s: StageView) => (
    <button key={s.key} onClick={() => onSel(s.key)} data-testid="stage-box" data-key={s.key} data-status={s.status}
      style={{ flex: 1, minWidth: 150, textAlign: 'left', padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
        border: sel === s.key ? '2px solid var(--navy900)' : '1px solid var(--border)', background: s.status === 'locked' ? '#faf9f6' : '#fff', opacity: s.status === 'locked' ? 0.75 : 1 }}>
      <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>{lang === 'zh' ? `关 ${s.sid.slice(1)}` : `Stage ${s.sid.slice(1)}`}{s.due ? ` · ${t('建议', 'by')} ${fmtDay(s.due)}` : ''}</div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--navy900)', margin: '3px 0 6px' }}>{lang === 'zh' ? s.def.zh : s.def.en || s.def.zh}</div>
      <StatusTag s={s} />
    </button>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {main.length > 0 && (
        <div className="panel" style={{ padding: '12px 14px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>{t('新人主线(所有人都一样)', 'Main track (the same for everyone)')}</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{main.map(box)}</div>
        </div>
      )}
      {v.tracks.map((biz) => {
        const ss = v.stages.filter((s) => s.track === biz);
        return (
          <div key={biz} className="panel" style={{ padding: '12px 14px' }} data-testid="track-row" data-biz={biz}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <span className="bdot" style={{ background: TRAIN_BIZ.find((b) => b.key === biz)?.color }} />
              <b style={{ fontSize: 13, color: 'var(--navy900)' }}>{bizLabel(biz, lang)}</b>
              <LvBadge v={v.levels[biz] || 0} small />
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{ss.map(box)}</div>
          </div>
        );
      })}
    </div>
  );
}

function DocPeek({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useLang();
  const [doc, setDoc] = useState<KbDoc | null>(null);
  const [reader, setReader] = useState<number | null>(null);
  useEffect(() => { fetch(`/api/kb/${id}`).then((r) => (r.ok ? r.json() : null)).then((j) => setDoc(j?.doc || null)).catch(() => {}); }, [id]);
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 860, maxHeight: '86vh', overflow: 'auto' }} data-testid="doc-peek">
        {!doc ? <div style={{ padding: 20, color: 'var(--text2)' }}>{t('加载中…', 'Loading…')}</div> : (
          <>
            <h2 style={{ marginBottom: 10 }}>{doc.title}</h2>
            {doc.body.trim() ? <Markdown src={doc.body} /> : <div style={{ color: 'var(--text2)', fontSize: 13 }}>{t('这篇没有正文,看下面的附件。', 'No body text — see the attachments below.')}</div>}
            {doc.attachments.length > 0 && (
              <div style={{ marginTop: 14, borderTop: '1px solid var(--row-line)', paddingTop: 10 }}>
                {doc.attachments.map((f, i) => (
                  <div key={f.id} style={{ padding: '4px 0' }}><button className="btn-line sm" onClick={() => setReader(i)}>👁 {f.name}</button></div>
                ))}
              </div>
            )}
          </>
        )}
        <div className="modal-actions"><button className="btn-navy" onClick={onClose} data-testid="doc-peek-close">{t('看完了', 'Done')}</button></div>
        {reader != null && doc && <KbReader files={doc.attachments} start={reader} onClose={() => setReader(null)} />}
      </div>
    </div>
  );
}

function QuizModal({ stepKey, onClose, onDone }: { stepKey: string; onClose: () => void; onDone: (b: Bundle) => void }) {
  const { t } = useLang();
  const [qs, setQs] = useState<QuizQuestion[] | null>(null);
  const [pass, setPass] = useState(80);
  const [err, setErr] = useState('');
  const [ans, setAns] = useState<Record<string, string[]>>({});
  const [res, setRes] = useState<{ score: number; right: number; total: number; passed: boolean; passScore: number } | null>(null);
  useEffect(() => {
    fetch(`/api/train/quiz?key=${encodeURIComponent(stepKey)}`).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error || 'error'); return; }
      setQs(j.questions); setPass(j.passScore);
    });
  }, [stepKey]);
  const pick = (q: QuizQuestion, k: string) => setAns((a) => {
    const cur = a[q.id] || [];
    return { ...a, [q.id]: q.kind === 'multi' ? (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]) : [k] };
  });
  async function submit() {
    const r = await trainAct({ op: 'quiz', key: stepKey, answers: ans });
    if (!r.ok) { setErr(r.error); return; }
    setRes(r.data.result as never);
    onDone(r.data);
  }
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 680, maxHeight: '86vh', overflow: 'auto' }} data-testid="quiz-modal">
        <h2>{t('测验', 'Quiz')} <span style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 400 }}>{t(`及格 ${pass} 分`, `pass mark ${pass}`)}</span></h2>
        {err && <div className="login-err">{err}</div>}
        {res ? (
          <div data-testid="quiz-result" data-passed={res.passed ? '1' : '0'} style={{ padding: 16, fontSize: 15, fontWeight: 700, color: res.passed ? '#0f6a48' : '#98342b' }}>
            {res.passed ? '✓ ' : '✗ '}{t(`${res.score} 分(答对 ${res.right} / ${res.total})`, `${res.score} (${res.right} / ${res.total} right)`)} · {res.passed ? t('通过', 'Passed') : t('没通过,可以再考', 'Not passed — you can retake it')}
          </div>
        ) : qs && qs.map((q, i) => (
          <div key={q.id} style={{ padding: '10px 0', borderTop: '1px solid var(--row-line)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{i + 1}. {q.q} {q.kind === 'multi' && <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{t('(多选)', '(multiple)')}</span>}</div>
            {q.options.map((o) => (
              <label key={o.key} style={{ display: 'flex', gap: 8, fontSize: 13, padding: '3px 0', cursor: 'pointer' }}>
                <input type={q.kind === 'multi' ? 'checkbox' : 'radio'} name={q.id} checked={(ans[q.id] || []).includes(o.key)} onChange={() => pick(q, o.key)} data-testid="quiz-opt" data-q={i} data-k={o.key} />
                {o.text}
              </label>
            ))}
          </div>
        ))}
        <div className="modal-actions">
          <button className="btn-line" onClick={onClose}>{res ? t('关闭', 'Close') : t('取消', 'Cancel')}</button>
          {!res && qs && <button className="btn-navy" onClick={submit} data-testid="quiz-submit">{t('交卷', 'Submit')}</button>}
        </div>
      </div>
    </div>
  );
}

/* 一关的详情:学习步骤 + 过关评估 */
export function StageDetail({ v, s, b, readOnly, onData }: { v: PersonView; s: StageView; b: Bundle; readOnly?: boolean; onData: (b: Bundle) => void }) {
  const { lang, t } = useLang();
  const { setToast } = useStore();
  const [peek, setPeek] = useState<string | null>(null);
  const [quiz, setQuiz] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { note: string; project: string }>>({});
  const [self, setSelf] = useState<Record<string, string>>({});
  const locked = s.status === 'locked';
  const done = s.status === 'passed' || s.status === 'exempt';
  const canDo = !readOnly && !locked && !done;
  const run = async (body: Record<string, unknown>) => {
    const r = await trainAct(body);
    if (!r.ok) { setToast(r.error); return false; }
    onData(r.data);
    return true;
  };
  const rubricOf = (st: StepView) => (st.def.rubric ? b.config.rubrics[st.def.rubric] : undefined);

  const stepRow = (st: StepView) => {
    const [txt, color] = stepStateText(st, t);
    const d = draft[st.key] || { note: '', project: '' };
    const projs = st.def.project ? b.myProjects[st.def.project].filter((p) => s.track === 'main' || p.bizs.includes(s.track)) : [];
    const gateLocked = st.gate && !s.learnDone;
    return (
      <div key={st.key} data-testid="step-row" data-key={st.key} data-state={st.state} style={{ padding: '10px 0', borderTop: '1px solid var(--row-line)' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy900)' }}>{lang === 'zh' ? st.def.zh : st.def.en || st.def.zh}</span>
          <KindTag st={st} />
          <div style={{ flex: 1 }} />
          <span data-testid="step-state" style={{ fontSize: 12, color, fontWeight: 600 }}>{txt}</span>
        </div>
        {/* 板块阅读 / 读文档:文档清单,点开就记「打开过」 */}
        {(st.def.kind === 'docset' || st.def.kind === 'doc') && (st.docs || []).length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {(st.docs || []).map((x) => (
              <button key={x.id} className="badge" data-testid="doc-open" data-read={x.read ? '1' : '0'} onClick={() => setPeek(x.id)}
                style={{ cursor: 'pointer', background: x.read ? '#e6f2ec' : 'var(--hover-bg)', color: x.read ? '#0f6a48' : 'var(--text)' }}>
                {x.read ? '✓ ' : '📄 '}{x.title || t('打开文档', 'Open the document')}
              </button>
            ))}
          </div>
        )}
        {canDo && (st.def.kind === 'docset' || st.def.kind === 'doc') && st.state === 'todo' && (
          <button className="btn-line sm" style={{ marginTop: 6 }} data-testid="step-tick" disabled={(st.docs || []).some((x) => !x.read)}
            title={(st.docs || []).some((x) => !x.read) ? t('文档都打开过才能勾', 'Open every document first') : ''}
            onClick={() => run({ op: 'mark', key: st.key, done: true })}>✓ {t('我读完了', 'I have read it')}</button>
        )}
        {/* 自评问卷 */}
        {st.def.kind === 'self' && canDo && st.state === 'todo' && (
          <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 6 }}>
            {TRAIN_BIZ.map((bz) => (
              <label key={bz.key} style={{ fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ minWidth: 110 }}>{lang === 'zh' ? bz.zh : bz.en}</span>
                <select className="in sm" value={self[bz.key] || 'none'} onChange={(e) => setSelf({ ...self, [bz.key]: e.target.value })} data-testid="self-q" data-biz={bz.key}>
                  <option value="none">{t('没做过', 'Never')}</option>
                  <option value="done">{t('做过', 'Done it')}</option>
                  <option value="led">{t('独立带过', 'Led it')}</option>
                </select>
              </label>
            ))}
            <button className="btn-navy sm" style={{ justifySelf: 'start' }} data-testid="self-submit" onClick={() => run({ op: 'mark', key: st.key, done: true, answers: self })}>{t('提交自评', 'Submit')}</button>
          </div>
        )}
        {/* 实操:写完成说明 + 关联项目 → 提交 */}
        {st.def.kind === 'task' && canDo && (st.state === 'todo' || st.state === 'returned') && (
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <textarea className="in" style={{ minHeight: 56 }} value={d.note} data-testid="task-note"
              placeholder={t('完成说明:做了什么、在哪个环节', 'What you did and where')}
              onChange={(e) => setDraft({ ...draft, [st.key]: { ...d, note: e.target.value } })} />
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {st.def.project && (
                <select className="in sm" value={d.project} onChange={(e) => setDraft({ ...draft, [st.key]: { ...d, project: e.target.value } })} data-testid="task-project">
                  <option value="">{st.def.project === 'shadow' ? t('— 关联一个你在「跟项目」的项目 —', '— link a project you shadow —') : st.def.project === 'assist' ? t('— 关联一个你在「协助」的项目 —', '— link a project you assist on —') : t('— 关联一个你负责的项目 —', '— link a project you lead —')}</option>
                  {projs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              {st.def.project && !projs.length && <span style={{ fontSize: 11.5, color: '#98342b' }}>{t('还没有可以关联的项目 —— 请带教人或 PD / BD 把你加进项目。', 'No project to link yet — ask your mentor or PD / BD to add you to one.')}</span>}
              <button className="btn-navy sm" data-testid="task-submit" disabled={!d.note.trim() || (!!st.def.project && !d.project)}
                onClick={async () => { if (await run({ op: 'submitTask', key: st.key, note: d.note, project: d.project })) setDraft({ ...draft, [st.key]: { note: '', project: '' } }); }}>
                {t('提交给带教人签核', 'Submit for sign-off')}</button>
            </div>
          </div>
        )}
        {/* 测验 */}
        {st.def.kind === 'quiz' && canDo && st.state !== 'passed' && st.state !== 'noquiz' && (
          <button className="btn-navy sm" style={{ marginTop: 6 }} disabled={gateLocked} data-testid="quiz-start"
            title={gateLocked ? t('先把这一关的学习步骤做完', 'Finish the learning steps first') : ''}
            onClick={() => setQuiz(st.key)}>✍️ {t('开始测验', 'Start the quiz')}{st.quizN ? ` · ${st.quizN} ${t('题', 'questions')}` : ''}</button>
        )}
        {/* 讲解 / 模拟演练:约评估 */}
        {(st.def.kind === 'present' || st.def.kind === 'sim') && canDo && (st.state === 'todo' || st.state === 'failed') && (
          <button className="btn-navy sm" style={{ marginTop: 6 }} disabled={gateLocked} data-testid="book"
            title={gateLocked ? t('先把这一关的学习步骤做完', 'Finish the learning steps first') : ''}
            onClick={() => run({ op: 'book', key: st.key })}>🎤 {st.state === 'failed' ? t('重新约评估', 'Book again') : t('约评估', 'Book the assessment')}</button>
        )}
        {st.def.kind === 'placement' && st.state !== 'passed' && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>{t('自评问卷和面谈完成后,由带教人填定级结果。', 'Your mentor records the placement after the self-assessment and interview.')}</div>}
        {/* 记录 */}
        {st.history.length > 0 && (
          <div style={{ marginTop: 4 }}>
            {st.history.map((a) => (a.kind === 'task'
              ? <div key={a.id} style={{ fontSize: 12, borderTop: '1px dashed var(--row-line)', paddingTop: 6, marginTop: 6 }} data-testid="task-hist" data-status={a.status}>
                  <b>{a.status === 'approved' ? t('通过', 'Approved') : a.status === 'returned' ? t('退回', 'Returned') : t('已提交', 'Submitted')}</b>
                  <span style={{ color: 'var(--text2)' }}> · {a.by} {new Date(a.at).toLocaleDateString()}{a.project ? ` · ${t('项目', 'project')} ${a.project}` : ''}</span>
                  {a.note && <div>{a.note}</div>}
                  {a.comment && <div>{t('带教人:', 'Mentor: ')}{a.comment}{a.doneBy ? ` — ${a.doneBy}` : ''}</div>}
                </div>
              : <ScoreLine key={a.id} a={a} rubric={rubricOf(st)} cfg={b.config} />))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="panel" style={{ padding: '14px 18px' }} data-testid="stage-detail" data-key={s.key}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--navy900)' }}>{stageLabel(s, lang)}</span>
        <StatusTag s={s} />
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--text2)' }}>{t('过关后:', 'After this stage: ')}{lang === 'zh' ? s.def.upZh : s.def.upEn || s.def.upZh}</span>
      </div>
      {locked && <div style={{ fontSize: 12.5, color: 'var(--text2)', padding: '6px 0' }} data-testid="locked-note">🔒 {t('还没解锁:可以先看内容,前一关过了才能提交。', 'Locked: you can read ahead, but you can only submit once the previous stage is passed.')}</div>}
      {s.status === 'exempt' && <div style={{ fontSize: 12.5, color: '#7A4FB5', padding: '6px 0' }}>{s.exemptBy === 'placement' ? t('入职定级时已经定到这一级,这一关免修。', 'Your placement already put you at this level, so this stage is exempt.') : t('能力矩阵里已经到这一级,这一关不用再做。', 'The matrix already has you at this level, so this stage is not needed.')}</div>}
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginTop: 8 }}>{t('学习步骤(顺序自由)', 'Learning steps (any order)')}</div>
      {s.steps.map(stepRow)}
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginTop: 14 }}>{t('过关评估(学习步骤全部做完才能约)', 'Assessment (once every learning step is done)')}</div>
      {s.gate.map(stepRow)}
      {peek && <DocPeek id={peek} onClose={async () => { setPeek(null); const r = await fetch('/api/train'); if (r.ok) onData(await r.json()); }} />}
      {quiz && <QuizModal stepKey={quiz} onClose={() => setQuiz(null)} onDone={onData} />}
    </div>
  );
}

export function PersonHeader({ v }: { v: PersonView }) {
  const { lang, t } = useLang();
  return (
    <div className="panel" style={{ padding: '14px 18px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }} data-testid="novice-head">
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--navy900)' }}>{v.user}</div>
        <div style={{ fontSize: 12, color: 'var(--text2)' }}>
          {v.novice ? t(`新人期 ${fmtDay(v.noviceStart)} 开始`, `Induction since ${fmtDay(v.noviceStart)}`) : t('新人期之外加开的业务', 'Extra services outside the induction')}
          {v.mentor ? ` · ${t('带教人', 'Mentor')} ${v.mentor}` : ''}
        </div>
      </div>
      {v.selected.length > 0 && (
        <div style={{ fontSize: 12.5 }}>
          {t('新人期业务:', 'Induction services: ')}<b>{v.selected.map((x) => bizLabel(x, lang)).join(lang === 'zh' ? '、' : ', ')}</b>
          <span style={{ color: 'var(--text2)' }}> · {t(`${v.assistCount} 个到可协助、${v.independentCount} 个到可独立`, `${v.assistCount} at Can assist, ${v.independentCount} independent`)}</span>
        </div>
      )}
      <div style={{ flex: 1 }} />
      {v.noviceDone && <span className="badge" data-testid="novice-done" style={{ background: '#e6f2ec', color: '#0f6a48', fontSize: 12.5 }}>🎓 {t('新人期已完成', 'Induction complete')}</span>}
      {!v.noviceDone && v.novice && <span style={{ fontSize: 11.5, color: 'var(--text2)', maxWidth: 360 }}>{t('完成条件:所选业务都到「可协助」,并且至少 1 个到「可独立」。', 'Done when every chosen service is at “Can assist” and at least one is “Independent”.')}</span>}
    </div>
  );
}

export default function MyTraining({ b, onData, legacy }: { b: Bundle; onData: (b: Bundle) => void; legacy: React.ReactNode }) {
  const { lang, t } = useLang();
  const v = b.mine;
  const [sel, setSel] = useState<string | null>(null);
  const firstOpen = useMemo(() => v?.stages.find((s) => s.status === 'open')?.key || v?.stages[0]?.key || null, [v]);
  const cur = v?.stages.find((s) => s.key === (sel || firstOpen)) || null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {v ? (
        <>
          <PersonHeader v={v} />
          {(() => {
            const late = v.stages.filter((s) => s.overdueDays > 0);
            return late.length > 0 && (
              <div className="panel" style={{ padding: '10px 16px', background: '#fdecea', color: '#98342b', fontSize: 12.5 }} data-testid="my-overdue">
                ⏰ {t('超过建议时间(只提醒,不会判不通过):', 'Past the suggested date (a reminder only, nothing fails): ')}
                {late.map((s) => `${stageLabel(s, lang)} ${t(`超 ${s.overdueDays} 天`, `${s.overdueDays}d late`)}`).join(' · ')}
              </div>
            );
          })()}
          <StageGrid v={v} sel={cur?.key || null} onSel={setSel} />
          {cur && <StageDetail v={v} s={cur} b={b} onData={onData} />}
        </>
      ) : (
        <div className="panel" style={{ padding: 26, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }} data-testid="no-novice">
          {t('你现在不在新人期,也没有加开的业务路径。PD / BD 开始新人期、或带教人开下一级路径后,这里会出现你的关卡。', 'You are not in the induction and have no extra service tracks. Your stages appear here once PD / BD start your induction or your mentor opens a track.')}
        </div>
      )}
      <div className="panel clip">
        <div className="panel-head"><span className="panel-title">{t('其他培训', 'Other training')}</span><span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{t('以前的培训路径,功能不变', 'Earlier training paths, unchanged')}</span></div>
        <div style={{ padding: 14 }}>{legacy}</div>
      </div>
    </div>
  );
}
