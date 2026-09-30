import { NextRequest, NextResponse } from 'next/server';
import { denyUnlessVisible } from '@/server/avguard';
import { listUploads } from '@/server/avupload';
import { getProject } from '@/server/db';
import { currentUser } from '@/server/session';

/* GET /api/av/uploads?project= — AV-016 ①:这个项目上传过的原件(含解析失败的) */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const project = getProject(req.nextUrl.searchParams.get('project') ?? '');
  if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
  const denied = denyUnlessVisible(user, project);
  if (denied) return denied;
  return NextResponse.json({ uploads: listUploads(project.id) });
}
