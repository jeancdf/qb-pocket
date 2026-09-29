import {
  Match,
  type BreakCard,
  type DriveEnd,
  type PlayEnd
} from './match';

export type FlowNext =
  | { kind: 'drive'; startZ: number }
  | { kind: 'wait' }
  | { kind: 'menu' };

type Step = 'play' | 'next' | 'menu';

export interface MatchOptions {
  /** Short name on the scorebug. */
  awayTag?: string;
  /** Line under the final score. */
  finalHint?: (outcome: 'win' | 'loss' | 'tie') => string;
  /** Called once when the final whistle blows. */
  onFinal?: (outcome: 'win' | 'loss' | 'tie') => void;
}

const HOME_END: Record<DriveEnd, string> = {
  td: 'TOUCHDOWN',
  downs: 'TURNOVER ON DOWNS',
  pick: 'INTERCEPTÉ',
  punt: 'PUNT',
  clock: 'FIN DE LA MI-TEMPS'
};

const AWAY_END: Record<DriveEnd, string> = {
  td: 'TOUCHDOWN ADVERSE',
  downs: 'STOPPÉS SUR 4E TENTATIVE',
  pick: 'INTERCEPTION !',
  punt: 'PUNT ADVERSE',
  clock: 'FIN DE LA MI-TEMPS'
};

/**
 * One match between snaps: who gets the ball next and what the
 * break card says. Both possessions are played: the player is
 * the offense when home has the ball, the defense otherwise.
 */
export class MatchFlow {
  readonly match = new Match();
  card: BreakCard | null = null;
  private step: Step = 'play';

  /** `skill` 0..1: how good the CPU team is. */
  constructor(
    readonly skill: number,
    readonly opts: MatchOptions = {}
  ) {}

  /** A snap is dead: run the clock. */
  playOver(end: PlayEnd): 'none' | 'half' | 'final' {
    return this.match.afterPlay(end);
  }

  /** The possession is over (score, turnover, clock). */
  driveOver(
    end: DriveEnd,
    endZ: number,
    clock: 'none' | 'half' | 'final'
  ): void {
    const m = this.match;
    const team = m.offense;
    if (end === 'td') {
      m.addTd(team);
    }
    const head = team === 'home' ? HOME_END[end] : AWAY_END[end];
    // Good news for the player: their score, or a stop.
    const good = team === 'home' ? end === 'td' : end !== 'td';
    if (clock === 'final' || m.finished) {
      const out = m.outcome();
      this.card = m.finalCard(this.opts.finalHint?.(out));
      this.step = 'menu';
      this.opts.onFinal?.(out);
      return;
    }
    if (clock === 'half') {
      m.openSecondHalf();
      this.show(head, 'MI-TEMPS', this.nextHint(), false);
      this.step = 'next';
      return;
    }
    m.changePossession(end, endZ);
    this.show(head, this.scoreLine(), this.nextHint(), !good);
    this.step = 'next';
  }

  /** Space / SNAP on a break card. */
  advance(): FlowNext {
    if (this.step === 'menu') {
      return { kind: 'menu' };
    }
    if (this.step === 'next') {
      this.card = null;
      this.step = 'play';
      return { kind: 'drive', startZ: this.match.startZ };
    }
    return { kind: 'wait' };
  }

  private nextHint(): string {
    return this.match.offense === 'home'
      ? 'Espace — à toi en attaque'
      : 'Espace — en défense';
  }

  private show(
    kicker: string,
    title: string,
    hint: string,
    bad: boolean
  ): void {
    this.card = { kicker, title, hint, bad };
  }

  private scoreLine(): string {
    return `${this.match.home} – ${this.match.away}`;
  }
}
