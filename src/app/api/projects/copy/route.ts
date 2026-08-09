import { NextRequest, NextResponse } from 'next/server';
import { appendAudit, getProject, insertProject, nextProjectSerial } from '@/server/db';
import { currentUser } from '@/server/session';
import { canCreate, identityOf } from '@/lib/permissions';
import { emptyUpdate, migrate, uid } from '@/lib/project';
import { trimPackage } from '@/server/fragments';
import type { Project } from '@/lib/types';

/* REQ-012: POST /api/projects/copy  { sourceId, mode }
   Deep-copies a project, trims it to the requested slice, then resets every
   piece of progress — ids, statuses, dates, the whole post-sales workflow —
   so the copy starts clean with a fresh NO. */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canCreate(identityOf(user))) return NextResponse.json({ error: '仅销售 / PD / BD 可创建项目' }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { sourceId?: string; mode?: string } | null;
  const mode = String(body?.mode || 'entire') as 'entire' | 'schedule' | 'checklist';
  if (!['entire', 'schedule', 'checklist'].includes(mode)) return NextResponse.json({ error: '无效的复制方式' }, { status: 400 });
  const src = body?.sourceId ? getProject(String(body.sourceId)) : undefined;
  if (!src) return NextResponse.json({ error: '源项目不存在' }, { status: 404 });

  const now = Date.now();
  const copy = JSON.parse(JSON.stringify(src)) as Project;
  delete (copy as Partial<Project>).updatedAt;
  delete (copy as Partial<Project>).version;

  copy.id = uid();
  copy.serial = nextProjectSerial();
  copy.name = `${src.name}（副本）`;
  copy.created = now;
  copy.archived = false;
  /* back to the beginning of the lifecycle */
  copy.stage = 'presales';
  copy.delivery = '';
  copy.start = '';
  copy.update = emptyUpdate();
  copy.dismissedRisks = [];
  copy.log = [{ at: now, by: user.name, text: `复制自「${src.name}」(${mode}) · NO. ${String(copy.serial).padStart(3, '0')}` }];
  /* reset the whole post-sales workflow (1A) so nothing carries over */
  copy.workflowVersion = 1;
  copy.handover = { status: 'not_started', salesBrief: '', assignedPmId: '', submittedBy: '', submittedAt: 0, briefingAt: 0 };
  copy.completionReview = { status: 'not_started', summary: '', links: '', submittedBy: '', submittedAt: 0, approval: { pdId: '', status: 'pending', note: '', decidedAt: 0 } };
  copy.salesVerification = { status: 'not_started', scopeMatches: false, jobOrderUpdated: false, variationStatus: 'none', finalInvoiceAllowed: false, by: '', at: 0 };
  copy.invoiceClose = { invoiceRef: '', issuedDate: '', dueDate: '', invoiceStatus: 'pending_finance', paymentStatus: 'pending', financeNote: '' };
  copy.paymentRisk = { depositRequired: false, depositStatus: 'none', level: 'none', resolvedAt: 0 };
  copy.contacts = (src.contacts || []).map((c) => ({ ...c }));
  copy.packages = (src.packages || []).map((pk) => trimPackage(pk, mode));
  if (mode !== 'entire') copy.schedStyle = src.schedStyle; // template style still travels

  const fresh = migrate(copy); // re-derive statuses / fill any defaults
  insertProject(fresh);
  appendAudit(fresh.id, [{ at: now, by: user.name, text: `复制项目 Copy (${mode}) ← ${src.name}` }]);
  return NextResponse.json({ project: fresh });
}
