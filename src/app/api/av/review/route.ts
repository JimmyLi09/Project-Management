import { NextRequest, NextResponse } from 'next/server';
import { canReviewDrawing, identityOf } from '@/lib/permissions';
import { applyReview, getDrawing, markReviewed, type ReviewChange } from '@/server/avdb';
import { DrawingServiceError, runDrawingCli, SAMPLE_STORE } from '@/server/avdrawing';
import { appendAudit, getProject } from '@/server/db';
import { currentUser } from '@/server/session';

/* 04 人工校核: POST { id, changes: [{ element, confirmed, corrected }], submit }.

   Every confirm / undo is saved as it happens, so a refresh loses nothing. Only
   the confirmation and the corrected value are taken from the request — the
   extracted value, its provenance and whether it needs review are read back
   from the database, so the screen cannot forge a confidence to slip the gate.

   On submit the drawing service re-checks the A10 gate on that stored copy;
   when it passes, corrections go to the sample library, the drawing is locked
   and the project's activity log records it. */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { id?: number; changes?: ReviewChange[]; submit?: boolean } | null;
  const current = body?.id ? getDrawing(Number(body.id)) : null;
  if (!current) return NextResponse.json({ error: '图纸不存在' }, { status: 404 });
  if (!canReviewDrawing(identityOf(user), getProject(current.project_id))) {
    return NextResponse.json({ error: '仅该项目的 PM 可执行人工校核' }, { status: 403 });
  }

  let drawing;
  try {
    drawing = applyReview(current.id, Array.isArray(body!.changes) ? body!.changes : [], user.name);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '保存失败' }, { status: 400 });
  }
  if (!body!.submit) return NextResponse.json({ drawing, may_enter_configuration: false });

  try {
    const res = await runDrawingCli(['writeback', SAMPLE_STORE], JSON.stringify(drawing));
    const gate = res.may_enter_configuration === true;
    if (gate) {
      markReviewed(drawing.id, user.name);
      const fixed = drawing.extractions.filter((r) => r.corrected !== null).length;
      appendAudit(drawing.project_id, [{
        at: Date.now(), by: user.name,
        text: `LED 图纸校核完成：${drawing.drawing}（修正 ${fixed} 项，已锁定）`,
      }]);
    }
    return NextResponse.json({ drawing: getDrawing(drawing.id), may_enter_configuration: gate, written: res.written });
  } catch (e) {
    const status = e instanceof DrawingServiceError ? 422 : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : '提交失败' }, { status });
  }
}
