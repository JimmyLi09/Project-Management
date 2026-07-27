export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { getArchvizDb } from '@/server/archviz/db';
import { rowToShot } from '@/server/archviz/mapRow';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;
  const db = getArchvizDb();
  const rows = db.prepare('SELECT * FROM frame_evaluations WHERE run_id = ? ORDER BY overall_score DESC').all(id);
  return NextResponse.json({ shots: rows.map(rowToShot) });
}
