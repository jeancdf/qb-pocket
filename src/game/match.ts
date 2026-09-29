import { BACK_GOAL_Z, GOAL_Z } from './constants';
import { clamp } from './math';

/** Home is the player's team, away the CPU. */
export type Team = 'home' | 'away';

/** How a single snap ended, for the game clock. */
export type PlayEnd =
  | 'tackle'
  | 'incomplete'
  | 'score'
  | 'turnover';

/** How a possession ended. */
export type DriveEnd = 'td' | 'downs' | 'pick' | 'punt' | 'clock';

/** Between possessions, and at the final whistle. */
export interface BreakCard {
  kicker: string;
  title: string;
  hint: string;
  bad: boolean;
}

export const QUARTERS = 4;
/** Game-clock seconds per quarter. */
export const QUARTER_SEC = 240;
/** Clock that runs off between snaps after an in-bounds play. */
const RUNOFF = 20;
/** Touchback after a score: own 25. */
export const OWN_25 = BACK_GOAL_Z + 25;

/**
 * Score, game clock, quarters and who has the ball. The field
 * never flips: whoever has the ball attacks +z, so a change of
 * possession mirrors the spot (z → -z).
 */
export class Match {
  quarter = 1;
  clock = QUARTER_SEC;
  home = 0;
  away = 0;
  offense: Team = 'home';
  /** Line of scrimmage the next possession starts on. */
  startZ = OWN_25;
  finished = false;
  private halfDone = false;

  /** Live-ball time. The clock only moves while the ball is live. */
  tick(dt: number): void {
    if (!this.finished) {
      this.clock = Math.max(0, this.clock - dt);
    }
  }

  /**
   * Whistle: run the clock off between snaps, then roll the
   * quarter. Returns 'half' / 'final' when the possession must
   * stop right here.
   */
  afterPlay(end: PlayEnd): 'none' | 'half' | 'final' {
    if (end === 'tackle') {
      this.clock = Math.max(0, this.clock - RUNOFF);
    }
    return this.rollQuarter();
  }

  /** Burn clock for a drive the player did not play. */
  burn(seconds: number): 'none' | 'half' | 'final' {
    let left = seconds;
    while (left > 0 && !this.finished) {
      const step = Math.min(left, this.clock);
      this.clock -= step;
      left -= step;
      const roll = this.rollQuarter();
      if (roll !== 'none') {
        return roll;
      }
      if (step === 0) {
        break;
      }
    }
    return 'none';
  }

  addTd(team: Team): void {
    if (team === 'home') {
      this.home += 7;
    } else {
      this.away += 7;
    }
  }

  /**
   * The ball changes hands. `endZ` is where the old offense left
   * it (world z, attacking +z).
   */
  changePossession(end: DriveEnd, endZ: number): void {
    this.offense = other(this.offense);
    if (end === 'td' || end === 'clock') {
      this.startZ = OWN_25;
      return;
    }
    // Mirror the spot for the new offense; keep it off the goal line.
    this.startZ = clamp(-endZ, BACK_GOAL_Z + 1, GOAL_Z - 1);
  }

  /** Second half: the team that did not open gets the ball. */
  openSecondHalf(): void {
    this.offense = 'away';
    this.startZ = OWN_25;
  }

  clockLine(): string {
    const q = this.quarter > QUARTERS ? 'FIN' : `Q${this.quarter}`;
    const s = Math.ceil(this.clock);
    const mm = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, '0');
    return `${q} ${mm}:${ss}`;
  }

  outcome(): 'win' | 'loss' | 'tie' {
    if (this.home > this.away) {
      return 'win';
    }
    return this.home < this.away ? 'loss' : 'tie';
  }

  finalCard(hint = 'Espace — retour au menu'): BreakCard {
    const out = this.outcome();
    const title = out === 'win'
      ? 'VICTOIRE'
      : out === 'loss' ? 'DÉFAITE' : 'ÉGALITÉ';
    return {
      kicker: `FIN DU MATCH · ${this.home} – ${this.away}`,
      title,
      hint,
      bad: out !== 'win'
    };
  }

  private rollQuarter(): 'none' | 'half' | 'final' {
    if (this.clock > 0 || this.finished) {
      return 'none';
    }
    this.quarter += 1;
    if (this.quarter > QUARTERS) {
      this.finished = true;
      return 'final';
    }
    this.clock = QUARTER_SEC;
    if (this.quarter === 3 && !this.halfDone) {
      this.halfDone = true;
      return 'half';
    }
    return 'none';
  }
}

export function other(team: Team): Team {
  return team === 'home' ? 'away' : 'home';
}
