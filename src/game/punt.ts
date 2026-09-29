/**
 * Fourth down: the punt. Where it comes down, how long it
 * hangs, the return, and when a team punts at all. game.ts
 * snaps it, kicks the ball on the arc and moves the players.
 */

import { GOAL_Z, HALF_W } from './constants';
import type { Vec2 } from './types';

/** Punter depth behind the line of scrimmage. */
export const PUNTER_DEPTH = 13;
/** Snap to boot. */
export const PUNT_KICK_T = 0.85;

export interface PuntPlan {
  landing: Vec2;
  hang: number;
  touchback: boolean;
  returnYds: number;
}

export function planPunt(losZ: number): PuntPlan {
  const gross = 38 + Math.random() * 12;
  const x = (Math.random() - 0.5) * 16;
  const z = losZ + gross;
  const touchback = z >= GOAL_Z;
  return {
    landing: {
      x: Math.max(-HALF_W + 3, Math.min(HALF_W - 3, x)),
      z: touchback ? GOAL_Z + 4 : z
    },
    hang: 3.9 + Math.random() * 0.7,
    touchback,
    returnYds: touchback ? 0 : Math.random() * 9
  };
}

/**
 * Where the receiving team takes over, in the kicking team's
 * frame (the match mirrors it): the 20 on a touchback.
 */
export function puntEndZ(plan: PuntPlan): number {
  return plan.touchback
    ? GOAL_Z - 20
    : plan.landing.z - plan.returnYds;
}

/** CPU fourth-down call: go for it when short past midfield. */
export function cpuPunts(toGo: number, losZ: number): boolean {
  if (losZ >= 15) {
    return false;
  }
  return !(toGo <= 2 && losZ > -10);
}
