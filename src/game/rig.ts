import * as THREE from 'three';
import { numberTexture, type TeamMats } from './materials';
import type { PlayerDef, Pos } from './types';

export type AnimKind =
  | 'idle'
  | 'run'
  | 'passSet'
  | 'rush'
  | 'engage'
  | 'throw'
  | 'catch'
  | 'juke'
  | 'stumble'
  | 'tackle'
  | 'ragdoll';

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
  const pelvis = new THREE.Group();
  pelvis.position.y = HIP;
  root.add(pelvis);
  addPants(pelvis, mats, bulk);
  const { torso, neck } = addTorso(pelvis, mats, def, bulk);
  const ax = bulk ? 0.36 : 0.32;
  const hx = bulk ? 0.14 : 0.12;
  const left = addArm(pelvis, -ax, mats, bulk);
  const right = addArm(pelvis, ax, mats, bulk);
  const lLeg = addLeg(pelvis, -hx, mats, bulk);
  const rLeg = addLeg(pelvis, hx, mats, bulk);
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
  applyPose(rig, idlePose(def.pos));
  return { root, rig };
}

export function poseRig(
  rig: PlayerRig,
  kind: AnimKind,
  t: number,
  speed: number
): void {
  if (kind === 'run') {
    const stride = Math.min(1.05, 0.45 + speed / 9);
    applyPose(rig, runPose(t, stride));
    return;
  }
  if (kind === 'throw') {
    applyPose(rig, throwPose(t));
    return;
  }
  if (kind === 'catch') {
    applyPose(rig, catchPose());
    return;
  }
  if (kind === 'juke') {
    applyPose(rig, jukePose(t));
    return;
  }
  if (kind === 'stumble') {
    applyPose(rig, stumblePose(t));
    return;
  }
  if (kind === 'tackle') {
    applyPose(rig, tacklePose(t));
    return;
  }
  if (kind === 'ragdoll') {
    applyPose(rig, ragdollPose(t));
    return;
  }
  applyPose(rig, kindPose(kind, t, speed, rig.pos));
}

export function applyRun(
  rig: PlayerRig,
  phase: number,
  stride: number,
  lean = 0
): void {
  const pose = runPose(phase, stride);
  pose.pelvis[2] += lean * 0.45;
  pose.torso[2] += lean;
  applyPose(rig, pose);
}

export function applyHitch(rig: PlayerRig): void {
  applyPose(rig, hitchPose());
}

export function applyScan(rig: PlayerRig, t: number): void {
  applyPose(rig, qbScan(t));
}

function applyPose(rig: PlayerRig, pose: Pose): void {
  rig.pelvis.rotation.set(...pose.pelvis);
  rig.pelvis.position.set(pose.shift, HIP + pose.hop, 0);
  rig.torso.rotation.set(...pose.torso);
  rig.neck.rotation.set(...pose.neck);
  rig.leftThigh.rotation.set(...pose.lThigh);
  rig.rightThigh.rotation.set(...pose.rThigh);
  rig.leftShin.rotation.set(pose.lShin, 0, 0);
  rig.rightShin.rotation.set(pose.rShin, 0, 0);
  rig.leftFoot.rotation.set(pose.lFoot, 0, 0);
  rig.rightFoot.rotation.set(pose.rFoot, 0, 0);
  rig.leftArm.rotation.set(...pose.lArm);
  rig.rightArm.rotation.set(...pose.rArm);
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

function runPose(phase: number, stride: number): Pose {
  const s = Math.sin(phase) * 0.7 * stride;
  const recL = Math.max(0, -s) * 0.9;
  const recR = Math.max(0, s) * 0.9;
  const plant = stride < 0.6 ? 0.22 : 0;
  // Forearm lags the upper pump so elbows read from camera.
  const lag = Math.sin(phase - 0.4) * 0.7 * stride;
  const lFore = 0.55 + 0.18 * stride + Math.max(0, -lag) * 0.7;
  const rFore = 0.55 + 0.18 * stride + Math.max(0, lag) * 0.7;
  return {
    pelvis: [0.06, 0, 0],
    torso: [0.12, 0, 0],
    lThigh: [s, 0, 0],
    rThigh: [-s, 0, 0],
    lShin: 0.22 + recL + plant,
    rShin: 0.22 + recR + plant,
    lArm: [-s * 0.9 + 0.12, 0, -0.32],
    rArm: [s * 0.9 + 0.12, 0, 0.32],
    lFore,
    rFore,
    lHand: [0.18 + s * 0.12, 0, 0.16],
    rHand: [0.18 - s * 0.12, 0, -0.16],
    lFoot: 0.1 - recL * 0.32,
    rFoot: 0.1 - recR * 0.32,
    neck: [0.04, 0, 0],
    hop: Math.abs(Math.sin(phase * 2)) * 0.04,
    shift: 0
  };
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
  p.lFoot = -0.35;
  p.rFoot = -0.42;
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

/** t is 0–1: cock the ball, then whip the throw. */
function throwPose(t: number): Pose {
  const p = qbIdle();
  const u = Math.min(1, Math.max(0, t));
  if (u < 0.38) {
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

function catchPose(): Pose {
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

/** Ball carrier plants outside the frame and cuts across it. */
function jukePose(t: number): Pose {
  const p = runPose(t * Math.PI * 2, 0.58);
  const side = Math.sin(Math.min(1, t) * Math.PI);
  p.pelvis = [0.18, side * 0.18, side * -0.32];
  p.torso = [0.24, side * -0.22, side * -0.48];
  p.lThigh[2] = 0.2;
  p.rThigh[2] = -0.34;
  p.rArm = [-0.48, -0.18, 0.38];
  p.rFore = 1.72;
  p.neck = [0.08, side * 0.18, side * 0.2];
  p.hop = 0.02;
  return p;
}

/** A beaten defender overstrides before recovering pursuit. */
function stumblePose(t: number): Pose {
  const p = runPose(t * Math.PI * 3, 0.42);
  const fall = Math.sin(Math.min(1, t) * Math.PI);
  p.pelvis = [0.38 + fall * 0.3, 0, fall * 0.22];
  p.torso = [0.64 + fall * 0.38, 0, fall * -0.28];
  p.lArm = [0.54, 0.1, -0.72];
  p.rArm = [0.46, -0.1, 0.72];
  p.lFore = 0.28;
  p.rFore = 0.24;
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
  p.pelvis = [0.2 + u * 0.45, loose * 0.12, loose * 0.08];
  p.torso = [0.18 + u * 0.72, loose * -0.18, loose * 0.14];
  p.lThigh = [0.3 + u * 0.82, 0, 0.24 + loose * 0.16];
  p.rThigh = [0.42 - u * 0.34, 0, -0.2 - loose * 0.12];
  p.lShin = 0.34 + u * 0.92;
  p.rShin = 0.38 + u * 0.58;
  p.lArm = [0.1 + loose * 0.8, 0.24, -0.94];
  p.rArm = [-0.18 - loose * 0.54, -0.18, 0.84];
  p.lFore = 0.3 + u * 0.72;
  p.rFore = 0.5 + u * 0.58;
  p.neck = [0.12 + u * 0.24, loose * -0.12, 0];
  return p;
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
    lFoot: -0.28,
    rFoot: -0.32,
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
    lFoot: -0.62,
    rFoot: -0.58,
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
    lFoot: -0.85,
    rFoot: -0.78,
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
    lFoot: -0.55,
    rFoot: -0.55,
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
    lFoot: -0.45 + Math.max(0, -s) * 0.2,
    rFoot: -0.45 + Math.max(0, s) * 0.2,
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
    lFoot: -0.7,
    rFoot: -0.66,
    neck: [0.14, shove * 0.08, 0],
    hop: 0,
    shift: shove * 0.05
  };
}

function addPants(
  pelvis: THREE.Group,
  mats: TeamMats,
  bulk: boolean
): void {
  const hipR = bulk ? 0.125 : 0.105;
  const bowl = capMesh(hipR, 0.18, mats.pants);
  bowl.position.y = 0.02;
  bowl.scale.set(bulk ? 1.7 : 1.5, 0.82, 1.18);
  const belt = capMesh(hipR * 1.06, 0.1, mats.stripe);
  belt.position.y = 0.09;
  belt.scale.set(bulk ? 1.72 : 1.52, 0.28, 1.18);
  const hr = bulk ? 0.09 : 0.074;
  const lHip = sphMesh(hr, mats.pants, 10);
  lHip.position.set(-0.11, -0.02, 0.01);
  const rHip = sphMesh(hr, mats.pants, 10);
  rHip.position.set(0.11, -0.02, 0.01);
  pelvis.add(bowl, belt, lHip, rHip);
}

function addTorso(
  pelvis: THREE.Group,
  mats: TeamMats,
  def: PlayerDef,
  bulk: boolean
): { torso: THREE.Group; neck: THREE.Group } {
  const torso = new THREE.Group();
  torso.position.y = 0.08;
  const coreR = bulk ? 0.155 : 0.132;
  const core = capMesh(coreR, bulk ? 0.4 : 0.36, mats.jersey);
  core.position.y = 0.22;
  core.scale.set(bulk ? 1.28 : 1.12, 1, 0.8);
  torso.add(core);
  const collar = capMesh(0.072, 0.08, mats.jersey, 8);
  collar.position.y = 0.5;
  collar.scale.set(1.35, 0.42, 1.05);
  torso.add(collar);
  addPads(torso, mats, bulk);
  const neck = new THREE.Group();
  neck.position.y = 0.56;
  const neckMesh = capMesh(0.05, 0.1, mats.skin, 8);
  neckMesh.position.y = 0.04;
  neck.add(neckMesh);
  addHelmet(neck, mats);
  torso.add(neck);
  addNums(torso, def);
  pelvis.add(torso);
  return { torso, neck };
}

function addPads(
  torso: THREE.Group,
  mats: TeamMats,
  bulk: boolean
): void {
  const pec = sphMesh(bulk ? 0.155 : 0.132, mats.jersey, 10);
  pec.position.set(0, 0.33, 0.035);
  pec.scale.set(bulk ? 1.45 : 1.28, 0.82, 0.92);
  const yoke = capMesh(
    bulk ? 0.1 : 0.082,
    bulk ? 0.58 : 0.48,
    mats.jersey
  );
  yoke.rotation.z = Math.PI / 2;
  yoke.position.y = 0.41;
  const padR = bulk ? 0.128 : 0.1;
  const padX = bulk ? 0.29 : 0.235;
  const lPad = sphMesh(padR, mats.jersey, 10);
  lPad.position.set(-padX, 0.415, 0.02);
  lPad.scale.set(1.16, 0.6, 1.18);
  const rPad = sphMesh(padR, mats.jersey, 10);
  rPad.position.set(padX, 0.415, 0.02);
  rPad.scale.set(1.16, 0.6, 1.18);
  torso.add(pec, yoke, lPad, rPad);
}

function addHelmet(neck: THREE.Group, mats: TeamMats): void {
  const helm = new THREE.Group();
  helm.position.y = 0.175;
  const shell = sphMesh(0.152, mats.helmet, 14);
  shell.scale.set(1.05, 1.02, 1.08);
  const face = sphMesh(0.1, mats.skin, 10);
  face.position.set(0, -0.028, 0.08);
  face.scale.set(0.92, 0.8, 0.58);
  const stripe = capMesh(0.018, 0.28, mats.stripe, 5);
  stripe.rotation.x = Math.PI / 2;
  stripe.position.set(0, 0.132, 0.01);
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(
      0.148, 12, 8, 0, Math.PI * 2, 0.85, 0.45
    ),
    mats.visor
  );
  visor.position.set(0, 0.01, 0.045);
  visor.scale.set(1.02, 0.82, 1.08);
  const chin = new THREE.Mesh(
    new THREE.TorusGeometry(0.1, 0.009, 4, 10, Math.PI),
    mats.dark
  );
  chin.rotation.x = Math.PI / 2;
  chin.position.set(0, -0.088, 0.04);
  helm.add(shell, face, stripe, visor, chin);
  addEars(helm, mats.dark);
  addMask(helm, mats.metal);
  neck.add(helm);
}

function addEars(helm: THREE.Group, mat: THREE.Material): void {
  for (const x of [-1, 1]) {
    const ear = sphMesh(0.032, mat, 6);
    ear.position.set(x * 0.152, -0.008, 0.015);
    helm.add(ear);
  }
}

function addMask(helm: THREE.Group, mat: THREE.Material): void {
  const r = 0.013;
  const z = 0.2;
  for (const y of [-0.048, -0.012, 0.024, 0.052]) {
    const bar = rod(0.155, r, mat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, y, z);
    helm.add(bar);
  }
  for (const x of [-0.07, 0.07]) {
    const vert = rod(0.118, r, mat);
    vert.position.set(x, 0.002, z);
    helm.add(vert);
    const post = rod(0.09, r, mat);
    post.rotation.x = Math.PI / 2;
    post.position.set(x, 0.035, z - 0.042);
    helm.add(post);
  }
  const loop = new THREE.Mesh(
    new THREE.TorusGeometry(0.078, r, 5, 12, Math.PI),
    mat
  );
  loop.rotation.z = Math.PI;
  loop.position.set(0, -0.02, z);
  helm.add(loop);
}

function addNums(torso: THREE.Group, def: PlayerDef): void {
  const num = jerseyNum(def);
  num.position.set(0, 0.27, 0.155);
  const back = jerseyNum(def);
  back.position.set(0, 0.27, -0.155);
  back.rotation.y = Math.PI;
  torso.add(num, back);
}

function addArm(
  pelvis: THREE.Group,
  x: number,
  mats: TeamMats,
  bulk: boolean
): { arm: THREE.Group; fore: THREE.Group; hand: THREE.Group } {
  const ur = bulk ? 0.072 : 0.055;
  const fr = bulk ? 0.06 : 0.046;
  const arm = new THREE.Group();
  arm.position.set(x, ARM_Y, 0);
  const deltoid = sphMesh(bulk ? 0.1 : 0.082, mats.jersey, 10);
  deltoid.position.y = 0.015;
  const upper = hang(ur, UPPER, mats.jersey);
  const elbow = sphMesh(ur * 1.05, mats.skin, 8);
  elbow.position.y = -UPPER;
  const fore = new THREE.Group();
  fore.position.y = -UPPER;
  const sleeve = hang(fr * 1.04, FORE * 0.42, mats.jersey);
  const forearm = hang(fr, FORE, mats.skin);
  const wrist = sphMesh(fr * 0.88, mats.skin, 7);
  wrist.position.y = -FORE;
  const inn = x < 0 ? 1 : -1;
  const hand = addHand(mats, bulk, inn);
  hand.position.y = -FORE;
  fore.add(sleeve, forearm, wrist, hand);
  arm.add(deltoid, upper, elbow, fore);
  pelvis.add(arm);
  return { arm, fore, hand };
}

function addHand(
  mats: TeamMats,
  bulk: boolean,
  inn: number
): THREE.Group {
  const hand = new THREE.Group();
  const g = mats.glove;
  const palm = new THREE.Mesh(
    new THREE.BoxGeometry(0.082, 0.096, 0.034),
    g
  );
  palm.position.y = -0.05;
  hand.add(palm);
  const thumb = new THREE.Group();
  thumb.position.set(0.04 * inn, -0.038, 0.018);
  thumb.rotation.set(0.5, 0.18 * inn, 1.05 * inn);
  thumb.add(hang(0.014, 0.052, g, 5));
  hand.add(thumb);
  const lens = [0.05, 0.058, 0.054, 0.042];
  const xs = [-0.026, -0.009, 0.009, 0.026];
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Group();
    f.position.set(xs[i], -0.092, 0.008);
    f.rotation.x = 0.28;
    f.add(hang(0.013, lens[i], g, 5));
    hand.add(f);
  }
  if (bulk) {
    hand.scale.setScalar(1.12);
  }
  return hand;
}

function addLeg(
  pelvis: THREE.Group,
  x: number,
  mats: TeamMats,
  bulk: boolean
): { thigh: THREE.Group; shin: THREE.Group; foot: THREE.Group } {
  const tw = bulk ? 0.088 : 0.068;
  const sw = bulk ? 0.07 : 0.054;
  const thigh = new THREE.Group();
  thigh.position.set(x, 0, 0);
  const hip = sphMesh(tw * 1.15, mats.pants, 10);
  const tMesh = hang(tw, THIGH, mats.pants);
  const knee = sphMesh(tw * 0.95, mats.pants, 8);
  knee.position.y = -THIGH;
  const shin = new THREE.Group();
  shin.position.y = -THIGH;
  const sMesh = hang(sw, SHIN, mats.pants);
  const sock = capMesh(sw * 1.04, 0.1, mats.stripe, 6);
  sock.position.y = -SHIN * 0.62;
  sock.scale.set(1, 0.38, 1);
  const ankle = sphMesh(sw * 0.92, mats.dark, 7);
  ankle.position.y = -SHIN;
  const foot = addShoe(mats, bulk);
  foot.position.y = -SHIN;
  shin.add(sMesh, sock, ankle, foot);
  thigh.add(hip, tMesh, knee, shin);
  pelvis.add(thigh);
  return { thigh, shin, foot };
}

function addShoe(mats: TeamMats, bulk: boolean): THREE.Group {
  const foot = new THREE.Group();
  const d = mats.dark;
  const s = bulk ? 1.08 : 1;
  const heel = sphMesh(0.044, d, 8);
  heel.position.set(0, -0.055, -0.028);
  heel.scale.set(1.15 * s, 0.82, 1.15);
  const mid = capMesh(0.038 * s, 0.13, d, 6);
  mid.rotation.x = Math.PI / 2;
  mid.position.set(0, -0.062, 0.042);
  mid.scale.set(1.18, 1, 0.68);
  const toe = sphMesh(0.04 * s, d, 8);
  toe.position.set(0, -0.058, 0.118);
  toe.scale.set(1.2, 0.68, 1.28);
  const collar = sphMesh(0.038 * s, d, 7);
  collar.position.set(0, -0.028, 0.02);
  collar.scale.set(1.12, 0.72, 1.25);
  foot.add(heel, mid, toe, collar);
  return foot;
}

function jerseyNum(def: PlayerDef): THREE.Mesh {
  const off = def.side === 'offense';
  const fg = off ? '#e8c547' : '#0d2a4a';
  const mat = new THREE.MeshBasicMaterial({
    map: numberTexture(def.number, 'none', fg),
    transparent: true,
    alphaTest: 0.25,
    side: THREE.DoubleSide
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), mat);
}

/** Capsule along -Y so the parent origin stays at the top joint. */
function hang(
  r: number,
  len: number,
  mat: THREE.Material,
  segs = 8
): THREE.Mesh {
  const mesh = capMesh(r, len, mat, segs);
  mesh.position.y = -len * 0.5;
  return mesh;
}

function capMesh(
  r: number,
  len: number,
  mat: THREE.Material,
  segs = 8
): THREE.Mesh {
  const cyl = Math.max(0.02, len - 2 * r);
  return new THREE.Mesh(
    new THREE.CapsuleGeometry(r, cyl, 4, segs),
    mat
  );
}

function sphMesh(
  r: number,
  mat: THREE.Material,
  segs = 10
): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(r, segs, segs - 2),
    mat
  );
}

function rod(
  len: number,
  r: number,
  mat: THREE.Material
): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, len, 6),
    mat
  );
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
