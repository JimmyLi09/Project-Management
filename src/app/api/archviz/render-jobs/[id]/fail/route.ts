export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getArchvizDb } from '@/server/archviz/db';
import { isAuthorizedWorker } from '@/server/archviz/workerAuth';

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  if (!isAuthorizedWorker(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id: jobId } = await params;
  const body = await req.json().catch(() => ({}));
  const error = String(body.error || 'render failed');

  const db = getArchvizDb();
  const job = db.prepare('SELECT run_id, status FROM render_jobs WHERE id = ?').get(jobId) as { run_id: string; status: string } | undefined;
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });
  if (job.status === 'done' || job.status === 'failed') return NextResponse.json({ ok: true });

  db.prepare("UPDATE render_jobs SET status = 'failed', error = ? WHERE id = ?").run(error, jobId);

  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM render_jobs WHERE run_id = ?) AS total,
      (SELECT COUNT(*) FROM render_jobs WHERE run_id = ? AND status IN ('done', 'failed')) AS processed
  `).get(job.run_id, job.run_id) as { total: number; processed: number };

  if (counts.processed >= counts.total) {
    db.prepare("UPDATE analysis_runs SET rendered = ?, stage = 'completed', completed_at = ? WHERE id = ?")
      .run(counts.processed, Date.now(), job.run_id);
  } else {
    db.prepare('UPDATE analysis_runs SET rendered = ? WHERE id = ?').run(counts.processed, job.run_id);
  }
  return NextResponse.json({ ok: true });
}
