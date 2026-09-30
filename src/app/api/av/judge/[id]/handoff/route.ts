import { NextRequest, NextResponse } from 'next/server';
import { getDrawing, getInquiry } from '@/server/avdb';
import { getJudgeView, handoff } from '@/server/avjudge';
import { judgeAccess } from '../guard';

type Params = { params: Promise<{ id: string }> };

/* POST — 带入 05 方案配置（草案）. The gate is re-checked here on the stored
   reading and review, so the screen cannot talk its way past it. Creates a
   reviewed, locked drawing whose values carry 「来自图片 · 已人工确认」. */
export async function POST(_req: NextRequest, { params }: Params) {
  const a = await judgeAccess((await params).id, true);
  if ('error' in a) return a.error;
  let drawingId: number;
  try { drawingId = await handoff(a.id, a.user.name); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
  const drawing = getDrawing(drawingId)!;
  return NextResponse.json({
    drawing, pack: getInquiry(drawing.project_id)?.packs.led ?? null, judge: await getJudgeView(a.id, a.admin),
  });
}
