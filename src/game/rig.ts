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
      return kindPose(kind, t, speed, rig.pos);
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
}

export function applyRun(
  rig: PlayerRig,
  phase: number,
  drive: RunDrive
): void {
  // Mirrored in setPose, so a side-dependent input flips going in.
  const pose = runPose(phase, { ...drive, lean: -drive.lean });
  applyPose(rig, windUp(pose, drive.windup ?? 0, false), 'run');
}

export function applyHitch(rig: PlayerRig): void {
  applyPose(rig, hitchPose(), 'hitch');
}

/** `windup` 0–1 loads the pass up by the ear (see windUp). */
export function applyScan(rig: PlayerRig, t: number, windup = 0): void {
  applyPose(rig, windUp(qbScan(t), windup, true), 'scan');
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
 * Sprint mechanics per leg phase φ (right leg runs half a cycle
 * behind): hip swings from extension at toe-off to high knee in front,
 * the heel folds up under the hip during swing, the knee loads at
 * mid-stance, the ankle pushes off. Arms counter the legs with bent
 * elbows, shoulders counter-rotate the hips, and the head stays level.
 * Speed scales amplitude; acceleration and braking tilt the body; turns
 * bank the whole runner; a planted cut sinks the hips and shortens the
 * stride.
 */
interface RunParams {
  k: number;
  push: number;
  brake: number;
  pl: number;
  low: number;
  pelvisX: number;
  torsoX: number;
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
}

const LEG = THIGH + SHIN;
/** Ankle-to-toe lever the heel pivots on at toe-off. */
const TOE = 0.2;
const GRAVITY_RIG = 10.7 / SCALE;

function runParams(d: RunDrive): RunParams {
  const speed = Math.max(0, d.speed);
  const k = Math.min(1.1, Math.max(0.12, speed / 8.5));
  const drive = clampUnit(d.accel / 12);
  const push = Math.max(0, drive);
  const brake = Math.max(0, -drive);
  const pl = clamp01(d.plant);
  const low = clamp01(d.crouch ?? 0);
  const pelvisX =
    0.05 + 0.08 * k + 0.16 * push - 0.14 * brake + 0.12 * pl + 0.14 * low;
  const torsoX =
    0.05 + 0.1 * k + 0.24 * push - 0.12 * brake + 0.14 * pl + 0.16 * low;
  // Real runners: cadence climbs gently (about 2.6 to 4.8 steps/s),
  // ground contact shrinks from half the cycle to under a quarter.
  const baseHz = (0.85 + 0.16 * speed) * (1 - 0.35 * pl) * (1 + 0.15 * brake);
  const duty = Math.min(
    0.72,
    Math.max(0.2, 0.56 - 0.05 * speed) * (1 + 0.5 * pl + 0.2 * brake)
  );
  // The legs only reach so far; past that the feet turn over faster.
  const maxSweep = (0.85 + 0.1 * low - 0.15 * pl) * LEG;
  const sweep = Math.min((speed * duty) / baseHz / SCALE, maxSweep);
  const hz = sweep > 1e-4 ? (speed * duty) / (sweep * SCALE) : baseHz;
  const heel = (0.03 + 0.06 * k) * (1 - 0.5 * pl);
  const reach = (y: number, z: number) =>
    y + Math.sqrt(Math.max(0, (0.985 * LEG) ** 2 - z * z));
  const hEnd = Math.min(
    HIP - 0.02 - 0.015 * k - 0.1 * low - 0.06 * pl - 0.03 * brake,
    reach(ANKLE_H, sweep / 2),
    reach(ANKLE_H + heel, sweep / 2)
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
    duty,
    sweep,
    hz,
    hEnd,
    comp: 0.012 + 0.02 * k + 0.03 * low,
    rise: Math.min(0.06, (1.4 * GRAVITY_RIG * air * air) / 8),
    lift: (0.06 + 0.42 * k) * (1 - 0.5 * pl) * (1 - 0.3 * low),
    heel
  };
}

interface FootAt {
  /** Ankle forward of the hip joint, rig units. */
  z: number;
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
 * Where the ankle is at leg phase `f`. Mid-stance sits at f = pi, so the
 * left leg (phase) plants as the right arm drives forward. On the turf
 * the ankle slides back at a constant rate, exactly the body's speed.
 */
function footPath(r: RunParams, f: number): FootAt {
  const s = wrapAngle(f - Math.PI);
  const half = r.duty * Math.PI;
  const S = r.sweep;
  if (Math.abs(s) <= half) {
    const t = s / half;
    const up = Math.max(0, (t - 0.25) / 0.75);
    const y = ANKLE_H + r.heel * up * up;
    return {
      z: (-t * S) / 2,
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
  const paw = (0.03 + 0.08 * r.k) * Math.sin(Math.PI * clamp01((q - 0.45) / 0.55));
  const lift = r.lift * Math.pow(Math.sin(Math.PI * Math.pow(q, 0.8)), 1.2);
  const heel0 = r.heel * (1 - q) * (1 - q);
  const toe0 = Math.atan2(r.heel, TOE);
  return {
    z: -S / 2 + S * e + paw,
    y: ANKLE_H + heel0 + lift + 0.015 * r.k * q,
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
    const ceil = foot.y +
      Math.sqrt(Math.max(0, (0.985 * LEG) ** 2 - foot.z * foot.z));
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

/** Two-bone IK in the leg's sagittal plane, pose convention angles. */
function solveLeg(r: RunParams, foot: FootAt, h: number) {
  const z = foot.z;
  let dy = h - foot.y;
  let dist = Math.hypot(z, dy);
  const max = 0.995 * LEG;
  if (dist > max) {
    // Out of reach: let the foot hang a touch off its path.
    dy = Math.sqrt(Math.max(0, max * max - z * z));
    dist = max;
  }
  dist = Math.max(dist, 0.3 * LEG);
  const cosKnee = (THIGH * THIGH + SHIN * SHIN - dist * dist) /
    (2 * THIGH * SHIN);
  const knee = Math.PI - Math.acos(clampUnit(cosKnee));
  const cosHip = (THIGH * THIGH + dist * dist - SHIN * SHIN) /
    (2 * THIGH * dist);
  const thigh = Math.atan2(z, dy) + Math.acos(clampUnit(cosHip));
  return {
    hip: r.pelvisX + thigh,
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

function runPose(phase: number, d: RunDrive): Pose {
  const prm = runParams(d);
  const { k, pl, pelvisX, torsoX } = prm;
  const h = runHeight(prm, phase);
  const l = solveLeg(prm, footPath(prm, phase), h);
  const r = solveLeg(prm, footPath(prm, phase + Math.PI), h);
  const sw = Math.sin(phase);
  const armAmp = (0.3 + 0.6 * k) * (1 - 0.4 * pl);
  const yaw = 0.12 * (0.4 + k) * sw;
  const bank = d.lean;
  const p: Pose = {
    pelvis: [pelvisX, -yaw, bank * 0.6],
    torso: [torsoX, yaw * 1.8, bank * 0.45],
    lThigh: [l.hip, 0, 0.02],
    rThigh: [r.hip, 0, -0.02],
    lShin: l.knee,
    rShin: r.knee,
    lArm: [0.1 + armAmp * sw, 0, -0.2 - 0.25 * pl],
    rArm: [0.1 - armAmp * sw, 0, 0.2 + 0.25 * pl],
    lFore: 1.2 + 0.2 * k + 0.35 * Math.max(0, -sw),
    rFore: 1.2 + 0.2 * k + 0.35 * Math.max(0, sw),
    lHand: [0.12, 0, 0.12],
    rHand: [0.12, 0, -0.12],
    lFoot: l.foot,
    rFoot: r.foot,
    neck: [0.06 - (pelvisX + torsoX) * 0.7, -yaw * 0.8, -bank * 0.7],
    // A banked pelvis tilts the legs; sink so the planted foot stays down.
    hop: h - HIP - (h - ANKLE_H) * (1 - Math.cos(bank * 0.6)),
    shift: 0.025 * sw * (1 - k * 0.5)
  };
  return p;
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

function qbScan(t: number): Pose {
  const p = qbIdle();
  const yaw = Math.sin(t * 1.6) * 0.28;
  p.torso = [0.08, yaw, 0];
  p.neck = [0.04, yaw * 0.45, 0];
  p.lThigh = [0.2 + Math.sin(t * 2.2) * 0.08, 0, 0];
  p.rThigh = [0.14, 0, 0];
  p.rArm = [-0.52, 0.1 + Math.sin(t * 2) * 0.04, 0.3];
  p.rFore = 1.68;
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

function catchReach(): Pose {
  const p = skillIdle();
  p.lArm = [-1.35, 0.18, -0.12];
  p.rArm = [-1.32, -0.18, 0.12];
  p.lFore = 0.28;
  p.rFore = 0.32;
  p.lHand = [0.08, 0, 0.08];
  p.rHand = [0.08, 0, -0.08];
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
  p.lArm = [-2.75, 0.14, -0.08];
  p.rArm = [-2.7, -0.14, 0.08];
  p.lFore = 0.18;
  p.rFore = 0.2;
  p.torso = [-0.18, 0, 0];
  p.neck = [-0.4, 0, 0];
  p.lThigh = [0.55 * air, 0, 0.06];
  p.rThigh = [0.25 * air, 0, -0.06];
  p.lShin = 0.3 + 0.9 * air;
  p.rShin = 0.3 + 0.6 * air;
  p.hop = 0.62 * air;
  return p;
}

/** Ball secured high and tight before the first step upfield. */
function catchTuck(): Pose {
  const p = skillIdle();
  p.lArm = [-0.62, 0.3, -0.18];
  p.rArm = [-0.45, -0.1, 0.34];
  p.lFore = 1.75;
  p.rFore = 1.6;
  p.lHand = [0.2, 0.2, 0.1];
  p.rHand = [0.2, 0, -0.1];
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
function tacklePose(t: number): Pose {
  const p = lineIdle(false);
  const drive = Math.sin(Math.min(1, t) * Math.PI * 0.5);
  p.pelvis = [0.36 + drive * 0.26, 0, 0];
  p.torso = [0.48 + drive * 0.34, 0, 0];
  p.lArm = [-0.72, 0.14, -0.82];
  p.rArm = [-0.72, -0.14, 0.82];
  p.lFore = 0.42;
  p.rFore = 0.42;
  p.neck = [0.18, 0, 0];
  return p;
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
  pos: Pos
): Pose {
  switch (kind) {
    case 'passSet':
      return passSetPose(t, speed);
    case 'rush':
      return rushPose(t, speed);
    case 'engage':
      return engagePose(t);
    default: {
      const p = idlePose(pos);
      p.torso = [p.torso[0], Math.sin(t) * 0.03, 0];
      p.hop = Math.abs(Math.sin(t * 2)) * 0.005;
      return p;
    }
  }
}

/** Right hand sits near hardcoded spawn (0.35, 1.55, 0.35). */
function qbIdle(): Pose {
  return {
    pelvis: [0.04, 0, 0],
    torso: [0.06, 0, 0],
    lThigh: [0.12, 0, 0],
    rThigh: [0.16, 0, 0],
    lShin: 0.18,
    rShin: 0.22,
    lArm: [-0.4, 0.18, -0.22],
    rArm: [-0.55, 0.08, 0.32],
    lFore: 1.35,
    rFore: 1.7,
    lHand: [0.12, 0.1, 0.18],
    rHand: [0.18, 0.28, -0.08],
    lFoot: 0,
    rFoot: 0,
    neck: [0.05, 0, 0],
    hop: 0,
    shift: 0
  };
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
