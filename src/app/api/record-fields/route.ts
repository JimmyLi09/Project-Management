import { NextRequest, NextResponse } from 'next/server';
import { listRecordFields, setRecordFields, resetRecordFields } from '@/server/db';
import { currentUser } from '@/server/session';
import { canAdmin, identityOf } from '@/lib/permissions';
import { validateFields } from '@/lib/records';
import { SVC } from '@/lib/templates';

/* REQ-023: per-service record field schema.
   GET  — any signed-in user (everyone needs the columns to render).
   PUT  { svc, fields } — PD / BD only: the schema is global, one edit changes
          every project of that service type in both Job Record and Registers.
   DELETE ?svc= — restore the built-in default columns. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  return NextResponse.json({ overrides: listRecordFields() });
}

export async function PUT(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canAdmin(identityOf(user))) return NextResponse.json({ error: '仅 PD / BD 可修改字段' }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { svc?: string; fields?: unknown } | null;
  /* 0917 变更单 · REQ-023:不再限定在内置的 7 张登记表 —— 任何一个业务类型
     都可以由 PD 自己定列(出厂没有登记表的,加完列就有了一张)。仍然只认
     SVC 里的业务 key,防止往表里写进一个不存在的 svc。 */
  const svc = String(body?.svc || '');
  if (!SVC[svc]) return NextResponse.json({ error: '无效的服务类型' }, { status: 400 });

  const v = validateFields(body?.fields);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  setRecordFields(svc, JSON.stringify(v.fields), user.name);
  return NextResponse.json({ ok: true, fields: v.fields });
}

export async function DELETE(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canAdmin(identityOf(user))) return NextResponse.json({ error: '仅 PD / BD 可修改字段' }, { status: 403 });
  const svc = req.nextUrl.searchParams.get('svc') || '';
  if (!SVC[svc]) return NextResponse.json({ error: '无效的服务类型' }, { status: 400 });
  resetRecordFields(svc);
  return NextResponse.json({ ok: true });
}
