import { NextRequest, NextResponse } from 'next/server';
import { isAvailable, LINES } from '@/av/core/lines';
import type { BusinessLine } from '@/av/core/types';
import { canCreate, canMeta, identityOf } from '@/lib/permissions';
import { newProject } from '@/lib/project';
import { ensureInquiry, getInquiry, latestPackOf, openInquiry, setInquiryAnswers, updateInquiry, type InquiryAnswers } from '@/server/avdb';
import { PRJ_ANSWER_KEYS, PRJ_ANSWER_ZH, prjAnswersOf } from '@/av/core/prj/inquiry';
import { appendAudit, appendAuditMerged, getEffectiveTemplate, getProject, insertProject, saveProject } from '@/server/db';
import { currentUser } from '@/server/session';
import { applyAction, PermissionError, ValidationError } from '@/server/actions';
import { logZh } from '@/lib/logmsg';
import { redactProject } from '@/lib/permRedact';
import { denyUnlessVisible, denyAvModule } from '@/server/avguard';

/* 01 立项询价.
   POST { name, client, location, delivery, notes, lines[] } opens a project with
   one service package per chosen line and binds each line to its current rule
   pack, so later edits to the pack never change this project (§5, A8).
   GET ?project=ID returns the inquiry, or null for a project opened elsewhere. */

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  { const deny = denyAvModule(user); if (deny) return deny; }
  const projectId = req.nextUrl.searchParams.get('project') ?? '';
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
  const denied = denyUnlessVisible(user, project);   // REQ-043
  if (denied) return denied;
  /* AV-018:项目页新建 / 复制的 AV 项目没有立项记录 —— 打开 01 时补建,地点和补充说明才能填 */
  return NextResponse.json({ inquiry: ensureInquiry(project, user.name) });
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  { const deny = denyAvModule(user); if (deny) return deny; }
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

  /* AV-020:投影 prj@1.0 发布以后新项目绑 1.0(发布记在数据库里) */
  const packs = Object.fromEntries(chosen.map((l) => [l.line, latestPackOf(l)])) as Partial<Record<BusinessLine, string>>;
  const inquiry = openInquiry({
    projectId: p.id,
    location: String(body.location || '').trim(),
    notes: String(body.notes || '').trim(),
    lines: chosen.map((l) => l.line),
    packs,
    answers: answersOf(body, {}),
    createdBy: user.name,
  }, () => insertProject(p));

  const avLines = chosen.map((l) => `${l.label}（${packs[l.line]}）`).join('、');
  appendAudit(p.id, [{
    at: Date.now(), by: user.name,
    text: logZh('av.inquiry', { lines: avLines }), k: 'av.inquiry', p: { lines: avLines },
  }]);
  return NextResponse.json({ project: redactProject(identityOf(user), p), inquiry });
}

/* AV-016 · 01 编辑已有项目,自动保存。PATCH { projectId, name, client, location, delivery, notes }
   —— 只写改了的字段;业务线 / 规则包立项时定下,这里不改。
   能改项目信息的人(项目负责人、销售、PD / BD)才能改。日志:同一人 10 分钟内的连续改动合并成一条。 */
const FIELD_ZH: Record<string, string> = { name: '项目名称', client: '客户', location: '地点', delivery: '交付日期', notes: '补充说明', play_use: '播放内容', pc_by: '电脑由谁提供', ...PRJ_ANSWER_ZH };
const ANSWER_KEYS = ['play_use', 'pc_by', ...PRJ_ANSWER_KEYS] as const;

/* AV-019 §2.6:01「这块屏主要播放什么」「电脑由谁提供」—— 只收认得的值;
   不是会议 / 两者都有时,「电脑由谁提供」不用答,清掉 */
const USES = ['meeting', 'ads', 'both', 'live', 'unsure'];
function answersOf(body: Record<string, unknown>, cur: InquiryAnswers): InquiryAnswers {
  const next: InquiryAnswers = { ...cur };
  if ('play_use' in body) next.play_use = USES.includes(String(body.play_use)) ? body.play_use as InquiryAnswers['play_use'] : null;
  if ('pc_by' in body) next.pc_by = body.pc_by === 'client' || body.pc_by === 'us' ? body.pc_by : null;
  if (next.play_use !== 'meeting' && next.play_use !== 'both') next.pc_by = null;
  /* AV-020 §3.1:投影线的场景、互动、环境光、天花高度、最近观众离墙 */
  return prjAnswersOf(body, next);
}
export async function PATCH(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  { const deny = denyAvModule(user); if (deny) return deny; }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const project = getProject(String(body.projectId || ''));
  if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
  const denied = denyUnlessVisible(user, project);
  if (denied) return denied;
  if (!canMeta(identityOf(user), project)) return NextResponse.json({ error: '你不能修改这个项目的立项信息' }, { status: 403 });
  if (project.archived) return NextResponse.json({ error: '项目已归档，不能修改' }, { status: 400 });
  const str = (k: string, max = 2000) => (typeof body[k] === 'string' ? (body[k] as string).trim().slice(0, max) : undefined);
  const delivery = str('delivery', 10);
  if (delivery && !/^\d{4}-\d{2}-\d{2}$/.test(delivery)) return NextResponse.json({ error: '期望交付日期格式应为 YYYY-MM-DD' }, { status: 400 });
  /* AV-018:没有立项记录就先补建 —— 原来在这里静默丢掉地点和补充说明 */
  const inquiry = ensureInquiry(project, user.name);
  if (!inquiry && (str('location') || str('notes'))) {
    return NextResponse.json({ error: '这个项目没有 AV 业务线，存不了地点和补充说明' }, { status: 400 });
  }

  /* 项目名、客户、交付日期走项目页同一套动作(复查 #68):同样的权限(改交付日期要能编辑这个项目)、
     同样的长度校验、同样写进项目日志。只改传上来、且和现在不一样的那几项 —— 页面只发人改过的字段,
     别人在别处刚改的不会被这边旧的值盖回去。 */
  const me = identityOf(user);
  const changed: string[] = [];
  const name = str('name', 200), client = str('client', 200);
  try {
    if (name !== undefined && name !== project.name) { applyAction(me, project, { type: 'renameProject', name }); changed.push('name'); }
    if (client !== undefined && client !== (project.client || '')) { applyAction(me, project, { type: 'setClient', value: client }); changed.push('client'); }
    if (delivery !== undefined && delivery !== (project.delivery || '')) { applyAction(me, project, { type: 'setDelivery', value: delivery }); changed.push('delivery'); }
  } catch (e) {
    if (e instanceof PermissionError) return NextResponse.json({ error: e.message }, { status: 403 });
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  if (changed.length) saveProject(project);   // 读和写之间没有 await:不会盖掉别的请求
  if (inquiry) {
    const location = str('location') ?? inquiry.location;
    const notes = str('notes') ?? inquiry.notes;
    if (location !== inquiry.location) changed.push('location');
    if (notes !== inquiry.notes) changed.push('notes');
    if (location !== inquiry.location || notes !== inquiry.notes) updateInquiry(project.id, { location, notes });
    if (ANSWER_KEYS.some((k) => k in body)) {
      const answers = answersOf(body, inquiry.answers);
      const diff = ANSWER_KEYS.filter((k) => (answers[k] ?? null) !== (inquiry.answers[k] ?? null));
      changed.push(...diff);
      if (diff.length) setInquiryAnswers(project.id, answers);
    }
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
  return NextResponse.json({ ok: true, changed, savedAt: Date.now(), project: (() => { const q = getProject(project.id); return q && redactProject(identityOf(user), q); })(), inquiry: getInquiry(project.id) });
}
