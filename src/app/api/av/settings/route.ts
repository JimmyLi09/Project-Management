import { NextRequest, NextResponse } from 'next/server';
import { canEditPrices, canViewPrices, identityOf } from '@/lib/permissions';
import { getMarginFloor, setMarginFloor } from '@/server/avdb';
import { currentUser } from '@/server/session';

/* Company parameters for costing. For now: the gross-margin floor. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canViewPrices(identityOf(user))) return NextResponse.json({ error: '无权查看' }, { status: 403 });
  return NextResponse.json({ marginFloor: getMarginFloor() });
}

export async function PUT(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canEditPrices(identityOf(user))) return NextResponse.json({ error: '仅 PD / BD 可修改公司参数' }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { marginFloor?: number };
  const v = Number(body.marginFloor);
  if (!(v >= 0 && v < 1)) return NextResponse.json({ error: '毛利下限须在 0–100% 之间' }, { status: 400 });
  setMarginFloor(v, user.name);
  return NextResponse.json({ marginFloor: v });
}
