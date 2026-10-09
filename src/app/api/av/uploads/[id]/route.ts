import { NextRequest, NextResponse } from 'next/server';
import { identityOf, isFull } from '@/lib/permissions';
import { denyUnlessVisible, denyAvModule } from '@/server/avguard';
import { removeFailedUpload, uploadProject } from '@/server/avupload';
import { getProject } from '@/server/db';
import { currentUser } from '@/server/session';

type Params = { params: Promise<{ id: string }> };

/* DELETE — 移除一份解析失败、不要了的留档(比如已经换了一份好的重新上传)。解析成功的删不了。
   AV-016:只有 PD / BD 能删,写操作日志 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  { const deny = denyAvModule(user); if (deny) return deny; }
  const id = Number((await params).id);
  const pid = Number.isInteger(id) ? uploadProject(id) : null;
  const project = pid ? getProject(pid) : null;
  if (!project) return NextResponse.json({ error: '留档不存在' }, { status: 404 });
  const denied = denyUnlessVisible(user, project);
  if (denied) return denied;
  if (!isFull(identityOf(user))) return NextResponse.json({ error: '只有 PD / BD 可以删除留档' }, { status: 403 });
  if (!(await removeFailedUpload(id, user.name))) return NextResponse.json({ error: '只有解析失败的留档可以移除' }, { status: 409 });
  return NextResponse.json({ ok: true });
}
