import * as THREE from 'three';
import type { TeamMats } from './materials';
import {
  dressArm,
  dressLeg,
  dressPelvis,
  dressTorso
} from './player-model';
import type { PlayerDef, Pos } from './types';
import { blendPose } from './pose-blend';

export type AnimKind =
  | 'idle'
  | 'run'
  | 'passSet'
  | 'rush'
  | 'engage'
  | 'dropback'
  | 'plant'
  | 'throw'
  | 'catch'
  | 'juke'
  | 'stumble'
  | 'tackle'
  | 'ragdoll'
  | 'dive'
  | 'leap';

export interface PlayerRig {
  pos: Pos;
  /** 0–1, fixed per player: small differences in rhythm and stance. */
  seed: number;
  pelvis: THREE.Group;
  torso: THREE.Group;
  neck: THREE.Group;
  leftThigh: THREE.Group;
  rightThigh: THREE.Group;
  leftShin: THREE.Group;
  rightShin: THREE.Group;
  leftFoot: THREE.Group;
  rightFoot: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftFore: THREE.Group;
  rightFore: THREE.Group;
  leftHand: THREE.Group;
  rightHand: THREE.Group;
}

type XYZ = [number, number, number];

interface Pose {
  pelvis: XYZ;
  torso: XYZ;
  lThigh: XYZ;
  rThigh: XYZ;
  lShin: number;
  rShin: number;
  lArm: XYZ;
  rArm: XYZ;
  lFore: number;
  rFore: number;
  lHand: XYZ;
  rHand: XYZ;
  lFoot: number;
  rFoot: number;
  neck: XYZ;
  hop: number;
  shift: number;
}

const SCALE = 1.12;
const HIP = 0.86;
const THIGH = 0.4;
const SHIN = 0.36;
const UPPER = 0.26;
const FORE = 0.22;
const ARM_Y = 0.48;

/** Pelvis is the joint root; limbs hang so rotations chain. */
export function buildRig(
  def: PlayerDef,
  mats: TeamMats
): { root: THREE.Group; rig: PlayerRig } {
  const root = new THREE.Group();
  root.userData.id = def.id;
  root.scale.setScalar(SCALE);
  const bulk = def.pos === 'OL' || def.pos === 'DL';
  const limbs = { thigh: THIGH, shin: SHIN, upper: UPPER, fore: FORE };
  const pelvis = new THREE.Group();
  pelvis.position.y = HIP;
  root.add(pelvis);
  dressPelvis(pelvis, mats, bulk, def);
  const torso = new THREE.Group();
  torso.position.y = 0.08;
  const neck = new THREE.Group();
  neck.position.y = 0.56;
  torso.add(neck);
  pelvis.add(torso);
  dressTorso(torso, neck, mats, bulk, def);
  const ax = bulk ? 0.34 : 0.3;
  const hx = bulk ? 0.12 : 0.1;
  const arm = (x: number) => {
    // Shoulders ride on the torso so a leaning body keeps its arms.
    const g = joint(torso, x, ARM_Y - torso.position.y);
    const fore = joint(g, 0, -UPPER);
    const hand = joint(fore, 0, -FORE);
    dressArm(g, fore, hand, mats, bulk, limbs, x < 0 ? 1 : -1);
    return { arm: g, fore, hand };
  };
  const leg = (x: number) => {
    const thigh = joint(pelvis, x, 0);
    const shin = joint(thigh, 0, -THIGH);
    const foot = joint(shin, 0, -SHIN);
    dressLeg(thigh, shin, foot, mats, bulk, limbs);
    return { thigh, shin, foot };
  };
  // The rig faces +Z, so the player's own left is +X.
  const left = arm(ax);
  const right = arm(-ax);
  const lLeg = leg(hx);
  const rLeg = leg(-hx);
  const rig: PlayerRig = {
    pos: def.pos,
    seed: hashSeed(def.id),
    pelvis,
    torso,
    neck,
    leftThigh: lLeg.thigh,
    rightThigh: rLeg.thigh,
    leftShin: lLeg.shin,
    rightShin: rLeg.shin,
    leftFoot: lLeg.foot,
    rightFoot: rLeg.foot,
    leftArm: left.arm,
    rightArm: right.arm,
    leftFore: left.fore,
    rightFore: right.fore,
    leftHand: left.hand,
    rightHand: right.hand
  };
  stampRefs(root, rig);
  shade(root);
  addHit(root, def.id);
  applyPose(rig, idlePose(def.pos), 'idle');
  return { root, rig };
}

/** Stable 0–1 value from a player id. */
function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 10007) / 10007;
}

function joint(parent: THREE.Object3D, x: number, y: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, 0);
  parent.add(g);
  return g;
}

export function poseRig(
  rig: PlayerRig,
  kind: AnimKind,
  t: number,
  speed: number
): void {
  applyPose(rig, kindTarget(rig, kind, t, speed), kind);
}

function kindTarget(
  rig: PlayerRig,
  kind: AnimKind,
  t: number,
  speed: number
): Pose {
  switch (kind) {
    case 'run':
      return runPose(t, { speed, lean: 0, accel: 0, plant: 0 });
    case 'throw':
      return throwPose(t);
    case 'catch':
      return catchPose(t);
    case 'juke':
      return jukePose(t, speed < 0 ? 1 : -1);
    case 'dive':
      return divePose(t, speed < 0 ? 1 : -1);
    case 'leap':
      return leapPose(t);
    case 'stumble':
      return stumblePose(t);
    case 'tackle':
      return tacklePose(t);
    case 'ragdoll':
      return ragdollPose(t);
    case 'dropback':
      return dropbackPose(t, speed);
    case 'plant':
      return plantPose(t);
    default:
      return kindPose(kind, t, speed, rig.pos, rig.seed);
  }
}

/** What the locomotion is doing right now; drives the run cycle. */
export interface RunDrive {
  /** Ground speed, yards per second. */
  speed: number;
  /** Body bank into the turn, radians; + leans to the runner's right. */
  lean: number;
  /** Along-track acceleration, yd/s²; negative while braking. */
  accel: number;
  /** 0–1 while a foot is planted for a hard cut. */
  plant: number;
  /**
   * 0–1 how hard the feet are working (accelerating, braking or
   * bending the path). The runner sinks his hips and bends his knees
   * to lower his centre of gravity, then stands tall at cruise.
   */
  crouch?: number;
  /** 0–1 while a pass is being charged: ball comes up by the ear. */
  windup?: number;
  /**
   * Direction of travel relative to where the chest faces, radians:
   * 0 forward, pi backpedal, + toward the player's left.
   */
  heading?: number;
  /** 0–1 ball tucked under the right arm. */
  carry?: number;
  /** 0–1 ball held at the chest in both hands (QB in the pocket). */
  chest?: number;
  /** 0–1 blocker stance: low, wide, hands up. */
  guard?: number;
  /** Per-player cadence factor (about 0.95–1.05). */
  tempo?: number;
  /** Per-player arm swing factor. */
  arms?: number;
  /** 0–1 per player: small quirks in posture and stride wobble. */
  seed?: number;
  /** Half the hip width of this rig (set by applyRun). */
  hip?: number;
}

export function applyRun(
  rig: PlayerRig,
  phase: number,
  drive: RunDrive
): void {
  // Mirrored in setPose, so a side-dependent input flips going in.
  const pose = runPose(phase, {
    ...drive,
    lean: -drive.lean,
    hip: Math.abs(rig.leftThigh.position.x),
    seed: drive.seed ?? rig.seed
  });
  applyPose(rig, windUp(pose, drive.windup ?? 0, false), 'run');
}

export function applyHitch(rig: PlayerRig): void {
  applyPose(rig, hitchPose(), 'hitch');
}

/**
 * `windup` 0–1 loads the pass up by the ear (see windUp); `pressure`
 * 0–1 quickens the feet.
 */
export function applyScan(
  rig: PlayerRig,
  t: number,
  windup = 0,
  pressure = 0
): void {
  applyPose(rig, windUp(qbScan(t, pressure), windup, true), 'scan');
}

const reachTmp = new THREE.Vector3();
const sideTmp = new THREE.Vector3();

/**
 * Both hands go to meet the ball at `point` (world), thumbs or little
 * fingers together, blended over the pose set this frame by `amount`.
 * Two-bone IK per arm in the chest frame; past arm's length the arms
 * simply point at it.
 */
export function reachFor(
  rig: PlayerRig,
  point: THREE.Vector3,
  amount: number
): void {
  const k = clamp01(amount);
  if (k <= 0) {
    return;
  }
  rig.torso.updateWorldMatrix(true, false);
  // The player's left, in world space, to split the hands.
  sideTmp.set(1, 0, 0).transformDirection(rig.torso.matrixWorld);
  const arms: [THREE.Group, THREE.Group, number][] = [
    [rig.leftArm, rig.leftFore, 1],
    [rig.rightArm, rig.rightFore, -1]
  ];
  for (const [arm, fore, side] of arms) {
    reachTmp.copy(point).addScaledVector(sideTmp, 0.07 * side);
    rig.torso.worldToLocal(reachTmp).sub(arm.position);
    let [tx, ty, tz] = [reachTmp.x, reachTmp.y, reachTmp.z];
    const len = Math.hypot(tx, ty, tz);
    const max = 0.99 * (UPPER + FORE);
    // Aim the wrist a palm's width short of the ball.
    const want = Math.min(max, Math.max(0.12, len - 0.06));
    tx *= want / Math.max(len, 1e-4);
    ty *= want / Math.max(len, 1e-4);
    tz *= want / Math.max(len, 1e-4);
    const cosEl = (UPPER * UPPER + FORE * FORE - want * want) /
      (2 * UPPER * FORE);
    const elbow = Math.PI - Math.acos(clampUnit(cosEl));
    const reachY = UPPER + FORE * Math.cos(elbow);
    const roll = Math.asin(clampUnit(tx / Math.max(reachY, 1e-3)));
    const pitch = Math.atan2(tz, ty) -
      Math.atan2(FORE * Math.sin(elbow), -reachY * Math.cos(roll));
    const r = arm.rotation;
    r.set(
      r.x + wrapAngle(pitch - r.x) * k,
      r.y * (1 - k),
      r.z + (roll - r.z) * k
    );
    fore.rotation.x += (-elbow - fore.rotation.x) * k;
  }
}

/**
 * Turn the head toward what the player watches, on top of whatever
 * pose was set this frame: the neck takes most of it, the chest the
 * rest. `yaw` is toward the player's left, `pitch` + looks down.
 */
export function lookAt(rig: PlayerRig, yaw: number, pitch: number): void {
  const neck = rig.neck.userData.base as XYZ | undefined;
  const torso = rig.torso.userData.base as XYZ | undefined;
  if (!neck || !torso) {
    return;
  }
  const head = Math.max(-1.1, Math.min(1.1, yaw));
  const chest = Math.max(-0.45, Math.min(0.45, yaw - head));
  const nod = Math.max(-0.5, Math.min(0.6, pitch));
  rig.neck.rotation.set(neck[0] + nod * 0.8, neck[1] + head, neck[2]);
  rig.torso.rotation.set(torso[0], torso[1] + chest, torso[2]);
}

function ballIn(hand: THREE.Object3D): THREE.Object3D | undefined {
  return hand.children.find((c) => c.userData.football);
}

/** The ball is in this player's right hand. */
export function holdsBall(rig: PlayerRig): boolean {
  return ballIn(rig.rightHand) !== undefined;
}

/**
 * Seat the ball in the right hand: tucked runs it along the forearm,
 * nose in the palm and the body against the ribs; otherwise it sits
 * in the fingers, ready to throw or hand off.
 */
export function gripBall(rig: PlayerRig, tucked: boolean): void {
  const ball = ballIn(rig.rightHand);
  if (!ball) {
    return;
  }
  if (tucked) {
    ball.position.set(-0.02, 0.1, 0.05);
    ball.rotation.set(0, 0, Math.PI / 2);
  } else {
    ball.position.set(0.01, -0.05, 0.02);
    ball.rotation.set(0.4, 0.2, 1.2);
  }
}

/** Every write goes through the transition blender (see pose-blend). */
function applyPose(rig: PlayerRig, target: Pose, key: string): void {
  setPose(rig, unpack(blendPose(rig, key, pack(target))));
}

/**
 * Poses are authored with the right limbs on +X, which is the player's
 * left: mirror every pose onto the real sides here (yaw and roll flip,
 * pitch stays), so the right hand really is the right hand.
 */
function setPose(rig: PlayerRig, pose: Pose): void {
  const m = (o: THREE.Object3D, r: XYZ, pitch = r[0]) =>
    o.rotation.set(pitch, -r[1], -r[2]);
  m(rig.pelvis, pose.pelvis);
  rig.pelvis.position.set(-pose.shift, HIP + pose.hop, 0);
  m(rig.torso, pose.torso);
  m(rig.neck, pose.neck);
  // What lookAt turns the head from (the pose, not last frame's look).
  rig.torso.userData.base = rig.torso.rotation.toArray().slice(0, 3);
  rig.neck.userData.base = rig.neck.rotation.toArray().slice(0, 3);
  // Pose thighs use + for hip flexion (knee forward); the joint's +X
  // swings the leg backward, so flip it here.
  m(rig.leftThigh, pose.lThigh, -pose.lThigh[0]);
  m(rig.rightThigh, pose.rThigh, -pose.rThigh[0]);
  rig.leftShin.rotation.set(pose.lShin, 0, 0);
  rig.rightShin.rotation.set(pose.rShin, 0, 0);
  // Feet stay parallel to the turf; pose foot values add toe-down.
  const lLeg = pose.pelvis[0] - pose.lThigh[0] + pose.lShin;
  const rLeg = pose.pelvis[0] - pose.rThigh[0] + pose.rShin;
  rig.leftFoot.rotation.set(pose.lFoot - lLeg, 0, 0);
  rig.rightFoot.rotation.set(pose.rFoot - rLeg, 0, 0);
  // Pose arm pitch is measured from the pelvis; the shoulder joint now
  // sits on the torso, so take the torso's own pitch back out.
  const tp = pose.torso[0];
  m(rig.leftArm, pose.lArm, pose.lArm[0] - tp);
  m(rig.rightArm, pose.rArm, pose.rArm[0] - tp);
  // Negative X folds the elbow forward (anatomical bend).
  rig.leftFore.rotation.set(-pose.lFore, 0, 0);
  rig.rightFore.rotation.set(-pose.rFore, 0, 0);
  m(rig.leftHand, pose.lHand);
  m(rig.rightHand, pose.rHand);
}

function idlePose(pos: Pos): Pose {
  if (pos === 'QB') {
    return qbIdle();
  }
  if (pos === 'OL') {
    return lineIdle(false);
  }
  if (pos === 'DL') {
    return lineIdle(true);
  }
  return skillIdle();
}

/**
 * Run cycle, built on leg IK. Each ankle follows a path: on the turf
 * it slides back under the hips at exactly the body's speed (so the
 * planted foot stays put), in the air it folds up behind, drives
 * through and paws back down. The path runs along the direction of
 * travel relative to the chest, so the same cycle gives a forward run,
 * a backpedal, a side shuffle (feet wide, never crossing) or a slow
 * walk. Arms counter the legs, shoulders counter-rotate the hips;
 * acceleration and braking tilt the body, turns bank it, a planted cut
 * sinks the hips and shortens the stride.
 */
interface RunParams {
  k: number;
  push: number;
  brake: number;
  pl: number;
  low: number;
  pelvisX: number;
  torsoX: number;
  /** Direction of travel in the pose frame (x left-negative, z fwd). */
  mx: number;
  mz: number;
  /** How much of the travel runs along the hips (1 = straight ahead). */
  fwd: number;
  /** Hips turned toward the run, radians toward the player's left. */
  hipTurn: number;
  /** Fraction of a cycle each foot spends on the turf. */
  duty: number;
  /** Distance the planted foot travels under the hips, rig units. */
  sweep: number;
  /** Stride cycles per second that keep the planted foot still. */
  hz: number;
  /** Pelvis height at touchdown and toe-off, rig units. */
  hEnd: number;
  /** Extra sink at mid-stance. */
  comp: number;
  /** Pelvis rise over the airborne part of the stride. */
  rise: number;
  /** How high the heel folds up behind in the swing. */
  lift: number;
  /** Heel rise at toe-off, rig units. */
  heel: number;
  /** Extra stance width each side (shuffles and guard stance). */
  wide: number;
}

const LEG = THIGH + SHIN;
/** Ankle-to-toe lever the heel pivots on at toe-off. */
const TOE = 0.2;
const GRAVITY_RIG = 10.7 / SCALE;
/** Furthest the hips open toward the run under a facing chest. */
const HIP_OPEN = 1.35;

function runParams(d: RunDrive): RunParams {
  const speed = Math.max(0, d.speed);
  const k = Math.min(1.1, Math.max(0.12, speed / 8.5));
  const drive = clampUnit(d.accel / 12);
  const push = Math.max(0, drive);
  const brake = Math.max(0, -drive);
  const pl = clamp01(d.plant);
  const guard = clamp01(d.guard ?? 0);
  let low = Math.max(clamp01(d.crouch ?? 0), guard);
  // Heading is measured toward the player's left; the pose frame has
  // his left on -X (setPose mirrors it onto the rig).
  const hd = wrapAngle(d.heading ?? 0);
  const mx = -Math.sin(hd);
  const mz = Math.cos(hd);
  // Moving fast across or away from where the chest faces, the hips
  // open toward the run (a crossover) while the chest stays on target.
  const open = smooth(clamp01((speed - 2.2) / 2)) *
    clamp01((Math.abs(hd) - 0.35) / 0.5);
  const hipTurn = Math.sign(hd) * Math.min(HIP_OPEN, Math.abs(hd)) * open;
  const rel = hd - hipTurn;
  const fwd = Math.max(0, Math.cos(rel));
  const back = Math.max(0, -Math.cos(rel));
  const side = Math.abs(Math.sin(rel));
  // Pedalling or shuffling, a defender sits in an athletic stance.
  low = Math.max(low, 0.65 * clamp01(back + side));
  const tempo = d.tempo ?? 1;
  const pelvisX =
    (0.05 + 0.08 * k + 0.16 * push - 0.14 * brake) * (0.4 + 0.6 * fwd) +
    0.12 * pl + 0.14 * low + 0.12 * back;
  const torsoX =
    (0.05 + 0.1 * k + 0.24 * push - 0.12 * brake) * (0.4 + 0.6 * fwd) +
    0.14 * pl + 0.16 * low + 0.04 * back;
  // Real runners: cadence climbs gently (about 2.6 to 4.8 steps/s),
  // ground contact shrinks from half the cycle to under a quarter.
  const baseHz = (0.85 + 0.16 * speed) * (1 - 0.35 * pl) *
    (1 + 0.15 * brake) * tempo;
  const duty = Math.min(
    0.72,
    Math.max(0.2, 0.56 - 0.05 * speed) *
      (1 + 0.5 * pl + 0.2 * brake) +
      0.12 * Math.max(side, back)
  );
  // The legs only reach so far; past that the feet turn over faster.
  // Backpedals and shuffles take short steps (a shuffle never crosses).
  const maxSweep = (0.85 + 0.1 * low - 0.15 * pl) * LEG *
    (1 - 0.4 * side * (1 - open)) * (1 - 0.2 * back);
  const sweep = Math.min((speed * duty) / baseHz / SCALE, maxSweep);
  const hz = sweep > 1e-4 ? (speed * duty) / (sweep * SCALE) : baseHz;
  const heel = (0.03 + 0.06 * k) * (1 - 0.5 * pl) * (0.3 + 0.7 * fwd);
  // Shuffles keep the feet wide; once the hips open they cross over.
  const wide = 0.1 * side * (1 - open) + 0.05 * guard + 0.015 * fwd;
  const reach = (y: number, h: number) =>
    y + Math.sqrt(Math.max(0, (0.985 * LEG) ** 2 - h * h));
  const hEnd = Math.min(
    HIP - 0.02 - 0.015 * k - 0.1 * low - 0.06 * pl - 0.03 * brake,
    reach(ANKLE_H, Math.hypot(sweep / 2, wide)),
    reach(ANKLE_H + heel, Math.hypot(sweep / 2, wide))
  );
  const air = Math.max(0, 0.5 - duty) / hz;
  return {
    k,
    push,
    brake,
    pl,
    low,
    pelvisX,
    torsoX,
    mx,
    mz,
    fwd,
    hipTurn,
    duty,
    sweep,
    hz,
    hEnd,
    comp: 0.012 + 0.02 * k + 0.03 * low,
    rise: Math.min(0.06, (1.4 * GRAVITY_RIG * air * air) / 8),
    lift: (0.06 + 0.42 * k) * (1 - 0.5 * pl) * (1 - 0.3 * low) *
      (0.3 + 0.7 * fwd),
    heel,
    wide
  };
}

interface FootAt {
  /** Ankle offset from the hip joint along the travel line, rig units. */
  along: number;
  /** Ankle height above the turf. */
  y: number;
  /** Pose toe-down angle. */
  toe: number;
  /** -1..1 through stance, or null in the swing. */
  stance: number | null;
  /** 0..1 through the swing. */
  swing: number;
}

/**
 * Where the ankle is at leg phase `f`, along the travel line. Mid-
 * stance sits at f = pi, so the left leg (phase) plants as the right
 * arm drives forward. On the turf the ankle slides back at a constant
 * rate, exactly the body's speed.
 */
function footPath(r: RunParams, f: number, liftMul = 1): FootAt {
  const s = wrapAngle(f - Math.PI);
  const half = r.duty * Math.PI;
  const S = r.sweep;
  if (Math.abs(s) <= half) {
    const t = s / half;
    const up = Math.max(0, (t - 0.25) / 0.75);
    const y = ANKLE_H + r.heel * up * up;
    return {
      along: (-t * S) / 2,
      y,
      toe: Math.atan2(y - ANKLE_H, TOE),
      stance: t,
      swing: 0
    };
  }
  const q = (s > 0 ? s - half : s + 2 * Math.PI - half) /
    (2 * Math.PI - 2 * half);
  // Heel folds up behind first, then the knee drives the foot through
  // and it paws back under the hips just before contact.
  const e = smooth(clamp01((q - 0.12) / 0.8));
  const paw = (0.03 + 0.08 * r.k) * r.fwd *
    Math.sin(Math.PI * clamp01((q - 0.45) / 0.55));
  const lift = r.lift * liftMul *
    Math.pow(Math.sin(Math.PI * Math.pow(q, 0.8)), 1.2);
  const heel0 = r.heel * (1 - q) * (1 - q);
  const toe0 = Math.atan2(r.heel, TOE);
  return {
    along: -S / 2 + S * e + paw,
    y: ANKLE_H + heel0 + lift + (0.012 + 0.015 * r.k) * Math.sin(Math.PI * q),
    toe: toe0 * (1 - smooth(clamp01(q / 0.5))) -
      0.15 * smooth(clamp01((q - 0.6) / 0.4)),
    stance: null,
    swing: q
  };
}

/** Pelvis height that keeps the planted foot on the turf. */
function runHeight(r: RunParams, phase: number): number {
  let h = Infinity;
  let airborne = true;
  for (const f of [phase, phase + Math.PI]) {
    const foot = footPath(r, f);
    if (foot.stance === null) {
      continue;
    }
    airborne = false;
    const t = foot.stance;
    const flat = Math.hypot(foot.along, r.wide);
    const ceil = foot.y +
      Math.sqrt(Math.max(0, (0.985 * LEG) ** 2 - flat * flat));
    h = Math.min(h, ceil, r.hEnd - r.comp * (1 - t * t));
  }
  if (airborne) {
    // Between toe-off and the next touchdown the hips float.
    const s = wrapAngle(phase - Math.PI);
    const half = r.duty * Math.PI;
    const gap = Math.PI - 2 * half;
    const into = ((s - half) % Math.PI + Math.PI) % Math.PI;
    const q = clamp01(into / Math.max(gap, 1e-4));
    h = r.hEnd + r.rise * 4 * q * (1 - q);
  }
  return h;
}

interface LegFrame {
  /** Pelvis pose rotation (pose frame, before the mirror). */
  pelvis: XYZ;
  /** Pelvis side shift and height above the turf. */
  shift: number;
  h: number;
  /** Half the distance between the hip joints. */
  hip: number;
}

/**
 * Two-bone leg IK. The ankle target sits in the level ground frame
 * (so the planted foot stays put however the pelvis pitches, twists,
 * banks or sways); it is moved into the pelvis frame, the knee angle
 * comes from the hip-ankle distance, then the leg plane rolls out to
 * the ankle's side and pitches to reach it.
 */
function solveLeg(r: RunParams, foot: FootAt, f: LegFrame, outX: number) {
  // Where this foot lands under the (possibly opened) hips.
  const base = outX * (f.hip + r.wide);
  const bx = base * Math.cos(r.hipTurn) + foot.along * r.mx;
  const bz = base * Math.sin(r.hipTurn) + foot.along * r.mz;
  // A planted foot is fixed to the turf; a swinging one travels with
  // its hip, so the pelvis sway and hip drop do not fling the knee out.
  const free = foot.stance === null ? Math.sin(Math.PI * foot.swing) : 0;
  let wx = bx - f.shift * (1 - free);
  let wy = foot.y - f.h;
  let wz = bz;
  // Level frame into pelvis frame: undo X, then Y, then Z.
  const [px, py] = f.pelvis;
  const pz = f.pelvis[2] * (1 - free);
  let c = Math.cos(-px);
  let sn = Math.sin(-px);
  [wy, wz] = [wy * c - wz * sn, wy * sn + wz * c];
  c = Math.cos(-py);
  sn = Math.sin(-py);
  [wx, wz] = [wx * c + wz * sn, -wx * sn + wz * c];
  c = Math.cos(-pz);
  sn = Math.sin(-pz);
  [wx, wy] = [wx * c - wy * sn, wx * sn + wy * c];
  let tx = wx - outX * f.hip;
  let ty = wy;
  let tz = wz;
  const max = 0.995 * LEG;
  const len = Math.hypot(tx, ty, tz);
  if (len > max) {
    // Out of reach: the foot hangs a touch short of its path.
    tx *= max / len;
    ty *= max / len;
    tz *= max / len;
  }
  const dist = Math.max(Math.min(len, max), 0.3 * LEG);
  const cosKnee = (THIGH * THIGH + SHIN * SHIN - dist * dist) /
    (2 * THIGH * SHIN);
  const knee = Math.PI - Math.acos(clampUnit(cosKnee));
  const reachY = THIGH + SHIN * Math.cos(knee);
  // A deeply folded swing leg has almost no vertical reach; rolling it
  // by the full ratio would throw the knee across the body, so the
  // roll is capped as if the leg were half straight.
  const roll = Math.asin(clampUnit(tx / Math.max(reachY, 0.5 * LEG)));
  // In the rolled leg plane the ankle sits at (-reachY cos roll, -S sin k)
  // in (y, z); pitch that onto the target.
  const qy = -reachY * Math.cos(roll);
  const qz = -SHIN * Math.sin(knee);
  const pitch = Math.atan2(tz, ty) - Math.atan2(qz, qy);
  return {
    thigh: [-wrapAngle(pitch), 0, roll] as XYZ,
    knee,
    foot: foot.toe
  };
}

/**
 * Gait phase speed (rad/s) that keeps the planted foot still on the
 * turf. Stride length comes from the pose, so cadence follows speed.
 */
export function runPhaseRate(d: RunDrive): number {
  return runParams(d).hz * Math.PI * 2;
}

/** Ball tucked high and tight: elbow in, forearm over the ribs. */
const TUCK_ARM: XYZ = [0.24, -0.56, -0.01];
const TUCK_FORE = 2.14;

function runPose(phase: number, d: RunDrive): Pose {
  const prm = runParams(d);
  const { k, pl, pelvisX, torsoX } = prm;
  const ready = 1 - prm.fwd;
  const run = prm.fwd;
  const guard = clamp01(d.guard ?? 0);
  const seed = d.seed ?? 0.5;
  const h = runHeight(prm, phase);
  const sw = Math.sin(phase);
  const cw = Math.cos(phase);
  // No two strides alike: smooth per-step wobble in the upper body and
  // knee lift (swing only, so the planted foot never slips).
  const wob = (lane: number) => stepNoise(phase, seed * 97 + lane);
  // Backpedals and shuffles keep the hands up in front, pumping short.
  const armAmp = (0.3 + 0.6 * k) * (1 - 0.4 * pl) *
    (1 - 0.65 * ready) * (1 - guard) * (d.arms ?? 1) * (1 + 0.1 * wob(1));
  const yaw = 0.12 * (0.4 + k) * sw * (1 - 0.6 * ready) * (1 - guard) *
    (1 + 0.15 * wob(2));
  const bank = d.lean;
  const up = -0.3 * ready;
  // The pelvis rides over the planted foot: it sways onto it, the free
  // hip drops a little, and the whole body dips into each landing.
  const shift = 0.03 * cw * (1 - 0.4 * k);
  const drop = 0.05 * (0.5 + k) * cw * (1 - 0.5 * ready) * (1 - guard);
  const dip = 0.035 * (0.3 + k) * Math.cos(2 * phase) * run;
  // Opened hips turn the pelvis (pose yaw is mirrored, so it flips);
  // the chest turns back to keep facing where the player looks.
  const pelvis: XYZ = [pelvisX, -yaw - prm.hipTurn, bank * 0.6 + drop];
  const frame: LegFrame = { pelvis, shift, h, hip: d.hip ?? 0.1 };
  // Left leg hangs on -X in the pose frame, right on +X.
  const lLift = 1 + 0.1 * stepNoise(phase, seed * 53 + 7);
  const rLift = 1 + 0.1 * stepNoise(phase + Math.PI, seed * 53 + 11);
  const l = solveLeg(prm, footPath(prm, phase, lLift), frame, -1);
  const r = solveLeg(prm, footPath(prm, phase + Math.PI, rLift), frame, 1);
  // Arms trail the legs a touch and reach further forward than back;
  // the elbow closes as the hand comes up and opens as it drives back,
  // and the hand swings in toward the middle in front.
  const sa = Math.sin(phase - 0.22);
  const swing = armAmp * (sa - 0.15 * sa * Math.abs(sa));
  const lean = 0.1 * (seed - 0.5);
  const elbow = 1.38 - 0.12 * k + 0.1 * (seed - 0.5);
  const open = 0.3 * run * (1 - guard);
  const torso: XYZ = [torsoX + dip, yaw * 1.8 + prm.hipTurn,
    bank * 0.45 - 0.8 * drop];
  const p: Pose = {
    pelvis,
    torso,
    lThigh: l.thigh,
    rThigh: r.thigh,
    lShin: l.knee,
    rShin: r.knee,
    lArm: [0.08 + up + lean + swing, 0.1 * ready - 0.08 * sa * run,
      -0.24 - 0.25 * pl - 0.12 * ready + 0.1 * Math.max(0, -sa) * run],
    rArm: [0.08 + up - lean - swing, -0.1 * ready - 0.08 * sa * run,
      0.24 + 0.25 * pl + 0.12 * ready - 0.1 * Math.max(0, sa) * run],
    lFore: elbow - open * sa + 0.15 * ready,
    rFore: elbow + open * sa + 0.15 * ready,
    lHand: [0.12 + 0.1 * sa, 0, 0.14],
    rHand: [0.12 - 0.1 * sa, 0, -0.14],
    lFoot: l.foot,
    rFoot: r.foot,
    // Eyes stay level: the neck soaks up the chest's pitch, twist and roll.
    neck: [0.06 - (pelvisX + torso[0]) * 0.75, -yaw * 0.8,
      -bank * 0.7 - 0.2 * drop],
    hop: h - HIP,
    shift
  };
  if (guard > 0) {
    // Blocker's punch position: hands up and inside, elbows bent.
    p.lArm = mixXYZ(p.lArm, [-0.42 + torsoX, 0.12, -0.82], guard);
    p.rArm = mixXYZ(p.rArm, [-0.42 + torsoX, -0.12, 0.82], guard);
    p.lFore += (1.08 - p.lFore) * guard;
    p.rFore += (1.08 - p.rFore) * guard;
  }
  const chest = clamp01(d.chest ?? 0);
  if (chest > 0) {
    // Both hands stay on the ball in front of the chest.
    const rest = qbIdle();
    p.lArm = mixXYZ(p.lArm, [rest.lArm[0] + torsoX, rest.lArm[1], rest.lArm[2]], chest);
    p.rArm = mixXYZ(p.rArm, [rest.rArm[0] + torsoX, rest.rArm[1], rest.rArm[2]], chest);
    p.lFore += (rest.lFore - p.lFore) * chest;
    p.rFore += (rest.rFore - p.rFore) * chest;
    p.lHand = mixXYZ(p.lHand, rest.lHand, chest);
    p.rHand = mixXYZ(p.rHand, rest.rHand, chest);
  }
  const carry = clamp01(d.carry ?? 0);
  if (carry > 0) {
    // Only the free arm keeps pumping; the ball arm locks to the ribs.
    const tuck: XYZ = [TUCK_ARM[0] + torsoX, TUCK_ARM[1], TUCK_ARM[2]];
    p.rArm = mixXYZ(p.rArm, tuck, carry);
    p.rFore += (TUCK_FORE - p.rFore) * carry;
    p.rHand = mixXYZ(p.rHand, [0.3, 0, 0.2], carry);
    p.lArm = [p.lArm[0] - 0.15 * carry * sw, p.lArm[1], p.lArm[2]];
  }
  return p;
}

/**
 * Smooth noise in -1..1 that picks a new value every step (half a
 * gait cycle) and eases between them. `lane` separates channels.
 */
function stepNoise(phase: number, lane: number): number {
  const u = phase / Math.PI;
  const i = Math.floor(u);
  const hash = (n: number) => {
    const x = Math.sin(n * 127.1 + lane * 311.7) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1;
  };
  return hash(i) + (hash(i + 1) - hash(i)) * smooth(u - i);
}

function mixXYZ(a: XYZ, b: XYZ, k: number): XYZ {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k];
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

const ANKLE_H = 0.1;

/** Pelvis height that puts the lower of the two feet on the turf. */
function groundHop(p: Pose): number {
  const drop = (hip: number, knee: number) => {
    const a = p.pelvis[0] - hip;
    return THIGH * Math.cos(a) + SHIN * Math.cos(a + knee);
  };
  const reach = Math.max(
    drop(p.lThigh[0], p.lShin),
    drop(p.rThigh[0], p.rShin)
  );
  return ANKLE_H + reach * Math.cos(p.pelvis[2]) - HIP;
}

function wrapAngle(a: number): number {
  const t = (a + Math.PI) % (Math.PI * 2);
  return (t < 0 ? t + Math.PI * 2 : t) - Math.PI;
}

function clampUnit(v: number): number {
  return Math.min(1, Math.max(-1, v));
}

function hitchPose(): Pose {
  const p = skillIdle();
  p.lThigh = [0.22, 0, 0.04];
  p.rThigh = [0.3, 0, -0.04];
  p.lShin = 0.28;
  p.rShin = 0.38;
  p.torso = [0.1, 0.18, 0];
  p.lArm = [-0.18, 0.08, -0.52];
  p.rArm = [-0.12, -0.08, 0.48];
  p.lFore = 1.05;
  p.rFore = 1.12;
  p.lHand = [0.12, 0, 0.18];
  p.rHand = [0.16, 0, -0.16];
  p.lFoot = 0;
  p.rFoot = 0;
  p.neck = [0.06, 0.1, 0];
  p.hop = 0;
  return p;
}

/**
 * Reading the field: shoulders and eyes sweep while the ball stays at
 * the chest. Under pressure the feet stay alive, quick little steps
 * in place ("happy feet") that grow as the rush closes in.
 */
function qbScan(t: number, pressure = 0): Pose {
  const p = qbIdle();
  const yaw = Math.sin(t * 1.6) * 0.28;
  p.torso = [0.08, yaw - 0.1, 0];
  p.neck = [0.04, yaw * 0.45, 0];
  const sway = Math.sin(t * 0.9);
  p.lThigh = [p.lThigh[0] + 0.05 * sway, p.lThigh[1], p.lThigh[2]];
  p.rThigh = [p.rThigh[0] - 0.04 * sway, p.rThigh[1], p.rThigh[2]];
  const quick = clamp01((pressure - 0.15) / 0.6);
  if (quick > 0) {
    const f = Math.sin(t * 22);
    const l = Math.max(0, f) * quick;
    const r = Math.max(0, -f) * quick;
    p.lThigh = [p.lThigh[0] + 0.28 * l, p.lThigh[1], p.lThigh[2]];
    p.rThigh = [p.rThigh[0] + 0.28 * r, p.rThigh[1], p.rThigh[2]];
    p.lShin += 0.5 * l;
    p.rShin += 0.5 * r;
    p.pelvis = [p.pelvis[0] + 0.06 * quick, p.pelvis[1], p.pelvis[2]];
  }
  p.hop = Math.min(groundHop(p), groundHop(qbIdle()));
  return p;
}

/**
 * Set to throw: shoulders turned side-on, front arm pointing at the
 * target, ball up by the ear with the elbow at shoulder height, weight
 * sitting on the back (right) foot.
 */
function throwCock(): Pose {
  const p = qbIdle();
  p.pelvis = [0.02, 0.22, 0];
  p.torso = [0, 0.4, 0.12];
  p.neck = [0.04, -0.62, -0.06];
  p.rArm = [-1.65, -0.26, 1.14];
  p.rFore = 1.92;
  p.rHand = [-0.2, 0, 0.1];
  p.lArm = [-0.03, 0.89, -1.54];
  p.lFore = 0.77;
  p.lHand = [0, 0, 0.1];
  p.rThigh = [0.3, 0, -0.06];
  p.rShin = 0.45;
  p.lThigh = [0.4, 0, -0.22];
  p.lShin = 0.3;
  p.shift = 0.04;
  p.hop = groundHop(p);
  return p;
}

/**
 * Ball out of the hand: hips have fired open, the chest faces the
 * target, the arm comes over the top with the hand high and in front.
 */
function throwRelease(): Pose {
  const p = qbIdle();
  p.pelvis = [0.08, -0.15, 0];
  p.torso = [0.28, -0.2, -0.12];
  p.neck = [0, 0.3, 0.05];
  p.rArm = [-0.38, -0.88, 2.34];
  p.rFore = 0.72;
  p.rHand = [0.2, 0, 0];
  p.lArm = [0.32, 0.4, -0.32];
  p.lFore = 2.2;
  p.rThigh = [0.05, 0, -0.04];
  p.rShin = 0.35;
  p.lThigh = [0.45, 0, 0.06];
  p.lShin = 0.25;
  p.shift = -0.03;
  p.hop = groundHop(p);
  return p;
}

/** Throwing hand finishes by the left hip, back heel comes up. */
function throwFollow(): Pose {
  const p = qbIdle();
  p.pelvis = [0.12, -0.35, 0];
  p.torso = [0.42, -0.4, -0.08];
  p.neck = [-0.1, 0.5, 0.05];
  p.rArm = [1.34, -0.89, 2.35];
  p.rFore = 1.25;
  p.rHand = [0.3, 0, -0.1];
  p.lArm = [0.09, 0.62, -0.19];
  p.lFore = 2.2;
  p.rThigh = [-0.12, 0, -0.04];
  p.rShin = 0.75;
  p.rFoot = 0.35;
  p.lThigh = [0.5, 0, 0.06];
  p.lShin = 0.35;
  p.shift = -0.05;
  p.hop = groundHop(p);
  return p;
}

/**
 * t is 0–1 from the moment the ball leaves. The ball is already set
 * by the ear (see windUp), so the arm whips through at once, then
 * the body follows through and settles.
 */
function throwPose(t: number): Pose {
  const u = clamp01(t);
  if (u < 0.03) {
    return throwCock();
  }
  if (u < 0.17) {
    const k = (u - 0.03) / 0.14;
    return lerpPose(throwCock(), throwRelease(), k * k * (2 - k));
  }
  if (u < 0.55) {
    return lerpPose(throwRelease(), throwFollow(), ease((u - 0.17) / 0.38));
  }
  return lerpPose(throwFollow(), qbIdle(), 0.35 * ease((u - 0.55) / 0.45));
}

/**
 * Blend a pose toward the set-to-throw position while the pass is
 * being charged. `legs` false keeps the feet on their own cycle
 * (throwing on the run); only the arms, chest and head load up.
 */
function windUp(base: Pose, w: number, legs: boolean): Pose {
  if (w <= 0) {
    return base;
  }
  const cock = throwCock();
  if (legs) {
    return lerpPose(base, cock, w);
  }
  // Hips stay square to the run, so the chest turns a little less and
  // keeps the run's forward lean; the head still looks downfield.
  const turn = cock.torso[1] + 0.5 * cock.pelvis[1];
  const top: Pose = {
    ...base,
    torso: [base.torso[0], turn, cock.torso[2]],
    neck: [base.neck[0], -turn, cock.neck[2]],
    lArm: cock.lArm,
    rArm: cock.rArm,
    lFore: cock.lFore,
    rFore: cock.rFore,
    lHand: cock.lHand,
    rHand: cock.rHand
  };
  return lerpPose(base, top, w);
}

/** Hands up together in front of the face, thumbs close (a diamond). */
function catchReach(): Pose {
  const p = skillIdle();
  p.lArm = [-1.8, 0.66, 0.31];
  p.rArm = [-1.8, -0.66, -0.31];
  p.lFore = 0.79;
  p.rFore = 0.79;
  p.lHand = [-0.2, 0, 0.3];
  p.rHand = [-0.2, 0, -0.3];
  p.torso = [-0.12, 0, 0];
  p.neck = [-0.06, 0, 0];
  p.hop = 0.04;
  return p;
}

/**
 * Layout for a ball just out of reach: push off, body goes flat,
 * arms fully extended past the helmet, then belly-down on the
 * turf. `dir` rolls the body toward the side of the dive.
 */
function divePose(t: number, dir: number): Pose {
  const u = clamp01(t);
  const fly = ease(Math.min(1, u / 0.45));
  const land = u < 0.45 ? 0 : ease((u - 0.45) / 0.55);
  const p = catchReach();
  p.pelvis = [1.35 * fly, 0, dir * 0.35 * fly];
  p.torso = [0.1 * fly, 0, dir * 0.12 * fly];
  p.lArm = [-2.7 * fly - 1.35 * (1 - fly), 0.12, -0.1];
  p.rArm = [-2.7 * fly - 1.32 * (1 - fly), -0.12, 0.1];
  p.lFore = 0.12;
  p.rFore = 0.12;
  p.neck = [-0.55 * fly, 0, 0];
  p.lThigh = [-0.25 * fly, 0, 0.08];
  p.rThigh = [0.2 * (1 - fly), 0, -0.08];
  p.lShin = 0.3 + 0.4 * fly;
  p.rShin = 0.2 + 0.2 * fly;
  // Airborne at hip height, then flat on the grass.
  p.hop = 0.12 * Math.sin(Math.min(1, u / 0.45) * Math.PI) -
    0.6 * fly - 0.1 * land;
  return p;
}

/** High point: knees tuck, both arms up over the helmet. */
function leapPose(t: number): Pose {
  const u = clamp01(t);
  const air = Math.sin(u * Math.PI);
  const p = catchReach();
  // Arms up over the helmet, hands closing on the ball.
  p.lArm = [-2.75, 0.14, 0.1];
  p.rArm = [-2.7, -0.14, -0.1];
  p.lFore = 0.3;
  p.rFore = 0.32;
  p.torso = [-0.18, 0, 0];
  p.neck = [-0.4, 0, 0];
  p.lThigh = [0.55 * air, 0, 0.06];
  p.rThigh = [0.25 * air, 0, -0.06];
  p.lShin = 0.3 + 0.9 * air;
  p.rShin = 0.3 + 0.6 * air;
  p.hop = 0.62 * air;
  return p;
}

/**
 * Ball secured high and tight before the first step upfield: tucked
 * under the right arm, left hand over its nose.
 */
function catchTuck(): Pose {
  const p = skillIdle();
  p.lArm = [-1.41, 0.86, 1.17];
  p.rArm = [0.44, -0.88, 0];
  p.lFore = 1.09;
  p.rFore = 2.3;
  p.lHand = [0.2, 0.2, 0.1];
  p.rHand = [0.3, 0, 0.2];
  p.torso = [0.18, 0, 0];
  p.neck = [0.1, 0, 0];
  return p;
}

/** t is 0–1: hands up to the ball, then pull it into the chest. */
function catchPose(t = 0): Pose {
  const u = clamp01(t);
  if (u < 0.55) {
    return catchReach();
  }
  return lerpPose(catchReach(), catchTuck(), ease((u - 0.55) / 0.45));
}

/** QB backpedals facing upfield, ball carried at the chest. */
function dropbackPose(phase: number, speed: number): Pose {
  const k = Math.min(1, speed / 5);
  const f = Math.sin(phase);
  const p = qbIdle();
  p.pelvis = [0.12, 0.05 * f, 0];
  p.torso = [0.02, -0.06 * f, 0];
  // Feet reach back under the hips; the lifting knee folds high.
  p.lThigh = [0.28 - 0.3 * k * f, 0, 0.04];
  p.rThigh = [0.28 + 0.3 * k * f, 0, -0.04];
  p.lShin = 0.4 + 0.7 * k * Math.max(0, f);
  p.rShin = 0.4 + 0.7 * k * Math.max(0, -f);
  p.lFoot = 0.25 * k * Math.max(0, -f);
  p.rFoot = 0.25 * k * Math.max(0, f);
  p.neck = [0.0, 0, 0];
  p.hop = groundHop(p);
  return p;
}

/** t is 0–1: back foot hits, knees load, then settle into the set. */
function plantPose(t: number): Pose {
  const deep = qbIdle();
  deep.pelvis = [0.14, 0, 0];
  deep.torso = [0.2, 0, 0];
  deep.rThigh = [-0.1, 0, -0.06];
  deep.rShin = 0.5;
  deep.rFoot = 0.1;
  deep.lThigh = [0.46, 0, 0.05];
  deep.lShin = 0.4;
  deep.neck = [0.1, 0, 0];
  deep.hop = -0.05;
  const u = clamp01(t);
  if (u < 0.35) {
    return deep;
  }
  return lerpPose(deep, qbIdle(), ease((u - 0.35) / 0.65));
}

/** Ball carrier plants outside the frame and cuts across it. */
/** Share of the juke spent sinking into the plant step. */
const JUKE_PLANT = 0.17;

/**
 * Juke in two beats, mirrored by `dir` (the cut side):
 * plant — sink, jab the outside foot wide, shoulders sell the
 * other way; cut — push off that foot, hips and chest whip into
 * the new line, ball tucked high and tight.
 */
function jukePose(t: number, dir: number): Pose {
  const u = Math.min(1, Math.max(0, t));
  // Push foot is the one opposite the cut.
  const push = dir > 0 ? 'l' : 'r';
  const lead = push === 'l' ? 'r' : 'l';
  const pushSide = push === 'l' ? 1 : -1;
  if (u < JUKE_PLANT) {
    const k = Math.sin((u / JUKE_PLANT) * Math.PI * 0.5);
    const p = runPose(0, { speed: 1.5, lean: 0, accel: -14 * k, plant: k });
    p.pelvis = [0.3 * k, -dir * 0.18 * k, -dir * 0.28 * k];
    p.torso = [0.34 * k, -dir * 0.24 * k, -dir * 0.36 * k];
    p[`${push}Thigh`] = [0.35 * k, 0, pushSide * 0.5 * k];
    p[`${push}Shin`] = 0.35 + 0.35 * k;
    p[`${lead}Thigh`] = [0.55 * k, 0, 0];
    p[`${lead}Shin`] = 0.5 + 0.55 * k;
    p.lArm = [0.2, 0, -0.55 - 0.3 * k];
    p.rArm = [-0.48, -0.18, 0.38];
    p.rFore = 1.72;
    p.neck = [0.1, -dir * 0.22 * k, 0];
    p.hop = -0.1 * k;
    p.shift = -dir * 0.1 * k;
    return p;
  }
  const c = (u - JUKE_PLANT) / (1 - JUKE_PLANT);
  const whip = Math.sin(Math.min(1, c * 1.4) * Math.PI * 0.5);
  const ease = 1 - c * 0.55;
  const p = runPose(c * Math.PI * 2, {
    speed: 6.5,
    lean: dir * 0.35 * whip * ease,
    accel: 8 * (1 - c),
    plant: 1 - whip
  });
  p.pelvis = [0.26, dir * 0.24 * whip, dir * 0.42 * whip * ease];
  p.torso = [0.3, dir * 0.3 * whip, dir * 0.5 * whip * ease];
  p[`${push}Thigh`] = [-0.55 * whip, 0, pushSide * 0.35 * ease];
  p[`${push}Shin`] = 0.15;
  p[`${lead}Thigh`] = [0.75 * whip, 0, -pushSide * 0.2];
  p[`${lead}Shin`] = 0.85;
  p.lArm = [-0.3, 0, -0.7 * ease];
  p.rArm = [-0.48, -0.18, 0.38];
  p.rFore = 1.72;
  p.neck = [0.06, dir * 0.28 * whip, 0];
  p.hop = 0.03;
  p.shift = dir * 0.08 * whip * ease;
  return p;
}

/** A beaten defender overstrides before recovering pursuit. */
function stumblePose(t: number): Pose {
  const p = runPose(t * Math.PI * 2.2, {
    speed: 3.5,
    lean: 0,
    accel: -8,
    plant: 0
  });
  const fall = Math.sin(Math.min(1, t) * Math.PI);
  p.pelvis = [0.38 + fall * 0.3, 0, fall * 0.22];
  p.torso = [0.64 + fall * 0.38, 0, fall * -0.28];
  p.lArm = [0.54, 0.1, -0.72];
  p.rArm = [0.46, -0.1, 0.72];
  p.lFore = 0.28;
  p.rFore = 0.24;
  p.hop = groundHop(p);
  return p;
}

/** Defender lowers a shoulder and wraps through contact. */
/**
 * Wrap-up tackle, t 0–1: sink and drive with the arms cocked, shoulder
 * into the hips with the head across and both arms closing behind the
 * carrier, then go down with him (PlayerActor pitches the whole body
 * forward from about 0.35), legs trailing out behind.
 */
function tacklePose(t: number): Pose {
  const u = clamp01(t);
  const drive = lineIdle(false);
  drive.pelvis = [0.4, 0, 0];
  drive.torso = [0.35, 0, 0];
  drive.lArm = [0.45, 0.2, -0.5];
  drive.rArm = [0.45, -0.2, 0.5];
  drive.lFore = 1.3;
  drive.rFore = 1.3;
  drive.lThigh = [0.75, 0, 0.04];
  drive.rThigh = [-0.1, 0, -0.04];
  drive.lShin = 0.9;
  drive.rShin = 0.5;
  drive.rFoot = 0.3;
  drive.neck = [-0.25, 0, 0];
  drive.hop = groundHop(drive);
  const wrap: Pose = {
    ...drive,
    torso: [0.4, 0, 0],
    lArm: [-0.3, 1.29, -0.35],
    rArm: [-0.3, -1.29, 0.35],
    lFore: 1.5,
    rFore: 1.5,
    lThigh: [0.55, 0, 0.04],
    rThigh: [-0.25, 0, -0.04],
    lShin: 0.7,
    rShin: 0.35,
    neck: [-0.3, 0.55, 0]
  };
  wrap.hop = groundHop(wrap);
  const down: Pose = {
    ...wrap,
    // The root is pitched flat by now: body straight, chin up.
    pelvis: [-0.1, 0, 0],
    torso: [0.02, 0, 0],
    lThigh: [0.02, 0, 0.08],
    rThigh: [-0.08, 0, -0.08],
    lShin: 0.3,
    rShin: 0.5,
    lFoot: 0.5,
    rFoot: 0.5,
    neck: [-1.0, 0.45, 0],
    hop: 0
  };
  if (u < 0.22) {
    return drive;
  }
  if (u < 0.4) {
    return lerpPose(drive, wrap, ease((u - 0.22) / 0.18));
  }
  return lerpPose(wrap, down, ease((u - 0.4) / 0.6));
}

/**
 * Loose limbs continue moving after impact while the actor root
 * tumbles under simple momentum in PlayerActor.
 */
function ragdollPose(t: number): Pose {
  const u = Math.min(1, Math.max(0, t));
  const loose = Math.sin(u * Math.PI * 2.4);
  const p = skillIdle();
  p.pelvis = [0.25 + u * 0.5, loose * 0.16, loose * 0.2];
  p.torso = [0.22 + u * 0.82, loose * -0.24, loose * 0.34];
  p.lThigh = [0.28 + u * 0.95, 0, 0.52 + loose * 0.2];
  p.rThigh = [0.46 - u * 0.42, 0, -0.48 - loose * 0.18];
  p.lShin = 0.38 + u * 1.05;
  p.rShin = 0.42 + u * 0.72;
  p.lArm = [0.18 + loose * 0.72, 0.3, -1.48];
  p.rArm = [-0.22 - loose * 0.62, -0.26, 1.42];
  p.lFore = 0.22 + u * 0.92;
  p.rFore = 0.32 + u * 0.88;
  p.neck = [0.16 + u * 0.3, loose * -0.16, loose * 0.1];
  return p;
}

const XYZ_KEYS = [
  'pelvis',
  'torso',
  'lThigh',
  'rThigh',
  'lArm',
  'rArm',
  'lHand',
  'rHand',
  'neck'
] as const;
const NUM_KEYS = [
  'lShin',
  'rShin',
  'lFore',
  'rFore',
  'lFoot',
  'rFoot',
  'hop',
  'shift'
] as const;

function pack(p: Pose): number[] {
  const out: number[] = [];
  for (const k of XYZ_KEYS) {
    out.push(p[k][0], p[k][1], p[k][2]);
  }
  for (const k of NUM_KEYS) {
    out.push(p[k]);
  }
  return out;
}

function unpack(v: number[]): Pose {
  const p = {} as Pose;
  let i = 0;
  for (const k of XYZ_KEYS) {
    p[k] = [v[i], v[i + 1], v[i + 2]];
    i += 3;
  }
  for (const k of NUM_KEYS) {
    p[k] = v[i];
    i += 1;
  }
  return p;
}

function lerpPose(a: Pose, b: Pose, k: number): Pose {
  const va = pack(a);
  const vb = pack(b);
  return unpack(va.map((x, i) => x + (vb[i] - x) * k));
}

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

function ease(t: number): number {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
}

function kindPose(
  kind: AnimKind,
  t: number,
  speed: number,
  pos: Pos,
  seed: number
): Pose {
  switch (kind) {
    case 'passSet':
      return passSetPose(t, speed);
    case 'rush':
      return rushPose(t, speed);
    case 'engage':
      return engagePose(t);
    default:
      return breathe(idlePose(pos), t, seed);
  }
}

/**
 * Standing still is never frozen: slow breathing lifts the chest, the
 * weight drifts from one foot to the other, each player on his own
 * rhythm and with his own stance width.
 */
function breathe(p: Pose, t: number, seed: number): Pose {
  const rate = 1.7 + 0.5 * seed;
  const b = Math.sin(t * rate + seed * 11);
  const sway = Math.sin(t * 0.45 + seed * 23);
  const width = 0.03 * (seed - 0.5);
  p.torso = [p.torso[0] - 0.02 * b, p.torso[1] + 0.03 * sway, p.torso[2]];
  p.neck = [p.neck[0] + 0.015 * b, p.neck[1], p.neck[2]];
  p.lArm = [p.lArm[0], p.lArm[1], p.lArm[2] - 0.03 * b];
  p.rArm = [p.rArm[0], p.rArm[1], p.rArm[2] + 0.03 * b];
  p.lThigh = [p.lThigh[0] + 0.04 * sway, p.lThigh[1], p.lThigh[2] - width];
  p.rThigh = [p.rThigh[0] - 0.04 * sway, p.rThigh[1], p.rThigh[2] + width];
  p.lShin += 0.06 * Math.max(0, sway);
  p.rShin += 0.06 * Math.max(0, -sway);
  p.shift += 0.02 * sway;
  p.hop = groundHop(p);
  return p;
}

/**
 * QB at rest in the pocket: ball held in both hands at the chest,
 * feet shoulder-width and staggered (right foot back, the throwing
 * side), knees soft.
 */
function qbIdle(): Pose {
  const p: Pose = {
    pelvis: [0.08, 0.1, 0],
    torso: [0.08, -0.1, 0],
    lThigh: [0.34, 0, -0.08],
    rThigh: [0.02, 0, 0.1],
    lShin: 0.34,
    rShin: 0.36,
    lArm: [-0.32, 1.02, -0.18],
    rArm: [-0.44, -1.02, 0.08],
    lFore: 1.54,
    rFore: 1.55,
    lHand: [0.1, 0, 0.2],
    rHand: [0.1, 0, -0.2],
    lFoot: 0,
    rFoot: 0.06,
    neck: [0.05, 0, 0],
    hop: 0,
    shift: 0.02
  };
  p.hop = groundHop(p);
  return p;
}

function skillIdle(): Pose {
  return {
    pelvis: [0.16, 0, 0],
    torso: [0.14, 0, 0],
    lThigh: [0.38, 0, 0.03],
    rThigh: [0.36, 0, -0.03],
    lShin: 0.4,
    rShin: 0.38,
    lArm: [-0.18, 0.1, -0.55],
    rArm: [-0.15, -0.1, 0.55],
    lFore: 1.12,
    rFore: 1.1,
    lHand: [0.14, 0, 0.16],
    rHand: [0.14, 0, -0.16],
    lFoot: 0,
    rFoot: 0,
    neck: [0.08, 0, 0],
    hop: 0,
    shift: 0
  };
}

function lineIdle(threePoint: boolean): Pose {
  return {
    pelvis: [0.32, 0, 0],
    torso: [0.28, 0, 0],
    lThigh: [0.58, 0, 0.05],
    rThigh: [0.55, 0, -0.05],
    lShin: 0.52,
    rShin: 0.5,
    lArm: threePoint ? [0.25, 0.18, -0.35] : [-0.22, 0.08, -0.72],
    rArm: threePoint ? [-0.18, -0.12, 0.7] : [-0.2, -0.08, 0.72],
    lFore: threePoint ? 0.42 : 1.18,
    rFore: 1.12,
    lHand: [0.1, 0, 0.18],
    rHand: [0.12, 0, -0.18],
    lFoot: 0,
    rFoot: 0,
    neck: [0.12, 0, 0],
    hop: 0,
    shift: 0
  };
}

function passSetPose(t: number, speed: number): Pose {
  const w = Math.sin(t * (6 + speed * 0.4));
  return {
    pelvis: [0.18, 0, w * 0.04],
    torso: [0.1, 0, 0],
    lThigh: [0.42 + w * 0.12, w * 0.16, 0.06],
    rThigh: [0.42 - w * 0.12, -w * 0.16, -0.06],
    lShin: 0.38,
    rShin: 0.38,
    lArm: [-0.42, 0.12, -0.82],
    rArm: [-0.42, -0.12, 0.82],
    lFore: 1.08,
    rFore: 1.08,
    lHand: [0.08, 0, 0.12],
    rHand: [0.08, 0, -0.12],
    lFoot: 0,
    rFoot: 0,
    neck: [0.06, 0, 0],
    hop: 0,
    shift: w * 0.03
  };
}

function rushPose(t: number, speed: number): Pose {
  const chop = Math.sin(t * (8 + speed * 0.5));
  const s = Math.sin(t * 4) * 0.28;
  const lag = Math.sin(t * (8 + speed * 0.5) - 0.55);
  return {
    pelvis: [0.22, 0, 0],
    torso: [0.34, 0, 0],
    lThigh: [0.4 + s, 0, 0],
    rThigh: [0.4 - s, 0, 0],
    lShin: 0.4 + Math.max(0, -s) * 0.5,
    rShin: 0.4 + Math.max(0, s) * 0.5,
    lArm: [0.15 + chop * 0.55, 0.05, -0.38],
    rArm: [0.15 - chop * 0.55, -0.05, 0.38],
    lFore: 0.92 + lag * 0.28,
    rFore: 0.92 - lag * 0.28,
    lHand: [0.2, 0, 0.14],
    rHand: [0.2, 0, -0.14],
    lFoot: Math.max(0, -s) * 0.3,
    rFoot: Math.max(0, s) * 0.3,
    neck: [0.1, 0, 0],
    hop: Math.abs(Math.sin(t * 2)) * 0.02,
    shift: 0
  };
}

function engagePose(t: number): Pose {
  const shove = Math.sin(t * 5);
  return {
    pelvis: [0.28, shove * 0.1, 0],
    torso: [0.4, shove * 0.15, 0],
    lThigh: [0.48, 0, 0.05],
    rThigh: [0.46, 0, -0.05],
    lShin: 0.42,
    rShin: 0.4,
    lArm: [-0.55, 0.1, -0.48],
    rArm: [-0.55, -0.1, 0.48],
    lFore: 0.72,
    rFore: 0.72,
    lHand: [0.05, 0, 0.1],
    rHand: [0.05, 0, -0.1],
    lFoot: 0,
    rFoot: 0,
    neck: [0.14, shove * 0.08, 0],
    hop: 0,
    shift: shove * 0.05
  };
}

function stampRefs(root: THREE.Group, rig: PlayerRig): void {
  root.userData.pelvis = rig.pelvis;
  root.userData.torso = rig.torso;
  root.userData.neck = rig.neck;
  root.userData.leftThigh = rig.leftThigh;
  root.userData.rightThigh = rig.rightThigh;
  root.userData.leftShin = rig.leftShin;
  root.userData.rightShin = rig.rightShin;
  root.userData.leftFoot = rig.leftFoot;
  root.userData.rightFoot = rig.rightFoot;
  root.userData.leftArm = rig.leftArm;
  root.userData.rightArm = rig.rightArm;
  root.userData.leftFore = rig.leftFore;
  root.userData.rightFore = rig.rightFore;
  root.userData.leftHand = rig.leftHand;
  root.userData.rightHand = rig.rightHand;
}

function shade(root: THREE.Group): void {
  root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
}

function addHit(root: THREE.Group, id: string): void {
  const hit = new THREE.Mesh(
    new THREE.SphereGeometry(0.7, 8, 8),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hit.position.y = 1;
  hit.userData.id = id;
  root.add(hit);
}
