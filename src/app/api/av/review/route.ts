import { NextRequest, NextResponse } from 'next/server';
import type { IngestResult } from '@/av/core/handoff';
import { canReviewDrawing, identityOf } from '@/lib/permissions';
import { DrawingServiceError, runDrawingCli, SAMPLE_STORE } from '@/server/avdrawing';
import { currentUser } from '@/server/session';

/* 04 人工校核 submit: POST the reviewed IngestResult.
   Corrections are written back to the sample library, and the A10 gate is
   re-evaluated on the server's copy — the screen cannot talk its way into 05.
   Who corrected what is stamped here from the session, never taken from the body. */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canReviewDrawing(identityOf(user))) return NextResponse.json({ error: '仅 PM 可执行人工校核' }, { status: 403 });

  const body = (await req.json().catch(() => null)) as IngestResult | null;
  if (!body || !Array.isArray(body.extractions)) return NextResponse.json({ error: '缺少校核数据' }, { status: 400 });

  const at = new Date().toISOString();
  const reviewed: IngestResult = {
    ...body,
    extractions: body.extractions.map((r) => {
      const corrected = r.corrected !== null && r.corrected !== undefined && r.corrected !== r.value;
      return {
        ...r,
        corrected: corrected ? Number(r.corrected) : null,
        corrected_by: corrected ? user.name : '',
        corrected_at: corrected ? at : '',
      };
    }),
  };

  try {
    const res = await runDrawingCli(['writeback', SAMPLE_STORE], JSON.stringify(reviewed));
    return NextResponse.json({ ...res, reviewed });
  } catch (e) {
    const status = e instanceof DrawingServiceError ? 422 : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : '提交失败' }, { status });
  }
}
