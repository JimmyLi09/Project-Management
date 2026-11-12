import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { getDb, getProject } from '@/server/db';
import { canSeeProject, identityOf } from '@/lib/permissions';
import { checkOwner, checkPkgOwner } from '@/server/assignGate';
import { gateOn } from '@/server/trainStore';

/* REQ-062 派项目限制的前端提示:选人时先问一下「能不能当负责 PM」。
   POST { pid?, svcs?, names: [], pkgSvc? } → { gate: 开关是否打开, results: { 名字: { blocked, kind, biz? } } }
   只回答「能不能 / 为什么」,不下发谁在哪个业务上几级(能力矩阵有自己的可见范围)。真正的拦在保存的接口里。 */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { pid?: string; svcs?: unknown; names?: unknown; pkgSvc?: string };
  let svcs: string[] = Array.isArray(b.svcs) ? b.svcs.map(String).slice(0, 40) : [];
  let approach: unknown;
  if (b.pid) {
    const p = getProject(String(b.pid));
    if (!p || !canSeeProject(identityOf(user), p)) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    svcs = (p.packages || []).map((k) => k.svc);
    approach = p.approach;
  }
  const names = [...new Set((Array.isArray(b.names) ? b.names : []).map((n) => String(n).trim()).filter(Boolean))].slice(0, 60);
  const results: Record<string, { blocked: boolean; kind: string; biz?: string }> = {};
  for (const n of names) {
    const r = b.pkgSvc ? checkPkgOwner(String(b.pkgSvc), n) : checkOwner({ packages: svcs.map((svc) => ({ svc })) as never, approach: approach as never }, n);
    results[n] = { blocked: !!r.block, kind: r.kind, ...(r.biz ? { biz: r.biz } : {}) };
  }
  return NextResponse.json({ gate: gateOn(getDb()), results });
}
