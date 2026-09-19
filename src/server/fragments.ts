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

/* 0917 变更单:复制 / 套用时可以选「连内容一起复制」。
   withContent = false(默认,老行为):只带走计划骨架 —— 状态回 todo,
     日期 / 备注 / 延误说明 / 指派全清,到了新项目按它自己的起始日重排。
   withContent = true:连进度一起搬 —— 同一个客户的第二期、或者从一个
     排到一半的项目起一个副本时,重新填一遍状态和日期是白费功夫。
   两种情况下 id 都要换新的:同一个 id 出现在两个项目里,拖拽排序和
   React key 都会串。 */
export function freshSchedule(rows: ScheduleRow[], withContent = false): ScheduleRow[] {
  return (rows || []).map((r) => (withContent
    ? { ...r, id: newId() }
    : { ...r, id: newId(), status: 'todo' as const, s: '', e: '', note: '', delayNote: '', assignee: '' }));
}

/* 同上。withContent = true 时保留状态 / 日期 / 备注 / 参考图 / 收料记录,
   等于把这份清单连同它的进度整份搬过去。 */
export function freshChecklist(groups: ChecklistGroup[], withContent = false): ChecklistGroup[] {
  return (groups || []).map((g) => ({
    ...g,
    items: (g.items || []).map((it) => (withContent
      /* 收料记录的 id 也要换 —— 和上面行 id 同一个道理:同一个 id 出现在
         两个项目里迟早出事(React key、按 id 找记录改 / 删)。 */
      ? { ...it, id: newId(), receipts: (it.receipts || []).map((r) => ({ ...r, id: newId() })) }
      : {
          ...it, id: newId(), status: 'pending' as const, date: '', remark: '', received: '',
          shot: undefined, shots: [], highlight: false, updatedAt: undefined,
          receipts: [],   // REQ-042: 不带内容时收料记录也一并清空
        })),
  }));
}

export function extractFragment(pkg: ServicePackage, kind: FragmentKind, schedStyle?: string, withContent = false): Fragment {
  return kind === 'schedule'
    ? { schedule: freshSchedule(pkg.schedule, withContent), schedStyle }
    : { checklist: freshChecklist(pkg.checklist, withContent), noCategories: !!pkg.noCategories };
}

/* apply a fragment onto a package — replace swaps the section, append adds to it */
export function applyFragment(pkg: ServicePackage, kind: FragmentKind, frag: Fragment, mode: 'replace' | 'append', withContent = false) {
  if (kind === 'schedule') {
    const rows = freshSchedule((frag as ScheduleFragment).schedule || [], withContent);
    pkg.schedule = mode === 'replace' ? rows : [...pkg.schedule, ...rows];
  } else {
    const groups = freshChecklist((frag as ChecklistFragment).checklist || [], withContent);
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


/* 0917 变更单:向导第三步的「预览」—— 这次会带进来几个分区 / 几项 /
   其中几项是带着内容的。数出来给人看,而不是让人点完才知道搬了什么。 */
export interface FragmentStats { groups: number; items: number; withContent: number }

export function statFragment(frag: Fragment, kind: FragmentKind): FragmentStats {
  if (kind === 'schedule') {
    const rows = (frag as ScheduleFragment).schedule || [];
    return {
      groups: new Set(rows.map((r) => r.phase || '')).size,
      items: rows.length,
      withContent: rows.filter((r) => r.status !== 'todo' || r.s || r.e || r.note || r.assignee).length,
    };
  }
  const groups = (frag as ChecklistFragment).checklist || [];
  const items = groups.reduce((n, g) => n + (g.items || []).length, 0);
  /* 「有内容」也要把收料记录算进去 —— 一个项只有收料记录、老字段还空着的
     情况是有的(记录是后加的),预览里说「0 项有内容」会骗人。 */
  const withContent = groups.reduce((n, g) => n + (g.items || []).filter(
    (it) => it.status !== 'pending' || it.date || it.remark || it.received
      || (it.shots || []).length || (it.receipts || []).length,
  ).length, 0);
  return { groups: groups.length, items, withContent };
}
