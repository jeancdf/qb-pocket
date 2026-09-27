import { OPEN_YARDS, WINDOW_YARDS } from './constants';
import { distToSeg, xzDist } from './math';
import type { PlayerActor } from './players';
import type { CoverGrade } from './types';

export function gradeReceiver(
  recv: PlayerActor,
  qb: PlayerActor,
  defs: PlayerActor[]
): CoverGrade {
  let nearest = 99;
  let closing = 99;
  let lane = 99;
  const a = { x: qb.x, z: qb.z };
  // Grade the window where the route is heading, not where it was.
  const target = recv.predict(0.38);
  for (const d of defs) {
    if (!shadesRoute(d, qb)) {
      continue;
    }
    const dist = xzDist(recv, d);
    const close = xzDist(target, d);
    nearest = Math.min(nearest, dist);
    closing = Math.min(closing, close);
    lane = Math.min(lane, distToSeg(d, a, target));
  }
  if (nearest < WINDOW_YARDS ||
      closing < WINDOW_YARDS - 0.25) {
    return 'covered';
  }
  if (lane < 1.6 && closing < OPEN_YARDS + 1.2) {
    return 'window';
  }
  if (Math.min(nearest, closing) < OPEN_YARDS) {
    return 'window';
  }
  return 'open';
}

export function closestDefender(
  point: { x: number; z: number },
  defs: PlayerActor[]
): PlayerActor | null {
  let best: PlayerActor | null = null;
  let dist = 99;
  for (const d of defs) {
    const n = xzDist(point, d);
    if (n < dist) {
      dist = n;
      best = d;
    }
  }
  return best;
}

/**
 * DL, spies, and QB hunters live in the backfield. They
 * should not shade downfield receivers as if they dropped.
 */
function shadesRoute(
  d: PlayerActor,
  qb: PlayerActor
): boolean {
  if (d.def.pos === 'DL') {
    return false;
  }
  return d.z >= qb.z + 8;
}
