import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { canDeleteKb, canEditKb, identityOf } from '@/lib/permissions';
import { oneDoc, saveDoc, versionsOf } from '@/server/kb';
import { deleteKbDoc } from '@/server/db';

/* GET 单篇(带版本历史) / PUT 保存(版本 +1) / DELETE 删除(仅总监 / BD) */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;
  const doc = oneDoc(id);
  if (!doc) return NextResponse.json({ error: '文档不存在' }, { status: 404 });
  return NextResponse.json({ doc, versions: versionsOf(id) });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canEditKb(identityOf(user))) return NextResponse.json({ error: '仅 总监 / BD / PM 可编辑文档' }, { status: 403 });
  const { id } = await params;
  try {
    const doc = saveDoc(id, await req.json(), user.name);
    return NextResponse.json({ doc, versions: versionsOf(id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canDeleteKb(identityOf(user))) return NextResponse.json({ error: '仅 总监 / BD 可删除文档' }, { status: 403 });
  const { id } = await params;
  if (!oneDoc(id)) return NextResponse.json({ error: '文档不存在' }, { status: 404 });
  deleteKbDoc(id);
  return NextResponse.json({ ok: true });
}
