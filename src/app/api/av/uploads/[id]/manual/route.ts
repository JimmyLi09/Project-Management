import { NextRequest, NextResponse } from 'next/server';
import { canUploadDrawing, identityOf, isFull } from '@/lib/permissions';
import { denyUnlessVisible, denyAvModule } from '@/server/avguard';
import { manualUpload, uploadProject } from '@/server/avupload';
import { getProject } from '@/server/db';
import { currentUser } from '@/server/session';

type Params = { params: Promise<{ id: string }> };

/* POST — AV-016 ①:解析失败的留档改为「手填」,返回一张手填的判读单(填完确认同样进入校核 / 带入 05) */
export async function POST(_req: NextRequest, { params }: Params) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  { const deny = denyAvModule(user); if (deny) return deny; }
  const id = Number((await params).id);
  const pid = Number.isInteger(id) ? uploadProject(id) : null;
  const project = pid ? getProject(pid) : null;
  if (!project) return NextResponse.json({ error: '留档不存在' }, { status: 404 });
  const denied = denyUnlessVisible(user, project);
  if (denied) return denied;
  if (!canUploadDrawing(identityOf(user), project)) return NextResponse.json({ error: '无权为该项目处理图纸' }, { status: 403 });
  const out = await manualUpload(id, user.name, isFull(identityOf(user)));
  if (out.kind === 'judge') return NextResponse.json({ judge: out.judge, uploadId: id });
  return NextResponse.json({ error: out.kind === 'failed' ? out.error : '处理失败', uploadId: id }, { status: out.kind === 'failed' ? out.status : 500 });
}
