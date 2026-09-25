import { NextRequest, NextResponse } from 'next/server';
import seed from '@/av/seed/led-price-2026-04.json';
import type { BusinessLine } from '@/av/core/types';
import { canEditPrices, canViewPrices, identityOf } from '@/lib/permissions';
import { createPriceItem, importPriceItems, listPriceItems, type PriceInput } from '@/server/avdb';
import { normalise, validate } from '@/server/avprice';
import { currentUser } from '@/server/session';

/* Price library.
   GET ?line=led              list items
   POST { item }              add one item (PD / BD)
   POST { import: 'led-2026-04' }  load the 2026 LED cost book (PDF) into the library */

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canViewPrices(identityOf(user))) return NextResponse.json({ error: '无权查看价格库' }, { status: 403 });
  const line = req.nextUrl.searchParams.get('line') as BusinessLine | null;
  return NextResponse.json({ items: listPriceItems(line ?? undefined) });
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canEditPrices(identityOf(user))) return NextResponse.json({ error: '仅 PD / BD 可维护价格库' }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { item?: Partial<PriceInput>; import?: string };

  if (body.import === 'led-2026-04') {
    const items: PriceInput[] = seed.items.map((r) => ({
      line: 'led', category: r.category, categoryLabel: r.category_label, model: r.model, pitch: r.pitch,
      moduleSize: r.module_size, cabinetSize: r.cabinet_size, unit: r.unit, costPrice: r.cost_price,
      listPrice: r.list_price, currency: r.currency, source: r.source, validUntil: '', active: true,
    }));
    return NextResponse.json(importPriceItems(items, user.name));
  }

  const bad = validate(body.item);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  return NextResponse.json({ item: createPriceItem(normalise(body.item!), user.name) });
}
