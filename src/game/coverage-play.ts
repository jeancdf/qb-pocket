/**
 * Coverage AI: DBs and remaining LBs run the jobs of the called
 * look (see coverage-looks.ts), zone or man. 1–2 DL/LB rushers
 * are owned by LinePlay so they chase the QB instead of dropping.
 *
 * Smash vs Cover 3:
 * - CBs bail deep thirds (hitch is open underneath).
 * - SS sits the slot to ~12, then passes the corner.
 * - FS takes the deepest middle.
 * - SAM/WILL carry TE / RB flats. Mike rushes or spies.
 * On the throw they break to the landing spot.
 */

import { LOS_Z } from './constants';
import {
  COVER3,
  type CoverLook,
  type Job,
  type ZoneId
} from './coverage-looks';
import { isPassRusher } from './line-play';
import { clamp, lerp, xzDist } from './math';
import type { PlayerActor } from './players';
import { interceptPoint } from './pursuit';
import type { EyeRead, QbEyes } from './qb-eyes';
import type { Pos, Vec2 } from './types';

interface Zone {
  centerX: number;
  depth: number;
  minX: number;
  maxX: number;
  lateralCost: number;
  depthCost: number;
  verticalValue: number;
  deep: boolean;
}

const SWITCH_MARGIN = 1.4;
const RECEIVER_IDS = ['wrX', 'wrH', 'wrZ', 'te', 'rb'];

/**
 * Match landmarks value future route position, not just current alignment.
 * Deep zones reward vertical threats while underneath zones pass crossers.
 */
const ZONES: Record<ZoneId, Zone> = {
  deepLeft: {
    centerX: -16,
    depth: 22,
    minX: -26,
    maxX: -5,
    lateralCost: 0.65,
    depthCost: 0.08,
    verticalValue: 0.32,
    deep: true
  },
  deepMiddle: {
    centerX: 0,
    depth: 24,
    minX: -9,
    maxX: 9,
    lateralCost: 0.75,
    depthCost: 0.08,
    verticalValue: 0.36,
    deep: true
  },
  deepRight: {
    centerX: 16,
    depth: 22,
    minX: 5,
    maxX: 26,
    lateralCost: 0.65,
    depthCost: 0.08,
    verticalValue: 0.32,
    deep: true
  },
  leftHalf: {
    centerX: -12,
    depth: 22,
    minX: -26,
    maxX: 0,
    lateralCost: 0.38,
    depthCost: 0.08,
    verticalValue: 0.36,
    deep: true
  },
  rightHalf: {
    centerX: 12,
    depth: 22,
    minX: 0,
    maxX: 26,
    lateralCost: 0.38,
    depthCost: 0.08,
    verticalValue: 0.36,
    deep: true
  },
  leftFlat: {
    centerX: -17,
    depth: 6,
    minX: -26,
    maxX: -4,
    lateralCost: 0.48,
    depthCost: 0.42,
    verticalValue: 0,
    deep: false
  },
  leftHook: {
    centerX: -7,
    depth: 9,
    minX: -15,
    maxX: 0,
    lateralCost: 0.58,
    depthCost: 0.4,
    verticalValue: 0,
    deep: false
  },
  middleHook: {
    centerX: 0,
    depth: 9,
    minX: -8,
    maxX: 8,
    lateralCost: 0.64,
    depthCost: 0.4,
    verticalValue: 0,
    deep: false
  },
  rightHook: {
    centerX: 7,
    depth: 9,
    minX: 0,
    maxX: 15,
    lateralCost: 0.58,
    depthCost: 0.4,
    verticalValue: 0,
    deep: false
  },
  rightFlat: {
    centerX: 17,
    depth: 6,
    minX: 4,
    maxX: 26,
    lateralCost: 0.48,
    depthCost: 0.42,
    verticalValue: 0,
    deep: false
  },
  quarterLeft: quarter(-18, -26, -9),
  quarterMidLeft: quarter(-6, -14, 2),
  quarterMidRight: quarter(6, -2, 14),
  quarterRight: quarter(18, 9, 26)
};

/** Cover 4: four deep quarters that match vertical threats. */
function quarter(centerX: number, minX: number, maxX: number): Zone {
  return {
    centerX,
    depth: 18,
    minX,
    maxX,
    lateralCost: 0.7,
    depthCost: 0.1,
    verticalValue: 0.3,
    deep: true
  };
}

export function isCoverage(pos: Pos): boolean {
  return pos === 'CB' || pos === 'S' || pos === 'LB';
}

/** Eye-read weight when a job does not set its own. */
function readsOf(job: Job, db: PlayerActor): number {
  if (job.reads !== undefined) {
    return job.reads;
  }
  if (job.kind === 'man') {
    return 0;
  }
  if (db.def.pos === 'S') {
    return 0.75;
  }
  if (db.def.pos === 'LB') {
    return 0.55;
  }
  return 0.3;
}

/** Everyone in coverage runs a touch faster than authored. */
const COVER_SPEED_SCALE = 1.05;
const PA_BITE = 0.75;
const PA_FREEZE = 0.45;

export class CoverPlay {
  private readonly byId: Map<string, PlayerActor>;
  private readonly matches = new Map<string, string>();
  private readonly eyes?: QbEyes;
  private losZ = LOS_Z;
  private jobs: Job[] = COVER3.jobs;
  private snapT = 0;
  private playAction = false;
  private throwT = 0;
  private throwRead: EyeRead = 'neutral';
  private targetId: string | null = null;
  /** Defender the player runs himself: the AI leaves him alone. */
  private userId: string | null = null;

  constructor(byId: Map<string, PlayerActor>, eyes?: QbEyes) {
    this.byId = byId;
    this.eyes = eyes;
  }

  /** Called on the snap: clears the throw read, arms play-action. */
  startSnap(playAction: boolean): void {
    this.snapT = 0;
    this.playAction = playAction;
    this.throwT = 0;
    this.throwRead = 'neutral';
    this.targetId = null;
  }

  /**
   * Ball is out. The eyes decide how early the defense breaks:
   * staring the target lets them jump it, a look-off freezes them.
   */
  onThrow(targetId: string | null): void {
    this.throwT = 0;
    this.targetId = targetId;
    this.throwRead = this.eyes?.readOn(targetId) ?? 'neutral';
  }

  lastRead(): EyeRead {
    return this.throwRead;
  }

  jobOf(id: string): Job | undefined {
    return this.jobs.find((j) => j.id === id);
  }

  setLos(z: number): void {
    this.losZ = z;
  }

  setUser(id: string | null): void {
    this.userId = id;
  }

  setLook(look: CoverLook): void {
    this.jobs = look.jobs;
    this.matches.clear();
  }

  /** Zone-match while the ball is still in the QB's hands. */
  cover(dt: number): void {
    this.snapT += dt;
    for (const job of this.jobs) {
      if (isPassRusher(job.id) || job.id === this.userId) {
        continue;
      }
      const db = this.byId.get(job.id);
      if (!db) {
        continue;
      }
      this.matchRoute(db, job, dt, 1);
    }
  }

  /**
   * Nearby zone players break on the throw. Deep defenders preserve the
   * shell against short throws instead of unrealistically swarming downhill.
   */
  breakOn(
    dt: number,
    spot: Vec2,
    busy?: (p: PlayerActor) => boolean
  ): void {
    this.throwT += dt;
    for (const job of this.jobs) {
      if (isPassRusher(job.id) || job.id === this.userId) {
        continue;
      }
      const db = this.byId.get(job.id);
      if (!db || busy?.(db)) {
        continue;
      }
      if (this.throwT < this.reactDelay(job)) {
        this.matchRoute(db, job, dt, 1);
        continue;
      }
      if (job.kind === 'man') {
        this.manBreak(db, job, dt, spot);
        continue;
      }
      const stayHigh = this.stayHigh(job, spot);
      if (stayHigh) {
        this.matchRoute(db, job, dt, 0.62);
        continue;
      }
      const reach = this.throwRead === 'stared' ? 14.5 : 11.5;
      if (xzDist(db, spot) > reach) {
        this.matchRoute(db, job, dt, 1);
        continue;
      }
      db.meet(this.ballPoint(db, spot), dt, this.pursuitSpeed(job), spot);
    }
  }

  /** Seconds before this defender reacts to the ball leaving. */
  private reactDelay(job: Job): number {
    const base = job.kind === 'man' ? 0.16 : 0.3;
    if (this.throwRead === 'stared') {
      return base * 0.25;
    }
    if (this.throwRead === 'lookoff') {
      return base + 0.38;
    }
    return base;
  }

  /**
   * Play the ball, not the man: attack the catch point from the
   * QB side so a defender with position can undercut the throw.
   */
  private ballPoint(db: PlayerActor, spot: Vec2): Vec2 {
    const qb = this.byId.get('qb');
    if (!qb || db.z < spot.z) {
      return spot;
    }
    const dx = qb.x - spot.x;
    const dz = qb.z - spot.z;
    const d = Math.hypot(dx, dz) || 1;
    return { x: spot.x + (dx / d) * 0.6, z: spot.z + (dz / d) * 0.6 };
  }

  /** Man defender: stay on his man unless the ball is his way. */
  private manBreak(
    db: PlayerActor,
    job: Job,
    dt: number,
    spot: Vec2
  ): void {
    const mine = job.match === this.targetId;
    if (mine || xzDist(db, spot) < 7) {
      db.meet(this.ballPoint(db, spot), dt, this.pursuitSpeed(job), spot);
      return;
    }
    this.matchRoute(db, job, dt, 1);
  }

  private stayHigh(job: Job, spot: Vec2): boolean {
    return ZONES[job.zone].deep && spot.z < this.losZ + 11.5;
  }

  /**
   * After-catch close vs YAC 6.0. First man stays under ~7.25 so a
   * juke can still win; floor 6.85 so a trailer can still finish.
   */
  private pursuitSpeed(job: Job): number {
    return clamp(job.spd * COVER_SPEED_SCALE + 0.85, 6.85, 7.25);
  }

  /** After the catch, DBs/LBs run to the ball carrier. */
  chaseCarrier(
    dt: number,
    wr: PlayerActor,
    skip: (p: PlayerActor) => boolean = () => false
  ): void {
    for (const job of this.jobs) {
      if (isPassRusher(job.id) || job.id === this.userId) {
        continue;
      }
      const db = this.byId.get(job.id);
      if (!db) {
        continue;
      }
      if (skip(db)) {
        continue;
      }
      // Take an angle: run to where the carrier is going.
      const speed = this.pursuitSpeed(job);
      db.chase(interceptPoint(db, wr, speed), dt, speed);
    }
  }

  private matchRoute(
    db: PlayerActor,
    job: Job,
    dt: number,
    speedFactor: number
  ): void {
    if (job.kind === 'man') {
      this.manCover(db, job, dt, speedFactor);
      return;
    }
    const receiver = this.pickMatch(job);
    let shade = this.shade(job, receiver);
    shade = this.readEyes(db, job, shade);
    shade = this.sellFake(db, job, shade);
    db.chase(shade, dt, job.spd * COVER_SPEED_SCALE * speedFactor);
    this.keepEyesOnPlay(db, receiver);
  }

  /**
   * Man: mirror the receiver with inside leverage and a small
   * cushion. The chase lags on hard breaks, which is exactly
   * where a good route wins.
   */
  private manCover(
    db: PlayerActor,
    job: Job,
    dt: number,
    speedFactor: number
  ): void {
    const wr = this.byId.get(job.match);
    if (!wr) {
      return;
    }
    const future = wr.predict(job.anticipate);
    const inside = -Math.sign(wr.x) || 1;
    const depth = future.z - this.losZ;
    // Cushion grows on vertical stems so he stays on top.
    const cushion = job.levZ + clamp((depth - 8) * 0.05, 0, 0.9);
    const to = {
      x: future.x + inside * job.levX,
      z: Math.max(this.losZ + 0.6, future.z + cushion)
    };
    db.chase(to, dt, job.spd * COVER_SPEED_SCALE * speedFactor);
  }

  /**
   * Zone defenders drift toward the receiver the QB stares at.
   * Deep players get over the top, underneath players undercut.
   */
  private readEyes(db: PlayerActor, job: Job, shade: Vec2): Vec2 {
    const focus = this.eyes?.focus();
    const reads = readsOf(job, db);
    if (!focus || reads <= 0) {
      return shade;
    }
    const w = reads * clamp((focus.stare - 0.3) / 0.9, 0, 1);
    const wr = this.byId.get(focus.id);
    if (w <= 0 || !wr) {
      return shade;
    }
    const zone = ZONES[job.zone];
    const future = wr.predict(0.5);
    if (future.x < zone.minX - 7 || future.x > zone.maxX + 7) {
      return shade;
    }
    const minZ = this.losZ + job.minRel;
    const maxZ = this.losZ + job.maxRel + 4;
    const want = zone.deep
      ? { x: future.x, z: Math.max(future.z + 3, shade.z) }
      : { x: future.x, z: future.z - 0.8 };
    const to = {
      x: want.x,
      z: clamp(want.z, minZ, maxZ)
    };
    return {
      x: lerp(shade.x, to.x, w),
      z: lerp(shade.z, to.z, w)
    };
  }

  /** Play-action: LBs step downhill, safeties freeze a beat. */
  private sellFake(db: PlayerActor, job: Job, shade: Vec2): Vec2 {
    if (!this.playAction) {
      return shade;
    }
    if (db.def.pos === 'LB' && this.snapT < PA_BITE) {
      return { x: db.x * 0.9, z: this.losZ + 1.2 };
    }
    if (ZONES[job.zone].deep && db.def.pos === 'S' &&
        this.snapT < PA_FREEZE) {
      return { x: db.x, z: db.z };
    }
    return shade;
  }

  private pickMatch(job: Job): PlayerActor | undefined {
    const held = this.heldMatch(job);
    let best: PlayerActor | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const id of RECEIVER_IDS) {
      const receiver = this.byId.get(id);
      if (!receiver) {
        continue;
      }
      const score = this.routeScore(job, receiver);
      if (score < bestScore) {
        bestScore = score;
        best = receiver;
      }
    }
    if (held && this.keepMatch(job, held, bestScore)) {
      return held;
    }
    if (best) {
      this.matches.set(job.id, best.def.id);
    }
    return best ?? this.byId.get(job.match);
  }

  private shade(job: Job, wr?: PlayerActor): Vec2 {
    const zone = ZONES[job.zone];
    const minZ = this.losZ + job.minRel;
    const maxZ = this.losZ + job.maxRel;
    if (!wr) {
      return {
        x: zone.centerX,
        z: this.losZ + zone.depth
      };
    }
    const future = wr.predict(job.anticipate);
    return {
      x: clamp(future.x + job.levX, zone.minX, zone.maxX),
      z: clamp(future.z + job.levZ, minZ, maxZ)
    };
  }

  private heldMatch(job: Job): PlayerActor | undefined {
    const id = this.matches.get(job.id);
    return id ? this.byId.get(id) : undefined;
  }

  private keepMatch(
    job: Job,
    held: PlayerActor,
    bestScore: number
  ): boolean {
    return this.routeScore(job, held) < bestScore + SWITCH_MARGIN;
  }

  private routeScore(job: Job, receiver: PlayerActor): number {
    const zone = ZONES[job.zone];
    const future = receiver.predict(job.anticipate);
    const depth = future.z - this.losZ;
    const lateral = Math.abs(future.x - zone.centerX);
    const depthGap = Math.abs(depth - zone.depth);
    return lateral * zone.lateralCost +
      depthGap * zone.depthCost -
      depth * zone.verticalValue;
  }

  private keepEyesOnPlay(
    db: PlayerActor,
    receiver?: PlayerActor
  ): void {
    const qb = this.byId.get('qb');
    if (!qb || (receiver && xzDist(db, receiver) < 4.2)) {
      return;
    }
    db.facePoint(qb);
  }
}

export function nearestEligible(
  spot: Vec2,
  recs: PlayerActor[]
): PlayerActor | null {
  let best: PlayerActor | null = null;
  let dist = 99;
  for (const p of recs) {
    const n = xzDist(spot, p);
    if (n < dist) {
      dist = n;
      best = p;
    }
  }
  return best;
}
