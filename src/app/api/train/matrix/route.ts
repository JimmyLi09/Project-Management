import { NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { getDb } from '@/server/db';
import { bundle, canSeeMatrix, meOf } from '@/server/train062';

/* REQ-062 能力矩阵。PD / BD 全部;带教人自己和带的人;PM 只看自己;其他角色 403(页面上也没有入口)。 */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canSeeMatrix(meOf(getDb(), user))) return NextResponse.json({ error: '没有权限看能力矩阵 / You cannot see the competency matrix' }, { status: 403 });
  const b = bundle(user);
  return NextResponse.json({ matrix: b.matrix, log: b.log });
}
