import { NextRequest, NextResponse } from 'next/server';
import { importRegisterRecords } from '@/server/db';
import { currentUser } from '@/server/session';
import { identityOf, isFull } from '@/lib/permissions';
import { registerDef } from '@/lib/records';

type Params = { params: Promise<{ svc: string }> };

/* §6: POST /api/registers/:svc/import — bulk import register records.
   Body: { rows: [{ project: string, patch: Record<string,string> }] }
   All-or-nothing: one bad project name rolls the whole batch back. */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!isFull(identityOf(user))) return NextResponse.json({ error: '仅 PD/BD 可批量导入' }, { status: 403 });

  const { svc } = await params;
  if (!registerDef(svc)) return NextResponse.json({ error: '未知的登记表类型' }, { status: 400 });

  const body = (await req.json().catch(() => null)) as { rows?: { project: string; patch: Record<string, string> }[] } | null;
  const rows = body?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return NextResponse.json({ error: '没有可导入的行' }, { status: 400 });
  if (rows.length > 2000) return NextResponse.json({ error: '单次导入上限 2000 行' }, { status: 400 });

  try {
    const { updated } = importRegisterRecords(svc, rows, user.name);
    return NextResponse.json({ ok: true, updated });
  } catch (e: unknown) {
    // transaction already rolled back — nothing was written
    const msg = e instanceof Error ? e.message : '导入失败';
    return NextResponse.json({ error: msg, rolledBack: true }, { status: 400 });
  }
}
