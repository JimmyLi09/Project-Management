import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { canRevertKb, identityOf } from '@/lib/permissions';
import { revertDoc, versionsOf } from '@/server/kb';

/* GET 版本列表(人人能看) / POST { version } 回退到某一版(回退本身也会存成新的一版)。
   REQ-061:恢复旧版本只有 PD / BD。 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;
  return NextResponse.json({ versions: versionsOf(id) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canRevertKb(identityOf(user))) return NextResponse.json({ error: '只有 PD / BD 可以恢复旧版本 / Only PD / BD can restore an earlier version' }, { status: 403 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { version?: number };
  try {
    const doc = revertDoc(id, Number(body.version), user.name);
    return NextResponse.json({ doc, versions: versionsOf(id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
