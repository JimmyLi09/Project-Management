import { NextRequest, NextResponse } from 'next/server';
import { listDrawings } from '@/server/avdb';
import { getProject } from '@/server/db';
import { currentUser } from '@/server/session';

/* GET /api/av/drawings?project=ID — a project's LED drawings with review status.
   Every signed-in role can see all projects in this app, so reading is open. */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const projectId = req.nextUrl.searchParams.get('project') ?? '';
  if (!getProject(projectId)) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
  return NextResponse.json({ drawings: listDrawings(projectId) });
}
