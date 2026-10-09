import { NextRequest, NextResponse } from 'next/server';
import { canEditPrices, canSeeCost, canViewPrices, identityOf } from '@/lib/permissions';
import { getMarginFloor, setMarginFloor } from '@/server/avdb';
import { currentUser } from '@/server/session';
import { denyAvModule } from '@/server/avguard';

/* Company parameters for costing. For now: the gross-margin floor. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  { const deny = denyAvModule(user); if (deny) return deny; }
  if (!canViewPrices(identityOf(user))) return NextResponse.json({ error: '无权查看' }, { status: 403 });
  /* 公司毛利下限本身就是成本口径的数:看不到成本的人也不给 */
  return NextResponse.json({ marginFloor: canSeeCost(identityOf(user)) ? getMarginFloor() : null });
}

export async function PUT(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  { const deny = denyAvModule(user); if (deny) return deny; }
  if (!canEditPrices(identityOf(user))) return NextResponse.json({ error: '仅 PD / BD 可修改公司参数' }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { marginFloor?: number };
  const v = Number(body.marginFloor);
  if (!(v >= 0 && v < 1)) return NextResponse.json({ error: '毛利下限须在 0–100% 之间' }, { status: 400 });
  setMarginFloor(v, user.name);
  return NextResponse.json({ marginFloor: v });
}
