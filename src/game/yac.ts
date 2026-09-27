/**
 * Ball carrier after the catch (or a QB scramble): the front
 * defender, the juke, pursuit and the tackle. FootballGame owns
 * the drive result; this only says when the run is over.
 */

import { GOAL_Z, HALF_W, TACKLE_RANGE, YAC_SPEED } from './constants';
import { clamp, xzDist } from './math';
import type { PlayerActor } from './players';
import type { Vec2 } from './types';

const QB_RUN_SPEED = 6.6;
/** Shift: top-speed boost while the burst lasts. */
const SPRINT_BOOST = 1.18;
/** Seconds of full sprint, and refill per second when walking it off. */
const SPRINT_TANK = 2.4;
const SPRINT_REFILL = 0.5;
/** Pause between two jukes. */
const JUKE_COOLDOWN = 0.9;
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
  private jukeCool = 0;
  /** Sprint fuel in seconds. */
  sprintLeft = SPRINT_TANK;

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
    this.jukeCool = 0;
    this.sprintLeft = SPRINT_TANK;
  }

  /** New drive: also forget the last juke and tackler. */
  forget(): void {
    this.lastJuke = null;
    this.lastTacklerId = null;
  }

  /** Someone has the ball in the open field: the player steers. */
  start(carrier: PlayerActor): void {
    this.clear();
    this.carrier = carrier;
    this.lastJuke = null;
  }

  /** QB crossed the line: same controls as a receiver. */
  startScramble(qb: PlayerActor): void {
    this.start(qb);
  }

  isDown(): boolean {
    return this.carrier?.isDown() ?? false;
  }

  /**
   * Space: cut on the nearest defender. `direction` is the world
   * side (+x / -x); 0 means cut away from him.
   */
  requestJuke(direction: number): void {
    const wr = this.carrier;
    if (!wr || wr.isDown() || this.jukeCool > 0) {
      return;
    }
    if (this.state === 'cut' || this.state === 'down') {
      return;
    }
    const front = this.nearestDefender(wr);
    if (!front || xzDist(front, wr) > JUKE_RANGE + 1.5) {
      return;
    }
    this.front = front;
    this.state = 'approach';
    this.requested = direction === 0 ? 0 : direction < 0 ? -1 : 1;
    this.beginJuke(wr);
  }

  /**
   * Move the carrier with the stick, receiver or QB. No input:
   * a receiver keeps running upfield, the QB coasts to a stop.
   */
  move(
    dt: number,
    qb: PlayerActor,
    stick: Vec2,
    sprint: boolean
  ): void {
    const wr = this.carrier;
    if (!wr) {
      return;
    }
    if (wr.isDown()) {
      wr.updateRagdoll(dt);
      return;
    }
    const top = this.carrierSpeed(wr === qb) *
      this.sprintFactor(dt, sprint);
    if (this.state === 'cut' && this.jukeTarget) {
      wr.chase(this.jukeTarget, dt, top);
      return;
    }
    const length = Math.hypot(stick.x, stick.z);
    if (length < 0.2) {
      if (wr === qb) {
        qb.coast(dt);
      } else {
        wr.advance(dt, top);
      }
      return;
    }
    const target = {
      x: wr.x + (stick.x / Math.max(1, length)) * 5,
      z: wr.z + (stick.z / Math.max(1, length)) * 5
    };
    wr.chase(target, dt, top);
  }

  /** Spend the tank while Shift is held; refill slowly otherwise. */
  private sprintFactor(dt: number, sprint: boolean): number {
    if (sprint && this.sprintLeft > 0) {
      this.sprintLeft = Math.max(0, this.sprintLeft - dt);
      return SPRINT_BOOST;
    }
    this.sprintLeft = Math.min(
      SPRINT_TANK,
      this.sprintLeft + dt * SPRINT_REFILL
    );
    return 1;
  }

  sprinting(): boolean {
    return this.sprintLeft > 0;
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
  tick(dt: number): boolean {
    const wr = this.carrier;
    if (!wr) {
      return false;
    }
    this.yacT += dt;
    this.jukeT += dt;
    this.jukeCool = Math.max(0, this.jukeCool - dt);
    this.frontMissT = Math.max(0, this.frontMissT - dt);
    if (wr.isDown()) {
      this.tackleT += dt;
      return this.tackleT >= TACKLE_SETTLE_TIME;
    }
    this.updateJuke();
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
    return false;
  }

  status(): string {
    switch (this.state) {
      case 'approach':
        return 'ZQSD to steer, Shift to sprint, Space to juke.';
      case 'cut':
        return 'Juke in progress — the outcome is not guaranteed.';
      case 'escaped':
        return 'Juke won. Trailing pursuit still has closing speed.';
      case 'stuffed':
        return 'Juke stuffed. Fight through contact and pursuit.';
      case 'down':
        return 'Tackled. The carrier is physically going to ground.';
      default:
        return 'ZQSD to steer, Shift to sprint, Space to juke.';
    }
  }

  private carrierSpeed(isQb: boolean): number {
    const base = isQb ? QB_RUN_SPEED : YAC_SPEED;
    if (this.state === 'cut') {
      return this.lastJuke === 'won' ? 5.85 : 4.35;
    }
    if (this.state === 'stuffed' && this.jukeT < 0.9) {
      return 4.65;
    }
    if (this.state === 'escaped' && this.jukeT < 0.45) {
      return Math.max(base, 6.25);
    }
    return base;
  }

  private updateJuke(): void {
    const front = this.front;
    if (this.state !== 'cut' || this.jukeT < JUKE_TIME) {
      return;
    }
    const won = this.lastJuke === 'won';
    this.state = won ? 'escaped' : 'stuffed';
    this.jukeT = 0;
    this.jukeCool = JUKE_COOLDOWN;
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
    const catchBalance = this.yacT < 0.38;
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

  private nearestDefender(carrier: PlayerActor): PlayerActor | null {
    let best: PlayerActor | null = null;
    let score = 99;
    for (const defender of this.players) {
      if (defender.def.side !== 'defense' || defender.isDown()) {
        continue;
      }
      // Prefer the man in front of the runner.
      const behind = Math.max(0, carrier.z - defender.z) * 0.45;
      const next = xzDist(carrier, defender) + behind;
      if (next < score) {
        best = defender;
        score = next;
      }
    }
    return best;
  }
}
