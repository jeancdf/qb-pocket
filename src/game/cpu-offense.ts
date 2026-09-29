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
import type { CoverGrade, Vec2 } from './types';

export interface QbRead {
  id: string;
  grade: CoverGrade;
  /** Yards from the QB. */
  dist: number;
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
    return 0.78;
  }
  if (dist < 24) {
    return 0.62;
  }
  return 0.42;
}

/** How much wider a CPU passer scatters than a perfect one. */
export function cpuAccuracy(skill: number): number {
  return lerp(1.45, 0.8, clamp(skill, 0, 1));
}

/**
 * Quarterback brain: drop, then read the progression one man at
 * a time. Throws the first open man, takes a window under
 * pressure, and throws it away rather than eat a sack when he
 * is good enough to know better.
 */
export class CpuQb {
  private t = 0;
  private order: string[] = [];
  private look = 0;
  private lookT = 0;
  private done = false;
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
    const drop = lerp(1.05, 0.8, this.skill);
    if (this.t < drop) {
      return null;
    }
    this.lookT += dt;
    const byId = new Map(reads.map((r) => [r.id, r]));
    const current = byId.get(this.order[this.look] ?? '');
    // A weak QB sometimes forces it into a window.
    const forces = Math.random() < (1 - this.skill) * 0.012;
    if (current && (current.grade === 'open' ||
        (forces && current.grade === 'window'))) {
      return this.throwTo(current);
    }
    const dwell = lerp(0.62, 0.34, this.skill);
    if (this.lookT >= dwell) {
      this.lookT = 0;
      this.look = (this.look + 1) % Math.max(1, this.order.length);
    }
    const panic = pressure > lerp(0.55, 0.8, this.skill) ||
      this.t > lerp(3.6, 4.4, this.skill);
    if (!panic) {
      return null;
    }
    const best = bestRead(reads);
    if (best && best.grade !== 'covered') {
      return this.throwTo(best);
    }
    if (this.throwsAway === null) {
      this.throwsAway = Math.random() < this.skill * 0.9;
    }
    if (this.throwsAway) {
      this.done = true;
      const side = qb.x >= 0 ? 1 : -1;
      return {
        kind: 'away',
        spot: { x: side * (HALF_W + 5), z: losZ + 6 }
      };
    }
    return null;
  }

  private throwTo(r: QbRead): QbCall {
    this.done = true;
    return { kind: 'throw', id: r.id, power: powerFor(r.dist) };
  }
}

function bestRead(reads: QbRead[]): QbRead | null {
  const rank: Record<CoverGrade, number> = {
    open: 0,
    window: 1,
    covered: 2,
    idle: 3
  };
  let best: QbRead | null = null;
  for (const r of reads) {
    if (!best || rank[r.grade] < rank[best.grade] ||
        (rank[r.grade] === rank[best.grade] && r.dist < best.dist)) {
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
