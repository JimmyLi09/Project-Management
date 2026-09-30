import { NextRequest, NextResponse } from 'next/server';
import { denyUnlessVisible } from '@/server/avguard';
import { readUpload, uploadProject } from '@/server/avupload';
import { getProject } from '@/server/db';
import { currentUser } from '@/server/session';

type Params = { params: Promise<{ id: string }> };

/* GET — 下载留档的原件 */
export async function GET(_req: NextRequest, { params }: Params) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const id = Number((await params).id);
  const pid = Number.isInteger(id) ? uploadProject(id) : null;
  const project = pid ? getProject(pid) : null;
  if (!project) return NextResponse.json({ error: '留档不存在' }, { status: 404 });
  const denied = denyUnlessVisible(user, project);
  if (denied) return denied;
  const f = await readUpload(id);
  if (!f) return NextResponse.json({ error: '原件不在了' }, { status: 404 });
  return new NextResponse(new Uint8Array(f.data), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="upload"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    },
  });
}
