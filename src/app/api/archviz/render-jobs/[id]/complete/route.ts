export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getArchvizDb, uid } from '@/server/archviz/db';
import { isAuthorizedWorker } from '@/server/archviz/workerAuth';
import { computePreScore } from '@/server/archviz/prescore';
import { evaluateFrame } from '@/server/archviz/visionEval';

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  if (!isAuthorizedWorker(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id: jobId } = await params;

  const form = await req.formData().catch(() => null);
  const image = form?.get('image');
  if (!(image instanceof File)) return NextResponse.json({ error: 'missing image' }, { status: 400 });
  const imageBuf = Buffer.from(await image.arrayBuffer());
  const realBboxJson = form?.get('realBbox') ? String(form.get('realBbox')) : null; // Phase 2 only

  const db = getArchvizDb();
  const job = db.prepare('SELECT * FROM render_jobs WHERE id = ?').get(jobId) as any;
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });
  if (job.status === 'done') return NextResponse.json({ ok: true }); // idempotent re-post

  db.prepare('UPDATE render_jobs SET status = ?, real_bbox_json = ? WHERE id = ?').run('done', realBboxJson, jobId);

  const frameId = uid('frame');
  const pre = await computePreScore(imageBuf);
  const now = Date.now();
  db.prepare(`
    INSERT INTO frames (id, run_id, job_id, cam_group, preset_id, image_blob, blur_score, exposure_score, dup_hash, pre_score, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(frameId, job.run_id, jobId, job.cam_group, job.preset_id, imageBuf, pre.blurScore, pre.exposureScore, pre.dupHash,
    Math.round(pre.blurScore + pre.exposureScore) / 2, now);

  const camera = JSON.parse(job.camera_json);
  const evalResult = await evaluateFrame({ frameId, camera, preScore: pre });
  db.prepare(`
    INSERT INTO frame_evaluations (
      id, run_id, frame_id, cam_group, rank, overall_score, hero_score, confidence,
      dimension_scores_json, showcase_regions_json, marketing_reason_zh, marketing_reason_en,
      camera_json, preset_id, requires_recapture, favorite, label, created_at
    ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'none', ?)
  `).run(
    uid('feval'), job.run_id, frameId, job.cam_group,
    evalResult.overallScore, evalResult.heroScore, evalResult.confidence,
    JSON.stringify(evalResult.dimensionScores), JSON.stringify(evalResult.showcaseRegions),
    evalResult.marketingReason[0], evalResult.marketingReason[1],
    job.camera_json, job.preset_id, evalResult.requiresRecapture ? 1 : 0, now,
  );

  finalizeRunIfDone(job.run_id);
  return NextResponse.json({ ok: true });
}

function finalizeRunIfDone(runId: string) {
  const db = getArchvizDb();
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM render_jobs WHERE run_id = ?) AS total,
      (SELECT COUNT(*) FROM render_jobs WHERE run_id = ? AND status IN ('done', 'failed')) AS processed
  `).get(runId, runId) as { total: number; processed: number };

  if (counts.processed < counts.total) {
    db.prepare('UPDATE analysis_runs SET rendered = ? WHERE id = ?').run(counts.processed, runId);
    return;
  }

  // last job just finished — rank everything and close out the run
  const rows = db.prepare('SELECT frame_id FROM frame_evaluations WHERE run_id = ? ORDER BY overall_score DESC').all(runId) as { frame_id: string }[];
  const updateRank = db.prepare('UPDATE frame_evaluations SET rank = ? WHERE frame_id = ?');
  const tx = db.transaction(() => { rows.forEach((r, i) => updateRank.run(i + 1, r.frame_id)); });
  tx();

  db.prepare("UPDATE analysis_runs SET rendered = ?, stage = 'completed', completed_at = ? WHERE id = ?")
    .run(counts.processed, Date.now(), runId);
}
