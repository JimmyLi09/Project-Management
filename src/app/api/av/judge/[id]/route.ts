import { NextRequest, NextResponse } from 'next/server';
import type { JudgeReview } from '@/av/core/imagejudge';
import { getJudgeView, removeJudge, saveReview } from '@/server/avjudge';
import { removeUploadsOfJudge } from '@/server/avupload';
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

/* DELETE — AV-018:删一份还没带入 05 的图片判读(重复上传的那一份),连同原件。只有 PD / BD,写操作日志 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const a = await judgeAccess((await params).id, false);
  if ('error' in a) return a.error;
  if (!a.admin) return NextResponse.json({ error: '只有 PD / BD 可以删除' }, { status: 403 });
  const r = await removeJudge(a.id, a.user.name);
  if (r === 'handed') return NextResponse.json({ error: '已带入 05 的不能删' }, { status: 409 });
  if (r === 'busy') return NextResponse.json({ error: '正在识别，请稍候再删' }, { status: 409 });
  if (r === 'missing') return NextResponse.json({ error: '判读记录不存在' }, { status: 404 });
  await removeUploadsOfJudge(a.id);
  return NextResponse.json({ ok: true });
}
