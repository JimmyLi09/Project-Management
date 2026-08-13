/* ===== REQ-012: schedule / checklist fragments =====
   One shape shared by "copy project", "import from another project" and
   "save/apply template", so templates and projects never diverge into two
   data formats — a fragment is literally the slice of a ServicePackage that
   REQ-018 (schedule) / REQ-019 (checklist) already render. */
import { newId } from '@/lib/project';
import type { ChecklistGroup, Project, ScheduleRow, ServicePackage } from '@/lib/types';

export type FragmentKind = 'schedule' | 'checklist';

export interface ScheduleFragment { schedule: ScheduleRow[]; schedStyle?: string }
export interface ChecklistFragment { checklist: ChecklistGroup[]; noCategories?: boolean }
export type Fragment = ScheduleFragment | ChecklistFragment;

/* fresh schedule rows: keep the plan (task/duration/gates), drop progress —
   status back to todo, date overrides and delay notes cleared so the rows
   re-plan from the destination project's own start date. */
export function freshSchedule(rows: ScheduleRow[]): ScheduleRow[] {
  return (rows || []).map((r) => ({
    ...r, id: newId(), status: 'todo' as const, s: '', e: '', note: '', delayNote: '', assignee: '',
  }));
}

/* fresh checklist: keep categories and item names, reset every received/date/
   remark/photo so the copy starts as an empty tracking sheet. */
export function freshChecklist(groups: ChecklistGroup[]): ChecklistGroup[] {
  return (groups || []).map((g) => ({
    ...g,
    items: (g.items || []).map((it) => ({
      ...it, id: newId(), status: 'pending' as const, date: '', remark: '', received: '',
      shot: undefined, shots: [], highlight: false, updatedAt: undefined,
    })),
  }));
}

export function extractFragment(pkg: ServicePackage, kind: FragmentKind, schedStyle?: string): Fragment {
  return kind === 'schedule'
    ? { schedule: freshSchedule(pkg.schedule), schedStyle }
    : { checklist: freshChecklist(pkg.checklist), noCategories: !!pkg.noCategories };
}

/* apply a fragment onto a package — replace swaps the section, append adds to it */
export function applyFragment(pkg: ServicePackage, kind: FragmentKind, frag: Fragment, mode: 'replace' | 'append') {
  if (kind === 'schedule') {
    const rows = freshSchedule((frag as ScheduleFragment).schedule || []);
    pkg.schedule = mode === 'replace' ? rows : [...pkg.schedule, ...rows];
  } else {
    const groups = freshChecklist((frag as ChecklistFragment).checklist || []);
    pkg.checklist = mode === 'replace' ? groups : [...pkg.checklist, ...groups];
    const nc = (frag as ChecklistFragment).noCategories;
    if (mode === 'replace' && typeof nc === 'boolean') pkg.noCategories = nc;
  }
}

/* pick the package on the source project that best matches a destination
   package: same service first, else the first one.
   REQ-026: 一个项目可以有多份同类业务,所以按「同类里的第几份」配对 ——
   目标项目的第二块 LED 应该抄源项目的第二块 LED,而不是永远抄第一块。
   源项目份数不够时回落到该类的最后一份。 */
export function matchPackage(src: Project, svc: string, ordinal = 0): ServicePackage | undefined {
  const same = src.packages.filter((x) => x.svc === svc);
  if (same.length) return same[Math.min(ordinal, same.length - 1)];
  return src.packages[0];
}

/* strip a package down to one section (used by Copy Schedule/Checklist Only) */
export function trimPackage(pkg: ServicePackage, mode: 'entire' | 'schedule' | 'checklist'): ServicePackage {
  const out: ServicePackage = {
    ...pkg,
    schedule: freshSchedule(pkg.schedule),
    checklist: freshChecklist(pkg.checklist),
    start: '', delivery: '',
  };
  if (mode === 'schedule') out.checklist = [];
  if (mode === 'checklist') out.schedule = [];
  /* Job Record never rides along: its fields (尺寸/链接/安装日期/保修) belong to
     one physical job and would show up as stale rows in Project Registers. */
  out.record = undefined;
  out.status = 'notstarted';
  return out;
}
