/**
 * Cover 3 match: DBs and LBs run with assigned threats
 * instead of dying on short playbook landmarks.
 *
 * Smash vs Cover 3:
 * - CBs bail deep thirds (hitch is open underneath).
 * - SS sits the slot to ~12, then passes the corner.
 * - FS takes the deepest middle.
 * - LBs carry TE / RB flats and the hook.
 * On the throw they break to the landing spot.
 */

import { LOS_Z } from './constants';
import { clamp, xzDist } from './math';
import type { PlayerActor } from './players';
import type { Pos, Vec2 } from './types';

interface Job {
  id: string;
  match: string;
  levX: number;
  levZ: number;
  spd: number;
  minRel: number;
  maxRel: number;
}

export interface PursuitContext {
  frontId: string | null;
  frontMissed: boolean;
  jukeActive: boolean;
  tackleActive: boolean;
}

export interface CoverLook {
  id: string;
  name: string;
  jobs: Job[];
  starts: Record<string, Vec2>;
}

const L = LOS_Z;

const C3_JOBS: Job[] = [
  {
    id: 'lcb',
    match: 'wrX',
    levX: 1.2,
    levZ: 2.8,
    spd: 7.7,
    minRel: 7,
    maxRel: 44
  },
  {
    id: 'rcb',
    match: 'wrZ',
    levX: -1.15,
    levZ: 8.2,
    spd: 7.65,
    minRel: 13,
    maxRel: 44
  },
  {
    id: 'fs',
    match: 'wrX',
    levX: 0,
    levZ: 3.6,
    spd: 7.45,
    minRel: 15,
    maxRel: 42
  },
  {
    id: 'ss',
    match: 'wrH',
    levX: -0.75,
    levZ: 1.15,
    spd: 7.25,
    minRel: 7,
    maxRel: 16
  },
  {
    id: 'slb',
    match: 'te',
    levX: 0.45,
    levZ: 0.85,
    spd: 6.85,
    minRel: 2.5,
    maxRel: 10
  },
  {
    id: 'wlb',
    match: 'rb',
    levX: -0.55,
    levZ: 0.9,
    spd: 6.75,
    minRel: 2,
    maxRel: 9
  },
  {
    id: 'mlb',
    match: 'te',
    levX: 0,
    levZ: 1.3,
    spd: 6.6,
    minRel: 5.5,
    maxRel: 12
  }
];

const C2_JOBS: Job[] = [
  {
    id: 'lcb',
    match: 'wrX',
    levX: 1.4,
    levZ: 0.25,
    spd: 7.35,
    minRel: 4,
    maxRel: 7.5
  },
  {
    id: 'rcb',
    match: 'wrZ',
    levX: -1.4,
    levZ: 0.25,
    spd: 7.35,
    minRel: 4,
    maxRel: 7.5
  },
  {
    id: 'fs',
    match: 'wrX',
    levX: 0,
    levZ: 2.4,
    spd: 7.55,
    minRel: 12,
    maxRel: 28
  },
  {
    id: 'ss',
    match: 'wrH',
    levX: 0,
    levZ: 2.2,
    spd: 7.5,
    minRel: 12,
    maxRel: 28
  },
  {
    id: 'slb',
    match: 'te',
    levX: 0.4,
    levZ: 0.7,
    spd: 6.8,
    minRel: 2,
    maxRel: 9
  },
  {
    id: 'wlb',
    match: 'rb',
    levX: -0.4,
    levZ: 0.7,
    spd: 6.75,
    minRel: 2,
    maxRel: 9
  },
  {
    id: 'mlb',
    match: 'te',
    levX: 0,
    levZ: 1.0,
    spd: 6.6,
    minRel: 4,
    maxRel: 11
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
  private losZ = LOS_Z;
  private jobs: Job[] = COVER3.jobs;
  private lookId = COVER3.id;
  private reactionT = 0;

  constructor(byId: Map<string, PlayerActor>) {
    this.byId = byId;
  }

  setLos(z: number): void {
    this.losZ = z;
    this.reactionT = 0;
  }

  setLook(look: CoverLook): void {
    this.jobs = look.jobs;
    this.lookId = look.id;
  }

  /** Zone-match while the ball is still in the QB's hands. */
  cover(dt: number): void {
    this.reactionT += dt;
    const qb = this.byId.get('qb');
    for (const job of this.jobs) {
      const db = this.byId.get(job.id);
      if (!db) {
        continue;
      }
      const wr = this.pickMatch(job);
      const reading = this.reactionT < reactionDelay(job);
      const target = reading
        ? this.readStep(job, db)
        : this.shade(job, wr);
      db.chase(target, dt, job.spd * (reading ? 0.72 : 1));
      db.facePoint(qb ?? wr ?? target);
    }
  }

  /** Nearby zone players break; deep thirds stay high
   *  on short throws so the hitch can complete. */
  breakOn(dt: number, spot: Vec2): void {
    for (const job of this.jobs) {
      const db = this.byId.get(job.id);
      if (!db) {
        continue;
      }
      if (this.stayHigh(job, spot)) {
        const wr = this.pickMatch(job);
        db.chase(this.shade(job, wr), dt, job.spd * 0.45);
        continue;
      }
      if (xzDist(db, spot) > 6.4) {
        const wr = this.pickMatch(job);
        db.chase(this.shade(job, wr), dt, job.spd);
        continue;
      }
      db.chase(spot, dt, job.spd + 0.35);
    }
  }

  private stayHigh(job: Job, spot: Vec2): boolean {
    const deep = this.lookId === 'c3' &&
      (job.id === 'lcb' || job.id === 'rcb' || job.id === 'fs');
    return deep && spot.z < this.losZ + 12;
  }

  /** Pursuit uses leverage and gives trailing defenders closing speed. */
  chaseCarrier(
    dt: number,
    wr: PlayerActor,
    context: PursuitContext
  ): void {
    if (context.tackleActive) {
      return;
    }
    for (const job of this.jobs) {
      const db = this.byId.get(job.id);
      if (!db) {
        continue;
      }
      const missed = context.frontMissed &&
        job.id === context.frontId;
      const trailing = db.z < wr.z - 0.8;
      const closing = trailing ? 0.92 : 0.28;
      const jukeBrake = context.jukeActive ? 0.82 : 1;
      const missBrake = missed ? 0.48 : 1;
      const speed = (job.spd + closing) * jukeBrake * missBrake;
      db.chase(pursuitSpot(wr, db), dt, speed);
    }
  }

  private pickMatch(job: Job): PlayerActor | undefined {
    if (job.id === 'lcb') {
      return this.deepLeft();
    }
    if (job.id === 'rcb') {
      return this.deepRight();
    }
    if (job.id === 'fs') {
      return this.deepMiddle();
    }
    if (job.id === 'mlb') {
      return this.hookThreat();
    }
    return this.byId.get(job.match);
  }

  private deepLeft(): PlayerActor | undefined {
    const x = this.byId.get('wrX');
    const rb = this.byId.get('rb');
    if (x && rb && rb.z > x.z + 4 && rb.x < -5) {
      return rb;
    }
    return x ?? rb;
  }

  /** RCB bails with the deepest threat in the right third. */
  private deepRight(): PlayerActor | undefined {
    const z = this.byId.get('wrZ');
    const h = this.byId.get('wrH');
    if (h && z && h.z > z.z + 3.2 && h.x > 3) {
      return h;
    }
    return z ?? h;
  }

  private deepMiddle(): PlayerActor | undefined {
    const x = this.byId.get('wrX');
    const h = this.byId.get('wrH');
    if (x && h) {
      return x.z >= h.z ? x : h;
    }
    return x ?? h;
  }

  private hookThreat(): PlayerActor | undefined {
    const ids = ['te', 'wrH', 'rb'];
    let best: PlayerActor | undefined;
    let score = 99;
    for (const id of ids) {
      const p = this.byId.get(id);
      if (!p) {
        continue;
      }
      const mid = Math.abs(p.x) + Math.abs(p.z - (this.losZ + 8));
      if (mid < score) {
        score = mid;
        best = p;
      }
    }
    return best;
  }

  private shade(job: Job, wr?: PlayerActor): Vec2 {
    const minZ = this.losZ + job.minRel;
    const maxZ = this.losZ + job.maxRel;
    if (!wr) {
      return { x: 0, z: minZ };
    }
    const vel = wr.velocity();
    let x = wr.x + job.levX + vel.x * 0.12;
    let z = wr.z + job.levZ + vel.z * 0.16;
    z = clamp(z, minZ, maxZ);
    if (job.id === 'lcb') {
      x = this.lookId === 'c2'
        ? clamp(x, -HALF_THIRD * 2, -16.2)
        : clamp(x, -HALF_THIRD * 2, -4.5);
    } else if (job.id === 'rcb') {
      x = this.lookId === 'c2'
        ? clamp(x, 16.2, HALF_THIRD * 2)
        : clamp(x, 4.5, HALF_THIRD * 2);
    } else if (job.id === 'fs') {
      x = clamp(x, -8.5, 8.5);
    } else if (job.id === 'ss') {
      x = clamp(x, 2, 13.5);
    } else if (job.id === 'slb') {
      x = clamp(x, 1.5, 11.2);
    } else if (job.id === 'mlb') {
      x = clamp(x, -6, 7.5);
    } else if (job.id === 'wlb') {
      x = clamp(x, -16, -2);
    }
    return { x, z };
  }

  private readStep(job: Job, db: PlayerActor): Vec2 {
    const depth = Math.min(this.losZ + job.minRel, db.z + 2.2);
    return { x: db.x * 0.98, z: depth };
  }
}

const HALF_THIRD = 8.8;

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

function reactionDelay(job: Job): number {
  if (job.id === 'fs' || job.id === 'ss') {
    return 0.26;
  }
  if (job.id === 'lcb' || job.id === 'rcb') {
    return 0.18;
  }
  return 0.14;
}

function pursuitSpot(
  carrier: PlayerActor,
  defender: PlayerActor
): Vec2 {
  const velocity = carrier.velocity();
  const distance = xzDist(carrier, defender);
  const lead = clamp(distance * 0.07, 0.12, 0.72);
  return {
    x: carrier.x + velocity.x * lead,
    z: carrier.z + velocity.z * lead
  };
}
