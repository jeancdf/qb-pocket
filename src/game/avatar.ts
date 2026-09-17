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

  setMotion(kind: AnimKind): void {
    const name = clipFor(kind);
    if (name === this.current) {
      return;
    }
    const next = this.actions.get(name);
    if (!next) {
      return;
    }
    const previous = this.actions.get(this.current);
    previous?.fadeOut(0.14);
    next.reset().fadeIn(0.14).play();
    this.current = name;
  }

  private prepareActions(clips: THREE.AnimationClip[]): void {
    for (const clip of clips) {
      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      action.setEffectiveWeight(1);
      this.actions.set(clip.name.toLowerCase(), action);
    }
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
    new THREE.CylinderGeometry(0.23, 0.2, 0.48, 16),
    primary
  );
  torso.position.y = 1.26;
  const pads = new THREE.Mesh(
    new THREE.SphereGeometry(0.36, 20, 12),
    primary
  );
  pads.position.y = 1.46;
  pads.scale.set(1.3, 0.42, 0.76);
  const collar = new THREE.Mesh(
    new THREE.TorusGeometry(0.12, 0.025, 8, 18),
    accent
  );
  collar.rotation.x = Math.PI / 2;
  collar.position.set(0, 1.49, 0.2);
  jersey.add(torso, pads, collar, jerseyNumber(number));
  return jersey;
}

function makeHelmet(
  primary: THREE.Material,
  accent: THREE.Material
): THREE.Group {
  const helmet = new THREE.Group();
  helmet.position.y = 1.72;
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.19, 24, 16),
    primary
  );
  shell.scale.set(1.02, 1, 1.08);
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
