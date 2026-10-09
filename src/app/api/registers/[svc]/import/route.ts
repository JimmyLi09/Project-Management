import { NextRequest, NextResponse } from 'next/server';
import { importJobRows, importRegisterRecords } from '@/server/db';
import { currentUser } from '@/server/session';
import { identityOf, isFull } from '@/lib/permissions';
import { SVC } from '@/lib/templates';

type Params = { params: Promise<{ svc: string }> };

/* §6: POST /api/registers/:svc/import — bulk import, all-or-nothing (one bad row rolls the whole batch back).
   REQ-049: Body { jobRows: [{ project?, no?, svc?, item, detail, qty, note }] } —— 4 栏表(项目档案现在读的就是它),
   任何业务都行(:svc 是页签,可以是 all);旧的 { rows: [{ project, patch }] } 写旧登记表字段,留着给脚本用。 */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!isFull(identityOf(user))) return NextResponse.json({ error: '仅 PD/BD 可批量导入' }, { status: 403 });

  const { svc } = await params;
  if (svc !== 'all' && !SVC[svc]) return NextResponse.json({ error: '未知的业务类型' }, { status: 400 });

  const body = (await req.json().catch(() => null)) as {
    rows?: { project: string; patch: Record<string, string> }[];
    jobRows?: { project?: string; no?: string; svc?: string; item?: string; detail?: string; qty?: string; note?: string }[];
  } | null;
  if (Array.isArray(body?.jobRows)) {
    const jr = body!.jobRows!;
    if (jr.length === 0) return NextResponse.json({ error: '没有可导入的行' }, { status: 400 });
    if (jr.length > 5000) return NextResponse.json({ error: '单次导入上限 5000 行' }, { status: 400 });
    try {
      const r = importJobRows(svc, jr, user.name);
      return NextResponse.json({ ok: true, ...r });
    } catch (e: unknown) {
      return NextResponse.json({ error: e instanceof Error ? e.message : '导入失败', rolledBack: true }, { status: 400 });
    }
  }
  if (svc === 'all') return NextResponse.json({ error: '未知的登记表类型' }, { status: 400 });
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
