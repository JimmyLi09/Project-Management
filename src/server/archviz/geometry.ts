/* ===== Minimal 3D vector math — shared by camera sampling and the stub
   renderer's projector. No dependency, just what a weak-perspective camera
   projection needs. ===== */

export type Vec3 = [number, number, number];

export const vsub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vcross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
export const vdot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export function vnorm(a: Vec3): Vec3 {
  const l = Math.sqrt(vdot(a, a)) || 1e-6;
  return [a[0] / l, a[1] / l, a[2] / l];
}
export const lerp2 = (a: [number, number], b: [number, number], t: number): [number, number] => [
  a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t,
];
