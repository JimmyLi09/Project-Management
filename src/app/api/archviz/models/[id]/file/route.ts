export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getArchvizDb } from '@/server/archviz/db';
import { isAuthorizedWorker } from '@/server/archviz/workerAuth';

type Params = { params: Promise<{ id: string }> };

/* Worker-facing only — a real DCC render node (Phase 2) downloads the
   original .skp/.max here before opening it. The Phase-1 stub worker never
   calls this; it renders from seed+floors alone. */
export async function GET(req: NextRequest, { params }: Params) {
  if (!isAuthorizedWorker(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const db = getArchvizDb();
  const row = db.prepare('SELECT file_blob, original_filename FROM models WHERE id = ?').get(id) as
    { file_blob: Buffer; original_filename: string } | undefined;
  if (!row) return NextResponse.json({ error: 'model not found' }, { status: 404 });
  return new NextResponse(new Uint8Array(row.file_blob), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${row.original_filename.replace(/"/g, '')}"`,
    },
  });
}
