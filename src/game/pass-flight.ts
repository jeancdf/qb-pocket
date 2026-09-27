/**
 * The ball in the air: who breaks on it, when a receiver or a
 * defender gets to it, and what happens at contact (catch, drop,
 * breakup, pick). FootballGame turns the result into the drive.
 */

import type { Football } from './ball';
import {
  CATCH_HEIGHT_MAX,
  CATCH_HEIGHT_MIN,
  CATCH_RADIUS,
  HALF_W
} from './constants';
import { closestDefender } from './receiver-grade';
import { isCoverage } from './coverage-play';
import { isPassRusher } from './line-play';
import { xzDist } from './math';
import type { PlayerActor } from './players';
import {
  BALL_READ_DELAY,
  contest,
  TAP_POWER,
  TIP_COOLDOWN,
  type ThrowShot
} from './throwing';
import type { Vec2 } from './types';

export type FlightResult =
  | { kind: 'flying' }
  | { kind: 'tipped'; msg: string }
  | { kind: 'incomplete'; msg: string }
  | { kind: 'pick'; db: PlayerActor }
  | { kind: 'catch'; wr: PlayerActor };

const FLYING: FlightResult = { kind: 'flying' };

export class PassFlight {
  /** Where the ball is going (moves when it is tipped). */
  aim: Vec2 | null = null;
  /** The receiver breaking on the throw. */
  breaker: PlayerActor | null = null;
  shot: ThrowShot | null = null;
  private releaseSpot: Vec2 | null = null;
  private t = 0;
  private tipT = 0;
  private tipped = false;
  private closest: number | null = null;
  private wrHandsOff = false;
  private incompMsg = 'INCOMPLETE';

  clear(): void {
    this.aim = null;
    this.breaker = null;
    this.shot = null;
    this.releaseSpot = null;
    this.t = 0;
    this.tipT = 0;
    this.tipped = false;
    this.closest = null;
    this.wrHandsOff = false;
    this.incompMsg = 'INCOMPLETE';
  }

  launch(shot: ThrowShot, release: Vec2, breaker: PlayerActor | null): void {
    this.clear();
    this.shot = shot;
    this.releaseSpot = release;
    this.aim = { ...shot.landing };
    this.breaker = breaker;
  }

  /**
   * Spot the breaking receiver runs to: the called spot first,
   * then the real ball once he has read it.
   */
  breakTarget(): { to: Vec2; speed: number } | null {
    if (!this.aim) {
      return null;
    }
    const read = this.t >= BALL_READ_DELAY;
    const to = read || !this.shot ? this.aim : this.shot.intended;
    return { to, speed: read ? 6.7 : 7.65 };
  }

  tick(
    dt: number,
    ball: Football,
    eligibles: PlayerActor[],
    players: PlayerActor[],
    qb: PlayerActor
  ): FlightResult {
    this.t += dt;
    if (Math.abs(ball.pos.x) > HALF_W + 0.2) {
      return { kind: 'incomplete', msg: 'OUT OF BOUNDS' };
    }
    if (!ball.inAir) {
      return { kind: 'incomplete', msg: this.incompMsg };
    }
    if (this.tipT > 0) {
      this.tipT -= dt;
      return FLYING;
    }
    if (ball.pos.y < CATCH_HEIGHT_MIN || ball.pos.y > CATCH_HEIGHT_MAX) {
      return FLYING;
    }
    const wr = this.catchWindow(ball, eligibles, qb);
    const db = this.ballHawk(ball, players);
    const toWr = wr ? xzDist(wr, ball.pos) : null;
    const toDb = db ? xzDist(db, ball.pos) : null;
    if (!this.atClosest(ball, toWr, toDb)) {
      return FLYING;
    }
    const outcome = contest({
      ballSpeed: ball.vel.length(),
      wrDist: toWr,
      dbDist: toDb,
      sep: wr && db ? xzDist(wr, db) : 99,
      power: this.shot?.power ?? TAP_POWER,
      tipped: this.tipped
    });
    if (!outcome) {
      return FLYING;
    }
    if (outcome === 'pick' && db) {
      return { kind: 'pick', db };
    }
    if (outcome === 'breakup') {
      this.tip(ball, 3.4, 'BROKEN UP');
      db?.lockAnim('catch', 0.3);
      return { kind: 'tipped', msg: 'BROKEN UP' };
    }
    if (outcome === 'drop') {
      this.wrHandsOff = true;
      this.tip(ball, 1.8, 'DROPPED');
      wr?.lockAnim('stumble', 0.5);
      return { kind: 'tipped', msg: 'DROPPED' };
    }
    return wr ? { kind: 'catch', wr } : FLYING;
  }

  /**
   * Resolve at the moment of contact, not at the edge of the
   * catch radius: wait until the ball is in the hands, or has
   * stopped getting closer, or is about to hit the grass.
   */
  private atClosest(
    ball: Football,
    toWr: number | null,
    toDb: number | null
  ): boolean {
    const near = Math.min(toWr ?? 99, toDb ?? 99);
    if (near > CATCH_RADIUS) {
      this.closest = null;
      return false;
    }
    const landing = ball.vel.y < 0 &&
      ball.pos.y < CATCH_HEIGHT_MIN + 0.3;
    const passing = this.closest !== null && near > this.closest + 0.01;
    this.closest = near;
    return near <= 0.8 || passing || landing;
  }

  private catchWindow(
    ball: Football,
    eligibles: PlayerActor[],
    qb: PlayerActor
  ): PlayerActor | null {
    if (this.wrHandsOff) {
      return null;
    }
    if (!this.tipped && this.aim && xzDist(ball.pos, this.aim) > 3.4) {
      return null;
    }
    let best: PlayerActor | null = null;
    let dist = CATCH_RADIUS;
    for (const p of eligibles) {
      if (p === qb) {
        continue;
      }
      const n = xzDist(p, ball.pos);
      if (n <= dist) {
        dist = n;
        best = p;
      }
    }
    return best;
  }

  /** Coverage defender at the ball (can undercut anywhere). */
  private ballHawk(
    ball: Football,
    players: PlayerActor[]
  ): PlayerActor | null {
    const from = this.releaseSpot;
    if (from && xzDist(ball.pos, from) < 3) {
      return null;
    }
    const cover = players.filter((p) =>
      isCoverage(p.def.pos) && !isPassRusher(p.def.id)
    );
    const db = closestDefender(ball.pos, cover);
    if (!db || xzDist(db, ball.pos) > 1.35) {
      return null;
    }
    return db;
  }

  /** Ball pops off hands: it stays live but wild. */
  private tip(ball: Football, up: number, msg: string): void {
    const v = ball.vel;
    v.x = v.x * -0.2 + (Math.random() - 0.5) * 3;
    v.z = v.z * 0.15 + (Math.random() - 0.5) * 3;
    v.y = up + Math.random() * 1.2;
    this.tipped = true;
    this.closest = null;
    this.tipT = TIP_COOLDOWN;
    this.incompMsg = msg;
    this.aim = { x: ball.pos.x, z: ball.pos.z };
  }
}
