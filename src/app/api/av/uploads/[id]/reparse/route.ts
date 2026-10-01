import { NextRequest, NextResponse } from 'next/server';
import { canUploadDrawing, identityOf, isFull } from '@/lib/permissions';
import { denyUnlessVisible } from '@/server/avguard';
import { parseUpload, uploadProject } from '@/server/avupload';
import { getProject } from '@/server/db';
import { currentUser } from '@/server/session';

type Params = { params: Promise<{ id: string }> };

/* POST { scale? } — AV-016 ①:对留档的原件再解析一次(制图服务修好了 / 补了比例尺) */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const id = Number((await params).id);
  const pid = Number.isInteger(id) ? uploadProject(id) : null;
  const project = pid ? getProject(pid) : null;
  if (!project) return NextResponse.json({ error: '留档不存在' }, { status: 404 });
  const denied = denyUnlessVisible(user, project);
  if (denied) return denied;
  if (!canUploadDrawing(identityOf(user), project)) return NextResponse.json({ error: '无权为该项目解析图纸' }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { scale?: number | string };
  const scale = body.scale === undefined || body.scale === '' ? null : Number(body.scale);
  if (scale !== null && !(scale > 0)) return NextResponse.json({ error: '比例尺须为正数，如 1:50 填 50' }, { status: 400 });
  const out = await parseUpload(id, scale, user.name, isFull(identityOf(user)), true);
  if (out.kind === 'judge') return NextResponse.json({ judge: out.judge, uploadId: id });
  if (out.kind === 'drawing') return NextResponse.json({ ...out.drawing, uploadId: id });
  return NextResponse.json({ error: out.error, reason: out.reason, uploadId: id, archived: true }, { status: out.status });
}
