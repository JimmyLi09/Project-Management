import { NextRequest, NextResponse } from 'next/server';
import { listUserTemplates, saveUserTemplate } from '@/server/db';
import { currentUser } from '@/server/session';
import { canSaveTemplate, identityOf } from '@/lib/permissions';

/* REQ-012: user-saved schedule / checklist templates.
   GET  ?type=schedule|checklist — any signed-in user (PM may apply them).
   POST { type, name, payload } — PD/BD/Sales/PM (whoever builds the content). */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const type = req.nextUrl.searchParams.get('type') || undefined;
  if (type && type !== 'schedule' && type !== 'checklist') {
    return NextResponse.json({ error: '无效的模板类型' }, { status: 400 });
  }
  const rows = listUserTemplates(type).map((r) => ({ id: r.id, type: r.type, name: r.name, created_at: r.created_at, created_by: r.created_by }));
  return NextResponse.json({ templates: rows });
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canSaveTemplate(identityOf(user))) return NextResponse.json({ error: '无保存模板的权限' }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { type?: string; name?: string; payload?: unknown } | null;
  const type = String(body?.type || '');
  const name = String(body?.name || '').trim().slice(0, 120);
  if (type !== 'schedule' && type !== 'checklist') return NextResponse.json({ error: '无效的模板类型' }, { status: 400 });
  if (!name) return NextResponse.json({ error: '请填写模板名称' }, { status: 400 });
  if (!body?.payload || typeof body.payload !== 'object') return NextResponse.json({ error: '无效的模板内容' }, { status: 400 });

  const json = JSON.stringify(body.payload);
  if (json.length > 2_000_000) return NextResponse.json({ error: '模板过大' }, { status: 400 });
  const tpl = saveUserTemplate(type, name, json, user.name);
  return NextResponse.json({ template: { id: tpl.id, type: tpl.type, name: tpl.name, created_at: tpl.created_at, created_by: tpl.created_by } });
}
