/**
 * Ball carrier after the catch (or a QB scramble): the front
 * defender, the juke, pursuit and the tackle. FootballGame owns
 * the drive result; this only says when the run is over.
 */

import { GOAL_Z, HALF_W, TACKLE_RANGE, YAC_SPEED } from './constants';
import { isCoverage } from './coverage-play';
import { clamp, xzDist } from './math';
import type { PlayerActor } from './players';
import type { Vec2 } from './types';

const RECEIVER_YAC_TIME = 5.2;
const QB_RUN_SPEED = 6.6;
const TACKLE_SETTLE_TIME = 1.65;
const JUKE_CHANCE = 0.54;
const JUKE_RANGE = 3.15;
const JUKE_TIME = 0.82;

export type JukeState =
  | 'none'
  | 'approach'
  | 'cut'
  | 'escaped'
  | 'stuffed'
  | 'down';

export type JukeResult = 'won' | 'stuffed' | null;

type Toast = (msg: string, bad: boolean) => void;

export class YacRun {
  carrier: PlayerActor | null = null;
  front: PlayerActor | null = null;
  tackler: PlayerActor | null = null;
  state: JukeState = 'none';
  lastJuke: JukeResult = null;
  lastTacklerId: string | null = null;
  private jukeTarget: Vec2 | null = null;
  private requested = 0;
  private yacT = 0;
  private jukeT = 0;
  private tackleT = 0;
  private frontMissT = 0;

  constructor(
    private readonly players: PlayerActor[],
    private readonly toast: Toast
  ) {}

  /** Between snaps: nobody is carrying the ball. */
  clear(): void {
    this.carrier = null;
    this.front = null;
    this.tackler = null;
    this.state = 'none';
    this.jukeTarget = null;
    this.requested = 0;
    this.yacT = 0;
    this.jukeT = 0;
    this.tackleT = 0;
    this.frontMissT = 0;
  }

  /** New drive: also forget the last juke and tackler. */
  forget(): void {
    this.lastJuke = null;
    this.lastTacklerId = null;
  }

  /** Receiver caught it: square up to the nearest defender. */
  start(carrier: PlayerActor): void {
    this.clear();
    this.carrier = carrier;
    this.front = this.pickFrontDefender(carrier);
    this.state = this.front ? 'approach' : 'none';
    this.lastJuke = null;
  }

  /** QB crossed the line: the player steers, no scripted juke. */
  startScramble(qb: PlayerActor): void {
    this.start(qb);
    this.front = null;
    this.state = 'none';
  }

  isDown(): boolean {
    return this.carrier?.isDown() ?? false;
  }

  /** Let the player call a left or right cut. */
  requestJuke(direction: number): void {
    if (this.state !== 'approach') {
      return;
    }
    this.requested = direction < 0 ? -1 : 1;
    const front = this.front;
    if (front && this.carrier && this.yacT >= 0.32 &&
        xzDist(front, this.carrier) < JUKE_RANGE + 1.2) {
      this.beginJuke(this.carrier);
    }
  }

  /** Move the carrier; `stick` steers him when he is the QB. */
  move(dt: number, qb: PlayerActor, stick: Vec2): void {
    const wr = this.carrier;
    if (!wr) {
      return;
    }
    if (wr.isDown()) {
      wr.updateRagdoll(dt);
      return;
    }
    if (wr === qb) {
      moveQb(qb, dt, stick);
      return;
    }
    if (this.state === 'cut' && this.jukeTarget) {
      wr.chase(this.jukeTarget, dt, this.carrierSpeed(wr));
      return;
    }
    wr.advance(dt, this.carrierSpeed(wr));
  }

  poseTackler(): void {
    const carrier = this.carrier;
    const tackler = this.tackler;
    if (!carrier || !tackler) {
      return;
    }
    tackler.facePoint(carrier);
    const progress = clamp(this.tackleT / 0.62, 0, 1);
    tackler.setAnim('tackle', progress, 0);
    tackler.place();
  }

  /** Returns true when the run is over (tackle, sideline, goal). */
  tick(dt: number, qb: PlayerActor): boolean {
    const wr = this.carrier;
    if (!wr) {
      return false;
    }
    this.yacT += dt;
    this.jukeT += dt;
    this.frontMissT = Math.max(0, this.frontMissT - dt);
    if (wr.isDown()) {
      this.tackleT += dt;
      return this.tackleT >= TACKLE_SETTLE_TIME;
    }
    this.updateJuke(wr);
    wr.x = clamp(wr.x, -HALF_W + 0.35, HALF_W - 0.35);
    if (wr.z >= GOAL_Z) {
      return true;
    }
    if (Math.abs(wr.x) >= HALF_W - 0.4) {
      return true;
    }
    const tackler = this.findTackler(wr);
    if (tackler) {
      this.startTackle(wr, tackler);
      return false;
    }
    return wr !== qb && this.yacT >= RECEIVER_YAC_TIME;
  }

  status(): string {
    switch (this.state) {
      case 'approach':
        return 'Defender ahead slows YAC. A/Q or D calls the cut.';
      case 'cut':
        return 'Juke in progress — the outcome is not guaranteed.';
      case 'escaped':
        return 'Juke won. Trailing pursuit still has closing speed.';
      case 'stuffed':
        return 'Juke stuffed. Fight through contact and pursuit.';
      case 'down':
        return 'Tackled. The carrier is physically going to ground.';
      default:
        return 'Catch. Turn upfield before pursuit closes.';
    }
  }

  private carrierSpeed(wr: PlayerActor): number {
    if (this.state === 'cut') {
      return this.lastJuke === 'won' ? 5.85 : 4.35;
    }
    if (this.state === 'stuffed') {
      return this.jukeT < 0.9 ? 4.65 : 6.35;
    }
    if (this.state === 'escaped' && this.jukeT < 0.45) {
      return 6.25;
    }
    const front = this.front;
    if (this.state !== 'approach' || !front) {
      return YAC_SPEED;
    }
    const distance = xzDist(wr, front);
    const factor = clamp(0.62 + distance * 0.065, 0.68, 1);
    return YAC_SPEED * factor;
  }

  private updateJuke(wr: PlayerActor): void {
    const front = this.front;
    if (this.state === 'approach' && !front) {
      this.state = 'none';
      return;
    }
    if (this.state === 'approach' && front &&
        this.yacT >= 0.38 &&
        xzDist(wr, front) <= JUKE_RANGE) {
      this.beginJuke(wr);
      return;
    }
    if (this.state !== 'cut' || this.jukeT < JUKE_TIME) {
      return;
    }
    const won = this.lastJuke === 'won';
    this.state = won ? 'escaped' : 'stuffed';
    this.jukeT = 0;
    this.frontMissT = won ? 1.05 : 0.3;
    if (won) {
      front?.lockAnim('stumble', 0.78);
    }
    this.toast(won ? 'JUKE WON' : 'JUKE STUFFED', !won);
  }

  private beginJuke(wr: PlayerActor): void {
    if (this.state !== 'approach') {
      return;
    }
    const direction = this.jukeDirection(wr);
    const won = Math.random() < JUKE_CHANCE;
    const width = won ? 2.75 : 1.05;
    const gain = won ? 2.55 : 1.25;
    this.lastJuke = won ? 'won' : 'stuffed';
    this.state = 'cut';
    this.jukeT = 0;
    this.jukeTarget = {
      x: clamp(
        wr.x + direction * width,
        -HALF_W + 0.8,
        HALF_W - 0.8
      ),
      z: wr.z + gain
    };
    wr.lockAnim('juke', JUKE_TIME);
    const side = direction < 0 ? 'LEFT' : 'RIGHT';
    this.toast(`JUKE ${side}`, false);
  }

  private jukeDirection(wr: PlayerActor): number {
    if (this.requested !== 0) {
      return this.requested;
    }
    const front = this.front;
    if (front && Math.abs(front.x - wr.x) > 0.2) {
      return front.x > wr.x ? -1 : 1;
    }
    return wr.x > 0 ? -1 : 1;
  }

  private startTackle(wr: PlayerActor, tackler: PlayerActor): void {
    this.tackler = tackler;
    this.lastTacklerId = tackler.def.id;
    this.tackleT = 0;
    this.state = 'down';
    this.frontMissT = 0;
    wr.startRagdoll(tackler);
    tackler.facePoint(wr);
    tackler.lockAnim('tackle', 0.72);
    this.toast(`TACKLED · #${tackler.def.number}`, true);
  }

  private findTackler(wr: PlayerActor): PlayerActor | null {
    const catchBalance = this.state === 'approach' &&
      this.yacT < 0.38;
    if (this.state === 'cut' || catchBalance) {
      return null;
    }
    let tackler: PlayerActor | null = null;
    let distance = TACKLE_RANGE;
    for (const p of this.players) {
      if (p.def.side !== 'defense' || p.isDown()) {
        continue;
      }
      const frontMiss = p === this.front && this.frontMissT > 0;
      const next = xzDist(wr, p);
      if (!frontMiss && next < distance) {
        tackler = p;
        distance = next;
      }
    }
    return tackler;
  }

  private pickFrontDefender(carrier: PlayerActor): PlayerActor | null {
    let best: PlayerActor | null = null;
    let score = 99;
    for (const defender of this.players) {
      if (!isCoverage(defender.def.pos)) {
        continue;
      }
      const angleCost = Math.abs(defender.x - carrier.x) * 0.18;
      const behind = Math.max(0, carrier.z - defender.z) * 0.45;
      const next = xzDist(carrier, defender) + angleCost + behind;
      if (next < score) {
        best = defender;
        score = next;
      }
    }
    return best;
  }
}

function moveQb(qb: PlayerActor, dt: number, stick: Vec2): void {
  const length = Math.hypot(stick.x, stick.z);
  if (length < 0.2) {
    qb.coast(dt);
    return;
  }
  const x = stick.x / Math.max(1, length);
  const z = stick.z / Math.max(1, length);
  const target = {
    x: qb.x + x * 5,
    z: qb.z + z * 5
  };
  qb.chase(target, dt, QB_RUN_SPEED);
}
