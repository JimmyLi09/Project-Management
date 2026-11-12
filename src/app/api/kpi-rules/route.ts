import { NextRequest, NextResponse } from 'next/server';
import { insertKpiRules } from '@/server/db';
import { kpiRuleVersions, setSince063, since063 } from '@/server/kpiRules';
import { currentUser } from '@/server/session';
import { canAdmin, identityOf } from '@/lib/permissions';
import { DEFAULT_KPI_RULES, validateKpiRules } from '@/lib/kpi';

/* REQ-037: KPI 规则。
   GET  — 所有登录用户(每个人的 KPI 看板都要按规则算分)。REQ-063 起顺带回修改记录的上线日。
   POST — 仅 PD / BD:权重和阈值是全公司口径。写新版本,老版本留着。
          REQ-063:只带 since063(不带 rules)= 改修改记录的上线日(不是规则版本,不留历史)。 */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  return NextResponse.json({ versions: kpiRuleVersions(), builtin: DEFAULT_KPI_RULES, since063: since063() });
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canAdmin(identityOf(user))) return NextResponse.json({ error: '仅 PD / BD 可修改 KPI 规则' }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { rules?: unknown; effectiveFrom?: string; note?: string; since063?: string } | null;
  if (body && body.since063 !== undefined && body.rules === undefined) {
    const day = String(body.since063 || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return NextResponse.json({ error: '上线日格式应为 YYYY-MM-DD' }, { status: 400 });
    setSince063(day);
    return NextResponse.json({ ok: true, since063: day });
  }
  const v = validateKpiRules(body?.rules);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const eff = String(body?.effectiveFrom || '').slice(0, 10);
  if (eff && !/^\d{4}-\d{2}-\d{2}$/.test(eff)) return NextResponse.json({ error: '生效日格式应为 YYYY-MM-DD' }, { status: 400 });

  const version = insertKpiRules(JSON.stringify(v.rules), eff, String(body?.note || '').slice(0, 200), user.name);
  return NextResponse.json({ ok: true, version, versions: kpiRuleVersions() });
}
