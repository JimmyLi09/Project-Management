import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { TrainError, quizForLearner, quizForMaintainer, saveQuizAs } from '@/server/train062';

/* REQ-062 测验题库。
   GET ?key=        学员拿题:不带答案;未解锁 / 学习步骤没做完的 409
   GET ?key=&full=1 维护的人(PD / BD、Senior PM / PM Director)拿全量;自己还要考这一份的不给
   PUT { key, questions, passScore? }  保存;及格线只有 PD / BD 能改 */
const fail = (e: unknown) => NextResponse.json({ error: (e as Error).message }, { status: e instanceof TrainError ? e.status : 400 });

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const key = req.nextUrl.searchParams.get('key') || '';
  try {
    return NextResponse.json(req.nextUrl.searchParams.get('full') === '1' ? quizForMaintainer(user, key) : quizForLearner(user, key));
  } catch (e) { return fail(e); }
}

export async function PUT(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { key?: string; questions?: unknown; passScore?: unknown };
  try {
    return NextResponse.json(saveQuizAs(user, String(body.key || ''), body));
  } catch (e) { return fail(e); }
}
