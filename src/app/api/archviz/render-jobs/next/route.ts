export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getArchvizDb } from '@/server/archviz/db';
import { isAuthorizedWorker } from '@/server/archviz/workerAuth';
import { presetById } from '@/lib/archviz/presets';

/* Worker-facing job claim. Atomic within a better-sqlite3 transaction (the
   whole DB is single-writer/synchronous), so two workers polling at once
   never claim the same job. Same endpoint serves the Phase-1 stub worker
   AND the Phase-2 real DCC scripts — a real worker just does something
   smarter than the stub with the same payload. */
export async function GET(req: NextRequest) {
  if (!isAuthorizedWorker(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const dcc = req.nextUrl.searchParams.get('dcc');
  if (dcc !== 'sketchup' && dcc !== '3dsmax') return NextResponse.json({ error: 'missing/invalid dcc' }, { status: 400 });
  const workerId = req.headers.get('x-worker-id') || 'worker';

  const db = getArchvizDb();
  const STALE_CLAIM_MS = 10 * 60 * 1000; // a worker that dies mid-job (crash, killed process) shouldn't wedge the run forever
  const claim = db.transaction(() => {
    db.prepare("UPDATE render_jobs SET status = 'queued', claimed_by = NULL, claimed_at = NULL WHERE status = 'claimed' AND claimed_at < ?")
      .run(Date.now() - STALE_CLAIM_MS);
    const job = db.prepare(`
      SELECT * FROM render_jobs WHERE status = 'queued' AND dcc = ? ORDER BY created_at ASC LIMIT 1
    `).get(dcc) as any;
    if (!job) return null;
    db.prepare('UPDATE render_jobs SET status = ?, claimed_by = ?, claimed_at = ? WHERE id = ?')
      .run('claimed', workerId, Date.now(), job.id);
    return job;
  });
  const job = claim();
  if (!job) return new NextResponse(null, { status: 204 });

  const model = db.prepare(`
    SELECT m.id, m.seed, m.bbox_floors, m.original_filename FROM analysis_runs ar JOIN models m ON m.id = ar.model_id WHERE ar.id = ?
  `).get(job.run_id) as { id: string; seed: number; bbox_floors: number; original_filename: string };
  const preset = presetById(job.preset_id);

  return NextResponse.json({
    jobId: job.id,
    runId: job.run_id,
    camGroup: job.cam_group,
    camera: JSON.parse(job.camera_json),
    presetId: job.preset_id,
    presetParams: preset.params,
    presetType: preset.type,
    // Phase-1 stub worker only needs seed+floors (regenerates the same
    // placeholder massing); a real DCC worker downloads the actual file:
    modelId: model.id,
    modelFileUrl: `/api/archviz/models/${model.id}/file`,
    modelFilename: model.original_filename,
    modelSeed: model.seed,
    modelFloors: model.bbox_floors,
  });
}
