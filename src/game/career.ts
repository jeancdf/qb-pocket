/**
 * Mini career: five matches, each opponent a step harder. Win to
 * move on; a loss or a tie replays the same match. Progress is
 * kept in this browser only.
 */

export interface Opponent {
  name: string;
  /** Short name for the scorebug. */
  tag: string;
  /** CPU difficulty 0..1. */
  skill: number;
}

export const OPPONENTS: Opponent[] = [
  { name: 'Loups de Lille', tag: 'LILLE', skill: 0.15 },
  { name: 'Corsaires de Nantes', tag: 'NANTES', skill: 0.33 },
  { name: 'Titans de Toulouse', tag: 'TOULOUSE', skill: 0.5 },
  { name: 'Aigles de Paris', tag: 'PARIS', skill: 0.68 },
  { name: 'Rois de Marseille', tag: 'MARSEILLE', skill: 0.86 }
];

const KEY = 'qb-pocket.career';

interface Saved {
  /** Index of the next match to play (5 = champion). */
  next: number;
  wins: number;
  losses: number;
}

export class Career {
  private state: Saved = { next: 0, wins: 0, losses: 0 };

  constructor() {
    this.load();
  }

  /** Opponent of the next match; a finished career starts over. */
  opponent(): Opponent {
    if (this.champion()) {
      this.state = { next: 0, wins: 0, losses: 0 };
      this.save();
    }
    return OPPONENTS[this.state.next];
  }

  matchNo(): number {
    return Math.min(this.state.next, OPPONENTS.length - 1) + 1;
  }

  champion(): boolean {
    return this.state.next >= OPPONENTS.length;
  }

  record(): string {
    return `${this.state.wins}-${this.state.losses}`;
  }

  /** Match over: a win moves on, anything else replays it. */
  finish(outcome: 'win' | 'loss' | 'tie'): void {
    if (outcome === 'win') {
      this.state.wins += 1;
      this.state.next += 1;
    } else {
      this.state.losses += 1;
    }
    this.save();
  }

  /** Line for the title screen card. */
  summary(): { kicker: string; blurb: string } {
    if (this.champion()) {
      return {
        kicker: `Champion · bilan ${this.record()}`,
        blurb: 'Saison gagnée. Relance une carrière depuis le premier match.'
      };
    }
    const opp = OPPONENTS[this.state.next];
    const level = Math.round(opp.skill * 10);
    return {
      kicker: `Match ${this.matchNo()}/5 · bilan ${this.record()}`,
      blurb: `Prochain adversaire : ${opp.name} (niveau ${level}/10). Gagne pour avancer.`
    };
  }

  private load(): void {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) {
        return;
      }
      const s = JSON.parse(raw) as Partial<Saved>;
      this.state = {
        next: clampInt(s.next, 0, OPPONENTS.length),
        wins: clampInt(s.wins, 0, 999),
        losses: clampInt(s.losses, 0, 999)
      };
    } catch {
      // No storage (private window): the career lives in memory.
    }
  }

  private save(): void {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch {
      // Same: keep going without persistence.
    }
  }
}

function clampInt(n: unknown, lo: number, hi: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : lo;
  return Math.min(hi, Math.max(lo, v));
}
