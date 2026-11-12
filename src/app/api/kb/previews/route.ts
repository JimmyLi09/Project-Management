import { NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { canManageKbPreviews, identityOf } from '@/lib/permissions';
import { queueAllOffice, sofficeAvailable } from '@/server/kbPreview';

/* REQ-061:PD / BD「生成全部预览」—— 所有还没转好的 Word / Excel / PPT 附件排队(一次转一个)。
   GET 只告诉页面服务器有没有装 LibreOffice。 */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  return NextResponse.json({ soffice: sofficeAvailable() });
}

export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canManageKbPreviews(identityOf(user))) return NextResponse.json({ error: '只有 PD / BD 可以生成全部预览 / Only PD / BD can generate all previews' }, { status: 403 });
  if (!sofficeAvailable()) return NextResponse.json({ error: '服务器还没装预览组件(LibreOffice) / The preview component (LibreOffice) is not installed on the server' }, { status: 409 });
  return NextResponse.json({ queued: queueAllOffice() });
}
