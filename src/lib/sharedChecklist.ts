/* ===== REQ-044 · 一个项目一张信息清单 =====

   清单在 Project.checklist 上,每项 svcs 记哪些服务需要它;服务标签只是筛选。
   这里是服务端动作和界面共用的小工具:按服务筛、找项、统计、把模板并进来、
   去掉一个服务标签、已移除的项。合并规则(同名 / 同义)在 checklistMerge.ts。 */

import type { ChecklistGroup, ChecklistItem, Project, RemovedClItem } from './types';
import { getSynonyms, groupKeys, itemKeys, synonymIndex } from './checklistMerge';
import { newId, parseISO } from './project';

export const ALL = 'all';
/* 'all' 或某个服务 key(cgi / scale / led …) */
export type ClScope = string;

export const clGroups = (p: { checklist?: ChecklistGroup[] }): ChecklistGroup[] => p.checklist || [];
export const inScope = (it: ChecklistItem, scope: ClScope) => scope === ALL || (it.svcs || []).includes(scope);

/* 项目里有哪些服务(按服务包的顺序,同一种只算一次) */
export function projectSvcs(p: { packages: { svc: string }[] }): string[] {
  const out: string[] = [];
  (p.packages || []).forEach((pk) => { if (!out.includes(pk.svc)) out.push(pk.svc); });
  return out;
}

/* 同一种服务的第几份:第一份是 '',第二份起是它的名字,没名字就 #2、#3 */
export function instOf(p: { packages: { svc: string; label?: string }[] }, pkgIdx: number): string {
  const pk = p.packages[pkgIdx];
  if (!pk) return '';
  const nth = p.packages.slice(0, pkgIdx + 1).filter((x) => x.svc === pk.svc).length;
  return nth > 1 ? (pk.label || `#${nth}`) : '';
}

export function findClItem(p: { checklist?: ChecklistGroup[] }, id: string) {
  const groups = clGroups(p);
  for (let gi = 0; gi < groups.length; gi++) {
    const ii = groups[gi].items.findIndex((x) => x.id === id);
    if (ii >= 0) return { g: groups[gi], gi, it: groups[gi].items[ii], ii };
  }
  return null;
}

/* 顶部三张卡 + 进度。N/A 不计;逾期 = 待处理且过了日期(和原来一样) */
export function clStats(p: { checklist?: ChecklistGroup[] }, scope: ClScope = ALL, today?: Date) {
  let done = 0, total = 0, pending = 0, overdue = 0;
  clGroups(p).forEach((g) => g.items.forEach((it) => {
    if (!inScope(it, scope) || it.status === 'na') return;
    total++;
    if (it.status === 'confirmed') done++;
    if (it.status === 'pending') {
      pending++;
      const due = parseISO(it.date);
      if (today && due && due < today) overdue++;
    }
  }));
  return { done, total, pending, overdue, pct: total ? Math.round((done / total) * 100) : 0 };
}

const blankItem = (zh: string, en: string, svcs: string[]): ChecklistItem =>
  ({ id: newId(), zh, en, status: 'pending', date: '', remark: '', owner: '', shots: [], receipts: [], svcs });

/* 找 / 建分组(按名字认,中文或英文相同就是同一组) */
function groupFor(p: Project, g: { group: string; groupEn: string; color: string }): ChecklistGroup {
  if (!p.checklist) p.checklist = [];
  const keys = groupKeys(g);
  const hit = keys.length ? p.checklist.find((x) => groupKeys(x).some((k) => keys.includes(k))) : undefined;
  if (hit) return hit;
  const ng: ChecklistGroup = { group: g.group || '特殊需求', groupEn: g.groupEn || 'Custom', color: g.color || '#607080', items: [] };
  p.checklist.push(ng);
  return ng;
}

/* 把一份清单(模板 / 别的项目 / 自定义模板)并进项目清单。
   - 同名项(含同义项)不重复,只给已有项加上服务标签;
   - 没有的新增,放进同名分组(没有就新建分组);
   - svcsOf 决定每一项挂哪些服务;
   - inst:同一种服务的第二份起,只属于这一份的项单独一条、名字后加实例名。
   返回新增 / 加标签的数目。 */
export function mergeIntoProject(p: Project, groups: ChecklistGroup[], svcsOf: (it: ChecklistItem) => string[], opts: { inst?: string; withContent?: boolean } = {}) {
  if (!p.checklist) p.checklist = [];
  const syn = synonymIndex(getSynonyms());
  let added = 0, tagged = 0;
  for (const g of groups || []) {
    let target: ChecklistGroup | null = null;
    for (const src of g.items || []) {
      const svcs = svcsOf(src).filter(Boolean);
      if (!svcs.length) continue;
      const keys = itemKeys(src, syn);
      const flat = p.checklist.flatMap((x) => x.items);
      const inst = opts.inst;
      if (inst) {
        /* 第二块屏:只认同一份里的同名项,不并到第一份上 */
        const own = flat.find((x) => x.inst === inst && itemKeys({ zh: stripInst(x.zh, inst), en: stripInst(x.en, inst) }, syn).some((k) => keys.includes(k)));
        if (own) continue;
        const clash = flat.some((x) => itemKeys(x, syn).some((k) => keys.includes(k)));
        const it = newFrom(src, svcs, opts.withContent);
        if (clash) { it.zh = `${it.zh}(${inst})`; if (it.en) it.en = `${it.en} (${inst})`; }
        it.inst = inst;
        (target ||= groupFor(p, g)).items.push(it);
        added++;
        continue;
      }
      const hit = flat.find((x) => !x.inst && itemKeys(x, syn).some((k) => keys.includes(k)));
      if (hit) {
        const before = (hit.svcs || []).length;
        hit.svcs = [...new Set([...(hit.svcs || []), ...svcs])];
        if (hit.svcs.length > before) tagged++;
        continue;
      }
      (target ||= groupFor(p, g)).items.push(newFrom(src, svcs, opts.withContent));
      added++;
    }
  }
  return { added, tagged };
}
const stripInst = (s: string | undefined, inst: string) => String(s || '').replace(new RegExp(`\\s*[((]${inst.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[))]$`), '');
function newFrom(src: ChecklistItem, svcs: string[], withContent?: boolean): ChecklistItem {
  if (!withContent) return blankItem(src.zh, src.en, svcs);
  return {
    ...src, id: newId(), svcs,
    shots: [...(src.shots || [])],
    receipts: (src.receipts || []).map((r) => ({ ...r, id: 'rc' + newId() })),
  };
}

/* 把一项移进「已移除的项」(可恢复)。不直接删 */
export function moveToRemoved(p: Project, gi: number, ii: number, by: string, reason: string): ChecklistItem | null {
  const g = clGroups(p)[gi];
  const it = g?.items[ii];
  if (!g || !it) return null;
  g.items.splice(ii, 1);
  if (!p.checklistRemoved) p.checklistRemoved = [];
  p.checklistRemoved.unshift({ item: it, group: g.group, groupEn: g.groupEn, color: g.color, at: Date.now(), by, reason });
  return it;
}

/* 去掉一个服务标签(删服务包、套用模板时)。
   - keepSvc:同一种服务还有别的份,标签留着;
   - inst:删的是第二份起的那一份,只属于它的项整条移走;
   不再属于任何服务的项进「已移除的项」;空了的分组去掉。返回移走的项数。 */
export function dropSvc(p: Project, svc: string, opts: { by: string; reason: string; keepSvc?: boolean; inst?: string }): number {
  let moved = 0;
  const groups = clGroups(p);
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    for (let ii = g.items.length - 1; ii >= 0; ii--) {
      const it = g.items[ii];
      if (opts.inst && it.inst === opts.inst && (it.svcs || []).includes(svc)) {
        moveToRemoved(p, gi, ii, opts.by, opts.reason); moved++; continue;
      }
      if (opts.keepSvc || !(it.svcs || []).includes(svc)) continue;
      it.svcs = (it.svcs || []).filter((x) => x !== svc);
      if (!it.svcs.length) { moveToRemoved(p, gi, ii, opts.by, opts.reason); moved++; }
    }
  }
  p.checklist = groups.filter((g) => g.items.length);
  return moved;
}

/* 恢复一项:回到同名分组(没有就新建);服务标签取原来的里面项目现在还有的,
   一个都不剩就挂当前标签(在「全部」下就是全部服务) */
export function restoreRemoved(p: Project, removedIdx: number, scope: ClScope): ChecklistItem | null {
  const r = (p.checklistRemoved || [])[removedIdx];
  if (!r) return null;
  const have = projectSvcs(p);
  let svcs = (r.item.svcs || []).filter((s) => have.includes(s));
  if (!svcs.length) svcs = scope === ALL ? have : [scope];
  const g = groupFor(p, r);
  g.items.push({ ...r.item, svcs });
  p.checklistRemoved!.splice(removedIdx, 1);
  return r.item;
}

/* 当前标签对应的那一段(套用 / 存为模板 / 从项目导入的来源) */
export function sectionOf(p: { checklist?: ChecklistGroup[] }, scope: ClScope): ChecklistGroup[] {
  return clGroups(p).map((g) => ({ ...g, items: g.items.filter((it) => inScope(it, scope)) })).filter((g) => g.items.length);
}

/* 覆盖当前标签那一段:
   - 某个服务:先把这个服务的标签从所有项上去掉(只属于它的进「已移除的项」),再把新内容并进来;
   - 全部:整张清单的项都进「已移除的项」,换成新内容。 */
export function replaceSection(p: Project, scope: ClScope, groups: ChecklistGroup[], svcsOf: (it: ChecklistItem) => string[], opts: { by: string; reason: string; withContent?: boolean }) {
  let moved = 0;
  if (scope === ALL) {
    const all = clGroups(p);
    for (let gi = all.length - 1; gi >= 0; gi--) for (let ii = all[gi].items.length - 1; ii >= 0; ii--) { moveToRemoved(p, gi, ii, opts.by, opts.reason); moved++; }
    p.checklist = [];
  } else {
    moved = dropSvc(p, scope, { by: opts.by, reason: opts.reason });
  }
  const r = mergeIntoProject(p, groups, svcsOf, { withContent: opts.withContent });
  return { moved, ...r };
}
