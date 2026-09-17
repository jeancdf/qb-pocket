/**
 * Cover 3 / Cover 2 match: DBs and remaining LBs run with
 * assigned threats. 1–2 DL/LB rushers are owned by LinePlay
 * so they chase the QB instead of dropping.
 *
 * Smash vs Cover 3:
 * - CBs bail deep thirds (hitch is open underneath).
 * - SS sits the slot to ~12, then passes the corner.
 * - FS takes the deepest middle.
 * - SAM/WILL carry TE / RB flats. Mike rushes or spies.
 * On the throw they break to the landing spot.
 */

import { LOS_Z } from './constants';
import { isPassRusher } from './line-play';
import { clamp, xzDist } from './math';
import type { PlayerActor } from './players';
import type { Pos, Vec2 } from './types';

type ZoneId =
  | 'deepLeft'
  | 'deepMiddle'
  | 'deepRight'
  | 'leftHalf'
  | 'rightHalf'
  | 'leftFlat'
  | 'leftHook'
  | 'middleHook'
  | 'rightHook'
  | 'rightFlat';

interface Job {
  id: string;
  match: string;
  zone: ZoneId;
  levX: number;
  levZ: number;
  spd: number;
  minRel: number;
  maxRel: number;
  anticipate: number;
}

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

export interface CoverLook {
  id: string;
  name: string;
  jobs: Job[];
  starts: Record<string, Vec2>;
}

const L = LOS_Z;
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
  }
};

const C3_JOBS: Job[] = [
  {
    id: 'lcb',
    match: 'wrX',
    zone: 'deepLeft',
    levX: 1.2,
    levZ: 3.2,
    spd: 6.09,
    minRel: 7,
    maxRel: 44,
    anticipate: 0.65
  },
  {
    id: 'rcb',
    match: 'wrZ',
    zone: 'deepRight',
    levX: -1.15,
    levZ: 3.2,
    spd: 6.02,
    minRel: 7,
    maxRel: 44,
    anticipate: 0.65
  },
  {
    id: 'fs',
    match: 'wrH',
    zone: 'deepMiddle',
    levX: 0,
    levZ: 4.0,
    spd: 5.81,
    minRel: 12,
    maxRel: 42,
    anticipate: 0.75
  },
  {
    id: 'ss',
    match: 'wrH',
    zone: 'rightHook',
    levX: -0.75,
    levZ: 1.15,
    spd: 5.54,
    minRel: 5,
    maxRel: 16,
    anticipate: 0.45
  },
  {
    id: 'slb',
    match: 'te',
    zone: 'rightFlat',
    levX: 0.45,
    levZ: 0.85,
    spd: 5.13,
    minRel: 2.5,
    maxRel: 10,
    anticipate: 0.4
  },
  {
    id: 'wlb',
    match: 'rb',
    zone: 'leftFlat',
    levX: -0.55,
    levZ: 0.9,
    spd: 5.07,
    minRel: 2,
    maxRel: 10,
    anticipate: 0.4
  }
];

const C2_JOBS: Job[] = [
  {
    id: 'lcb',
    match: 'wrX',
    zone: 'leftFlat',
    levX: 1.4,
    levZ: 0.25,
    spd: 5.58,
    minRel: 3,
    maxRel: 10,
    anticipate: 0.35
  },
  {
    id: 'rcb',
    match: 'wrZ',
    zone: 'rightFlat',
    levX: -1.4,
    levZ: 0.25,
    spd: 5.58,
    minRel: 3,
    maxRel: 10,
    anticipate: 0.35
  },
  {
    id: 'fs',
    match: 'wrX',
    zone: 'leftHalf',
    levX: 0,
    levZ: 3.4,
    spd: 5.85,
    minRel: 11,
    maxRel: 40,
    anticipate: 0.7
  },
  {
    id: 'ss',
    match: 'wrZ',
    zone: 'rightHalf',
    levX: 0,
    levZ: 3.4,
    spd: 5.78,
    minRel: 11,
    maxRel: 40,
    anticipate: 0.7
  },
  {
    id: 'slb',
    match: 'te',
    zone: 'rightHook',
    levX: 0.4,
    levZ: 0.7,
    spd: 5.10,
    minRel: 3,
    maxRel: 12,
    anticipate: 0.45
  },
  {
    id: 'wlb',
    match: 'rb',
    zone: 'leftHook',
    levX: -0.4,
    levZ: 0.7,
    spd: 5.03,
    minRel: 3,
    maxRel: 12,
    anticipate: 0.45
  }
];

export const COVER3: CoverLook = {
  id: 'c3',
  name: 'COVER 3',
  jobs: C3_JOBS,
  starts: {
    lcb: { x: -18.2, z: L + 6.8 },
    rcb: { x: 19.0, z: L + 6.6 },
    fs: { x: -2.4, z: L + 13.5 },
    ss: { x: 8.4, z: L + 11.2 },
    wlb: { x: -5.8, z: L + 4.4 },
    mlb: { x: 0.2, z: L + 4.8 },
    slb: { x: 5.6, z: L + 4.4 }
  }
};

export const COVER2: CoverLook = {
  id: 'c2',
  name: 'COVER 2',
  jobs: C2_JOBS,
  starts: {
    lcb: { x: -18.2, z: L + 5.1 },
    rcb: { x: 19.0, z: L + 5.0 },
    fs: { x: -7.2, z: L + 13.8 },
    ss: { x: 7.4, z: L + 13.6 },
    wlb: { x: -4.6, z: L + 4.2 },
    mlb: { x: 0.2, z: L + 4.3 },
    slb: { x: 4.8, z: L + 4.2 }
  }
};

export const LOOKS = [COVER3, COVER2];

export function isCoverage(pos: Pos): boolean {
  return pos === 'CB' || pos === 'S' || pos === 'LB';
}

export class CoverPlay {
  private readonly byId: Map<string, PlayerActor>;
  private readonly matches = new Map<string, string>();
  private losZ = LOS_Z;
  private jobs: Job[] = COVER3.jobs;

  constructor(byId: Map<string, PlayerActor>) {
    this.byId = byId;
  }

  setLos(z: number): void {
    this.losZ = z;
  }

  setLook(look: CoverLook): void {
    this.jobs = look.jobs;
    this.matches.clear();
  }

  /** Zone-match while the ball is still in the QB's hands. */
  cover(dt: number): void {
    for (const job of this.jobs) {
      if (isPassRusher(job.id)) {
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
  breakOn(dt: number, spot: Vec2): void {
    for (const job of this.jobs) {
      if (isPassRusher(job.id)) {
        continue;
      }
      const db = this.byId.get(job.id);
      if (!db) {
        continue;
      }
      const stayHigh = this.stayHigh(job, spot);
      if (stayHigh) {
        this.matchRoute(db, job, dt, 0.62);
        continue;
      }
      if (xzDist(db, spot) > 11.5) {
        this.matchRoute(db, job, dt, 1);
        continue;
      }
      db.chase(spot, dt, this.pursuitSpeed(job));
    }
  }

  private stayHigh(job: Job, spot: Vec2): boolean {
    return ZONES[job.zone].deep && spot.z < this.losZ + 11.5;
  }

  /**
   * After-catch close vs YAC 5.7. First man stays under ~6.9 so a
   * juke can still win; floor 6.55 so a trailer can still finish.
   */
  private pursuitSpeed(job: Job): number {
    return clamp(job.spd + 0.85, 6.55, 6.9);
  }

  /** After the catch, DBs/LBs run to the ball carrier. */
  chaseCarrier(dt: number, wr: PlayerActor): void {
    const to = { x: wr.x, z: wr.z };
    for (const job of this.jobs) {
      if (isPassRusher(job.id)) {
        continue;
      }
      const db = this.byId.get(job.id);
      if (!db) {
        continue;
      }
      db.chase(to, dt, this.pursuitSpeed(job));
    }
  }

  private matchRoute(
    db: PlayerActor,
    job: Job,
    dt: number,
    speedFactor: number
  ): void {
    const receiver = this.pickMatch(job);
    const shade = this.shade(job, receiver);
    db.chase(shade, dt, job.spd * speedFactor);
    this.keepEyesOnPlay(db, receiver);
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
