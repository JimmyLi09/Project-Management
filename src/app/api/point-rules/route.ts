import { NextRequest, NextResponse } from 'next/server';
import { insertPointRules, listPointRules } from '@/server/db';
import { currentUser } from '@/server/session';
import { canAdmin, identityOf } from '@/lib/permissions';
import { DEFAULT_POINT_RULES, validateRules, type PointRuleVersion } from '@/lib/points';

/* REQ-038: 积分规则。
   GET  — 所有登录用户(每个人的项目页都要显示按规则算出来的分)。
   POST — 仅 PD / BD:规则是全公司口径,改一次影响所有项目的积分。
          写的是**新版本**,老版本一律不动 —— 历史项目按它创建时生效的
          那一版计分,所以旧版本必须留着。 */
function rows(): PointRuleVersion[] {
  return listPointRules().map((r) => {
    let rules = DEFAULT_POINT_RULES;
    try { const v = validateRules(JSON.parse(r.rules)); if (v.ok) rules = v.rules; } catch { /* 坏行回落到出厂默认 */ }
    return {
      version: r.version, rules, effectiveFrom: r.effective_from, note: r.note,
      createdAt: r.created_at, createdBy: r.created_by,
    };
  });
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  return NextResponse.json({ versions: rows(), builtin: DEFAULT_POINT_RULES });
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canAdmin(identityOf(user))) return NextResponse.json({ error: '仅 PD / BD 可修改积分规则' }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { rules?: unknown; effectiveFrom?: string; note?: string } | null;
  const v = validateRules(body?.rules);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const eff = String(body?.effectiveFrom || '').slice(0, 10);
  if (eff && !/^\d{4}-\d{2}-\d{2}$/.test(eff)) return NextResponse.json({ error: '生效日格式应为 YYYY-MM-DD' }, { status: 400 });

  const version = insertPointRules(JSON.stringify(v.rules), eff, String(body?.note || '').slice(0, 200), user.name);
  return NextResponse.json({ ok: true, version, versions: rows() });
}
