import { NextRequest, NextResponse } from 'next/server';
import { listJudges } from '@/server/avjudge';
import { denyUnlessVisible, denyAvModule } from '@/server/avguard';
import { getProject } from '@/server/db';
import { currentUser } from '@/server/session';

/* GET /api/av/judge?project= — a project's image judgements (AV-015), for the
   drawings list on 02–04. */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  { const deny = denyAvModule(user); if (deny) return deny; }
  const project = getProject(req.nextUrl.searchParams.get('project') ?? '');
  if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
  const denied = denyUnlessVisible(user, project);
  if (denied) return denied;
  return NextResponse.json({ judges: listJudges(project.id, true) });
}
