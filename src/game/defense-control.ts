/**
 * The player on defense: the call sheet, which defender he
 * controls (gold ring), switching to the man nearest the ball,
 * and running that defender with the stick.
 */

import {
  COVER0,
  COVER1,
  COVER1_BLITZ,
  COVER2,
  COVER3,
  COVER3_FIRE,
  COVER4,
  type CoverLook
} from './coverage-looks';
import { xzDist } from './math';
import type { PlayerActor } from './players';
import type { Vec2 } from './types';

export interface DefCall {
  look: CoverLook;
  /** Chip under the call in the audible bar. */
  beat: string;
}

/** Keys 1–7 before the snap. */
export const DEF_CALLS: DefCall[] = [
  { look: COVER3, beat: '3 deep' },
  { look: COVER2, beat: '2 deep' },
  { look: COVER4, beat: 'quarters' },
  { look: COVER1, beat: 'man + FS' },
  { look: COVER1_BLITZ, beat: 'Mike blitz' },
  { look: COVER3_FIRE, beat: 'zone blitz' },
  { look: COVER0, beat: 'all-out' }
];

const RUN_SPEED = 6.2;
/** Before the snap: walk to a new alignment. */
const SHIFT_SPEED = 3.2;
const SPRINT_SPEED = 7.0;

export class DefenseControl {
  /** Controlled defender, null on offense. */
  user: PlayerActor | null = null;
  callIdx = 0;

  call(): DefCall {
    return DEF_CALLS[this.callIdx];
  }

  /** Pick a call; returns false when the index is out of range. */
  setCall(i: number): boolean {
    if (i < 0 || i >= DEF_CALLS.length) {
      return false;
    }
    this.callIdx = i;
    return true;
  }

  /** Hand control to `p` (or nobody) and move the gold ring. */
  take(p: PlayerActor | null): void {
    this.user?.setMarked(false);
    this.user = p;
    p?.setMarked(true);
  }

  /** Re-draw the ring (a reset clears it). */
  mark(): void {
    this.user?.setMarked(true);
  }

  /**
   * Switch to the controllable defender nearest `ball` (not the
   * one already controlled, unless he is the only choice).
   */
  switchNear(ball: Vec2, pool: PlayerActor[]): void {
    let best: PlayerActor | null = null;
    let dist = 999;
    for (const p of pool) {
      if (p === this.user || p.isDown()) {
        continue;
      }
      const d = xzDist(p, ball);
      if (d < dist) {
        dist = d;
        best = p;
      }
    }
    if (best) {
      this.take(best);
    }
  }

  /**
   * Before the snap: walk him somewhere else, never offside
   * (the defense lines up on the +z side of the ball).
   */
  shift(dt: number, stick: Vec2, losZ: number): void {
    const p = this.user;
    if (!p) {
      return;
    }
    const len = Math.hypot(stick.x, stick.z);
    if (len < 0.2) {
      p.update(dt, false);
    } else {
      const to = {
        x: p.x + (stick.x / Math.max(1, len)) * 3,
        z: p.z + (stick.z / Math.max(1, len)) * 3
      };
      p.chase(to, dt, SHIFT_SPEED);
    }
    p.z = Math.max(p.z, losZ + 1);
  }

  /** Label for the on-screen help: number and position. */
  label(): string {
    const p = this.user;
    return p ? `#${p.def.number} ${p.def.label}` : '';
  }

  /** Stick in world axes (already flipped for the defense camera). */
  move(dt: number, stick: Vec2, sprint: boolean): void {
    const p = this.user;
    if (!p || p.isDown()) {
      return;
    }
    const len = Math.hypot(stick.x, stick.z);
    if (len < 0.2) {
      p.coast(dt);
      return;
    }
    const to = {
      x: p.x + (stick.x / Math.max(1, len)) * 5,
      z: p.z + (stick.z / Math.max(1, len)) * 5
    };
    p.chase(to, dt, sprint ? SPRINT_SPEED : RUN_SPEED);
  }
}
