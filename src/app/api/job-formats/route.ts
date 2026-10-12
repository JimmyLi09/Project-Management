import { NextRequest, NextResponse } from 'next/server';
import { getJobFormats, setJobFormat } from '@/server/db';
import { currentUser } from '@/server/session';
import { canAdmin, identityOf } from '@/lib/permissions';
import { SVC } from '@/lib/templates';

/* REQ-053: 每种业务的 Job Record 格式(hw = 硬件 · 登记表,sw = 软件 · 4 栏)。
   GET — 登录的人都要(Job Record / 项目档案按它显示);只回和默认不一样的覆盖值。
   PUT { svc, format } — 只给 PD / BD(登记表管理);改了写管理日志。改格式不删任何数据。 */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  return NextResponse.json({ overrides: getJobFormats() });
}

export async function PUT(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canAdmin(identityOf(user))) return NextResponse.json({ error: '仅 PD / BD 可修改业务分类 / Only PD / BD can change this' }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { svc?: string; format?: string } | null;
  const svc = String(body?.svc || '');
  if (!SVC[svc]) return NextResponse.json({ error: '无效的服务类型' }, { status: 400 });
  if (body?.format !== 'hw' && body?.format !== 'sw') return NextResponse.json({ error: '格式只能是 hw / sw' }, { status: 400 });
  return NextResponse.json({ ok: true, overrides: setJobFormat(svc, body.format, user.name) });
}
