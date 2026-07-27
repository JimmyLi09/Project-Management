export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { getArchvizDb, uid } from '@/server/archviz/db';
import { mulberry32, hashSeed } from '@/lib/archviz/rng';
import { buildMassing } from '@/server/archviz/massing';
import { sampleCameras } from '@/server/archviz/sampling';
import { rowToRun } from '@/server/archviz/mapRow';

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const modelId = String(body.modelId || '');
  const lightingPresetIds: string[] = Array.isArray(body.lightingPresetIds) ? body.lightingPresetIds.map(String) : [];
  if (!modelId || !lightingPresetIds.length) {
    return NextResponse.json({ error: '缺少模型或灯光预设' }, { status: 400 });
  }

  const db = getArchvizDb();
  const model = db.prepare('SELECT * FROM models WHERE id = ?').get(modelId) as
    { id: string; dcc: string; seed: number; bbox_floors: number } | undefined;
  if (!model) return NextResponse.json({ error: '模型不存在' }, { status: 404 });

  // model.seed governs the building's massing (stable across repeat runs of
  // the SAME uploaded file — matches real-world behavior); a run-specific
  // seed governs camera sampling, so re-analyzing samples a fresh candidate
  // set each time (Handbook §3 "先粗后精" — each pass re-samples).
  const massingRnd = mulberry32(model.seed);
  const { mainHeight } = buildMassing(massingRnd, model.bbox_floors);

  const runId = uid('run');
  const runSeed = hashSeed(runId);
  const cameraRnd = mulberry32(runSeed);
  const cameraCount = 12 + Math.floor(cameraRnd() * 6);
  const cameras = sampleCameras(cameraRnd, cameraCount, mainHeight);
  const total = cameraCount * lightingPresetIds.length;

  // informational funnel numbers (Handbook §3: ~100–150 candidates → local
  // pre-score keeps ~30 → GPT-Vision evaluates the Top 12–20 that become the
  // final board) — Phase 1 samples the final camera count directly rather
  // than re-deriving it from a literal 100+-candidate pool.
  const poolTotal = Math.round(100 + Math.random() * 50);
  const poolKept = 26 + Math.floor(Math.random() * 8);

  const now = Date.now();
  db.prepare(`
    INSERT INTO analysis_runs (id, model_id, lighting_preset_ids_json, stage, rendered, total, pool_total, pool_kept, created_at)
    VALUES (?, ?, ?, 'rendering', 0, ?, ?, ?, ?)
  `).run(runId, modelId, JSON.stringify(lightingPresetIds), total, poolTotal, poolKept, now);

  const insertJob = db.prepare(`
    INSERT INTO render_jobs (id, run_id, cam_index, cam_group, preset_id, camera_json, dcc, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)
  `);
  const tx = db.transaction(() => {
    cameras.forEach((camera, i) => {
      const camGroup = `${runId}_cam${i}`;
      lightingPresetIds.forEach((presetId) => {
        insertJob.run(uid('job'), runId, i, camGroup, presetId, JSON.stringify(camera), model.dcc, now);
      });
    });
  });
  tx();

  const row = db.prepare('SELECT * FROM analysis_runs WHERE id = ?').get(runId);
  return NextResponse.json({ run: rowToRun(row) });
}
