import { redirect } from 'next/navigation';
import { canSeeProject, canViewQuotes, identityOf, priceView } from '@/lib/permissions';
import { redactQuote } from '@/server/avredact';
import type { Quote } from '@/server/avdb';
import { getQuote } from '@/server/avdb';
import { getProject } from '@/server/db';
import { currentUser } from '@/server/session';
import QuoteDocument from '@/components/QuoteDocument';
import PrintButton from './PrintButton';

export const dynamic = 'force-dynamic';

/* 07 · the customer quotation, printed from the browser (2026-09-26 decision). */

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const quote = getQuote(Number((await params).id));
  const project = quote && getProject(quote.projectId);
  /* REQ-043:这一页原来只查了角色。PM 看不见别人的项目,却能凭报价 id 打开
     别人项目的报价单(客户名、业务线、含税总价都在上面)。 */
  const me = identityOf(user);
  if (!quote || !project) {
    return <main style={{ padding: 40, fontSize: 14 }}>报价不存在。</main>;
  }
  /* 字段级隔离:报价就是售价,PM 不看售价 —— 这一页也进不来 */
  if (!canViewQuotes(me) || !canSeeProject(me, project)) {
    return <main style={{ padding: 40, fontSize: 14 }}>当前角色无权查看这份报价。</main>;
  }
  return (
    <>
      <style>{'body { background: #E9E7E2; }'}</style>
      {/* 给客户的报价单本来就不印成本;这里再把成本从对象里拿掉,免得随组件
          属性序列化进页面 */}
      <QuoteDocument quote={redactQuote(quote, priceView(me)) as unknown as Quote} project={project} actions={<PrintButton />} />
    </>
  );
}
