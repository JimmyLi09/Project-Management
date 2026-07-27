export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { getArchvizDb, uid } from '@/server/archviz/db';
import { rowToShot } from '@/server/archviz/mapRow';
import type { DesignerActionType, DesignerLabel } from '@/lib/archviz/types';

type Params = { params: Promise<{ id: string }> };

const LABEL_FOR: Partial<Record<DesignerActionType, DesignerLabel>> = {
  promote: 'promoted', demote: 'demoted', reject: 'rejected', mark_hero: 'hero',
};

export async function POST(req: NextRequest, { params }: Params) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const type = String(body.type || '') as DesignerActionType;

  const db = getArchvizDb();
  const shotRow = db.prepare('SELECT * FROM frame_evaluations WHERE frame_id = ?').get(id);
  if (!shotRow) return NextResponse.json({ error: '角度不存在' }, { status: 404 });

  if (type === 'favorite') db.prepare('UPDATE frame_evaluations SET favorite = 1 WHERE frame_id = ?').run(id);
  else if (type === 'unfavorite') db.prepare('UPDATE frame_evaluations SET favorite = 0 WHERE frame_id = ?').run(id);
  else if (LABEL_FOR[type]) {
    // toggle: re-applying the same label clears it back to 'none'
    const current = (shotRow as any).label as string;
    const next = current === LABEL_FOR[type] ? 'none' : LABEL_FOR[type];
    db.prepare('UPDATE frame_evaluations SET label = ? WHERE frame_id = ?').run(next, id);
  }
  // view_detail / compare / export / request_recapture: logged only, no state change

  db.prepare('INSERT INTO designer_actions (id, shot_id, type, at) VALUES (?, ?, ?, ?)').run(uid('act'), id, type, Date.now());

  const updated = db.prepare('SELECT * FROM frame_evaluations WHERE frame_id = ?').get(id);
  return NextResponse.json({ shot: rowToShot(updated) });
}
