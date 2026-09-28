import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { canEditKb, identityOf } from '@/lib/permissions';
import { allDocs, createDoc } from '@/server/kb';

/* REQ-035: 知识库文档。
   GET  — 所有登录用户(其余角色只读 + 可导出,读是人人有份的)
   POST — 总监 / BD / PM */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  return NextResponse.json({ docs: allDocs() });
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canEditKb(identityOf(user))) return NextResponse.json({ error: '仅 总监 / BD / PM 可新增文档' }, { status: 403 });
  try {
    return NextResponse.json({ doc: createDoc(await req.json(), user.name) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
