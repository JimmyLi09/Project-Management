import { NextRequest, NextResponse } from 'next/server';
import { deleteUserWithHandover, getUserById, listProjects, listUsers } from '@/server/db';
import { currentUser } from '@/server/session';
import { canAdmin, identityOf } from '@/lib/permissions';
import { workOf } from '@/lib/peopleRefs';

type Params = { params: Promise<{ id: string }> };

const DENY = { error: '仅 PD/BD 可管理用户 / PD / BD only' };
const isAdminRole = (r: string) => r === 'director' || r === 'bd';

/* REQ-051 删除弹窗用:他名下还有什么(负责的项目、未完成待办、指派的清单项) */
export async function GET(_req: NextRequest, { params }: Params) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canAdmin(identityOf(user))) return NextResponse.json(DENY, { status: 403 });
  const target = getUserById(Number((await params).id));
  if (!target) return NextResponse.json({ error: '用户不存在' }, { status: 404 });
  return NextResponse.json({ work: workOf(listProjects(), target.name) });
}

/* REQ-051 删除用户:先转交再删。body = { toProjects, toTasks, toChecklist }(接手人姓名)。
   · 只有 PD / BD 能删;PD / BD 账号本身不能删(所以永远至少留着 1 个 PD);不能删自己
   · 名下有哪一类工作,那一类就必须选一个接手人,接手人必须是还能用的账号
   · 转交 + 标记删除在一个事务里;已登录的会话下一次请求就失效(session.ts 认 deleted_at) */
export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canAdmin(identityOf(user))) return NextResponse.json(DENY, { status: 403 });
  const id = Number((await params).id);
  const target = getUserById(id);
  if (!target) return NextResponse.json({ error: '用户不存在' }, { status: 404 });
  if (target.deletedAt) return NextResponse.json({ error: '账号已删除 / Already deleted' }, { status: 400 });
  if (id === user.id) return NextResponse.json({ error: '不能删除你自己的账号 / You can’t delete your own account' }, { status: 400 });
  if (isAdminRole(target.role)) return NextResponse.json({ error: 'PD / BD 账号不能删除 / PD and BD accounts can’t be deleted' }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { toProjects?: string; toTasks?: string; toChecklist?: string; confirm?: boolean };
  if (body.confirm !== true) return NextResponse.json({ error: '请勾选「我确认删除」/ Tick "I confirm" first' }, { status: 400 });
  const work = workOf(listProjects(), target.name);
  const active = new Set(listUsers().filter((u) => !u.disabled && !u.deletedAt && u.id !== id).map((u) => u.name));
  const pick = (v: unknown, need: boolean, zh: string, en: string): string | NextResponse => {
    const name = String(v || '').trim();
    if (!name) return need ? NextResponse.json({ error: `请选择${zh}的接手人 / Choose who takes over the ${en}` }, { status: 400 }) : '';
    if (!active.has(name)) return NextResponse.json({ error: `${zh}的接手人不是可用的账号 / The ${en} receiver isn’t an active account` }, { status: 400 });
    return name;
  };
  const toP = pick(body.toProjects, work.projects.length > 0, '项目', 'projects');
  if (toP instanceof NextResponse) return toP;
  const toT = pick(body.toTasks, work.todos > 0, '待办', 'tasks');
  if (toT instanceof NextResponse) return toT;
  const toC = pick(body.toChecklist, work.checklist > 0, '信息清单', 'checklist items');
  if (toC instanceof NextResponse) return toC;

  const done = deleteUserWithHandover(id, { projects: toP, tasks: toT, checklist: toC }, user.name);
  if (!done) return NextResponse.json({ error: '用户不存在' }, { status: 404 });
  return NextResponse.json({ ok: true, ...done });
}
