import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { canDeleteKb, canEditPath, identityOf } from '@/lib/permissions';
import { onePath, savePath } from '@/server/training';
import { deleteTrainingPath } from '@/server/db';

/* GET — 取一条路径的**全量**(含正确答案),给编辑器用。
   这是答案唯一的出口,所以按路径判权限:勾了「仅总监维护」的,PM 也拿不到。
   列表接口 /api/training 一律不带答案。 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;
  const path = onePath(id);
  if (!path) return NextResponse.json({ error: '培训路径不存在' }, { status: 404 });
  if (!canEditPath(identityOf(user), path.adminOnly)) {
    return NextResponse.json({ error: '无权查看这条路径的题目答案' }, { status: 403 });
  }
  return NextResponse.json({ path });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;
  const cur = onePath(id);
  if (!cur) return NextResponse.json({ error: '培训路径不存在' }, { status: 404 });
  const me = identityOf(user);
  /* 现状和改后的状态都要有权限 —— 否则 PM 可以把 adminOnly 关掉再随便改 */
  const body = await req.json().catch(() => ({}));
  if (!canEditPath(me, cur.adminOnly) || !canEditPath(me, !!(body as { adminOnly?: unknown }).adminOnly)) {
    return NextResponse.json({ error: '无权编辑这条培训路径' }, { status: 403 });
  }
  try {
    return NextResponse.json({ path: savePath(id, body, user.name) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/* 删路径连着删所有人的进度与成绩,所以按知识库同一档收紧到 总监 / BD */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canDeleteKb(identityOf(user))) return NextResponse.json({ error: '仅 总监 / BD 可删除培训路径' }, { status: 403 });
  const { id } = await params;
  if (!onePath(id)) return NextResponse.json({ error: '培训路径不存在' }, { status: 404 });
  deleteTrainingPath(id);
  return NextResponse.json({ ok: true });
}
