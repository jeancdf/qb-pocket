import {
  Match,
  type BreakCard,
  type DriveEnd,
  type PlayEnd
} from './match';
import { simulateDrive } from './opponent-sim';

export type FlowNext =
  | { kind: 'drive'; startZ: number }
  | { kind: 'wait' }
  | { kind: 'menu' };

type Step = 'play' | 'cpu' | 'home' | 'menu';

const HOME_END: Record<DriveEnd, string> = {
  td: 'TOUCHDOWN',
  downs: 'TURNOVER ON DOWNS',
  pick: 'INTERCEPTÉ',
  punt: 'PUNT',
  clock: 'FIN DE LA MI-TEMPS'
};

const CPU_END: Record<DriveEnd, string> = {
  td: 'TOUCHDOWN',
  downs: 'ARRÊTÉ SUR 4E TENTATIVE',
  pick: 'INTERCEPTION',
  punt: 'PUNT',
  clock: 'FIN DE LA MI-TEMPS'
};

/**
 * One match between snaps: who gets the ball next, what the
 * break card says, and the CPU possessions (simulated for now).
 */
export class MatchFlow {
  readonly match = new Match();
  card: BreakCard | null = null;
  private step: Step = 'play';

  /** `skill` 0..1: how good the CPU team is. */
  constructor(private readonly skill: number) {}

  /** A player snap is dead: run the clock. */
  playOver(end: PlayEnd): 'none' | 'half' | 'final' {
    return this.match.afterPlay(end);
  }

  /** The player's possession is over (score, turnover, clock). */
  homeDriveOver(
    end: DriveEnd,
    endZ: number,
    clock: 'none' | 'half' | 'final'
  ): void {
    const m = this.match;
    if (end === 'td') {
      m.addTd('home');
    }
    const head = HOME_END[end];
    if (clock === 'final' || m.finished) {
      this.final();
      return;
    }
    if (clock === 'half') {
      m.openSecondHalf();
      this.show(head, 'MI-TEMPS', "Espace — l'adversaire reçoit", false);
      this.step = 'cpu';
      return;
    }
    m.changePossession(end, endZ);
    this.show(
      head,
      this.scoreLine(),
      "Espace — l'adversaire a le ballon",
      end !== 'td'
    );
    this.step = 'cpu';
  }

  /** Space / SNAP on a break card. */
  advance(): FlowNext {
    if (this.step === 'menu') {
      return { kind: 'menu' };
    }
    if (this.step === 'home') {
      this.card = null;
      this.step = 'play';
      return { kind: 'drive', startZ: this.match.startZ };
    }
    if (this.step === 'cpu') {
      this.runCpuDrive();
    }
    return { kind: 'wait' };
  }

  private runCpuDrive(): void {
    const m = this.match;
    const sim = simulateDrive(m.startZ, this.skill);
    if (sim.end === 'td') {
      m.addTd('away');
    }
    const clock = m.burn(sim.seconds);
    const head = `ADVERSAIRE · ${CPU_END[sim.end]} · ${sim.plays} JEUX`;
    if (clock === 'final' || m.finished) {
      this.final();
      return;
    }
    if (clock === 'half') {
      m.openSecondHalf();
      this.show(head, 'MI-TEMPS', "Espace — l'adversaire reçoit", false);
      this.step = 'cpu';
      return;
    }
    m.changePossession(sim.end, sim.endZ);
    this.show(head, this.scoreLine(), 'Espace — à toi', sim.end === 'td');
    this.step = 'home';
  }

  private final(): void {
    this.card = this.match.finalCard();
    this.step = 'menu';
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
