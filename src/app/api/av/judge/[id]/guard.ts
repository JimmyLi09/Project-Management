import { NextResponse } from 'next/server';
import { canReviewDrawing, identityOf, isFull } from '@/lib/permissions';
import { judgeProject } from '@/server/avjudge';
import { denyUnlessVisible, denyAvModule } from '@/server/avguard';
import { getProject } from '@/server/db';
import { currentUser } from '@/server/session';
import type { User } from '@/lib/types';

/* Who may see a judgement (anyone who sees the project) and who may review it
   (the project's PM, PD / BD — the same people as 04 人工校核). */
export async function judgeAccess(rawId: string, write: boolean):
  Promise<{ error: NextResponse } | { id: number; user: User; admin: boolean }> {
  const user = await currentUser();
  if (!user) return { error: NextResponse.json({ error: '未登录' }, { status: 401 }) };
  { const deny = denyAvModule(user); if (deny) return { error: deny }; }
  const id = Number(rawId);
  const projectId = Number.isInteger(id) ? judgeProject(id) : null;
  const project = projectId ? getProject(projectId) : null;
  if (!project) return { error: NextResponse.json({ error: '判读记录不存在' }, { status: 404 }) };
  const denied = denyUnlessVisible(user, project);
  if (denied) return { error: denied };
  if (write && !canReviewDrawing(identityOf(user), project)) {
    return { error: NextResponse.json({ error: '仅该项目的 PM 可确认图片判读' }, { status: 403 }) };
  }
  return { id, user, admin: isFull(identityOf(user)) };
}
