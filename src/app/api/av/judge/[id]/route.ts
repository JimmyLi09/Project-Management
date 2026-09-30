import { NextRequest, NextResponse } from 'next/server';
import type { JudgeReview } from '@/av/core/imagejudge';
import { getJudgeView, saveReview } from '@/server/avjudge';
import { judgeAccess } from './guard';

type Params = { params: Promise<{ id: string }> };

/* GET — the judgement, with progress while the model is reading (the screen
   polls this). PATCH { intent?, confirmed?, values?, answers?, pitch? } — the
   person's review, saved as they go; validated field by field. */
export async function GET(_req: NextRequest, { params }: Params) {
  const a = await judgeAccess((await params).id, false);
  if ('error' in a) return a.error;
  return NextResponse.json({ judge: await getJudgeView(a.id, a.admin) });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const a = await judgeAccess((await params).id, true);
  if ('error' in a) return a.error;
  const body = (await req.json().catch(() => null)) as Partial<JudgeReview> | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ error: '请求无效' }, { status: 400 });
  try { saveReview(a.id, body); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
  return NextResponse.json({ judge: await getJudgeView(a.id, a.admin) });
}
