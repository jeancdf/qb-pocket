import type { Vec2 } from './types';

export function xzDist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Wrap a signed angle into (-π, π]. */
export function wrapPi(a: number): number {
  let d = a;
  while (d > Math.PI) {
    d -= Math.PI * 2;
  }
  while (d < -Math.PI) {
    d += Math.PI * 2;
  }
  return d;
}

/** Turn `from` toward `to` by at most `maxDelta` radians. */
export function headingLerp(
  from: number,
  to: number,
  maxDelta: number
): number {
  const err = wrapPi(to - from);
  return from + clamp(err, -maxDelta, maxDelta);
}

/** Distance from point P to segment AB in XZ. */
export function distToSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  if (len2 < 1e-6) {
    return xzDist(p, a);
  }
  let t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
}
