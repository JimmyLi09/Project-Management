'use client';

/* ===== REQ-062 · 6 个月课程(技能线) =====
   和新人主线并行,不锁。学员名单 PD / BD 每门课手动选(JM 1112 确认)。
   讲师(PD / BD 或带教人)课后点名:出席 ✓;缺课显示「待补」,补上了再点成出席。
   考核:带教人给「通过 / 未通过」和评语(M5、M6 用讲解评分表),在「待我评估」里做;M4 = 实体模型到「可独立」。 */
import React, { useState } from 'react';
import { useLang } from '@/lib/i18n';
import { useStore } from '../../store';
import { INDEPENDENT, type Course } from '@/lib/train';
import { card, td, th, trainAct, type Bundle } from './shared';

export default function Courses({ b, onData }: { b: Bundle; onData: (b: Bundle) => void }) {
  const { lang, t } = useLang();
  const { setToast, users } = useStore();
  const admin = b.me.admin;
  const lecturer = admin || b.me.eligible;
  const [editing, setEditing] = useState<string | null>(null);
  const [pick, setPick] = useState<string[]>([]);
  const run = async (body: Record<string, unknown>) => {
    const r = await trainAct(body);
    if (!r.ok) { setToast(r.error); return false; }
    onData(r.data); return true;
  };
  const att = (c: string, l: string, u: string) => b.courses.attend.find((a) => a.course === c && a.lesson === l && a.user === u)?.status || '';
  const exam = (c: Course, u: string) => {
    const rows = b.courses.exams.filter((r) => r.user === u && r.key === `course.${c.id}.exam`);
    if (rows.some((r) => r.status === 'passed')) return 'passed';
    return rows.length ? 'failed' : '';
  };
  const visibleRows = (c: Course) => c.participants.filter((n) => lecturer || n === b.me.name || b.me.mentees.includes(n));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel" style={{ ...card, fontSize: 12.5, color: 'var(--text2)' }}>{lang === 'zh' ? b.config.coursesNote.zh : b.config.coursesNote.en || b.config.coursesNote.zh}</div>
      {b.config.courses.map((c) => {
        const rows = visibleRows(c);
        if (!lecturer && !rows.length) return null;
        return (
          <div key={c.id} className="panel clip" data-testid="course" data-id={c.id}>
            <div className="panel-head" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="panel-title">{c.code} · {lang === 'zh' ? c.zh : c.en || c.zh}</span>
              <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>
                {c.lessons.length ? t(`${c.lessons.length} 课`, `${c.lessons.length} lessons`) : ''}
                {c.exam === 'pass' ? t(' + 考核(通过 / 未通过)', ' + assessment (pass / fail)') : c.exam === 'rubric' ? t(' + 考核(讲解评分表)', ' + assessment (presentation rubric)') : c.exam === 'auto' ? t('不单独打分:实体模型到「可独立」就算完成', 'No separate score: done when Scale models reach “Independent”') : ''}
              </span>
              <div style={{ flex: 1 }} />
              {admin && editing !== c.id && <button className="btn-line sm" data-testid="course-people" onClick={() => { setEditing(c.id); setPick(c.participants); }}>{t('学员名单', 'Participants')} ({c.participants.length})</button>}
            </div>
            {editing === c.id && (
              <div style={{ padding: '10px 16px', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', background: '#fbf3e6' }}>
                {users.filter((u) => u.role === 'pm' || u.role === 'member').map((u) => (
                  <label key={u.name} style={{ fontSize: 12.5, display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input type="checkbox" checked={pick.includes(u.name)} data-testid="course-pick" data-name={u.name} onChange={() => setPick(pick.includes(u.name) ? pick.filter((x) => x !== u.name) : [...pick, u.name])} />{u.name}
                  </label>
                ))}
                <div style={{ flex: 1 }} />
                <button className="btn-line sm" onClick={() => setEditing(null)}>{t('取消', 'Cancel')}</button>
                <button className="btn-navy sm" data-testid="course-people-save" onClick={async () => {
                  if (await run({ op: 'config', part: 'courses', value: b.config.courses.map((x) => (x.id === c.id ? { ...x, participants: pick } : x)) })) setEditing(null);
                }}>{t('保存名单', 'Save')}</button>
              </div>
            )}
            {rows.length === 0 ? <div style={{ padding: 16, fontSize: 12.5, color: 'var(--text2)' }}>{t('还没有学员。', 'No participants yet.')}</div> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={th}>{t('学员', 'Participant')}</th>
                    {c.lessons.map((l) => <th key={l.id} style={{ ...th, textAlign: 'center' }}>{lang === 'zh' ? l.zh : l.en || l.zh}</th>)}
                    <th style={th}>{t('考核', 'Assessment')}</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((n) => (
                      <tr key={n} data-testid="course-row" data-name={n}>
                        <td style={td}><b>{n}</b></td>
                        {c.lessons.map((l) => {
                          const s = att(c.id, l.id, n);
                          const next = s === '' ? 'present' : s === 'present' ? 'absent' : '';
                          return (
                            <td key={l.id} style={{ ...td, textAlign: 'center' }}>
                              <button disabled={!lecturer} data-testid="attend" data-lesson={l.id} data-status={s || 'none'}
                                title={lecturer ? t('点一下切换:出席 → 缺课(待补)→ 清空', 'Click to cycle: present → absent (make-up) → clear') : ''}
                                onClick={() => run({ op: 'attend', course: c.id, lesson: l.id, user: n, status: next })}
                                className="badge" style={{ cursor: lecturer ? 'pointer' : 'default', background: s === 'present' ? '#e6f2ec' : s === 'absent' ? '#fdecea' : 'var(--hover-bg)', color: s === 'present' ? '#0f6a48' : s === 'absent' ? '#98342b' : 'var(--text2)' }}>
                                {s === 'present' ? '✓' : s === 'absent' ? t('待补', 'Make-up') : '—'}
                              </button>
                            </td>
                          );
                        })}
                        <td style={td} data-testid="course-exam">
                          {c.exam === 'auto'
                            ? ((b.courses.autoLevels[c.id]?.[n] || 0) >= INDEPENDENT ? <b style={{ color: '#0f6a48' }}>✓ {t('已完成', 'Done')}</b> : <span style={{ color: 'var(--text2)' }}>{t('实体模型还没到可独立', 'Scale models not independent yet')}</span>)
                            : c.exam === 'none' ? '—'
                            : exam(c, n) === 'passed' ? <b style={{ color: '#0f6a48' }}>✓ {t('通过', 'Passed')}</b>
                            : exam(c, n) === 'failed' ? <span style={{ color: '#98342b' }}>{t('未通过', 'Not passed')}</span>
                            : <span style={{ color: 'var(--text2)' }}>{t('待考核', 'Pending')}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
