/**
 * Pursuit angles. A chaser runs to where the runner will be,
 * not where he is: solve for the earliest meeting point given
 * the runner's current velocity and the chaser's top speed.
 */

import type { PlayerActor } from './players';
import type { Vec2 } from './types';

/** Never lead further than this: runners cut, so stay honest. */
const MAX_LEAD = 1.4;

export function interceptPoint(
  chaser: Vec2,
  runner: PlayerActor,
  speed: number,
  maxLead = MAX_LEAD
): Vec2 {
  const v = runner.velocity();
  const rx = runner.x - chaser.x;
  const rz = runner.z - chaser.z;
  // |r + v t| = s t  →  (v·v − s²) t² + 2 (r·v) t + r·r = 0
  const a = v.x * v.x + v.z * v.z - speed * speed;
  const b = 2 * (rx * v.x + rz * v.z);
  const c = rx * rx + rz * rz;
  let t = maxLead;
  if (Math.abs(a) < 1e-6) {
    if (Math.abs(b) > 1e-6) {
      t = -c / b;
    }
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t1 = (-b - sq) / (2 * a);
      const t2 = (-b + sq) / (2 * a);
      const hits = [t1, t2].filter((n) => n > 0);
      if (hits.length) {
        t = Math.min(...hits);
      }
    }
  }
  t = Math.max(0, Math.min(t, maxLead));
  return { x: runner.x + v.x * t, z: runner.z + v.z * t };
}
