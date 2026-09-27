/**
 * Where the QB is looking. The cursor hover (aim preview) is the
 * QB's eyes: the receiver nearest that spot is the focus, and the
 * longer the QB stares, the harder zone defenders drift to him.
 *
 * On the throw, the read tells the defense how early it broke:
 * - 'stared'  : eyes locked on the target → defenders jump it.
 * - 'lookoff' : eyes were elsewhere just before → defenders late.
 * - 'neutral' : no strong tell either way.
 */

import { clamp, xzDist } from './math';
import type { PlayerActor } from './players';
import type { Vec2 } from './types';

export type EyeRead = 'stared' | 'neutral' | 'lookoff';

export interface EyeFocus {
  id: string;
  stare: number;
}

/** Gaze must sit this close to a receiver to lock on him. */
const LOCK_R = 6.5;
/** Once locked, the eyes stay with him inside this radius. */
const HOLD_R = 9;
const STARE_READ = 0.7;
const LOOKOFF_STARE = 0.45;
const LOOKOFF_WINDOW = 0.35;
/** QB shoulders never turn further than this from downfield. */
const MAX_TURN = 1.25;

export class QbEyes {
  private gaze: Vec2 | null = null;
  private focusId: string | null = null;
  private stare = 0;
  private prevId: string | null = null;
  private prevStare = 0;
  private sinceSwitch = 99;

  reset(): void {
    this.gaze = null;
    this.focusId = null;
    this.stare = 0;
    this.prevId = null;
    this.prevStare = 0;
    this.sinceSwitch = 99;
  }

  look(spot: Vec2): void {
    this.gaze = { x: spot.x, z: spot.z };
  }

  focus(): EyeFocus | null {
    if (!this.focusId) {
      return null;
    }
    return { id: this.focusId, stare: this.stare };
  }

  /**
   * Update the focus from the gaze point. `fake` (play-action)
   * turns the QB to the mesh instead of reading the field.
   */
  tick(
    dt: number,
    recs: PlayerActor[],
    qb: PlayerActor,
    turnQb: boolean,
    fake: Vec2 | null
  ): void {
    this.sinceSwitch += dt;
    const next = this.pickFocus(recs);
    if (next === this.focusId) {
      this.stare += next ? dt : 0;
    } else {
      this.prevId = this.focusId;
      this.prevStare = this.stare;
      this.focusId = next;
      this.stare = 0;
      this.sinceSwitch = 0;
    }
    if (!turnQb) {
      return;
    }
    const to = fake ?? this.gaze;
    if (to) {
      faceClamped(qb, to, dt);
    }
  }

  /** How the defense reads the QB's eyes on a throw at `targetId`. */
  readOn(targetId: string | null): EyeRead {
    if (!targetId || !this.focusId) {
      return 'neutral';
    }
    if (this.focusId === targetId) {
      const quickFlip = this.sinceSwitch < LOOKOFF_WINDOW &&
        this.prevId !== null &&
        this.prevId !== targetId &&
        this.prevStare >= LOOKOFF_STARE;
      if (quickFlip) {
        return 'lookoff';
      }
      return this.stare >= STARE_READ ? 'stared' : 'neutral';
    }
    return this.stare >= LOOKOFF_STARE ? 'lookoff' : 'neutral';
  }

  private pickFocus(recs: PlayerActor[]): string | null {
    const gaze = this.gaze;
    if (!gaze) {
      return null;
    }
    const held = recs.find((r) => r.def.id === this.focusId);
    if (held && xzDist(held, gaze) < HOLD_R) {
      const best = nearest(gaze, recs);
      // Only switch when another receiver is clearly closer.
      if (!best || best === held ||
          xzDist(best, gaze) + 2 > xzDist(held, gaze)) {
        return held.def.id;
      }
    }
    const best = nearest(gaze, recs);
    if (!best || xzDist(best, gaze) > LOCK_R) {
      return null;
    }
    return best.def.id;
  }
}

function nearest(
  spot: Vec2,
  recs: PlayerActor[]
): PlayerActor | null {
  let best: PlayerActor | null = null;
  let dist = Number.POSITIVE_INFINITY;
  for (const r of recs) {
    const d = xzDist(r, spot);
    if (d < dist) {
      dist = d;
      best = r;
    }
  }
  return best;
}

function faceClamped(
  qb: PlayerActor,
  to: Vec2,
  dt: number
): void {
  const want = Math.atan2(to.x - qb.x, to.z - qb.z);
  const turn = clamp(want, -MAX_TURN, MAX_TURN);
  const k = 1 - Math.exp(-dt * 9);
  qb.facing += (turn - qb.facing) * k;
  qb.mesh.rotation.y = qb.facing;
}
