import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { canEditQuizOnly, canEditTraining, identityOf } from '@/lib/permissions';
import { getDb } from '@/server/db';
import { trainUser, trainUsers } from '@/server/trainStore';
import { allPaths, allProgress, attemptsOf, createPath, stripAnswers } from '@/server/training';

/* REQ-036: 培训路径。
   GET  — 所有登录用户,题目一律**剥掉正确答案**(管理员也不例外:
          PM 既维护题库又可能是学员,答案跟着列表进浏览器就等于泄题)。
          要改题的人从 GET /api/training/[id] 单独取全量,那条按路径判权限。
          进度:管理员看全部,其他人只看自己那份。
   POST — 总监 / BD 建路径(REQ-062 起 PM 不再能建;Senior PM / PM Director 只能改题目)。 */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const me = identityOf(user);
  const admin = canEditTraining(me);
  /* REQ-062:看别人的进度 —— PD / BD 全部;带教人看自己带的人;其他人只看自己 */
  const d = getDb();
  const self = trainUser(d, user.name);
  const mentees = new Set(trainUsers(d).filter((u) => u.mentor === user.name).map((u) => u.name));
  const sees = (n: string) => admin || n === user.name || mentees.has(n);
  const quizOnly = canEditQuizOnly({ ...me, pmLevel: self?.pmLevel });
  const paths = allPaths();
  return NextResponse.json({
    paths: paths.map(stripAnswers),
    progress: allProgress().filter((p) => sees(p.user)),
    attempts: attemptsOf().filter((a) => sees(a.user)),
    admin,
    maint: admin ? 'full' : quizOnly ? 'quiz' : 'none',
    mentees: [...mentees],
  });
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canEditTraining(identityOf(user))) return NextResponse.json({ error: '只有 PD / BD 可以新建培训路径 / Only PD / BD can create training paths' }, { status: 403 });
  try {
    return NextResponse.json({ path: createPath(await req.json(), user.name) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
