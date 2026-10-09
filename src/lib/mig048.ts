/* ===== REQ-048 上线迁移:每个业务一份日历,阶段 = 阶段行 =====
   服务端第一次启动时跑一次(server/db.ts,meta 记 mig.req048.schedule),先备份整个库,出报告。
   这里是对单个项目的纯逻辑,单元测试直接测它。

   每个业务分三种情况:
   · fromRows   只有经典阶段行、没有日历(绝大多数):用阶段行的日期生成日历。行一个字不动 ——
                负责人、状态、备注、日期都在,待办 / KPI / 报表看到的和上线前一样。
   · rowsFromCal 只在日历上排过、阶段行还是建项目时的模板原样(没人填过):用日历重写阶段行,
                原来的行留在 mig048.prevRows(回退用)和 scheduleLegacy(页面上只读可看)。
   · conflict   两边都有内容:阶段行是待办、KPI 读的那份,以它为准重建日历;原来的日历进「存档」
                (日历右侧「存档」里一点就能载回),也留在 mig048.prevCalendar(回退用)。
   已经对上的(阶段 id = 行 id,REQ-048 之后新建的)不动。 */

import { pkgStart, planDates } from './project';
import { calendarFromRows, isStageRow, rowHasInfo, rowsFromCalendar } from './scheduleSync';
import type { CalendarSchedule, Project, ScheduleRow, ServicePackage } from './types';

export interface Mig048Entry {
  project: string;
  pkg: string;
  kind: 'fromRows' | 'rowsFromCal' | 'conflict';
  stages: number;
  dated: boolean;
  adjusted: number;
  undated: number;
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const label = (pk: ServicePackage, i: number) => `${pk.svc}${pk.label ? ' · ' + pk.label : ''} #${i + 1}`;

export function migrateProject048(p: Project, at: number, newId: () => string): Mig048Entry[] {
  const out: Mig048Entry[] = [];
  (p.packages || []).forEach((pk, i) => {
    if (pk.mig048) return;
    const rows = (pk.schedule || []) as ScheduleRow[];
    rows.forEach((r) => { if (!r.id) r.id = newId(); });
    const cal = pk.calendar;
    const dates = () => planDates(pk, pkgStart(p, pk));
    if (!cal || !Array.isArray(cal.stages) || !cal.stages.length) {
      const r = calendarFromRows(rows, dates(), { by: 'REQ-048', at });
      pk.calendar = r.calendar;
      pk.mig048 = { at, kind: 'fromRows', calVersion: r.calendar.version };
      out.push({ project: p.name, pkg: label(pk, i), kind: 'fromRows', stages: r.calendar.stages.length, dated: r.dated, adjusted: r.adjusted, undated: r.undated });
      return;
    }
    const stageRows = rows.filter(isStageRow);
    const ids = new Set(stageRows.map((r) => r.id));
    if (cal.stages.every((s) => ids.has(s.id))) return;   // 已经一一对应
    const touched = stageRows.some((r) => rowHasInfo(r) || r.s || r.e);
    if (!touched) {
      const prevRows = clone(rows);
      pk.schedule = rowsFromCalendar(rows, cal).rows;
      pk.scheduleLegacy = [...(pk.scheduleLegacy || []), ...stageRows.map((r) => ({ ...clone(r), removedAt: at }))];
      pk.mig048 = { at, kind: 'rowsFromCal', calVersion: cal.version, prevRows };
      out.push({ project: p.name, pkg: label(pk, i), kind: 'rowsFromCal', stages: cal.stages.length, dated: cal.boundaries.length > 0, adjusted: 0, undated: 0 });
      return;
    }
    const prevCalendar = clone(cal) as CalendarSchedule;
    const r = calendarFromRows(rows, dates(), { by: 'REQ-048', at });
    const archive = {
      id: `mig048-${at.toString(36)}`, name: '迁移前的日历排期 / Calendar before REQ-048', savedAt: new Date(at).toISOString(),
      stages: cal.stages.map((s) => ({ id: s.id, name: s.name, ...(s.nameEn ? { nameEn: s.nameEn } : {}), tone: s.tone })),
      boundaries: cal.boundaries,
    };
    pk.calendar = { ...r.calendar, version: (cal.version || 0) + 1, archives: [archive, ...(cal.archives || [])].slice(0, 30) };
    pk.mig048 = { at, kind: 'conflict', calVersion: pk.calendar.version, prevCalendar };
    out.push({ project: p.name, pkg: label(pk, i), kind: 'conflict', stages: r.calendar.stages.length, dated: r.dated, adjusted: r.adjusted, undated: r.undated });
  });
  return out;
}
