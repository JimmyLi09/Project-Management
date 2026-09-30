import { NextRequest, NextResponse } from 'next/server';
import { readPage } from '@/server/avjudge';
import { judgeAccess } from '../guard';

type Params = { params: Promise<{ id: string }> };

/* GET ?page=1 — the stored picture (as shown to the model). */
export async function GET(req: NextRequest, { params }: Params) {
  const a = await judgeAccess((await params).id, false);
  if ('error' in a) return a.error;
  const page = Number(req.nextUrl.searchParams.get('page') ?? '1');
  const img = await readPage(a.id, Number.isInteger(page) ? page : 1);
  if (!img) return NextResponse.json({ error: '图片不存在' }, { status: 404 });
  return new NextResponse(new Uint8Array(img.data), { headers: { 'Content-Type': img.mime, 'Cache-Control': 'private, max-age=3600' } });
}
