import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { PlayerDef } from './types';
import type { AnimKind } from './rig';

interface AvatarAsset {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
}

const MODEL_URL = '/models/football-athlete.glb';
const asset = new GLTFLoader().loadAsync(MODEL_URL);

/**
 * Drives a skinned, textured athlete while the hidden gameplay rig keeps
 * throw and catch attachment points deterministic.
 */
export class PlayerAvatar {
  readonly root: THREE.Group;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current = '';

  constructor(source: AvatarAsset, def: PlayerDef) {
    this.root = clone(source.scene) as THREE.Group;
    this.root.rotation.y = Math.PI;
    this.root.add(makeEquipment(def));
    this.mixer = new THREE.AnimationMixer(this.root);
    this.prepareActions(source.clips);
    this.setMotion('idle');
    enableShadows(this.root);
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  setMotion(kind: AnimKind, phase = 0): void {
    const name = clipFor(kind);
    if (name !== this.current) {
      this.crossFade(name);
    }
    applyGesture(this.root, kind, phase);
  }

  private prepareActions(clips: THREE.AnimationClip[]): void {
    for (const clip of clips) {
      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      action.setEffectiveWeight(1);
      this.actions.set(clip.name.toLowerCase(), action);
    }
  }

  private crossFade(name: string): void {
    const next = this.actions.get(name);
    if (!next) {
      return;
    }
    this.actions.get(this.current)?.fadeOut(0.14);
    next.reset().fadeIn(0.14).play();
    this.current = name;
  }
}

export async function createAvatar(def: PlayerDef): Promise<PlayerAvatar> {
  const gltf = await asset;
  return new PlayerAvatar(
    { scene: gltf.scene, clips: gltf.animations },
    def
  );
}

function clipFor(kind: AnimKind): string {
  if (kind === 'run' || kind === 'rush') {
    return 'run';
  }
  if (kind === 'passSet' || kind === 'engage') {
    return 'walk';
  }
  return 'idle';
}

function applyGesture(
  root: THREE.Group,
  kind: AnimKind,
  phase: number
): void {
  if (kind === 'throw') {
    applyThrow(root, phase);
  }
  if (kind === 'catch') {
    applyCatch(root);
  }
}

function applyThrow(root: THREE.Group, phase: number): void {
  const arm = root.getObjectByName('mixamorig:RightArm');
  const fore = root.getObjectByName('mixamorig:RightForeArm');
  const spine = root.getObjectByName('mixamorig:Spine2');
  const windup = phase < 0.38;
  arm?.rotateX(windup ? -1.15 : 1.15);
  arm?.rotateZ(windup ? 0.45 : -0.72);
  fore?.rotateX(windup ? -1.2 : 0.25);
  spine?.rotateY(windup ? -0.42 : 0.5);
}

function applyCatch(root: THREE.Group): void {
  const left = root.getObjectByName('mixamorig:LeftArm');
  const right = root.getObjectByName('mixamorig:RightArm');
  const leftFore = root.getObjectByName('mixamorig:LeftForeArm');
  const rightFore = root.getObjectByName('mixamorig:RightForeArm');
  left?.rotateX(-1.18);
  right?.rotateX(-1.18);
  leftFore?.rotateX(-0.55);
  rightFore?.rotateX(-0.55);
}

function makeEquipment(def: PlayerDef): THREE.Group {
  const group = new THREE.Group();
  const offense = def.side === 'offense';
  const primary = new THREE.MeshStandardMaterial({
    color: offense ? 0x0b1d36 : 0xd6dce4,
    roughness: 0.56,
    metalness: 0.04
  });
  const accent = new THREE.MeshStandardMaterial({
    color: offense ? 0xe8c547 : 0x123056,
    roughness: 0.5
  });
  group.add(makeJersey(primary, accent, def.number));
  group.add(makeHelmet(primary, accent));
  return group;
}

function makeJersey(
  primary: THREE.Material,
  accent: THREE.Material,
  number: number
): THREE.Group {
  const jersey = new THREE.Group();
  const torso = new THREE.Mesh(
    new THREE.CylinderGeometry(0.29, 0.23, 0.5, 18),
    primary
  );
  torso.position.y = 1.26;
  const yoke = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.14, 0.28, 6, 14),
    primary
  );
  yoke.rotation.z = Math.PI / 2;
  yoke.position.y = 1.45;
  yoke.scale.z = 1.34;
  const collar = new THREE.Mesh(
    new THREE.TorusGeometry(0.12, 0.025, 8, 18),
    accent
  );
  collar.rotation.x = Math.PI / 2;
  collar.position.set(0, 1.49, 0.24);
  jersey.add(torso, yoke, collar, jerseyNumber(number));
  jersey.add(makeShoulderCaps(primary));
  return jersey;
}

function makeShoulderCaps(material: THREE.Material): THREE.Group {
  const shoulders = new THREE.Group();
  for (const x of [-0.31, 0.31]) {
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 18, 12),
      material
    );
    cap.position.set(x, 1.43, 0);
    cap.scale.set(1.15, 0.72, 0.88);
    shoulders.add(cap);
  }
  return shoulders;
}

function makeHelmet(
  primary: THREE.Material,
  accent: THREE.Material
): THREE.Group {
  const helmet = new THREE.Group();
  helmet.position.y = 1.72;
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(
      0.2,
      24,
      16,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.72
    ),
    primary
  );
  shell.scale.set(1.02, 1.04, 1.08);
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.035, 0.05, 0.34),
    accent
  );
  stripe.position.y = 0.17;
  helmet.add(shell, stripe, makeFaceMask(accent));
  return helmet;
}

function makeFaceMask(material: THREE.Material): THREE.Group {
  const mask = new THREE.Group();
  mask.position.set(0, -0.04, 0.19);
  for (const y of [-0.03, 0.03]) {
    const bar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.3, 8),
      material
    );
    bar.rotation.z = Math.PI / 2;
    bar.position.y = y;
    mask.add(bar);
  }
  return mask;
}

function jerseyNumber(number: number): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = '#f4efe4';
    context.font = '800 76px Barlow Condensed';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(number), 64, 68);
  }
  const material = new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(canvas),
    transparent: true
  });
  const numberMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.27, 0.3),
    material
  );
  numberMesh.position.set(0, 1.29, 0.215);
  return numberMesh;
}

function enableShadows(root: THREE.Group): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}
