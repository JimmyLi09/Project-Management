import { NextResponse } from 'next/server';
import { listProjects } from '@/server/db';
import { currentUser } from '@/server/session';
import { canViewPrices, identityOf, visibleProjects } from '@/lib/permissions';
import { listPriceItems } from '@/server/avdb';
import { projectFlow } from '@/server/avflow';

/* ===== 0929 AV 工作台 =====
   AV 的每个接口都是「按项目取一份」。工作台要的是横着看一眼:几个项目卡在
   哪一步、下一步点哪。客户端逐个项目去问就是 N 次请求,而且成本 / 报价那几个
   接口对 member、viewer 是 403 —— 那样首页会一半是错的。所以在服务端一次算完。

   REQ-043 的可见性同样适用:PM / Engineer 只看得见自己的项目,这里的数字也
   只该数他看得见的那些,所以先过 visibleProjects。 */

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const me = identityOf(user);
  const money = canViewPrices(me);

  /* AV-017:阶段判定抽到 server/avflow.ts,步骤条和工作台用同一个函数 */
  const rows = visibleProjects(me, listProjects())
    .filter((p) => !p.archived)
    .map((p) => {
      const f = projectFlow(p, me);
      if (!f) return null;   // 不是 AV 项目
      return {
        id: p.id,
        name: p.name,
        client: p.client || '',
        delivery: p.delivery || '',
        lines: f.lines,
        stage: f.stage,
        drawings: f.counts.drawings,
        pendingDrawings: f.counts.pendingDrawings,
        configured: f.counts.configured,
        costed: f.counts.costed,
        total: f.counts.total,
        /* AV-016 ③:每个项目一条 01→07 进度条,和步骤条同一份状态 */
        steps: f.steps,
      };
    })
    .filter((r): r is NonNullable<typeof r> => !!r);

  const live = rows.filter((r) => r.stage !== 'done');
  /* 过期物料:有有效期、且已经过了今天的在用条目。没有有效期的不算过期 ——
     价格表里很多行本来就不填有效期,当成过期会天天报警。 */
  const today = new Date().toISOString().slice(0, 10);
  const expired = money
    ? listPriceItems().filter((it) => it.active && it.validUntil && it.validUntil < today).length
    : null;

  return NextResponse.json({
    projects: rows,
    counts: {
      /* AV-016 ③:五个数字 = 五个阶段各有几个项目(看不到价格的人没有后两格) */
      intake: live.filter((r) => r.stage === 'intake').length,
      review: live.filter((r) => r.stage === 'review').length,
      config: live.filter((r) => r.stage === 'config').length,
      costing: money ? live.filter((r) => r.stage === 'costing').length : null,
      quoting: money ? live.filter((r) => r.stage === 'quoting').length : null,
      expiredPrices: expired,
    },
    money,
  });
}
