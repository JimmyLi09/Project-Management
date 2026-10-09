import { redirect } from 'next/navigation';
import { currentUser } from '@/server/session';
import { getPermTable } from '@/server/db';
import App from '@/components/App';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect('/login');
  /* REQ-051: 权限表随首屏一起下发,菜单 / 标签一开始就按它显示,不会先闪一下 */
  return <App user={user} permTable={getPermTable()} />;
}
