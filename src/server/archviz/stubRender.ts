/* ===== Stub renderer =====
   There is no render farm behind Phase 1 — this produces a real PNG (not a
   placeholder color swatch) by rasterizing the same seeded-massing + 3D
   camera projection validated in this session's design-draft artifact.
   Every camera in a run renders the SAME building from a different real
   camera position — proportions/floor-count are internally consistent, but
   this is NOT the uploaded model's actual geometry (impossible without the
   real DCC — see dcc-scripts/). Swapped out entirely once Phase 2's render
   node reports real renders for a job. */

import sharp from 'sharp';
import type { ShotCamera } from '@/lib/archviz/types';
import { presetById } from '@/lib/archviz/presets';
import { vsub, vcross, vdot, vnorm, lerp2, type Vec3 } from './geometry';
import { boxFaces, type MassingBox } from './massing';

const WIDTH = 960, HEIGHT = 600; // matches Handbook §5.3 pre-scoring pass resolution

interface Projected { x: number; y: number; z: number }

function project(eye: Vec3, right: Vec3, camUp: Vec3, forward: Vec3, f: number, p: Vec3): Projected | null {
  const rel = vsub(p, eye);
  const cx = vdot(rel, right), cy = vdot(rel, camUp), cz = vdot(rel, forward);
  if (cz <= 0.6) return null;
  return { x: (cx / cz) * f, y: (cy / cz) * f, z: cz };
}

export async function renderStubFrame(boxes: MassingBox[], floors: number, camera: ShotCamera, presetId: string): Promise<Buffer> {
  const svg = buildStubSvg(boxes, floors, camera, presetId);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function buildStubSvg(boxes: MassingBox[], floors: number, camera: ShotCamera, presetId: string): string {
  const preset = presetById(presetId);
  const isExt = preset.type === 'exterior';
  const isDusk = preset.id.includes('dusk');

  const eye = camera.position, target = camera.target, up = camera.up;
  const forward = vnorm(vsub(target, eye));
  let right = vnorm(vcross(forward, up));
  if (!isFinite(right[0])) right = [1, 0, 0];
  const camUp = vcross(right, forward);
  const f = camera.fovMm * 0.95;
  const proj = (p: Vec3) => project(eye, right, camUp, forward, f, p);

  const az = ((preset.params.sunAzimuth ?? 135) * Math.PI) / 180;
  const el = ((preset.params.sunElevation ?? 35) * Math.PI) / 180;
  const sunDir: Vec3 = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];

  type DrawFace = { proj2d: [number, number][]; normal: Vec3; avgZ: number; isSide: boolean };
  const drawFaces: DrawFace[] = [];
  boxes.forEach((b) => {
    boxFaces(b).forEach((face) => {
      const fc: Vec3 = [
        (face.pts[0][0] + face.pts[2][0]) / 2, (face.pts[0][1] + face.pts[2][1]) / 2, (face.pts[0][2] + face.pts[2][2]) / 2,
      ];
      const toEye = vnorm(vsub(eye, fc));
      if (vdot(face.normal, toEye) <= 0.02) return;
      const projected = face.pts.map(proj);
      if (projected.some((p) => !p)) return;
      const p = projected as Projected[];
      const avgZ = p.reduce((s, q) => s + q.z, 0) / p.length;
      drawFaces.push({ proj2d: p.map((q) => [q.x, q.y]), normal: face.normal, avgZ, isSide: face.key !== 'top' });
    });
  });

  const svgW = 100, svgH = 62;
  if (!drawFaces.length) {
    const fallback = isExt ? (isDusk ? '#7a5570' : '#bfe0ef') : '#4a3421';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="${WIDTH}" height="${HEIGHT}"><rect width="${svgW}" height="${svgH}" fill="${fallback}"/></svg>`;
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  drawFaces.forEach((f) => f.proj2d.forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }));
  const GROUND_Y = 50, TOP_MARGIN = 7, availW = 88, availH = GROUND_Y - TOP_MARGIN;
  const scale = Math.min(availW / Math.max(1e-3, maxX - minX), availH / Math.max(1e-3, maxY - minY)) * 0.92;
  const cxMid = (minX + maxX) / 2;
  const toScreen = ([x, y]: [number, number]): [number, number] => [50 + (x - cxMid) * scale, GROUND_Y - (y - minY) * scale];

  drawFaces.sort((a, b) => b.avgZ - a.avgZ);

  const baseRGB: [number, number, number] = [237, 239, 235]; // 白模 spec: neutral white/light-grey material
  const tint: [number, number, number] = isDusk ? [1, 0.87, 0.7] : isExt ? [0.98, 1, 1] : [1, 0.83, 0.62];
  const lightDir: Vec3 = isExt ? sunDir : vnorm([0.35, 0.75, 0.25]);
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

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="${WIDTH}" height="${HEIGHT}">
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
    ${!isExt ? `<rect x="0" y="${TOP_MARGIN - 2}" width="${svgW}" height="1" fill="#ffd7a0" opacity="${preset.params.coveIntensity ?? 0.6}"/>` : ''}
  </svg>`;
}
