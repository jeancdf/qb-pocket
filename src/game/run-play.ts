/**
 * Run plays: the QB's path for the called play and the moment
 * of the handoff. After the handoff the RB is an ordinary ball
 * carrier (yac.ts) and the line run-blocks (line-play.ts).
 */

import { xzDist } from './math';
import { SMASH } from './playbook';
import type { PlayerActor } from './players';
import type { OffPlay } from './plays';
import type { RoutePoint, Vec2 } from './types';

const QB_DEF = SMASH.find((d) => d.id === 'qb');
/** Gun alignment and drop (copied: the actor's def gets edited). */
export const QB_START: Vec2 = { ...(QB_DEF?.start ?? { x: 0, z: 0 }) };
const QB_DROP: RoutePoint[] = (QB_DEF?.route ?? []).map((p) => ({ ...p }));

/** Mesh: close enough to put the ball in his belly. */
const MESH_RANGE = 1.3;
const MESH_EARLIEST = 0.2;
/** Never later than this: the RB takes it wherever he is. */
const MESH_LATEST = 1.4;

export function qbPath(play: OffPlay): RoutePoint[] {
  return (play.qb ?? QB_DROP).map((p) => ({ ...p }));
}

/** Seconds after the snap → has the RB got the ball yet? */
export function handoffReady(
  t: number,
  qb: PlayerActor,
  rb: PlayerActor
): boolean {
  if (t < MESH_EARLIEST) {
    return false;
  }
  return t >= MESH_LATEST || xzDist(qb, rb) < MESH_RANGE;
}
