/* ===== Shared seeded-RNG helpers — imported by both the browser (upload
   preview state) and the server (camera sampling, stub renderer) so a given
   seed always produces the same output on either side. ===== */

/** deterministic PRNG — same seed always produces the same sequence */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* FNV-1a string hash — the same uploaded file (name+size) always derives the
   same seed, so a re-upload of the same file reproduces the same run. */
export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

export function pick<T>(rnd: () => number, arr: T[]): T {
  return arr[Math.floor(rnd() * arr.length) % arr.length];
}

export function clamp01to99(n: number): number {
  return Math.max(1, Math.min(99, Math.round(n)));
}
