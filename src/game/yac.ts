/**
 * Ball carrier after the catch (or a QB scramble): the front
 * defender, the juke and the other moves (carrier-moves.ts),
 * pursuit and the tackle. FootballGame owns
 * the drive result; this only says when the run is over.
 */

import { MOVES, moveOdds, readDefender, type CarrierMove } from './carrier-moves';
import { GOAL_Z, HALF_W, TACKLE_RANGE, YAC_SPEED } from './constants';
import { DiveTackles } from './dive-tackle';
import { clamp, xzDist } from './math';
import type { PlayerActor } from './players';
import type { Vec2 } from './types';

const QB_RUN_SPEED = 6.6;
/** Pause between two jukes. */
const JUKE_COOLDOWN = 0.4;
const TACKLE_SETTLE_TIME = 1.65;
/** Defender must be this close for a juke to have a victim. */
const JUKE_RANGE = 4.8;
/** Plant: sink and brake on the outside foot. */
const PLANT_TIME = 0.05;
/** Cut: explode sideways off that foot. */
const CUT_TIME = 0.24;
/** How long an early press is remembered. */
const JUKE_BUFFER = 0.3;
const CUT_LATERAL = 7.2;
const CUT_FORWARD = 2.4;
/** After the cut: legs gather, top speed comes back. */
const RECOVER_TIME = 0.25;
/** A beaten defender slides past for this long. */
const STAGGER_TIME = 0.8;
/** Ankles broken: seconds on the grass (plus up to 0.35). */
const JUKE_LIE = 0.9;

export type JukeState =
  | 'none'
  | 'plant'
  | 'cut'
  | 'escaped'
  | 'stuffed'
  | 'move'
  | 'down';

export type JukeResult = 'won' | 'stuffed' | null;

type Toast = (msg: string, bad: boolean) => void;

/** A spin, stiff-arm, hurdle or truck in progress. */
interface Act {
  kind: CarrierMove;
  t: number;
  target: PlayerActor | null;
  /** Heading and speed going in; `dir` is the world side (+x/-x). */
  face: number;
  entry: number;
  dir: number;
  decided: boolean;
  won: boolean;
}

const NO_COOL: Record<CarrierMove, number> = {
  spin: 0,
  stiffArm: 0,
  hurdle: 0,
  truck: 0
};

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
  /** A press that came in during cooldown, replayed when ready. */
  private queued: {
    kind: 'juke' | CarrierMove;
    dir: number;
    t: number;
  } | null = null;
  private act: Act | null = null;
  private moveCool = { ...NO_COOL };
  /** Speed factor while the carrier gathers after a move. */
  private afterMul = 1;
  /** Divers a move beat: they fly past instead of wrapping up. */
  private readonly beaten = new Set<PlayerActor>();

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
    this.queued = null;
    this.act = null;
    this.moveCool = { ...NO_COOL };
    this.afterMul = 1;
    this.beaten.clear();
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
    if (!wr || wr.isDown() || this.state === 'down') {
      return;
    }
    if (this.jukeCool > 0 || this.busy()) {
      // Pressed a hair early: fire it the moment it's allowed.
      this.queued = { kind: 'juke', dir: direction, t: JUKE_BUFFER };
      return;
    }
    this.queued = null;
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
   * E / F / X / G: spin, stiff-arm, hurdle, truck. `direction` is
   * the stick side (+x/-x); 0 picks from where the defender is.
   */
  requestMove(kind: CarrierMove, direction: number): void {
    const wr = this.carrier;
    if (!wr || wr.isDown() || this.state === 'down') {
      return;
    }
    if (this.moveCool[kind] > 0 || this.busy()) {
      this.queued = { kind, dir: direction, t: JUKE_BUFFER };
      return;
    }
    this.queued = null;
    const v = wr.velocity();
    const entry = Math.hypot(v.x, v.z);
    const face = entry > 0.5 ? Math.atan2(v.x, v.z) : wr.facing;
    const target = this.moveTarget(wr, kind);
    // Which side of the runner's line he is on (+1: world +x side
    // when running upfield, same convention as the juke).
    const side = target
      ? Math.sign((target.x - wr.x) * Math.cos(face) -
          (target.z - wr.z) * Math.sin(face)) || 1
      : 1;
    let dir = direction === 0 ? 0 : direction < 0 ? -1 : 1;
    if (kind === 'stiffArm') {
      // The arm goes at the man.
      dir = side;
    } else if (dir === 0) {
      // Spin away from him.
      dir = -side;
    }
    this.front = target;
    this.act = {
      kind,
      t: 0,
      target,
      face,
      entry,
      dir,
      decided: false,
      won: false
    };
    this.state = 'move';
  }

  /**
   * Move the carrier with the stick, receiver or QB. No input:
   * a receiver keeps running upfield, the QB coasts to a stop.
   */
  move(
    dt: number,
    qb: PlayerActor,
    stick: Vec2,
    sprint: number
  ): void {
    const wr = this.carrier;
    if (!wr) {
      return;
    }
    if (wr.isDown()) {
      wr.updateRagdoll(dt);
      return;
    }
    // `sprint` is the Shift multiplier (see SprintMeter).
    const top = this.carrierSpeed(wr === qb) * sprint;
    if (this.state === 'plant' || this.state === 'cut') {
      this.footwork(wr, dt);
      return;
    }
    if (this.state === 'move' && this.act) {
      this.moveFootwork(wr, this.act, dt);
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
    for (const k of Object.keys(this.moveCool) as CarrierMove[]) {
      this.moveCool[k] = Math.max(0, this.moveCool[k] - dt);
    }
    if (this.act) {
      this.act.t += dt;
    }
    this.replayQueued(dt);
    this.frontMissT = Math.max(0, this.frontMissT - dt);
    if (wr.isDown()) {
      this.tackleT += dt;
      return this.tackleT >= TACKLE_SETTLE_TIME;
    }
    this.updateJuke();
    if (this.updateAct(wr)) {
      return false;
    }
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
    if (this.beaten.has(p)) {
      return true;
    }
    const a = this.act;
    if (a?.kind === 'hurdle' && a.t > 0.06 && a.t < 0.5) {
      // Airborne: every diver goes under.
      return true;
    }
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
      case 'move':
        return this.act ? MOVES[this.act.kind].status : '';
      case 'down':
        return 'Tackled. The carrier is physically going to ground.';
      default:
        return 'ZQSD steer, Shift sprint, Space juke, E spin, ' +
          'F stiff-arm, X hurdle, G truck.';
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
    return base * this.afterMul;
  }

  private busy(): boolean {
    return this.state === 'plant' || this.state === 'cut' ||
      this.state === 'move';
  }

  /** Fire a press that came in early, once it is allowed. */
  private replayQueued(dt: number): void {
    const q = this.queued;
    if (!q) {
      return;
    }
    q.t -= dt;
    if (q.t <= 0) {
      this.queued = null;
      return;
    }
    if (this.busy()) {
      return;
    }
    if (q.kind === 'juke') {
      if (this.jukeCool <= 0) {
        this.requestJuke(q.dir);
      }
    } else if (this.moveCool[q.kind] <= 0) {
      this.requestMove(q.kind, q.dir);
    }
  }

  /** Who the move is aimed at: a diver for a hurdle, else the front man. */
  private moveTarget(
    wr: PlayerActor,
    kind: CarrierMove
  ): PlayerActor | null {
    const range = MOVES[kind].range;
    if (kind === 'hurdle') {
      let best: PlayerActor | null = null;
      let d = range;
      for (const p of this.players) {
        const n = xzDist(p, wr);
        if (this.dives.has(p) && n < d) {
          best = p;
          d = n;
        }
      }
      if (best) {
        return best;
      }
    }
    const front = this.nearestDefender(wr);
    return front && xzDist(front, wr) <= range ? front : null;
  }

  /** Scripted carrier motion for a spin, stiff-arm, hurdle or truck. */
  private moveFootwork(wr: PlayerActor, a: Act, dt: number): void {
    const spec = MOVES[a.kind];
    const u = Math.min(1, a.t / spec.time);
    const f = a.face;
    const fx = Math.sin(f);
    const fz = Math.cos(f);
    const lx = Math.cos(f) * a.dir;
    const lz = -Math.sin(f) * a.dir;
    let speed = Math.max(a.entry * spec.keep, spec.minSpeed);
    let side = 0;
    let face = f;
    if (a.kind === 'spin') {
      // A full turn on the move, drifting off the contact.
      const e = u * u * (3 - 2 * u);
      face = f + a.dir * Math.PI * 2 * e;
      side = 1.6 * Math.sin(u * Math.PI);
    } else if (a.kind === 'stiffArm') {
      // Lean off the arm, away from him.
      side = -0.6 * Math.sin(u * Math.PI);
    } else if (a.kind === 'truck' && a.decided && a.won) {
      // Running through a man costs some speed.
      speed *= 0.85;
    }
    const vx = fx * speed + lx * side;
    const vz = fz * speed + lz * side;
    wr.footwork(vx, vz, dt, face, spec.anim, u, a.dir);
  }

  /**
   * Contact, then the end of the move. Returns true when a failed
   * move ended in the tackle.
   */
  private updateAct(wr: PlayerActor): boolean {
    const a = this.act;
    if (!a || this.state !== 'move') {
      return false;
    }
    const spec = MOVES[a.kind];
    if (!a.decided && a.t >= spec.hit) {
      a.decided = true;
      a.won = this.resolveMove(wr, a);
      if (!a.won && this.punish(wr, a)) {
        this.act = null;
        return true;
      }
    }
    if (a.t < spec.time) {
      return false;
    }
    this.lastJuke = a.won ? 'won' : 'stuffed';
    this.state = a.won ? 'escaped' : 'stuffed';
    this.jukeT = 0;
    this.afterMul = a.won ? spec.after : 0.72;
    this.moveCool[a.kind] = spec.cooldown;
    this.act = null;
    return false;
  }

  private resolveMove(wr: PlayerActor, a: Act): boolean {
    const d = a.target;
    const spec = MOVES[a.kind];
    if (!d || d.isDown() || d.isStaggered() ||
        xzDist(d, wr) > spec.range + 0.8) {
      // Nobody there any more: the move just happens.
      return true;
    }
    const read = readDefender(wr, d, a.face, this.dives.has(d));
    const won = Math.random() < moveOdds(a.kind, read);
    if (won) {
      this.beat(wr, d, a);
    }
    this.toast(won ? spec.won : spec.lost, !won);
    return won;
  }

  /** The move worked: what happens to the man it beat. */
  private beat(wr: PlayerActor, d: PlayerActor, a: Act): void {
    const spec = MOVES[a.kind];
    const diving = this.dives.has(d);
    const lie = spec.lie + Math.random() * 0.35;
    if (a.kind === 'hurdle' || (a.kind === 'spin' && diving)) {
      // He goes under / past; a diver ends on the grass anyway.
      this.beaten.add(d);
      if (!diving) {
        d.stagger(0.6);
      }
      return;
    }
    if (a.kind === 'spin') {
      // Grabbed at air and went down.
      d.knockDown(lie);
      return;
    }
    // Stiff-arm or truck: shoved off the carrier.
    const dist = Math.max(xzDist(d, wr), 0.01);
    const shove = a.kind === 'truck' ? 3.2 : 2.6;
    const push = {
      x: ((d.x - wr.x) / dist) * shove,
      z: ((d.z - wr.z) / dist) * shove
    };
    if (diving) {
      this.dives.end(d);
    }
    d.knockDown(lie, !diving, push);
  }

  /** A failed power move against a man in reach: he wraps you up. */
  private punish(wr: PlayerActor, a: Act): boolean {
    const d = a.target;
    if (!d || a.kind === 'spin' || d.isDown() || d.isStaggered()) {
      return false;
    }
    if (a.kind === 'hurdle' && this.dives.has(d)) {
      // Missed the jump: his dive reaches you on its own.
      return false;
    }
    if (xzDist(d, wr) > TACKLE_RANGE + 0.9) {
      return false;
    }
    if (this.dives.has(d)) {
      this.dives.end(d);
    }
    this.startTackle(wr, d);
    return true;
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
        this.frontMissT = STAGGER_TIME;
        if (!this.dives.has(this.front)) {
          // Ankles broken: he goes down and has to get up.
          this.front.knockDown(JUKE_LIE + Math.random() * 0.35);
        }
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
    this.afterMul = won ? 1.08 : 0.72;
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
      if (defender.def.side !== 'defense' || defender.isDown() ||
          defender.isGrounded()) {
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
