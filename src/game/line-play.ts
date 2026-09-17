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
import type { Vec2 } from './types';

const HOP_T = 0.15;
const HOP_OL = 0.4;
const ENGAGE = 1.35;
const PAD = 1.16;
const MAX_SET = 2.2;
const FIGHT = 0.15;
const EDGE_RUSH = 3.85;
const LB_RUSH = 4.35;
const SPY_SPD = 2.45;

/** Ids CoverPlay skips so rushers are not also dropping. */
const rushing = new Set<string>();

export function isPassRusher(id: string): boolean {
  return rushing.has(id);
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
  private readonly rushers: PlayerActor[] = [];
  private helpDl?: PlayerActor;
  private t = 0;
  private losZ = LOS_Z;

  constructor(byId: Map<string, PlayerActor>) {
    this.byId = byId;
    this.center = byId.get('c');
    for (const s of SPECS) {
      this.tryAdd(s);
    }
    this.pickRushers();
  }

  /** Clears locks and picks 1–2 rushers for this snap. */
  reset(): void {
    this.t = 0;
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
    this.rushQb(dt, qb);
    this.spyMike(dt, qb);
    if (this.t < HOP_T) {
      this.finishFrame();
      return;
    }
    this.rushFree(dt, qb);
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
   * Every play: one edge (lde/rde) plus the Mike on about
   * half of snaps. Always a DE so game.ts sack range still
   * hits without spawning new actors.
   */
  private pickRushers(): void {
    rushing.clear();
    this.rushers.length = 0;
    const edge = Math.random() < 0.5 ? 'lde' : 'rde';
    this.addRusher(edge);
    if (Math.random() < 0.55) {
      this.addRusher('mlb');
    }
  }

  private addRusher(id: string): void {
    const p = this.byId.get(id);
    if (!p) {
      return;
    }
    rushing.add(id);
    this.rushers.push(p);
  }

  /** Unblocked edge / blitzing Mike: contain a beat, then QB. */
  private rushQb(dt: number, qb: PlayerActor): void {
    for (const p of this.rushers) {
      this.rushAtQb(p, dt, qb);
    }
  }

  private rushAtQb(
    p: PlayerActor,
    dt: number,
    qb: PlayerActor
  ): void {
    const edge = p.def.pos === 'DL';
    if (this.t < HOP_T && edge) {
      this.poseRush(p, qb);
      return;
    }
    const spd = edge ? EDGE_RUSH : LB_RUSH;
    if (this.t < 0.42) {
      seek(p, this.gate(p, edge), spd, dt);
    } else {
      seek(p, qb, spd, dt);
    }
    this.poseRush(p, qb);
  }

  /** Outside flatten for DE; A-gap shoot for the Mike. */
  private gate(p: PlayerActor, edge: boolean): Vec2 {
    const out = Math.sign(p.def.start.x) || 1;
    if (edge) {
      return { x: p.x + out * 1.05, z: p.z - 0.85 };
    }
    return { x: p.x * 0.35, z: p.z - 1.35 };
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
    if (!p || isPassRusher('mlb')) {
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
      contained: false
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
    const l = winScore(lg, ldt, qb);
    const r = winScore(rg, rdt, qb);
    this.helpDl = l >= r ? ldt : rdt;
  }

  private rushFree(dt: number, qb: PlayerActor): void {
    for (const m of this.matches) {
      this.rushOne(m, dt, qb);
    }
  }

  private rushOne(m: Match, dt: number, qb: PlayerActor): void {
    if (m.locked || isPassRusher(m.dl.def.id)) {
      return;
    }
    const spd = m.wide ? 4.25 : 3.15;
    if (!m.contained) {
      m.contained = seek(m.dl, m.contain, spd, dt);
      return;
    }
    seek(m.dl, qb, spd, dt);
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
