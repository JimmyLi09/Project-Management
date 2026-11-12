import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { canDeleteKbFile, identityOf } from '@/lib/permissions';
import { getKbFile } from '@/server/db';
import { oneDoc, removeFile } from '@/server/kb';

/* 附件下载 / 删除。下载对所有登录用户开放(只读角色也要能看资料),行为不变(attachment)。
   在线预览走 /api/kb/files/[fid]/preview。REQ-061:PM 只能删自己上传的附件。 */
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
  const { fid } = await params;
  const f = getKbFile(fid);
  if (!f) return NextResponse.json({ error: '附件不存在' }, { status: 404 });
  if (!canDeleteKbFile(identityOf(user), { uploadedBy: f.uploaded_by })) {
    return NextResponse.json({ error: '只有 PD / BD 和上传这个附件的人可以删除 / Only PD / BD and the person who uploaded this file can delete it' }, { status: 403 });
  }
  if (oneDoc(f.doc_id)?.attachments.some((a) => a.id === fid && a.isMap)) {
    return NextResponse.json({ error: '这是首页流程地图当前这一版,请在首页「更新地图」换新版本 / This is the current home map — upload a new version from the home page instead' }, { status: 400 });
  }
  return NextResponse.json({ doc: removeFile(f.doc_id, fid, user.name) });
}
