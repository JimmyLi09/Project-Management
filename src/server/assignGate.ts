/* ===== REQ-062 · 派项目限制(服务端) =====
   没到「可协助」不能当负责 PM。开关「启用派项目限制」默认关:关着只提醒,开了才拦(PD / BD 自己指派也拦)。
   拦的地方(JM 1112 确认):指派负责 PM(addOwner)、新建项目选负责 PM、Sales 交接指定 PM(提交 / 修改)、
   单个项目「⇄ 转交」、服务包负责人(是 PM 时看这个服务包的业务)。
   只提醒的地方:批量转交、删除用户时的转交、复制项目。
   不检查:被指派的是 PD / BD;项目工程师;项目的业务全是「其他业务」;售前记录。
   不追溯:只在新指派时检查;「某业务还没有到可协助的负责 PM」的提醒也只对上线后有过新指派的项目显示(capCheckAt)。 */
import { getDb } from './db';
import { gateOn, levelsOf, trainUser, trainUsers } from './trainStore';
import { coverageGaps, ownerGate, pkgOwnerGate, type GateResult } from '@/lib/train';
import { isApproach } from '@/lib/approach';
import type { Project } from '@/lib/types';

const svcsOf = (p: Pick<Project, 'packages'>) => (p.packages || []).map((k) => k.svc);

export function checkOwner(p: Pick<Project, 'packages'> & { approach?: Project['approach'] }, name: string, on = gateOn(getDb())): GateResult {
  const d = getDb();
  const u = trainUser(d, name);
  return ownerGate({ name, role: u?.role || '', svcs: svcsOf(p), levels: levelsOf(d, name), on, approach: isApproach(p as Project) });
}
export function checkPkgOwner(svc: string, name: string, on = gateOn(getDb())): GateResult {
  const d = getDb();
  const u = trainUser(d, name);
  if (!u) return { checked: false, block: '', warns: [], kind: 'skip' };   // 服务包负责人可以是外部的人名,系统里没有这个人就不查
  return pkgOwnerGate({ name, role: u.role, svc, levels: levelsOf(d, name), on });
}
export const mentorOf = (name: string) => trainUser(getDb(), name)?.mentor || '';

/* 项目列表 / 单个项目下发时现算:哪些业务还没有到「可协助」的负责 PM(只对 capCheckAt 有值的项目) */
export function withCapGaps<T extends Project>(ps: T[]): T[] {
  if (!ps.some((p) => p.capCheckAt)) return ps;
  const d = getDb();
  const roles = new Map(trainUsers(d).map((u) => [u.name, u.role]));
  const cache = new Map<string, Record<string, number>>();
  const lv = (n: string) => { if (!cache.has(n)) cache.set(n, levelsOf(d, n)); return cache.get(n)!; };
  return ps.map((p) => {
    if (!p.capCheckAt || isApproach(p) || p.archived) return p;
    const gaps = coverageGaps(svcsOf(p), (p.owners || []).map((n) => ({ name: n, role: roles.get(n) || '', levels: lv(n) })));
    return gaps.length ? { ...p, capGaps: gaps } : p;
  });
}

/* 给 applyAction 用的一组函数(放进 ctx,单元测试不传就不查) */
export const gateCtx = { checkOwner, checkPkgOwner, mentorOf };
export type GateCtx = typeof gateCtx;
