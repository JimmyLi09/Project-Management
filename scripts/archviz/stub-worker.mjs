#!/usr/bin/env node
/* ===== AI ArchViz Director — Phase-1 stub render-node worker =====
   A REAL external process that polls the orchestrator over plain HTTP and
   fulfills render jobs, exactly the way the Phase-2 SketchUp/3ds Max
   scripts will (dcc-scripts/). This script shares no code with the Next.js
   app on purpose — it proves the worker CONTRACT (GET .../next, POST
   .../complete, POST .../fail) works end-to-end without a real render farm.
   It cannot see the uploaded model's real geometry; it regenerates the same
   seeded box-massing the orchestrator used when sampling cameras, purely so
   there's a real, non-trivial PNG to score and display.

   Usage:
     ARCHVIZ_WORKER_TOKEN=<token> node scripts/archviz/stub-worker.mjs
   Env:
     ARCHVIZ_ORCHESTRATOR_URL  default http://localhost:3000
     ARCHVIZ_WORKER_TOKEN      must match the server's token (auto-generated
                                and printed by the server on first run if
                                ARCHVIZ_WORKER_TOKEN isn't set there either —
                                see src/server/archviz/db.ts getWorkerToken())
     ARCHVIZ_WORKER_DCCS       comma list, default "sketchup,3dsmax"
*/

import sharp from 'sharp';

const BASE = process.env.ARCHVIZ_ORCHESTRATOR_URL || 'http://localhost:3000';
const TOKEN = process.env.ARCHVIZ_WORKER_TOKEN;
const DCCS = (process.env.ARCHVIZ_WORKER_DCCS || 'sketchup,3dsmax').split(',').map((s) => s.trim());
const WORKER_ID = 'stub-worker-' + Math.random().toString(36).slice(2, 8);

if (!TOKEN) {
  console.error('ARCHVIZ_WORKER_TOKEN is required (must match the server — see src/server/archviz/db.ts:getWorkerToken)');
  process.exit(1);
}

function authHeaders(extra) {
  return { Authorization: `Bearer ${TOKEN}`, 'x-worker-id': WORKER_ID, ...extra };
}

/* ---------- seeded RNG (mirrors src/lib/archviz/rng.ts) ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- massing (mirrors src/server/archviz/massing.ts) ---------- */
function buildMassing(rnd, floors) {
  const floorH = 1.35;
  const mainH = Math.max(4, floors * floorH);
  const mainW = 8 + rnd() * 7, mainD = 8 + rnd() * 7;
  const boxes = [{ cx: 0, cz: 0, w: mainW, d: mainD, h: mainH }];
  const wings = 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < wings; i++) {
    const side = rnd() < 0.5 ? -1 : 1;
    const w = 5 + rnd() * 6, d = 5 + rnd() * 6, h = mainH * (0.3 + rnd() * 0.35);
    boxes.push({ cx: side * (mainW / 2 + w / 2 + 0.6 + rnd() * 1.6), cz: (rnd() - 0.5) * mainD * 0.6, w, d, h });
  }
  return { boxes, mainHeight: mainH };
}
function boxFaces(b) {
  const x0 = b.cx - b.w / 2, x1 = b.cx + b.w / 2, z0 = b.cz - b.d / 2, z1 = b.cz + b.d / 2;
  const c = {
    bl: [x0, 0, z0], br: [x1, 0, z0], tl: [x0, b.h, z0], tr: [x1, b.h, z0],
    bl2: [x0, 0, z1], br2: [x1, 0, z1], tl2: [x0, b.h, z1], tr2: [x1, b.h, z1],
  };
  return [
    { key: 'front', pts: [c.bl, c.br, c.tr, c.tl], normal: [0, 0, -1] },
    { key: 'back', pts: [c.br2, c.bl2, c.tl2, c.tr2], normal: [0, 0, 1] },
    { key: 'left', pts: [c.bl2, c.bl, c.tl, c.tl2], normal: [-1, 0, 0] },
    { key: 'right', pts: [c.br, c.br2, c.tr2, c.tr], normal: [1, 0, 0] },
    { key: 'top', pts: [c.tl, c.tr, c.tr2, c.tl2], normal: [0, 1, 0] },
  ];
}

/* ---------- vector math ---------- */
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function vnorm(a) { const l = Math.sqrt(vdot(a, a)) || 1e-6; return [a[0] / l, a[1] / l, a[2] / l]; }
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/* ---------- render (mirrors src/server/archviz/stubRender.ts) ---------- */
function buildSvg(boxes, floors, camera, presetId, presetParams, presetType) {
  const isExt = presetType === 'exterior';
  const isDusk = presetId.includes('dusk');
  const eye = camera.position, target = camera.target, up = camera.up;
  const forward = vnorm(vsub(target, eye));
  let right = vnorm(vcross(forward, up));
  if (!isFinite(right[0])) right = [1, 0, 0];
  const camUp = vcross(right, forward);
  const f = camera.fovMm * 0.95;
  const proj = (p) => {
    const rel = vsub(p, eye);
    const cx = vdot(rel, right), cy = vdot(rel, camUp), cz = vdot(rel, forward);
    if (cz <= 0.6) return null;
    return { x: (cx / cz) * f, y: (cy / cz) * f, z: cz };
  };
  const az = ((presetParams.sunAzimuth ?? 135) * Math.PI) / 180;
  const el = ((presetParams.sunElevation ?? 35) * Math.PI) / 180;
  const sunDir = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];

  const drawFaces = [];
  boxes.forEach((b) => {
    boxFaces(b).forEach((face) => {
      const fc = [(face.pts[0][0] + face.pts[2][0]) / 2, (face.pts[0][1] + face.pts[2][1]) / 2, (face.pts[0][2] + face.pts[2][2]) / 2];
      const toEye = vnorm(vsub(eye, fc));
      if (vdot(face.normal, toEye) <= 0.02) return;
      const p = face.pts.map(proj);
      if (p.some((q) => !q)) return;
      const avgZ = p.reduce((s, q) => s + q.z, 0) / p.length;
      drawFaces.push({ proj2d: p.map((q) => [q.x, q.y]), normal: face.normal, avgZ, isSide: face.key !== 'top' });
    });
  });

  const svgW = 100, svgH = 62;
  if (!drawFaces.length) {
    const fallback = isExt ? (isDusk ? '#7a5570' : '#bfe0ef') : '#4a3421';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="960" height="600"><rect width="${svgW}" height="${svgH}" fill="${fallback}"/></svg>`;
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  drawFaces.forEach((f) => f.proj2d.forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }));
  const GROUND_Y = 50, TOP_MARGIN = 7, availW = 88, availH = GROUND_Y - TOP_MARGIN;
  const scale = Math.min(availW / Math.max(1e-3, maxX - minX), availH / Math.max(1e-3, maxY - minY)) * 0.92;
  const cxMid = (minX + maxX) / 2;
  const toScreen = ([x, y]) => [50 + (x - cxMid) * scale, GROUND_Y - (y - minY) * scale];
  drawFaces.sort((a, b) => b.avgZ - a.avgZ);

  const baseRGB = [237, 239, 235];
  const tint = isDusk ? [1, 0.87, 0.7] : isExt ? [0.98, 1, 1] : [1, 0.83, 0.62];
  const lightDir = isExt ? sunDir : vnorm([0.35, 0.75, 0.25]);
  const ambient = 0.6;

  let faceSvg = '';
  drawFaces.forEach((fc) => {
    const lit = Math.max(0, vdot(fc.normal, lightDir));
    const brightness = Math.min(1.08, ambient + (1 - ambient) * lit) * (fc.normal[1] > 0.5 ? 1.05 : 1);
    const rgb = [0, 1, 2].map((i) => Math.max(0, Math.min(255, Math.round(baseRGB[i] * tint[i] * brightness))));
    const pts2d = fc.proj2d.map(toScreen);
    faceSvg += `<polygon points="${pts2d.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}" fill="rgb(${rgb[0]},${rgb[1]},${rgb[2]})"/>`;
    if (fc.isSide) {
      const n = Math.min(floors, 16);
      const strokeCol = isExt ? 'rgba(60,70,60,.35)' : 'rgba(30,18,8,.4)';
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const L = lerp2(pts2d[0], pts2d[3], t), R = lerp2(pts2d[1], pts2d[2], t);
        faceSvg += `<line x1="${L[0].toFixed(1)}" y1="${L[1].toFixed(1)}" x2="${R[0].toFixed(1)}" y2="${R[1].toFixed(1)}" stroke="${strokeCol}" stroke-width="0.35"/>`;
      }
    }
  });

  let sunSvg = '';
  if (isExt) {
    const sunPoint = proj([eye[0] + sunDir[0] * 200, eye[1] + sunDir[1] * 200, eye[2] + sunDir[2] * 200]);
    if (sunPoint) {
      const [sx, sy] = toScreen([sunPoint.x, sunPoint.y]);
      if (sx > -10 && sx < 110 && sy > -10 && sy < 60) sunSvg = `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="3" fill="${isDusk ? '#ffcf8f' : '#fff8e6'}" opacity="0.95"/>`;
    }
  }
  const skyStops = isExt
    ? (isDusk
      ? '<stop offset="0%" stop-color="#2b3a67"/><stop offset="45%" stop-color="#8a5a7a"/><stop offset="75%" stop-color="#e8985a"/><stop offset="100%" stop-color="#f6c98a"/>'
      : '<stop offset="0%" stop-color="#6fb3e0"/><stop offset="55%" stop-color="#bfe0ef"/><stop offset="100%" stop-color="#eef6f3"/>')
    : '<stop offset="0%" stop-color="#3a2a1c"/><stop offset="55%" stop-color="#6b4527"/><stop offset="100%" stop-color="#c98b46"/>';
  const glow = sunSvg.match(/cx="([-\d.]+)" cy="([-\d.]+)"/);
  const glowCx = glow ? glow[1] : '50', glowCy = glow ? glow[2] : '30';
  const footW = (maxX - minX) * scale * 1.15;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="960" height="600">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">${skyStops}</linearGradient>
      <radialGradient id="glow" cx="${glowCx}%" cy="${glowCy}%" r="60%">
        <stop offset="0%" stop-color="${isExt ? '#fff6dd' : '#ffd9a0'}" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="${isExt ? '#fff6dd' : '#ffd9a0'}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${isExt ? '#d8dad2' : '#4a3421'}"/>
        <stop offset="100%" stop-color="${isExt ? '#b7bab0' : '#2a1c11'}"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${svgW}" height="${svgH}" fill="url(#sky)"/>
    <rect x="0" y="0" width="${svgW}" height="${svgH}" fill="url(#glow)"/>
    ${sunSvg}
    <rect x="0" y="${GROUND_Y}" width="${svgW}" height="${svgH - GROUND_Y}" fill="url(#ground)"/>
    <ellipse cx="50" cy="${GROUND_Y + 1}" rx="${Math.max(6, footW * 0.55)}" ry="1.6" fill="#000" opacity="0.14"/>
    ${faceSvg}
    ${!isExt ? `<rect x="0" y="${TOP_MARGIN - 2}" width="${svgW}" height="1" fill="#ffd7a0" opacity="${presetParams.coveIntensity ?? 0.6}"/>` : ''}
  </svg>`;
}

async function claimNext() {
  for (const dcc of DCCS) {
    const res = await fetch(`${BASE}/api/archviz/render-jobs/next?dcc=${encodeURIComponent(dcc)}`, { headers: authHeaders() });
    if (res.status === 204) continue;
    if (!res.ok) { console.error(`[worker] claim failed for ${dcc}: ${res.status} ${await res.text().catch(() => '')}`); continue; }
    return res.json();
  }
  return null;
}

async function handleJob(job) {
  console.log(`[worker] rendering ${job.jobId} (${job.camGroup}, ${job.presetId})`);
  const rnd = mulberry32(job.modelSeed);
  const { boxes } = buildMassing(rnd, job.modelFloors);
  const svg = buildSvg(boxes, job.modelFloors, job.camera, job.presetId, job.presetParams, job.presetType);
  const png = await sharp(Buffer.from(svg)).png().toBuffer();

  const form = new FormData();
  form.append('image', new Blob([png], { type: 'image/png' }), `${job.jobId}.png`);
  const res = await fetch(`${BASE}/api/archviz/render-jobs/${job.jobId}/complete`, { method: 'POST', headers: authHeaders(), body: form });
  if (!res.ok) throw new Error(`complete failed: ${res.status} ${await res.text().catch(() => '')}`);
  console.log(`[worker] done ${job.jobId}`);
}

async function reportFailure(jobId, message) {
  await fetch(`${BASE}/api/archviz/render-jobs/${jobId}/fail`, {
    method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ error: message }),
  }).catch((e) => console.error('[worker] failed to report failure:', e));
}

let stopped = false;
process.on('SIGINT', () => { console.log('\n[worker] stopping...'); stopped = true; });

async function loop() {
  console.log(`[worker] ${WORKER_ID} polling ${BASE} for dcc=${DCCS.join(',')} (Ctrl+C to stop)`);
  while (!stopped) {
    let job = null;
    try { job = await claimNext(); } catch (e) { console.error('[worker] poll error:', e.message); }
    if (!job) { await new Promise((r) => setTimeout(r, 400)); continue; }
    try { await handleJob(job); } catch (e) {
      console.error(`[worker] job ${job.jobId} failed:`, e.message);
      await reportFailure(job.jobId, e.message);
    }
  }
}

loop();
