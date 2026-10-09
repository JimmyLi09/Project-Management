import { NextRequest, NextResponse } from 'next/server';
import { lineInfo, projectLines } from '@/av/core/lines';
import { GST_RATE, lineState, quoteChecks, quoteNo, quoteTotals, toSection } from '@/av/core/quote';
import type { BusinessLine } from '@/av/core/types';
import { dedupe, sharedRows } from '@/av/core/xline';
import { canApproveQuote, canSeeCost, canSubmitQuote, canViewQuotes, identityOf, priceView } from '@/lib/permissions';
import { redactQuote, redactShared } from '@/server/avredact';
import { createQuote, getInquiry, getMarginFloor, latestConfig, latestCostSheet, listQuotes } from '@/server/avdb';
import { appendAudit, getProject } from '@/server/db';
import { currentUser } from '@/server/session';
import { logZh } from '@/lib/logmsg';
import { denyUnlessVisible, denyAvModule } from '@/server/avguard';

/* 07 报价审批.
   GET ?project=ID   every line the project carries with whether it can be
        quoted (only a confirmed sheet on the latest configuration can) and its
        rows tagged as shared resources, and the project's quotations.
   POST { projectId, lines, discountPct, reason }   build a quotation from the
        latest confirmed sheets of the chosen lines, take off the cross-line
        savings among them, and submit it for approval. */

function lineRows(projectId: string, svcs: string[]) {
  return projectLines(svcs, getInquiry(projectId)?.lines).map((l) => {
    const sheet = latestCostSheet(projectId, l.line);
    const config = latestConfig(projectId, l.line);
    return { line: l.line, state: lineState(sheet, config?.id ?? null), sheet };
  });
}

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  { const deny = denyAvModule(user); if (deny) return deny; }
  const me = identityOf(user);
  /* 字段级隔离:报价就是售价,PM 不看售价 */
  if (!canViewQuotes(me)) return NextResponse.json({ error: '无权查看报价' }, { status: 403 });
  const project = getProject(req.nextUrl.searchParams.get('project') ?? '');
  if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
  const denied = denyUnlessVisible(user, project);   // REQ-043
  if (denied) return denied;
  const v = priceView(me);
  return NextResponse.json({
    lines: lineRows(project.id, project.packages.map((k) => k.svc)).map((r) => ({
      line: r.line, state: r.state, cost: v === 'full' ? r.sheet?.cost ?? null : null, list: r.sheet?.list ?? null,
      shared: r.sheet ? sharedRows(r.line, r.sheet.lines).map((s) => redactShared(s, v)) : [],
    })),
    quotes: listQuotes(project.id).map((q) => redactQuote(q, v)),
    marginFloor: v === 'full' ? getMarginFloor() : null, gstRate: GST_RATE,
    canSubmit: canSubmitQuote(me, project), canApprove: canApproveQuote(me),
    priceView: v,
  });
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  { const deny = denyAvModule(user); if (deny) return deny; }
  const body = (await req.json().catch(() => ({}))) as { projectId?: string; lines?: unknown; discountPct?: unknown; reason?: unknown };
  const project = getProject(String(body.projectId || ''));
  if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
  const deniedW = denyUnlessVisible(user, project);   // REQ-043
  if (deniedW) return deniedW;
  if (!canSubmitQuote(identityOf(user), project)) return NextResponse.json({ error: '仅销售或 PD / BD 可提交报价' }, { status: 403 });
  const seesCost = canSeeCost(identityOf(user));

  const asked = new Set(Array.isArray(body.lines) ? body.lines.map(String) : []);
  const rows = lineRows(project.id, project.packages.map((k) => k.svc)).filter((r) => asked.has(r.line));
  const notReady = rows.filter((r) => r.state !== 'confirmed');
  if (notReady.length) {
    return NextResponse.json({ error: `${notReady.map((r) => lineInfo(r.line).label).join('、')}没有已确认的最新成本，不能进入报价。` }, { status: 400 });
  }
  const sections = rows.map((r) => toSection(r.line as BusinessLine, r.sheet!));
  const dedup = dedupe(rows.flatMap((r) => sharedRows(r.line, r.sheet!.lines)));
  const discountPct = Number(body.discountPct ?? 0);
  const reason = String(body.reason ?? '').trim();
  const marginFloor = getMarginFloor();
  const totals = quoteTotals(sections, discountPct, GST_RATE, dedup);
  /* 09-30 决定:Sales 看不到毛利,低于下限也不提示、不要求填理由 —— 照常提交,
     由 PD / BD 审批时看(审批人那边照样标红)。所以对看不到成本的人,毛利那条
     不算阻断。 */
  const blocks = quoteChecks(sections, discountPct, totals, marginFloor, reason, dedup)
    .filter((c) => c.severity === 'block' && (seesCost || c.code !== 'QUOTE-MARGIN'));
  if (blocks.length) return NextResponse.json({ error: blocks.map((c) => c.message).join(' ') }, { status: 400 });

  const quote = createQuote({ projectId: project.id, sections, dedup, discountPct, gstRate: GST_RATE, marginFloor, reason }, user.name);
  const qP = {
    no: quoteNo(quote.id),
    lines: sections.map((s) => lineInfo(s.line).label).join(' + '),
    total: totals.total.toLocaleString('en-US'),
    shared: totals.shared ? totals.shared.toLocaleString('en-US') : '',
    margin: totals.margin === null ? '—' : (totals.margin * 100).toFixed(1) + '%',
  };
  /* 有没有共用资源去重是两句不同的话,不是往参数里塞一段中文 —— 塞进去
     等于这一段永远不会被翻。 */
  const qk = totals.shared ? 'av.quoteSubmitShared' : 'av.quoteSubmit';
  appendAudit(project.id, [{ at: Date.now(), by: user.name, text: logZh(qk, qP), k: qk, p: qP }]);
  return NextResponse.json({ quote: redactQuote(quote, priceView(identityOf(user))) });
}
