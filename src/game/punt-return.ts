/**
 * Punt return: the player's returner fields the CPU's punt and
 * runs it back toward -z (the kicking team's end zone) while the
 * cover team pursues and tackles. Kept apart from yac.ts, which
 * is written for an offense carrier running to +z.
 */

import { BACK_GOAL_Z, HALF_W, TACKLE_RANGE } from './constants';
import { clamp, xzDist } from './math';
import type { PlayerActor } from './players';
import { interceptPoint } from './pursuit';
import type { Vec2 } from './types';

/** Fielding: the ball is at his hands. */
export const FIELD_RANGE = 1.8;
export const FIELD_HEIGHT = 2.4;
/** Deep spot the returner lines up on (yards past the LOS). */
export const RETURNER_DEPTH = 40;

const RUN = 6.2;
const SPRINT = 7.0;
const COVER_SPEED = 6.5;
const BLOCK_SPEED = 5.8;
/** Settle after the catch before anyone can tackle. */
const CATCH_BALANCE = 0.35;
const SETTLE = 1.5;
const JUKE_TIME = 0.24;
const JUKE_COOL = 0.6;
const JUKE_SPEED = 7.2;

export type ReturnEnd = 'down' | 'out' | 'td' | null;

export class PuntReturn {
  carrier: PlayerActor | null = null;
  private t = 0;
  private downT = -1;
  private jukeT = -1;
  private jukeDir = 1;
  private cool = 0;
  private end: ReturnEnd = null;

  start(returner: PlayerActor): void {
    this.carrier = returner;
    this.t = 0;
    this.downT = -1;
    this.jukeT = -1;
    this.cool = 0;
    this.end = null;
  }

  clear(): void {
    this.carrier = null;
  }

  /** Space: sidestep toward the stick side, fooling a close chaser. */
  juke(side: number, chasers: PlayerActor[]): void {
    const c = this.carrier;
    if (!c || this.downT >= 0 || this.cool > 0) {
      return;
    }
    this.jukeDir = side === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(side);
    this.jukeT = 0;
    this.cool = JUKE_COOL;
    for (const p of chasers) {
      const d = xzDist(p, c);
      if (d > 1.3 && d < 3.4 && Math.random() < 0.7) {
        p.stagger(0.7);
      }
    }
  }

  /**
   * One frame: move everyone, then say how the return ended
   * (null while it is still going).
   */
  tick(
    dt: number,
    stick: Vec2,
    sprint: boolean,
    cover: PlayerActor[],
    blockers: PlayerActor[]
  ): ReturnEnd {
    const c = this.carrier;
    if (!c) {
      return 'down';
    }
    this.t += dt;
    this.cool = Math.max(0, this.cool - dt);
    if (this.downT >= 0) {
      this.downT += dt;
      c.updateRagdoll(dt);
      for (const p of [...cover, ...blockers]) {
        p.coast(dt);
      }
      return this.downT >= SETTLE ? this.end ?? 'down' : null;
    }
    this.moveCarrier(c, dt, stick, sprint);
    for (const p of cover) {
      if (!p.isDown()) {
        p.leaveRoute();
        p.chase(interceptPoint(p, c, COVER_SPEED), dt, COVER_SPEED);
      }
    }
    for (const p of blockers) {
      const target = nearest(p, cover);
      p.leaveRoute();
      if (target) {
        // Get between the chaser and the ball.
        p.chase({ x: (target.x + c.x) / 2, z: (target.z + c.z) / 2 }, dt, BLOCK_SPEED);
      } else {
        p.coast(dt);
      }
    }
    if (c.z <= BACK_GOAL_Z) {
      return 'td';
    }
    if (Math.abs(c.x) >= HALF_W - 0.4) {
      return 'out';
    }
    if (this.t < CATCH_BALANCE) {
      return null;
    }
    for (const p of cover) {
      if (p.isDown() || p.isStaggered()) {
        continue;
      }
      if (xzDist(p, c) < TACKLE_RANGE) {
        c.startRagdoll(p);
        p.facePoint(c);
        p.lockAnim('tackle', 0.72);
        this.downT = 0;
        this.end = 'down';
        return null;
      }
    }
    return null;
  }

  private moveCarrier(
    c: PlayerActor,
    dt: number,
    stick: Vec2,
    sprint: boolean
  ): void {
    if (this.jukeT >= 0 && this.jukeT < JUKE_TIME) {
      this.jukeT += dt;
      const v = c.velocity();
      const sp = Math.hypot(v.x, v.z) || 1;
      // Sideways relative to where he is running.
      const lx = (v.z / sp) * this.jukeDir;
      const lz = (-v.x / sp) * this.jukeDir;
      c.chase({ x: c.x + lx * 3, z: c.z + lz * 3 }, dt, JUKE_SPEED);
      return;
    }
    const len = Math.hypot(stick.x, stick.z);
    const speed = sprint ? SPRINT : RUN;
    if (len < 0.2) {
      // No input: keep running upfield (toward -z).
      c.chase({ x: c.x, z: c.z - 5 }, dt, speed);
    } else {
      c.chase({
        x: c.x + (stick.x / Math.max(1, len)) * 5,
        z: c.z + (stick.z / Math.max(1, len)) * 5
      }, dt, speed);
    }
    c.x = clamp(c.x, -HALF_W + 0.35, HALF_W - 0.35);
  }
}

function nearest(p: Vec2, list: PlayerActor[]): PlayerActor | null {
  let best: PlayerActor | null = null;
  let d = 99;
  for (const q of list) {
    if (q.isDown()) {
      continue;
    }
    const n = xzDist(p, q);
    if (n < d) {
      d = n;
      best = q;
    }
  }
  return best;
}
