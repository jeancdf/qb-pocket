import * as THREE from 'three';
import { LOS_Z } from './constants';
import type { TeamMats } from './materials';
import { headingLerp, wrapPi, xzDist } from './math';
import {
  applyHitch,
  applyRun,
  applyScan,
  buildRig,
  gripBall,
  holdsBall,
  lookAt,
  poseRig,
  reachFor,
  runPhaseRate,
  type AnimKind,
  type PlayerRig,
  type RunDrive
} from './rig';
import { snapPose } from './pose-blend';
import type { CoverGrade, PlayerDef, Pos, RoutePoint, Vec2 } from './types';

const RING_COL: Record<CoverGrade, number> = {
  idle: 0x000000,
  open: 0x3dd68c,
  window: 0xe8c547,
  covered: 0xe35d5d
};

/**
 * Locomotion is force-limited, in yards and seconds. A player pushes
 * hardest from a standstill and has less left near top speed; brakes
 * harder than he accelerates; and can only bend his path as fast as
 * his feet grip, so turns widen with speed. Sharp cuts come out as a
 * plant (brake and turn together), not a scripted stop-then-pivot.
 */
const ACCEL = 12;
const ACCEL_FADE = 0.7;
const BRAKE = 16;
const COAST = 10;
const LATERAL = 18;
const GRIP = 22;
const TURN = 7;
const PLANT_ANG = 1.08;
const PLANT_T = 0.2;
const PLANT_SPD = 2.1;
const ARRIVE_DECEL = 11;
const ARRIVED = 0.26;
const FLOW_HIT = 0.55;
const MIN_SPD = 0.4;
/** How far a tackler drives through the carrier before going down (yd). */
const TACKLE_DRIVE = 0.8;
/** A ball closer than this (yd) draws the hands out to it. */
const REACH_FROM = 2.4;
/** Below this the feet stop stepping (yd/s). */
const WALK_MIN = 0.35;
/** Body turning faster than this on the spot takes pivot steps (rad/s). */
const PIVOT_RATE = 1.6;
/** Knocked down: the fall, then getting up (s); lying time varies. */
const GROUND_FALL = 0.4;
const GROUND_UP = 0.85;

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
  /** Juked: momentum carries him on, no steering until it ends. */
  private staggerT = 0;
  /** Knocked off his feet: seconds since, -1 while standing. */
  private groundT = -1;
  private groundLen = 0;
  private groundBack = false;
  private idx = 0;
  private wait = 0;
  private gait = 0;
  /** 0–1 how far the ball is loaded up by the ear for a pass. */
  private windUp = 0;
  private windUpOn = false;
  /** Where the QB is throwing: he squares up to it while he loads. */
  private aim: Vec2 | null = null;
  /** 0–1 ball tucked under the arm while running. */
  private carry = 0;
  /** 0–1 how close the rush is (QB only): quick feet in the pocket. */
  private pressure = 0;
  /** Where this frame started, to read motion others impose (line play). */
  private frameX = 0;
  private frameZ = 0;
  private frameDt = 1 / 60;
  private frameNo = 0;
  private stepFrame = -1;
  /** Turning rate of the body, rad/s (pivot steps in place). */
  private turnRate = 0;
  /** Head turned toward what the player is watching. */
  private lookYaw = 0;
  private lookPitch = 0;
  /** 0–1 how far the hands are out for an incoming ball. */
  private reaching = 0;
  /** Tackle in progress: how far he has driven in and how far down. */
  private tackleU = -1;
  private lunge = 0;
  private tackleFall = 0;
  /** Per-player quirks, fixed for the game: tempo and arm swing. */
  private readonly tempo: number;
  private readonly armSwing: number;
  private plant = 0;
  private shiftZ = 0;
  private chasing = false;
  private offRoute = false;
  private holdKind: AnimKind | null = null;
  private holdLeft = 0;
  private holdDur = 0.4;
  private bodyLean = 0;
  private runAccel = 0;
  private runTurn = 0;
  private crouch = 0;
  private cutLean = 0;
  private dropping = false;
  private dropPeak = 0;
  private ragdollT = -1;
  private fallVx = 0;
  private fallVz = 0;
  private fallSide = 0;
  private fallDir = 1;
  private ringMat: THREE.MeshBasicMaterial;

  constructor(def: PlayerDef, mats: TeamMats) {
    this.def = def;
    this.x = def.start.x;
    this.z = def.start.z;
    this.facing = def.heading;
    const built = buildRig(def, mats);
    this.mesh = built.root;
    this.rig = built.rig;
    this.tempo = 0.95 + 0.1 * this.rig.seed;
    this.armSwing = 0.85 + 0.3 * ((this.rig.seed * 7.31) % 1);
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
  }

  reset(): void {
    this.x = this.def.start.x;
    this.z = this.def.start.z + this.shiftZ;
    this.facing = this.def.heading;
    this.vx = 0;
    this.vz = 0;
    this.staggerT = 0;
    this.groundT = -1;
    this.idx = 0;
    this.wait = 0;
    this.gait = 0;
    this.windUp = 0;
    this.windUpOn = false;
    this.aim = null;
    this.carry = 0;
    this.pressure = 0;
    this.turnRate = 0;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.reaching = 0;
    this.tackleU = -1;
    this.lunge = 0;
    this.tackleFall = 0;
    this.plant = 0;
    this.chasing = false;
    this.offRoute = false;
    this.holdKind = null;
    this.holdLeft = 0;
    this.bodyLean = 0;
    this.runAccel = 0;
    this.runTurn = 0;
    this.crouch = 0;
    this.cutLean = 0;
    this.dropping = false;
    this.dropPeak = 0;
    this.ragdollT = -1;
    this.fallVx = 0;
    this.fallVz = 0;
    this.cover = 'idle';
    this.setCover('idle');
    snapPose(this.rig);
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

  /** Gold ring under the defender the player controls. */
  setMarked(on: boolean): void {
    this.cover = 'idle';
    this.ringMat.color.setHex(on ? 0xe8c547 : RING_COL.idle);
    this.ringMat.opacity = on ? 0.95 : 0;
  }

  /** Force a pose. Call after update() to override auto locomotion. */
  setAnim(kind: AnimKind, t: number, speed: number): void {
    if ((kind === 'passSet' || kind === 'rush') && this.shuffle()) {
      return;
    }
    if (kind === 'tackle') {
      this.tackleMotion(t);
    }
    poseRig(this.rig, kind, t, speed);
  }

  /**
   * QB is charging a pass toward `spot` (null when not): the ball comes
   * up by the ear and he squares his shoulders to the target.
   */
  setWindUp(spot: Vec2 | null): void {
    this.windUpOn = spot !== null;
    if (spot) {
      this.aim = { x: spot.x, z: spot.z };
    }
  }

  /** How close the rush is, 0–1 (drives the QB's feet in the pocket). */
  setPressure(p: number): void {
    this.pressure = Math.min(1, Math.max(0, p));
  }

  /**
   * Turn the head toward a point (null: look where the body goes).
   * Call once per frame after every pose write.
   */
  watch(target: THREE.Vector3 | null, dt: number): void {
    if (this.ragdollT >= 0) {
      return;
    }
    let yaw = 0;
    let pitch = 0;
    if (target) {
      const dx = target.x - this.x;
      const dz = target.z - this.z;
      yaw = wrapPi(Math.atan2(dx, dz) - this.facing);
      if (Math.abs(yaw) > 2.3) {
        // Behind him: he cannot turn that far, so he lets it go.
        yaw = 0;
      }
      const flat = Math.max(0.5, Math.hypot(dx, dz));
      pitch = -Math.atan2(target.y - 1.75, flat);
    }
    const k = Math.min(1, dt * 7);
    this.lookYaw += (yaw - this.lookYaw) * k;
    this.lookPitch += (pitch - this.lookPitch) * k;
    lookAt(this.rig, this.lookYaw, this.lookPitch);
  }

  /**
   * Hands go out to meet a ball arriving at `ball` (null: none close).
   * Call after watch(), once per frame.
   */
  reach(ball: THREE.Vector3 | null, dt: number): void {
    if (this.ragdollT >= 0 || this.holdKind === 'catch') {
      this.reaching = 0;
      return;
    }
    let want = 0;
    if (ball) {
      const d = Math.hypot(ball.x - this.x, ball.y - 1.3, ball.z - this.z);
      want = Math.min(1, Math.max(0, (REACH_FROM - d) / 1.3));
    }
    const rate = want > this.reaching ? 9 : 5;
    this.reaching += (want - this.reaching) * Math.min(1, dt * rate);
    if (ball && this.reaching > 0.01) {
      reachFor(this.rig, ball, this.reaching);
    }
  }

  /** The ball is in this player's hands. */
  hasBall(): boolean {
    return holdsBall(this.rig);
  }

  /**
   * Line play moves blockers directly: when one is really travelling,
   * swap the chop-in-place for a shuffle whose feet match the ground.
   */
  private shuffle(): boolean {
    const dx = this.x - this.frameX;
    const dz = this.z - this.frameZ;
    const speed = Math.hypot(dx, dz) / Math.max(this.frameDt, 1e-4);
    if (speed < 0.5 || this.ragdollT >= 0) {
      return false;
    }
    const drive: RunDrive = {
      speed,
      lean: 0,
      accel: 0,
      plant: 0,
      guard: 1,
      heading: wrapPi(Math.atan2(dx, dz) - this.facing),
      tempo: this.tempo
    };
    if (this.stepFrame !== this.frameNo) {
      this.stepFrame = this.frameNo;
      this.gait += this.frameDt * runPhaseRate(drive);
    }
    applyRun(this.rig, this.gait, drive);
    return true;
  }

  /** Hold a throw/catch pose for a beat, then resume. */
  lockAnim(kind: AnimKind, seconds: number): void {
    this.dropping = false;
    if (kind === 'tackle') {
      this.tackleU = 0;
      this.lunge = 0;
    }
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
    if (this.ragdollT >= 0) {
      this.updateRagdoll(dt);
      return;
    }
    if (this.groundT >= 0) {
      this.drift(dt);
      return;
    }
    if (this.tackleFall > 0 && this.holdKind !== 'tackle') {
      // Went down with the carrier: stays down until the next snap.
      poseRig(this.rig, 'tackle', 1, 0);
      this.sync();
      return;
    }
    const ox = this.x;
    const oz = this.z;
    const of = this.facing;
    this.frameX = ox;
    this.frameZ = oz;
    this.frameDt = dt;
    this.frameNo += 1;
    if (live) {
      this.follow(dt);
    }
    const speed =
      Math.hypot(this.x - ox, this.z - oz) / Math.max(dt, 1e-4);
    const vz = (this.z - oz) / Math.max(dt, 1e-4);
    if (this.isDropping(live, vz)) {
      // Backpedal: eyes stay downfield instead of turning around.
      this.facing = of;
      this.dropping = true;
    }
    this.squareUp(dt);
    const dTurn = wrapPi(this.facing - of);
    const turn = Math.abs(dTurn);
    if (turn > 0.25) {
      this.plant = Math.max(this.plant, 0.1);
    }
    this.turnRate += (dTurn / Math.max(dt, 1e-4) - this.turnRate) *
      Math.min(1, dt * 10);
    this.sync();
    this.driveAnim(dt, live, speed);
  }

  /** While loading or releasing a pass, the QB turns to his target. */
  private squareUp(dt: number): void {
    const throwing = this.windUp > 0.05 || this.holdKind === 'throw';
    if (!throwing || !this.aim) {
      return;
    }
    const to = Math.atan2(this.aim.x - this.x, this.aim.z - this.z);
    this.facing = headingLerp(this.facing, to, 9 * dt);
  }

  /** QB retreating from the line faces upfield while he drops. */
  private isDropping(live: boolean, vz: number): boolean {
    return this.def.pos === 'QB' && live && !this.offRoute && vz < -0.05;
  }

  private follow(dt: number): void {
    const route = this.def.route;
    if (this.offRoute || !route || this.idx >= route.length) {
      // Out of script: carry the momentum and slow down, never freeze.
      this.coastStop(dt, COAST);
      return;
    }
    if (this.wait > 0) {
      this.wait -= dt;
      this.coastStop(dt, BRAKE);
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
        this.coastStop(dt, BRAKE);
      }
      return true;
    }
    const desired = Math.atan2(to.x - this.x, to.z - this.z);
    const cap = stop ? arriveCap(maxSpeed, dist) : maxSpeed;
    this.applyInertia(desired, dt, cap, maxSpeed);
    return dist < hit;
  }

  /**
   * Shift out of another body and drop the part of the velocity
   * that drives into it (`towardX/Z` points at the other player).
   */
  bump(dx: number, dz: number, towardX: number, towardZ: number): void {
    this.x += dx;
    this.z += dz;
    const into = this.vx * towardX + this.vz * towardZ;
    if (into > 0) {
      this.vx -= towardX * into;
      this.vz -= towardZ * into;
    }
  }

  /** Ran the last point of his route (or has none). */
  routeDone(): boolean {
    const route = this.def.route;
    return this.offRoute || !route || this.idx >= route.length;
  }

  /** Stop following the playbook; update() then coasts to a stop. */
  leaveRoute(): void {
    this.offRoute = true;
  }

  /** Break off the playbook route and run to a spot. */
  chase(to: Vec2, dt: number, speed: number): void {
    if (this.staggerT > 0) {
      this.drift(dt);
      return;
    }
    this.chasing = true;
    this.dropping = false;
    this.wait = 0;
    this.steer(to, dt, speed, false);
    if (!this.tickHold(dt)) {
      this.pumpRun(dt, speed);
    }
    this.sync();
  }

  /**
   * Run to where the ball comes down, brake into the spot, and
   * wait there facing the ball instead of circling it.
   */
  meet(
    to: Vec2,
    dt: number,
    speed: number,
    look: Vec2,
    ready: AnimKind = 'idle'
  ): void {
    this.chasing = true;
    this.dropping = false;
    this.wait = 0;
    const there = this.steer(to, dt, speed, true);
    const moving = Math.hypot(this.vx, this.vz) > 0.6;
    if (there && !moving) {
      this.facePoint(look);
    }
    if (!this.tickHold(dt)) {
      if (there && !moving) {
        this.setAnim(ready, 0, 0);
      } else {
        this.pumpRun(dt, Math.hypot(this.vx, this.vz));
      }
    }
    this.sync();
  }

  /**
   * Beaten by a juke: he keeps sliding on his old line, legs
   * buckling, and cannot turn back for `seconds`.
   */
  stagger(seconds: number): void {
    this.staggerT = Math.max(this.staggerT, seconds);
    this.lockAnim('stumble', seconds);
  }

  isStaggered(): boolean {
    return this.staggerT > 0;
  }

  /**
   * Off his feet (missed dive, broken ankles, stiff-armed, trucked):
   * he slides, lies there `lie` seconds, then gets up in stages. He
   * counts as staggered the whole time, so he cannot tackle or dive
   * until he is standing. `back` lands him on his back, `push` is a
   * shove (yd/s), `lying` skips the fall (already flat after a dive).
   */
  knockDown(
    lie: number,
    back = false,
    push: Vec2 | null = null,
    lying = false
  ): void {
    this.groundBack = back;
    this.groundLen = GROUND_FALL + lie + GROUND_UP;
    this.groundT = lying ? GROUND_FALL : 0;
    this.staggerT = this.groundLen - this.groundT;
    this.holdKind = null;
    this.holdLeft = 0;
    this.chasing = true;
    if (push) {
      this.vx = this.vx * 0.4 + push.x;
      this.vz = this.vz * 0.4 + push.z;
    }
  }

  isGrounded(): boolean {
    return this.groundT >= 0;
  }

  /** A grounded player's frame: slide, lie there, get up. */
  stayDown(dt: number): void {
    this.drift(dt);
  }

  private groundFrame(dt: number): void {
    this.groundT += dt;
    const k = Math.exp(-dt * 4.5);
    this.vx *= k;
    this.vz *= k;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    const t = this.groundT;
    const lie = Math.max(0.01, this.groundLen - GROUND_FALL - GROUND_UP);
    const u = t < GROUND_FALL
      ? 0.25 * (t / GROUND_FALL)
      : t < GROUND_FALL + lie
        ? 0.25 + 0.4 * ((t - GROUND_FALL) / lie)
        : 0.65 + 0.35 * Math.min(1, (t - GROUND_FALL - lie) / GROUND_UP);
    this.sync();
    poseRig(this.rig, 'ground', u, this.groundBack ? -1 : 1);
    if (t >= this.groundLen) {
      this.groundT = -1;
      this.staggerT = 0;
      this.vx = 0;
      this.vz = 0;
    }
  }

  private drift(dt: number): void {
    this.staggerT = Math.max(0, this.staggerT - dt);
    if (this.groundT >= 0) {
      this.groundFrame(dt);
      return;
    }
    const k = Math.exp(-dt * 2.4);
    this.vx *= k;
    this.vz *= k;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    if (!this.tickHold(dt)) {
      this.pumpRun(dt, Math.hypot(this.vx, this.vz));
    }
    this.sync();
  }

  /**
   * Scripted footwork (the juke): velocity is set outright, not
   * accelerated, so the plant and the cut are sharp. The caller
   * picks the pose; `dir` mirrors it.
   */
  footwork(
    vx: number,
    vz: number,
    dt: number,
    face: number,
    kind: AnimKind,
    u: number,
    dir: number
  ): void {
    this.chasing = true;
    this.holdKind = null;
    this.vx = vx;
    this.vz = vz;
    this.x += vx * dt;
    this.z += vz * dt;
    this.facing = headingLerp(this.facing, face, 16 * dt);
    this.sync();
    poseRig(this.rig, kind, u, dir);
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

  /** Bleed momentum when a controlled runner releases the stick. */
  coast(dt: number): void {
    if (this.groundT >= 0) {
      this.drift(dt);
      return;
    }
    this.coastStop(dt, COAST);
    const speed = Math.hypot(this.vx, this.vz);
    if (!this.tickHold(dt) && speed > MIN_SPD) {
      this.pumpRun(dt, speed);
    }
    this.sync();
  }

  /**
   * Transfer running momentum into an articulated fall. The rig
   * remains live while the root tumbles and slides on the turf.
   */
  startRagdoll(from: Vec2): void {
    const dx = this.x - from.x;
    const dz = this.z - from.z;
    const len = Math.max(0.2, Math.hypot(dx, dz));
    const nx = dx / len;
    const nz = dz / len;
    const forwardX = Math.sin(this.facing);
    const forwardZ = Math.cos(this.facing);
    const along = nx * forwardX + nz * forwardZ;
    this.fallDir = along >= -0.2 ? 1 : -1;
    this.fallSide = clampUnit(nx * forwardZ - nz * forwardX);
    this.fallVx = this.vx * 0.48 + nx * 1.35;
    this.fallVz = this.vz * 0.48 + nz * 1.35;
    this.ragdollT = 0;
    this.holdKind = null;
    this.holdLeft = 0;
  }

  updateRagdoll(dt: number): void {
    if (this.ragdollT < 0) {
      return;
    }
    this.ragdollT += dt;
    const drag = Math.exp(-3.2 * dt);
    this.fallVx *= drag;
    this.fallVz *= drag;
    this.x += this.fallVx * dt;
    this.z += this.fallVz * dt;
    const u = Math.min(1, this.ragdollT / 0.82);
    const eased = 1 - Math.pow(1 - u, 3);
    const angle = eased * (Math.PI / 2 - 0.03);
    const turfY =
      0.06 + eased * 0.14 + Math.sin(u * Math.PI) * 0.04;
    poseRig(this.rig, 'ragdoll', u, 0);
    this.mesh.position.set(this.x, turfY, this.z);
    this.mesh.rotation.set(
      this.fallDir * angle,
      this.facing,
      this.fallSide * angle * 0.34,
      'YXZ'
    );
  }

  isDown(): boolean {
    return this.ragdollT >= 0;
  }

  velocity(): Vec2 {
    return { x: this.vx, z: this.vz };
  }

  /** Keep zone defenders' eyes on the play while they pedal. */
  facePoint(to: Vec2): void {
    this.facing = Math.atan2(to.x - this.x, to.z - this.z);
    if (this.ragdollT < 0) {
      this.mesh.rotation.set(0, this.facing, 0);
    }
  }

  private driveAnim(
    dt: number,
    live: boolean,
    speed: number
  ): void {
    const load = this.windUpOn ? 1 : 0;
    this.windUp += (load - this.windUp) * Math.min(1, dt * (load ? 12 : 8));
    if (!this.windUpOn && this.holdKind !== 'throw') {
      this.aim = null;
    }
    if (this.tickHold(dt)) {
      return;
    }
    const pos = this.def.pos;
    if (this.shouldHitch(live, speed)) {
      applyHitch(this.rig);
      this.lookToQb();
      return;
    }
    if (pos === 'QB' && this.dropping) {
      this.dropPeak = Math.max(this.dropPeak, speed);
      if (live && (speed > 0.6 || (this.dropPeak < 1.5 && speed > 0.05))) {
        this.gait += dt * Math.max(speed, 1) * 3;
        poseRig(this.rig, 'dropback', this.gait, speed);
        return;
      }
      // Last step of the drop: plant the back foot, then set.
      this.dropPeak = 0;
      this.gait = 0;
      this.lockAnim('plant', 0.3);
      this.tickHold(dt);
      return;
    }
    if (pos === 'QB' && (!live || speed < WALK_MIN) &&
      Math.abs(this.turnRate) < PIVOT_RATE) {
      this.gait += dt;
      applyScan(this.rig, live ? this.gait : 0, this.windUp, this.pressure);
      return;
    }
    const kind = autoKind(pos, live, speed);
    if (kind === 'run') {
      this.stepRun(dt, speed);
      return;
    }
    if (kind === 'idle' && live && Math.abs(this.turnRate) > PIVOT_RATE) {
      // Turning on the spot: little pivot steps instead of sliding.
      this.stepRun(dt, 0.9, Math.sign(this.turnRate) * Math.PI / 2);
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
    if (this.holdKind === 'tackle') {
      this.tackleMotion(u);
    }
    poseRig(this.rig, this.holdKind, u, 0);
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

  /**
   * Tackler's body during the wrap-up (u 0–1): drives through the
   * carrier along his facing, then pitches forward and goes down on
   * top of him instead of standing over the fall.
   */
  private tackleMotion(u: number): void {
    if (this.tackleU < 0) {
      this.tackleU = 0;
      this.lunge = 0;
    }
    this.tackleU = Math.max(this.tackleU, u);
    const w = this.tackleU;
    const to = TACKLE_DRIVE * Math.sin(Math.PI / 2 * Math.min(1, w / 0.6));
    this.x += Math.sin(this.facing) * (to - this.lunge);
    this.z += Math.cos(this.facing) * (to - this.lunge);
    this.lunge = to;
    const f = Math.min(1, Math.max(0, (w - 0.35) / 0.6));
    this.tackleFall = (Math.PI / 2 - 0.2) * (1 - Math.pow(1 - f, 3));
    this.sync();
  }

  private sync(): void {
    this.mesh.position.x = this.x;
    this.mesh.position.z = this.z;
    if (this.tackleFall > 0) {
      const k = this.tackleFall / (Math.PI / 2);
      this.mesh.position.y = 0.18 * k;
      this.mesh.rotation.set(this.tackleFall, this.facing, 0, 'YXZ');
      return;
    }
    this.mesh.position.y = 0;
    this.mesh.rotation.set(0, this.facing, 0, 'XYZ');
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

  /** Brake along current velocity; used on hitches and coasting. */
  private coastStop(dt: number, decel: number): void {
    this.plant = Math.max(0, this.plant - dt);
    this.bodyLean *= Math.max(0, 1 - dt * 7);
    const speed = Math.hypot(this.vx, this.vz);
    const braking = speed > 1e-3 ? -decel : 0;
    this.runAccel += (braking - this.runAccel) * Math.min(1, dt * 8);
    this.runTurn *= Math.max(0, 1 - dt * 8);
    if (speed < 1e-3) {
      this.vx = 0;
      this.vz = 0;
      return;
    }
    const next = Math.max(0, speed - decel * dt);
    const k = next / speed;
    this.vx *= k;
    this.vz *= k;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
  }

  private pumpRun(dt: number, speed: number): void {
    const moved = Math.hypot(this.vx, this.vz);
    // Pose off real ground speed; the cap only keeps first steps moving.
    this.stepRun(dt, Math.max(moved, Math.min(speed, 2)));
  }

  /**
   * The gait clock runs at whatever rate keeps the planted foot still
   * on the turf for this stride (see runPhaseRate): about 3 steps/s
   * jogging to 5 at full sprint, stride length doing the rest.
   */
  private stepRun(dt: number, speed: number, heading?: number): void {
    const plant = Math.min(1, this.plant / PLANT_T);
    const moving = Math.hypot(this.vx, this.vz) > 0.2;
    const dx = this.x - this.frameX;
    const dz = this.z - this.frameZ;
    const travel = moving
      ? Math.atan2(this.vx, this.vz)
      : Math.hypot(dx, dz) > 1e-4 ? Math.atan2(dx, dz) : this.facing;
    // Ball carriers tuck it away; the QB keeps it at his chest in the
    // pocket and only tucks once he takes off.
    const hasBall = holdsBall(this.rig);
    const pocket = this.def.pos === 'QB' && speed < 3.5;
    const tuck = hasBall && !pocket ? 1 : 0;
    this.carry += (tuck - this.carry) * Math.min(1, dt * 10);
    gripBall(this.rig, this.carry > 0.5 && this.windUp < 0.3);
    this.cutLean *= Math.max(0, 1 - dt * 6);
    // Get low when the feet work hard: driving, braking or bending the
    // path (lateral yd/s²). Drop fast, rise back slowly at cruise.
    const effort = Math.min(
      1,
      Math.hypot(this.runAccel / 10, this.runTurn / 11) + plant
    );
    const rate = effort > this.crouch ? 9 : 2.5;
    this.crouch += (effort - this.crouch) * Math.min(1, dt * rate);
    const drive: RunDrive = {
      speed,
      lean: this.bodyLean + this.cutLean * plant,
      accel: this.runAccel,
      plant,
      crouch: this.crouch,
      windup: this.windUp,
      heading: heading ?? wrapPi(travel - this.facing),
      carry: this.carry,
      chest: hasBall && pocket ? 1 : 0,
      tempo: this.tempo,
      arms: this.armSwing
    };
    this.gait += dt * runPhaseRate(drive);
    applyRun(this.rig, this.gait, drive);
  }

  /**
   * Push the velocity toward `desired` at `cap` within what the
   * feet can deliver: drive/brake along the run, bend across it,
   * all inside one grip budget. Facing lags toward velocity.
   */
  private applyInertia(
    desired: number,
    dt: number,
    cap: number,
    maxSpeed: number
  ): void {
    this.plant = Math.max(0, this.plant - dt);
    const speed = Math.hypot(this.vx, this.vz);
    const moving = speed > MIN_SPD;
    // Frame of the run: along current velocity, or where he wants to go.
    const heading = moving ? Math.atan2(this.vx, this.vz) : desired;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const target = Math.min(cap, maxSpeed);
    const dvx = Math.sin(desired) * target - this.vx;
    const dvz = Math.cos(desired) * target - this.vz;
    let along = dvx * fx + dvz * fz;
    let across = dvz * fx - dvx * fz;
    const push = along > 0
      ? driveAccel(speed, maxSpeed)
      : BRAKE;
    along = clampAbs(along, push * dt);
    across = clampAbs(across, LATERAL * dt);
    const total = Math.hypot(along, across);
    if (total > GRIP * dt) {
      along *= (GRIP * dt) / total;
      across *= (GRIP * dt) / total;
    }
    this.vx += fx * along - fz * across;
    this.vz += fz * along + fx * across;
    this.runAccel += (along / Math.max(dt, 1e-4) - this.runAccel) *
      Math.min(1, dt * 8);
    this.runTurn += (Math.abs(across) / Math.max(dt, 1e-4) - this.runTurn) *
      Math.min(1, dt * 8);
    const turnErr = wrapPi(desired - heading);
    const err = Math.abs(turnErr);
    if (moving && err > PLANT_ANG && speed > PLANT_SPD) {
      this.plant = Math.max(this.plant, PLANT_T);
      // Heading angles grow toward the runner's left; bank + is right.
      this.cutLean = -Math.sign(turnErr) * 0.45;
    }
    // Bank into the actual turning force, not the stick. + across
    // pushes toward the runner's right, and + lean banks right.
    const leanTarget =
      clampUnit(across / Math.max(LATERAL * dt, 1e-4)) *
      0.42 *
      Math.min(1, speed / 4);
    this.bodyLean += (leanTarget - this.bodyLean) * Math.min(1, dt * 7);
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    const nowSpeed = Math.hypot(this.vx, this.vz);
    const look = nowSpeed > MIN_SPD
      ? Math.atan2(this.vx, this.vz)
      : desired;
    this.facing = headingLerp(this.facing, look, TURN * dt);
  }
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
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
  if (speed > WALK_MIN) {
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
  s.position.set(0, 2.4, 0);
  s.scale.set(1.35, 0.34, 1);
  s.center.set(0.5, 0);
  return s;
}

/** Top speed you can still stop from within `dist`. */
function arriveCap(maxSpeed: number, dist: number): number {
  return Math.min(maxSpeed, Math.sqrt(2 * ARRIVE_DECEL * dist));
}

/** Strong first steps, fading as the player nears top speed. */
function driveAccel(speed: number, maxSpeed: number): number {
  const fraction = Math.min(1, speed / Math.max(maxSpeed, 0.1));
  return ACCEL * (1 - ACCEL_FADE * fraction);
}

function clampAbs(value: number, limit: number): number {
  return Math.min(limit, Math.max(-limit, value));
}
