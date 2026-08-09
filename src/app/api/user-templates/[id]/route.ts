import { NextRequest, NextResponse } from 'next/server';
import { deleteUserTemplate, getUserTemplate } from '@/server/db';
import { currentUser } from '@/server/session';
import { canDeleteTemplate, identityOf } from '@/lib/permissions';

type Params = { params: Promise<{ id: string }> };

/* REQ-012: fetch one saved template (payload included, for applying) */
export async function GET(_req: NextRequest, { params }: Params) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;
  const tpl = getUserTemplate(Number(id));
  if (!tpl) return NextResponse.json({ error: '模板不存在' }, { status: 404 });
  return NextResponse.json({ template: { ...tpl, payload: JSON.parse(tpl.payload) } });
}

/* Delete a user template — author or PD/BD only. Built-in reference templates
   live in code, not in this table, so they can never be deleted through here. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;
  const tpl = getUserTemplate(Number(id));
  if (!tpl) return NextResponse.json({ error: '模板不存在' }, { status: 404 });
  if (!canDeleteTemplate(identityOf(user), tpl.created_by)) {
    return NextResponse.json({ error: '只有模板创建者或 PD/BD 可以删除' }, { status: 403 });
  }
  deleteUserTemplate(Number(id));
  return NextResponse.json({ ok: true });
}
