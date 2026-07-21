import { NextRequest, NextResponse } from 'next/server';
import { deleteProject, getProject, saveProject } from '@/server/db';
import { currentUser } from '@/server/session';
import { identityOf, isFull } from '@/lib/permissions';
import { applyAction, PermissionError, ValidationError, type ProjectAction } from '@/server/actions';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;
  const p = getProject(id);
  if (!p) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
  return NextResponse.json({ project: p });
}

/* Apply one permission-checked action to the project (server is authoritative). */
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;
  const p = getProject(id);
  if (!p) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
  const action = (await req.json().catch(() => null)) as ProjectAction | null;
  if (!action || typeof action.type !== 'string') {
    return NextResponse.json({ error: '无效请求' }, { status: 400 });
  }
  try {
    applyAction(identityOf(user), p, action);
  } catch (e) {
    if (e instanceof PermissionError) return NextResponse.json({ error: e.message }, { status: 403 });
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  saveProject(p);
  return NextResponse.json({ project: p });
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
