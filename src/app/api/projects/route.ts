import { NextRequest, NextResponse } from 'next/server';
import { appendAudit, getEffectiveTemplate, insertProject, listProjects, nextProjectSerial } from '@/server/db';
import { currentUser } from '@/server/session';
import { canCreate, identityOf, visibleProjects } from '@/lib/permissions';
import { newProject } from '@/lib/project';
import { SVC } from '@/lib/templates';
import { logZh } from '@/lib/logmsg';
import { redactProject, redactProjects } from '@/lib/permRedact';
import { checkOwner, withCapGaps } from '@/server/assignGate';

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  /* REQ-043: PM / Engineer 只拿得到自己的项目。全站的列表、待办、统计、向上
     汇报、项目档案和搜索都是从这一份数组派生的,所以过滤放在这里 —— 别人的
     项目根本不会进到浏览器里,而不是发下去再靠前端藏。 */
  /* REQ-051: 权限表里「不可见」的模块,内容也不下发 */
  /* REQ-062:上线后有过新指派的项目,现算「哪些业务还没有到可协助的负责 PM」 */
  return NextResponse.json({ projects: redactProjects(identityOf(user), withCapGaps(visibleProjects(identityOf(user), listProjects()))) });
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
    quotationNo: String(body.quotationNo || '').slice(0, 60),   // REQ-031
    services: services.length ? services : ['others'],
    owners: Array.isArray(body.owners) ? body.owners.map(String).filter(Boolean) : [],
    engineer: String(body.engineer || '').slice(0, 120),   // REQ-043
    includeInterior: body.includeInterior === true,   // REQ-058

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
  /* REQ-062 派项目限制:选的负责 PM 要在项目的业务上到「可协助」(开关关着只提醒) */
  const warns: string[] = [];
  for (const o of p.owners || []) {
    const r = checkOwner(p, o);
    if (r.block) return NextResponse.json({ error: r.block }, { status: 400 });
    warns.push(...r.warns);
  }
  if ((p.owners || []).length) p.capCheckAt = Date.now();
  p.serial = nextProjectSerial(); // REQ-006: auto project NO.
  const no = String(p.serial).padStart(3, '0');
  p.log.unshift({ at: Date.now(), by: user.name, text: logZh('proj.create', { no }), k: 'proj.create', p: { no } });
  insertProject(p);
  appendAudit(p.id, [{ at: Date.now(), by: user.name, text: logZh('proj.create', { no }), k: 'proj.create', p: { no } }]);
  return NextResponse.json({ project: redactProject(identityOf(user), withCapGaps([p])[0]), warns });
}
