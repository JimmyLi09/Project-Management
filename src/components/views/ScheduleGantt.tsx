'use client';

/* ===== REQ-048 · 排期甘特图 =====
   「全部业务 · 总览」:每个业务一行,各阶段一段色块(序号 + 阶段名),红线是今天;点一行进那个业务。
   单个业务:每个阶段一行,色块上写起止日期 —— 就是原来经典模式里的「交付日历」。
   日期取日历(分界点);还没在日历上排的业务,退回阶段行上算出来的日期(和待办、报表同一份)。 */

import React, { useMemo } from 'react';
import { useLang } from '@/lib/i18n';
import { fmtDate, pkgStart, pkgSuffix, planDates, todayMid } from '@/lib/project';
import { svcColor, svcName } from '@/lib/templates';
import { isStageRow } from '@/lib/scheduleSync';
import { deriveSchedules, stageName, type LocalDate } from '@/features/schedule-planner/domain/schedule';
import type { Project, ServicePackage } from '@/lib/types';

interface Seg { name: string; start: Date; end: Date }
const day = 86400000;
const at = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };

export function segmentsOf(p: Project, pk: ServicePackage, lang: 'zh' | 'en'): Seg[] {
  const cal = pk.calendar;
  if (cal && cal.stages.length && cal.boundaries.length === cal.stages.length + 1) {
    return deriveSchedules(cal.boundaries as LocalDate[], cal.stages.map((s) => ({ ...s })))
      .filter((s) => s.start && s.end)
      .map((s) => ({ name: stageName(s, lang), start: at(s.start!), end: at(s.end!) }));
  }
  const pd = planDates(pk, pkgStart(p, pk));
  return pk.schedule.flatMap((r, i) => (isStageRow(r) && pd[i]
    ? [{ name: (lang === 'en' ? r.taskEn || r.task : r.task) || r.phase, start: pd[i]!.start, end: pd[i]!.end }] : []));
}

export default function ScheduleGantt({ p, pkgIdx, onPkg }: { p: Project; pkgIdx: number; onPkg?: (i: number) => void }) {
  const { lang, t } = useLang();
  const all = pkgIdx < 0;
  const rows = useMemo(() => {
    if (all) {
      return p.packages.map((pk, i) => ({
        key: `p${i}`, pi: i, label: svcName(pk.svc, lang) + (pkgSuffix(p, i) ? ' ' + pkgSuffix(p, i) : ''),
        color: svcColor(pk.svc), segs: segmentsOf(p, pk, lang),
      }));
    }
    const pk = p.packages[pkgIdx];
    return segmentsOf(p, pk, lang).map((s, k) => ({ key: `s${k}`, pi: pkgIdx, label: `${String(k + 1).padStart(2, '0')} ${s.name}`, color: svcColor(pk.svc), segs: [s] }));
  }, [p, pkgIdx, all, lang]);

  const t0 = todayMid();
  const segs = rows.flatMap((r) => r.segs);
  if (!segs.length) {
    return (
      <div className="panel" style={{ padding: '14px 18px', fontSize: 12.5, color: 'var(--text2)' }} data-testid="gantt-empty">
        {all ? t('各业务都还没有排日期。点上面某个业务，在日历上选开始日期。', 'No dates yet. Pick a service above and choose a start date on its calendar.')
          : t('还没有排日期 —— 在下面的日历上选开始日期。', 'No dates yet — pick a start date on the calendar below.')}
      </div>
    );
  }
  let from = new Date(Math.min(...segs.map((s) => s.start.getTime())));
  const to = new Date(Math.max(...segs.map((s) => s.end.getTime()), t0.getTime()));
  /* 从那一周的周一开始画 */
  from = new Date(from.getFullYear(), from.getMonth(), from.getDate() - ((from.getDay() + 6) % 7));
  const span = Math.max(28, Math.round((to.getTime() - from.getTime()) / day) + 8);
  const weeks = Math.ceil(span / 7);
  const total = weeks * 7;
  const pos = (d: Date) => ((d.getTime() - from.getTime()) / day / total) * 100;
  const width = (s: Seg) => ((Math.round((s.end.getTime() - s.start.getTime()) / day) + 1) / total) * 100;
  const labelW = all ? 140 : 220;
  const todayIn = t0 >= from && pos(t0) <= 100;

  return (
    <div className="panel" style={{ padding: '12px 14px', overflowX: 'auto' }} data-testid={all ? 'gantt-all' : 'gantt-pkg'}>
      <div style={{ minWidth: labelW + weeks * 46 }}>
        <div style={{ display: 'flex', fontSize: 10.5, color: 'var(--text2)', borderBottom: '1px solid var(--row-line)' }}>
          <div style={{ width: labelW, flexShrink: 0, padding: '4px 0', fontWeight: 700 }}>{all ? t('业务', 'Service') : t('阶段', 'Stage')}</div>
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${weeks}, 1fr)` }}>
            {Array.from({ length: weeks }, (_, i) => (
              <div key={i} className="tnum" style={{ padding: '4px 0', textAlign: 'center', borderLeft: '1px solid var(--row-line2)' }}>
                {fmtDate(new Date(from.getFullYear(), from.getMonth(), from.getDate() + i * 7)).slice(0, 6)}
              </div>
            ))}
          </div>
        </div>
        {rows.map((r) => (
          <div key={r.key} data-testid="gantt-row" style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--row-line2)', cursor: all && onPkg ? 'pointer' : undefined }}
            onClick={all && onPkg ? () => onPkg(r.pi) : undefined} title={all ? t('点开这个业务的阶段列表', 'Open this service’s stages') : undefined}>
            <div style={{ width: labelW, flexShrink: 0, padding: '6px 8px 6px 0', fontSize: 12.5, fontWeight: all ? 700 : 500, color: all ? r.color : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.label}
            </div>
            <div style={{ flex: 1, position: 'relative', height: 26 }}>
              {r.segs.map((s, k) => (
                <div key={k} data-testid="gantt-bar"
                  title={`${s.name} · ${fmtDate(s.start)} → ${fmtDate(s.end)}`}
                  style={{
                    position: 'absolute', top: 4, height: 18, left: `${pos(s.start)}%`, width: `${width(s)}%`,
                    background: r.color, opacity: all ? (k % 2 ? 0.62 : 0.85) : 0.8, borderRight: '2px solid #fff', borderRadius: 3,
                    color: '#fff', fontSize: 10.5, lineHeight: '18px', padding: '0 4px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                  }}>
                  {all ? `${k + 1} ${s.name}` : `${fmtDate(s.start).slice(0, 6)} → ${fmtDate(s.end).slice(0, 6)}`}
                </div>
              ))}
              {todayIn && <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${pos(t0)}%`, width: 2, background: '#d0453b' }} />}
            </div>
          </div>
        ))}
        <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 6 }}>{t('红线 = 今天', 'Red line = today')}</div>
      </div>
    </div>
  );
}
