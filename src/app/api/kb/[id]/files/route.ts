import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { canEditKb, identityOf } from '@/lib/permissions';
import { attachFile, MAX_FILE } from '@/server/kb';

/* 给某篇文档加附件(不新建文档,和「导入」区分开) */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canEditKb(identityOf(user))) return NextResponse.json({ error: '仅 总监 / BD / PM 可添加附件' }, { status: 403 });
  const { id } = await params;
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: '没有收到文件' }, { status: 400 });
  if (file.size > MAX_FILE) return NextResponse.json({ error: '附件超过 8MB' }, { status: 400 });
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    return NextResponse.json({ doc: attachFile(id, file.name, file.type || 'application/octet-stream', buf, user.name) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
