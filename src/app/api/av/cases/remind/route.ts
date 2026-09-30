import { NextRequest, NextResponse } from 'next/server';
import { canEditPrices, identityOf } from '@/lib/permissions';
import { logZh } from '@/lib/logmsg';
import { appendCaseLog, setContacted } from '@/server/avdb';
import { currentUser } from '@/server/session';

/* 保修到期提醒的「已联系」(AV-014 §7 第 1 条的后续)。
   POST { caseKey, contacted: true | false }   —— PD / BD only,与提醒的可见范围一致。
   标记挂在这块屏**当前的**到期日上:交付日期或保修期一改,到期日变了,
   下一轮到期会重新提醒。 */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canEditPrices(identityOf(user))) return NextResponse.json({ error: '仅 PD / BD 可标记已联系' }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { caseKey?: string; contacted?: unknown } | null;
  const caseKey = body?.caseKey?.trim();
  if (!caseKey || typeof body?.contacted !== 'boolean') {
    return NextResponse.json({ error: '缺少 caseKey 或 contacted' }, { status: 400 });
  }
  const row = setContacted(caseKey, body.contacted, user.name);
  if (!row) return NextResponse.json({ error: '这块屏不在案例库里,或还没有交付日期(没有到期日可言)' }, { status: 404 });

  const k = body.contacted ? 'av.caseContacted' : 'av.caseContactUndo';
  const p = { screen: row.name, due: row.expire };
  appendCaseLog(caseKey, user.name, k, { ...p, text: logZh(k, p) });
  return NextResponse.json({ case: row });
}
