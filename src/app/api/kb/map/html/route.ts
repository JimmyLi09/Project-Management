import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { getDb } from '@/server/db';
import { mapHtml } from '@/server/kbStore';
import { MAP_CSP, withBridge } from '@/server/kbMapBridge';

/* REQ-061 地图内容(给首页的 sandbox iframe 用;?v= 看某一版)。
   用户上传的 HTML 不能和平台同源运行:响应头 CSP sandbox(不给 allow-same-origin),
   就算单独打开这个地址,页面也是独立的源,拿不到登录 cookie、碰不到平台。 */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return new NextResponse('未登录 / Not signed in', { status: 401, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const v = Number(req.nextUrl.searchParams.get('v') || 0) || undefined;
  const html = mapHtml(getDb(), v);
  if (html == null) return new NextResponse('还没有流程地图 / No map yet', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  return new NextResponse(withBridge(html), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': MAP_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
