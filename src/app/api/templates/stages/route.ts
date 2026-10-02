import { NextRequest, NextResponse } from 'next/server';
import { stagesFromTemplate } from '@/lib/calendarStages';
import { SVC } from '@/lib/templates';
import { getEffectiveTemplate } from '@/server/db';
import { currentUser } from '@/server/session';

/* GET /api/templates/stages?svc= — REQ-047:排期日历这项服务的默认阶段(当前生效模板的排期步骤)。
   只读、只有阶段名和周数,登录的人都能取(模板管理那个接口只给 PD / BD)。 */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const svc = req.nextUrl.searchParams.get('svc') ?? '';
  if (!SVC[svc]) return NextResponse.json({ error: '未知服务' }, { status: 400 });
  return NextResponse.json({ svc, stages: stagesFromTemplate(svc, getEffectiveTemplate(svc)) });
}
