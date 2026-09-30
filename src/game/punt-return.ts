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
/** Cover team once the ball is fielded, and while it hangs. */
const COVER_SPEED = 6.0;
const GUNNER_HANG = 5.4;
const LINE_HANG = 4.4;
/** Return team: sprint to their man, then stay on him. */
const BLOCK_SPEED = 6.4;
const ENGAGE = 1.3;
/** Blocker sits this far in front of his man, on the ball side. */
const BLOCK_GAP = 1.0;
/** Held: the cover man only inches toward the ball... */
const HELD_SPEED = 1.1;
/** ...and gets pushed away from it sideways (the wall). */
const SEAL_PUSH = 0.9;
/** How long a block holds, then he sheds; re-engage after a beat. */
const SHED_MIN = 1.8;
const SHED_MAX = 3.6;
const REENGAGE = 1.0;
/** Settle after the catch before anyone can tackle. */
const CATCH_BALANCE = 0.35;
const SETTLE = 1.5;
const JUKE_TIME = 0.24;
const JUKE_COOL = 0.6;
const JUKE_SPEED = 7.2;

export type ReturnEnd = 'down' | 'out' | 'td' | null;

interface Block {
  man: PlayerActor;
  locked: boolean;
  t: number;
  shedAt: number;
  /** Time left before he may re-engage after a shed. */
  wait: number;
}

export class PuntReturn {
  carrier: PlayerActor | null = null;
  private t = 0;
  private downT = -1;
  private jukeT = -1;
  private jukeDir = 1;
  private cool = 0;
  private end: ReturnEnd = null;
  /** Return team: each blocker and the cover man he has. */
  private readonly blocks = new Map<PlayerActor, Block>();

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
    this.blocks.clear();
  }

  /**
   * Ball in the air: the cover team runs down (gunners first,
   * the line slower) and the return team picks them up and
   * blocks, sealing them away from the landing spot.
   */
  hang(
    dt: number,
    landing: Vec2,
    cover: PlayerActor[],
    blockers: PlayerActor[]
  ): void {
    for (const p of cover) {
      if (this.held(p) || p.isDown()) {
        continue;
      }
      const line = p.def.pos === 'OL' || p.def.pos === 'QB';
      p.leaveRoute();
      p.chase(landing, dt, line ? LINE_HANG : GUNNER_HANG);
    }
    this.block(dt, landing, cover, blockers);
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
    sprint: number,
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
      if (!p.isDown() && !this.held(p)) {
        p.leaveRoute();
        p.chase(interceptPoint(p, c, COVER_SPEED), dt, COVER_SPEED);
      }
    }
    this.block(dt, c, cover, blockers);
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
      if (p.isDown() || p.isStaggered() || this.held(p)) {
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

  /** Cover man currently locked up by a blocker. */
  private held(p: PlayerActor): boolean {
    for (const b of this.blocks.values()) {
      if (b.man === p && b.locked) {
        return true;
      }
    }
    return false;
  }

  /**
   * Every blocker takes a man (nearest one nobody has), gets in
   * front of him on the ball side and, once engaged, holds him:
   * he barely gains toward the ball and gets shoved sideways,
   * away from it, which opens a lane. Each block holds a couple
   * of seconds, then he sheds; the blocker re-engages if he can.
   */
  private block(
    dt: number,
    ball: Vec2,
    cover: PlayerActor[],
    blockers: PlayerActor[]
  ): void {
    this.assign(cover, blockers);
    for (const b of blockers) {
      const blk = this.blocks.get(b);
      if (!blk || blk.man.isDown()) {
        b.leaveRoute();
        b.coast(dt);
        continue;
      }
      const m = blk.man;
      const dx = ball.x - m.x;
      const dz = ball.z - m.z;
      const d = Math.hypot(dx, dz) || 1;
      const ux = dx / d;
      const uz = dz / d;
      const front = { x: m.x + ux * BLOCK_GAP, z: m.z + uz * BLOCK_GAP };
      blk.wait = Math.max(0, blk.wait - dt);
      if (!blk.locked) {
        b.leaveRoute();
        b.chase(front, dt, BLOCK_SPEED);
        if (blk.wait <= 0 && xzDist(b, m) < ENGAGE) {
          blk.locked = true;
          blk.t = 0;
          blk.shedAt = SHED_MIN + Math.random() * (SHED_MAX - SHED_MIN);
        }
        continue;
      }
      blk.t += dt;
      if (blk.t >= blk.shedAt) {
        blk.locked = false;
        blk.wait = REENGAGE;
        continue;
      }
      // Held: a crawl toward the ball, shoved off the ball's line.
      const side = Math.sign(m.x - ball.x) || (m.x >= 0 ? 1 : -1);
      m.leaveRoute();
      m.chase({
        x: m.x + ux * HELD_SPEED + side * SEAL_PUSH,
        z: m.z + uz * HELD_SPEED
      }, dt, HELD_SPEED + SEAL_PUSH);
      b.x = m.x + ux * BLOCK_GAP;
      b.z = m.z + uz * BLOCK_GAP;
      b.facePoint(m);
      m.facePoint(b);
      b.setAnim('engage', blk.t, 2);
      m.setAnim('engage', blk.t, 2);
      b.place();
    }
  }

  /** Give each free blocker the nearest cover man nobody has. */
  private assign(cover: PlayerActor[], blockers: PlayerActor[]): void {
    const taken = new Set<PlayerActor>();
    for (const [b, blk] of this.blocks) {
      if (!blockers.includes(b) || blk.man.isDown()) {
        this.blocks.delete(b);
      } else {
        taken.add(blk.man);
      }
    }
    for (const b of blockers) {
      if (this.blocks.has(b)) {
        continue;
      }
      const free = cover.filter((m) => !taken.has(m) && !m.isDown());
      const man = nearest(b, free);
      if (man) {
        taken.add(man);
        this.blocks.set(b, { man, locked: false, t: 0, shedAt: 0, wait: 0 });
      }
    }
  }

  private moveCarrier(
    c: PlayerActor,
    dt: number,
    stick: Vec2,
    sprint: number
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
    const speed = RUN * sprint;
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
