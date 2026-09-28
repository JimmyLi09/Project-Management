import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { canEditTraining, identityOf } from '@/lib/permissions';
import { allPaths, allProgress, attemptsOf, createPath, stripAnswers } from '@/server/training';

/* REQ-036: 培训路径。
   GET  — 所有登录用户,题目一律**剥掉正确答案**(管理员也不例外:
          PM 既维护题库又可能是学员,答案跟着列表进浏览器就等于泄题)。
          要改题的人从 GET /api/training/[id] 单独取全量,那条按路径判权限。
          进度:管理员看全部,其他人只看自己那份。
   POST — 总监 / BD / PM 建路径。 */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const me = identityOf(user);
  const admin = canEditTraining(me);
  const paths = allPaths();
  return NextResponse.json({
    paths: paths.map(stripAnswers),
    progress: admin ? allProgress() : allProgress().filter((p) => p.user === user.name),
    attempts: admin ? attemptsOf() : attemptsOf().filter((a) => a.user === user.name),
    admin,
  });
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canEditTraining(identityOf(user))) return NextResponse.json({ error: '仅 总监 / BD / PM 可编辑培训路径' }, { status: 403 });
  try {
    return NextResponse.json({ path: createPath(await req.json(), user.name) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
