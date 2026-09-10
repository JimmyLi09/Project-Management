'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { useLang } from '@/lib/i18n';
import { canDeleteKb, canEditPath, canEditTraining, ROLE_LABEL } from '@/lib/permissions';
import type { Role } from '@/lib/types';
import { Avatar, Icon, ProgressBar } from '../ui';
import Markdown from '../Markdown';
import {
  BOOL_OPTIONS, QUESTION_KINDS, isAssigned, isPassed, stepPct, stuckAt,
  type QuestionKind, type QuizQuestion, type TrainingPath, type TrainingProgress, type TrainingStep,
} from '@/lib/training';
import type { KbDoc } from '@/lib/kb';

/* ===== REQ-036: 新人培训 =====
   三块:我的培训(学员走流程)/ 路径管理(总监·PM 编内容)/ 学员进度(管理视图)。
   培训材料一律引用知识库文档(REQ-035)—— 改文档就是改教材,不在两处各存一份。
   正确答案从来不出服务端,判分在 /api/training/[id]/quiz 里做。 */
export default function TrainingView() {
  const { me, user, users } = useStore();
  const { lang, t } = useLang();
  const admin = canEditTraining(me);

  const [paths, setPaths] = useState<TrainingPath[]>([]);
  const [progress, setProgress] = useState<TrainingProgress[]>([]);
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'mine' | 'manage' | 'people'>('mine');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([fetch('/api/training'), fetch('/api/kb')]);
    if (a.ok) { const j = await a.json(); setPaths(j.paths); setProgress(j.progress); }
    if (b.ok) setDocs((await b.json()).docs as KbDoc[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const myProgress = (pid: string) => progress.find((p) => p.pathId === pid && p.user === user.name);
  const mine = useMemo(() => paths.filter((p) => isAssigned(p, { name: user.name, role: user.role })), [paths, user]);
  const open = paths.find((p) => p.id === openId) || null;

  if (loading) return <div className="panel" style={{ padding: 34, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>{t('加载中…', 'Loading…')}</div>;

  if (open) {
    return tab === 'manage'
      ? <PathEditor path={open} docs={docs} users={users} onBack={() => setOpenId(null)} onSaved={async () => { await load(); }} />
      : <Learn path={open} docs={docs} progress={myProgress(open.id)} onBack={() => setOpenId(null)} onChanged={load} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="detail-tabs" style={{ borderTop: 'none' }}>
        {([['mine', t('我的培训', 'My training')], ...(admin
          ? [['manage', t('路径管理', 'Paths')], ['people', t('学员进度', 'Trainees')]] as [string, string][]
          : [])] as [string, string][]).map(([k, label]) => (
            <button key={k} className={`detail-tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k as 'mine')}>{label}</button>
          ))}
      </div>

      {tab === 'mine' && (
        <>
          {mine.length === 0 && (
            <div className="panel" style={{ padding: 34, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
              {t('目前没有指派给你的培训路径。', 'No training paths are assigned to you yet.')}
            </div>
          )}
          {mine.map((p) => {
            const pr = myProgress(p.id);
            const pct = stepPct(p, pr);
            const done = isPassed(p, pr);
            const stuck = stuckAt(p, pr);
            return (
              <button key={p.id} className="panel" onClick={() => setOpenId(p.id)} style={{ padding: '16px 18px', textAlign: 'left', width: '100%', display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--navy900)' }}>{lang === 'zh' ? p.title : (p.titleEn || p.title)}</span>
                  {done
                    ? <span className="badge" style={{ background: '#e6f2ec', color: '#0f6a48' }}>✓ {t('已通过', 'Passed')}</span>
                    : <span className="badge" style={{ background: '#fbf0dc', color: '#a8690b' }}>{t('进行中', 'In progress')}</span>}
                  <div style={{ flex: 1 }} />
                  <span className="tnum" style={{ fontSize: 12, color: 'var(--text2)' }}>{pct}% · {p.steps.length} {t('步', 'steps')}{p.quiz.length ? ` · ${t('含考核', 'quiz')}` : ''}</span>
                </div>
                <div style={{ marginTop: 10 }}><ProgressBar pct={pct} /></div>
                {!done && stuck && (
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8 }}>
                    {t('下一步:', 'Next: ')}{stuck.title}
                  </div>
                )}
              </button>
            );
          })}
        </>
      )}

      {tab === 'manage' && admin && (
        <ManageList paths={paths} progress={progress} onOpen={setOpenId} onChanged={load} />
      )}

      {tab === 'people' && admin && (
        <People paths={paths} progress={progress} users={users} />
      )}
    </div>
  );
}

/* ---- 路径管理:列表 ---- */
function ManageList({ paths, progress, onOpen, onChanged }: {
  paths: TrainingPath[]; progress: TrainingProgress[]; onOpen: (id: string) => void; onChanged: () => Promise<void>;
}) {
  const { me, setToast } = useStore();
  const { lang, t } = useLang();

  async function create() {
    const title = prompt(t('新培训路径名称(如「新 PM 入门」)', 'New path name (e.g. "New PM onboarding")'), '');
    if (!title || !title.trim()) return;
    const r = await fetch('/api/training', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), steps: [], quiz: [], passScore: 80 }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setToast(d.error || t('新建失败', 'Create failed')); return; }
    await onChanged();
    onOpen(d.path.id);
  }

  return (
    <>
      <div className="panel" style={{ padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: 'var(--text2)', flex: 1, minWidth: 220 }}>
          {t('每一步引用一篇知识库文档 —— 改文档就是改教材,不用在两个地方各维护一份。',
             'Each step points at a knowledge-base doc — edit the doc and the training material follows.')}
        </span>
        <button className="btn-navy sm" onClick={create}>＋ {t('新建路径', 'New path')}</button>
      </div>

      {paths.length === 0 && (
        <div className="panel" style={{ padding: 34, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
          {t('还没有培训路径。先在知识库里把资料整理好,再在这里把它们串成一条路径。',
             'No paths yet. Put the material in the knowledge base first, then string it into a path here.')}
        </div>
      )}

      {paths.map((p) => {
        const learners = progress.filter((x) => x.pathId === p.id);
        const passed = learners.filter((x) => isPassed(p, x)).length;
        return (
          <div key={p.id} className="panel" style={{ padding: '14px 18px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--navy900)' }}>{lang === 'zh' ? p.title : (p.titleEn || p.title)}</div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
                {p.role ? ROLE_LABEL[p.role as Role] || p.role : t('不限角色', 'any role')}
                {p.assignees.length ? ` · ${t('指派', 'assigned')} ${p.assignees.length}` : ''}
                {' · '}{p.steps.length} {t('步', 'steps')}
                {' · '}{p.quiz.length ? t(`${p.quiz.length} 题 / 及格 ${p.passScore}%`, `${p.quiz.length} questions / pass ${p.passScore}%`) : t('无考核', 'no quiz')}
                {learners.length ? ` · ${t(`${passed}/${learners.length} 人已通过`, `${passed}/${learners.length} passed`)}` : ''}
              </div>
            </div>
            <button className="btn-line sm" onClick={() => onOpen(p.id)}><Icon name="edit" size={13} />{t('编辑', 'Edit')}</button>
            {canDeleteKb(me) && (
              <button className="btn-line sm danger" onClick={async () => {
                if (!confirm(t(`删除路径「${p.title}」?所有人的学习进度和考核成绩会一起删掉,不能撤销。`,
                               `Delete "${p.title}"? Everyone's progress and quiz results go with it.`))) return;
                const r = await fetch(`/api/training/${p.id}`, { method: 'DELETE' });
                if (!r.ok) { setToast(t('删除失败', 'Delete failed')); return; }
                await onChanged();
              }}>✕</button>
            )}
          </div>
        );
      })}
    </>
  );
}

/* ---- 管理视图:谁学到哪了 ---- */
function People({ paths, progress, users }: { paths: TrainingPath[]; progress: TrainingProgress[]; users: { name: string; role: string }[] }) {
  const { lang, t } = useLang();
  const rows = users
    .map((u) => ({ u, ps: paths.filter((p) => isAssigned(p, u)) }))
    .filter((r) => r.ps.length > 0);

  if (!rows.length) return (
    <div className="panel" style={{ padding: 34, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
      {t('还没有人被指派培训 —— 在「路径管理」里给路径设定角色或点名指派。',
         'Nobody is assigned yet — set a target role or pick people in Paths.')}
    </div>
  );

  return (
    <div className="panel clip">
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: '22%' }}>{t('学员', 'Trainee')}</th>
            <th style={th}>{t('培训路径', 'Path')}</th>
            <th style={{ ...th, width: 150 }}>{t('进度', 'Progress')}</th>
            <th style={{ ...th, width: 130 }}>{t('考核', 'Quiz')}</th>
            <th style={{ ...th, width: '22%' }}>{t('卡在哪一步', 'Stuck at')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ u, ps }) => ps.map((p, i) => {
            const pr = progress.find((x) => x.pathId === p.id && x.user === u.name);
            const pct = stepPct(p, pr);
            const passed = isPassed(p, pr);
            const stuck = stuckAt(p, pr);
            return (
              <tr key={p.id + u.name}>
                {i === 0 && (
                  <td style={{ ...cell, verticalAlign: 'top' }} rowSpan={ps.length}>
                    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                      <Avatar name={u.name} size={26} />
                      <span>
                        <span style={{ fontWeight: 600 }}>{u.name}</span>
                        <span style={{ display: 'block', fontSize: 11, color: 'var(--text2)' }}>{ROLE_LABEL[u.role as Role] || u.role}</span>
                      </span>
                    </span>
                  </td>
                )}
                <td style={cell}>{lang === 'zh' ? p.title : (p.titleEn || p.title)}</td>
                <td style={cell}>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ flex: 1 }}><ProgressBar pct={pct} /></span>
                    <span className="tnum" style={{ fontSize: 11.5 }}>{pct}%</span>
                  </span>
                </td>
                <td style={cell}>
                  {p.quiz.length === 0
                    ? <span style={{ color: 'var(--text2)' }}>{t('无', '—')}</span>
                    : pr?.attempts
                      ? <span style={{ color: pr.passedQuiz ? 'var(--success)' : 'var(--danger)' }}>
                          {pr.bestScore}% · {t(`${pr.attempts} 次`, `${pr.attempts} attempt(s)`)}
                        </span>
                      : <span style={{ color: 'var(--text2)' }}>{t('未考', 'not taken')}</span>}
                </td>
                <td style={{ ...cell, color: passed ? 'var(--success)' : 'var(--text2)' }}>
                  {passed ? t('✓ 已通过', '✓ Passed') : (stuck?.title || (p.quiz.length ? t('待考核', 'quiz pending') : '—'))}
                </td>
              </tr>
            );
          }))}
        </tbody>
      </table>
    </div>
  );
}

/* ---- 学员视角:一步步学 + 交卷 ---- */
function Learn({ path, docs, progress, onBack, onChanged }: {
  path: TrainingPath; docs: KbDoc[]; progress?: TrainingProgress; onBack: () => void; onChanged: () => Promise<void>;
}) {
  const { setToast } = useStore();
  const { lang, t } = useLang();
  const [pr, setPr] = useState<TrainingProgress | undefined>(progress);
  const [openStep, setOpenStep] = useState<string | null>(path.steps.find((s) => !(progress?.done || []).includes(s.id))?.id || null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<{ score: number; right: number; total: number; passed: boolean; passScore: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const pct = stepPct(path, pr);
  const stepsDone = pct >= 100;
  const passed = isPassed(path, pr);

  async function mark(stepId: string, done: boolean) {
    const r = await fetch(`/api/training/${path.id}/progress`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId, done }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setToast(j.error || t('保存失败', 'Save failed')); return; }
    setPr(j.progress);
    await onChanged();
  }

  async function submit() {
    setBusy(true);
    const r = await fetch(`/api/training/${path.id}/quiz`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setToast(j.error || t('提交失败', 'Submit failed')); return; }
    setResult(j); setPr(j.progress);
    await onChanged();
  }

  const pick = (q: QuizQuestion, key: string) => setAnswers((a) => {
    const cur = a[q.id] || [];
    if (q.kind === 'multi') return { ...a, [q.id]: cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key] };
    return { ...a, [q.id]: [key] };
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel" style={{ padding: '14px 18px' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn-line sm" onClick={onBack}>← {t('返回', 'Back')}</button>
          <span style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--navy900)' }}>{lang === 'zh' ? path.title : (path.titleEn || path.title)}</span>
          {passed && <span className="badge" style={{ background: '#e6f2ec', color: '#0f6a48' }}>✓ {t('已通过', 'Passed')}</span>}
          <div style={{ flex: 1 }} />
          <span className="tnum" style={{ fontSize: 12.5, color: 'var(--text2)' }}>
            {(pr?.done || []).length}/{path.steps.length} {t('步', 'steps')} · {pct}%
          </span>
        </div>
        <div style={{ marginTop: 10 }}><ProgressBar pct={pct} /></div>
      </div>

      {path.steps.map((s, i) => {
        const done = (pr?.done || []).includes(s.id);
        const isOpen = openStep === s.id;
        const doc = s.kind === 'doc' ? docs.find((d) => d.id === s.docId) : undefined;
        return (
          <div key={s.id} className="panel clip">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 18px' }}>
              <span className="tnum" style={{
                width: 24, height: 24, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11.5, fontWeight: 700, flexShrink: 0,
                background: done ? 'var(--success)' : 'var(--hover-bg)', color: done ? '#fff' : 'var(--text2)',
              }}>{done ? '✓' : i + 1}</span>
              <button style={{ flex: 1, textAlign: 'left', fontSize: 13.5, fontWeight: 600, minWidth: 0 }}
                onClick={() => setOpenStep(isOpen ? null : s.id)}>
                {s.title || (doc ? doc.title : t('(未命名步骤)', '(untitled step)'))}
              </button>
              {s.kind === 'doc' && !doc && (
                <span className="badge" style={{ background: '#fbe9e7', color: '#b23a32' }}>{t('文档已删除', 'doc missing')}</span>
              )}
              <button className={done ? 'btn-line sm' : 'btn-navy sm'} onClick={() => mark(s.id, !done)}>
                {done ? t('取消完成', 'Undo') : t('标记已完成', 'Mark done')}
              </button>
            </div>
            {isOpen && (
              <div style={{ padding: '4px 18px 16px', borderTop: '1px solid var(--row-line)' }}>
                {s.kind === 'note'
                  ? <div style={{ paddingTop: 12 }}><Markdown src={s.note || ''} /></div>
                  : doc
                    ? <div style={{ paddingTop: 12 }}><Markdown src={doc.body} /></div>
                    : <div style={{ paddingTop: 12, fontSize: 12.5, color: 'var(--text2)' }}>
                        {t('这一步引用的知识库文档已经被删除,请让总监 / PM 重新指一篇。',
                           'The knowledge-base doc for this step has been deleted — ask the director / PM to re-point it.')}
                      </div>}
              </div>
            )}
          </div>
        );
      })}

      {path.quiz.length > 0 && (
        <div className="panel" style={{ padding: '16px 18px' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--navy900)' }}>{t('考核小测', 'Quiz')}</span>
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>
              {t(`${path.quiz.length} 题 · 及格线 ${path.passScore}%`, `${path.quiz.length} questions · pass ${path.passScore}%`)}
              {pr?.attempts ? t(` · 已考 ${pr.attempts} 次,最好成绩 ${pr.bestScore}%`, ` · ${pr.attempts} attempt(s), best ${pr.bestScore}%`) : ''}
            </span>
            <div style={{ flex: 1 }} />
            {pr?.passedQuiz && <span className="badge" style={{ background: '#e6f2ec', color: '#0f6a48' }}>✓ {t('已达标', 'Passed')}</span>}
            {!quizOpen && (
              <button className="btn-navy sm" disabled={!stepsDone}
                title={stepsDone ? undefined : t('先把上面的步骤走完', 'Finish the steps above first')}
                onClick={() => { setQuizOpen(true); setResult(null); setAnswers({}); }}>
                {pr?.attempts ? t('再考一次', 'Retake') : t('开始考核', 'Start quiz')}
              </button>
            )}
          </div>
          {!stepsDone && !quizOpen && (
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8 }}>
              {t('走完全部步骤后才能考核。', 'Finish every step before taking the quiz.')}
            </div>
          )}

          {quizOpen && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {path.quiz.map((q, i) => (
                <div key={q.id} style={{ borderTop: '1px solid var(--row-line)', paddingTop: 12 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>
                    {i + 1}. {q.q}
                    <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: 'var(--text2)' }}>
                      {QUESTION_KINDS.find((k) => k[0] === q.kind)?.[lang === 'zh' ? 1 : 2]}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {q.options.map((o) => {
                      const on = (answers[q.id] || []).includes(o.key);
                      return (
                        <label key={o.key} style={{
                          display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: result ? 'default' : 'pointer',
                          padding: '6px 10px', borderRadius: 7, border: '1px solid ' + (on ? 'var(--navy700)' : 'var(--border)'),
                          background: on ? 'var(--hover-bg)' : undefined,
                        }}>
                          <input type={q.kind === 'multi' ? 'checkbox' : 'radio'} name={q.id} checked={on} disabled={!!result}
                            onChange={() => pick(q, o.key)} />
                          {o.text}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}

              {!result ? (
                <div style={{ display: 'flex', gap: 9 }}>
                  <button className="btn-line sm" onClick={() => setQuizOpen(false)}>{t('退出', 'Exit')}</button>
                  <button className="btn-navy sm" disabled={busy} onClick={submit}>{busy ? t('提交中…', 'Submitting…') : t('交卷', 'Submit')}</button>
                </div>
              ) : (
                <div style={{
                  padding: '12px 14px', borderRadius: 9,
                  background: result.passed ? '#e6f2ec' : '#fbe9e7',
                  color: result.passed ? '#0f6a48' : '#b23a32', fontSize: 13, fontWeight: 600,
                }}>
                  {result.passed ? '✓ ' : '✗ '}
                  {t(`得分 ${result.score}%(答对 ${result.right}/${result.total},及格线 ${result.passScore}%)`,
                     `Score ${result.score}% (${result.right}/${result.total} correct, pass ${result.passScore}%)`)}
                  {!result.passed && <span style={{ fontWeight: 400 }}>{t(' —— 回去把资料再过一遍,可以重考。', ' — review the material and retake.')}</span>}
                  <div style={{ marginTop: 10 }}>
                    <button className="btn-line sm" onClick={() => { setQuizOpen(false); setResult(null); }}>{t('关闭', 'Close')}</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---- 路径编辑(总监 / BD / PM) ---- */
function PathEditor({ path, docs, users, onBack, onSaved }: {
  path: TrainingPath; docs: KbDoc[]; users: { name: string; role: string }[];
  onBack: () => void; onSaved: () => Promise<void>;
}) {
  const { me, setToast } = useStore();
  const { lang, t } = useLang();
  const [d, setD] = useState<TrainingPath>(() => JSON.parse(JSON.stringify(path)) as TrainingPath);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  /* 列表接口不带正确答案(防止题目和答案一起进浏览器),
     所以编辑器打开时单独取一次全量。取不到 = 没权限改这条。 */
  useEffect(() => {
    let alive = true;
    fetch(`/api/training/${path.id}`)
      .then(async (r) => {
        if (!alive) return;
        if (r.ok) setD((await r.json()).path as TrainingPath);
        else setDenied(true);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [path.id]);

  if (denied) return (
    <div className="panel" style={{ padding: 30 }}>
      <button className="btn-line sm" onClick={onBack}>← {t('返回', 'Back')}</button>
      <div style={{ marginTop: 14, fontSize: 13, color: 'var(--text2)' }}>
        {t('这条路径设了「仅总监 / BD 维护」,所以你看不到它的题目答案,也改不了它。',
           'This path is director/BD-only, so its answer key is not available to you and it cannot be edited here.')}
      </div>
    </div>
  );

  const sid = (p: string) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const patchStep = (i: number, up: Partial<TrainingStep>) =>
    setD((x) => ({ ...x, steps: x.steps.map((s, k) => (k === i ? { ...s, ...up } : s)) }));
  const patchQ = (i: number, up: Partial<QuizQuestion>) =>
    setD((x) => ({ ...x, quiz: x.quiz.map((q, k) => (k === i ? { ...q, ...up } : q)) }));
  const move = (i: number, dir: -1 | 1) => setD((x) => {
    const j = i + dir;
    if (j < 0 || j >= x.steps.length) return x;
    const s = [...x.steps];
    [s[i], s[j]] = [s[j], s[i]];
    return { ...x, steps: s };
  });

  async function save() {
    setBusy(true);
    const r = await fetch(`/api/training/${d.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setToast(j.error || t('保存失败', 'Save failed')); return; }
    await onSaved();
    setToast(t('已保存', 'Saved'));
    onBack();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel" style={{ padding: '12px 18px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', position: 'sticky', top: 0, zIndex: 6 }}>
        <button className="btn-line sm" onClick={onBack}>← {t('返回', 'Back')}</button>
        <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--navy900)' }}>{t('编辑培训路径', 'Edit path')}</span>
        <div style={{ flex: 1 }} />
        <button className="btn-navy sm" disabled={busy} onClick={save}>{busy ? t('保存中…', 'Saving…') : t('保存', 'Save')}</button>
      </div>

      <div className="panel" style={{ padding: '16px 18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
        <label style={fieldL}>{t('名称', 'Name')}
          <input className="in sm" value={d.title} maxLength={120} onChange={(e) => setD({ ...d, title: e.target.value })} />
        </label>
        <label style={fieldL}>{t('英文名(可空)', 'English name (optional)')}
          <input className="in sm" value={d.titleEn} maxLength={120} onChange={(e) => setD({ ...d, titleEn: e.target.value })} />
        </label>
        <label style={fieldL}>{t('面向角色', 'Target role')}
          <select className="in sm" value={d.role} onChange={(e) => setD({ ...d, role: e.target.value })}>
            <option value="">{t('— 不限(只按下面点名指派)—', '— none (assign by name only) —')}</option>
            {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label style={fieldL}>{t('及格线 %', 'Pass score %')}
          <input className="in sm" type="number" min={0} max={100} value={d.passScore}
            onChange={(e) => setD({ ...d, passScore: Math.max(0, Math.min(100, parseInt(e.target.value) || 0)) })} />
        </label>
        <label style={{ ...fieldL, gridColumn: '1 / -1', flexDirection: 'row', alignItems: 'flex-start', gap: 8, fontWeight: 500 }}>
          <input type="checkbox" checked={d.adminOnly} disabled={!canEditPath(me, true) && d.adminOnly}
            onChange={(e) => setD({ ...d, adminOnly: e.target.checked })} style={{ marginTop: 2 }} />
          <span>
            <b>{t('仅总监 / BD 维护这条路径', 'Director / BD maintain this path only')}</b>
            <span style={{ display: 'block', marginTop: 3, lineHeight: 1.6 }}>
              {t('按角色指派会把该角色全体圈进来 —— 比如「新 PM 入门」的学员本身就是 PM,而 PM 默认能维护题库,也就看得到答案。要真挡住这一手,把这条勾上:勾上后 PM 既改不了这条路径,也取不到它的答案。',
                 'Assigning by role sweeps in the whole role — the trainees for "New PM onboarding" are PMs, and PMs can maintain quizzes by default, so they would see the answer key. Tick this and PMs can neither edit this path nor fetch its answers.')}
            </span>
          </span>
        </label>
        <div style={{ gridColumn: '1 / -1' }}>
          <div style={{ ...fieldL, marginBottom: 6 }}>{t('额外点名指派(角色之外的人)', 'Also assign to specific people')}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {users.map((u) => {
              const on = d.assignees.includes(u.name);
              return (
                <button key={u.name} className="badge"
                  style={{ background: on ? 'var(--navy900)' : 'var(--hover-bg)', color: on ? '#fff' : 'var(--text2)', cursor: 'pointer' }}
                  onClick={() => setD((x) => ({ ...x, assignees: on ? x.assignees.filter((n) => n !== u.name) : [...x.assignees, u.name] }))}>
                  {u.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="panel clip">
        <div className="panel-head" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="panel-title">{t('步骤', 'Steps')} ({d.steps.length})</span>
          <div style={{ flex: 1 }} />
          <button className="btn-line sm" onClick={() => setD((x) => ({ ...x, steps: [...x.steps, { id: sid('st'), kind: 'doc', title: '', docId: '' }] }))}>
            ＋ {t('引用一篇文档', 'Add doc step')}
          </button>
          <button className="btn-line sm" onClick={() => setD((x) => ({ ...x, steps: [...x.steps, { id: sid('st'), kind: 'note', title: '', note: '' }] }))}>
            ＋ {t('加一段说明', 'Add note step')}
          </button>
        </div>
        {d.steps.length === 0 && (
          <div style={{ padding: 22, fontSize: 12.5, color: 'var(--text2)' }}>
            {t('还没有步骤。「引用一篇文档」把知识库里的资料串进来;「加一段说明」写一句现场交代的话。',
               'No steps yet. Point at knowledge-base docs, or add a short note step.')}
          </div>
        )}
        {d.steps.map((s, i) => (
          <div key={s.id} style={{ padding: '11px 18px', borderTop: '1px solid var(--row-line)', display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <span className="tnum" style={{ fontSize: 11.5, color: 'var(--text2)', width: 18, paddingTop: 8 }}>{i + 1}</span>
            <div style={{ flex: 1, minWidth: 240, display: 'flex', flexDirection: 'column', gap: 7 }}>
              <input className="in sm" value={s.title} maxLength={160} placeholder={t('这一步叫什么', 'Step title')}
                onChange={(e) => patchStep(i, { title: e.target.value })} />
              {s.kind === 'doc' ? (
                <select className="in sm" value={s.docId || ''} onChange={(e) => {
                  const doc = docs.find((x) => x.id === e.target.value);
                  patchStep(i, { docId: e.target.value, title: s.title || doc?.title || '' });
                }}>
                  <option value="">{t('— 选一篇知识库文档 —', '— pick a knowledge-base doc —')}</option>
                  {docs.map((doc) => <option key={doc.id} value={doc.id}>{doc.title}</option>)}
                </select>
              ) : (
                <textarea className="in sm" value={s.note || ''} style={{ minHeight: 64 }}
                  placeholder={t('说明文字(支持 Markdown)', 'Note (Markdown supported)')}
                  onChange={(e) => patchStep(i, { note: e.target.value })} />
              )}
            </div>
            <div style={{ display: 'flex', gap: 4, paddingTop: 3 }}>
              <button className="btn-line sm" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
              <button className="btn-line sm" onClick={() => move(i, 1)} disabled={i === d.steps.length - 1}>↓</button>
              <button className="btn-line sm danger" onClick={() => setD((x) => ({ ...x, steps: x.steps.filter((_, k) => k !== i) }))}>✕</button>
            </div>
          </div>
        ))}
      </div>

      <div className="panel clip">
        <div className="panel-head" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="panel-title">{t('考核小测', 'Quiz')} ({d.quiz.length})</span>
          <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>
            {t('答案只存在服务端,学员的浏览器里拿不到。', 'Answers never leave the server — trainees cannot see them.')}
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn-line sm" onClick={() => setD((x) => ({
            ...x, quiz: [...x.quiz, { id: sid('q'), kind: 'single', q: '', options: [{ key: 'A', text: '' }, { key: 'B', text: '' }], answer: [] }],
          }))}>＋ {t('加一题', 'Add question')}</button>
        </div>
        {d.quiz.map((q, i) => (
          <div key={q.id} style={{ padding: '12px 18px', borderTop: '1px solid var(--row-line)' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <span className="tnum" style={{ fontSize: 11.5, color: 'var(--text2)', width: 18 }}>{i + 1}</span>
              <input className="in sm" style={{ flex: 1, minWidth: 220 }} value={q.q} maxLength={500}
                placeholder={t('题干', 'Question')} onChange={(e) => patchQ(i, { q: e.target.value })} />
              <select className="in sm" style={{ width: 'auto' }} value={q.kind} onChange={(e) => {
                const kind = e.target.value as QuestionKind;
                patchQ(i, {
                  kind,
                  options: kind === 'bool' ? BOOL_OPTIONS : (q.options.length >= 2 ? q.options : [{ key: 'A', text: '' }, { key: 'B', text: '' }]),
                  answer: [],
                });
              }}>
                {QUESTION_KINDS.map((k) => <option key={k[0]} value={k[0]}>{lang === 'zh' ? k[1] : k[2]}</option>)}
              </select>
              <button className="btn-line sm danger" onClick={() => setD((x) => ({ ...x, quiz: x.quiz.filter((_, k) => k !== i) }))}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 26 }}>
              {q.options.map((o, oi) => (
                <div key={o.key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 11.5, color: 'var(--text2)', minWidth: 62 }}
                    title={t('勾这里 = 正确答案', 'Tick = correct answer')}>
                    <input type={q.kind === 'multi' ? 'checkbox' : 'radio'} name={'ans' + q.id}
                      checked={q.answer.includes(o.key)}
                      onChange={() => patchQ(i, {
                        answer: q.kind === 'multi'
                          ? (q.answer.includes(o.key) ? q.answer.filter((k) => k !== o.key) : [...q.answer, o.key])
                          : [o.key],
                      })} />
                    {t('正确', 'Correct')}
                  </label>
                  <input className="in sm" style={{ flex: 1 }} value={o.text} maxLength={300} disabled={q.kind === 'bool'}
                    placeholder={t(`选项 ${o.key}`, `Option ${o.key}`)}
                    onChange={(e) => patchQ(i, { options: q.options.map((x, k) => (k === oi ? { ...x, text: e.target.value } : x)) })} />
                  {q.kind !== 'bool' && q.options.length > 2 && (
                    <button className="btn-line sm danger" onClick={() => patchQ(i, {
                      options: q.options.filter((_, k) => k !== oi),
                      answer: q.answer.filter((k) => k !== o.key),
                    })}>✕</button>
                  )}
                </div>
              ))}
              {q.kind !== 'bool' && q.options.length < 12 && (
                <button className="btn-line sm" style={{ alignSelf: 'flex-start', borderStyle: 'dashed' }}
                  onClick={() => patchQ(i, { options: [...q.options, { key: String.fromCharCode(65 + q.options.length), text: '' }] })}>
                  ＋ {t('加选项', 'Add option')}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '10px 16px', fontSize: 11.5, fontWeight: 700, color: 'var(--text2)', borderBottom: '1px solid var(--row-line)' };
const cell: React.CSSProperties = { padding: '10px 16px', fontSize: 12.5, borderTop: '1px solid var(--row-line)' };
const fieldL: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: 'var(--text2)', fontWeight: 600 };
