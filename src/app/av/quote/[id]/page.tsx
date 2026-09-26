import { redirect } from 'next/navigation';
import { canViewPrices, identityOf } from '@/lib/permissions';
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
  if (!quote || !project || !canViewPrices(identityOf(user))) {
    return <main style={{ padding: 40, fontSize: 14 }}>{quote && project ? '当前角色无权查看报价。' : '报价不存在。'}</main>;
  }
  return (
    <>
      <style>{'body { background: #E9E7E2; }'}</style>
      <QuoteDocument quote={quote} project={project} actions={<PrintButton />} />
    </>
  );
}
