import * as THREE from 'three';
import { numberTexture, type TeamMats } from './materials';
import type { PlayerDef, Pos } from './types';

export type AnimKind =
  | 'idle'
  | 'run'
  | 'passSet'
  | 'rush'
  | 'engage';

export interface PlayerRig {
  pos: Pos;
  pelvis: THREE.Group;
  torso: THREE.Group;
  leftThigh: THREE.Group;
  rightThigh: THREE.Group;
  leftShin: THREE.Group;
  rightShin: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
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
  hop: number;
  shift: number;
}

const SCALE = 1.18;
const HIP = 0.86;
const THIGH = 0.4;
const SHIN = 0.38;
const ARM = 0.48;

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
  const torso = addTorso(pelvis, mats, def, bulk);
  const ax = bulk ? 0.36 : 0.32;
  const leftArm = addArm(pelvis, -ax, mats);
  const rightArm = addArm(pelvis, ax, mats);
  const left = addLeg(pelvis, -0.12, mats, bulk);
  const right = addLeg(pelvis, 0.12, mats, bulk);
  const rig: PlayerRig = {
    pos: def.pos,
    pelvis,
    torso,
    leftThigh: left.thigh,
    rightThigh: right.thigh,
    leftShin: left.shin,
    rightShin: right.shin,
    leftArm,
    rightArm
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
  applyPose(rig, kindPose(kind, t, speed, rig.pos));
}

export function applyRun(
  rig: PlayerRig,
  phase: number,
  stride: number
): void {
  applyPose(rig, runPose(phase, stride));
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
  rig.leftThigh.rotation.set(...pose.lThigh);
  rig.rightThigh.rotation.set(...pose.rThigh);
  rig.leftShin.rotation.set(pose.lShin, 0, 0);
  rig.rightShin.rotation.set(pose.rShin, 0, 0);
  rig.leftArm.rotation.set(...pose.lArm);
  rig.rightArm.rotation.set(...pose.rArm);
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
  return {
    pelvis: [0.06, 0, 0],
    torso: [0.12, 0, 0],
    lThigh: [s, 0, 0],
    rThigh: [-s, 0, 0],
    lShin: 0.22 + recL + plant,
    rShin: 0.22 + recR + plant,
    lArm: [-s * 0.9 + 0.25, 0, 0.12],
    rArm: [s * 0.9 + 0.25, 0, -0.12],
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
  p.lArm = [0.3, 0, 0.25];
  p.rArm = [0.48, 0, -0.2];
  p.hop = 0;
  return p;
}

function qbScan(t: number): Pose {
  const p = qbIdle();
  p.torso = [0.08, Math.sin(t * 1.6) * 0.28, 0];
  p.lThigh = [0.2 + Math.sin(t * 2.2) * 0.08, 0, 0];
  p.rThigh = [0.14, 0, 0];
  p.rArm = [0.62, 0.2, -0.15];
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

function qbIdle(): Pose {
  return {
    pelvis: [0.04, 0, 0],
    torso: [0.06, 0, 0],
    lThigh: [0.12, 0, 0],
    rThigh: [0.16, 0, 0],
    lShin: 0.18,
    rShin: 0.22,
    lArm: [0.35, 0, 0.25],
    rArm: [0.55, 0.15, -0.2],
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
    lArm: [0.42, 0, 0.28],
    rArm: [0.4, 0, -0.28],
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
    lArm: threePoint ? [1.15, 0.1, 0.2] : [0.7, 0, 0.45],
    rArm: [0.55, 0, -0.4],
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
    lArm: [-0.35, 0.1, 0.7],
    rArm: [-0.35, -0.1, -0.7],
    hop: 0,
    shift: w * 0.03
  };
}

function rushPose(t: number, speed: number): Pose {
  const chop = Math.sin(t * (8 + speed * 0.5));
  const s = Math.sin(t * 4) * 0.28;
  return {
    pelvis: [0.22, 0, 0],
    torso: [0.34, 0, 0],
    lThigh: [0.4 + s, 0, 0],
    rThigh: [0.4 - s, 0, 0],
    lShin: 0.4 + Math.max(0, -s) * 0.5,
    rShin: 0.4 + Math.max(0, s) * 0.5,
    lArm: [0.65 + chop * 0.5, 0, 0.18],
    rArm: [0.65 - chop * 0.5, 0, -0.18],
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
    lArm: [1.05, 0.08, 0.22],
    rArm: [1.05, -0.08, -0.22],
    hop: 0,
    shift: shove * 0.05
  };
}

function addPants(
  pelvis: THREE.Group,
  mats: TeamMats,
  bulk: boolean
): void {
  const w = bulk ? 0.46 : 0.4;
  const pants = box(w, 0.22, 0.26, mats.pants);
  pants.position.y = 0.04;
  const stripe = box(w + 0.02, 0.05, 0.28, mats.stripe);
  stripe.position.y = 0.12;
  pelvis.add(pants, stripe);
}

function addTorso(
  pelvis: THREE.Group,
  mats: TeamMats,
  def: PlayerDef,
  bulk: boolean
): THREE.Group {
  const torso = new THREE.Group();
  torso.position.y = 0.08;
  const tw = bulk ? 0.5 : 0.42;
  const body = box(tw, 0.56, 0.28, mats.jersey);
  body.position.y = 0.28;
  const pad = box(bulk ? 0.7 : 0.56, 0.18, 0.36, mats.jersey);
  pad.position.y = 0.5;
  torso.add(body, pad);
  addHead(torso, mats);
  addNums(torso, def, mats);
  pelvis.add(torso);
  return torso;
}

function addHead(torso: THREE.Group, mats: TeamMats): void {
  const helm = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 14, 12),
    mats.helmet
  );
  helm.position.set(0, 0.78, 0.02);
  const mask = box(0.2, 0.1, 0.12, mats.dark);
  mask.position.set(0, 0.72, 0.14);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 10, 8),
    mats.skin
  );
  head.position.set(0, 0.74, 0.04);
  torso.add(helm, mask, head);
}

function addNums(
  torso: THREE.Group,
  def: PlayerDef,
  mats: TeamMats
): void {
  const num = jerseyNum(def, mats);
  num.position.set(0, 0.22, 0.15);
  const back = jerseyNum(def, mats);
  back.position.set(0, 0.22, -0.15);
  back.rotation.y = Math.PI;
  torso.add(num, back);
}

function addArm(
  pelvis: THREE.Group,
  x: number,
  mats: TeamMats
): THREE.Group {
  const arm = limb(0.11, ARM, 0.11, mats.jersey);
  arm.position.set(x, 0.52, 0);
  const hand = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 8, 8),
    mats.skin
  );
  hand.position.set(0, -ARM, 0.03);
  arm.add(hand);
  pelvis.add(arm);
  return arm;
}

function addLeg(
  pelvis: THREE.Group,
  x: number,
  mats: TeamMats,
  bulk: boolean
): { thigh: THREE.Group; shin: THREE.Group } {
  const tw = bulk ? 0.18 : 0.14;
  const sw = bulk ? 0.15 : 0.12;
  const thigh = limb(tw, THIGH, 0.16, mats.pants);
  thigh.position.set(x, 0, 0);
  const shin = limb(sw, SHIN, 0.14, mats.pants);
  shin.position.y = -THIGH;
  const foot = new THREE.Group();
  foot.position.y = -SHIN;
  const shoe = box(0.14, 0.08, 0.26, mats.dark);
  shoe.position.set(0, -0.04, 0.05);
  foot.add(shoe);
  shin.add(foot);
  thigh.add(shin);
  pelvis.add(thigh);
  return { thigh, shin };
}

function limb(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material
): THREE.Group {
  const g = new THREE.Group();
  const m = box(w, h, d, mat);
  m.position.y = -h * 0.5;
  g.add(m);
  return g;
}

function box(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material
): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

function jerseyNum(def: PlayerDef, mats: TeamMats): THREE.Mesh {
  const off = def.side === 'offense';
  const bg = off ? '#0d2a4a' : '#f2f5f8';
  const fg = off ? '#e8c547' : '#0d2a4a';
  const mat = mats.jersey.clone();
  mat.map = numberTexture(def.number, bg, fg);
  return new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28), mat);
}

function stampRefs(root: THREE.Group, rig: PlayerRig): void {
  root.userData.pelvis = rig.pelvis;
  root.userData.torso = rig.torso;
  root.userData.leftThigh = rig.leftThigh;
  root.userData.rightThigh = rig.rightThigh;
  root.userData.leftShin = rig.leftShin;
  root.userData.rightShin = rig.rightShin;
  root.userData.leftArm = rig.leftArm;
  root.userData.rightArm = rig.rightArm;
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
