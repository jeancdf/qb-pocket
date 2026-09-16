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
  let lane = 99;
  const a = { x: qb.x, z: qb.z };
  const b = { x: recv.x, z: recv.z };
  for (const d of defs) {
    const dist = xzDist(recv, d);
    if (dist < nearest) {
      nearest = dist;
    }
    const mid = distToSeg(d, a, b);
    if (mid < lane) {
      lane = mid;
    }
  }
  if (nearest < WINDOW_YARDS) {
    return 'covered';
  }
  if (lane < 1.6 && nearest < OPEN_YARDS + 1.5) {
    return 'window';
  }
  if (nearest < OPEN_YARDS) {
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
