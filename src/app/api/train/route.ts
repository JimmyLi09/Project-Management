import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { TrainError, act, bundle } from '@/server/train062';

/* REQ-062 新人培训。GET:这个人能看到的全部(自己的关卡、带的人、待我评估、能力矩阵、配置);
   POST { op, ... }:所有操作,权限在 server/train062.ts 里逐个判,改完返回最新的数据。 */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  return NextResponse.json(bundle(user));
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const r = act(user, body);
    return NextResponse.json({ ...bundle(user), result: r.result ?? null });
  } catch (e) {
    const status = e instanceof TrainError ? e.status : 400;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
