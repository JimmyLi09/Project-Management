import { NextResponse } from 'next/server';
import { listProjects } from '@/server/db';
import { currentUser } from '@/server/session';
import { canViewPrices, identityOf, visibleProjects } from '@/lib/permissions';
import { projectLines } from '@/av/core/lines';
import type { BusinessLine } from '@/av/core/types';
import { getInquiry, latestConfig, latestCostSheet, listDrawings, listPriceItems, listQuotes } from '@/server/avdb';

/* ===== 0929 AV 工作台 =====
   AV 的每个接口都是「按项目取一份」。工作台要的是横着看一眼:几个项目卡在
   哪一步、下一步点哪。客户端逐个项目去问就是 N 次请求,而且成本 / 报价那几个
   接口对 member、viewer 是 403 —— 那样首页会一半是错的。所以在服务端一次算完。

   REQ-043 的可见性同样适用:PM / Engineer 只看得见自己的项目,这里的数字也
   只该数他看得见的那些,所以先过 visibleProjects。 */

type Stage = 'intake' | 'review' | 'config' | 'costing' | 'quoting' | 'done';

const COSTED: BusinessLine[] = ['led', 'projector', 'elv', 'pv'];

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const me = identityOf(user);
  const money = canViewPrices(me);

  const rows = visibleProjects(me, listProjects())
    .filter((p) => !p.archived)
    .map((p) => {
      const inquiry = getInquiry(p.id);
      const lines = projectLines(p.packages.map((k) => k.svc), inquiry?.lines);
      if (!lines.length && !inquiry) return null;   // 不是 AV 项目

      const keys = lines.map((l) => l.line).filter((l) => COSTED.includes(l));
      const drawings = listDrawings(p.id);
      const quotes = listQuotes(p.id);
      const configured = keys.filter((l) => !!latestConfig(p.id, l));
      /* 成本表只有看得到价格的人能数;看不到的人这一步一律当「还没到」,
         他在界面上本来也点不进成本那一页。 */
      const costed = money ? keys.filter((l) => !!latestCostSheet(p.id, l)) : [];

      const approved = quotes.some((q) => q.status === 'approved');
      const submitted = quotes.some((q) => q.status === 'submitted');
      const pendingDrawing = drawings.some((d) => d.pending > 0);

      const stage: Stage =
        approved ? 'done'
        : submitted ? 'quoting'
        : keys.length > 0 && costed.length === keys.length ? 'quoting'
        : keys.length > 0 && configured.length === keys.length ? (money ? 'costing' : 'config')
        : pendingDrawing ? 'review'
        : drawings.length > 0 || configured.length > 0 ? 'config'
        : 'intake';

      return {
        id: p.id,
        name: p.name,
        client: p.client || '',
        delivery: p.delivery || '',
        lines: lines.map((l) => ({ line: l.line, label: l.label, en: l.en })),
        stage,
        drawings: drawings.length,
        pendingDrawings: drawings.filter((d) => d.pending > 0).length,
        configured: configured.length,
        costed: costed.length,
        total: keys.length,
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
      review: live.filter((r) => r.stage === 'review').length,
      config: live.filter((r) => r.stage === 'config').length,
      quoting: money ? live.filter((r) => r.stage === 'costing' || r.stage === 'quoting').length : null,
      expiredPrices: expired,
    },
    money,
  });
}
