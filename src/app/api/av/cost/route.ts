import { NextRequest, NextResponse } from 'next/server';
import { buildLedLines, checkSheet, totals, type ManualLine, type Picks } from '@/av/core/pricing';
import { canCostProject, canViewPrices, identityOf } from '@/lib/permissions';
import {
  getInquiry, getMarginFloor, latestConfig, latestCostSheet, listPriceItems, saveCostSheet,
} from '@/server/avdb';
import { ledProjectError } from '@/server/avdrawing';
import { appendAudit, getProject } from '@/server/db';
import { currentUser } from '@/server/session';

/* 06 成本核算 · LED single line.
   GET ?project=ID   the latest saved configuration, the latest cost sheet with
                     its checks against today's price library, and the library.
   POST { projectId, picks, manual, confirm }
                     price the latest configuration and save a sheet. The unit
                     prices are snapshotted into the sheet; confirming requires
                     no blocking check. */

const today = () => new Date().toISOString().slice(0, 10);

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canViewPrices(identityOf(user))) return NextResponse.json({ error: '无权查看成本' }, { status: 403 });
  const projectId = req.nextUrl.searchParams.get('project') ?? '';
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });

  const config = latestConfig(projectId, 'led');
  const sheet = latestCostSheet(projectId, 'led');
  const items = listPriceItems('led');
  const marginFloor = getMarginFloor();
  const sheetConfig = sheet && config && sheet.configId === config.id ? config : null;
  return NextResponse.json({
    inquiry: getInquiry(projectId),
    config, sheet, items, marginFloor,
    /* the sheet was priced against an older configuration */
    sheetOutdated: !!(sheet && config && sheet.configId !== config.id),
    checks: sheet && sheetConfig ? checkSheet(sheet.lines, sheetConfig, items, marginFloor, today()) : [],
    canEdit: canCostProject(identityOf(user), project),
  });
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { projectId?: string; picks?: Picks; manual?: ManualLine[]; confirm?: boolean };
  const project = getProject(String(body.projectId || ''));
  const bad = ledProjectError(project);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  if (!canCostProject(identityOf(user), project)) return NextResponse.json({ error: '仅该项目的 PM 可核算成本' }, { status: 403 });

  const config = latestConfig(project!.id, 'led');
  if (!config) return NextResponse.json({ error: '该项目还没有保存的 05 方案' }, { status: 400 });

  const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
  const picks: Picks = {
    display: num(body.picks?.display), power_cable: num(body.picks?.power_cable), data_cable: num(body.picks?.data_cable),
  };
  const manual: ManualLine[] = [];
  for (const [i, m] of (Array.isArray(body.manual) ? body.manual : []).entries()) {
    const name = String(m?.name || '').trim();
    const qty = Number(m?.qty);
    const unit = String(m?.unit || '').trim();
    if (!name || !(qty > 0) || !unit) return NextResponse.json({ error: `第 ${i + 1} 条附加项需填写名称、数量（> 0）与单位` }, { status: 400 });
    manual.push({ key: `m${i + 1}`, name, qty, unit, itemId: num(m.itemId) });
  }

  const items = listPriceItems('led');
  const lines = buildLedLines(config, picks, manual, items);
  const t = totals(lines);
  const marginFloor = getMarginFloor();
  const checks = checkSheet(lines, config, items, marginFloor, today());
  const blocks = checks.filter((c) => c.severity === 'block');
  if (body.confirm && blocks.length) {
    return NextResponse.json({ error: `不能确认：${blocks.map((c) => c.message).join(' ')}`, checks }, { status: 400 });
  }
  const sheet = saveCostSheet({ projectId: project!.id, line: 'led', configId: config.id, lines, cost: t.cost, list: t.list }, user.name, !!body.confirm);
  if (body.confirm) {
    appendAudit(project!.id, [{
      at: Date.now(), by: user.name,
      text: `LED 单线成本确认：成本 S$${t.cost.toLocaleString('en-US')}，售价 S$${t.list.toLocaleString('en-US')}，毛利 ${t.margin === null ? '—' : (t.margin * 100).toFixed(1) + '%'}`,
    }]);
  }
  return NextResponse.json({ sheet, checks, marginFloor });
}
