/**
 * Where everyone's eyes go, once per frame after every pose is set:
 * the whole field watches a ball in the air; after the catch the
 * defense (and the blockers) track the ball carrier; before the throw
 * defenders read the QB and receivers look for the ball once their
 * route is run. Players near an incoming ball put their hands up to
 * it. Also feeds the rush pressure to the QB's feet.
 */
import * as THREE from 'three';
import type { Football } from './ball';
import type { PlayerActor } from './players';

export interface CrowdView {
  players: PlayerActor[];
  ball: Football;
  qb: PlayerActor;
  /** Ball carrier after the catch or handoff, if any. */
  carrier: PlayerActor | null;
  /** Snap to whistle, before the ball is thrown or handed off. */
  live: boolean;
  /** 0–1 how close the rush is to the QB. */
  pressure: number;
}

const HEAD_Y = 1.7;

export function animateCrowd(v: CrowdView, dt: number): void {
  v.qb.setPressure(v.live && !v.carrier ? v.pressure : 0);
  const qbHead = new THREE.Vector3(v.qb.x, HEAD_Y, v.qb.z);
  const carrier = v.carrier
    ? new THREE.Vector3(v.carrier.x, HEAD_Y - 0.3, v.carrier.z)
    : null;
  for (const p of v.players) {
    p.watch(target(p, v, qbHead, carrier), dt);
    p.reach(catching(p, v) ? v.ball.pos : null, dt);
  }
}

/** Skill players (not the passer) put their hands up for a ball in the air. */
function catching(p: PlayerActor, v: CrowdView): boolean {
  if (!v.ball.inAir || p === v.qb) {
    return false;
  }
  const pos = p.def.pos;
  if (pos === 'OL' || pos === 'DL') {
    return false;
  }
  // Only a ball still coming toward him.
  const dx = p.x - v.ball.pos.x;
  const dz = p.z - v.ball.pos.z;
  return dx * v.ball.vel.x + dz * v.ball.vel.z > 0;
}

function target(
  p: PlayerActor,
  v: CrowdView,
  qbHead: THREE.Vector3,
  carrier: THREE.Vector3 | null
): THREE.Vector3 | null {
  if (v.ball.inAir) {
    return v.ball.pos;
  }
  if (carrier) {
    return p === v.carrier ? null : carrier;
  }
  if (!v.live || p === v.qb) {
    return null;
  }
  const pos = p.def.pos;
  if (p.def.side === 'defense') {
    return pos === 'DL' ? null : qbHead;
  }
  if (pos === 'OL') {
    return null;
  }
  // Receivers run with their eyes upfield, then find the QB.
  return p.routeDone() ? qbHead : null;
}
