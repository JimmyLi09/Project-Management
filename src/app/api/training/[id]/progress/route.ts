import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { markStep } from '@/server/training';

/* 勾掉一步。只能勾自己的 —— 进度是本人的学习记录,
   不接受 body 里带别人的名字。 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { stepId?: string; done?: boolean };
  try {
    return NextResponse.json({ progress: markStep(id, user.name, String(body.stepId || ''), !!body.done) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
