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
    spd: 8.95,
    minRel: 7,
    maxRel: 44
  },
  {
    id: 'rcb',
    match: 'wrZ',
    levX: -1.15,
    levZ: 8.2,
    spd: 8.85,
    minRel: 13,
    maxRel: 44
  },
  {
    id: 'fs',
    match: 'wrX',
    levX: 0,
    levZ: 3.6,
    spd: 8.55,
    minRel: 15,
    maxRel: 42
  },
  {
    id: 'ss',
    match: 'wrH',
    levX: -0.75,
    levZ: 1.15,
    spd: 8.15,
    minRel: 7,
    maxRel: 16
  },
  {
    id: 'slb',
    match: 'te',
    levX: 0.45,
    levZ: 0.85,
    spd: 7.55,
    minRel: 2.5,
    maxRel: 10
  },
  {
    id: 'wlb',
    match: 'rb',
    levX: -0.55,
    levZ: 0.9,
    spd: 7.45,
    minRel: 2,
    maxRel: 9
  },
  {
    id: 'mlb',
    match: 'te',
    levX: 0,
    levZ: 1.3,
    spd: 7.05,
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
    spd: 8.2,
    minRel: 4,
    maxRel: 7.5
  },
  {
    id: 'rcb',
    match: 'wrZ',
    levX: -1.4,
    levZ: 0.25,
    spd: 8.2,
    minRel: 4,
    maxRel: 7.5
  },
  {
    id: 'fs',
    match: 'wrX',
    levX: 0,
    levZ: 2.4,
    spd: 8.6,
    minRel: 12,
    maxRel: 28
  },
  {
    id: 'ss',
    match: 'wrH',
    levX: 0,
    levZ: 2.2,
    spd: 8.5,
    minRel: 12,
    maxRel: 28
  },
  {
    id: 'slb',
    match: 'te',
    levX: 0.4,
    levZ: 0.7,
    spd: 7.5,
    minRel: 2,
    maxRel: 9
  },
  {
    id: 'wlb',
    match: 'rb',
    levX: -0.4,
    levZ: 0.7,
    spd: 7.4,
    minRel: 2,
    maxRel: 9
  },
  {
    id: 'mlb',
    match: 'te',
    levX: 0,
    levZ: 1.0,
    spd: 7.1,
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

  constructor(byId: Map<string, PlayerActor>) {
    this.byId = byId;
  }

  setLos(z: number): void {
    this.losZ = z;
  }

  setLook(look: CoverLook): void {
    this.jobs = look.jobs;
    this.lookId = look.id;
  }

  /** Zone-match while the ball is still in the QB's hands. */
  cover(dt: number): void {
    for (const job of this.jobs) {
      const db = this.byId.get(job.id);
      if (!db) {
        continue;
      }
      const wr = this.pickMatch(job);
      const shade = this.shade(job, wr);
      db.chase(shade, dt, job.spd);
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

  /** After the catch, DBs/LBs run to the ball carrier. */
  chaseCarrier(dt: number, wr: PlayerActor): void {
    const to = { x: wr.x, z: wr.z };
    for (const job of this.jobs) {
      const db = this.byId.get(job.id);
      if (!db) {
        continue;
      }
      db.chase(to, dt, job.spd + 0.35);
    }
  }

  private pickMatch(job: Job): PlayerActor | undefined {
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
    let x = wr.x + job.levX;
    let z = wr.z + job.levZ;
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
