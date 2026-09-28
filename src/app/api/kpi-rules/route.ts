import { NextRequest, NextResponse } from 'next/server';
import { insertKpiRules, listKpiRules } from '@/server/db';
import { currentUser } from '@/server/session';
import { canAdmin, identityOf } from '@/lib/permissions';
import { DEFAULT_KPI_RULES, validateKpiRules, type KpiRuleVersion } from '@/lib/kpi';

/* REQ-037: KPI 规则。
   GET  — 所有登录用户(每个人的 KPI 看板都要按规则算分)。
   POST — 仅 PD / BD:权重和阈值是全公司口径。写新版本,老版本留着。 */
function rows(): KpiRuleVersion[] {
  return listKpiRules().map((r) => {
    let rules = DEFAULT_KPI_RULES;
    try { const v = validateKpiRules(JSON.parse(r.rules)); if (v.ok) rules = v.rules; } catch { /* 坏行回落到出厂默认 */ }
    return { version: r.version, rules, effectiveFrom: r.effective_from, note: r.note, createdAt: r.created_at, createdBy: r.created_by };
  });
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  return NextResponse.json({ versions: rows(), builtin: DEFAULT_KPI_RULES });
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canAdmin(identityOf(user))) return NextResponse.json({ error: '仅 PD / BD 可修改 KPI 规则' }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { rules?: unknown; effectiveFrom?: string; note?: string } | null;
  const v = validateKpiRules(body?.rules);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const eff = String(body?.effectiveFrom || '').slice(0, 10);
  if (eff && !/^\d{4}-\d{2}-\d{2}$/.test(eff)) return NextResponse.json({ error: '生效日格式应为 YYYY-MM-DD' }, { status: 400 });

  const version = insertKpiRules(JSON.stringify(v.rules), eff, String(body?.note || '').slice(0, 200), user.name);
  return NextResponse.json({ ok: true, version, versions: rows() });
}
