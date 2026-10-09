'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useStore, useWho } from '../store';
import { useLang } from '@/lib/i18n';
import { canEditIn, canRowEdit } from '@/lib/permissions';
import { isLegacyFlow } from '@/lib/legacyStages';
import { pkgSuffix, projCode } from '@/lib/project';
import { svcName } from '@/lib/templates';
import { CalendarPlanner } from '@/features/schedule-planner/components/CalendarPlanner';
import { isLegacyCgiStages, stageName, type LocalDate, type StageDefinition, type StageSchedule } from '@/features/schedule-planner/domain/schedule';
import type { ScheduleArchive } from '@/features/schedule-planner/domain/archives';
import type { CalendarStage, Project, ScheduleStatus } from '@/lib/types';
import '@/features/schedule-planner/planner.css';

/* ===== REQ-040: 日历式排期 =====
   排期功能本体是用户提供的 stage-calendar-planner,交互一行没改
   (月历点选、拖边界、Exclude Holidays、Reverse plan、增删阶段、导出 PDF)。
   这里只做「接后端」那一层:
   - 打开时把项目里存的 boundaries / 阶段 / 备注喂进去;
   - 「保存到项目」写回 packages[i].calendar,存档也升级成项目级(不再进浏览器本地);
   - 排出来的交付日可选同步到项目交付日,并能导出 .ics 丢进个人日历。
   REQ-048 起这是唯一的排期视图(经典模式去掉了):保存时服务端把每个阶段写回成一行 pkg.schedule,
   待办 / KPI / 负载 / 报表 / 导出照旧读行。负责人、状态挂在行上,在这里直接改(不用等「保存」)。 */
export default function CalendarScheduleTab({ p, pkgIdx }: { p: Project; pkgIdx: number }) {
  const { dispatch, me, setToast, users } = useStore();
  const { lang, t } = useLang();
  const who = useWho();
  const ed = canEditIn(me, p, 'schedule');   // REQ-051: 再过权限表
  const pkg = p.packages[pkgIdx];
  const cal = pkg?.calendar;
  const [syncDelivery, setSyncDelivery] = useState(true);
  const [busy, setBusy] = useState(false);
  /* REQ-047:这项服务的默认阶段(当前生效模板的排期步骤)。取到之前先不画 planner,
     免得先闪一下别的阶段 */
  const [defaults, setDefaults] = useState<StageDefinition[] | null | undefined>(undefined);
  useEffect(() => {
    if (!pkg) return;
    let live = true;
    setDefaults(undefined);
    fetch(`/api/templates/stages?svc=${encodeURIComponent(pkg.svc)}`).then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (live) setDefaults(Array.isArray(b?.stages) && b.stages.length ? b.stages : null); })
      .catch(() => { if (live) setDefaults(null); });
    return () => { live = false; };
  }, [pkg?.svc]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 项目里存的 → planner 认的形状。备注单独抽成 stageId → 文字。 */
  const initialStages = useMemo<StageDefinition[] | undefined>(
    () => (cal?.stages?.length
      ? cal.stages.map((s) => ({ id: s.id, name: s.name, nameEn: s.nameEn, tone: s.tone, ...(s.weeks !== undefined ? { weeks: s.weeks } : {}) }))
      : undefined),
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
      stages: a.stages.map((s) => ({ id: s.id, name: s.name, nameEn: s.nameEn, tone: s.tone })),
      boundaries: a.boundaries as LocalDate[],
    })),
    [cal],
  );

  async function save(payload: { stages: StageDefinition[]; boundaries: LocalDate[]; notes: Record<string, string>; excludeHolidays: boolean }) {
    setBusy(true);
    /* nameEn 只是出厂英文位,用户改过名的阶段 planner 已经把它丢掉了 ——
       这里原样带过去就行,不要自作主张补。 */
    const stages: CalendarStage[] = payload.stages.map((s) => ({
      id: s.id, name: s.name, ...(s.nameEn ? { nameEn: s.nameEn } : {}), tone: s.tone,
      note: payload.notes[s.id] || '',
      ...(s.weeks !== undefined ? { weeks: s.weeks } : {}),
    }));
    const ok = await dispatch(p.id, {
      type: 'saveCalendar', pkg: pkgIdx, stages, boundaries: payload.boundaries, syncDelivery, excludeHolidays: payload.excludeHolidays,
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
        `SUMMARY:${esc(`${title} — ${stageName(s, lang)}`)}`,
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

  /* REQ-047 / 048:已有项目的排期还是某一版老的效果图 / 动画流程 → 提示一次要不要换成新阶段 */
  const legacyFlow = !!cal && !cal.flow048
    && ((pkg.svc === 'cgi' && isLegacyCgiStages(cal.stages)) || isLegacyFlow(pkg.svc, cal.stages.map((x) => x.name)));
  const canUndoFlow = cal?.flow048 === 'switched' && !!cal.flowUndo;
  const NEW_FLOW: Record<string, [string, string]> = {
    cgi: ['效果图流程已更新（Angle → Mood & angle → Material & model，各 2 周），要换成新阶段吗？',
      'The CGI flow has changed (Angle → Mood & angle → Material & model, 2 weeks each). Switch this schedule to the new stages?'],
    ani: ['动画流程已更新（Storyboard → Animation preview → Still frame 1 / 2 → Post production），要换成新阶段吗？',
      'The animation flow has changed (Storyboard → Animation preview → Still frame 1 / 2 → Post production). Switch this schedule to the new stages?'],
  };

  /* REQ-048:阶段行右边 = 这一行的负责人和状态(阶段 id = 行 id)。新加、还没保存的阶段没有行,先保存 */
  const assigneeNames = users.filter((x) => x.role !== 'viewer').map((x) => x.name);
  const STATUS: [ScheduleStatus, string, string][] = [['todo', '未开始', 'Not started'], ['wip', '进行中', 'In progress'], ['done', '已完成', 'Done'], ['block', '受阻', 'Blocked']];
  function stageExtra(stage: StageSchedule) {
    const ri = pkg.schedule.findIndex((r) => r.id === stage.id);
    if (ri < 0) return <span style={{ color: 'var(--text2)' }}>{t('保存后可以指派负责人、改状态', 'Save first to assign an owner and set the status')}</span>;
    const r = pkg.schedule[ri];
    const rowEd = canRowEdit(me, p, r);
    const names = r.assignee && !assigneeNames.includes(r.assignee) ? [r.assignee, ...assigneeNames] : assigneeNames;
    return (
      <>
        <span style={{ color: 'var(--text2)' }}>{t('负责人', 'Owner')}</span>
        {ed ? (
          <select value={r.assignee || ''} data-testid={`stage-owner-${stage.index}`}
            onChange={(e) => dispatch(p.id, { type: 'editSched', pkg: pkgIdx, idx: ri, field: 'assignee', value: e.target.value })}>
            <option value="">{t('未指派', 'Unassigned')}</option>
            {names.map((n) => <option key={n} value={n}>{who(n)}</option>)}
          </select>
        ) : <b data-testid={`stage-owner-${stage.index}`}>{r.assignee ? who(r.assignee) : '—'}</b>}
        <span style={{ color: 'var(--text2)', marginLeft: 6 }}>{t('状态', 'Status')}</span>
        {rowEd ? (
          <select value={r.status} data-testid={`stage-status-${stage.index}`}
            onChange={(e) => dispatch(p.id, { type: 'setRowStatus', pkg: pkgIdx, idx: ri, status: e.target.value as ScheduleStatus })}>
            {STATUS.map(([k, zh, en]) => <option key={k} value={k}>{t(zh, en)}</option>)}
          </select>
        ) : <b data-testid={`stage-status-${stage.index}`}>{t(...(STATUS.find((x) => x[0] === r.status) || STATUS[0]).slice(1) as [string, string])}</b>}
      </>
    );
  }
  async function flow(choice: 'switch' | 'keep' | 'undo') {
    setBusy(true);
    const ok = await dispatch(p.id, { type: 'calendarFlow', pkg: pkgIdx, choice });
    setBusy(false);
    setToast(!ok ? t('操作失败', 'Failed')
      : choice === 'switch' ? t('已换成新阶段，日期按新阶段重新分配（可撤销）', 'Switched to the new stages; dates redistributed (can be undone)')
        : choice === 'undo' ? t('已撤销，恢复原来的阶段和日期', 'Undone — previous stages and dates restored')
          : t('保持原阶段，不再提示', 'Keeping the current stages; won’t ask again'));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="panel" style={{ padding: '11px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: 'var(--text2)', flex: 1, minWidth: 220 }}>
          {cal?.boundaries?.length && cal.version > 0
            ? t(`第 ${cal.version} 版 · ${cal.updatedBy} ${new Date(cal.updatedAt).toLocaleDateString()} 保存`,
                `v${cal.version} · saved by ${cal.updatedBy} on ${new Date(cal.updatedAt).toLocaleDateString()}`)
            : cal?.boundaries?.length
            ? t('按默认阶段自动排好的（上线迁移的就是原来阶段行上的日期），还没在日历上保存过。改完记得点「保存到项目」。',
                'Laid out from the default stages (or, for older projects, from the original stage rows) and not saved on the calendar yet. Hit “Save to project” after changes.')
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

      {ed && legacyFlow && NEW_FLOW[pkg.svc] && (
        <div className="panel" data-testid="cgi-flow-banner" style={{ padding: '11px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: 'var(--warning-bg, #FDF7F1)' }}>
          <span style={{ flex: 1, minWidth: 260, fontSize: 13 }}>
            {t(...NEW_FLOW[pkg.svc])}
            <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text2)' }}>
              {t('换的话，已排好的首日到末日不变，按新阶段的默认工期重新分配；换完可以撤销。',
                'If you switch, the first and last dates stay; the new stages share them by their default durations. You can undo it.')}
            </span>
          </span>
          <button className="btn-navy sm" disabled={busy} onClick={() => flow('switch')} data-testid="cgi-flow-switch">{t('换成新阶段', 'Switch to the new stages')}</button>
          <button className="btn-line sm" disabled={busy} onClick={() => flow('keep')} data-testid="cgi-flow-keep">{t('保持不变', 'Keep as is')}</button>
        </div>
      )}
      {ed && canUndoFlow && (
        <div className="panel" data-testid="cgi-flow-undo" style={{ padding: '9px 16px', display: 'flex', gap: 10, alignItems: 'center', fontSize: 12.5 }}>
          <span style={{ flex: 1, color: 'var(--text2)' }}>{t('已换成新阶段（负责人、状态按新阶段重新填）。', 'Switched to the new stages (set owners and statuses again for the new stages).')}</span>
          <button className="btn-line sm" disabled={busy} onClick={() => flow('undo')} data-testid="cgi-flow-undo-btn">{t('撤销', 'Undo')}</button>
        </div>
      )}

      {/* planner 本体 —— 交互沿用原实现 */}
      {defaults === undefined ? (
        <div className="panel" style={{ padding: 16, fontSize: 13, color: 'var(--text2)' }}>{t('读取中…', 'Loading…')}</div>
      ) : (
      <div className="planner-host">
        <CalendarPlanner
          defaultStages={defaults ?? undefined}
          initialExcludeHolidays={cal ? cal.excludeHolidays !== false : true}
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
                stages: a.stages.map((s) => ({ id: s.id, name: s.name, ...(s.nameEn ? { nameEn: s.nameEn } : {}), tone: s.tone })),
                boundaries: a.boundaries as string[],
              })),
            });
          }}
          onSave={ed ? save : undefined}
          saveLabel={t('保存到项目', 'Save to project')}
          busy={busy}
          stageExtra={stageExtra}
        />
      </div>
      )}
    </div>
  );
}
