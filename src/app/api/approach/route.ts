import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { identityOf } from '@/lib/permissions';
import { redactProject } from '@/lib/permRedact';
import { PermissionError, ValidationError } from '@/server/actions';
import { convertApproach, markApproachLost, mergeApproach, previewMerge, reopenApproach, StaleError } from '@/server/approach';

/* ===== REQ-054 售前接洽 =====
   GET  ?id=售前&target=正式项目         并入前预览:每项业务怎么并、搬几行 AV 数据、有没有冲突
   POST { op: 'convert', id, quotationNo?, pm? }   ① 新建正式项目(拿下一个编号)
        { op: 'merge', id, target }                ② 并入已有项目
        { op: 'lost', id, reason? }                未成交
        { op: 'reopen', id }                       重新打开(未成交的)
   只有 Sales / PD / BD;权限、可见性、状态在 server/approach.ts 里再查一次。 */

function fail(e: unknown) {
  if (e instanceof PermissionError) return NextResponse.json({ error: e.message }, { status: 403 });
  if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof StaleError) return NextResponse.json({ error: e.message, stale: true }, { status: 409 });
  throw e;
}

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id') || '', target = req.nextUrl.searchParams.get('target') || '';
  try {
    return NextResponse.json({ plan: previewMerge(identityOf(user), id, target) });
  } catch (e) { return fail(e); }
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { op?: string; id?: string; target?: string; quotationNo?: string; pm?: string; reason?: string } | null;
  const me = identityOf(user);
  const id = String(body?.id || '');
  try {
    switch (body?.op) {
      case 'convert': return NextResponse.json({ project: redactProject(me, convertApproach(me, id, { quotationNo: body.quotationNo, pm: body.pm })) });
      case 'lost': return NextResponse.json({ project: redactProject(me, markApproachLost(me, id, body.reason)) });
      case 'reopen': return NextResponse.json({ project: redactProject(me, reopenApproach(me, id)) });
      case 'merge': {
        const r = mergeApproach(me, id, String(body.target || ''));
        return NextResponse.json({ project: redactProject(me, r.approach), target: redactProject(me, r.target), plan: r.plan });
      }
      default: return NextResponse.json({ error: '无效请求' }, { status: 400 });
    }
  } catch (e) { return fail(e); }
}
