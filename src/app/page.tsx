import { redirect } from 'next/navigation';
import { currentUser } from '@/server/session';
import App from '@/components/App';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect('/login');
  return <App user={user} />;
}
