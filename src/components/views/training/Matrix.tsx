'use client';

/* ===== REQ-062 · 能力矩阵(人 × 业务) =====
   行是人,列是 7 个业务,格子是级别;另有职位、PM 级别、带教人、新人期进度。
   谁能看:PD / BD 全部;带教人自己和带的人;PM 只看自己(后端给的就是这个范围)。
   点格子看「凭什么升上来的」;PD / BD 可以手动调(必须写原因)、上线时一次初始化、指定带教人、开始新人期、改 PM 级别、
   开关「派项目限制」。晋级条件清单只显示满足了哪些,不自动晋级。 */
import React, { useState } from 'react';
import { useLang } from '@/lib/i18n';
import { useStore } from '../../store';
import { LEVELS, PM_LEVELS, TRAIN_BIZ, bizLabel } from '@/lib/train';
import { LvBadge, ScoreLine, card, fmtDay, sourceName, td, th, trainAct, type Bundle, type MatrixRow } from './shared';

function CellModal({ b, row, biz, onClose, onData }: { b: Bundle; row: MatrixRow; biz: string; onClose: () => void; onData: (b: Bundle) => void }) {
  const { lang, t } = useLang();
  const { setToast } = useStore();
  const [lv, setLv] = useState(row.levels[biz] || 0);
  const [reason, setReason] = useState('');
  const log = b.log.filter((r) => r.user === row.name && r.biz === biz);
  const ev = b.assess.filter((a) => a.user === row.name && a.key.startsWith(`${biz}.`));
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 640, maxHeight: '86vh', overflow: 'auto' }} data-testid="cell-modal">
        <h2>{row.name} · {bizLabel(biz, lang)} <LvBadge v={row.levels[biz] || 0} /></h2>
        {row.teachHint.includes(biz) && <div style={{ fontSize: 12.5, color: '#7A4FB5', marginBottom: 8 }}>💡 {t('已经独立带过 3 个以上这个业务的项目,可以考虑给「可带教」。', 'Has led 3+ projects in this service — consider “Can mentor”.')}</div>}
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text2)', margin: '8px 0 4px' }}>{t('级别变化', 'Level changes')}</div>
        {log.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>{t('还没有记录。', 'No changes yet.')}</div>}
        {log.map((r) => (
          <div key={r.id} data-testid="log-row" style={{ fontSize: 12.5, padding: '5px 0', borderTop: '1px solid var(--row-line2)' }}>
            {new Date(r.at).toLocaleDateString()} · {LEVELS[r.from_level]?.[lang === 'zh' ? 'zh' : 'en']} → <b>{LEVELS[r.to_level]?.[lang === 'zh' ? 'zh' : 'en']}</b> · {sourceName(r.source, lang)} · {r.by}
            {r.reason && <span style={{ color: 'var(--text2)' }}> · {t('原因:', 'Reason: ')}{r.reason}</span>}
          </div>
        ))}
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text2)', margin: '12px 0 4px' }}>{t('评估依据', 'Assessment evidence')}</div>
        {ev.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>{t('还没有评估记录。', 'No assessments yet.')}</div>}
        {ev.map((a) => (a.kind === 'task'
          ? <div key={a.id} style={{ fontSize: 12, borderTop: '1px dashed var(--row-line)', paddingTop: 6, marginTop: 6 }}>{t('实操', 'Task')} · <b>{a.status === 'approved' ? t('通过', 'Approved') : t('退回', 'Returned')}</b> · {t('签核', 'by')} {a.doneBy} {a.doneAt ? new Date(a.doneAt).toLocaleDateString() : ''}{a.comment ? ` · ${a.comment}` : ''}</div>
          : <ScoreLine key={a.id} a={a} cfg={b.config} />))}
        {b.me.admin && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--row-line)', paddingTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }} data-testid="manual-adjust">
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>{t('手动调整', 'Manual change')}</span>
            <select className="in sm" value={lv} onChange={(e) => setLv(Number(e.target.value))} data-testid="adj-level">
              {LEVELS.map((l) => <option key={l.v} value={l.v}>{lang === 'zh' ? l.zh : l.en}</option>)}
            </select>
            <input className="in sm" style={{ flex: 1, minWidth: 200 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('原因(必填)', 'Reason (required)')} data-testid="adj-reason" />
            <button className="btn-navy sm" disabled={!reason.trim() || lv === (row.levels[biz] || 0)} data-testid="adj-save" onClick={async () => {
              const r = await trainAct({ op: 'setLevel', user: row.name, biz, level: lv, reason });
              if (!r.ok) { setToast(r.error); return; }
              onData(r.data); onClose();
            }}>{t('保存', 'Save')}</button>
          </div>
        )}
        <div className="modal-actions"><button className="btn-line" onClick={onClose}>{t('关闭', 'Close')}</button></div>
      </div>
    </div>
  );
}

function PromoModal({ b, row, onClose, onData }: { b: Bundle; row: MatrixRow; onClose: () => void; onData: (b: Bundle) => void }) {
  const { lang, t } = useLang();
  const { setToast } = useStore();
  const p = row.promo;
  if (!p) return null;
  const name = (v: string) => PM_LEVELS.find((x) => x.v === v)?.en || v;
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 560 }} data-testid="promo-modal">
        <h2>{row.name} · {name(p.from)} → {name(p.to)}</h2>
        <div className="msub">{t('系统只显示满足了哪些,不会自动晋级;PM 级别由 PD / BD 在矩阵里改。', 'This only shows what is met — nobody is promoted automatically; PD / BD change the PM level in the matrix.')}</div>
        {p.items.map((it) => (
          <div key={it.id} data-testid="promo-item" data-met={it.met === null ? 'na' : it.met ? '1' : '0'} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 0', borderTop: '1px solid var(--row-line2)', fontSize: 13 }}>
            <span style={{ width: 20, color: it.met ? '#0f6a48' : it.met === null ? 'var(--text2)' : '#98342b' }}>{it.met === null ? '…' : it.met ? '✓' : '○'}</span>
            <span style={{ flex: 1 }}>{lang === 'zh' ? it.zh : it.en}</span>
            {!it.auto && b.me.admin && (
              <button className="btn-line sm" data-testid="promo-toggle" onClick={async () => {
                const r = await trainAct({ op: 'promoCheck', user: row.name, item: `${p.id}.${it.id.slice(2)}`, done: !it.met });
                if (!r.ok) { setToast(r.error); return; }
                onData(r.data);
              }}>{it.met ? t('取消勾', 'Untick') : t('勾上', 'Tick')}</button>
            )}
            {!it.auto && !b.me.admin && <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{t('PD / BD 勾', 'ticked by PD / BD')}</span>}
          </div>
        ))}
        <div className="modal-actions"><button className="btn-line" onClick={onClose}>{t('关闭', 'Close')}</button></div>
      </div>
    </div>
  );
}

export default function Matrix({ b, onData }: { b: Bundle; onData: (b: Bundle) => void }) {
  const { lang, t } = useLang();
  const { setToast } = useStore();
  const [cell, setCell] = useState<{ row: MatrixRow; biz: string } | null>(null);
  const [promo, setPromo] = useState<MatrixRow | null>(null);
  const [init, setInit] = useState(false);
  const [grid, setGrid] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const rows = b.matrix || [];
  const admin = b.me.admin;
  const mentors = b.users.filter((u) => u.eligible);
  const run = async (body: Record<string, unknown>) => {
    const r = await trainAct(body);
    if (!r.ok) { setToast(r.error); return false; }
    onData(r.data); return true;
  };
  const changed = Object.entries(grid).filter(([k, v]) => { const [u, biz] = k.split('|'); return (rows.find((r) => r.name === u)?.levels[biz] || 0) !== v; });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {admin && (
        <div className="panel" style={{ ...card, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }} data-testid="gate-panel">
          <div style={{ flex: 1, minWidth: 260 }}>
            <b style={{ fontSize: 13.5 }}>{t('派项目限制', 'Assignment rule')}</b>
            <span className="badge" data-testid="gate-state" style={{ marginLeft: 8, background: b.gateOn ? '#e6f2ec' : '#f1efea', color: b.gateOn ? '#0f6a48' : '#8A8478' }}>{b.gateOn ? t('已打开', 'On') : t('关闭', 'Off')}</span>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>{t('打开后:没到「可协助」的人不能当负责 PM(PD / BD 指派也拦)。关着只提醒。先把现有 PM 的级别初始化完,再打开。已经指派好的项目不受影响。', 'When on, nobody below “Can assist” can be lead PM (PD / BD included). When off, it only warns. Initialise the matrix first, then switch it on. Existing assignments are not affected.')}</div>
          </div>
          <button className={b.gateOn ? 'btn-line sm' : 'btn-navy sm'} data-testid="gate-toggle" onClick={() => {
            if (!confirm(b.gateOn ? t('关闭派项目限制?之后只提醒、不拦。', 'Switch the assignment rule off? It will only warn.') : t('打开派项目限制?确认能力矩阵已经初始化完。', 'Switch the assignment rule on? Make sure the matrix is initialised.'))) return;
            run({ op: 'gate', on: !b.gateOn });
          }}>{b.gateOn ? t('关闭', 'Switch off') : t('打开', 'Switch on')}</button>
        </div>
      )}
      <div className="panel clip">
        <div className="panel-head" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="panel-title">{t('能力矩阵(人 × 业务)', 'Competency matrix (people × services)')}</span>
          <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{admin ? t('PD / BD 看全部 · 点格子看评估记录', 'PD / BD see everyone · click a cell for the evidence') : t('只看得到自己和自己带的人', 'You see yourself and the people you mentor')}</span>
          <div style={{ flex: 1 }} />
          {LEVELS.map((l) => <LvBadge key={l.v} v={l.v} small />)}
          {admin && <button className="btn-line sm" data-testid="init-toggle" onClick={() => { setInit(!init); setGrid({}); }}>{init ? t('退出初始化', 'Leave set-up') : t('初始化矩阵', 'Initialise')}</button>}
        </div>
        {init && (
          <div style={{ padding: '10px 16px', display: 'flex', gap: 8, alignItems: 'center', background: '#fbf3e6', flexWrap: 'wrap' }} data-testid="init-bar">
            <span style={{ fontSize: 12.5 }}>{t('直接在格子里选级别;原因统一填一次。', 'Pick levels in the cells; one reason covers them all.')}</span>
            <input className="in sm" style={{ flex: 1, minWidth: 220 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('原因,如「上线初始化(按 11 月评估)」', 'Reason, e.g. “Go-live set-up (November review)”')} data-testid="init-reason" />
            <button className="btn-navy sm" disabled={!changed.length} data-testid="init-save" onClick={async () => {
              if (await run({ op: 'initLevels', reason, rows: changed.map(([k, v]) => { const [user, biz] = k.split('|'); return { user, biz, level: v }; }) })) { setInit(false); setGrid({}); }
            }}>{t(`保存 ${changed.length} 格`, `Save ${changed.length} cells`)}</button>
          </div>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 1280, borderCollapse: 'collapse' }} data-testid="matrix">
            <thead>
              <tr>
                <th style={th}>{t('成员', 'Member')}</th>
                <th style={th}>{t('PM 级别', 'PM level')}</th>
                <th style={th}>{t('带教人', 'Mentor')}</th>
                <th style={th}>{t('新人期', 'Induction')}</th>
                {TRAIN_BIZ.map((bz) => <th key={bz.key} style={{ ...th, textAlign: 'center' }}>{lang === 'zh' ? bz.zh : bz.en}</th>)}
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} data-testid="matrix-row" data-name={r.name}>
                  <td style={{ ...td, minWidth: 110 }}><b>{r.name}</b>{r.position && <div style={{ fontSize: 11, color: 'var(--text2)' }}>{t('职位:', 'Title: ')}{r.position}</div>}</td>
                  <td style={td}>
                    {admin
                      ? <select className="in sm" style={{ width: 'auto', minWidth: 120 }} value={r.pmLevel} data-testid="pm-level" onChange={(e) => run({ op: 'setPmLevel', user: r.name, level: e.target.value })}>
                          <option value="">—</option>
                          {PM_LEVELS.map((l) => <option key={l.v} value={l.v}>{l.en}</option>)}
                        </select>
                      : (PM_LEVELS.find((l) => l.v === r.pmLevel)?.en || '—')}
                  </td>
                  <td style={td}>
                    {admin
                      ? <select className="in sm" style={{ width: 'auto', minWidth: 90 }} value={r.mentor} data-testid="mentor-select" onChange={(e) => run({ op: 'setMentor', user: r.name, mentor: e.target.value })}>
                          <option value="">—</option>
                          {mentors.filter((m) => m.name !== r.name).map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                        </select>
                      : (r.mentor || '—')}
                  </td>
                  <td style={{ ...td, fontSize: 12, minWidth: 150 }}>
                    {r.noviceStart != null
                      ? <span data-testid="novice-cell">{r.noviceDone ? <b style={{ color: '#0f6a48' }}>{t('已完成', 'Done')}</b> : r.selected.length ? t(`${r.selected.length} 个业务 · ${r.assistCount} 个到可协助`, `${r.selected.length} services · ${r.assistCount} at Can assist`) : t(`${fmtDay(r.noviceStart)} 开始 · 待定级`, `Since ${fmtDay(r.noviceStart)} · awaiting placement`)}
                          {r.overdueDays > 0 && <span style={{ color: '#98342b' }}> · {t(`超 ${r.overdueDays} 天`, `${r.overdueDays}d late`)}</span>}</span>
                      : admin && r.role === 'pm'
                        ? <button className="btn-line sm" style={{ whiteSpace: 'nowrap' }} data-testid="start-novice" disabled={!r.mentor} title={!r.mentor ? t('先指定带教人', 'Assign a mentor first') : ''}
                            onClick={() => confirm(t(`给 ${r.name} 开始新人期?`, `Start ${r.name}'s induction?`)) && run({ op: 'startNovice', user: r.name })}>{t('开始新人期', 'Start induction')}</button>
                        : <span style={{ color: 'var(--text2)' }}>—</span>}
                  </td>
                  {TRAIN_BIZ.map((bz) => {
                    const k = `${r.name}|${bz.key}`;
                    const v = grid[k] ?? r.levels[bz.key] ?? 0;
                    return (
                      <td key={bz.key} style={{ ...td, textAlign: 'center' }}>
                        {init
                          ? <select className="in sm" value={v} data-testid="init-cell" data-user={r.name} data-biz={bz.key} onChange={(e) => setGrid({ ...grid, [k]: Number(e.target.value) })}>
                              {LEVELS.map((l) => <option key={l.v} value={l.v}>{lang === 'zh' ? l.zh : l.en}</option>)}
                            </select>
                          : <button data-testid="matrix-cell" data-user={r.name} data-biz={bz.key} data-lv={v} style={{ background: 'none', padding: 0, cursor: 'pointer' }} onClick={() => setCell({ row: r, biz: bz.key })}>
                              <LvBadge v={v} small />{r.teachHint.includes(bz.key) && <span title={t('可以考虑给「可带教」', 'Consider “Can mentor”')}> 💡</span>}
                            </button>}
                      </td>
                    );
                  })}
                  <td style={td}>{r.promo && <button className="btn-line sm" style={{ whiteSpace: 'nowrap' }} data-testid="promo-open" onClick={() => setPromo(r)}>{t('晋级条件', 'Promotion')}</button>}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={12} style={{ ...td, textAlign: 'center', color: 'var(--text2)' }}>{t('还没有人。', 'Nobody yet.')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel clip">
        <div className="panel-head"><span className="panel-title">{t('每一级怎么升上来', 'How each level is reached')}</span><span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{t('7 个业务都一样,内容来自各业务在知识库的 B / C / D 板块', 'The same for all 7 services; content comes from each service\'s B / C / D sections in the knowledge base')}</span></div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>{t('级别', 'Level')}</th><th style={th}>{t('要做什么', 'What to do')}</th><th style={th}>{t('怎么评估', 'Assessment')}</th><th style={th}>{t('谁评', 'Who')}</th></tr></thead>
          <tbody>
            {[
              [1, t('读这个业务的 B 流程、C 清单排期、D 关键节点', 'Read the service\'s B flow, C checklist & schedule, D milestones'), t('小测验 ≥ 及格线 + 讲解 Presentation(讲这个业务的完整流程)', 'Quiz at or above the pass mark + a presentation of the whole workflow'), t('系统 + 带教人', 'System + mentor')],
              [2, t('实战一:跟 1 个项目(参加交接会、看完每个确认节点)', 'Practice 1: shadow a project (handover meeting, every sign-off)'), t('带教人签核 + 模拟演练(接 brief、写邮件)', 'Mentor sign-off + simulations (brief, email)'), t('带教人', 'Mentor')],
              [3, t('实战二:协助 1 个项目(至少负责 2 个节点)· 实战三:独立带 1 个项目', 'Practice 2: assist on a project (own 2+ milestones) · Practice 3: lead a project'), t('带教人签核 + 项目复盘讲解', 'Mentor sign-off + project review presentation'), t('带教人', 'Mentor')],
              [4, t('独立带过 ≥ 3 个这个业务的项目', 'Has led 3+ projects in this service'), t('PD / BD 指定', 'Set by PD / BD'), 'PD / BD'],
            ].map(([v, a, c, w]) => (
              <tr key={String(v)}><td style={td}><LvBadge v={Number(v)} small /></td><td style={td}>{a}</td><td style={td}>{c}</td><td style={td}>{w}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {cell && <CellModal b={b} row={rows.find((r) => r.name === cell.row.name) || cell.row} biz={cell.biz} onClose={() => setCell(null)} onData={onData} />}
      {promo && <PromoModal b={b} row={rows.find((r) => r.name === promo.name) || promo} onClose={() => setPromo(null)} onData={onData} />}
    </div>
  );
}
