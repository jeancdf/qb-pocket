/**
 * Diving tackles. A defender closing on the carrier from a
 * couple of yards launches himself at where the carrier is
 * going: arms out, body flat. Hit in the air and the carrier
 * goes down; miss (a juke, a cut, a bad angle) and the diver
 * belly-flops, stays on the grass, and has to get up before he
 * can chase again.
 */

import { clamp, xzDist } from './math';
import type { PlayerActor } from './players';
import { interceptPoint } from './pursuit';

/** Launch window: close enough to reach, far enough to need it. */
const DIVE_MIN = 1.5;
const DIVE_MAX = 3.3;
/** Must be closing at least this fast (yd/s) to commit. */
const MIN_CLOSING = 2.2;
/** Chance a defender in the window commits (rolled once each). */
const DIVE_CHANCE = 0.6;
const DIVE_SPEED = 8.2;
/** Airborne time, then the slide, then down on the grass. */
const AIR = 0.36;
const SLIDE = 0.34;
/** Then flat on the grass this long (s, plus up to 0.3) before he gets up. */
const GROUND = 1.1;
/** Wrap-up reach while flying (yards, center to center). */
const HIT_REACH = 1.05;

interface Dive {
  t: number;
  vx: number;
  vz: number;
  dir: number;
}

export class DiveTackles {
  private readonly dives = new Map<PlayerActor, Dive>();
  /** Everyone who already chose to dive or not on this run. */
  private readonly decided = new Set<PlayerActor>();

  clear(): void {
    this.dives.clear();
    this.decided.clear();
  }

  has(p: PlayerActor): boolean {
    return this.dives.has(p);
  }

  /** Stop a dive (he made the tackle; the tackle pose takes over). */
  end(p: PlayerActor): void {
    this.dives.delete(p);
  }

  /** Defenders in the window decide whether to leave their feet. */
  launch(carrier: PlayerActor, players: PlayerActor[]): void {
    for (const p of players) {
      if (p.def.side !== 'defense' || p.isDown() ||
          p.isStaggered() || this.dives.has(p)) {
        continue;
      }
      const dist = xzDist(p, carrier);
      if (dist < DIVE_MIN || dist > DIVE_MAX) {
        this.forgetIfFar(p, dist);
        continue;
      }
      if (this.decided.has(p) || closing(p, carrier) < MIN_CLOSING) {
        continue;
      }
      this.decided.add(p);
      if (Math.random() < DIVE_CHANCE) {
        this.start(p, carrier);
      }
    }
  }

  /** Diver whose flight reached the carrier, unless he was dodged. */
  contact(
    carrier: PlayerActor,
    dodged: (p: PlayerActor) => boolean
  ): PlayerActor | null {
    for (const [p, d] of this.dives) {
      if (d.t > AIR + 0.06 || dodged(p)) {
        continue;
      }
      if (xzDist(p, carrier) < HIT_REACH) {
        return p;
      }
    }
    return null;
  }

  /** Scripted flight, slide and time on the ground. */
  move(p: PlayerActor, dt: number): void {
    const d = this.dives.get(p);
    if (!d) {
      return;
    }
    d.t += dt;
    const total = AIR + SLIDE;
    const u = Math.min(1, d.t / total);
    const k = d.t < AIR
      ? 1
      : Math.max(0, 1 - (d.t - AIR) / SLIDE) * 0.45;
    p.footwork(d.vx * k, d.vz * k, dt, p.facing, 'dive', u, d.dir);
    if (d.t >= total) {
      this.dives.delete(p);
      // Already flat: lie there, then get up in stages.
      p.knockDown(GROUND + Math.random() * 0.3, false, null, true);
    }
  }

  private start(p: PlayerActor, carrier: PlayerActor): void {
    const to = interceptPoint(p, carrier, DIVE_SPEED, 0.45);
    const dx = to.x - p.x;
    const dz = to.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    // Fly a bit past the spot: a dive does not stop on a dime.
    const speed = clamp(len / AIR, 5.5, DIVE_SPEED);
    p.facing = Math.atan2(dx, dz);
    const side = carrier.x - p.x;
    this.dives.set(p, {
      t: 0,
      vx: (dx / len) * speed,
      vz: (dz / len) * speed,
      dir: side < 0 ? -1 : 1
    });
  }

  /** Back out of range: he may choose again on the next approach. */
  private forgetIfFar(p: PlayerActor, dist: number): void {
    if (dist > DIVE_MAX + 2.5) {
      this.decided.delete(p);
    }
  }
}

/** How fast `p` is closing on the carrier (yd/s). */
function closing(p: PlayerActor, carrier: PlayerActor): number {
  const dist = Math.max(xzDist(p, carrier), 0.01);
  const v = p.velocity();
  const c = carrier.velocity();
  const tx = (carrier.x - p.x) / dist;
  const tz = (carrier.z - p.z) / dist;
  return (v.x - c.x) * tx + (v.z - c.z) * tz;
}
