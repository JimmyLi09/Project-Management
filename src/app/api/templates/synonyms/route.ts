import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { canAdmin, identityOf } from '@/lib/permissions';
import { getChecklistSynonyms, resetChecklistSynonyms, saveChecklistSynonyms } from '@/server/db';

/* REQ-044: 信息清单「同义项」对照 —— 合并 / 加服务包时,名字不同但说的是同一份资料的项
   当成同一项。任何登录的人能看(加服务包时要用),只有 PD / BD 能改。
   PUT { list: string[][] } 保存;DELETE 恢复默认。只影响之后的合并,已经合好的不回头改。 */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  return NextResponse.json(getChecklistSynonyms());
}

export async function PUT(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canAdmin(identityOf(user))) return NextResponse.json({ error: '仅 PD/BD 可修改同义项' }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { list?: unknown } | null;
  if (!body || !Array.isArray(body.list)) return NextResponse.json({ error: '格式不对' }, { status: 400 });
  const list = saveChecklistSynonyms(body.list);
  return NextResponse.json({ ...getChecklistSynonyms(), list });
}

export async function DELETE() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canAdmin(identityOf(user))) return NextResponse.json({ error: '仅 PD/BD 可修改同义项' }, { status: 403 });
  resetChecklistSynonyms();
  return NextResponse.json(getChecklistSynonyms());
}
