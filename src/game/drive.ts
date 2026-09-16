import { clamp } from './math';
import {
  BACK_GOAL_Z,
  DRIVE_START_Z,
  GOAL_Z
} from './constants';

export type Down = 1 | 2 | 3 | 4;
export type DriveResult =
  | 'first'
  | 'continue'
  | 'turnover'
  | 'td';

const ORD: Record<Down, string> = {
  1: '1ST',
  2: '2ND',
  3: '3RD',
  4: '4TH'
};

/** Down, distance, and field position for one offensive series. */
export class Drive {
  losZ = DRIVE_START_Z;
  down: Down = 1;
  toGo = 10;
  home = 0;
  away = 0;
  won = false;
  lost = false;

  lineToGain(): number {
    return Math.min(GOAL_Z, this.losZ + this.toGo);
  }

  remain(): number {
    return GOAL_Z - this.losZ;
  }

  /** Spot the ball after a completion + YAC. */
  gainTo(spotZ: number): DriveResult {
    const next = clamp(spotZ, BACK_GOAL_Z + 1, GOAL_Z);
    const gain = next - this.losZ;
    this.losZ = next;
    if (this.losZ >= GOAL_Z - 0.2) {
      return 'td';
    }
    if (gain + 0.05 >= this.toGo) {
      this.newFirst();
      return 'first';
    }
    this.toGo = Math.max(0.5, this.toGo - gain);
    return this.burnDown();
  }

  incomplete(): DriveResult {
    return this.burnDown();
  }

  sackAt(qbZ: number): DriveResult {
    const next = Math.min(this.losZ, qbZ);
    const loss = this.losZ - next;
    this.losZ = Math.max(BACK_GOAL_Z + 1, next);
    this.toGo += loss;
    return this.burnDown();
  }

  scoreTd(): void {
    this.home += 7;
    this.won = true;
  }

  turnover(): void {
    this.lost = true;
  }

  kickoff(): void {
    this.losZ = DRIVE_START_Z;
    this.down = 1;
    this.toGo = 10;
    this.won = false;
    this.lost = false;
  }

  over(): boolean {
    return this.won || this.lost;
  }

  downLine(): string {
    const dist = this.remain() <= this.toGo + 0.2
      ? 'GOAL'
      : String(Math.max(1, Math.round(this.toGo)));
    return `${ORD[this.down]} & ${dist} · ${spotName(this.losZ)}`;
  }

  private newFirst(): void {
    this.down = 1;
    this.toGo = Math.min(10, this.remain());
  }

  private burnDown(): DriveResult {
    if (this.down === 4) {
      return 'turnover';
    }
    this.down = (this.down + 1) as Down;
    return 'continue';
  }
}

export function spotName(losZ: number): string {
  const own = Math.round(losZ - BACK_GOAL_Z);
  if (own < 50) {
    return `OWN ${own}`;
  }
  if (own === 50) {
    return '50';
  }
  return `OPP ${100 - own}`;
}
