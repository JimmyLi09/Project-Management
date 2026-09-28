import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { canEditKb, identityOf } from '@/lib/permissions';
import { getKbFile } from '@/server/db';
import { removeFile } from '@/server/kb';

/* 附件下载 / 删除。下载对所有登录用户开放(只读角色也要能看资料)。 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ fid: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { fid } = await params;
  const f = getKbFile(fid);
  if (!f) return NextResponse.json({ error: '附件不存在' }, { status: 404 });
  const buf = Buffer.from(f.data, 'base64');
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': f.mime || 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'Content-Length': String(buf.length),
    },
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ fid: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canEditKb(identityOf(user))) return NextResponse.json({ error: '仅 总监 / BD / PM 可删除附件' }, { status: 403 });
  const { fid } = await params;
  const f = getKbFile(fid);
  if (!f) return NextResponse.json({ error: '附件不存在' }, { status: 404 });
  return NextResponse.json({ doc: removeFile(f.doc_id, fid, user.name) });
}
