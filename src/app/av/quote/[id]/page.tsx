import { redirect } from 'next/navigation';
import { canSeeProject, canViewPrices, identityOf } from '@/lib/permissions';
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
  if (!canViewPrices(me) || !canSeeProject(me, project)) {
    return <main style={{ padding: 40, fontSize: 14 }}>当前角色无权查看这份报价。</main>;
  }
  return (
    <>
      <style>{'body { background: #E9E7E2; }'}</style>
      <QuoteDocument quote={quote} project={project} actions={<PrintButton />} />
    </>
  );
}
