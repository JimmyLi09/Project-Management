'use client';

/* ===== REQ-048 · 排期:每个业务一份,只有这一种视图 =====
   顶部是业务标签:「全部业务 · 总览」(甘特图,一行一个业务)/ 各业务(同类两份显示「LED-1 / LED-2」)。
   单个业务 = 它自己的甘特图 + 日历排期(阶段列表:开始 / 结束日期、工期、负责人、状态,恢复默认阶段)。
   原来的「经典 / 日历」切换和三种样式都去掉了 —— 样式只在导出时选。
   经典模式里还在用的功能搬到这里:负责人和状态(阶段行上)、导出排期、从项目导入排期、交付日历(甘特图)。
   特殊行(里程碑 / 假日横幅)、临时节点、服务内容(范围项)有数据才显示,只读。 */

import React, { useState } from 'react';
import { useStore, useWho } from '../store';
import CalendarScheduleTab from './CalendarScheduleTab';
import ScheduleGantt from './ScheduleGantt';
import { fmtDate, parseISO, pkgStart, planDates, pkgSuffix } from '@/lib/project';
import { canEditIn, canSubmitCompletionHere } from '@/lib/permissions';
import { svcColor, svcName } from '@/lib/templates';
import { isStageRow } from '@/lib/scheduleSync';
import { useLang } from '@/lib/i18n';
import { Icon, Pill, TM } from '../ui';
import FragmentBar from '../FragmentBar';
import type { Project } from '@/lib/types';

export default function ScheduleTab({ p, pkgIdx, onExport, onPkg }: {
  p: Project; pkgIdx: number; onExport: () => void; onPkg: (i: number) => void;
}) {
  const { lang, t } = useLang();
  const all = pkgIdx < 0 || !p.packages[pkgIdx];
  return (
    <>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }} data-testid="sched-tabs">
        <button className={`chip ${all ? 'active' : ''}`} onClick={() => onPkg(-1)} data-testid="sched-tab-all"
          style={all ? { background: 'var(--navy900)', borderColor: 'var(--navy900)' } : undefined}>
          {t('全部业务 · 总览', 'All services · overview')}
        </button>
        {p.packages.map((pk, i) => (
          <button key={i} className={`chip ${!all && i === pkgIdx ? 'active' : ''}`} data-testid={`sched-tab-${i}`}
            style={!all && i === pkgIdx ? { background: svcColor(pk.svc), borderColor: svcColor(pk.svc) } : undefined}
            onClick={() => onPkg(i)}>
            {svcName(pk.svc, lang)}{pkgSuffix(p, i) ? ' ' + pkgSuffix(p, i) : ''}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="btn-line sm" onClick={onExport} data-testid="sched-export"><Icon name="download" size={13} />{t('导出排期', 'Export Schedule')}</button>
      </div>

      {all ? (
        <>
          <ScheduleGantt p={p} pkgIdx={-1} onPkg={onPkg} />
          <p style={{ fontSize: 12.5, color: 'var(--text2)', margin: '8px 2px 0' }}>
            {t('点上面某个业务（或甘特图里的一行），进入它自己的阶段列表改日期、负责人和状态。',
              'Pick a service above (or click a row in the chart) to edit its dates, owners and statuses.')}
          </p>
        </>
      ) : <PackageSchedule p={p} pkgIdx={pkgIdx} />}

      <CompletionCard p={p} />
    </>
  );
}

function PackageSchedule({ p, pkgIdx }: { p: Project; pkgIdx: number }) {
  const { me, dispatch } = useStore();
  const { lang, t } = useLang();
  const who = useWho();
  const ed = canEditIn(me, p, 'schedule');   // REQ-051: 再过权限表
  const pkg = p.packages[pkgIdx];
  const cal = pkg.calendar;
  const lastEnd = cal && cal.boundaries.length === cal.stages.length + 1 ? cal.boundaries[cal.boundaries.length - 1] : '';
  const pd = planDates(pkg, pkgStart(p, pkg));
  /* 排到的末日 + Buffer 对项目交付日 */
  const finIso = lastEnd || (() => { for (let i = pd.length - 1; i >= 0; i--) if (pd[i]) return fmtIso(pd[i]!.end); return ''; })();
  let slack: React.ReactNode = null;
  const del = parseISO(p.delivery), fin = parseISO(finIso);
  if (del && fin) {
    fin.setDate(fin.getDate() + (pkg.buffer || 0));
    const sl = Math.round((del.getTime() - fin.getTime()) / 86400000);
    slack = sl >= 0
      ? <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: 12.5 }}>✓ {t(`比项目交付日富余 ${sl} 天`, `${sl} days before the project delivery`)}</span>
      : <span style={{ color: 'var(--danger)', fontWeight: 600, fontSize: 12.5 }}>⚠ {t(`超过项目交付日 ${-sl} 天`, `${-sl} days past the project delivery`)}</span>;
  }
  const others = pkg.schedule.map((r, i) => ({ r, i })).filter((x) => !isStageRow(x.r));
  const [legacyOpen, setLegacyOpen] = useState(false);

  return (
    <>
      <div className="panel" style={{ padding: '12px 18px', marginBottom: 12, display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <Field label={t('排到', 'Planned finish')}><b className="tnum">{finIso ? fmtDate(parseISO(finIso)) : '—'}</b></Field>
        <Field label="Buffer">
          {ed ? <input type="number" min={0} className="in sm" style={{ width: 64 }} defaultValue={pkg.buffer || 0} key={`b${pkg.buffer}`}
            onBlur={(e) => (parseInt(e.target.value) || 0) !== (pkg.buffer || 0) && dispatch(p.id, { type: 'setPkgBuffer', pkg: pkgIdx, value: parseInt(e.target.value) || 0 })} />
            : <b className="tnum">{pkg.buffer || 0}</b>}
        </Field>
        <Field label={t('本服务负责', 'Service owner')}>
          {ed ? <input className="in sm" style={{ width: 110 }} defaultValue={pkg.owner || ''} key={`o${pkg.owner}`} placeholder={t('人', 'name')}
            onBlur={(e) => e.target.value !== (pkg.owner || '') && dispatch(p.id, { type: 'setPkgField', pkg: pkgIdx, field: 'owner', value: e.target.value })} />
            : <b>{pkg.owner ? who(pkg.owner) : '—'}</b>}
        </Field>
        <Field label={t('项目交付日', 'Project delivery')}><b className="tnum">{p.delivery ? fmtDate(parseISO(p.delivery)) : '—'}</b></Field>
        <div style={{ flex: 1 }} />
        {slack}
      </div>

      {/* REQ-012: 从别的项目 / 存过的模板导入这一份业务的排期(导入后日历按导入的阶段重建) */}
      {ed && <FragmentBar p={p} pkgIdx={pkgIdx} kind="schedule" />}

      {/* 原来经典模式里的「交付日历」 */}
      <div style={{ marginBottom: 12 }}><ScheduleGantt p={p} pkgIdx={pkgIdx} /></div>

      <CalendarScheduleTab p={p} pkgIdx={pkgIdx} />

      {others.length > 0 && (
        <div className="panel" style={{ padding: '12px 16px', marginTop: 14 }} data-testid="sched-others">
          <div className="mini-label" style={{ marginBottom: 8, fontWeight: 700, color: 'var(--navy900)' }}>
            {t('其他节点（里程碑 / 假日 / 临时节点 · 只读）', 'Other entries (milestones / holidays / ad-hoc nodes · read-only)')}
          </div>
          {others.map(({ r, i }) => (
            <div key={r.id || i} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12.5, padding: '5px 0', borderTop: '1px solid var(--row-line2)' }}>
              <span className="tnum" style={{ color: 'var(--text2)', minWidth: 90 }}>{pd[i] ? fmtDate(pd[i]!.start) : (r.s || '—')}</span>
              <span>{r.kind === 'milestone' ? '⚑ ' : r.kind === 'holiday' ? '▬ ' : '◆ '}{lang === 'en' ? r.taskEn || r.task : r.task}</span>
              {r.assignee && <span style={{ color: 'var(--text2)' }}>· {who(r.assignee)}</span>}
              {!r.kind && <Pill m={TM[r.status]} />}
            </div>
          ))}
        </div>
      )}

      {(pkg.scheduleLegacy?.length || 0) > 0 && (
        <div className="panel" style={{ padding: '10px 16px', marginTop: 14 }} data-testid="sched-legacy">
          <button className="link-button" style={{ fontSize: 12.5, color: 'var(--text2)' }} onClick={() => setLegacyOpen((v) => !v)}>
            {legacyOpen ? '▾' : '▸'} {t(`留底的阶段行（${pkg.scheduleLegacy!.length}，只读）`, `Archived stage rows (${pkg.scheduleLegacy!.length}, read-only)`)}
          </button>
          {legacyOpen && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11.5, color: 'var(--text2)', marginBottom: 4 }}>
                {t('日历上删掉 / 换掉的阶段，原来那一行填过的负责人、状态、备注留在这里，不再计入待办和统计。',
                  'Stages removed or replaced on the calendar keep their owner, status and notes here; they no longer count in tasks or stats.')}
              </div>
              {pkg.scheduleLegacy!.map((r, i) => (
                <div key={(r.id || '') + i} style={{ display: 'flex', gap: 10, fontSize: 12.5, padding: '4px 0', borderTop: '1px solid var(--row-line2)' }}>
                  <span>{lang === 'en' ? r.taskEn || r.task : r.task}</span>
                  {r.assignee && <span style={{ color: 'var(--text2)' }}>· {who(r.assignee)}</span>}
                  <Pill m={TM[r.status]} />
                  {r.note && <span style={{ color: 'var(--text2)' }}>· {r.note}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* C5: resource links — web links / network paths to renders, VR, drone, models */}
      <div className="panel" style={{ padding: '12px 16px', marginTop: 14 }}>
        <div className="mini-label" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: 'var(--navy900)' }}>
          🔗 {t('资料链接(效果图 / VR / 航拍 / 模型 的网盘或路径)', 'Resource links (cloud/paths to renders, VR, drone, models)')}
        </div>
        {ed ? (
          <textarea className="in" style={{ width: '100%', minHeight: 44, fontSize: 12.5 }}
            defaultValue={pkg.resourceLinks || ''} placeholder={t('每行一个链接或路径,例如 \\\\NAS\\Project\\renders 或 https://drive...', 'One link/path per line, e.g. \\\\NAS\\Project\\renders or https://drive...')}
            onBlur={(e) => e.target.value !== (pkg.resourceLinks || '') && dispatch(p.id, { type: 'setPkgField', pkg: pkgIdx, field: 'resourceLinks', value: e.target.value })} />
        ) : (
          <div style={{ fontSize: 12.5, color: pkg.resourceLinks ? 'var(--text)' : 'var(--text2)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {pkg.resourceLinks || t('（未填写）', '(none)')}
          </div>
        )}
      </div>

      {/* R5-3 服务内容 / 交付清单:有数据才显示,只读(交付内容以 Job Record 为准) */}
      {(pkg.scopeItems?.length || 0) > 0 && (
        <div className="panel" style={{ padding: '12px 16px', marginTop: 14 }} data-testid="sched-scope">
          <div className="mini-label" style={{ marginBottom: 8, fontWeight: 700, color: 'var(--navy900)' }}>
            📋 {t('服务内容 / 交付清单（只读）', 'Service scope / deliverables (read-only)')}
          </div>
          {pkg.scopeItems!.map((s, si) => (
            <div key={si} style={{ display: 'grid', gridTemplateColumns: 'minmax(160px,1.6fr) 90px minmax(200px,2.4fr)', gap: 10, padding: '6px 0', borderTop: '1px solid var(--row-line2)' }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{s.item || '—'}</div>
              <div className="tnum" style={{ fontSize: 13 }}>{s.qty || '—'}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text2)', whiteSpace: 'pre-wrap' }}>{s.note || '—'}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

const fmtIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function CompletionCard({ p }: { p: Project }) {
  const { me, dispatch } = useStore();
  const { t } = useLang();
  const who = useWho();
  const [summary, setSummary] = useState('');
  const [links, setLinks] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const h = p.handover;
  const cr = p.completionReview;
  /* 还没接单就没有「完工」可言 */
  if (!canSubmitCompletionHere(me, p) || !h || h.status !== 'accepted' || !cr) return null;

  const approved = cr.approval?.status === 'approved';
  const pending = cr.status === 'submitted' && !approved;
  const returned = cr.approval?.status === 'changes_requested' || cr.approval?.status === 'rejected';

  /* 已提交 / 已批准 —— 收成一行状态,不占版面 */
  if (pending || approved) {
    return (
      <div className="panel" style={{ padding: '12px 16px', marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy900)' }}>{t('完工提交', 'Completion')}</span>
        {approved ? (
          <span style={{ fontSize: 12.5, color: 'var(--success)', fontWeight: 600 }}>
            ✓ {t('PD 已批准 · 制作完成', 'PD approved · production completed')}
          </span>
        ) : (
          <span style={{ fontSize: 12.5, color: 'var(--warning)', fontWeight: 600 }}>{t('待 PD 审批', 'Awaiting PD approval')}</span>
        )}
        <span style={{ fontSize: 12, color: 'var(--text2)' }}>
          · {who(cr.submittedBy)} {cr.submittedAt ? fmtDate(new Date(cr.submittedAt)) : ''}
        </span>
      </div>
    );
  }

  return (
    <div className="panel" style={{ padding: '14px 16px', marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy900)' }}>
          ✅ {t('制作做完了?提交完工', 'Production done? Submit completion')}
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>
          {t('提交后交由 PD 审批,通过即进入开票流程。', 'Goes to PD for approval, then on to invoicing.')}
        </span>
        <div style={{ flex: 1 }} />
        {!open && (
          <button className="btn-navy sm" onClick={() => { setSummary(cr.summary || ''); setLinks(cr.links || ''); setOpen(true); }}>
            {returned ? t('重新提交', 'Resubmit') : t('提交完工', 'Submit completion')}
          </button>
        )}
      </div>

      {returned && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--danger)', background: '#fbe9e7', borderRadius: 8, padding: '8px 11px' }}>
          {t('PD 退回', 'Returned by PD')}{cr.approval?.note ? ' — ' + cr.approval.note : ''} · {t('请修正后重新提交', 'fix and resubmit')}
        </div>
      )}

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 12 }}>
          <textarea className="in" style={{ minHeight: 60 }} value={summary} onChange={(e) => setSummary(e.target.value)}
            placeholder={t('完成说明:交付了什么 / 版本 / 备注…', 'What was delivered / version / notes…')} />
          <input className="in sm" value={links} onChange={(e) => setLinks(e.target.value)}
            placeholder={t('成品链接 / 路径(可多行)', 'Deliverable links / paths')} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-navy sm" disabled={busy}
              onClick={async () => {
                setBusy(true);
                const ok = await dispatch(p.id, { type: 'submitCompletion', summary, links });
                setBusy(false);
                if (ok) setOpen(false);
              }}>{t('确认提交', 'Submit')}</button>
            <button className="btn-line sm" onClick={() => setOpen(false)}>{t('取消', 'Cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}


function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* D5: bolder / darker header labels */}
      <span className="mini-label" style={{ fontWeight: 700, color: 'var(--navy900)', letterSpacing: '.02em' }}>{label}</span>
      <span style={{ fontSize: 13 }}>{children}</span>
    </div>
  );
}
