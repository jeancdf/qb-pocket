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
  GRAVITY,
  HALF_W
} from './constants';
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
  | { kind: 'catch'; wr: PlayerActor; dive: boolean };

const FLYING: FlightResult = { kind: 'flying' };

/** A defender plays the ball inside this without leaving his feet. */
const DB_REACH = 1.35;
/** Layout reach (yd) from where the dive starts. */
const WR_DIVE_REACH = 3.1;
const DB_DIVE_REACH = 2.4;
/** A leap adds this much height to the catch window. */
const LEAP_HEIGHT = 0.75;
/** How far ahead a player reads the ball before committing. */
const DIVE_LOOK = 0.34;
/** Seconds of flight, then of slide, in a layout. */
const DIVE_AIR = 0.32;
const DIVE_TOTAL = 0.95;
const LEAP_TOTAL = 0.6;

interface Dive {
  kind: 'dive' | 'leap';
  t: number;
  to: Vec2;
  vx: number;
  vz: number;
  dir: number;
}

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
  private readonly divers = new Map<PlayerActor, Dive>();

  clear(): void {
    this.divers.clear();
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
    this.planDives(ball, eligibles, players, qb);
    const leaping = [...this.divers.values()].some((d) => d.kind === 'leap');
    const top = CATCH_HEIGHT_MAX + (leaping ? LEAP_HEIGHT : 0);
    if (ball.pos.y < CATCH_HEIGHT_MIN || ball.pos.y > top) {
      return FLYING;
    }
    const wr = this.catchWindow(ball, eligibles, qb);
    const db = this.ballHawk(ball, players);
    // Distances normalised to a standing reach, so a stretched
    // player at the tip of his layout counts as "at the edge".
    const toWr = wr
      ? xzDist(wr, ball.pos) * (CATCH_RADIUS / this.reach(wr, ball, true))
      : null;
    const toDb = db
      ? xzDist(db, ball.pos) * (DB_REACH / this.reach(db, ball, false))
      : null;
    if (!this.atClosest(ball, toWr, toDb)) {
      return FLYING;
    }
    const wrDive = wr ? this.divers.get(wr)?.kind === 'dive' : false;
    const outcome = contest({
      ballSpeed: ball.vel.length(),
      wrDist: toWr,
      dbDist: toDb,
      sep: wr && db ? xzDist(wr, db) : 99,
      power: this.shot?.power ?? TAP_POWER,
      tipped: this.tipped,
      wrStretch: wr ? this.divers.has(wr) : false,
      dbStretch: db ? this.divers.has(db) : false
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
    return wr ? { kind: 'catch', wr, dive: wrDive } : FLYING;
  }

  isDiving(p: PlayerActor): boolean {
    return this.divers.has(p);
  }

  /** Scripted layout / leap; game.ts hands the diver over here. */
  moveDiver(p: PlayerActor, dt: number): void {
    const d = this.divers.get(p);
    if (!d) {
      return;
    }
    d.t += dt;
    const face = Math.atan2(d.to.x - p.x, d.to.z - p.z);
    if (d.kind === 'leap') {
      const u = d.t / LEAP_TOTAL;
      const k = u < 0.5 ? 1 : 0.3;
      p.footwork(d.vx * k, d.vz * k, dt, face, 'leap', u, d.dir);
      if (d.t >= LEAP_TOTAL) {
        this.divers.delete(p);
      }
      return;
    }
    const u = Math.min(1, d.t / DIVE_TOTAL);
    // Full speed through the air, then belly slide to a stop.
    const k = d.t < DIVE_AIR
      ? 1
      : Math.max(0, 1 - (d.t - DIVE_AIR) / (DIVE_TOTAL - DIVE_AIR)) * 0.5;
    p.footwork(d.vx * k, d.vz * k, dt, p.facing, 'dive', u, d.dir);
    if (d.t >= DIVE_TOTAL + 0.6) {
      this.divers.delete(p);
    }
  }

  /** Reach from where he stands, given his dive or leap. */
  private reach(p: PlayerActor, ball: Football, wr: boolean): number {
    const d = this.divers.get(p);
    const stand = wr ? CATCH_RADIUS : DB_REACH;
    const overhead = ball.pos.y > CATCH_HEIGHT_MAX;
    if (!d || d.t < 0.08) {
      return overhead ? 0 : stand;
    }
    if (d.kind === 'leap') {
      return overhead ? stand * 0.8 : stand;
    }
    if (overhead) {
      return 0;
    }
    return wr ? WR_DIVE_REACH : DB_DIVE_REACH;
  }

  /**
   * Read the ball over the next beat. When it will pass just
   * out of reach, lay out for it; when it is over his head,
   * go up for it. Commit late, like a real player.
   */
  private planDives(
    ball: Football,
    eligibles: PlayerActor[],
    players: PlayerActor[],
    qb: PlayerActor
  ): void {
    if (ball.vel.y > 2) {
      return;
    }
    const wrs = this.wrHandsOff
      ? []
      : eligibles.filter((p) => p !== qb && xzDist(p, ball.pos) < 9);
    const dbs = players.filter((p) =>
      isCoverage(p.def.pos) && !isPassRusher(p.def.id) &&
      xzDist(p, ball.pos) < 9
    );
    for (const p of [...wrs, ...dbs]) {
      if (this.divers.has(p) || p.isDown()) {
        continue;
      }
      this.planOne(p, ball, wrs.includes(p));
    }
  }

  private planOne(p: PlayerActor, ball: Football, wr: boolean): void {
    const stand = wr ? CATCH_RADIUS : DB_REACH;
    const far = wr ? WR_DIVE_REACH : DB_DIVE_REACH;
    let best: { t: number; d: number; y: number; x: number; z: number } | null = null;
    for (let t = 0.02; t <= DIVE_LOOK; t += 0.02) {
      const y = ball.pos.y + ball.vel.y * t - 0.5 * GRAVITY * t * t;
      if (y < CATCH_HEIGHT_MIN) {
        break;
      }
      if (y > CATCH_HEIGHT_MAX + LEAP_HEIGHT) {
        continue;
      }
      const x = ball.pos.x + ball.vel.x * t;
      const z = ball.pos.z + ball.vel.z * t;
      const d = Math.hypot(x - p.x, z - p.z);
      if (!best || d < best.d) {
        best = { t, d, y, x, z };
      }
    }
    if (!best) {
      return;
    }
    const high = best.y > CATCH_HEIGHT_MAX - 0.15;
    if (high && best.d <= stand) {
      this.start(p, 'leap', best, 0.26);
      return;
    }
    // Commit only in the last beat, and only when standing
    // reach will not get there but a layout will.
    if (best.d > stand && best.d <= far && best.t <= 0.26 && !high) {
      this.start(p, 'dive', best, DIVE_AIR);
    }
  }

  private start(
    p: PlayerActor,
    kind: 'dive' | 'leap',
    at: { t: number; x: number; z: number },
    reachTime: number
  ): void {
    const dx = at.x - p.x;
    const dz = at.z - p.z;
    const len = Math.max(0.01, Math.hypot(dx, dz));
    // Launch so the hands arrive about when the ball does.
    const need = kind === 'dive' ? Math.max(0, len - 0.6) : len * 0.6;
    const speed = Math.min(kind === 'dive' ? 8.5 : 4, need / Math.max(at.t, reachTime));
    const side = (dx * Math.cos(p.facing) - dz * Math.sin(p.facing));
    this.divers.set(p, {
      kind,
      t: 0,
      to: { x: at.x, z: at.z },
      vx: (dx / len) * speed,
      vz: (dz / len) * speed,
      dir: side >= 0 ? 1 : -1
    });
    if (kind === 'dive') {
      p.facePoint({ x: at.x, z: at.z });
    }
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
    const edge = Math.min(
      toWr === null ? 99 : toWr - CATCH_RADIUS,
      toDb === null ? 99 : toDb - DB_REACH
    );
    if (edge > 0) {
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
    let slack = 0;
    for (const p of eligibles) {
      if (p === qb) {
        continue;
      }
      const n = this.reach(p, ball, true) - xzDist(p, ball.pos);
      if (n >= slack) {
        slack = n;
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
    let best: PlayerActor | null = null;
    let slack = 0;
    for (const p of cover) {
      const n = this.reach(p, ball, false) - xzDist(p, ball.pos);
      if (n >= slack) {
        slack = n;
        best = p;
      }
    }
    return best;
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
