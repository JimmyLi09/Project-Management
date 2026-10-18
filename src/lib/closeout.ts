/* ===== REQ-057:「开票 / 收尾」阶段 + PM 已收尾 =====
   workflowStage 原来在 project.ts 里。挪到这里是因为 permissions.ts 也要用它
   (canEdit 要知道项目是不是已经进了开票 / 收尾),而 project.ts 本身 import 了
   permissions.ts —— 放在 project.ts 里就成了互相 import。这个文件只依赖类型。 */
import type { Project, Stage } from './types';

/* v2.2 §5.1/§5.2: once the post-sales workflow is active, stage is derived from
   business actions (not from schedule progress). Returns null when the workflow
   hasn't started, so legacy projects keep the heuristic in projStage. */
export function workflowStage(p: Project): Stage | null {
  const h = p.handover, cr = p.completionReview, sv = p.salesVerification, inv = p.invoiceClose;
  const invoiced = !!inv && inv.invoiceStatus === 'issued';
  const approved = cr?.approval?.status === 'approved';
  if (invoiced || (approved && sv?.status === 'verified' && sv?.finalInvoiceAllowed)) return 'invoice'; // 已收款仍归入 invoice；归档为独立操作
  if (cr?.status === 'submitted' || approved) return 'complete'; // PD 批准但 Sales 未核对 → 仍在 complete
  if (h?.status === 'accepted') return 'progress';
  if (h?.status === 'submitted') return 'handover';
  return null;
}

/* projStage(p) === 'invoice' 的同一个判断(projStage 只有这两条路会得出 invoice:
   流程走到开票,或者流程没开始、但老项目打过「已开票」的勾)。单元测试拿 projStage 对过。 */
export function inInvoiceStage(p: Project): boolean {
  const ws = workflowStage(p);
  return ws === 'invoice' || (!ws && !!p.invoiced);
}

/* PM 已收尾:进了「5 开票 / 收尾」,但还没正式归档。每次算、不存库 ——
   PD 退回完工 / Sales 撤回核对,项目离开这个阶段,就自动回到 PM 的列表;
   开了 Invoice 以后按 REQ-045 正式归档(p.archived),对所有人都是归档。 */
export const pmClosed = (p: Project) => !p.archived && inInvoiceStage(p);

export const PM_CLOSED_MSG = '项目已进入开票 / 收尾，PM 端只读 / This project is in invoicing / close-out — read-only for PM / Engineer';
