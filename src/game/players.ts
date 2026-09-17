import * as THREE from 'three';
import { createAvatar, type PlayerAvatar } from './avatar';
import { LOS_Z } from './constants';
import type { TeamMats } from './materials';
import { headingLerp, wrapPi, xzDist } from './math';
import {
  applyHitch,
  applyRun,
  applyScan,
  buildRig,
  poseRig,
  type AnimKind,
  type PlayerRig
} from './rig';
import type { CoverGrade, PlayerDef, Pos, RoutePoint, Vec2 } from './types';

const RING_COL: Record<CoverGrade, number> = {
  idle: 0x000000,
  open: 0x3dd68c,
  window: 0xe8c547,
  covered: 0xe35d5d
};

/** Arcade accel — local so ball-speed can own constants.ts. */
const ACCEL = 32;
const BRAKE = 46;
const TURN = 8;
const PLANT_ANG = 1.4;
const PLANT_T = 0.14;
const PLANT_SPD = 2.4;
const CUT_MIN = 0.32;
const ARRIVE_R = 1.25;
const ARRIVED = 0.26;
const FLOW_HIT = 0.55;
const MIN_SPD = 0.4;

export type { AnimKind, PlayerRig };

export class PlayerActor {
  readonly def: PlayerDef;
  readonly mesh: THREE.Group;
  readonly ring: THREE.Mesh;
  readonly rig: PlayerRig;
  x: number;
  z: number;
  facing: number;
  cover: CoverGrade = 'idle';
  private vx = 0;
  private vz = 0;
  private idx = 0;
  private wait = 0;
  private gait = 0;
  private plant = 0;
  private shiftZ = 0;
  private chasing = false;
  private holdKind: AnimKind | null = null;
  private holdLeft = 0;
  private holdDur = 0.4;
  private ringMat: THREE.MeshBasicMaterial;
  private avatar?: PlayerAvatar;

  constructor(def: PlayerDef, mats: TeamMats) {
    this.def = def;
    this.x = def.start.x;
    this.z = def.start.z;
    this.facing = def.heading;
    const built = buildRig(def, mats);
    this.mesh = built.root;
    this.rig = built.rig;
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0,
      depthWrite: false
    });
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.48, 0.68, 24),
      this.ringMat
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.04;
    this.mesh.add(this.ring);
    if (def.pos === 'WR') {
      this.mesh.add(namePlate(def));
    }
    this.sync();
    void this.attachAvatar();
  }

  reset(): void {
    this.x = this.def.start.x;
    this.z = this.def.start.z + this.shiftZ;
    this.facing = this.def.heading;
    this.vx = 0;
    this.vz = 0;
    this.idx = 0;
    this.wait = 0;
    this.gait = 0;
    this.plant = 0;
    this.chasing = false;
    this.holdKind = null;
    this.holdLeft = 0;
    this.cover = 'idle';
    this.setCover('idle');
    this.setAnim('idle', 0, 0);
    this.sync();
  }

  /** Slide the playbook alignment to a new line of scrimmage. */
  align(losZ: number): void {
    this.shiftZ = losZ - LOS_Z;
    this.reset();
  }

  /** Swap a skill player's alignment and route (audible). */
  setSkill(
    start: Vec2,
    route: RoutePoint[],
    name: string
  ): void {
    this.def.start = { x: start.x, z: start.z };
    this.def.route = route.map((p) => ({ ...p }));
    this.def.routeName = name;
  }

  setStart(start: Vec2): void {
    this.def.start = { x: start.x, z: start.z };
  }

  setCover(grade: CoverGrade): void {
    this.cover = grade;
    this.ringMat.color.setHex(RING_COL[grade]);
    this.ringMat.opacity = grade === 'idle' ? 0 : 0.72;
  }

  /** Force a pose. Call after update() to override auto locomotion. */
  setAnim(kind: AnimKind, t: number, speed: number): void {
    poseRig(this.rig, kind, t, speed);
    this.avatar?.setMotion(kind, t);
  }

  /** Hold a throw/catch pose for a beat, then resume. */
  lockAnim(kind: AnimKind, seconds: number): void {
    this.holdKind = kind;
    this.holdDur = seconds;
    this.holdLeft = seconds;
  }

  predict(seconds: number): Vec2 {
    const route = this.def.route;
    if (!route || this.idx >= route.length) {
      return { x: this.x, z: this.z };
    }
    let t = seconds;
    let x = this.x;
    let z = this.z;
    let i = this.idx;
    let wait = this.wait;
    while (t > 0 && i < route.length) {
      if (wait > 0) {
        const used = Math.min(wait, t);
        wait -= used;
        t -= used;
        continue;
      }
      const p = route[i];
      const pz = p.z + this.shiftZ;
      const dist = Math.hypot(p.x - x, pz - z);
      const spd = (p.speed ?? 8) * 0.9;
      if (spd < 0.05 || dist < 0.04) {
        x = p.x;
        z = pz;
        wait = p.wait ?? 0;
        i += 1;
        continue;
      }
      const need = dist / spd;
      if (t >= need) {
        x = p.x;
        z = pz;
        t -= need + 0.05;
        wait = p.wait ?? 0;
        i += 1;
      } else {
        const k = (spd * t) / dist;
        x += (p.x - x) * k;
        z += (pz - z) * k;
        t = 0;
      }
    }
    return { x, z };
  }

  update(dt: number, live: boolean): void {
    this.avatar?.update(dt);
    const ox = this.x;
    const oz = this.z;
    const of = this.facing;
    if (live) {
      this.follow(dt);
    }
    const speed =
      Math.hypot(this.x - ox, this.z - oz) / Math.max(dt, 1e-4);
    const turn = Math.abs(wrapPi(this.facing - of));
    if (turn > 0.25) {
      this.plant = Math.max(this.plant, 0.1);
    }
    this.sync();
    this.driveAnim(dt, live, speed);
  }

  private follow(dt: number): void {
    const route = this.def.route;
    if (!route || this.idx >= route.length) {
      return;
    }
    if (this.wait > 0) {
      this.wait -= dt;
      this.coastStop(dt);
      return;
    }
    const p = route[this.idx];
    const target = { x: p.x, z: p.z + this.shiftZ };
    const spd = p.speed ?? 8;
    const stop = this.shouldStopAt(this.idx);
    if (this.steer(target, dt, spd, stop)) {
      this.wait = p.wait ?? 0;
      this.idx += 1;
    }
  }

  /**
   * Accelerate toward `to`. Returns true when close enough
   * to treat as arrived — does not teleport onto the point.
   * `stop` eases speed near the target so they do not orbit.
   */
  steer(
    to: Vec2,
    dt: number,
    maxSpeed: number,
    stop = true
  ): boolean {
    const dist = xzDist(this, to);
    const hit = stop ? ARRIVED : FLOW_HIT;
    if (dist < 1e-4) {
      if (stop) {
        this.coastStop(dt);
      }
      return true;
    }
    const desired = Math.atan2(to.x - this.x, to.z - this.z);
    const cap = stop ? arriveCap(maxSpeed, dist) : maxSpeed;
    this.applyInertia(desired, dt, cap, maxSpeed);
    return dist < hit;
  }

  /** Break off the playbook route and run to a spot. */
  chase(to: Vec2, dt: number, speed: number): void {
    this.chasing = true;
    this.wait = 0;
    this.steer(to, dt, speed, false);
    this.pumpRun(dt, speed);
    this.sync();
  }

  /** Run straight upfield after the catch. */
  advance(dt: number, speed: number): void {
    this.chasing = true;
    this.applyInertia(0, dt, speed, speed);
    if (!this.tickHold(dt)) {
      this.pumpRun(dt, speed);
    }
    this.sync();
  }

  private driveAnim(
    dt: number,
    live: boolean,
    speed: number
  ): void {
    if (this.tickHold(dt)) {
      return;
    }
    const pos = this.def.pos;
    if (this.shouldHitch(live, speed)) {
      applyHitch(this.rig);
      this.avatar?.setMotion('idle');
      this.lookToQb();
      return;
    }
    if (pos === 'QB' && (!live || speed < 1.5)) {
      this.gait += dt;
      applyScan(this.rig, live ? this.gait : 0);
      this.avatar?.setMotion('idle');
      return;
    }
    const kind = autoKind(pos, live, speed);
    if (kind === 'run') {
      const stride = this.plant > 0 ? 0.4 : 1;
      const rate = this.plant > 0 ? 0.45 : 1;
      this.gait += dt * speed * 3.2 * rate;
      applyRun(this.rig, this.gait, stride);
      this.avatar?.setMotion('run');
      return;
    }
    this.gait += dt * Math.max(speed, 1);
    this.setAnim(kind, this.gait, speed);
  }

  private tickHold(dt: number): boolean {
    if (!this.holdKind || this.holdLeft <= 0) {
      this.holdKind = null;
      return false;
    }
    this.holdLeft -= dt;
    const u = 1 - this.holdLeft / Math.max(this.holdDur, 1e-3);
    poseRig(this.rig, this.holdKind, u, 0);
    this.avatar?.setMotion(this.holdKind, u);
    if (this.holdLeft <= 0) {
      this.holdKind = null;
    }
    return true;
  }

  private shouldHitch(live: boolean, speed: number): boolean {
    if (!live || !isSkill(this.def.pos)) {
      return false;
    }
    if (this.def.pos === 'QB' || this.chasing) {
      return false;
    }
    return this.wait > 0 || speed < 0.45;
  }

  private lookToQb(): void {
    this.facing = Math.PI;
    this.mesh.rotation.y = this.facing;
  }

  /** Line-play helper: snap mesh after moving x/z. */
  place(): void {
    this.sync();
  }

  private sync(): void {
    this.mesh.position.x = this.x;
    this.mesh.position.z = this.z;
    this.mesh.position.y = 0;
    this.mesh.rotation.y = this.facing;
  }

  /** Hitch / duplicate waypoint: brake in instead of flowing. */
  private shouldStopAt(idx: number): boolean {
    const route = this.def.route;
    if (!route) {
      return false;
    }
    const p = route[idx];
    if ((p.wait ?? 0) > 0.02) {
      return true;
    }
    if (idx + 1 >= route.length) {
      return false;
    }
    const n = route[idx + 1];
    return Math.hypot(n.x - p.x, n.z - p.z) < 0.4;
  }

  /** Brake along current velocity; used on hitches. */
  private coastStop(dt: number): void {
    this.plant = Math.max(0, this.plant - dt);
    const speed = Math.hypot(this.vx, this.vz);
    if (speed < MIN_SPD) {
      this.vx = 0;
      this.vz = 0;
      return;
    }
    const next = Math.max(0, speed - BRAKE * dt);
    const k = next / speed;
    this.vx *= k;
    this.vz *= k;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
  }

  private pumpRun(dt: number, speed: number): void {
    const moved = Math.hypot(this.vx, this.vz);
    const stride = this.plant > 0 ? 0.4 : 1;
    const rate = this.plant > 0 ? 0.45 : 1;
    this.gait += dt * Math.max(moved, speed) * 3.2 * rate;
    applyRun(this.rig, this.gait, stride);
    this.avatar?.setMotion('run');
  }

  private async attachAvatar(): Promise<void> {
    try {
      const avatar = await createAvatar(this.def);
      this.avatar = avatar;
      this.rig.pelvis.visible = false;
      this.mesh.add(avatar.root);
    } catch (error) {
      console.error('Unable to load detailed player model.', error);
    }
  }

  /**
   * Drive vx/vz along current heading. Plant (brake, then
   * turn) on sharp cuts. Facing lags toward velocity.
   */
  private applyInertia(
    desired: number,
    dt: number,
    cap: number,
    maxSpeed: number
  ): void {
    this.plant = Math.max(0, this.plant - dt);
    let speed = Math.hypot(this.vx, this.vz);
    let heading = speed > MIN_SPD
      ? Math.atan2(this.vx, this.vz)
      : desired;
    const err = wrapPi(desired - heading);
    const plantCut =
      Math.abs(err) > PLANT_ANG && speed > PLANT_SPD;
    if (plantCut) {
      this.plant = Math.max(this.plant, PLANT_T);
      speed = Math.max(0, speed - BRAKE * dt);
    } else {
      heading = headingLerp(heading, desired, TURN * dt);
      speed = accelSpeed(speed, cap, dt);
      speed = cutSpeed(speed, heading, desired, maxSpeed);
    }
    speed = Math.min(speed, maxSpeed);
    this.vx = Math.sin(heading) * speed;
    this.vz = Math.cos(heading) * speed;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.facing = headingLerp(
      this.facing,
      heading,
      TURN * dt
    );
  }
}

/** Line-play helper: call after PlayerActor.update each frame. */
export function setAnim(
  p: PlayerActor,
  kind: AnimKind,
  t: number,
  speed: number
): void {
  p.setAnim(kind, t, speed);
}

export function handPos(p: PlayerActor): THREE.Vector3 {
  p.mesh.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  p.rig.rightHand.getWorldPosition(v);
  return v;
}

function autoKind(
  pos: Pos,
  live: boolean,
  speed: number
): AnimKind {
  if (!live) {
    return 'idle';
  }
  if (pos === 'OL') {
    return 'passSet';
  }
  if (pos === 'DL') {
    return 'rush';
  }
  if (speed > 1.5) {
    return 'run';
  }
  return 'idle';
}

function isSkill(pos: Pos): boolean {
  return pos !== 'OL' && pos !== 'DL';
}

function namePlate(def: PlayerDef): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 40;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(11, 29, 54, 0.78)';
    ctx.fillRect(0, 0, 160, 40);
    ctx.fillStyle = '#e8c547';
    ctx.font = 'bold 22px Barlow Condensed, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tag = `${def.number} ${def.label}`;
    ctx.fillText(tag, 80, 21);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false
  });
  const s = new THREE.Sprite(mat);
  s.position.set(0, 2.72, 0);
  s.scale.set(1.35, 0.34, 1);
  s.center.set(0.5, 0);
  return s;
}

function arriveCap(maxSpeed: number, dist: number): number {
  if (dist >= ARRIVE_R) {
    return maxSpeed;
  }
  return maxSpeed * (dist / ARRIVE_R);
}

function accelSpeed(
  speed: number,
  cap: number,
  dt: number
): number {
  if (speed < cap) {
    return Math.min(cap, speed + ACCEL * dt);
  }
  return Math.max(cap, speed - BRAKE * dt);
}

function cutSpeed(
  speed: number,
  heading: number,
  desired: number,
  maxSpeed: number
): number {
  const dot =
    Math.sin(heading) * Math.sin(desired) +
    Math.cos(heading) * Math.cos(desired);
  // Cap, not a per-frame multiply — 60 Hz would freeze them.
  const cut = Math.max(CUT_MIN, dot);
  return Math.min(speed, maxSpeed * cut);
}
