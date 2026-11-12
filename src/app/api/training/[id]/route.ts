import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { canDeleteKb, canEditPath, canEditQuizOnly, identityOf } from '@/lib/permissions';
import { getDb } from '@/server/db';
import { trainUser } from '@/server/trainStore';
import { onePath, savePath } from '@/server/training';
import { deleteTrainingPath } from '@/server/db';

/* GET — 取一条路径的**全量**(含正确答案),给编辑器用。REQ-062:PD / BD 全部;Senior PM / PM Director 只改题目(quizOnly)。
   这是答案唯一的出口,所以按路径判权限:勾了「仅总监维护」的,PM 也拿不到。
   列表接口 /api/training 一律不带答案。 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;
  const path = onePath(id);
  if (!path) return NextResponse.json({ error: '培训路径不存在' }, { status: 404 });
  const me = identityOf(user);
  const quizOnly = !path.adminOnly && canEditQuizOnly({ ...me, pmLevel: trainUser(getDb(), user.name)?.pmLevel });
  if (!canEditPath(me, path.adminOnly) && !quizOnly) {
    return NextResponse.json({ error: '无权查看这条路径的题目答案 / You cannot see the answers of this path' }, { status: 403 });
  }
  return NextResponse.json({ path, quizOnly: !canEditPath(me, path.adminOnly) });
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
  const full = canEditPath(me, cur.adminOnly) && canEditPath(me, !!(body as { adminOnly?: unknown }).adminOnly);
  /* REQ-062:Senior PM / PM Director 只能改题目 —— 其余字段一律按库里的原样存回去 */
  const quizOnly = !full && !cur.adminOnly && canEditQuizOnly({ ...me, pmLevel: trainUser(getDb(), user.name)?.pmLevel });
  if (!full && !quizOnly) {
    return NextResponse.json({ error: '只有 PD / BD 可以编辑培训路径 / Only PD / BD can edit training paths' }, { status: 403 });
  }
  const input = full ? body : {
    title: cur.title, titleEn: cur.titleEn, role: cur.role, assignees: cur.assignees, steps: cur.steps,
    passScore: cur.passScore, adminOnly: cur.adminOnly, quiz: (body as { quiz?: unknown }).quiz,
  };
  try {
    return NextResponse.json({ path: savePath(id, input, user.name) });
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
