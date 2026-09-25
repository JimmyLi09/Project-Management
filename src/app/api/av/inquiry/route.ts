import { NextRequest, NextResponse } from 'next/server';
import { isAvailable, LINES } from '@/av/core/lines';
import type { BusinessLine } from '@/av/core/types';
import { canCreate, identityOf } from '@/lib/permissions';
import { newProject } from '@/lib/project';
import { getInquiry, openInquiry } from '@/server/avdb';
import { appendAudit, getEffectiveTemplate, getProject, insertProject } from '@/server/db';
import { currentUser } from '@/server/session';

/* 01 立项询价.
   POST { name, client, location, delivery, notes, lines[] } opens a project with
   one service package per chosen line and binds each line to its current rule
   pack, so later edits to the pack never change this project (§5, A8).
   GET ?project=ID returns the inquiry, or null for a project opened elsewhere. */

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const projectId = req.nextUrl.searchParams.get('project') ?? '';
  if (!getProject(projectId)) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
  return NextResponse.json({ inquiry: getInquiry(projectId) });
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canCreate(identityOf(user))) return NextResponse.json({ error: '仅销售 / PD / BD 可立项' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name || '').trim();
  if (!name) return NextResponse.json({ error: '项目名称不能为空' }, { status: 400 });
  const delivery = String(body.delivery || '').trim();
  if (delivery && !/^\d{4}-\d{2}-\d{2}$/.test(delivery)) {
    return NextResponse.json({ error: '期望交付日期格式应为 YYYY-MM-DD' }, { status: 400 });
  }

  const asked = Array.isArray(body.lines) ? (body.lines as unknown[]).map(String) : [];
  const chosen = LINES.filter((l) => asked.includes(l.line));
  if (!chosen.length) return NextResponse.json({ error: '请至少勾选一条业务线' }, { status: 400 });
  const unavailable = chosen.filter((l) => !isAvailable(l));
  if (unavailable.length) {
    return NextResponse.json({
      error: `${unavailable.map((l) => l.label).join('、')}的规则包尚未发布，本期只能按 LED 立项。`,
    }, { status: 400 });
  }

  const p = newProject({
    name,
    client: String(body.client || '').trim(),
    services: chosen.map((l) => l.svc!),
    start: new Date().toISOString().slice(0, 10),
    delivery,
  }, getEffectiveTemplate);
  p.log.unshift({ at: Date.now(), by: user.name, text: '立项询价创建项目' });

  const packs = Object.fromEntries(chosen.map((l) => [l.line, l.pack!])) as Partial<Record<BusinessLine, string>>;
  const inquiry = openInquiry({
    projectId: p.id,
    location: String(body.location || '').trim(),
    notes: String(body.notes || '').trim(),
    lines: chosen.map((l) => l.line),
    packs,
    createdBy: user.name,
  }, () => insertProject(p));

  appendAudit(p.id, [{
    at: Date.now(), by: user.name,
    text: `立项询价：${chosen.map((l) => `${l.label}（规则包 ${l.pack}）`).join('、')}`,
  }]);
  return NextResponse.json({ project: p, inquiry });
}
