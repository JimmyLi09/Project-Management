import { NextRequest, NextResponse } from 'next/server';
import { canEditPrices, canViewPrices, identityOf } from '@/lib/permissions';
import { listPriceItems, priceHistory, updatePriceItem } from '@/server/avdb';
import { currentUser } from '@/server/session';
import { normalise, validate } from '@/server/avprice';

type Params = { params: Promise<{ id: string }> };

/* GET: the item's price history. PATCH { item }: edit (PD / BD). */
export async function GET(_req: NextRequest, { params }: Params) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canViewPrices(identityOf(user))) return NextResponse.json({ error: '无权查看价格库' }, { status: 403 });
  return NextResponse.json({ history: priceHistory(Number((await params).id)) });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canEditPrices(identityOf(user))) return NextResponse.json({ error: '仅 PD / BD 可维护价格库' }, { status: 403 });
  const id = Number((await params).id);
  const current = listPriceItems().find((i) => i.id === id);
  if (!current) return NextResponse.json({ error: '价格条目不存在' }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { item?: Record<string, unknown> };
  const merged = { ...current, ...(body.item || {}) };
  const bad = validate(merged);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  try {
    return NextResponse.json({ item: updatePriceItem(id, normalise(merged), user.name) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '保存失败' }, { status: 400 });
  }
}
