import * as THREE from 'three';
import { LOS_Z } from './constants';
import { clamp, lerp } from './math';

export type CamPhase = 'presnap' | 'play' | 'throw' | 'dead';

const FOV = 48;
const HEIGHT = 23;
const BACK = 11;
const LOOK_AHEAD = 6;
const LOOK_Y = 0.8;
const PLAY_LIFT = 1.1;
const PLAY_CREEP = 1.6;
const PEEK = 0.08;
const PEEK_MAX = 1.2;
const ZOOM_MIN = 0.72;
const ZOOM_MAX = 1.38;
const FOLLOW = 1.35;
const QB_HOME = LOS_Z - 5;

export class MaddenCamera {
  private readonly cam: THREE.PerspectiveCamera;
  private readonly canvas: HTMLCanvasElement;
  private readonly look = new THREE.Vector3();
  private phase: CamPhase = 'presnap';
  private zoom = 1;
  private peekX = 0;
  private creep = 0;
  private lift = 0;
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

  setPhase(phase: CamPhase): void {
    this.phase = phase;
    if (phase === 'presnap') {
      this.creep = 0;
      this.lift = 0;
      this.peekX = 0;
    }
  }

  follow(qbX: number, qbZ: number, dt: number): void {
    if (this.phase !== 'play' && this.phase !== 'throw') {
      return;
    }
    const k = 1 - Math.exp(-dt * FOLLOW);
    const extra = this.phase === 'throw' ? 1.4 : 0;
    const up = clamp(qbZ - QB_HOME, -1.5, 5) * 0.35;
    const goal = clamp(PLAY_CREEP + extra + up, 0, 5.5);
    this.creep = lerp(this.creep, goal, k);
    this.lift = lerp(this.lift, PLAY_LIFT, k);
    this.peekX = lerp(this.peekX, this.peek(qbX), k);
  }

  reset(): void {
    this.phase = 'presnap';
    this.zoom = 1;
    this.peekX = 0;
    this.creep = 0;
    this.lift = 0;
    this.writePose();
  }

  update(): void {
    this.writePose();
  }

  resize(): void {
    this.cam.updateProjectionMatrix();
  }

  private peek(qbX: number): number {
    return clamp(qbX * PEEK, -PEEK_MAX, PEEK_MAX);
  }

  private writePose(): void {
    const yOff = HEIGHT + this.lift - LOOK_Y;
    const zOff = -BACK - LOOK_AHEAD;
    const lookZ = LOS_Z + LOOK_AHEAD + this.creep;
    this.look.set(this.peekX, LOOK_Y, lookZ);
    this.cam.position.set(
      this.peekX,
      this.look.y + yOff * this.zoom,
      this.look.z + zOff * this.zoom
    );
    this.cam.lookAt(this.look);
  }

  private readonly onWheel = (ev: WheelEvent): void => {
    ev.preventDefault();
    const step = Math.sign(ev.deltaY) * 0.06;
    this.zoom = clamp(this.zoom + step, ZOOM_MIN, ZOOM_MAX);
  };
}
