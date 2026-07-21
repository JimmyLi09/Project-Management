import { NextRequest, NextResponse } from 'next/server';
import { getProject, listAudit } from '@/server/db';
import { currentUser } from '@/server/session';

/* Full permanent audit trail for a project (never rotated, unlike the
   200-entry in-document log). Any signed-in user who can see the project. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;
  const p = getProject(id);
  if (!p) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
  return NextResponse.json({ entries: listAudit(id, 2000) });
}
