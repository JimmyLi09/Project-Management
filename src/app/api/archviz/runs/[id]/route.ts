export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { getArchvizDb } from '@/server/archviz/db';
import { rowToRun } from '@/server/archviz/mapRow';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;
  const db = getArchvizDb();
  const row = db.prepare('SELECT * FROM analysis_runs WHERE id = ?').get(id);
  if (!row) return NextResponse.json({ error: '分析任务不存在' }, { status: 404 });
  return NextResponse.json({ run: rowToRun(row) });
}
