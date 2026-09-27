import * as THREE from 'three';
import type { PlayerActor } from './players';
import type { Vec2 } from './types';

/** Renderer, lights and the small overlay meshes on the grass. */

export function makeRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const r = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false
  });
  r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.12;
  r.outputColorSpace = THREE.SRGBColorSpace;
  return r;
}

export function addLights(scene: THREE.Scene): void {
  const hemi = new THREE.HemisphereLight(0xc5d7ea, 0x2a4a28, 0.85);
  const sun = new THREE.DirectionalLight(0xffe2b8, 1.35);
  sun.position.set(-35, 48, -10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 4;
  sun.shadow.camera.far = 140;
  sun.shadow.camera.left = -50;
  sun.shadow.camera.right = 50;
  sun.shadow.camera.top = 50;
  sun.shadow.camera.bottom = -50;
  scene.add(hemi, sun);
}

const AIM_GOLD = 0xe8c547;
const AIM_RED = 0xff6b5b;

/** Ring on the grass where the pass is going. */
export class AimMark {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.mat = new THREE.MeshBasicMaterial({
      color: AIM_GOLD,
      transparent: true,
      opacity: 0.88,
      depthWrite: false
    });
    this.mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.92, 28),
      this.mat
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  place(spot: Vec2): void {
    this.mesh.visible = true;
    this.mesh.position.set(spot.x, 0.06, spot.z);
  }

  /** Ring size follows accuracy; red when the ball will sail. */
  style(scale: number, sailing: boolean): void {
    this.mesh.scale.setScalar(scale);
    this.mat.color.setHex(sailing ? AIM_RED : AIM_GOLD);
  }

  hide(): void {
    this.mesh.visible = false;
  }
}

/** Dashed pre-snap route lines for the eligible receivers. */
export class RouteGhosts {
  private readonly lines = new Map<string, THREE.Line>();

  constructor(private readonly scene: THREE.Scene) {}

  rebuild(receivers: PlayerActor[], shiftZ: number): void {
    for (const p of receivers) {
      const old = this.lines.get(p.def.id);
      if (old) {
        this.scene.remove(old);
        old.geometry.dispose();
        this.lines.delete(p.def.id);
      }
      if (!p.def.route) {
        continue;
      }
      const line = routeGhost(p.def.start, p.def.route);
      line.position.z = shiftZ;
      this.lines.set(p.def.id, line);
      this.scene.add(line);
    }
  }

  setVisible(on: boolean): void {
    for (const line of this.lines.values()) {
      line.visible = on;
    }
  }
}

function routeGhost(
  start: Vec2,
  route: Vec2[]
): THREE.Line {
  const pts = [start, ...route].map(
    (p) => new THREE.Vector3(p.x, 0.08, p.z)
  );
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineDashedMaterial({
    color: 0xe8c547,
    dashSize: 0.55,
    gapSize: 0.32,
    transparent: true,
    opacity: 0.7
  });
  const line = new THREE.Line(geo, mat);
  line.computeLineDistances();
  return line;
}
