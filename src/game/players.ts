import * as THREE from 'three';
import type { TeamMats } from './materials';
import { xzDist } from './math';
import {
  applyHitch,
  applyRun,
  applyScan,
  buildRig,
  poseRig,
  type AnimKind,
  type PlayerRig
} from './rig';
import type { CoverGrade, PlayerDef, Pos, Vec2 } from './types';

const RING_COL: Record<CoverGrade, number> = {
  idle: 0x000000,
  open: 0x3dd68c,
  window: 0xe8c547,
  covered: 0xe35d5d
};

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
  private idx = 0;
  private wait = 0;
  private gait = 0;
  private plant = 0;
  private ringMat: THREE.MeshBasicMaterial;

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
      new THREE.RingGeometry(0.75, 1.28, 28),
      this.ringMat
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.04;
    this.mesh.add(this.ring);
    this.sync();
  }

  reset(): void {
    this.x = this.def.start.x;
    this.z = this.def.start.z;
    this.facing = this.def.heading;
    this.idx = 0;
    this.wait = 0;
    this.gait = 0;
    this.plant = 0;
    this.cover = 'idle';
    this.setCover('idle');
    this.setAnim('idle', 0, 0);
    this.sync();
  }

  setCover(grade: CoverGrade): void {
    this.cover = grade;
    this.ringMat.color.setHex(RING_COL[grade]);
    this.ringMat.opacity = grade === 'idle' ? 0 : 0.95;
  }

  /** Force a pose. Call after update() to override auto locomotion. */
  setAnim(kind: AnimKind, t: number, speed: number): void {
    poseRig(this.rig, kind, t, speed);
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
      const dist = Math.hypot(p.x - x, p.z - z);
      const spd = p.speed ?? 8;
      if (spd < 0.05 || dist < 0.04) {
        x = p.x;
        z = p.z;
        wait = p.wait ?? 0;
        i += 1;
        continue;
      }
      const need = dist / spd;
      if (t >= need) {
        x = p.x;
        z = p.z;
        t -= need;
        wait = p.wait ?? 0;
        i += 1;
      } else {
        const k = (spd * t) / dist;
        x += (p.x - x) * k;
        z += (p.z - z) * k;
        t = 0;
      }
    }
    return { x, z };
  }

  update(dt: number, live: boolean): void {
    const ox = this.x;
    const oz = this.z;
    const of = this.facing;
    if (live) {
      this.follow(dt);
    }
    const speed =
      Math.hypot(this.x - ox, this.z - oz) / Math.max(dt, 1e-4);
    const turn = Math.abs(wrapPi(this.facing - of));
    this.plant = turn > 0.25 ? 0.1 : Math.max(0, this.plant - dt);
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
      return;
    }
    const p = route[this.idx];
    const target = { x: p.x, z: p.z };
    const dist = xzDist(this, target);
    const spd = p.speed ?? 8;
    const step = spd * dt;
    if (dist < 0.05 || step >= dist) {
      this.x = p.x;
      this.z = p.z;
      this.wait = p.wait ?? 0;
      this.idx += 1;
      return;
    }
    this.x += ((p.x - this.x) / dist) * step;
    this.z += ((p.z - this.z) / dist) * step;
    this.facing = Math.atan2(p.x - this.x, p.z - this.z);
  }

  private driveAnim(
    dt: number,
    live: boolean,
    speed: number
  ): void {
    const pos = this.def.pos;
    if (this.shouldHitch(live, speed)) {
      applyHitch(this.rig);
      this.lookToQb();
      return;
    }
    if (pos === 'QB' && (!live || speed < 1.5)) {
      this.gait += dt;
      applyScan(this.rig, live ? this.gait : 0);
      return;
    }
    const kind = autoKind(pos, live, speed);
    if (kind === 'run') {
      const stride = this.plant > 0 ? 0.4 : 1;
      const rate = this.plant > 0 ? 0.45 : 1;
      this.gait += dt * speed * 3.2 * rate;
      applyRun(this.rig, this.gait, stride);
      return;
    }
    this.gait += dt * Math.max(speed, 1);
    this.setAnim(kind, this.gait, speed);
  }

  private shouldHitch(live: boolean, speed: number): boolean {
    if (!live || !isSkill(this.def.pos)) {
      return false;
    }
    if (this.def.pos === 'QB') {
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
  const fx = Math.sin(p.facing);
  const fz = Math.cos(p.facing);
  return new THREE.Vector3(
    p.x + fx * 0.35,
    1.55,
    p.z + fz * 0.35
  );
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

function wrapPi(a: number): number {
  let d = a;
  while (d > Math.PI) {
    d -= Math.PI * 2;
  }
  while (d < -Math.PI) {
    d += Math.PI * 2;
  }
  return d;
}
