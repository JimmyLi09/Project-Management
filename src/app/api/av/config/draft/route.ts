import { NextRequest, NextResponse } from 'next/server';
import { canCostProject, identityOf } from '@/lib/permissions';
import { logZh } from '@/lib/logmsg';
import { clearDraft, getDrawing, saveDraft } from '@/server/avdb';
import { denyUnlessVisible } from '@/server/avguard';
import { appendAuditMerged, getProject } from '@/server/db';
import { currentUser } from '@/server/session';

/* AV-016 ② · 05 自动草稿,每人一份。PUT { projectId, line, cfg, drawingId? } 存;DELETE ?project=&line= 丢弃
   (都只动自己那份)。能存正式方案的人(项目 PM、PD / BD)才能存草稿。草稿只是参数,不算、不进 06。
   每次存都写操作日志,但同一人同一条线 10 分钟内的连续草稿合并成一条。 */
const lineOf = (v: unknown) => (v === 'projector' || v === 'elv' || v === 'pv' ? v : 'led');
const MAX = 64 * 1024;

async function guard(projectId: string) {
  const user = await currentUser();
  if (!user) return { error: NextResponse.json({ error: '未登录' }, { status: 401 }) };
  const project = getProject(projectId);
  if (!project) return { error: NextResponse.json({ error: '项目不存在' }, { status: 404 }) };
  const denied = denyUnlessVisible(user, project);
  if (denied) return { error: denied };
  if (!canCostProject(identityOf(user), project)) return { error: NextResponse.json({ error: '仅该项目的 PM 或 PD / BD 可以保存方案' }, { status: 403 }) };
  return { user, project };
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { projectId?: string; line?: string; cfg?: unknown; drawingId?: number | null } | null;
  const g = await guard(String(body?.projectId ?? ''));
  if ('error' in g) return g.error;
  if (!body?.cfg || typeof body.cfg !== 'object') return NextResponse.json({ error: '缺少方案参数' }, { status: 400 });
  if (JSON.stringify(body.cfg).length > MAX) return NextResponse.json({ error: '方案参数过大' }, { status: 400 });
  const drawingId = body.drawingId ? Number(body.drawingId) : null;
  if (drawingId) {
    const d = getDrawing(drawingId);
    if (!d || d.project_id !== g.project.id) return NextResponse.json({ error: '图纸不属于该项目' }, { status: 400 });
  }
  const line = lineOf(body.line);
  const draft = saveDraft(g.project.id, line, body.cfg, drawingId, g.user);
  const p = { svc: line };
  appendAuditMerged(g.project.id, { at: draft.updatedAt, by: g.user.name, text: logZh('av.draft', p), k: 'av.draft', p });
  return NextResponse.json({ draft });
}

export async function DELETE(req: NextRequest) {
  const g = await guard(req.nextUrl.searchParams.get('project') ?? '');
  if ('error' in g) return g.error;
  clearDraft(g.project.id, lineOf(req.nextUrl.searchParams.get('line')), g.user.id);
  return NextResponse.json({ ok: true });
}
