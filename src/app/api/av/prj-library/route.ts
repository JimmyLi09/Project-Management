import { NextResponse } from 'next/server';
import { latestPrjPack, prjLibrary } from '@/server/avdb';
import { currentUser } from '@/server/session';
import { denyAvModule } from '@/server/avguard';

/* AV-020 §3.5:05 投影用的设备库(价格库「投影」里启用的投影机和镜头,只有规格、不带价格)
   和投影线现在的最新规则包(prj@1.0 发布了就是 1.0) */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  { const deny = denyAvModule(user); if (deny) return deny; }
  return NextResponse.json({ library: prjLibrary(), latest: latestPrjPack() });
}
