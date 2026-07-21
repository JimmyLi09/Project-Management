import { NextRequest, NextResponse } from 'next/server';
import { listProjects, saveProject } from '@/server/db';
import { currentUser } from '@/server/session';
import { canAssign, identityOf } from '@/lib/permissions';
import { transferInProject } from '@/server/actions';

/* Batch handover: move ALL projects (ownership + optional task assignments)
   from one person to another. For vacations / departures. PD/BD only. */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canAssign(identityOf(user))) {
    return NextResponse.json({ error: '仅 PD/BD 可转交项目' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const from = String(body.from || '').trim();
  const to = String(body.to || '').trim();
  const includeTasks = body.includeTasks !== false; // default: move task assignments too
  if (!from || !to) return NextResponse.json({ error: '转出人与接收人不能为空' }, { status: 400 });
  if (from === to) return NextResponse.json({ error: '转出人与接收人相同' }, { status: 400 });

  let transferred = 0;
  for (const p of listProjects()) {
    if (transferInProject(p, user.name, from, to, includeTasks)) {
      saveProject(p);
      transferred++;
    }
  }
  return NextResponse.json({ transferred });
}
