import { NextRequest, NextResponse } from 'next/server';
import { lineInfo, projectLines } from '@/av/core/lines';
import { GST_RATE, lineState, quoteChecks, quoteNo, quoteTotals, toSection } from '@/av/core/quote';
import type { BusinessLine } from '@/av/core/types';
import { canApproveQuote, canSubmitQuote, canViewPrices, identityOf } from '@/lib/permissions';
import { createQuote, getInquiry, getMarginFloor, latestConfig, latestCostSheet, listQuotes } from '@/server/avdb';
import { appendAudit, getProject } from '@/server/db';
import { currentUser } from '@/server/session';

/* 07 报价审批.
   GET ?project=ID   every line the project carries with whether it can be
        quoted (only a confirmed sheet on the latest configuration can), and
        the project's quotations.
   POST { projectId, lines, discountPct, reason }   build a quotation from the
        latest confirmed sheets of the chosen lines and submit it for approval. */

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
  const me = identityOf(user);
  if (!canViewPrices(me)) return NextResponse.json({ error: '无权查看报价' }, { status: 403 });
  const project = getProject(req.nextUrl.searchParams.get('project') ?? '');
  if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
  return NextResponse.json({
    lines: lineRows(project.id, project.packages.map((k) => k.svc)).map((r) => ({
      line: r.line, state: r.state, cost: r.sheet?.cost ?? null, list: r.sheet?.list ?? null,
    })),
    quotes: listQuotes(project.id),
    marginFloor: getMarginFloor(), gstRate: GST_RATE,
    canSubmit: canSubmitQuote(me, project), canApprove: canApproveQuote(me),
  });
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { projectId?: string; lines?: unknown; discountPct?: unknown; reason?: unknown };
  const project = getProject(String(body.projectId || ''));
  if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
  if (!canSubmitQuote(identityOf(user), project)) return NextResponse.json({ error: '仅销售、PD / BD 或该项目的 PM 可提交报价' }, { status: 403 });

  const asked = new Set(Array.isArray(body.lines) ? body.lines.map(String) : []);
  const rows = lineRows(project.id, project.packages.map((k) => k.svc)).filter((r) => asked.has(r.line));
  const notReady = rows.filter((r) => r.state !== 'confirmed');
  if (notReady.length) {
    return NextResponse.json({ error: `${notReady.map((r) => lineInfo(r.line).label).join('、')}没有已确认的最新成本，不能进入报价。` }, { status: 400 });
  }
  const sections = rows.map((r) => toSection(r.line as BusinessLine, r.sheet!));
  const discountPct = Number(body.discountPct ?? 0);
  const reason = String(body.reason ?? '').trim();
  const marginFloor = getMarginFloor();
  const totals = quoteTotals(sections, discountPct, GST_RATE);
  const blocks = quoteChecks(sections, discountPct, totals, marginFloor, reason).filter((c) => c.severity === 'block');
  if (blocks.length) return NextResponse.json({ error: blocks.map((c) => c.message).join(' ') }, { status: 400 });

  const quote = createQuote({ projectId: project.id, sections, discountPct, gstRate: GST_RATE, marginFloor, reason }, user.name);
  appendAudit(project.id, [{
    at: Date.now(), by: user.name,
    text: `提交报价 ${quoteNo(quote.id)} 待审批：${sections.map((s) => lineInfo(s.line).label).join(' + ')} · 含税 S$${totals.total.toLocaleString('en-US')}`
      + ` · 折后毛利 ${totals.margin === null ? '—' : (totals.margin * 100).toFixed(1) + '%'}`,
  }]);
  return NextResponse.json({ quote });
}
