import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { canAdmin, identityOf } from '@/lib/permissions';
import { getEffectiveTemplate, getTemplateOverride, listTemplateOverrides, resetTemplateOverride, saveTemplateOverride } from '@/server/db';
import { getBuiltinTemplate, SVC, type Template } from '@/lib/templates';

/* List which services have a custom (edited) template, or fetch one service's
   effective + builtin template for the editor via ?svc=. PD/BD only. */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canAdmin(identityOf(user))) return NextResponse.json({ error: '仅 PD/BD 可管理模板' }, { status: 403 });

  const svc = req.nextUrl.searchParams.get('svc');
  if (svc) {
    if (!SVC[svc]) return NextResponse.json({ error: '未知服务' }, { status: 400 });
    return NextResponse.json({
      svc,
      effective: getEffectiveTemplate(svc),
      builtin: getBuiltinTemplate(svc),
      customized: !!getTemplateOverride(svc),
    });
  }
  const overrides = new Set(listTemplateOverrides().map((o) => o.svc));
  return NextResponse.json({
    services: Object.entries(SVC).map(([key, v]) => ({
      key, label: v.label, en: v.en, color: v.color, customized: overrides.has(key),
    })),
  });
}

function validTemplate(t: unknown): t is Template {
  if (!t || typeof t !== 'object') return false;
  const tt = t as Template;
  if (!Array.isArray(tt.schedule) || !Array.isArray(tt.checklist)) return false;
  if (!tt.schedule.every((r) => Array.isArray(r) && r.length === 9)) return false;
  if (!tt.checklist.every((g) => Array.isArray(g) && g.length === 4 && Array.isArray(g[3]))) return false;
  return true;
}

/* Save an edited template (affects NEW projects only). PD/BD only. */
export async function PUT(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canAdmin(identityOf(user))) return NextResponse.json({ error: '仅 PD/BD 可管理模板' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const svc = String(body.svc || '');
  if (!SVC[svc]) return NextResponse.json({ error: '未知服务' }, { status: 400 });
  if (!validTemplate(body.template)) return NextResponse.json({ error: '模板格式不正确' }, { status: 400 });
  saveTemplateOverride(svc, body.template, user.name);
  return NextResponse.json({ ok: true });
}

/* Reset a service back to the original built-in template. PD/BD only. */
export async function DELETE(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canAdmin(identityOf(user))) return NextResponse.json({ error: '仅 PD/BD 可管理模板' }, { status: 403 });
  const svc = req.nextUrl.searchParams.get('svc') || '';
  if (!SVC[svc]) return NextResponse.json({ error: '未知服务' }, { status: 400 });
  resetTemplateOverride(svc);
  return NextResponse.json({ ok: true, builtin: getBuiltinTemplate(svc) });
}
