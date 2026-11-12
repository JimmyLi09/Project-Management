import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { canUpdateKbMap, identityOf } from '@/lib/permissions';
import { getDb } from '@/server/db';
import { currentMap, listMapVersions, restoreMapVersion } from '@/server/kbStore';

/* REQ-061:PD / BD 把地图恢复到某一版(存成新的一版,历史里看得到) */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canUpdateKbMap(identityOf(user))) return NextResponse.json({ error: '只有 PD / BD 可以恢复地图 / Only PD / BD can restore the map' }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { version?: unknown };
  try {
    const d = getDb();
    const version = restoreMapVersion(d, Number(body.version), user.name, Date.now());
    return NextResponse.json({ version, map: currentMap(d), versions: listMapVersions(d) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
