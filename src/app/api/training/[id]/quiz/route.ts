import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { submitQuiz } from '@/server/training';

/* 交卷。判分只在服务端做:浏览器从头到尾拿不到正确答案,
   所以没法自己给自己判及格。成绩与尝试次数一并留痕。 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { answers?: Record<string, string[]> };
  try {
    return NextResponse.json(submitQuiz(id, user.name, body.answers || {}));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
