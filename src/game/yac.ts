/**
 * Ball carrier after the catch (or a QB scramble): the front
 * defender, the juke, pursuit and the tackle. FootballGame owns
 * the drive result; this only says when the run is over.
 */

import { GOAL_Z, HALF_W, TACKLE_RANGE, YAC_SPEED } from './constants';
import { DiveTackles } from './dive-tackle';
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
/** Defender must be this close for a juke to have a victim. */
const JUKE_RANGE = 4.8;
/** Plant: sink and brake on the outside foot. */
const PLANT_TIME = 0.16;
/** Cut: explode sideways off that foot. */
const CUT_TIME = 0.3;
const CUT_LATERAL = 7.2;
const CUT_FORWARD = 2.4;
/** After the cut: legs gather, top speed comes back. */
const RECOVER_TIME = 0.35;
/** A beaten defender slides past for this long. */
const STAGGER_TIME = 0.8;

export type JukeState =
  | 'none'
  | 'plant'
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
  /** Defenders who leave their feet to make the tackle. */
  readonly dives = new DiveTackles();
  private jukeDir = 1;
  /** Heading and speed at the moment of the plant. */
  private jukeFace = 0;
  private jukeEntry = 0;
  private jukeWon = false;
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
    this.jukeDir = 1;
    this.jukeWon = false;
    this.yacT = 0;
    this.jukeT = 0;
    this.tackleT = 0;
    this.frontMissT = 0;
    this.jukeCool = 0;
    this.sprintLeft = SPRINT_TANK;
    this.dives.clear();
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
   * Space: plant and cut. `direction` is the world side (+x/-x)
   * from the stick; 0 cuts away from the nearest defender.
   */
  requestJuke(direction: number): void {
    const wr = this.carrier;
    if (!wr || wr.isDown() || this.jukeCool > 0) {
      return;
    }
    if (this.state === 'plant' || this.state === 'cut' ||
        this.state === 'down') {
      return;
    }
    const front = this.nearestDefender(wr);
    this.front = front && xzDist(front, wr) <= JUKE_RANGE ? front : null;
    let dir = direction === 0 ? 0 : direction < 0 ? -1 : 1;
    if (dir === 0) {
      dir = this.front && this.front.x > wr.x ? -1 : 1;
    }
    const v = wr.velocity();
    this.jukeDir = dir;
    this.jukeEntry = Math.hypot(v.x, v.z);
    this.jukeFace = this.jukeEntry > 0.5
      ? Math.atan2(v.x, v.z)
      : wr.facing;
    this.state = 'plant';
    this.jukeT = 0;
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
    if (this.state === 'plant' || this.state === 'cut') {
      this.footwork(wr, dt);
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
    if (this.yacT >= 0.38) {
      this.dives.launch(wr, this.players);
      const diver = this.dives.contact(wr, (p) => this.dodged(p));
      if (diver) {
        this.dives.end(diver);
        this.startTackle(wr, diver);
        return false;
      }
    }
    const tackler = this.findTackler(wr);
    if (tackler) {
      this.startTackle(wr, tackler);
      return false;
    }
    return false;
  }

  /** The juke beat this defender (resolved, or he is still fooled). */
  private dodged(p: PlayerActor): boolean {
    if (p !== this.front) {
      return false;
    }
    const cutting = this.state === 'cut' || this.state === 'escaped';
    return (cutting && this.jukeWon) || this.frontMissT > 0;
  }

  status(): string {
    switch (this.state) {
      case 'plant':
      case 'cut':
        return 'Plant and cut…';
      case 'escaped':
        return 'Ankles broken. Get upfield before pursuit closes.';
      case 'stuffed':
        return 'He read it. Juke when he closes in at 2–3 yards.';
      case 'down':
        return 'Tackled. The carrier is physically going to ground.';
      default:
        return 'ZQSD to steer, Shift to sprint, Space to juke.';
    }
  }

  private carrierSpeed(isQb: boolean): number {
    const base = isQb ? QB_RUN_SPEED : YAC_SPEED;
    const gathering = (this.state === 'escaped' ||
      this.state === 'stuffed') && this.jukeT < RECOVER_TIME;
    if (!gathering) {
      return base;
    }
    // Won: a burst out of the cut. Read: stuck in the mud.
    return this.state === 'escaped' ? base * 1.08 : base * 0.72;
  }

  /**
   * Scripted juke footwork. Plant: brake hard on the outside
   * foot. Cut: velocity snaps sideways off it (no inertia), then
   * normal steering takes over.
   */
  private footwork(wr: PlayerActor, dt: number): void {
    const f = this.jukeFace;
    const fx = Math.sin(f);
    const fz = Math.cos(f);
    // Lateral unit on the cut side (world +x when dir = 1 and
    // running upfield).
    const lx = fz * this.jukeDir;
    const lz = -fx * this.jukeDir;
    const total = PLANT_TIME + CUT_TIME;
    const u = Math.min(1, this.jukeT / total);
    if (this.state === 'plant') {
      const keep = Math.max(0, this.jukeEntry * (1 - this.jukeT / PLANT_TIME) * 0.6);
      wr.footwork(fx * keep, fz * keep, dt, f, 'juke', u, this.jukeDir);
      return;
    }
    const c = Math.min(1, (this.jukeT - PLANT_TIME) / CUT_TIME);
    const lat = CUT_LATERAL * (1 - c * 0.45);
    const fwd = CUT_FORWARD + c * 2.2;
    const vx = lx * lat + fx * fwd;
    const vz = lz * lat + fz * fwd;
    const face = Math.atan2(lx * 0.8 + fx, lz * 0.8 + fz);
    wr.footwork(vx, vz, dt, face, 'juke', u, this.jukeDir);
  }

  private updateJuke(): void {
    const wr = this.carrier;
    if (!wr) {
      return;
    }
    if (this.state === 'plant' && this.jukeT >= PLANT_TIME) {
      this.jukeWon = this.resolveJuke(wr);
      this.state = 'cut';
      if (this.jukeWon && this.front) {
        this.front.stagger(STAGGER_TIME);
        this.frontMissT = STAGGER_TIME;
      }
      return;
    }
    if (this.state !== 'cut' || this.jukeT < PLANT_TIME + CUT_TIME) {
      return;
    }
    const won = this.jukeWon;
    this.lastJuke = won ? 'won' : 'stuffed';
    this.state = won ? 'escaped' : 'stuffed';
    this.jukeT = 0;
    this.jukeCool = JUKE_COOLDOWN;
    if (this.front) {
      this.toast(won ? 'ANKLES BROKEN' : 'JUKE READ', !won);
    }
  }

  /**
   * Does the defender bite? Not a coin flip: it takes the
   * right distance, a defender who is actually closing, a cut
   * away from his leverage, and some speed into the plant.
   */
  private resolveJuke(wr: PlayerActor): boolean {
    const d = this.front;
    if (!d) {
      return true;
    }
    const dist = xzDist(wr, d);
    // Sweet spot 1.4–3.2 yd: too close he just wraps you up,
    // too far he has time to redirect.
    const timing = dist < 1.4
      ? clamp((dist - 0.8) / 0.6, 0, 1)
      : clamp((4.6 - dist) / 1.4, 0, 1);
    const dv = d.velocity();
    const tx = (wr.x - d.x) / Math.max(dist, 0.01);
    const tz = (wr.z - d.z) / Math.max(dist, 0.01);
    const closing = dv.x * tx + dv.z * tz;
    const commit = clamp(closing / 5.5, 0, 1);
    // Where is he relative to the cut? Positive = on the cut side.
    const f = this.jukeFace;
    const lx = Math.cos(f) * this.jukeDir;
    const lz = -Math.sin(f) * this.jukeDir;
    const side = (d.x - wr.x) * lx + (d.z - wr.z) * lz;
    const leverage = side > 0.5 ? 0.25 : side < -0.3 ? 1 : 0.7;
    const sell = clamp(this.jukeEntry / 5, 0.55, 1);
    const score = timing * (0.3 + 0.7 * commit) * leverage * sell;
    return score >= 0.42;
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
    if (catchBalance) {
      return null;
    }
    let tackler: PlayerActor | null = null;
    let distance = TACKLE_RANGE;
    for (const p of this.players) {
      if (p.def.side !== 'defense' || p.isDown() || p.isStaggered() ||
          this.dives.has(p)) {
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
