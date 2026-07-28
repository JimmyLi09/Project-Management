import { NextRequest, NextResponse } from 'next/server';
import { appendAudit, commitWorkflowAction, deleteProject, getEffectiveTemplate, getProject, saveProject } from '@/server/db';
import { currentUser } from '@/server/session';
import { identityOf, isFull } from '@/lib/permissions';
import { applyAction, PermissionError, ValidationError, type ProjectAction } from '@/server/actions';

type Params = { params: Promise<{ id: string }> };

/* v2.2 §4.4: workflow submissions that must be idempotent + committed under a
   version CAS. Maps the client action type → the workflow_actions action_type. */
const WORKFLOW_ACTIONS: Record<string, string> = {
  submitHandover: 'submit_handover',
  acceptHandover: 'accept_handover',
  submitCompletion: 'submit_completion',
  decideCompletion: 'pd_decide',
  salesVerify: 'sales_verify',
};

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;
  const p = getProject(id);
  if (!p) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
  return NextResponse.json({ project: p });
}

/* Apply one permission-checked action to the project (server is authoritative).
   Last-write-wins, but if the client's baseUpdatedAt is older than what's in
   the DB we flag `conflict` so the UI can warn that it overwrote a concurrent edit. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;
  const p = getProject(id);
  if (!p) return NextResponse.json({ error: '项目不存在' }, { status: 404 });

  const body = (await req.json().catch(() => null)) as (ProjectAction & { baseUpdatedAt?: number }) | null;
  if (!body || typeof body.type !== 'string') {
    return NextResponse.json({ error: '无效请求' }, { status: 400 });
  }
  const baseUpdatedAt = body.baseUpdatedAt;
  const serverUpdatedAt = p.updatedAt || 0;
  const conflict = typeof baseUpdatedAt === 'number' && baseUpdatedAt > 0 && baseUpdatedAt < serverUpdatedAt;

  const expectedVersion = p.version || 0;
  const wfVersionForKey = p.workflowVersion || 1; // capture before the action may bump it (§10 rollback)
  const logLenBefore = (p.log || []).length;
  try {
    applyAction(identityOf(user), p, body, { tplForSvc: getEffectiveTemplate });
  } catch (e) {
    if (e instanceof PermissionError) return NextResponse.json({ error: e.message }, { status: 403 });
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  const newEntries = (p.log || []).slice(0, Math.max(0, (p.log || []).length - logLenBefore));

  /* Workflow submissions go through the transactional idempotency + CAS commit
     (§4.4/§4.5). Everything else keeps the existing save (which still bumps
     version); the strict global CAS switch is scheduled for S5. */
  const wfType = WORKFLOW_ACTIONS[body.type];
  if (wfType) {
    const r = commitWorkflowAction(p, wfType, user.name, expectedVersion, wfVersionForKey);
    if (r === 'duplicate') return NextResponse.json({ error: '该动作已提交,请勿重复提交。' }, { status: 409 });
    if (r === 'stale') return NextResponse.json({ error: '此项目刚被他人修改,请刷新后重新提交。', stale: true }, { status: 409 });
    appendAudit(id, newEntries);
    return NextResponse.json({ project: p, conflict: false });
  }

  appendAudit(id, newEntries);
  saveProject(p);
  return NextResponse.json({ project: p, conflict });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!isFull(identityOf(user))) {
    return NextResponse.json({ error: '仅 PD/BD 可删除项目' }, { status: 403 });
  }
  const { id } = await params;
  deleteProject(id);
  return NextResponse.json({ ok: true });
}
