import { NextRequest, NextResponse } from 'next/server';
import { getJudgeView, rerunJudge } from '@/server/avjudge';
import { judgeAccess } from '../guard';

type Params = { params: Promise<{ id: string }> };

/* POST { page? } — read the picture again (after the service was started, or
   another page of a scanned PDF). Clears the review. */
export async function POST(req: NextRequest, { params }: Params) {
  const a = await judgeAccess((await params).id, true);
  if ('error' in a) return a.error;
  const body = (await req.json().catch(() => ({}))) as { page?: number };
  try { await rerunJudge(a.id, Number(body.page ?? 1), a.user.name); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
  return NextResponse.json({ judge: await getJudgeView(a.id, a.admin) });
}
