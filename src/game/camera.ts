import * as THREE from 'three';
import { LOS_Z } from './constants';
import { clamp, lerp } from './math';

export type CamPhase = 'presnap' | 'play' | 'throw' | 'dead';

// Low 3/4 sideline: shallow pitch, tracks the pocket.
const FOV = 50;
const HEIGHT = 7.6;
const BACK = 18.4;
const SIDE = 14.8;
const LOOK_AHEAD = 4.6;
const LOOK_Y = 1.15;
const THROW_AHEAD = 2.8;
const ZOOM_MIN = 0.72;
const ZOOM_MAX = 1.38;
const FOLLOW = 3.8;
const POCKET_BACK = 5;

export class MaddenCamera {
  private readonly cam: THREE.PerspectiveCamera;
  private readonly canvas: HTMLCanvasElement;
  private readonly look = new THREE.Vector3();
  private phase: CamPhase = 'presnap';
  private zoom = 1;
  private subjectX = 0;
  private subjectZ = LOS_Z - POCKET_BACK;
  private ahead = LOOK_AHEAD;
  private losZ = LOS_Z;
  private attached = false;

  constructor(
    camera: THREE.PerspectiveCamera,
    canvas: HTMLCanvasElement
  ) {
    this.cam = camera;
    this.canvas = canvas;
    this.cam.fov = FOV;
    this.cam.near = 0.1;
    this.cam.far = 400;
  }

  attach(): void {
    if (this.attached) {
      return;
    }
    this.attached = true;
    this.canvas.addEventListener('wheel', this.onWheel, {
      passive: false
    });
  }

  setLos(z: number): void {
    this.losZ = z;
  }

  setPhase(phase: CamPhase): void {
    this.phase = phase;
    if (phase === 'presnap') {
      this.subjectX = 0;
      this.subjectZ = this.losZ - POCKET_BACK;
      this.ahead = LOOK_AHEAD;
    }
  }

  follow(qbX: number, qbZ: number, dt: number): void {
    if (this.phase !== 'play' && this.phase !== 'throw') {
      return;
    }
    const k = 1 - Math.exp(-dt * FOLLOW);
    this.subjectX = lerp(this.subjectX, qbX, k);
    this.subjectZ = lerp(this.subjectZ, qbZ, k);
    const extra = this.phase === 'throw' ? THROW_AHEAD : 0;
    this.ahead = lerp(this.ahead, LOOK_AHEAD + extra, k);
  }

  reset(): void {
    this.phase = 'presnap';
    this.zoom = 1;
    this.subjectX = 0;
    this.subjectZ = this.losZ - POCKET_BACK;
    this.ahead = LOOK_AHEAD;
    this.writePose();
  }

  update(): void {
    this.writePose();
  }

  resize(): void {
    this.cam.updateProjectionMatrix();
  }

  private writePose(): void {
    const lookZ = this.subjectZ + this.ahead;
    this.look.set(this.subjectX, LOOK_Y, lookZ);
    this.cam.position.set(
      this.look.x + SIDE * this.zoom,
      this.look.y + HEIGHT * this.zoom,
      this.look.z - BACK * this.zoom
    );
    this.cam.lookAt(this.look);
  }

  private readonly onWheel = (ev: WheelEvent): void => {
    ev.preventDefault();
    const step = Math.sign(ev.deltaY) * 0.06;
    this.zoom = clamp(this.zoom + step, ZOOM_MIN, ZOOM_MAX);
  };
}
