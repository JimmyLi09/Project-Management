'use client';

/* ===== REQ-062 · 路径与评分表 =====
   新人主线(关 0、关 1)、7 条业务路径(各关 2 – 4)、三张评分表、及格线、PM 晋级条件。
   PD / BD 可以编辑;测验题库由 PD / BD 和带教人(Senior PM / PM Director)维护,题目由 Audax 自己出,系统不预置。
   标红:还没出题的测验(这一关过不了,PD / BD 可以把它从关卡里去掉)、一篇文档都没有的板块(这一步自动算完成)。 */
import React, { useEffect, useState } from 'react';
import { useLang } from '@/lib/i18n';
import { useStore } from '../../store';
import { KB_SECS } from '@/lib/bizMap';
import {
  LEVELS, PM_LEVELS, RUBRIC_KEYS, STEP_KINDS, TRAIN_BIZ, TRAIN_BIZ_KEYS, bizLabel,
  type Promo, type RubricKey, type StepKind, type TStage, type TStep, type TrainConfig,
} from '@/lib/train';
import { BOOL_OPTIONS, QUESTION_KINDS, type QuestionKind, type QuizQuestion } from '@/lib/training';
import { card, fieldL, td, th, trainAct, type Bundle } from './shared';

const rid = () => Math.random().toString(36).slice(2, 8);

function QuizEditor({ stepKey, admin, onClose, onSaved }: { stepKey: string; admin: boolean; onClose: () => void; onSaved: () => void }) {
  const { t } = useLang();
  const { setToast } = useStore();
  const [qs, setQs] = useState<QuizQuestion[] | null>(null);
  const [pass, setPass] = useState<string>('');
  const [def, setDef] = useState(80);
  const [err, setErr] = useState('');
  useEffect(() => {
    fetch(`/api/train/quiz?key=${encodeURIComponent(stepKey)}&full=1`).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error || 'error'); return; }
      setQs(j.questions); setPass(j.passScore == null ? '' : String(j.passScore)); setDef(j.defaultPass);
    });
  }, [stepKey]);
  const patch = (i: number, up: Partial<QuizQuestion>) => setQs((x) => (x || []).map((q, k) => (k === i ? { ...q, ...up } : q)));
  async function save() {
    const r = await fetch('/api/train/quiz', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: stepKey, questions: qs, ...(admin ? { passScore: pass === '' ? null : Number(pass) } : {}) }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setToast(j.error || t('保存失败', 'Save failed')); return; }
    setToast(t('题库已保存', 'Quiz saved')); onSaved(); onClose();
  }
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 760, maxHeight: '88vh', overflow: 'auto' }} data-testid="quiz-editor">
        <h2>{t('维护题库', 'Maintain the quiz')} <span style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 400 }}>{stepKey}</span></h2>
        {err && <div className="login-err">{err}</div>}
        {qs && (
          <>
            <label style={{ ...fieldL, flexDirection: 'row', alignItems: 'center', gap: 8 }}>{t('及格线', 'Pass mark')}
              <input className="in sm" style={{ width: 80 }} type="number" min={0} max={100} value={pass} disabled={!admin} placeholder={String(def)} onChange={(e) => setPass(e.target.value)} />
              <span style={{ fontWeight: 400 }}>{admin ? t(`空 = 用全局的 ${def} 分`, `blank = the global ${def}`) : t('只有 PD / BD 能改', 'PD / BD only')}</span>
            </label>
            {qs.map((q, i) => (
              <div key={q.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginTop: 10 }} data-testid="qe-q">
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="in sm" style={{ flex: 1 }} value={q.q} placeholder={t('题干', 'Question')} onChange={(e) => patch(i, { q: e.target.value })} data-testid="qe-text" />
                  <select className="in sm" value={q.kind} onChange={(e) => { const kind = e.target.value as QuestionKind; patch(i, { kind, options: kind === 'bool' ? BOOL_OPTIONS : q.options.length ? q.options : [{ key: 'A', text: '' }, { key: 'B', text: '' }], answer: [] }); }}>
                    {QUESTION_KINDS.map(([k, zh, en]) => <option key={k} value={k}>{t(zh, en)}</option>)}
                  </select>
                  <button className="btn-line sm danger" onClick={() => setQs(qs.filter((_, k) => k !== i))}>✕</button>
                </div>
                {q.options.map((o, oi) => (
                  <div key={o.key} style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 5 }}>
                    <input type={q.kind === 'multi' ? 'checkbox' : 'radio'} name={`qe-${q.id}`} checked={q.answer.includes(o.key)} data-testid="qe-ans" data-i={oi}
                      onChange={() => patch(i, { answer: q.kind === 'multi' ? (q.answer.includes(o.key) ? q.answer.filter((x) => x !== o.key) : [...q.answer, o.key]) : [o.key] })} />
                    <b style={{ width: 16 }}>{o.key}</b>
                    <input className="in sm" style={{ flex: 1 }} value={o.text} disabled={q.kind === 'bool'} data-testid="qe-opt"
                      onChange={(e) => patch(i, { options: q.options.map((x, k) => (k === oi ? { ...x, text: e.target.value } : x)) })} />
                  </div>
                ))}
                {q.kind !== 'bool' && q.options.length < 8 && <button className="btn-line sm" style={{ marginTop: 5 }} onClick={() => patch(i, { options: [...q.options, { key: String.fromCharCode(65 + q.options.length), text: '' }] })}>＋ {t('选项', 'Option')}</button>}
              </div>
            ))}
            <button className="btn-line sm" style={{ marginTop: 10 }} data-testid="qe-add" onClick={() => setQs([...qs, { id: 'q' + rid(), kind: 'single' as QuestionKind, q: '', options: [{ key: 'A', text: '' }, { key: 'B', text: '' }], answer: [] }])}>＋ {t('加一题', 'Add a question')}</button>
          </>
        )}
        <div className="modal-actions">
          <button className="btn-line" onClick={onClose}>{t('取消', 'Cancel')}</button>
          {qs && <button className="btn-navy" onClick={save} data-testid="qe-save">{t('保存', 'Save')}</button>}
        </div>
      </div>
    </div>
  );
}

function StepEditor({ st, gate, onChange, onRemove }: { st: TStep; gate: boolean; onChange: (s: TStep) => void; onRemove: () => void }) {
  const { lang, t } = useLang();
  const kinds = (Object.keys(STEP_KINDS) as StepKind[]).filter((k) => STEP_KINDS[k].gate === gate);
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '6px 0', borderTop: '1px dashed var(--row-line)' }}>
      <select className="in sm" value={st.kind} onChange={(e) => onChange({ ...st, kind: e.target.value as StepKind })}>
        {kinds.map((k) => <option key={k} value={k}>{STEP_KINDS[k].icon} {lang === 'zh' ? STEP_KINDS[k].zh.split(' · ')[0] : STEP_KINDS[k].en.split(' · ')[0]}</option>)}
      </select>
      <input className="in sm" style={{ flex: 2, minWidth: 180 }} value={st.zh} placeholder={t('中文', 'Chinese')} onChange={(e) => onChange({ ...st, zh: e.target.value })} />
      <input className="in sm" style={{ flex: 2, minWidth: 180 }} value={st.en} placeholder="English" onChange={(e) => onChange({ ...st, en: e.target.value })} />
      {st.kind === 'docset' && (
        <>
          <select className="in sm" value={st.biz || 'cur'} onChange={(e) => onChange({ ...st, biz: e.target.value })}>
            <option value="cur">{t('本路径的业务', 'This track\'s service')}</option>
            <option value="overview">{bizLabel('overview', lang)}</option>
            {TRAIN_BIZ_KEYS.map((k) => <option key={k} value={k}>{bizLabel(k, lang)}</option>)}
          </select>
          <select className="in sm" value={st.sec || 'B'} onChange={(e) => onChange({ ...st, sec: e.target.value })}>
            {KB_SECS.map((x) => <option key={x.key} value={x.key}>{x.key}</option>)}
          </select>
        </>
      )}
      {(st.kind === 'present' || st.kind === 'sim') && (
        <select className="in sm" value={st.rubric || 'present'} onChange={(e) => onChange({ ...st, rubric: e.target.value as RubricKey })}>
          {RUBRIC_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      )}
      {st.kind === 'task' && (
        <select className="in sm" value={st.project || ''} onChange={(e) => onChange({ ...st, project: (e.target.value || undefined) as TStep['project'] })}>
          <option value="">{t('不用关联项目', 'No project')}</option>
          <option value="shadow">{t('关联「跟项目」', 'Shadowed project')}</option>
          <option value="assist">{t('关联「协助」', 'Assisted project')}</option>
          <option value="owner">{t('关联负责的项目', 'Led project')}</option>
        </select>
      )}
      <button className="btn-line sm danger" onClick={onRemove} title={t('从关卡里去掉', 'Remove from the stage')}>✕</button>
    </div>
  );
}

function StageCard({ track, s, b, edit, onEdit, onQuiz }: { track: string; s: TStage; b: Bundle; edit: boolean; onEdit: (s: TStage) => void; onQuiz: (key: string) => void }) {
  const { lang, t } = useLang();
  const key = (st: TStep) => `${track === 'main' ? s.id : `${track}.${s.id}`}.${st.id}`;
  const line = (st: TStep) => {
    const k = key(st);
    const noq = b.warn.noquiz.includes(k), empty = b.warn.empty.includes(k);
    return (
      <div key={st.id} data-testid="path-step" data-key={k} style={{ fontSize: 12.5, padding: '3px 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>{STEP_KINDS[st.kind].icon} {lang === 'zh' ? st.zh : st.en || st.zh}</span>
        {st.kind === 'docset' && <span style={{ color: 'var(--text2)' }}>({bizLabel(st.biz === 'cur' ? track : st.biz || '', lang)} · {st.sec})</span>}
        {noq && <span className="badge" data-testid="warn-noquiz" style={{ background: '#fdecea', color: '#98342b' }}>{t('还没出题', 'No questions yet')}</span>}
        {empty && <span className="badge" data-testid="warn-empty" style={{ background: '#fdecea', color: '#98342b' }}>{t('空板块', 'Empty section')}</span>}
        {st.kind === 'quiz' && b.me.quiz && <button className="btn-line sm" data-testid="quiz-maint" onClick={() => onQuiz(k)}>{t('维护题库', 'Maintain quiz')} ({b.quizInfo[k]?.n || 0})</button>}
      </div>
    );
  };
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', flex: 1, minWidth: 260 }}>
      {edit ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
          <input className="in sm" value={s.zh} onChange={(e) => onEdit({ ...s, zh: e.target.value })} style={{ flex: 1 }} />
          <input className="in sm" value={s.en} onChange={(e) => onEdit({ ...s, en: e.target.value })} style={{ flex: 1 }} placeholder="English" />
          <label style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}>{t('第', 'Day')}<input className="in sm" type="number" style={{ width: 64 }} value={s.dueDay} onChange={(e) => onEdit({ ...s, dueDay: Number(e.target.value) || 1 })} />{t('天', '')}</label>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 4 }}>
          <b style={{ fontSize: 13.5, color: 'var(--navy900)' }}>{lang === 'zh' ? `关 ${s.id.slice(1)} ${s.zh}` : `Stage ${s.id.slice(1)} ${s.en || s.zh}`}</b>
          <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{t(`建议第 ${s.dueDay} 天`, `by day ${s.dueDay}`)} · {lang === 'zh' ? s.upZh : s.upEn || s.upZh}</span>
        </div>
      )}
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text2)', marginTop: 4 }}>{t('学习步骤', 'Learning steps')}</div>
      {edit ? s.steps.map((st, i) => <StepEditor key={st.id} st={st} gate={false} onChange={(x) => onEdit({ ...s, steps: s.steps.map((y, k) => (k === i ? x : y)) })} onRemove={() => onEdit({ ...s, steps: s.steps.filter((_, k) => k !== i) })} />) : s.steps.map(line)}
      {edit && <button className="btn-line sm" onClick={() => onEdit({ ...s, steps: [...s.steps, { id: rid(), kind: 'doc', zh: '', en: '' }] })}>＋ {t('学习步骤', 'Learning step')}</button>}
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text2)', marginTop: 6 }}>{t('过关评估', 'Assessment')}</div>
      {edit ? s.gate.map((st, i) => <StepEditor key={st.id} st={st} gate onChange={(x) => onEdit({ ...s, gate: s.gate.map((y, k) => (k === i ? x : y)) })} onRemove={() => onEdit({ ...s, gate: s.gate.filter((_, k) => k !== i) })} />) : s.gate.map(line)}
      {edit && <button className="btn-line sm" onClick={() => onEdit({ ...s, gate: [...s.gate, { id: rid(), kind: 'present', rubric: 'present', zh: '', en: '' }] })}>＋ {t('评估', 'Assessment')}</button>}
    </div>
  );
}

export default function Paths({ b, onData }: { b: Bundle; onData: (b: Bundle) => void }) {
  const { lang, t } = useLang();
  const { setToast } = useStore();
  const admin = b.me.admin;
  const [track, setTrack] = useState<string>('main');
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<TrainConfig>(b.config);
  const [quiz, setQuiz] = useState<string | null>(null);
  useEffect(() => { if (!edit) setDraft(b.config); }, [b.config, edit]);
  const save = async (part: string, value: unknown) => {
    const r = await trainAct({ op: 'config', part, value });
    if (!r.ok) { setToast(r.error); return false; }
    onData(r.data); setToast(t('已保存', 'Saved')); return true;
  };
  const stages = track === 'main' ? draft.main : draft.biz[track] || [];
  const setStages = (ss: TStage[]) => setDraft((d) => (track === 'main' ? { ...d, main: ss } : { ...d, biz: { ...d.biz, [track]: ss } }));
  const refresh = async () => { const r = await fetch('/api/train'); if (r.ok) onData(await r.json()); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {(b.warn.noquiz.length > 0 || b.warn.empty.length > 0) && admin && (
        <div className="panel" style={{ ...card, background: '#fdecea', color: '#98342b', fontSize: 12.5 }} data-testid="path-warn">
          {b.warn.noquiz.length > 0 && <div>⚠ {t(`${b.warn.noquiz.length} 份测验还没出题 —— 这些关过不了。可以出题,或者在路径里把测验去掉。`, `${b.warn.noquiz.length} quizzes have no questions — those stages cannot be passed. Add questions or remove the quiz.`)}</div>}
          {b.warn.empty.length > 0 && <div>⚠ {t(`${b.warn.empty.length} 个板块阅读步骤对应的板块一篇文档都没有(这一步自动算完成)。`, `${b.warn.empty.length} section-reading steps point at empty sections (they count as done).`)}</div>}
        </div>
      )}
      <div className="panel" style={{ ...card, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className={`chip ${track === 'main' ? 'active' : ''}`} onClick={() => setTrack('main')} data-testid="path-main">{t('新人主线', 'Main track')}</button>
        {TRAIN_BIZ.map((bz) => <button key={bz.key} className={`chip ${track === bz.key ? 'active' : ''}`} onClick={() => setTrack(bz.key)} data-testid="path-biz" data-biz={bz.key}>{lang === 'zh' ? bz.zh : bz.en}</button>)}
        <div style={{ flex: 1 }} />
        {admin && !edit && <button className="btn-line sm" data-testid="path-edit" onClick={() => setEdit(true)}>✎ {t('编辑路径', 'Edit')}</button>}
        {admin && edit && <>
          <button className="btn-line sm" onClick={() => { setEdit(false); setDraft(b.config); }}>{t('取消', 'Cancel')}</button>
          <button className="btn-navy sm" data-testid="path-save" onClick={async () => { if (await save(track === 'main' ? 'main' : 'biz', track === 'main' ? draft.main : draft.biz)) setEdit(false); }}>{t('保存路径', 'Save')}</button>
        </>}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {stages.map((s, i) => <StageCard key={s.id} track={track} s={s} b={b} edit={edit} onQuiz={setQuiz} onEdit={(x) => setStages(stages.map((y, k) => (k === i ? x : y)))} />)}
      </div>
      <div className="panel" style={card}>
        <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
          {t('规则:关 0、关 1 所有人都一样;关 2 – 4 每个所选业务各走一遍,业务之间互不卡。一关之内学习步骤顺序自由,做完才能约过关评估,评估全部通过才算过关。建议完成时间 = 新人期开始日 + 天数,超过只提醒。', 'Rules: stages 0 and 1 are the same for everyone; stages 2 – 4 run once per chosen service, and services do not block each other. Within a stage the learning steps can be done in any order; the assessment opens once they are done, and every assessment must pass. Suggested date = induction start + days; overruns only trigger a reminder.')}
        </div>
      </div>

      <RubricsCard b={b} admin={admin} save={save} />
      <PromoCard b={b} admin={admin} save={save} />
      {quiz && <QuizEditor stepKey={quiz} admin={admin} onClose={() => setQuiz(null)} onSaved={refresh} />}
    </div>
  );
}

function RubricsCard({ b, admin, save }: { b: Bundle; admin: boolean; save: (part: string, v: unknown) => Promise<boolean> }) {
  const { lang, t } = useLang();
  const [edit, setEdit] = useState(false);
  const [r, setR] = useState(b.config.rubrics);
  const [pass, setPass] = useState(b.config.pass);
  useEffect(() => { if (!edit) { setR(b.config.rubrics); setPass(b.config.pass); } }, [b.config, edit]);
  return (
    <div className="panel clip" data-testid="rubrics">
      <div className="panel-head" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="panel-title">{t('评分表', 'Rubrics')}</span>
        <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{t(`每张 4 项,每项 1 – 5 分;平均 ≥ ${b.config.pass.avg} 且没有一项低于 ${b.config.pass.min} 才通过;测验 ${b.config.pass.quiz} 分及格`, `4 items scored 1 – 5; pass = average ≥ ${b.config.pass.avg} and no item below ${b.config.pass.min}; quizzes pass at ${b.config.pass.quiz}`)}</span>
        <div style={{ flex: 1 }} />
        {admin && !edit && <button className="btn-line sm" onClick={() => setEdit(true)} data-testid="rubric-edit">✎ {t('编辑', 'Edit')}</button>}
        {admin && edit && <>
          <button className="btn-line sm" onClick={() => setEdit(false)}>{t('取消', 'Cancel')}</button>
          <button className="btn-navy sm" data-testid="rubric-save" onClick={async () => { if (await save('rubrics', r) && await save('pass', pass)) setEdit(false); }}>{t('保存', 'Save')}</button>
        </>}
      </div>
      {edit && (
        <div style={{ display: 'flex', gap: 10, padding: '10px 16px', flexWrap: 'wrap' }}>
          <label style={fieldL}>{t('平均至少', 'Minimum average')}<input className="in sm" type="number" step="0.1" min={1} max={5} value={pass.avg} data-testid="pass-avg" onChange={(e) => setPass({ ...pass, avg: Number(e.target.value) })} /></label>
          <label style={fieldL}>{t('任何一项不低于', 'No item below')}<input className="in sm" type="number" min={1} max={5} value={pass.min} onChange={(e) => setPass({ ...pass, min: Number(e.target.value) })} /></label>
          <label style={fieldL}>{t('测验及格分', 'Quiz pass mark')}<input className="in sm" type="number" min={0} max={100} value={pass.quiz} onChange={(e) => setPass({ ...pass, quiz: Number(e.target.value) })} /></label>
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{RUBRIC_KEYS.map((k) => <th key={k} style={th}>{edit ? <input className="in sm" value={r[k].zh} onChange={(e) => setR({ ...r, [k]: { ...r[k], zh: e.target.value } })} /> : (lang === 'zh' ? r[k].zh : r[k].en || r[k].zh)}</th>)}</tr></thead>
          <tbody>
            {[0, 1, 2, 3].map((i) => (
              <tr key={i}>{RUBRIC_KEYS.map((k) => (
                <td key={k} style={td}>{edit
                  ? <><input className="in sm" style={{ width: '100%' }} value={r[k].items[i].zh} data-testid="rubric-item" onChange={(e) => setR({ ...r, [k]: { ...r[k], items: r[k].items.map((x, j) => (j === i ? { ...x, zh: e.target.value } : x)) } })} />
                      <input className="in sm" style={{ width: '100%', marginTop: 3 }} value={r[k].items[i].en} placeholder="English" onChange={(e) => setR({ ...r, [k]: { ...r[k], items: r[k].items.map((x, j) => (j === i ? { ...x, en: e.target.value } : x)) } })} /></>
                  : (lang === 'zh' ? r[k].items[i].zh : r[k].items[i].en || r[k].items[i].zh)}</td>
              ))}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PromoCard({ b, admin, save }: { b: Bundle; admin: boolean; save: (part: string, v: unknown) => Promise<boolean> }) {
  const { lang, t } = useLang();
  const [edit, setEdit] = useState(false);
  const [ps, setPs] = useState<Promo[]>(b.config.promo);
  useEffect(() => { if (!edit) setPs(b.config.promo); }, [b.config, edit]);
  const name = (v: string) => PM_LEVELS.find((x) => x.v === v)?.en || v;
  const up = (i: number, p: Promo) => setPs(ps.map((x, k) => (k === i ? p : x)));
  return (
    <div className="panel clip" data-testid="promo-rules">
      <div className="panel-head" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="panel-title">{t('PM 晋级条件', 'PM promotion criteria')}</span>
        <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{t('系统只显示哪些已满足,不自动晋级', 'Only shows what is met — never promotes automatically')}</span>
        <div style={{ flex: 1 }} />
        {admin && !edit && <button className="btn-line sm" onClick={() => setEdit(true)} data-testid="promo-edit">✎ {t('编辑', 'Edit')}</button>}
        {admin && edit && <>
          <button className="btn-line sm" onClick={() => setEdit(false)}>{t('取消', 'Cancel')}</button>
          <button className="btn-navy sm" data-testid="promo-save" onClick={async () => { if (await save('promo', ps)) setEdit(false); }}>{t('保存', 'Save')}</button>
        </>}
      </div>
      {ps.map((p, i) => (
        <div key={p.id} style={{ padding: '10px 16px', borderTop: '1px solid var(--row-line)', fontSize: 12.5 }}>
          <b>{name(p.from)} → {name(p.to)}</b>
          {p.matrix.map((r, j) => (
            <div key={j} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
              <span>·</span>
              {edit ? (
                <>
                  {TRAIN_BIZ_KEYS.map((k) => (
                    <label key={k} style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                      <input type="checkbox" checked={r.bizs.includes(k)} onChange={() => up(i, { ...p, matrix: p.matrix.map((x, jj) => (jj === j ? { ...x, bizs: x.bizs.includes(k) ? x.bizs.filter((y) => y !== k) : [...x.bizs, k] } : x)) })} />
                      {bizLabel(k, lang)}
                    </label>
                  ))}
                  <span>{t('至少', 'at least')}</span>
                  <input className="in sm" type="number" min={1} max={7} style={{ width: 50 }} value={r.need} onChange={(e) => up(i, { ...p, matrix: p.matrix.map((x, jj) => (jj === j ? { ...x, need: Number(e.target.value) || 1 } : x)) })} />
                  <span>{t('个到', 'at')}</span>
                  <select className="in sm" value={r.level} onChange={(e) => up(i, { ...p, matrix: p.matrix.map((x, jj) => (jj === j ? { ...x, level: Number(e.target.value) as never } : x)) })}>
                    {LEVELS.filter((l) => l.v > 0).map((l) => <option key={l.v} value={l.v}>{lang === 'zh' ? l.zh : l.en}</option>)}
                  </select>
                  <button className="btn-line sm danger" onClick={() => up(i, { ...p, matrix: p.matrix.filter((_, jj) => jj !== j) })}>✕</button>
                </>
              ) : (
                <span>{r.bizs.map((k) => bizLabel(k, lang)).join(' / ')}{r.need < r.bizs.length ? t(` 中至少 ${r.need} 个`, ` — at least ${r.need}`) : ''}「{LEVELS[r.level][lang === 'zh' ? 'zh' : 'en']}」</span>
              )}
            </div>
          ))}
          {edit && <button className="btn-line sm" style={{ marginTop: 4 }} onClick={() => up(i, { ...p, matrix: [...p.matrix, { bizs: [], level: 3, need: 1 }] })}>＋ {t('能力条件', 'Matrix condition')}</button>}
          <div style={{ marginTop: 4 }}>
            {p.mentees > 0 || edit ? <span>· {t('带教新人走完新人期', 'Mentees through the induction')}: {edit ? <input className="in sm" type="number" min={0} max={10} style={{ width: 50 }} value={p.mentees} onChange={(e) => up(i, { ...p, mentees: Number(e.target.value) || 0 })} /> : p.mentees}</span> : null}
          </div>
          {(p.kpi || edit) && (
            <div style={{ marginTop: 4 }}>· {t('季度项目分值', 'Quarterly project score')} ≥ {edit
              ? <><input className="in sm" type="number" style={{ width: 60 }} value={p.kpi?.min ?? ''} onChange={(e) => up(i, { ...p, kpi: e.target.value === '' ? null : { min: Number(e.target.value), quarters: p.kpi?.quarters || 2 } })} /> × <input className="in sm" type="number" style={{ width: 50 }} value={p.kpi?.quarters ?? 2} onChange={(e) => up(i, { ...p, kpi: { min: p.kpi?.min ?? 60, quarters: Number(e.target.value) || 2 } })} /> {t('个季度', 'quarters')}</>
              : <>{p.kpi?.min} · {t(`连续 ${p.kpi?.quarters} 个季度(REQ-063 上线前显示「待 KPI 接入」)`, `${p.kpi?.quarters} quarters in a row (shows “waiting for KPI” until REQ-063)`)}</>}
            </div>
          )}
          {p.manual.map((m, j) => (
            <div key={m.id} style={{ marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>· {edit
              ? <><input className="in sm" value={m.zh} onChange={(e) => up(i, { ...p, manual: p.manual.map((x, jj) => (jj === j ? { ...x, zh: e.target.value } : x)) })} /><input className="in sm" value={m.en} placeholder="English" onChange={(e) => up(i, { ...p, manual: p.manual.map((x, jj) => (jj === j ? { ...x, en: e.target.value } : x)) })} /><button className="btn-line sm danger" onClick={() => up(i, { ...p, manual: p.manual.filter((_, jj) => jj !== j) })}>✕</button></>
              : <>{lang === 'zh' ? m.zh : m.en || m.zh} <span style={{ color: 'var(--text2)' }}>({t('PD / BD 手动勾', 'ticked by PD / BD')})</span></>}</div>
          ))}
          {edit && <button className="btn-line sm" style={{ marginTop: 4 }} onClick={() => up(i, { ...p, manual: [...p.manual, { id: rid(), zh: '', en: '' }] })}>＋ {t('手动条件', 'Manual condition')}</button>}
        </div>
      ))}
    </div>
  );
}
