import { NextRequest, NextResponse } from 'next/server';
import { isAvailable, LINES } from '@/av/core/lines';
import type { BusinessLine } from '@/av/core/types';
import { canCreate, canMeta, identityOf } from '@/lib/permissions';
import { newProject } from '@/lib/project';
import { getInquiry, openInquiry, updateInquiry } from '@/server/avdb';
import { appendAudit, appendAuditMerged, getEffectiveTemplate, getProject, insertProject, saveProject } from '@/server/db';
import { currentUser } from '@/server/session';
import { logZh } from '@/lib/logmsg';
import { denyUnlessVisible } from '@/server/avguard';

/* 01 立项询价.
   POST { name, client, location, delivery, notes, lines[] } opens a project with
   one service package per chosen line and binds each line to its current rule
   pack, so later edits to the pack never change this project (§5, A8).
   GET ?project=ID returns the inquiry, or null for a project opened elsewhere. */

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const projectId = req.nextUrl.searchParams.get('project') ?? '';
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
  const denied = denyUnlessVisible(user, project);   // REQ-043
  if (denied) return denied;
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
  p.log.unshift({ at: Date.now(), by: user.name, text: logZh('proj.createAv'), k: 'proj.createAv' });

  const packs = Object.fromEntries(chosen.map((l) => [l.line, l.pack!])) as Partial<Record<BusinessLine, string>>;
  const inquiry = openInquiry({
    projectId: p.id,
    location: String(body.location || '').trim(),
    notes: String(body.notes || '').trim(),
    lines: chosen.map((l) => l.line),
    packs,
    createdBy: user.name,
  }, () => insertProject(p));

  const avLines = chosen.map((l) => `${l.label}（${l.pack}）`).join('、');
  appendAudit(p.id, [{
    at: Date.now(), by: user.name,
    text: logZh('av.inquiry', { lines: avLines }), k: 'av.inquiry', p: { lines: avLines },
  }]);
  return NextResponse.json({ project: p, inquiry });
}

/* AV-016 · 01 编辑已有项目,自动保存。PATCH { projectId, name, client, location, delivery, notes }
   —— 只写改了的字段;业务线 / 规则包立项时定下,这里不改。
   能改项目信息的人(项目负责人、销售、PD / BD)才能改。日志:同一人 10 分钟内的连续改动合并成一条。 */
const FIELD_ZH: Record<string, string> = { name: '项目名称', client: '客户', location: '地点', delivery: '交付日期', notes: '补充说明' };
export async function PATCH(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const project = getProject(String(body.projectId || ''));
  if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
  const denied = denyUnlessVisible(user, project);
  if (denied) return denied;
  if (!canMeta(identityOf(user), project)) return NextResponse.json({ error: '你不能修改这个项目的立项信息' }, { status: 403 });
  const str = (k: string, max = 2000) => (typeof body[k] === 'string' ? (body[k] as string).trim().slice(0, max) : undefined);
  const name = str('name', 200);
  if (name !== undefined && !name) return NextResponse.json({ error: '项目名称不能为空' }, { status: 400 });
  const delivery = str('delivery', 10);
  if (delivery && !/^\d{4}-\d{2}-\d{2}$/.test(delivery)) return NextResponse.json({ error: '期望交付日期格式应为 YYYY-MM-DD' }, { status: 400 });
  const inquiry = getInquiry(project.id);

  const changed: string[] = [];
  const pf: [string, string | undefined, string][] = [['name', name, project.name], ['client', str('client', 200), project.client || ''], ['delivery', delivery, project.delivery || '']];
  for (const [k, v, cur] of pf) if (v !== undefined && v !== cur) { (project as unknown as Record<string, string>)[k] = v; changed.push(k); }
  if (changed.length) saveProject(project);
  if (inquiry) {
    const location = str('location') ?? inquiry.location;
    const notes = str('notes') ?? inquiry.notes;
    if (location !== inquiry.location) changed.push('location');
    if (notes !== inquiry.notes) changed.push('notes');
    if (location !== inquiry.location || notes !== inquiry.notes) updateInquiry(project.id, { location, notes });
  }
  if (changed.length) {
    const at = Date.now();
    const fieldsOf = (ks: string[]) => ks.map((k) => FIELD_ZH[k]).join('、');
    const p = { fields: fieldsOf(changed) };
    appendAuditMerged(project.id, { at, by: user.name, text: logZh('av.inquiryEdit', p), k: 'av.inquiryEdit', p }, (prev) => {
      const had = String(prev?.fields ?? '').split('、').filter(Boolean);
      const all = Object.keys(FIELD_ZH).filter((k) => had.includes(FIELD_ZH[k]) || changed.includes(k));
      const q = { fields: fieldsOf(all) };
      return { text: logZh('av.inquiryEdit', q), p: q };
    });
  }
  return NextResponse.json({ ok: true, changed, savedAt: Date.now(), project: getProject(project.id), inquiry: getInquiry(project.id) });
}
