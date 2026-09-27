import * as THREE from 'three';
import { LOS_Z } from './constants';
import { clamp, lerp } from './math';

export type CamPhase = 'presnap' | 'play' | 'throw' | 'dead';

// Behind the QB, in line with the field (+z downfield).
// The camera never yaws: it slides on x with the QB and
// always looks straight up the field. Don't add a side
// offset here, it turns the whole view diagonal.
const FOV = 55;
const HEIGHT = 6.4;
const BACK = 11.5;
const LOOK_AHEAD = 9;
const LOOK_Y = 1.2;
const THROW_AHEAD = 3;
const PUNCH_ZOOM = 1.32;
const PUNCH_RATE = 5.5;
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
  private punch = false;

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

  /** Tight zoom while a tackle lands. */
  setPunch(on: boolean): void {
    this.punch = on;
  }

  reset(): void {
    this.phase = 'presnap';
    this.zoom = 1;
    this.punch = false;
    this.subjectX = 0;
    this.subjectZ = this.losZ - POCKET_BACK;
    this.ahead = LOOK_AHEAD;
    this.writePose();
  }

  update(dt: number): void {
    const target = this.punch ? PUNCH_ZOOM : 1;
    const k = 1 - Math.exp(-dt * PUNCH_RATE);
    this.cam.zoom = lerp(this.cam.zoom, target, k);
    this.cam.updateProjectionMatrix();
    this.writePose();
  }

  resize(): void {
    this.cam.updateProjectionMatrix();
  }

  private writePose(): void {
    const lookZ = this.subjectZ + this.ahead;
    this.look.set(this.subjectX, LOOK_Y, lookZ);
    this.cam.position.set(
      this.look.x,
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
