/* ===== REQ-052 §2.1 · 我的待办只看「已逾期」和「本周内」 =====
   侧栏数字和「我的待办」列表用这同一个函数 —— 以前侧栏自己数,没排除已归档和售前项目,
   比列表多。一周以后的任务不显示,到时间自然出现(要看去项目排期)。 */

import { pkgStart, planDates, projStage, todayMid, type PlanDate } from './project';
import type { Project, ScheduleRow } from './types';

export const WEEK_DAYS = 7;

export interface MyTask {
  p: Project;
  r: ScheduleRow;
  i: number;                 // 阶段行下标
  pi: number;                // 服务包下标
  svc: string;
  d: PlanDate;
  group: 'overdue' | 'week';
  overdueDays: number;       // 逾期几天(本周内的为 0)
}

/* 这个人的未完成阶段行里,结束日期早于今天(逾期)或在今天到今天 + 7 天之间(本周内)的。
   没有日期的行不算(排不出时间就不知道该不该提醒)。 */
export function myTasks(projects: Project[], me: { name: string; role: string }, today: Date = todayMid()): MyTask[] {
  const t0 = new Date(today); t0.setHours(0, 0, 0, 0);
  const until = new Date(t0); until.setDate(until.getDate() + WEEK_DAYS);
  const seesAll = me.role === 'director' || me.role === 'bd' || me.role === 'sales';
  const out: MyTask[] = [];
  for (const p of projects) {
    if (p.archived) continue;
    if (projStage(p) === 'presales') continue;   // REQ-004 #11:未开始(售前)项目的任务不进待办
    const isOwner = (p.owners || []).includes(me.name);
    p.packages.forEach((pk, pi) => {
      const pd = planDates(pk, pkgStart(p, pk));
      pk.schedule.forEach((r, i) => {
        if (r.status === 'done') return;
        const mine = seesAll ? true
          : me.role === 'member' ? r.assignee === me.name
            : me.role === 'viewer' ? false
              : isOwner || r.assignee === me.name;
        const d = pd[i];
        if (!mine || !d) return;
        if (d.end < t0) out.push({ p, r, i, pi, svc: pk.svc, d, group: 'overdue', overdueDays: Math.round((t0.getTime() - d.end.getTime()) / 86_400_000) });
        else if (d.end <= until) out.push({ p, r, i, pi, svc: pk.svc, d, group: 'week', overdueDays: 0 });
      });
    });
  }
  return out.sort((a, b) => a.d.end.getTime() - b.d.end.getTime());
}

/* 保修到期提醒同一个时间范围:已过期没联系的 + 7 天内到期的 */
export const withinWeek = (daysLeft: number | null) => daysLeft !== null && daysLeft <= WEEK_DAYS;
