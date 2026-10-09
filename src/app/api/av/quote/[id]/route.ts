import { NextRequest, NextResponse } from 'next/server';
import { quoteNo, quoteTotals } from '@/av/core/quote';
import { canApproveQuote, identityOf } from '@/lib/permissions';
import { decideQuote, getQuote } from '@/server/avdb';
import { appendAudit, getProject } from '@/server/db';
import { denyUnlessVisible, denyAvModule } from '@/server/avguard';
import { currentUser } from '@/server/session';
import { logZh } from '@/lib/logmsg';

type Params = { params: Promise<{ id: string }> };

/* POST /api/av/quote/:id { action: 'approve' | 'reject', note }
   PD / BD decide a quotation that is still waiting; sending it back needs a note. */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  { const deny = denyAvModule(user); if (deny) return deny; }
  if (!canApproveQuote(identityOf(user))) return NextResponse.json({ error: '仅 PD / BD 可审批报价' }, { status: 403 });
  const quote = getQuote(Number((await params).id));
  if (!quote) return NextResponse.json({ error: '报价不存在' }, { status: 404 });
  /* 审批只有 PD/BD 做得了,他们本来就看全部 —— 这一句现在拦不到任何人,
     留着是因为审批权一旦放宽,这里就是漏的那一处。 */
  const denied = denyUnlessVisible(user, getProject(quote.projectId));
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { action?: string; note?: unknown };
  const note = String(body.note ?? '').trim();
  if (body.action !== 'approve' && body.action !== 'reject') return NextResponse.json({ error: '无效操作' }, { status: 400 });
  if (body.action === 'reject' && !note) return NextResponse.json({ error: '退回须填写意见' }, { status: 400 });
  const status = body.action === 'approve' ? 'approved' : 'rejected';
  if (!decideQuote(quote.id, status, user.name, note)) return NextResponse.json({ error: '该报价已不在待审批状态' }, { status: 409 });
  const t = quoteTotals(quote.sections, quote.discountPct, quote.gstRate, quote.dedup);
  const dk = status === 'approved' ? 'av.quoteApprove' : 'av.quoteReject';
  const dP = { no: quoteNo(quote.id), total: t.total.toLocaleString('en-US'), note: note ? `：${note}` : '' };
  appendAudit(quote.projectId, [{
    at: Date.now(), by: user.name,
    text: logZh(dk, dP), k: dk, p: dP,
  }]);
  return NextResponse.json({ quote: getQuote(quote.id) });
}
