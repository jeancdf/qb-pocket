/**
 * Post-snap OL/DL: pass sets, bull rush, engage, pocket.
 *
 * 1–2 DL/LB rushers leave the pile after the snap and chase
 * the QB (sack pressure). Remaining DL stay blocked so the
 * pocket still looks like a line, not extra DBs.
 *
 * players.ts has setAnim but no place/pushOffset. LinePlay
 * writes actor.x/z/facing, plants the mesh, then setAnim.
 * Call update AFTER the player loop so idle auto-anim does
 * not overwrite the pass-set / rush / engage poses.
 *
 * Pairs: lt-lde, lg-ldt, rg-rdt, rt-rde.
 * Center helps the DT with worse leverage (double-team).
 */

import { LOS_Z } from './constants';
import { clamp, lerp, xzDist } from './math';
import type { PlayerActor } from './players';
import { interceptPoint } from './pursuit';
import type { Vec2 } from './types';

const HOP_T = 0.15;
const HOP_OL = 0.4;
const ENGAGE = 1.35;
const PAD = 1.16;
const MAX_SET = 2.2;
const FIGHT = 0.15;
/** Free-rusher top speeds, close to everyone else on the field. */
const EDGE_RUSH = 5.3;
const DT_RUSH = 4.9;
const LB_RUSH = 5.5;
const S_RUSH = 5.8;
const SPY_SPD = 2.45;
/** After a shed, the rusher rips past his blocker for this long. */
const RIP_T = 0.3;
/** Pursuit speed for DL / blitzers once the QB is a runner. */
const CHASE_DL = 5.2;
const CHASE_LB = 5.9;

/** Ids CoverPlay skips so rushers are not also dropping. */
const rushing = new Set<string>();

export function isPassRusher(id: string): boolean {
  return rushing.has(id);
}

/** Everyone hunting the QB this snap (edge + blitzers). */
export function passRushers(): string[] {
  return [...rushing];
}

interface Spec {
  ol: string;
  dl: string;
  seed: number;
  wide: boolean;
  push: number;
  cx: number;
}

interface Match {
  ol: PlayerActor;
  dl: PlayerActor;
  seed: number;
  wide: boolean;
  push: number;
  wig: number;
  contain: Vec2;
  locked: boolean;
  contained: boolean;
  /** Snap time at which the DL beats his man (Infinity = never). */
  shedAt: number;
  /** Run play: seconds after the handoff he gets off the block. */
  runShedAt: number;
}

interface Rush {
  p: PlayerActor;
  /** Snap time he is free to go. */
  from: number;
  speed: number;
  /** Blocker he just beat (rip around him first). */
  beat?: PlayerActor;
}

const SPECS: Spec[] = [
  { ol: 'lt', dl: 'lde', seed: 0.4, wide: true, push: 1.28, cx: -8.5 },
  { ol: 'lg', dl: 'ldt', seed: 1.1, wide: false, push: 0.94, cx: -1.35 },
  { ol: 'rg', dl: 'rdt', seed: 2.2, wide: false, push: 1.02, cx: 1.35 },
  { ol: 'rt', dl: 'rde', seed: 3.3, wide: true, push: 1.34, cx: 8.5 }
];

export class LinePlay {
  private readonly byId: Map<string, PlayerActor>;
  private readonly matches: Match[] = [];
  private readonly center?: PlayerActor;
  private readonly rushers: Rush[] = [];
  private helpDl?: PlayerActor;
  private t = 0;
  private losZ = LOS_Z;
  private blitz?: string[];
  private spy = true;
  /** A handoff happened: blocks hold, then the DL pursue. */
  private running = false;
  /** Shed-time scale for the rush; the match difficulty moves it. */
  private shedScale = 1;
  private runT = 0;

  constructor(byId: Map<string, PlayerActor>) {
    this.byId = byId;
    this.center = byId.get('c');
    for (const s of SPECS) {
      this.tryAdd(s);
    }
    this.pickRushers();
  }

  /**
   * Defensive call for the next snap: extra blitzers (LB/S)
   * and whether an unused Mike spies. Undefined blitz keeps
   * the old coin-flip Mike rush.
   */
  setPackage(blitz: string[] | undefined, spy: boolean): void {
    this.blitz = blitz;
    this.spy = spy;
  }

  /** Difficulty 0..1 (0.5 = the tuned default): how fast DL win. */
  setSkill(skill: number): void {
    this.shedScale = 1.3 - skill * 0.6;
  }

  /** Clears locks and picks 1–2 rushers for this snap. */
  reset(): void {
    this.t = 0;
    this.running = false;
    this.helpDl = undefined;
    this.pickRushers();
    for (const m of this.matches) {
      m.locked = false;
      m.contained = false;
      m.wig = 0;
    }
  }

  setLos(z: number): void {
    this.losZ = z;
    for (const m of this.matches) {
      m.contain.z = m.wide ? z - 0.8 : z - 1.5;
    }
  }

  update(dt: number, live: boolean, qb: PlayerActor): void {
    if (!live) {
      return;
    }
    const prev = this.t;
    this.t += dt;
    this.pickHelp(qb);
    const left = HOP_T - prev;
    if (left > 0) {
      this.hop(Math.min(dt, left));
    }
    this.shedBlocks();
    this.rushQb(dt, qb);
    this.spyMike(dt, qb);
    if (this.t < HOP_T) {
      this.finishFrame();
      return;
    }
    this.rushFree(dt);
    this.tryLock();
    this.drive(dt, qb);
    this.moveCenter(dt);
    this.clampSets();
    this.separate();
    this.keepFront();
    this.wiggle();
    this.finishFrame();
  }

  /**
   * Every snap the DL fight their blockers; each one gets a
   * random moment where he wins (or never does). The featured
   * edge wins more often, a DT sometimes beats the guard late.
   * Blitzers (LB/S) come free, with a random read delay.
   */
  private pickRushers(): void {
    rushing.clear();
    this.rushers.length = 0;
    const edge = Math.random() < 0.5 ? 'lde' : 'rde';
    const dt = Math.random() < 0.5 ? 'ldt' : 'rdt';
    for (const m of this.matches) {
      const id = m.dl.def.id;
      m.shedAt = id === edge ? edgeShed() * this.shedScale
        : id === dt ? interiorShed() * this.shedScale
        : Number.POSITIVE_INFINITY;
    }
    const blitz = this.blitz ??
      (Math.random() < 0.55 ? ['mlb'] : []);
    for (const id of blitz) {
      const delay = 0.05 + Math.random() * 0.35;
      this.addRusher(id, delay);
    }
  }

  private addRusher(
    id: string,
    from: number,
    beat?: PlayerActor
  ): void {
    const p = this.byId.get(id);
    if (!p || rushing.has(id)) {
      return;
    }
    rushing.add(id);
    const base = p.def.pos === 'S' ? S_RUSH
      : p.def.pos === 'LB' ? LB_RUSH
      : p.def.start.x * p.def.start.x > 16 ? EDGE_RUSH : DT_RUSH;
    const speed = base * (0.93 + Math.random() * 0.12);
    this.rushers.push({ p, from, speed, beat });
  }

  /** DL whose moment has come shed the block and go. */
  private shedBlocks(): void {
    for (const m of this.matches) {
      if (this.t < m.shedAt || rushing.has(m.dl.def.id)) {
        continue;
      }
      m.locked = false;
      this.addRusher(m.dl.def.id, this.t, m.ol);
    }
  }

  /** Free rushers: rip past the blocker / hit the gap, then QB. */
  private rushQb(dt: number, qb: PlayerActor): void {
    for (const r of this.rushers) {
      this.rushAtQb(r, dt, qb);
    }
  }

  private rushAtQb(r: Rush, dt: number, qb: PlayerActor): void {
    const p = r.p;
    if (this.t < r.from) {
      this.poseRush(p, qb);
      return;
    }
    const since = this.t - r.from;
    if (r.beat && since < RIP_T) {
      seek(p, rip(p, r.beat), r.speed, dt);
    } else if (!r.beat && since < 0.38) {
      seek(p, { x: p.x * 0.35, z: p.z - 1.35 }, r.speed, dt);
    } else {
      seek(p, interceptPoint(p, qb, r.speed), r.speed, dt);
    }
    this.poseRush(p, qb);
  }

  /**
   * QB crossed the line: every defender up front turns and runs
   * to where he will be, not where he is.
   */
  pursue(
    dt: number,
    carrier: PlayerActor,
    skip: (p: PlayerActor) => boolean = () => false
  ): void {
    this.runT += dt;
    for (const m of this.matches) {
      if (skip(m.dl)) {
        continue;
      }
      if (this.holdsRunBlock(m)) {
        // Still engaged: he fights toward the ball, the OL rides him.
        bull(m, carrier, dt, m.push * 0.55);
        split(m.ol, m.dl, PAD);
        poseMatch(m, this.runT);
        continue;
      }
      this.chaseRunner(m.dl, carrier, CHASE_DL, dt);
    }
    for (const r of this.rushers) {
      if (r.p.def.pos !== 'DL' && !skip(r.p)) {
        this.chaseRunner(r.p, carrier, CHASE_LB, dt);
      }
    }
  }

  /**
   * Handoff: every DL still on his blocker holds the block for a
   * while before he gets off it. `hold` scales how long (a weak
   * front gets washed out longer).
   */
  startRun(hold: number): void {
    this.running = true;
    this.runT = 0;
    for (const m of this.matches) {
      const engaged = m.locked && !isPassRusher(m.dl.def.id);
      m.runShedAt = engaged ? (0.35 + Math.random() * 1.6) * hold : 0;
    }
  }

  private holdsRunBlock(m: Match): boolean {
    return this.running && m.locked && this.runT < m.runShedAt &&
      !isPassRusher(m.dl.def.id);
  }

  private chaseRunner(
    p: PlayerActor,
    carrier: PlayerActor,
    speed: number,
    dt: number
  ): void {
    if (p.isDown()) {
      return;
    }
    p.chase(interceptPoint(p, carrier, speed), dt, speed);
  }

  private poseRush(p: PlayerActor, qb: PlayerActor): void {
    aim(p, qb);
    plant(p);
    p.setAnim('rush', this.t, 4);
  }

  /**
   * When the Mike is not the 2nd rusher he sits as a spy
   * instead of dropping into another DB-looking zone.
   */
  private spyMike(dt: number, qb: PlayerActor): void {
    const p = this.byId.get('mlb');
    if (!p || !this.spy || isPassRusher('mlb')) {
      return;
    }
    const hold = {
      x: clamp(qb.x * 0.35, -2.8, 2.8),
      z: this.losZ + 2.1
    };
    seek(p, hold, SPY_SPD, dt);
    aim(p, qb);
    plant(p);
    p.setAnim('rush', this.t, 1.1);
  }

  private tryAdd(s: Spec): void {
    const ol = this.byId.get(s.ol);
    const dl = this.byId.get(s.dl);
    if (!ol || !dl) {
      return;
    }
    const cz = s.wide ? this.losZ - 0.8 : this.losZ - 1.5;
    this.matches.push({
      ol,
      dl,
      seed: s.seed,
      wide: s.wide,
      push: s.push,
      wig: 0,
      contain: { x: s.cx, z: cz },
      locked: false,
      contained: false,
      shedAt: Number.POSITIVE_INFINITY,
      runShedAt: 0
    });
  }

  /** First-step hop: OL kick, DL upfield, DEs widen. */
  private hop(dt: number): void {
    const k = dt / HOP_T;
    this.shift('lt', -0.18 * k, -HOP_OL * k);
    this.shift('lg', 0, -HOP_OL * k);
    this.shift('c', 0, -HOP_OL * k);
    this.shift('rg', 0, -HOP_OL * k);
    this.shift('rt', 0.18 * k, -HOP_OL * k);
    this.shift('lde', -0.55 * k, -0.7 * k);
    this.shift('ldt', 0, -0.52 * k);
    this.shift('rdt', 0, -0.52 * k);
    this.shift('rde', 0.55 * k, -0.7 * k);
  }

  private shift(id: string, dx: number, dz: number): void {
    const p = this.byId.get(id);
    if (!p) {
      return;
    }
    p.x += dx;
    p.z += dz;
  }

  private pickHelp(qb: PlayerActor): void {
    const ldt = this.byId.get('ldt');
    const rdt = this.byId.get('rdt');
    const lg = this.byId.get('lg');
    const rg = this.byId.get('rg');
    if (!ldt || !rdt || !lg || !rg) {
      this.helpDl = undefined;
      return;
    }
    if (isPassRusher('ldt') || isPassRusher('rdt')) {
      // A DT already beat his man: the center stays home.
      this.helpDl = isPassRusher('ldt') ? rdt : ldt;
      if (isPassRusher(this.helpDl.def.id)) {
        this.helpDl = undefined;
      }
      return;
    }
    const l = winScore(lg, ldt, qb);
    const r = winScore(rg, rdt, qb);
    this.helpDl = l >= r ? ldt : rdt;
  }

  private rushFree(dt: number): void {
    for (const m of this.matches) {
      this.rushOne(m, dt);
    }
  }

  private rushOne(m: Match, dt: number): void {
    if (m.locked || isPassRusher(m.dl.def.id)) {
      return;
    }
    // Unused DE/DT stay on their OT so only 1–2 hunters chase.
    const to = { x: m.ol.x, z: m.ol.z + 0.72 };
    seek(m.dl, to, 2.15, dt);
  }

  private tryLock(): void {
    for (const m of this.matches) {
      if (isPassRusher(m.dl.def.id)) {
        continue;
      }
      const close = xzDist(m.ol, m.dl) < ENGAGE;
      m.locked = m.locked || close;
    }
  }

  private drive(dt: number, qb: PlayerActor): void {
    for (const m of this.matches) {
      this.driveOne(m, dt, qb);
    }
  }

  private driveOne(m: Match, dt: number, qb: PlayerActor): void {
    if (isPassRusher(m.dl.def.id)) {
      setWithout(m, dt);
      return;
    }
    if (!m.locked) {
      kickSlide(m, dt);
      return;
    }
    bull(m, qb, dt, this.rate(m));
  }

  private rate(m: Match): number {
    const c = this.center;
    if (!c || this.helpDl !== m.dl) {
      return m.push;
    }
    if (xzDist(c, m.dl) > 1.55) {
      return m.push;
    }
    return Math.max(0.7, m.push * 0.62);
  }

  private moveCenter(dt: number): void {
    const c = this.center;
    const d = this.helpDl;
    if (!c || !d) {
      return;
    }
    c.z -= 1.2 * dt;
    c.x = lerp(c.x, d.x * 0.62, clamp(dt * 3.4, 0, 1));
  }

  private clampSets(): void {
    const minZ = this.losZ - MAX_SET;
    const ids = ['lt', 'lg', 'c', 'rg', 'rt'];
    for (const id of ids) {
      this.clampOl(id, minZ);
    }
  }

  private clampOl(id: string, minZ: number): void {
    const p = this.byId.get(id);
    if (!p) {
      return;
    }
    p.z = Math.max(p.z, minZ);
  }

  private separate(): void {
    for (const m of this.matches) {
      if (isPassRusher(m.dl.def.id)) {
        continue;
      }
      split(m.ol, m.dl, PAD);
    }
    if (this.center && this.helpDl) {
      split(this.center, this.helpDl, PAD);
    }
  }

  private keepFront(): void {
    for (const m of this.matches) {
      if (isPassRusher(m.dl.def.id)) {
        continue;
      }
      holdOl(m);
    }
  }

  private wiggle(): void {
    const t = this.t * 6;
    for (const m of this.matches) {
      this.fight(m, t);
    }
  }

  private fight(m: Match, t: number): void {
    if (!m.locked || isPassRusher(m.dl.def.id)) {
      return;
    }
    const w = FIGHT * Math.sin(t + m.seed);
    m.ol.x += w - m.wig;
    m.dl.x += w - m.wig;
    m.wig = w;
  }

  private finishFrame(): void {
    for (const m of this.matches) {
      poseMatch(m, this.t);
    }
    this.poseCenter();
  }

  private poseCenter(): void {
    const c = this.center;
    if (!c) {
      return;
    }
    if (this.helpDl) {
      aim(c, this.helpDl);
    }
    plant(c);
    c.setAnim('passSet', this.t, 1.2);
  }
}

function kickSlide(m: Match, dt: number): void {
  const ol = m.ol;
  const dl = m.dl;
  ol.z -= 1.65 * dt;
  const out = m.wide ? Math.sign(ol.def.start.x) : 0;
  const tx = dl.x + out * 0.28;
  ol.x = lerp(ol.x, tx, clamp(dt * 4.2, 0, 1));
}

/** OT whose DE is a free rusher: set in place, do not chase. */
function setWithout(m: Match, dt: number): void {
  const ol = m.ol;
  ol.z -= 1.45 * dt;
  const home = ol.def.start.x;
  ol.x = lerp(ol.x, home, clamp(dt * 3.2, 0, 1));
}

function bull(
  m: Match,
  qb: PlayerActor,
  dt: number,
  spd: number
): void {
  const dl = m.dl;
  const ol = m.ol;
  const bx = dl.x;
  const bz = dl.z;
  seek(dl, qb, spd, dt);
  ol.x += dl.x - bx;
  ol.z += dl.z - bz;
  const shade = Math.sign(ol.def.start.x) * 0.18;
  ol.x = lerp(ol.x, dl.x + shade, clamp(dt * 5, 0, 1));
}

function poseMatch(m: Match, t: number): void {
  if (isPassRusher(m.dl.def.id)) {
    m.ol.facing = 0;
    plant(m.ol);
    m.ol.setAnim('passSet', t, 2);
    return;
  }
  aim(m.ol, m.dl);
  aim(m.dl, m.ol);
  plant(m.ol);
  plant(m.dl);
  const kind = m.locked ? 'engage' : undefined;
  m.ol.setAnim(kind ?? 'passSet', t, 2);
  m.dl.setAnim(kind ?? 'rush', t, 4);
}

/** Around the beaten blocker's outside (or inside) shoulder. */
function rip(p: PlayerActor, ol: PlayerActor): Vec2 {
  const side = Math.sign(p.x - ol.x) || Math.sign(ol.def.start.x) || 1;
  return { x: ol.x + side * 0.95, z: ol.z - 0.9 };
}

/** Edge vs tackle: quick win, late win, or held (then a late shed). */
function edgeShed(): number {
  const r = Math.random();
  if (r < 0.28) {
    return 0.7 + Math.random() * 0.7;
  }
  if (r < 0.68) {
    return 1.6 + Math.random() * 1.6;
  }
  return 4.2 + Math.random() * 2.4;
}

/** DT vs guard: mostly held, sometimes a late push through. */
function interiorShed(): number {
  const r = Math.random();
  if (r < 0.3) {
    return 2.2 + Math.random() * 1.8;
  }
  return 5 + Math.random() * 3;
}

function seek(
  p: PlayerActor,
  to: Vec2,
  spd: number,
  dt: number
): boolean {
  return p.steer(to, dt, spd);
}

function split(a: PlayerActor, b: PlayerActor, pad: number): void {
  const d = xzDist(a, b);
  if (d >= pad || d < 1e-4) {
    return;
  }
  const nx = (b.x - a.x) / d;
  const nz = (b.z - a.z) / d;
  const corr = (pad - d) * 0.5;
  a.x -= nx * corr;
  a.z -= nz * corr;
  b.x += nx * corr;
  b.z += nz * corr;
}

function holdOl(m: Match): void {
  const ol = m.ol;
  const dl = m.dl;
  if (dl.z >= ol.z) {
    return;
  }
  const mid = (ol.z + dl.z) * 0.5;
  ol.z = mid - 0.58;
  dl.z = mid + 0.58;
}

function aim(from: PlayerActor, to: PlayerActor): void {
  from.facing = Math.atan2(to.x - from.x, to.z - from.z);
}

function plant(p: PlayerActor): void {
  p.mesh.position.x = p.x;
  p.mesh.position.z = p.z;
  p.mesh.rotation.y = p.facing;
}

/** Higher = DT is winning and needs the center's help. */
function winScore(
  ol: PlayerActor,
  dl: PlayerActor,
  qb: PlayerActor
): number {
  const past = ol.z - dl.z;
  return past * 2 - xzDist(dl, qb);
}
