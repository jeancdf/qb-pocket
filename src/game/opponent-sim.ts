import { GOAL_Z } from './constants';
import type { DriveEnd } from './match';

export interface SimDrive {
  end: DriveEnd;
  plays: number;
  seconds: number;
  /** Where the ball is at the end (world z, CPU attacking +z). */
  endZ: number;
}

const PUNT_NET = 40;

/**
 * A CPU possession resolved off-screen, play by play. `skill`
 * 0..1 tilts the gains and the mistakes.
 */
export function simulateDrive(startZ: number, skill: number): SimDrive {
  let los = startZ;
  let down = 1;
  let toGo = 10;
  let plays = 0;
  let seconds = 0;
  for (let guard = 0; guard < 40; guard += 1) {
    if (down === 4 && !(toGo <= 2 && los > 0)) {
      return {
        end: 'punt',
        plays,
        seconds: seconds + 8,
        endZ: Math.min(los + PUNT_NET, GOAL_Z - 20)
      };
    }
    plays += 1;
    const roll = Math.random();
    if (roll < 0.035 - skill * 0.02) {
      return { end: 'pick', plays, seconds: seconds + 7, endZ: los };
    }
    let gain = 0;
    if (roll < 0.3 - skill * 0.1) {
      seconds += 6;
    } else {
      gain = Math.random() * (9 + skill * 6) - 1.5;
      if (Math.random() < 0.06 + skill * 0.08) {
        gain += 12 + Math.random() * 25;
      }
      seconds += 28;
    }
    los += gain;
    if (los >= GOAL_Z) {
      return { end: 'td', plays, seconds, endZ: GOAL_Z };
    }
    if (gain >= toGo) {
      down = 1;
      toGo = 10;
    } else {
      toGo -= gain;
      if (down === 4) {
        return { end: 'downs', plays, seconds, endZ: los };
      }
      down += 1;
    }
  }
  return { end: 'punt', plays, seconds, endZ: los };
}
