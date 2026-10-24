/* ===== REQ-059 §4:谁能删除一份业务 =====
   前端(删除按钮显示 / 置灰 / 提示)和后端(removeServicePackage)用同一个判断。
   - Sales / PD / BD:照旧可以删;
   - 项目 PM(p.owners 里有他、角色是 pm):这份业务还没开工才可以删 ——
     排期里有「进行中 / 已完成」,或信息清单里只属于它的内容已收到 / 已确认 / 有收料记录,就算已开工;
   - Engineer、Finance、Viewer:没有按钮。
   照旧的限制:只剩一份业务不能删;REQ-057 PM 端已收尾的项目、REQ-054 已关闭的售前记录只读。 */
import type { ChecklistItem, ClCell, Project, ServicePackage } from './types';
import { canDelete, canEditModule, pmLocked, type Identity } from './permissions';
import { isClosedApproach } from './approach';
import { clGroups, instOf } from './sharedChecklist';

export const PKG_STARTED_MSG = '这个业务已经开工 / 已收到资料，请找 Sales / PD 删除 / This service has started or has received information — ask Sales / PD to remove it';
export const PKG_LAST_MSG = '至少保留一个业务 / Keep at least one service';

/* 收到过东西:状态不是「待收 / 不适用」,或者有收料记录 / 填过收到了什么 */
const touched = (x: Pick<ChecklistItem, 'status' | 'received' | 'receipts'> | ClCell | undefined) =>
  !!x && ((x.status !== 'pending' && x.status !== 'na') || !!(x.receipts && x.receipts.length) || !!String(x.received || '').trim());

/* 这份业务开工了没有 */
export function pkgStarted(p: Project, pkgIdx: number): boolean {
  const pk: ServicePackage | undefined = p.packages[pkgIdx];
  if (!pk) return false;
  if (pk.schedule.some((r) => r.status === 'wip' || r.status === 'done')) return true;
  const inst = instOf(p, pkgIdx);
  const sameLeft = p.packages.some((x, i) => i !== pkgIdx && x.svc === pk.svc);
  for (const g of clGroups(p)) {
    for (const it of g.items) {
      const svcs = it.svcs || [];
      /* 只属于它的项:同类只有这一份时,只标了这个业务的项;同类有几份时,记着是这一份(inst)的项 —— 和删除时移进「已移除的项」的是同一批 */
      const own = (inst && it.inst === inst && svcs.includes(pk.svc)) || (!sameLeft && svcs.length === 1 && svcs[0] === pk.svc);
      if (own && (touched(it) || Object.values(it.cells || {}).some(touched))) return true;
      /* REQ-050 分格:规格项这一份的那一格、单独填时这个业务的那一格,也只属于它 */
      if (pk.id && touched(it.cells?.[pk.id])) return true;
      if (!sameLeft && touched(it.cells?.[pk.svc])) return true;
    }
  }
  return false;
}

const isProjectPm = (u: Identity, p: Project) => u.role === 'pm' && (p.owners || []).includes(u.name);

/* show:显示删除按钮;ok:能不能删;why:不能删时的提示(置灰时悬停显示,后端也用这句) */
export function canRemovePkg(u: Identity, p: Project, pkgIdx: number): { show: boolean; ok: boolean; why?: string; last?: boolean } {
  if (isClosedApproach(p) || !p.packages[pkgIdx]) return { show: false, ok: false };
  const full = canDelete(u);
  const pm = !full && isProjectPm(u, p) && !pmLocked(u, p) && canEditModule(u, 'record');
  if (!full && !pm) return { show: false, ok: false };
  if (p.packages.length <= 1) return { show: true, ok: false, why: PKG_LAST_MSG, last: true };
  if (pm && pkgStarted(p, pkgIdx)) return { show: true, ok: false, why: PKG_STARTED_MSG };
  return { show: true, ok: true };
}
