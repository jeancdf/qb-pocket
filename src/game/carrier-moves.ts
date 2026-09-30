/**
 * Ball carrier moves beyond the juke: spin, stiff-arm, hurdle and
 * truck. Each has its key (main.ts), its length, its cooldown and
 * odds that depend on where the defender comes from, how fast he
 * is closing and how big he is. YacRun runs the moves; this file is
 * the data and the odds.
 */

import { clamp, wrapPi, xzDist } from './math';
import type { AnimKind, PlayerActor } from './players';
import type { Pos } from './types';

export type CarrierMove = 'spin' | 'stiffArm' | 'hurdle' | 'truck';

export interface MoveSpec {
  anim: AnimKind;
  /** Whole move (s). */
  time: number;
  /** Contact: when it is decided (s into the move). */
  hit: number;
  cooldown: number;
  /** A defender farther than this is not part of the move (yd). */
  range: number;
  /** Speed carried through: share of the entry speed, and a floor. */
  keep: number;
  minSpeed: number;
  /** Seconds a beaten defender stays on the grass (0: stays up). */
  lie: number;
  /** Speed factor for a beat after the move when it works. */
  after: number;
  status: string;
  won: string;
  lost: string;
}

export const MOVES: Record<CarrierMove, MoveSpec> = {
  spin: {
    anim: 'spin',
    time: 0.5,
    hit: 0.14,
    cooldown: 1.0,
    range: 3.2,
    keep: 0.72,
    minSpeed: 3.2,
    lie: 1.0,
    after: 0.92,
    status: 'Spin…',
    won: 'SPIN MOVE',
    lost: 'SPIN READ'
  },
  stiffArm: {
    anim: 'stiffArm',
    time: 0.5,
    hit: 0.16,
    cooldown: 1.1,
    range: 2.4,
    keep: 0.92,
    minSpeed: 4,
    lie: 1.3,
    after: 0.97,
    status: 'Stiff-arm…',
    won: 'STIFF ARM',
    lost: 'ARM TACKLE HOLDS'
  },
  hurdle: {
    anim: 'hurdle',
    time: 0.62,
    hit: 0.12,
    cooldown: 1.4,
    range: 3.4,
    keep: 1,
    minSpeed: 5,
    lie: 0,
    after: 0.82,
    status: 'Hurdle…',
    won: 'HURDLED',
    lost: 'HIT IN THE AIR'
  },
  truck: {
    anim: 'truck',
    time: 0.42,
    hit: 0.18,
    cooldown: 1.2,
    range: 2.3,
    keep: 0.86,
    minSpeed: 4.5,
    lie: 1.5,
    after: 0.8,
    status: 'Lower the shoulder…',
    won: 'TRUCKED',
    lost: 'STOOD UP'
  }
};

/** How the defender comes at the carrier when the move lands. */
export interface MoveRead {
  dist: number;
  /** Defender speed toward the carrier (yd/s). */
  closing: number;
  /** 0 dead ahead of the carrier, pi/2 from the side, pi from behind. */
  angle: number;
  carrierSpeed: number;
  diving: boolean;
  /** Carrier weight over defender weight (above 1: carrier bigger). */
  mass: number;
}

const WEIGHT: Partial<Record<Pos, number>> = {
  QB: 0.8,
  RB: 1,
  WR: 0.85,
  TE: 1.15,
  CB: 0.85,
  S: 0.92,
  LB: 1.05,
  DL: 1.25
};

export function readDefender(
  carrier: PlayerActor,
  d: PlayerActor,
  heading: number,
  diving: boolean
): MoveRead {
  const dist = Math.max(xzDist(carrier, d), 0.01);
  const tx = (carrier.x - d.x) / dist;
  const tz = (carrier.z - d.z) / dist;
  const dv = d.velocity();
  const cv = carrier.velocity();
  const toD = Math.atan2(d.x - carrier.x, d.z - carrier.z);
  return {
    dist,
    closing: dv.x * tx + dv.z * tz,
    angle: Math.abs(wrapPi(toD - heading)),
    carrierSpeed: Math.hypot(cv.x, cv.z),
    diving,
    mass: (WEIGHT[carrier.def.pos] ?? 1) / (WEIGHT[d.def.pos] ?? 1)
  };
}

/** Chance (0–1) the move beats this defender. */
export function moveOdds(move: CarrierMove, r: MoveRead): number {
  switch (move) {
    case 'spin': {
      // Needs him committed and nearly on you: spin off the contact.
      const timing = r.dist < 0.9
        ? clamp((r.dist - 0.4) / 0.5, 0, 1)
        : clamp((3.0 - r.dist) / 1.2, 0, 1);
      const commit = r.diving ? 1 : clamp(r.closing / 5, 0, 1);
      const front = r.angle < 1.9 ? 1 : 0.4;
      const sell = clamp(r.carrierSpeed / 4, 0.5, 1);
      return Math.min(0.85,
        timing * (0.3 + 0.7 * commit) * front * sell * 1.25);
    }
    case 'stiffArm': {
      // Best on a man coming from the side; a full-speed hit
      // overpowers the arm, a big man is hard to move.
      const reach = r.dist < 0.6 ? 0.4 : clamp((2.3 - r.dist) / 0.9, 0, 1);
      const side = r.angle < 0.5 ? 0.35 : r.angle < 2.2 ? 1 : 0.7;
      const pace = 1 - 0.5 * clamp((r.closing - 2.5) / 5, 0, 1);
      const low = r.diving ? 0.8 : 1;
      return Math.min(0.85,
        reach * side * pace * low * clamp(r.mass, 0.6, 1.3) * 0.95);
    }
    case 'hurdle': {
      // Only a man already low (diving) can be jumped; a standing
      // one hits you in the air.
      const timing = clamp(1 - Math.abs(r.dist - 1.7) / 1.3, 0, 1);
      return r.diving ? Math.min(0.9, 0.95 * timing) : 0.12 * timing;
    }
    case 'truck': {
      // Head-on, at speed, against a man who is not already
      // running full tilt into you.
      const headOn = r.angle < 0.6 ? 1 : r.angle < 1.2 ? 0.6 : 0.2;
      const reach = clamp((2.2 - r.dist) / 1.0, 0, 1);
      const power = clamp(r.carrierSpeed / 6.5, 0.3, 1.1);
      const brace = 1 - 0.45 * clamp(r.closing / 7, 0, 1);
      const low = r.diving ? 0.5 : 1;
      return Math.min(0.8,
        headOn * reach * power * brace * low * r.mass * 1.1);
    }
  }
}
