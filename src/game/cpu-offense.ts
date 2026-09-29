/**
 * The CPU offense while the player is on defense: the play
 * call, the quarterback's reads and throw, and the ball
 * carrier's running after the catch. Pure decisions; game.ts
 * owns the actors and executes them.
 */

import { HALF_W } from './constants';
import { clamp, lerp, xzDist } from './math';
import type { PlayerActor } from './players';
import type { OffPlay } from './plays';
import type { Vec2 } from './types';

export interface QbRead {
  id: string;
  /** Yards from the QB to the catch point. */
  dist: number;
  /** Power this throw would be made with. */
  power: number;
  /**
   * Seconds the ball beats the nearest defender to the catch
   * point or the end of the throwing lane (negative = he gets
   * there first). See throwMargin.
   */
  margin: number;
}

export type QbCall =
  | { kind: 'throw'; id: string; power: number }
  | { kind: 'away'; spot: Vec2 }
  | null;

/**
 * Weighted play call from the down and distance: runs on short
 * yardage, passes on third and long.
 */
export function callPlay(
  plays: OffPlay[],
  skill: number,
  down: number,
  toGo: number
): number {
  const runW = toGo <= 3 ? 2.6 : down >= 3 && toGo >= 7 ? 0.2 : 1.4;
  const weights = plays.map((p) =>
    p.run ? runW : (p.pa ? 0.7 : 1) + skill * 0.2
  );
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < weights.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) {
      return i;
    }
  }
  return 0;
}

/** Power a CPU passer puts on a throw of this length. */
export function powerFor(dist: number): number {
  if (dist < 11) {
    return 0.8;
  }
  if (dist < 24) {
    return 0.68;
  }
  return 0.55;
}

/** How much wider a CPU passer scatters than a perfect one. */
export function cpuAccuracy(skill: number): number {
  return lerp(1.2, 0.75, clamp(skill, 0, 1));
}

/** Closing speed and reaction a defender gets on a thrown ball. */
const DB_SPEED = 6.9;
const DB_REACT = 0.35;
/** He only has to get a hand on it. */
const DB_REACH = 1.35;

/**
 * Throwing window in seconds: how much earlier the ball gets to
 * the catch point (and to the back end of the lane, where an
 * underneath defender can undercut it) than the quickest
 * defender. A flat bullet also has to clear the middle of the
 * lane.
 */
export function throwMargin(
  from: Vec2,
  to: Vec2,
  flight: number,
  power: number,
  defenders: Vec2[]
): number {
  const samples = power >= 0.75 ? [0.5, 0.75, 1] : [0.75, 0.9, 1];
  let margin = 99;
  for (const s of samples) {
    const p = {
      x: from.x + (to.x - from.x) * s,
      z: from.z + (to.z - from.z) * s
    };
    const ballT = flight * s;
    for (const d of defenders) {
      const reach = Math.max(0, xzDist(d, p) - DB_REACH);
      const dbT = reach / DB_SPEED + DB_REACT;
      margin = Math.min(margin, dbT - ballT);
    }
  }
  return margin;
}

/**
 * Quarterback brain: take the drop and let the routes develop,
 * then read the progression one man at a time. He throws only
 * into a real window (throwMargin, at a lead point computed from
 * the receiver's route and the flight time). Nothing there:
 * he holds it, and under heat throws it away.
 */
export class CpuQb {
  private t = 0;
  private order: string[] = [];
  private look = 0;
  private lookT = 0;
  private done = false;
  /** Misread on the current look (a weak QB sees ghosts). */
  private noise = 0;
  /** Rolled once when the pocket collapses: throw it away or not. */
  private throwsAway: boolean | null = null;

  constructor(private skill: number) {}

  setSkill(skill: number): void {
    this.skill = skill;
  }

  /** New snap: `order` is the progression, primary first. */
  reset(order: string[]): void {
    this.t = 0;
    this.order = order;
    this.look = 0;
    this.lookT = 0;
    this.done = false;
    this.throwsAway = null;
    this.rollNoise();
  }

  /** Receiver he is looking at (the defense reads his eyes). */
  eyesOn(): string | null {
    return this.order[this.look] ?? null;
  }

  tick(
    dt: number,
    reads: QbRead[],
    pressure: number,
    qb: Vec2,
    losZ: number
  ): QbCall {
    if (this.done) {
      return null;
    }
    this.t += dt;
    // Full drop and a beat for the breaks before the first read.
    const drop = lerp(1.5, 1.15, this.skill);
    if (this.t < drop) {
      return null;
    }
    this.lookT += dt;
    // A better QB trusts tighter windows (and reads them right).
    const need = lerp(0.22, 0.05, this.skill);
    const byId = new Map(reads.map((r) => [r.id, r]));
    const current = byId.get(this.order[this.look] ?? '');
    const settled = this.lookT > 0.12;
    if (current && settled && current.margin + this.noise >= need) {
      return this.throwTo(current);
    }
    const dwell = lerp(0.7, 0.45, this.skill);
    if (this.lookT >= dwell) {
      this.lookT = 0;
      this.look = (this.look + 1) % Math.max(1, this.order.length);
      this.rollNoise();
    }
    const panic = pressure > lerp(0.6, 0.82, this.skill) ||
      this.t > lerp(4.2, 5.0, this.skill);
    if (!panic) {
      return null;
    }
    const best = bestRead(reads);
    if (best && best.margin >= 0) {
      return this.throwTo(best);
    }
    if (this.throwsAway === null) {
      this.throwsAway = Math.random() < lerp(0.65, 0.97, this.skill);
    }
    if (this.throwsAway) {
      this.done = true;
      const side = qb.x >= 0 ? 1 : -1;
      return {
        kind: 'away',
        spot: { x: side * (HALF_W + 5), z: losZ + 6 }
      };
    }
    // Eats it: keeps reading in case someone comes open late.
    return null;
  }

  private rollNoise(): void {
    // ± up to 0.25 s of misjudged window for the weakest QB.
    this.noise = (Math.random() * 2 - 1) * 0.25 * (1 - this.skill);
  }

  private throwTo(r: QbRead): QbCall {
    this.done = true;
    return { kind: 'throw', id: r.id, power: r.power };
  }
}

function bestRead(reads: QbRead[]): QbRead | null {
  let best: QbRead | null = null;
  for (const r of reads) {
    if (!best || r.margin > best.margin) {
      best = r;
    }
  }
  return best;
}

export interface RunnerMove {
  stick: Vec2;
  /** -1 / +1 to juke that way this frame, 0 for none. */
  juke: number;
}

/**
 * Ball carrier: head for the end zone, bend away from the
 * defenders in front, stay off the sideline, and juke the
 * first man when he closes to juke range.
 */
export class CpuRunner {
  private jukeCool = 0;

  constructor(private skill: number) {}

  setSkill(skill: number): void {
    this.skill = skill;
  }

  reset(): void {
    this.jukeCool = 0;
  }

  tick(
    dt: number,
    carrier: PlayerActor,
    defenders: PlayerActor[]
  ): RunnerMove {
    this.jukeCool = Math.max(0, this.jukeCool - dt);
    let sx = 0;
    let front: PlayerActor | null = null;
    let frontD = 99;
    for (const d of defenders) {
      if (d.isDown() || d.isStaggered()) {
        continue;
      }
      const dz = d.z - carrier.z;
      if (dz < -1.5) {
        continue;
      }
      const dist = xzDist(d, carrier);
      if (dist > 10) {
        continue;
      }
      const dx = carrier.x - d.x;
      const push = (1 / Math.max(dist * dist, 1.2)) * 6;
      sx += Math.sign(dx || 0.01) * push;
      if (dist < frontD) {
        frontD = dist;
        front = d;
      }
    }
    // Sideline: bend back inside.
    const edge = HALF_W - 5;
    if (Math.abs(carrier.x) > edge) {
      sx -= Math.sign(carrier.x) * (Math.abs(carrier.x) - edge) * 0.6;
    }
    sx = clamp(sx, -1.4, 1.4);
    let juke = 0;
    if (front && this.jukeCool <= 0 && frontD > 1.6 && frontD < 3.1) {
      this.jukeCool = 1.2;
      if (Math.random() < lerp(0.25, 0.7, this.skill)) {
        juke = front.x > carrier.x ? -1 : 1;
      }
    }
    return { stick: { x: sx, z: 1 }, juke };
  }
}
