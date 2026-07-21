import { NextRequest, NextResponse } from 'next/server';
import { appendAudit, getEffectiveTemplate, insertProject, listProjects } from '@/server/db';
import { currentUser } from '@/server/session';
import { canCreate, identityOf } from '@/lib/permissions';
import { newProject } from '@/lib/project';
import { SVC } from '@/lib/templates';

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  return NextResponse.json({ projects: listProjects() });
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canCreate(identityOf(user))) {
    return NextResponse.json({ error: '仅销售 / PD / BD 可创建项目' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  if (!name) return NextResponse.json({ error: '项目名称不能为空' }, { status: 400 });
  const services = Array.isArray(body.services)
    ? body.services.filter((s: unknown): s is string => typeof s === 'string' && !!SVC[s])
    : [];
  const p = newProject({
    name,
    client: String(body.client || ''),
    services: services.length ? services : ['others'],
    owners: Array.isArray(body.owners) ? body.owners.map(String).filter(Boolean) : [],
    difficulty: String(body.difficulty || 'medium'),
    start: String(body.start || ''),
    delivery: String(body.delivery || ''),
    buffer: Number(body.buffer) || 0,
    mainContractor: String(body.mainContractor || ''),
    architect: String(body.architect || ''),
    landscape: String(body.landscape || ''),
    interior: String(body.interior || ''),
    creative: String(body.creative || ''),
  }, getEffectiveTemplate); // use PD/BD-edited templates when present
  p.log.unshift({ at: Date.now(), by: user.name, text: '创建项目' });
  insertProject(p);
  appendAudit(p.id, [{ at: Date.now(), by: user.name, text: '创建项目 Created' }]);
  return NextResponse.json({ project: p });
}
