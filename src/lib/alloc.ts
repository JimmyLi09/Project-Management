/* ===== Team allocation / workload derived from live project data ===== */

import { projPoints, projStage } from './project';
import type { Project, User } from './types';

export interface PersonLoad {
  name: string;
  role: string; // display role
  position: string; // job title from the account, if any
  isPM: boolean;
  activeProjects: Project[];
  openTasks: number;
  load: number; // 0-100+
  points: number; // B5: sum of active-project points assigned to this person
  pointCap: number; // B5: workload ceiling in points (0 = no limit set)
}

const isActive = (p: Project) => {
  if (p.archived) return false;
  const s = projStage(p);
  return s !== 'complete' && s !== 'invoice';
};

/* Load heuristic: each active project 20%, each open task 7%, capped at 100. */
export function teamLoads(projects: Project[], users: User[]): PersonLoad[] {
  const map = new Map<string, PersonLoad>();
  const capByName = new Map<string, number>();
  users.forEach((u) => { if (u.pointCap) capByName.set(u.name, u.pointCap); });
  const ensure = (name: string, role: string, isPM: boolean) => {
    if (!map.has(name)) map.set(name, { name, role, position: '', isPM, activeProjects: [], openTasks: 0, load: 0, points: 0, pointCap: capByName.get(name) || 0 });
    return map.get(name)!;
  };

  users.forEach((u) => {
    if (u.role === 'pm') ensure(u.name, 'Project Manager', true).position = u.position || '';
    else if (u.role === 'member') ensure(u.name, 'Production', false).position = u.position || '';
  });

  projects.forEach((p) => {
    const active = isActive(p);
    (p.owners || []).forEach((n) => {
      const pl = ensure(n, 'Project Manager', true);
      if (active && !pl.activeProjects.includes(p)) pl.activeProjects.push(p);
    });
    p.packages.forEach((pk) => pk.schedule.forEach((r) => {
      if (!r.assignee) return;
      const pl = ensure(r.assignee, map.get(r.assignee)?.role || 'Production', map.get(r.assignee)?.isPM ?? false);
      if (active && !pl.activeProjects.includes(p)) pl.activeProjects.push(p);
      if (r.status !== 'done' && active) pl.openTasks++;
    }));
    if (active) {
      (p.owners || []).forEach((n) => {
        p.packages.forEach((pk) => pk.schedule.forEach((r) => {
          if (r.status !== 'done' && !r.assignee) map.get(n)!.openTasks += 0; // unassigned tasks not counted per person
        }));
      });
    }
  });

  const out = [...map.values()];
  out.forEach((pl) => {
    pl.load = Math.min(100, pl.activeProjects.length * 20 + pl.openTasks * 7);
    pl.points = pl.activeProjects.reduce((a, p) => a + projPoints(p), 0);
  });
  return out.sort((a, b) => (a.isPM === b.isPM ? b.load - a.load : a.isPM ? -1 : 1));
}
