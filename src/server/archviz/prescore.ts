/* ===== Stage 1: real local pre-scoring (Handbook §4 Stage 1) =====
   Genuinely computed from pixels via `sharp` — not fabricated. Simplified
   vs. the Handbook's full pre_score formula: no CLIP reference-similarity
   (needs a reference library + pgvector — explicitly descoped, see plan's
   Priority-3 note), so weights are redistributed across the metrics that
   ARE real here. */

import sharp from 'sharp';

export interface PreScoreResult {
  blurScore: number; // higher = sharper (unbounded, relative ranking within a run)
  exposureScore: number; // 0-100, 100 = ideal mid-tone exposure
  dupHash: string; // 64-bit average-hash, hex
}

export async function computePreScore(imageBuffer: Buffer): Promise<PreScoreResult> {
  const grey = sharp(imageBuffer).greyscale();

  // sharpness: edge energy via a Laplacian-like kernel, then the stdev of
  // the edge map — a standard blur-detection proxy (higher stdev = crisper
  // edges = less blur).
  const edgeStats = await grey.clone()
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] })
    .stats();
  const blurScore = edgeStats.channels[0].stdev;

  // exposure: how close the mean luminance is to a well-exposed mid-tone.
  const lumaStats = await grey.clone().stats();
  const mean = lumaStats.channels[0].mean; // 0-255
  const exposureScore = Math.max(0, 100 - (Math.abs(mean - 128) / 128) * 100);

  // duplicate/diversity: 8x8 average-hash — frames with a small Hamming
  // distance are near-duplicates (same angle, negligible difference).
  const small = await grey.clone().resize(8, 8, { fit: 'fill' }).raw().toBuffer();
  const avg = small.reduce((s, v) => s + v, 0) / small.length;
  let hashBits = '';
  for (const v of small) hashBits += v >= avg ? '1' : '0';
  const dupHash = BigInt('0b' + hashBits).toString(16).padStart(16, '0');

  return { blurScore, exposureScore, dupHash };
}

export function hammingDistanceHex(a: string, b: string): number {
  const x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let n = x, count = 0;
  while (n > 0n) { count += Number(n & 1n); n >>= 1n; }
  return count;
}
