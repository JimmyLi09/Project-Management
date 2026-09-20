'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { useLang } from '@/lib/i18n';
import { canEdit } from '@/lib/permissions';
import { pkgSuffix, projCode } from '@/lib/project';
import { svcName } from '@/lib/templates';
import { CalendarPlanner } from '@/features/schedule-planner/components/CalendarPlanner';
import type { LocalDate, StageDefinition } from '@/features/schedule-planner/domain/schedule';
import type { ScheduleArchive } from '@/features/schedule-planner/domain/archives';
import type { CalendarStage, Project } from '@/lib/types';
import '@/features/schedule-planner/planner.css';

/* ===== REQ-040: 日历式排期 =====
   排期功能本体是用户提供的 stage-calendar-planner,交互一行没改
   (月历点选、拖边界、Exclude Holidays、Reverse plan、增删阶段、导出 PDF)。
   这里只做「接后端」那一层:
   - 打开时把项目里存的 boundaries / 阶段 / 备注喂进去;
   - 「保存到项目」写回 packages[i].calendar,存档也升级成项目级(不再进浏览器本地);
   - 排出来的交付日可选同步到项目交付日,并能导出 .ics 丢进个人日历。
   与老的经典排期**并存** —— 导出 / KPI / 进度统计读的还是老的 schedule 数组。 */
export default function CalendarScheduleTab({ p, pkgIdx }: { p: Project; pkgIdx: number }) {
  const { dispatch, me, setToast } = useStore();
  const { lang, t } = useLang();
  const ed = canEdit(me, p);
  const pkg = p.packages[pkgIdx];
  const cal = pkg?.calendar;
  const [syncDelivery, setSyncDelivery] = useState(true);
  const [busy, setBusy] = useState(false);

  /* 项目里存的 → planner 认的形状。备注单独抽成 stageId → 文字。 */
  const initialStages = useMemo<StageDefinition[] | undefined>(
    () => (cal?.stages?.length ? cal.stages.map((s) => ({ id: s.id, name: s.name, tone: s.tone })) : undefined),
    [cal],
  );
  const initialBoundaries = useMemo<LocalDate[] | undefined>(
    () => (cal?.boundaries?.length ? (cal.boundaries as LocalDate[]) : undefined),
    [cal],
  );
  const initialNotes = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    (cal?.stages || []).forEach((s) => { if (s.note) out[s.id] = s.note; });
    return out;
  }, [cal]);

  const archives = useMemo<ScheduleArchive[]>(
    () => (cal?.archives || []).map((a) => ({
      id: a.id, name: a.name, savedAt: a.savedAt,
      stages: a.stages.map((s) => ({ id: s.id, name: s.name, tone: s.tone })),
      boundaries: a.boundaries as LocalDate[],
    })),
    [cal],
  );

  async function save(payload: { stages: StageDefinition[]; boundaries: LocalDate[]; notes: Record<string, string> }) {
    setBusy(true);
    const stages: CalendarStage[] = payload.stages.map((s) => ({
      id: s.id, name: s.name, tone: s.tone, note: payload.notes[s.id] || '',
    }));
    const ok = await dispatch(p.id, {
      type: 'saveCalendar', pkg: pkgIdx, stages, boundaries: payload.boundaries, syncDelivery,
    });
    setBusy(false);
    setToast(ok
      ? (syncDelivery && payload.boundaries.length
          ? t('排期已存进项目,交付日同步为 ' + payload.boundaries[payload.boundaries.length - 1],
              'Schedule saved; delivery date synced to ' + payload.boundaries[payload.boundaries.length - 1])
          : t('排期已存进项目', 'Schedule saved to the project'))
      : t('保存失败', 'Save failed'));
  }

  /* .ics:单向订阅 —— 把每个阶段作为一个全天事件推到个人日历。
     阶段是「含头含尾」的区间,而 ics 的 DTEND 是**不含**的,所以末日要 +1 天。 */
  function exportIcs() {
    const stages = cal?.stages || [];
    const b = cal?.boundaries || [];
    if (b.length !== stages.length + 1) { setToast(t('还没有排完整的排期', 'No complete schedule yet')); return; }
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = (d: string) => d.replace(/-/g, '');
    const plusDay = (d: string) => {
      const x = new Date(d + 'T12:00:00');
      x.setDate(x.getDate() + 1);
      return `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}`;
    };
    const esc = (s: string) => s.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
    const title = `${projCode(p) ? projCode(p) + ' ' : ''}${p.name} · ${svcName(pkg.svc, lang)}${pkgSuffix(p, pkgIdx) ? ' ' + pkgSuffix(p, pkgIdx) : ''}`;
    const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Audax//Project Platform//EN', 'CALSCALE:GREGORIAN',
      `X-WR-CALNAME:${esc(title)}`,
    ];
    stages.forEach((s, i) => {
      lines.push(
        'BEGIN:VEVENT',
        `UID:${p.id}-${pkgIdx}-${s.id}@audax`,
        `DTSTAMP:${now}`,
        `DTSTART;VALUE=DATE:${stamp(b[i])}`,
        `DTEND;VALUE=DATE:${plusDay(b[i + 1])}`,
        `SUMMARY:${esc(`${title} — ${s.name}`)}`,
        ...(s.note ? [`DESCRIPTION:${esc(s.note)}`] : []),
        'END:VEVENT',
      );
    });
    lines.push('END:VCALENDAR');
    const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(projCode(p) || p.name).replace(/[\\/:*?"<>|]/g, '_')}_schedule.ics`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (!pkg) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="panel" style={{ padding: '11px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: 'var(--text2)', flex: 1, minWidth: 220 }}>
          {cal?.boundaries?.length
            ? t(`第 ${cal.version} 版 · ${cal.updatedBy} ${new Date(cal.updatedAt).toLocaleDateString()} 保存`,
                `v${cal.version} · saved by ${cal.updatedBy} on ${new Date(cal.updatedAt).toLocaleDateString()}`)
            : t('在月历上点起始日,再依次点每个阶段的结束日;排完可以拖分界点微调。排完记得点「保存到项目」。',
                'Click a start date, then each stage’s end date; drag the boundaries to fine-tune. Hit “保存到项目” when done.')}
        </span>
        {ed && (
          <label style={{ fontSize: 12, display: 'inline-flex', gap: 6, alignItems: 'center', color: 'var(--text2)' }}
            title={t('保存时把最后一个分界点写回项目交付日', 'On save, write the final boundary back to the project delivery date')}>
            <input type="checkbox" checked={syncDelivery} onChange={(e) => setSyncDelivery(e.target.checked)} />
            {t('同步交付日', 'Sync delivery date')}
          </label>
        )}
        <button className="btn-line sm" onClick={exportIcs} disabled={!cal?.boundaries?.length}
          title={t('导出 .ics 丢进 Google / Outlook 日历(单向订阅)', 'Export .ics for Google / Outlook (one-way)')}>
          ⤓ {t('导出日历 .ics', 'Export .ics')}
        </button>
      </div>

      {/* planner 本体 —— 交互沿用原实现 */}
      <div className="planner-host">
        <CalendarPlanner
          key={`${p.id}:${pkgIdx}`}
          initialStages={initialStages}
          initialBoundaries={initialBoundaries}
          initialNotes={initialNotes}
          archives={archives}
          onArchivesChange={(next) => {
            dispatch(p.id, {
              type: 'saveCalendarArchives', pkg: pkgIdx,
              archives: next.map((a) => ({
                id: a.id, name: a.name, savedAt: a.savedAt,
                stages: a.stages.map((s) => ({ id: s.id, name: s.name, tone: s.tone })),
                boundaries: a.boundaries as string[],
              })),
            });
          }}
          onSave={ed ? save : undefined}
          saveLabel={t('保存到项目', 'Save to project')}
          busy={busy}
        />
      </div>
    </div>
  );
}
