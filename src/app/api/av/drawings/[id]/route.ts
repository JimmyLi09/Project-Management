import { NextRequest, NextResponse } from 'next/server';
import { getDrawing } from '@/server/avdb';
import { currentUser } from '@/server/session';
import { getProject } from '@/server/db';
import { denyUnlessVisible } from '@/server/avguard';

type Params = { params: Promise<{ id: string }> };

/* GET /api/av/drawings/:id — one drawing with its six extractions, to resume a
   review or to load a reviewed drawing into 05. */
export async function GET(_req: NextRequest, { params }: Params) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const drawing = getDrawing(Number((await params).id));
  if (!drawing) return NextResponse.json({ error: '图纸不存在' }, { status: 404 });
  /* REQ-043:这一条原来只查了登录 —— 任何人凭一个数字 id 就能取到任意项目的
     图纸和它解析出来的尺寸。按项目可见性拦住。 */
  const denied = denyUnlessVisible(user, getProject(drawing.project_id));
  if (denied) return denied;
  return NextResponse.json(drawing);
}
