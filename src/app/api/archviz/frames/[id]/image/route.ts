export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { getArchvizDb } from '@/server/archviz/db';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;
  const db = getArchvizDb();
  const row = db.prepare('SELECT image_blob FROM frames WHERE id = ?').get(id) as { image_blob: Buffer } | undefined;
  if (!row) return NextResponse.json({ error: '图片不存在' }, { status: 404 });
  return new NextResponse(new Uint8Array(row.image_blob), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=31536000, immutable' },
  });
}
