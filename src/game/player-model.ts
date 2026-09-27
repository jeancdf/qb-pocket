import * as THREE from 'three';
import { numberTexture, type TeamMats } from './materials';
import type { PlayerDef } from './types';

/**
 * Stylised football player built on the rig's joint groups.
 *
 * Clean, toy-like shapes rather than fake realism: a big glossy helmet
 * with a cage and a dark face opening (no modelled face), wide shoulder
 * pads, a V-shaped jersey, knee-length pants, team socks, compression
 * sleeves and gloves. No bare skin anywhere.
 *
 * Every function only adds meshes to a joint group it is handed, so
 * the rig's joint positions and animation stay untouched.
 */

/** Joint lengths shared with rig.ts. */
export interface Limbs {
  thigh: number;
  shin: number;
  upper: number;
  fore: number;
}

const faceMat = new THREE.MeshStandardMaterial({
  color: 0x06080c,
  roughness: 0.95,
  metalness: 0
});

const soleMat = new THREE.MeshStandardMaterial({
  color: 0xd9dde2,
  roughness: 0.6,
  metalness: 0
});

export function dressPelvis(
  pelvis: THREE.Group,
  mats: TeamMats,
  bulk: boolean,
  def: PlayerDef
): void {
  const w = bulk ? 1.22 : 1;
  // Pants from the belt line down over the seat.
  const hips = lathe(
    [
      [0.12, 0.1],
      [0.15, 0.04],
      [0.165, -0.03],
      [0.15, -0.1],
      [0.09, -0.14]
    ],
    mats.pants,
    16
  );
  hips.scale.set(1.12 * w, 1, 0.78 * w);
  pelvis.add(hips);
  if (def.pos === 'QB') {
    const towel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.1, 0.2),
      new THREE.MeshStandardMaterial({
        color: 0xf4f6f8,
        roughness: 0.9,
        side: THREE.DoubleSide
      })
    );
    towel.position.set(0.09, 0.0, 0.125 * w);
    towel.rotation.x = -0.12;
    pelvis.add(towel);
  }
}

export function dressTorso(
  torso: THREE.Group,
  neck: THREE.Group,
  mats: TeamMats,
  bulk: boolean,
  def: PlayerDef
): void {
  const w = bulk ? 1.2 : 1;
  // Jersey: narrow waist flaring to a broad chest.
  const body = lathe(
    [
      [0.162, -0.08],
      [0.15, 0.02],
      [0.15, 0.12],
      [0.18, 0.28],
      [0.175, 0.4],
      [0.12, 0.49]
    ],
    mats.jersey,
    18
  );
  body.scale.set(1.12 * w, 1, 0.74 * w);
  torso.add(body);
  addShoulderPads(torso, mats, w);
  const roll = new THREE.Mesh(
    new THREE.TorusGeometry(0.068, 0.026, 8, 16),
    mats.dark
  );
  roll.rotation.x = Math.PI / 2;
  roll.position.y = 0.5;
  torso.add(roll);
  addNumbers(torso, def, w);
  const neckMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.052, 0.058, 0.12, 10),
    mats.dark
  );
  neckMesh.position.y = 0.04;
  neck.add(neckMesh);
  addHelmet(neck, mats);
}

function addShoulderPads(
  torso: THREE.Group,
  mats: TeamMats,
  w: number
): void {
  const y = 0.445;
  // Flat yoke across the top, capped by a rounded pad on each side.
  const yoke = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.085, 0.3 * w, 6, 12),
    mats.jersey
  );
  yoke.rotation.z = Math.PI / 2;
  yoke.position.y = y;
  yoke.scale.set(0.62, 1, 1.45 * w);
  torso.add(yoke);
  for (const side of [-1, 1]) {
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.115 * w, 14, 10),
      mats.jersey
    );
    cap.position.set(side * 0.235 * w, y - 0.005, 0);
    cap.scale.set(1, 0.62, 1.12);
    torso.add(cap);
  }
}

function addNumbers(torso: THREE.Group, def: PlayerDef, w: number): void {
  const z = 0.178 * 0.74 * w + 0.012;
  const front = jerseyNum(def);
  front.position.set(0, 0.27, z);
  const back = jerseyNum(def);
  back.position.set(0, 0.29, -z);
  back.rotation.y = Math.PI;
  torso.add(front, back);
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
  return new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), mat);
}

function addHelmet(neck: THREE.Group, mats: TeamMats): void {
  const helm = new THREE.Group();
  helm.position.y = 0.18;
  // Crown is a full dome; below the brow the shell wraps the sides and
  // back only, leaving the front open onto a dark liner, which reads as
  // shadow inside the helmet instead of a modelled face.
  const brow = 1.2;
  const crown = new THREE.Mesh(
    new THREE.SphereGeometry(0.165, 24, 10, 0, Math.PI * 2, 0, brow),
    mats.helmet
  );
  const gap = 1.7;
  const sides = new THREE.Mesh(
    new THREE.SphereGeometry(
      0.165,
      20,
      10,
      Math.PI / 2 + gap / 2,
      Math.PI * 2 - gap,
      brow,
      Math.PI - brow - 0.35
    ),
    mats.helmet
  );
  (sides.material as THREE.Material).side = THREE.DoubleSide;
  const shell = new THREE.Group();
  shell.add(crown, sides);
  shell.scale.set(0.96, 1, 1.1);
  const opening = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 16, 12),
    faceMat
  );
  opening.scale.set(0.92, 0.95, 1.02);
  const stripe = new THREE.Mesh(
    new THREE.TorusGeometry(0.168, 0.012, 6, 24, Math.PI * 0.8),
    mats.stripe
  );
  // Runs from low on the back over the crown, stopping above the brow.
  stripe.rotation.y = Math.PI / 2;
  stripe.rotation.z = -0.2;
  stripe.scale.set(1.1, 1.0, 1);
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.158, 18, 6, -0.8, 1.6, 1.25, 0.32),
    mats.visor
  );
  visor.position.set(0, 0, 0.02);
  visor.scale.set(1, 1, 1.1);
  for (const x of [-1, 1]) {
    const ear = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.01, 12),
      mats.dark
    );
    ear.rotation.z = Math.PI / 2;
    ear.position.set(x * 0.158, -0.02, 0.01);
    helm.add(ear);
  }
  helm.add(shell, opening, stripe, visor);
  addFacemask(helm, mats.metal);
  const chin = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 10, 8),
    mats.dark
  );
  chin.position.set(0, -0.135, 0.105);
  chin.scale.set(1, 0.6, 0.8);
  helm.add(chin);
  neck.add(helm);
}

/** Cage of curved bars wrapping the front of the helmet. */
function addFacemask(helm: THREE.Group, mat: THREE.Material): void {
  const r = 0.011;
  for (const [y, rad] of [
    [-0.035, 0.172],
    [-0.085, 0.158]
  ]) {
    const bar = new THREE.Mesh(
      new THREE.TorusGeometry(rad, r, 6, 20, 1.9),
      mat
    );
    bar.rotation.x = Math.PI / 2;
    bar.rotation.z = Math.PI / 2 - 0.95;
    bar.position.set(0, y, 0.015);
    bar.scale.set(1, 1.12, 1);
    helm.add(bar);
  }
  // Centre bar and two side struts tie the loops to the shell.
  const centre = rod(0.07, r, mat);
  centre.position.set(0, -0.06, 0.19);
  helm.add(centre);
  for (const x of [-1, 1]) {
    const strut = rod(0.1, r, mat);
    strut.position.set(x * 0.12, -0.055, 0.13);
    strut.rotation.x = 0.2;
    helm.add(strut);
  }
}

export function dressArm(
  arm: THREE.Group,
  fore: THREE.Group,
  hand: THREE.Group,
  mats: TeamMats,
  bulk: boolean,
  limbs: Limbs,
  inward: number
): void {
  const w = bulk ? 1.22 : 1;
  const sleeve = lathe(
    [
      [0.07, 0.03],
      [0.074, -0.04],
      [0.066, -0.13],
      [0.062, -0.14]
    ],
    mats.jersey,
    12
  );
  sleeve.scale.setScalar(w);
  const stripe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.067, 0.068, 0.022, 12, 1, true),
    mats.stripe
  );
  stripe.position.y = -0.11;
  stripe.scale.setScalar(w);
  const upper = tube(0.058 * w, 0.05 * w, limbs.upper, mats.dark);
  const elbow = new THREE.Mesh(
    new THREE.SphereGeometry(0.046 * w, 10, 8),
    mats.dark
  );
  elbow.position.y = -limbs.upper;
  arm.add(sleeve, stripe, upper, elbow);
  const forearm = tube(0.052 * w, 0.04 * w, limbs.fore, mats.dark);
  fore.add(forearm);
  addGlove(hand, mats, w, inward);
}

/** Rounded mitten with a thumb; fingers read as one padded block. */
function addGlove(
  hand: THREE.Group,
  mats: TeamMats,
  w: number,
  inward: number
): void {
  const palm = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.034, 0.05, 4, 10),
    mats.glove
  );
  palm.position.y = -0.055;
  palm.scale.set(1.15, 1, 0.62);
  const thumb = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.013, 0.03, 3, 6),
    mats.glove
  );
  thumb.position.set(0.035 * inward, -0.04, 0.012);
  thumb.rotation.z = 0.7 * inward;
  const cuff = new THREE.Mesh(
    new THREE.CylinderGeometry(0.036, 0.034, 0.03, 10),
    mats.stripe
  );
  cuff.position.y = -0.005;
  hand.add(palm, thumb, cuff);
  hand.scale.setScalar(w);
}

export function dressLeg(
  thigh: THREE.Group,
  shin: THREE.Group,
  foot: THREE.Group,
  mats: TeamMats,
  bulk: boolean,
  limbs: Limbs
): void {
  const w = bulk ? 1.22 : 1;
  // Pants: full at the hip, snug above the knee, with a thigh pad.
  const pant = lathe(
    [
      [0.088, 0.02],
      [0.09, -0.08],
      [0.078, -0.26],
      [0.064, -limbs.thigh + 0.02],
      [0.06, -limbs.thigh - 0.04]
    ],
    mats.pants,
    14
  );
  pant.scale.set(w, 1, w);
  const knee = new THREE.Mesh(
    new THREE.SphereGeometry(0.062, 12, 8),
    mats.pants
  );
  knee.position.set(0, -limbs.thigh, 0.012);
  knee.scale.set(w, 1, 1.05 * w);
  thigh.add(pant, knee);
  // Team socks up to the knee with a stripe.
  const sock = tube(0.056 * w, 0.042 * w, limbs.shin, mats.jersey);
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(0.054 * w, 0.056 * w, 0.03, 12, 1, true),
    mats.stripe
  );
  band.position.y = -0.1;
  shin.add(sock, band);
  addCleat(foot, mats, w);
}

function addCleat(foot: THREE.Group, mats: TeamMats, w: number): void {
  const upper = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.044, 0.1, 4, 10),
    mats.dark
  );
  upper.rotation.x = Math.PI / 2;
  upper.position.set(0, -0.058, 0.045);
  upper.scale.set(1.1 * w, 1, 0.78);
  const sole = new THREE.Mesh(
    new THREE.BoxGeometry(0.085 * w, 0.016, 0.2),
    soleMat
  );
  sole.position.set(0, -0.092, 0.045);
  const ankle = new THREE.Mesh(
    new THREE.SphereGeometry(0.045 * w, 10, 8),
    mats.dark
  );
  ankle.position.y = -0.03;
  foot.add(upper, sole, ankle);
}

/** Closed solid of revolution from [radius, y] pairs, top first. */
function lathe(
  pts: Array<[number, number]>,
  mat: THREE.Material,
  segs: number
): THREE.Mesh {
  const top = pts[0];
  const bottom = pts[pts.length - 1];
  const profile = [
    new THREE.Vector2(0, top[1]),
    ...pts.map(([r, y]) => new THREE.Vector2(r, y)),
    new THREE.Vector2(0, bottom[1])
  ];
  // Lathe expects bottom to top.
  profile.reverse();
  return new THREE.Mesh(new THREE.LatheGeometry(profile, segs), mat);
}

/** Tapered limb hanging down from the joint origin, rounded ends. */
function tube(
  rTop: number,
  rBottom: number,
  len: number,
  mat: THREE.Material
): THREE.Mesh {
  const mesh = lathe(
    [
      [rTop * 0.7, 0.02],
      [rTop, -len * 0.12],
      [(rTop + rBottom) / 2, -len * 0.55],
      [rBottom, -len * 0.92],
      [rBottom * 0.7, -len - 0.01]
    ],
    mat,
    12
  );
  return mesh;
}

function rod(len: number, r: number, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), mat);
}
