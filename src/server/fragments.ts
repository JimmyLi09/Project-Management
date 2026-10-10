/* ===== REQ-012: schedule / checklist fragments =====
   One shape shared by "copy project", "import from another project" and
   "save/apply template", so templates and projects never diverge into two
   data formats — a fragment is literally the slice of a ServicePackage that
   REQ-018 (schedule) / REQ-019 (checklist) already render. */
import { newId, planDates } from '@/lib/project';
import { calendarFromRows } from '@/lib/scheduleSync';
import { ALL, mergeIntoProject, projectSvcs, replaceSection, sectionOf, type ClScope } from '@/lib/sharedChecklist';
import { cellsToOrdinal, syncCells } from '@/lib/clCells';
import type { ChecklistGroup, ChecklistItem, Project, ScheduleRow, ServicePackage } from '@/lib/types';

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
  /* REQ-050: 分格的项每一格同样处理;修改记录不跟着走(那是原项目这一项的历史) */
  const blank = { status: 'pending' as const, date: '', remark: '', received: '', shots: [] as string[], highlight: false, updatedAt: undefined, receipts: [] as never[] };
  const freshCells = (cells: ChecklistItem['cells']) => cells && Object.fromEntries(Object.entries(cells).map(([k, c]) => [k, withContent
    ? { ...c, receipts: (c.receipts || []).map((r) => ({ ...r, id: newId() })) }
    : { ...c, ...blank }]));
  return (groups || []).map((g) => ({
    ...g,
    items: (g.items || []).map((it) => {
      const { history: _h, ...rest } = it;
      const cells = freshCells(it.cells);
      return withContent
        /* 收料记录的 id 也要换 —— 和上面行 id 同一个道理:同一个 id 出现在
           两个项目里迟早出事(React key、按 id 找记录改 / 删)。 */
        ? { ...rest, id: newId(), receipts: (it.receipts || []).map((r) => ({ ...r, id: newId() })), ...(cells ? { cells } : {}) }
        : {
            ...rest, id: newId(), status: 'pending' as const, date: '', remark: '', received: '',
            shot: undefined, shots: [], highlight: false, updatedAt: undefined,
            receipts: [],   // REQ-042: 不带内容时收料记录也一并清空
            ...(cells ? { cells } : {}),
          };
    }),
  }));
}

export function extractSchedule(pkg: ServicePackage, schedStyle?: string, withContent = false): ScheduleFragment {
  return { schedule: freshSchedule(pkg.schedule, withContent), schedStyle };
}

/* REQ-044: 清单在项目上 —— 取当前标签那一段(「全部」= 整张);来源项目没有这个服务时取整张。
   每项带着它的服务标签走(存为模板时也带上)。 */
export function extractChecklist(p: Project, scope: ClScope, withContent = false): ChecklistFragment {
  let groups = sectionOf(p, scope);
  if (!groups.length && scope !== ALL) groups = sectionOf(p, ALL);
  /* REQ-050: 规格项的格按服务包 id 存,到别的项目对不上 —— 换成「第几份」(@1、@2),套用时再对回去 */
  groups = groups.map((g) => ({ ...g, items: g.items.map((it) => cellsToOrdinal(p, it)) }));
  return { checklist: freshChecklist(groups, withContent), noCategories: !!p.noCategories };
}

/* apply a schedule fragment onto a package — replace swaps the section, append adds to it */
export function applySchedule(pkg: ServicePackage, frag: ScheduleFragment, mode: 'replace' | 'append', withContent = false, opts: { projectStart?: string; by?: string } = {}) {
  const rows = freshSchedule(frag.schedule || [], withContent);
  pkg.schedule = mode === 'replace' ? rows : [...pkg.schedule, ...rows];
  /* REQ-048:排期只在日历上排 —— 行换了,日历按新的行重建(日期 = 行上算出来的日期),存档保留 */
  const prev = pkg.calendar;
  const { calendar } = calendarFromRows(pkg.schedule, planDates(pkg, pkg.start || opts.projectStart || ''), { by: opts.by || '', at: Date.now() });
  pkg.calendar = { ...calendar, version: (prev?.version || 0) + 1, ...(prev?.archives?.length ? { archives: prev.archives } : {}) };
}

/* REQ-044: 套用 / 导入清单 —— 作用于当前标签对应服务的项;「全部」下作用于整张清单。
   - 覆盖:当前这一段换掉(被换掉的进「已移除的项」,可恢复),再并入新内容;
   - 追加:并入新内容。
   并入时同名项不重复,只加服务标签(已有的内容保留)。
   在某个服务标签下,新项都挂这个服务;在「全部」下沿用来源项的服务标签
   (只认本项目有的服务,一个都对不上就挂全部服务)。 */
export function applyChecklist(p: Project, scope: ClScope, frag: ChecklistFragment, mode: 'replace' | 'append', withContent: boolean, by: string) {
  const groups = freshChecklist(frag.checklist || [], withContent);
  const have = projectSvcs(p);
  const svcsOf = scope === ALL
    ? (it: ChecklistItem) => { const s = (it.svcs || []).filter((x) => have.includes(x)); return s.length ? s : have; }
    : () => [scope];
  const r = mode === 'replace'
    ? replaceSection(p, scope, groups, svcsOf, { by, reason: 'reset', withContent })
    : { moved: 0, ...mergeIntoProject(p, groups, svcsOf, { withContent }) };
  const nc = frag.noCategories;
  if (mode === 'replace' && scope === ALL && typeof nc === 'boolean') p.noCategories = nc;
  syncCells(p, { by });   // REQ-050: 格对到本项目的服务包 / 业务
  return r;
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

/* strip a package down to one section (used by Copy Schedule/Checklist Only).
   REQ-044: 清单在项目上,由复制路由单独处理;这里只管排期 */
export function trimPackage(pkg: ServicePackage, mode: 'entire' | 'schedule' | 'checklist'): ServicePackage {
  const out: ServicePackage = {
    ...pkg,
    schedule: freshSchedule(pkg.schedule),
    start: '', delivery: '',
  };
  delete out.checklist;
  /* REQ-048:行换了新 id、日期清空了,日历对不上 —— 去掉,读的时候按新的行重建 */
  delete out.calendar;
  delete out.scheduleLegacy;
  delete out.mig048;
  delete out.noCategories;
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
