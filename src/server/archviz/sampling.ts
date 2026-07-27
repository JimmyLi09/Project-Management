/* ===== Server-authoritative camera turntable sampling =====
   Port of the client-side algorithm validated in the Phase-1 design draft
   (Handbook §6 / v2 §4.3: turntable azimuth spread + eye/hero/overview
   elevation bands + focal variety). Runs once per analysis run, seeded so
   the same model always samples the same camera set. */

import type { ShotCamera } from '@/lib/archviz/types';
import { pick } from '@/lib/archviz/rng';

export function sampleCameras(rnd: () => number, cameraCount: number, mainHeight: number): ShotCamera[] {
  const cameras: ShotCamera[] = [];
  for (let i = 0; i < cameraCount; i++) {
    const azimuth = Math.round((360 / cameraCount) * i + rnd() * 14 - 7);
    const radius = mainHeight * 1.5 + rnd() * mainHeight * 1.7 + 7;
    const elevFrac = pick(rnd, [0.16, 0.16, 0.16, 0.55, 1.5]); // eye-height / hero / overview
    const camY = Math.max(1.4, mainHeight * elevFrac);
    const rad = (azimuth * Math.PI) / 180;
    cameras.push({
      position: [Math.round(Math.cos(rad) * radius * 10) / 10, Math.round(camY * 10) / 10, Math.round(Math.sin(rad) * radius * 10) / 10],
      target: [0, Math.round(mainHeight * 0.4 * 10) / 10, 0],
      up: [0, 1, 0],
      fovMm: pick(rnd, [24, 28, 35, 50]),
    });
  }
  return cameras;
}
