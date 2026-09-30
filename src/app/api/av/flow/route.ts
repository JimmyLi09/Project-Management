import { NextRequest, NextResponse } from 'next/server';
import { identityOf } from '@/lib/permissions';
import { denyUnlessVisible } from '@/server/avguard';
import { projectFlow } from '@/server/avflow';
import { getProject } from '@/server/db';
import { currentUser } from '@/server/session';

/* GET /api/av/flow?project= — AV-017 步骤条:这个项目每一步的状态、正式版本数、最近更新 */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const project = getProject(req.nextUrl.searchParams.get('project') ?? '');
  if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
  const denied = denyUnlessVisible(user, project);
  if (denied) return denied;
  return NextResponse.json({ flow: projectFlow(project, identityOf(user)) });
}
