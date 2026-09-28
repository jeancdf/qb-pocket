/**
 * Receivers after the last step of their route: never stand
 * still. Every half second they pick a nearby spot that is
 * furthest from the defense (and from each other), stay in
 * bounds and in front of the line, and work to it. When the
 * QB scrambles they drift along with him and come back toward
 * him, like a real scramble drill.
 */

import { HALF_W } from './constants';
import { xzDist } from './math';
import type { PlayerActor } from './players';
import type { Vec2 } from './types';

const PICK_EVERY = 0.5;
const RADII = [2.5, 4.5];
const ANGLES = 12;
const SIDE_MARGIN = 2;
/** Working speed: settling into a hole, not a full sprint. */
const WORK_SPEED = 4.6;
const SCRAMBLE_SPEED = 5.4;

interface Plan {
  to: Vec2;
  t: number;
}

export interface OpenContext {
  qb: PlayerActor;
  losZ: number;
  defenders: PlayerActor[];
  mates: PlayerActor[];
  /** QB scramble direction (world x), 0 when he is in the pocket. */
  scramble: number;
}

export class GetOpen {
  private readonly plans = new Map<PlayerActor, Plan>();

  clear(): void {
    this.plans.clear();
  }

  wants(p: PlayerActor): boolean {
    // Blockers and the screen back hold their spot on purpose.
    const holds = p.def.routeName === 'Block' ||
      p.def.routeName === 'Screen';
    return p.def.eligible === true && !holds && p.routeDone();
  }

  move(p: PlayerActor, dt: number, ctx: OpenContext): void {
    let plan = this.plans.get(p);
    if (plan) {
      plan.t -= dt;
    }
    if (!plan || plan.t <= 0 || xzDist(p, plan.to) < 0.6) {
      plan = { to: this.pick(p, ctx), t: PICK_EVERY };
      this.plans.set(p, plan);
    }
    const speed = ctx.scramble !== 0 ? SCRAMBLE_SPEED : WORK_SPEED;
    p.chase(plan.to, dt, speed);
  }

  private pick(p: PlayerActor, ctx: OpenContext): Vec2 {
    let best: Vec2 = { x: p.x, z: p.z };
    let bestScore = this.score(best, p, ctx);
    for (const r of RADII) {
      for (let i = 0; i < ANGLES; i += 1) {
        const a = (i / ANGLES) * Math.PI * 2;
        const spot = this.inBounds(
          { x: p.x + Math.sin(a) * r, z: p.z + Math.cos(a) * r },
          p,
          ctx
        );
        const s = this.score(spot, p, ctx);
        if (s > bestScore) {
          bestScore = s;
          best = spot;
        }
      }
    }
    return best;
  }

  /** Higher is better: space from defenders first. */
  private score(spot: Vec2, p: PlayerActor, ctx: OpenContext): number {
    let space = 12;
    for (const d of ctx.defenders) {
      space = Math.min(space, xzDist(spot, d));
    }
    let crowd = 0;
    for (const m of ctx.mates) {
      if (m !== p) {
        crowd += Math.max(0, 5 - xzDist(spot, m));
      }
    }
    // Throwing lanes shrink with distance: a little pull back to the QB.
    const qbDist = xzDist(spot, ctx.qb);
    let s = space * 1.4 - crowd * 0.5 - qbDist * 0.05;
    if (ctx.scramble !== 0) {
      // Scramble drill: run the way the QB runs, come back to him.
      s += (spot.x - p.x) * ctx.scramble * 0.6;
      s -= Math.max(0, spot.z - p.z) * 0.25;
    }
    return s;
  }

  private inBounds(spot: Vec2, p: PlayerActor, ctx: OpenContext): Vec2 {
    const maxX = HALF_W - SIDE_MARGIN;
    // Never drift back behind the line (a check-down already
    // there may stay where he is).
    const minZ = Math.min(ctx.losZ + 1.5, p.z);
    return {
      x: Math.max(-maxX, Math.min(maxX, spot.x)),
      z: Math.max(minZ, spot.z)
    };
  }
}
