import { NextRequest, NextResponse } from 'next/server';
import { getDrawing } from '@/server/avdb';
import { currentUser } from '@/server/session';

type Params = { params: Promise<{ id: string }> };

/* GET /api/av/drawings/:id — one drawing with its six extractions, to resume a
   review or to load a reviewed drawing into 05. */
export async function GET(_req: NextRequest, { params }: Params) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const drawing = getDrawing(Number((await params).id));
  if (!drawing) return NextResponse.json({ error: '图纸不存在' }, { status: 404 });
  return NextResponse.json(drawing);
}
