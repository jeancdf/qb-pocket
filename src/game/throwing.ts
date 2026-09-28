/**
 * Pass mechanics: hold-to-charge power, accuracy scatter, and
 * the catch / drop / breakup / pick contest at the ball.
 *
 * Pure logic. game.ts owns the actors and the ball; this file
 * only turns situations into numbers and outcomes.
 */

import { CATCH_RADIUS } from './constants';
import { clamp, lerp, xzDist } from './math';
import type { Vec2 } from './types';

/** Seconds of hold to reach a full bullet. */
export const CHARGE_FULL = 0.9;
/** Held past this, the ball sails (overthrow risk grows). */
const OVERCHARGE = 1.35;
/** Power used for instant throws (HUD row click). */
export const TAP_POWER = 0.55;
/** Receiver reads the real ball after this beat. */
export const BALL_READ_DELAY = 0.28;
/** Nobody can touch a tipped ball for this long. */
export const TIP_COOLDOWN = 0.22;

export type ThrowTarget =
  | { kind: 'spot'; spot: Vec2 }
  | { kind: 'wr'; id: string };

export type CatchOutcome = 'catch' | 'drop' | 'breakup' | 'pick';

export interface ThrowShot {
  /** 0 = touch lob, 1 = frozen rope. */
  power: number;
  /** Where the QB meant it to go. */
  intended: Vec2;
  /** Where it will actually come down. */
  landing: Vec2;
  /** Accuracy radius (yd) used for the scatter. */
  spread: number;
}

export interface ThrowSituation {
  from: Vec2;
  target: Vec2;
  power: number;
  /** 0..1 from the nearest rusher. */
  pressure: number;
  /** 0..1 how hard the QB is moving (scramble stick). */
  moving: number;
  /** Seconds past CHARGE_FULL the button was held. */
  overHold: number;
}

/** Hold time → power in 0..1 (eased so taps stay soft). */
export function chargePower(heldSeconds: number): number {
  const t = clamp(heldSeconds / CHARGE_FULL, 0, 1);
  return 1 - (1 - t) * (1 - t);
}

/** Seconds held past full charge. */
export function overHold(heldSeconds: number): number {
  return Math.max(0, heldSeconds - OVERCHARGE);
}

/**
 * Average downfield ball speed (yd/s) for a given power.
 * NFL throws run ~15 yd/s for a lofted ball up to ~27 for a
 * rope (45–55 mph velocity, minus the arc).
 */
export function ballSpeed(power: number): number {
  return lerp(15, 27, clamp(power, 0, 1));
}

/**
 * Nearest rusher distance → pressure. Free at 5+ yd, max
 * when a hand is on the QB.
 */
export function pressureFrom(distance: number): number {
  return clamp((5 - distance) / 3.6, 0, 1);
}

/** Accuracy radius (yd) for this throw before it is released. */
export function spreadFor(s: ThrowSituation): number {
  const dist = xzDist(s.from, s.target);
  let r = 0.25 + dist * 0.016;
  // Deep lobs drift; short bullets are precise.
  r *= lerp(1.25, 0.9, s.power);
  r *= 1 + s.pressure * 1.7;
  r *= 1 + s.moving * 0.85;
  r += s.overHold * 2.2;
  return clamp(r, 0.2, 6);
}

/** Build the shot: scatter mostly along the throw line. */
export function makeShot(
  s: ThrowSituation,
  rng: () => number = Math.random
): ThrowShot {
  const spread = spreadFor(s);
  const dx = s.target.x - s.from.x;
  const dz = s.target.z - s.from.z;
  const len = Math.max(0.01, Math.hypot(dx, dz));
  const ux = dx / len;
  const uz = dz / len;
  // Over/under throws are more common than wide ones.
  const along = gauss(rng) * spread * 0.62;
  const across = gauss(rng) * spread * 0.4;
  // Overheld balls sail long.
  const sail = s.overHold * 2.4;
  const landing = {
    x: s.target.x + ux * (along + sail) - uz * across,
    z: s.target.z + uz * (along + sail) + ux * across
  };
  return {
    power: s.power,
    intended: { ...s.target },
    landing,
    spread
  };
}

export interface ContestInput {
  /** Ball speed (yd/s) when it arrives. */
  ballSpeed: number;
  /** Ball → receiver hands (yd), null when no receiver in range. */
  wrDist: number | null;
  /** Ball → nearest defender (yd), null when none in range. */
  dbDist: number | null;
  /** Receiver ↔ that defender (yd). */
  sep: number;
  power: number;
  /** A tipped ball is live but wild. */
  tipped: boolean;
  /** Laying out / leaping: fingertips, not hands. */
  wrStretch?: boolean;
  dbStretch?: boolean;
}

/**
 * Who comes down with it. Defenders only get a shot when they
 * are actually at the ball; separation alone doesn't pick it.
 */
export function contest(
  c: ContestInput,
  rng: () => number = Math.random
): CatchOutcome | null {
  const wr = c.wrDist;
  const db = c.dbDist;
  const dbInPlay = db !== null && db < 1.35;
  if (wr === null && !dbInPlay) {
    return null;
  }
  const r = rng();
  if (dbInPlay && (wr === null || db! + (c.dbStretch ? 0.5 : 0.25) < wr)) {
    // Defender beat the receiver to it.
    let pick = 0.34 + (1 - c.power) * 0.22;
    if (c.tipped) {
      pick += 0.18;
    }
    pick *= clamp(1.35 - db! * 0.5, 0.4, 1);
    if (!c.tipped && wr !== null && r > 0.55) {
      // A receiver right there still fights for it.
      const hands = 0.8 - clamp(wr / CATCH_RADIUS, 0, 1) * 0.3;
      return rng() < hands ? 'catch' : 'breakup';
    }
    if (c.dbStretch) {
      // Fingertips at full extension: mostly a knockdown.
      pick *= 0.45;
    }
    return r < pick ? 'pick' : 'breakup';
  }
  const reach = clamp(wr! / CATCH_RADIUS, 0, 1);
  // Rockets into short windows are hard to hold.
  const heat = clamp((c.ballSpeed - 17) / 14, 0, 1);
  let hands = 0.95 - reach * 0.28 - heat * 0.2;
  if (c.wrStretch) {
    hands -= 0.12;
  }
  if (c.tipped) {
    hands -= 0.3;
  }
  if (dbInPlay || c.sep < 1) {
    // Contested: DB swipes at the hands. Tight coverage wins
    // some, but most balls on the hands are still caught.
    const closeness = clamp(1 - c.sep, 0, 1);
    let swat = 0.06 + closeness * 0.22;
    if (c.dbStretch) {
      swat *= 0.6;
    }
    if (r < swat * 0.22) {
      return 'pick';
    }
    if (r < swat) {
      return 'breakup';
    }
    return rng() < hands ? 'catch' : 'drop';
  }
  return r < hands ? 'catch' : 'drop';
}

function gauss(rng: () => number): number {
  // Sum of three uniforms: cheap, bounded bell curve (~σ 1).
  return (rng() + rng() + rng() - 1.5) * 2;
}

/** Real hang time (s) of a pass from `from` to `to`. */
export function flightTime(from: Vec2, to: Vec2, power: number): number {
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  return clamp(dist / ballSpeed(power) + 0.1, 0.35, 3.2);
}
