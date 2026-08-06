import { NextRequest, NextResponse } from 'next/server';
import { appendAudit, getEffectiveTemplate, insertProject, listProjects, nextProjectSerial } from '@/server/db';
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
    clientPerson: String(body.clientPerson || ''),
    clientPhone: String(body.clientPhone || ''),
    clientEmail: String(body.clientEmail || ''),
    mainConPerson: String(body.mainConPerson || ''),
    mainConPhone: String(body.mainConPhone || ''),
    mainConEmail: String(body.mainConEmail || ''),
    // REQ-010: dynamic related-company blocks
    companies: Array.isArray(body.companies)
      ? body.companies.slice(0, 30).map((c: Record<string, unknown>) => ({
          role: String(c?.role || '').slice(0, 100), company: String(c?.company || '').slice(0, 200),
          person: String(c?.person || '').slice(0, 120), phone: String(c?.phone || '').slice(0, 60),
          email: String(c?.email || '').slice(0, 160),
        }))
      : [],
  }, getEffectiveTemplate); // use PD/BD-edited templates when present
  p.serial = nextProjectSerial(); // REQ-006: auto project NO.
  p.log.unshift({ at: Date.now(), by: user.name, text: `创建项目 (NO. ${String(p.serial).padStart(3, '0')})` });
  insertProject(p);
  appendAudit(p.id, [{ at: Date.now(), by: user.name, text: '创建项目 Created' }]);
  return NextResponse.json({ project: p });
}
