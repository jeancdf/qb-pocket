/**
 * Keep every route on the field. Authored routes assume the
 * ball on the own 40; near a sideline-heavy concept or deep in
 * the red zone some points would land out of bounds, so they
 * are pulled in with a margin (routes stay the same shape
 * elsewhere).
 */

import { GOAL_Z, HALF_W, LOS_Z } from './constants';
import type { RoutePoint } from './types';

/** Stay this far inside the sideline. */
const SIDE_MARGIN = 1.6;
/** Deepest point: this far short of the end line. */
const END_MARGIN = 1.2;
const ENDZONE_DEPTH = 10;

export function fitRoute(
  route: RoutePoint[],
  losZ: number
): RoutePoint[] {
  const shift = losZ - LOS_Z;
  const maxX = HALF_W - SIDE_MARGIN;
  const maxZ = GOAL_Z + ENDZONE_DEPTH - END_MARGIN - shift;
  return route.map((p) => ({
    ...p,
    x: Math.max(-maxX, Math.min(maxX, p.x)),
    z: Math.min(maxZ, p.z)
  }));
}
