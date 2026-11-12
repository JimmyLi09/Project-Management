/* ===== REQ-063 · 项目修改记录 =====
   挂在服务包上:packages[i].revisions(一轮一条)、packages[i].reasonMeeting(开过原因会)。
   老项目没有这两个字段,读出来是 undefined,按「没有修改记录」处理,不迁移。

   轮次:只数来源是「客户」的,按记录的先后(数组顺序)编 R1、R2…;「内部」的不占轮次、没有收费状态。
   收费状态:轮次 < chargeFrom(默认 4)是「免费」,≥ chargeFrom 是「应收费 · 待 Sales 报价」。
   Sales 出了报价 / 客户确认 / PD 批准免收之后,这一轮就定了 —— 之后删轮重编号也不再改它。
   不记金额,不碰报价和 Finance 的数据。

   这里只放纯函数(前后端、单元测试都用);谁能做什么在 server/actions.ts。 */
import type { Project, ServicePackage } from './types';
import { localDay } from './localDate';

export type RevSrc = 'client' | 'internal';
export type RevFee = 'free' | 'due' | 'quoted' | 'confirmed' | 'waived';

export interface Revision {
  id: string;
  src: RevSrc;
  date: string;                 // YYYY-MM-DD,默认记录当天,可改
  note: string;                 // 修改内容(必填)
  fee?: RevFee;                 // 只有「客户」的轮有
  dueAt?: number;               // 变成「待 Sales 报价」的时间(48 小时从这里算)
  quotedAt?: number; quotedBy?: string;
  confirmedAt?: number; confirmedBy?: string;
  waivedAt?: number; waivedBy?: string; waiveReason?: string;
  by: string; at: number;       // 记录人、时间
  editedBy?: string; editedAt?: number;
}

export interface ReasonMeeting { at: number; by: string; note: string; rounds: number }

/* 规则里的数字(KPI 规则里改,跟着规则版本走) */
export interface RevRules {
  e5Round: number;              // 第几轮出 E5 提醒(默认 3)
  chargeFrom: number;           // 第几轮起应收费(默认 4)
  reasonAt: number;             // 累计几轮提醒开原因会(默认 3)
  quoteHours: number;           // Sales 出报价的时限(默认 48 小时)
}
export const DEFAULT_REV_RULES: RevRules = { e5Round: 3, chargeFrom: 4, reasonAt: 3, quoteHours: 48 };

/* KPI 看板顶部「每月看 3 个数」的目标 */
export interface CardTargets { onTime: number; rounds: number; recover: number }
export const DEFAULT_CARD_TARGETS: CardTargets = { onTime: 90, rounds: 3, recover: 80 };

/* 应收费的四种(免费不算)。回收率 = 已确认 ÷ 这四种的合计;免收算没收回 */
export const CHARGED: RevFee[] = ['due', 'quoted', 'confirmed', 'waived'];
/* 已经定下来的 —— 删轮重编号、改规则都不再动它 */
export const SETTLED: RevFee[] = ['quoted', 'confirmed', 'waived'];

export const FEE_TEXT: Record<RevFee, [string, string]> = {
  free: ['免费', 'Free'],
  due: ['应收费 · 待 Sales 报价', 'Chargeable · awaiting Sales quote'],
  quoted: ['已出 revised quotation · 等客户确认', 'Revised quotation sent · awaiting client'],
  confirmed: ['客户已确认收费', 'Client confirmed the charge'],
  waived: ['PD 批准免收', 'Waived by PD'],
};

/* 上线日存在 app_settings 的这个键里(server/db.ts 第一次启动时记下当天) */
export const SINCE_KEY_063 = 'req063Since';

export const revsOf = (pk: ServicePackage): Revision[] => (Array.isArray(pk.revisions) ? pk.revisions : []);

/* 客户修改的轮数 */
export const clientRounds = (pk: ServicePackage) => revsOf(pk).filter((r) => r.src === 'client').length;

/* 每一条的轮次(内部的没有) */
export function roundMap(pk: ServicePackage): Map<string, number> {
  const m = new Map<string, number>();
  let n = 0;
  for (const r of revsOf(pk)) if (r.src === 'client') m.set(r.id, ++n);
  return m;
}

/* 按当前规则重排收费状态:只动「免费 / 待报价」的轮,已出报价 / 已确认 / 免收的不动。
   内部的没有收费状态。返回从「待报价」变回免费的轮(Sales 的待办随之消失)。 */
export function recompute(pk: ServicePackage, rules: RevRules, now: number): string[] {
  const back: string[] = [];
  let n = 0;
  for (const r of revsOf(pk)) {
    if (r.src !== 'client') { delete r.fee; delete r.dueAt; continue; }
    n++;
    if (r.fee && SETTLED.includes(r.fee)) continue;
    const want: RevFee = n >= rules.chargeFrom ? 'due' : 'free';
    if (want === 'due' && r.fee !== 'due') r.dueAt = now;
    if (want === 'free') { if (r.fee === 'due') back.push(r.id); delete r.dueAt; }
    r.fee = want;
  }
  return back;
}

/* 超过时限还在「待 Sales 报价」 */
export const quoteOverdue = (r: Revision, rules: RevRules, now: number) =>
  r.fee === 'due' && !!r.dueAt && now - r.dueAt > rules.quoteHours * 3600_000;

/* 这个服务包该开原因会了吗:客户修改累计 ≥ reasonAt,而且还没开过(同一个服务包只提醒一次) */
export const needsReasonMeeting = (pk: ServicePackage, rules: RevRules) =>
  !pk.reasonMeeting && clientRounds(pk) >= rules.reasonAt;

/* 交接日:Sales 提交交接的那天;没走过交接的按建项目那天 */
export const handoverDay = (p: Project) =>
  localDay(new Date(p.handover && p.handover.submittedAt > 0 ? p.handover.submittedAt : p.created));

/* 算「平均修改轮数」的有效服务包:
   交接日在上线日(含)之后的,0 轮也算;上线之前交接的老项目,记过至少一轮客户修改才算。
   since 为空 = 上线日还没记下来,按「全是老项目」处理(只算有记录的)。 */
export function effectivePkgs(p: Project, since: string, svc = ''): { pk: ServicePackage; rounds: number }[] {
  const fresh = !!since && handoverDay(p) >= since;
  return (p.packages || [])
    .filter((pk) => !svc || pk.svc === svc)
    .map((pk) => ({ pk, rounds: clientRounds(pk) }))
    .filter((x) => fresh || x.rounds >= 1);
}

/* 日期落在周期里的应收费轮,按状态计数 */
export interface FeeCount { due: number; quoted: number; confirmed: number; waived: number; total: number }
export const emptyFee = (): FeeCount => ({ due: 0, quoted: 0, confirmed: 0, waived: 0, total: 0 });
export function countCharged(pks: ServicePackage[], from: string, to: string, into: FeeCount = emptyFee()): FeeCount {
  for (const pk of pks) for (const r of revsOf(pk)) {
    if (r.src !== 'client' || !r.fee || r.fee === 'free') continue;
    if (!r.date || r.date < from || r.date > to) continue;
    into[r.fee as Exclude<RevFee, 'free'>]++;
    into.total++;
  }
  return into;
}
export const recoverPct = (c: FeeCount): number | null => (c.total ? Math.round((c.confirmed / c.total) * 100) : null);

/* 项目上的 Sales:交接是 Sales 提交的就是他;没有(或提交的人不是 Sales)= 没记 Sales,所有 Sales 都看到 */
export function projectSales(p: Project, users: { name: string; role: string }[]): string | null {
  const by = p.handover?.submittedBy;
  if (!by) return null;
  return users.some((u) => u.name === by && u.role === 'sales') ? by : null;
}

/* 待 Sales 报价的轮(待办 / 总览用) */
export interface DueItem { p: Project; pi: number; pk: ServicePackage; r: Revision; round: number; overdue: boolean; sales: string | null }
export function dueItems(projects: Project[], users: { name: string; role: string }[], rules: RevRules, now: number): DueItem[] {
  const out: DueItem[] = [];
  for (const p of projects) {
    if (p.archived && p.archiveReason !== 'invoiced') continue;
    const sales = projectSales(p, users);
    (p.packages || []).forEach((pk, pi) => {
      const rm = roundMap(pk);
      for (const r of revsOf(pk)) if (r.fee === 'due') out.push({ p, pi, pk, r, round: rm.get(r.id) || 0, overdue: quoteOverdue(r, rules, now), sales });
    });
  }
  return out.sort((a, b) => (a.r.dueAt || 0) - (b.r.dueAt || 0));
}
/* 某个 Sales 的待办:项目的 Sales 是他,或者项目没记 Sales */
export const salesTodo = (items: DueItem[], name: string) => items.filter((x) => !x.sales || x.sales === name);
