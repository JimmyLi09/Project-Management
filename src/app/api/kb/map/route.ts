import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { canUpdateKbMap, identityOf } from '@/lib/permissions';
import { getDb } from '@/server/db';
import { currentMap, listMapVersions, MAP_MAX, mapDocId, saveMapVersion } from '@/server/kbStore';

/* REQ-061 知识库首页的流程地图。
   GET  → 当前版本、版本历史(人人能看)、地图文档 id
   POST → PD / BD 上传新版本(.html,2MB 以内);旧版本进历史,留最近 10 版 */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const d = getDb();
  return NextResponse.json({ map: currentMap(d), versions: listMapVersions(d), docId: mapDocId(d) });
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canUpdateKbMap(identityOf(user))) return NextResponse.json({ error: '只有 PD / BD 可以更新地图 / Only PD / BD can update the map' }, { status: 403 });
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: '没有收到文件 / No file received' }, { status: 400 });
  if (!/\.html?$/i.test(file.name)) return NextResponse.json({ error: '地图要是 .html 文件 / The map must be an .html file' }, { status: 400 });
  if (file.size > MAP_MAX) return NextResponse.json({ error: '地图文件超过 2MB / The map file is over 2MB' }, { status: 400 });
  const html = Buffer.from(await file.arrayBuffer()).toString('utf8');
  try {
    const d = getDb();
    const version = saveMapVersion(d, { html, name: file.name.replace(/\.html?$/i, ''), by: user.name, now: Date.now(), note: String(form?.get('note') || '') });
    return NextResponse.json({ version, map: currentMap(d), versions: listMapVersions(d) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
