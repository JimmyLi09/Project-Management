import { NextRequest, NextResponse } from 'next/server';
import { lineInfo, projectLines } from '@/av/core/lines';
import {
  buildElvLines, buildLedLines, buildPrjLines, buildPvLines, checkSheet, elvChecks, prjChecks, pvChecks, totals,
  type ElvPicks, type ElvSummary, type LedSummary, type ManualLine, type Picks, type PrjPicks, type PrjSummary, type PvPicks, type PvSummary, type SavedConfig,
} from '@/av/core/pricing';
import type { BusinessLine } from '@/av/core/types';
import { canCostProject, canViewPrices, identityOf } from '@/lib/permissions';
import { getInquiry, getMarginFloor, latestConfig, latestCostSheet, listPriceItems, saveCostSheet } from '@/server/avdb';
import { lineProjectError } from '@/server/avdrawing';
import { appendAudit, getProject } from '@/server/db';
import { currentUser } from '@/server/session';

/* 06 成本核算, per business line.
   GET ?project=ID&line=led|projector|elv|pv  the line's latest saved configuration,
        latest cost sheet with its checks against today's price library, the
        line's library, and a summary row for every line of the project.
   POST { projectId, line, picks, manual, confirm }
        price the latest configuration and save a sheet; unit prices are
        snapshotted, confirming requires no blocking check. */

const today = () => new Date().toISOString().slice(0, 10);
const COSTED: BusinessLine[] = ['led', 'projector', 'elv', 'pv'];
const lineOf = (v: unknown): BusinessLine => (v === 'projector' || v === 'elv' || v === 'pv' ? v : 'led');
type AnySummary = LedSummary | PrjSummary | ElvSummary | PvSummary;

function price(line: BusinessLine, config: SavedConfig<AnySummary>, picks: Record<string, unknown>, manual: ManualLine[]) {
  const items = listPriceItems(line);
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
  if (line === 'pv') {
    const cfg = config as SavedConfig<PvSummary>;
    const p = Object.fromEntries(Object.entries(picks).map(([k, v]) => [k, num(v)])) as PvPicks;
    const lines = buildPvLines(cfg, p, manual, items);
    return { items, lines, extra: pvChecks(lines, cfg, items) };
  }
  if (line === 'elv') {
    const cfg = config as SavedConfig<ElvSummary>;
    const p = Object.fromEntries(Object.entries(picks).map(([k, v]) => [k, num(v)])) as ElvPicks;
    const lines = buildElvLines(cfg, p, manual, items);
    return { items, lines, extra: elvChecks(lines, cfg, items) };
  }
  if (line === 'projector') {
    const cfg = config as SavedConfig<PrjSummary>;
    const p: PrjPicks = { projector: num(picks.projector), screen: num(picks.screen), signal_cable: num(picks.signal_cable), mount: num(picks.mount), blend: num(picks.blend) };
    const lines = buildPrjLines(cfg, p, manual, items);
    return { items, lines, extra: prjChecks(lines, cfg, items) };
  }
  const p: Picks = { display: num(picks.display), power_cable: num(picks.power_cable), data_cable: num(picks.data_cable) };
  return { items, lines: buildLedLines(config as SavedConfig<LedSummary>, p, manual, items), extra: [] };
}

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canViewPrices(identityOf(user))) return NextResponse.json({ error: '无权查看成本' }, { status: 403 });
  const projectId = req.nextUrl.searchParams.get('project') ?? '';
  const line = lineOf(req.nextUrl.searchParams.get('line'));
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });

  const inquiry = getInquiry(projectId);
  const config = latestConfig<AnySummary>(projectId, line);
  const sheet = latestCostSheet(projectId, line);
  const items = listPriceItems(line);
  const marginFloor = getMarginFloor();
  const current = sheet && config && sheet.configId === config.id;
  const extra = !current ? []
    : line === 'projector' ? prjChecks(sheet.lines, config as SavedConfig<PrjSummary>, items)
    : line === 'elv' ? elvChecks(sheet.lines, config as SavedConfig<ElvSummary>, items)
    : line === 'pv' ? pvChecks(sheet.lines, config as SavedConfig<PvSummary>, items) : [];

  /* one row per business line the project carries */
  const summary = projectLines(project.packages.map((k) => k.svc), inquiry?.lines).map((l) => {
    const s = COSTED.includes(l.line) ? latestCostSheet(projectId, l.line) : null;
    const c = COSTED.includes(l.line) ? latestConfig(projectId, l.line) : null;
    return {
      line: l.line, pack: inquiry?.packs[l.line] ?? lineInfo(l.line).pack,
      sheet: s && { cost: s.cost, list: s.list, status: s.status }, outdated: !!(s && c && s.configId !== c.id),
      draftPack: !!(c && !c.summary.exportable),
    };
  });

  return NextResponse.json({
    line, inquiry, config, sheet, items, marginFloor, summary,
    sheetOutdated: !!(sheet && config && sheet.configId !== config.id),
    checks: current ? checkSheet(sheet.lines, config, items, marginFloor, today(), extra) : [],
    canEdit: canCostProject(identityOf(user), project),
  });
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { projectId?: string; line?: string; picks?: Record<string, unknown>; manual?: ManualLine[]; confirm?: boolean };
  const line = lineOf(body.line);
  const info = lineInfo(line);
  const project = getProject(String(body.projectId || ''));
  const bad = lineProjectError(project, info.svc!, info.label);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  if (!canCostProject(identityOf(user), project)) return NextResponse.json({ error: '仅该项目的 PM 可核算成本' }, { status: 403 });

  const config = latestConfig<AnySummary>(project!.id, line);
  if (!config) return NextResponse.json({ error: `该项目还没有保存的${info.label}方案` }, { status: 400 });

  const manual: ManualLine[] = [];
  for (const [i, m] of (Array.isArray(body.manual) ? body.manual : []).entries()) {
    const name = String(m?.name || '').trim();
    const qty = Number(m?.qty);
    const unit = String(m?.unit || '').trim();
    if (!name || !(qty > 0) || !unit) return NextResponse.json({ error: `第 ${i + 1} 条附加项需填写名称、数量（> 0）与单位` }, { status: 400 });
    manual.push({ key: `m${i + 1}`, name, qty, unit, itemId: m.itemId === null || m.itemId === undefined ? null : Number(m.itemId) });
  }

  const { items, lines, extra } = price(line, config, body.picks || {}, manual);
  const t = totals(lines);
  const marginFloor = getMarginFloor();
  const checks = checkSheet(lines, config, items, marginFloor, today(), extra);
  const blocks = checks.filter((c) => c.severity === 'block');
  if (body.confirm && blocks.length) {
    return NextResponse.json({ error: `不能确认：${blocks.map((c) => c.message).join(' ')}`, checks }, { status: 400 });
  }
  const sheet = saveCostSheet({ projectId: project!.id, line, configId: config.id, lines, cost: t.cost, list: t.list }, user.name, !!body.confirm);
  if (body.confirm) {
    appendAudit(project!.id, [{
      at: Date.now(), by: user.name,
      text: `${info.label}单线成本确认：成本 S$${t.cost.toLocaleString('en-US')}，售价 S$${t.list.toLocaleString('en-US')}，毛利 ${t.margin === null ? '—' : (t.margin * 100).toFixed(1) + '%'}`,
    }]);
  }
  return NextResponse.json({ sheet, checks, marginFloor });
}
