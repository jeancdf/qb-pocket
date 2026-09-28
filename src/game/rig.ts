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

const SCALE = 1.32;
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
  const left = arm(-ax);
  const right = arm(ax);
  const lLeg = leg(-hx);
  const rLeg = leg(hx);
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
      return jukePose(t, speed < 0 ? -1 : 1);
    case 'dive':
      return divePose(t, speed < 0 ? -1 : 1);
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
}

export function applyRun(
  rig: PlayerRig,
  phase: number,
  drive: RunDrive
): void {
  applyPose(rig, runPose(phase, drive), 'run');
}

export function applyHitch(rig: PlayerRig): void {
  applyPose(rig, hitchPose(), 'hitch');
}

export function applyScan(rig: PlayerRig, t: number): void {
  applyPose(rig, qbScan(t), 'scan');
}

/** Every write goes through the transition blender (see pose-blend). */
function applyPose(rig: PlayerRig, target: Pose, key: string): void {
  setPose(rig, unpack(blendPose(rig, key, pack(target))));
}

function setPose(rig: PlayerRig, pose: Pose): void {
  rig.pelvis.rotation.set(...pose.pelvis);
  rig.pelvis.position.set(pose.shift, HIP + pose.hop, 0);
  rig.torso.rotation.set(...pose.torso);
  rig.neck.rotation.set(...pose.neck);
  // Pose thighs use + for hip flexion (knee forward); the joint's +X
  // swings the leg backward, so flip it here.
  rig.leftThigh.rotation.set(-pose.lThigh[0], pose.lThigh[1], pose.lThigh[2]);
  rig.rightThigh.rotation.set(-pose.rThigh[0], pose.rThigh[1], pose.rThigh[2]);
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
  rig.leftArm.rotation.set(pose.lArm[0] - tp, pose.lArm[1], pose.lArm[2]);
  rig.rightArm.rotation.set(pose.rArm[0] - tp, pose.rArm[1], pose.rArm[2]);
  // Negative X folds the elbow forward (anatomical bend).
  rig.leftFore.rotation.set(-pose.lFore, 0, 0);
  rig.rightFore.rotation.set(-pose.rFore, 0, 0);
  rig.leftHand.rotation.set(...pose.lHand);
  rig.rightHand.rotation.set(...pose.rHand);
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
function runPose(phase: number, d: RunDrive): Pose {
  const k = Math.min(1.1, Math.max(0.12, d.speed / 8.5));
  const drive = clampUnit(d.accel / 12);
  const push = Math.max(0, drive);
  const brake = Math.max(0, -drive);
  const pl = clamp01(d.plant);
  const low = clamp01(d.crouch ?? 0);
  const pelvisX =
    0.05 + 0.08 * k + 0.16 * push - 0.14 * brake + 0.12 * pl + 0.14 * low;
  const torsoX =
    0.05 + 0.1 * k + 0.24 * push - 0.12 * brake + 0.14 * pl + 0.16 * low;
  const reach = (0.05 + 0.3 * k) * (1 - 0.3 * brake) + 0.35 * low;
  const amp =
    (0.27 + 0.53 * k) * (1 - 0.45 * pl) * (1 - 0.3 * brake) * (1 - 0.2 * low);
  const leg = (f: number) => {
    const w = wrapAngle(f);
    // Knee drive peaks early, then the leg paws back so the foot
    // lands near the hips instead of reaching out in front.
    const drive = (Math.sin(w + 0.35) + 0.25 * Math.sin(2 * w + 0.7)) / 1.1;
    // Heel stays folded through the knee drive, unfolds just before
    // contact (about 0.7 of a half cycle past the drive).
    const fold = Math.abs(w - 0.15) < 1.9
      ? Math.pow(Math.cos((Math.PI / 2) * ((w - 0.15) / 1.9)), 0.8)
      : 0;
    const load = Math.max(0, -Math.cos(w));
    return {
      hip: pelvisX + reach + 0.2 * pl + amp * drive,
      knee:
        0.2 + (0.45 + 1.3 * k) * fold * (1 - 0.35 * pl) +
        (0.2 + 0.15 * k + 0.45 * low) * load +
        0.45 * pl + 0.2 * brake + 0.55 * low,
      foot:
        0.55 * k * Math.pow(Math.max(0, -Math.sin(w)), 2) -
        0.15 * Math.max(0, Math.sin(w))
    };
  };
  const l = leg(phase);
  const r = leg(phase + Math.PI);
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
    hop: 0,
    shift: 0.025 * sw * (1 - k * 0.5)
  };
  // Pelvis rides on the stance leg; when both feet stretch long around
  // contact the runner is airborne, so cap the dip below mid-stance.
  const ml = leg(0);
  const mr = leg(Math.PI);
  const mid: Pose = {
    ...p,
    lThigh: [ml.hip, 0, 0],
    rThigh: [mr.hip, 0, 0],
    lShin: ml.knee,
    rShin: mr.knee
  };
  p.hop = Math.max(groundHop(p), groundHop(mid) - 0.04 - 0.03 * k);
  return p;
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

/** Arm cocked back, weight on the back foot. */
function throwCock(): Pose {
  const p = qbIdle();
  p.rArm = [-2.05, 0.22, 0.62];
  p.rFore = 0.28;
  p.rHand = [0.08, 0.2, -0.12];
  p.lArm = [-0.22, 0.28, -0.55];
  p.torso = [0.06, -0.42, 0.06];
  p.rThigh = [0.42, 0, 0];
  p.lThigh = [0.08, 0, 0];
  p.neck = [0.08, -0.18, 0];
  return p;
}

/** Ball out of the hand: hips and shoulders have turned through. */
function throwRelease(): Pose {
  const p = qbIdle();
  p.rArm = [0.55, -0.18, 0.92];
  p.rFore = 0.12;
  p.rHand = [0.22, -0.1, -0.18];
  p.lArm = [0.28, 0.22, -0.72];
  p.lFore = 0.85;
  p.torso = [0.28, 0.48, -0.08];
  p.rThigh = [0.12, 0, 0];
  p.lThigh = [0.38, 0, 0];
  p.neck = [0.1, 0.22, 0];
  return p;
}

/** Throwing arm finishes across the body, back heel comes up. */
function throwFollow(): Pose {
  const p = throwRelease();
  p.rArm = [0.95, -0.34, 0.5];
  p.rFore = 0.42;
  p.rHand = [0.3, -0.12, -0.22];
  p.lArm = [0.18, 0.3, -0.62];
  p.lFore = 1.1;
  p.torso = [0.34, 0.58, -0.1];
  p.pelvis = [0.1, 0.22, 0];
  p.rThigh = [-0.12, 0, 0];
  p.rShin = 0.72;
  p.rFoot = 0.2;
  p.lThigh = [0.44, 0, 0];
  p.lShin = 0.3;
  p.neck = [0.12, 0.26, 0];
  return p;
}

/** t is 0–1: cock the ball, whip it through, follow through. */
function throwPose(t: number): Pose {
  const u = clamp01(t);
  if (u < 0.3) {
    return lerpPose(qbIdle(), throwCock(), ease(u / 0.3));
  }
  if (u < 0.5) {
    return lerpPose(throwCock(), throwRelease(), ease((u - 0.3) / 0.2));
  }
  return lerpPose(throwRelease(), throwFollow(), ease((u - 0.5) / 0.5));
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
