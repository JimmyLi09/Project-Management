import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { canDeleteKb, canEditKbDoc, identityOf } from '@/lib/permissions';
import { oneDoc, oneDocWithPreviews, saveDoc, versionsOf } from '@/server/kb';
import { deleteKbDoc } from '@/server/db';
import { resumePending } from '@/server/kbPreview';

/* GET 单篇(带版本历史、附件预览状态) / PUT 保存(版本 +1) / DELETE 删除(仅总监 / BD)。
   REQ-061:PM 只能改自己建的文档(含归类);首页流程地图那一篇不能删。 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;
  resumePending();
  const doc = oneDocWithPreviews(id);
  if (!doc) return NextResponse.json({ error: '文档不存在' }, { status: 404 });
  return NextResponse.json({ doc, versions: versionsOf(id) });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;
  const cur = oneDoc(id);
  if (!cur) return NextResponse.json({ error: '文档不存在' }, { status: 404 });
  if (!canEditKbDoc(identityOf(user), cur)) {
    return NextResponse.json({ error: '只有 PD / BD 和这篇文档的创建人(PM)可以编辑 / Only PD / BD and the PM who created this document can edit it' }, { status: 403 });
  }
  try {
    saveDoc(id, await req.json(), user.name);
    return NextResponse.json({ doc: oneDocWithPreviews(id), versions: versionsOf(id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canDeleteKb(identityOf(user))) return NextResponse.json({ error: '仅 总监 / BD 可删除文档' }, { status: 403 });
  const { id } = await params;
  const doc = oneDoc(id);
  if (!doc) return NextResponse.json({ error: '文档不存在' }, { status: 404 });
  if (doc.isMap) return NextResponse.json({ error: '这是知识库首页的流程地图,不能删除 / This is the knowledge base home map and cannot be deleted' }, { status: 400 });
  deleteKbDoc(id);
  return NextResponse.json({ ok: true });
}
