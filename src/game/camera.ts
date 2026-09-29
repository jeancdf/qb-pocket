import * as THREE from 'three';
import { LOS_Z } from './constants';
import { clamp, lerp } from './math';

export type CamPhase = 'presnap' | 'play' | 'throw' | 'dead';

// Behind the QB, in line with the field (+z downfield).
// The camera never yaws: it slides on x with the QB and
// always looks straight up the field. Don't add a side
// offset here, it turns the whole view diagonal.
// Framing: the look point is LOOK_AHEAD past the QB and the
// camera BACK behind that point, so it sits ~10 m behind the QB,
// ~4.5 m off the grass, with a shallow pitch that shows the
// whole QB low in frame and the field far downfield.
const FOV = 60;
const HEIGHT = 3.5;
const BACK = 22;
const LOOK_AHEAD = 12;
const LOOK_Y = 1;
const THROW_AHEAD = 3;
const PUNCH_ZOOM = 1.32;
const PUNCH_RATE = 5.5;
const ZOOM_MIN = 0.72;
const ZOOM_MAX = 1.38;
const FOLLOW = 3.8;
// Ball in the air: track it faster, and raise the whole rig with
// the ball's height so the top of the arc stays in frame.
const BALL_FOLLOW = 7;
const BALL_LIFT = 0.6;
const POCKET_BACK = 5;
// Defense without a controlled man: the rig flips to the far side and looks back at the
// offense (-z), a bit higher so the whole shell is in frame. The
// subject sits DEF_LEAD yards on the defense side of the ball.
const DEF_HEIGHT = 5.2;
const DEF_BACK = 24;
const DEF_LEAD = 7;
// Defense: the rig rides behind the controlled defender and turns
// to face the ball (the one place the camera yaws). Heavily
// smoothed so it does not sway with every step.
const DEF_CAM_BACK = 9;
const DEF_CAM_HEIGHT = 4.2;
const DEF_CAM_AHEAD = 6;
const DEF_POS_FOLLOW = 3.2;
const DEF_YAW_FOLLOW = 1.8;
/** Ball closer than this: keep the current heading. */
const DEF_YAW_DEADZONE = 2.5;

export class MaddenCamera {
  private readonly cam: THREE.PerspectiveCamera;
  private readonly canvas: HTMLCanvasElement;
  private readonly look = new THREE.Vector3();
  private phase: CamPhase = 'presnap';
  private zoom = 1;
  private subjectX = 0;
  private subjectZ = LOS_Z - POCKET_BACK;
  private ahead = LOOK_AHEAD;
  private lift = 0;
  private losZ = LOS_Z;
  private attached = false;
  private punch = false;
  /** +1 behind the offense (looking +z), -1 behind the defense. */
  private dir: 1 | -1 = 1;
  /** Defense rig: defender spot and heading toward the ball. */
  private defX = 0;
  private defZ = 0;
  private yaw = Math.PI;
  private defReady = false;

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

  /** Which side the player is on: the rig goes behind that unit. */
  setSide(side: 'offense' | 'defense'): void {
    this.dir = side === 'offense' ? 1 : -1;
    this.defReady = false;
  }

  /**
   * Defense: stay behind the player's defender, facing the ball.
   * `snap` jumps straight there (new possession / huddle).
   */
  trackDefender(
    px: number,
    pz: number,
    bx: number,
    bz: number,
    dt: number,
    snap = false
  ): void {
    const far = Math.hypot(bx - px, bz - pz) > DEF_YAW_DEADZONE;
    const target = far ? Math.atan2(bx - px, bz - pz) : this.yaw;
    if (snap || !this.defReady) {
      this.defX = px;
      this.defZ = pz;
      this.yaw = target;
      this.defReady = true;
      return;
    }
    const kp = 1 - Math.exp(-dt * DEF_POS_FOLLOW);
    this.defX = lerp(this.defX, px, kp);
    this.defZ = lerp(this.defZ, pz, kp);
    const ky = 1 - Math.exp(-dt * DEF_YAW_FOLLOW);
    let d = target - this.yaw;
    while (d > Math.PI) {
      d -= Math.PI * 2;
    }
    while (d < -Math.PI) {
      d += Math.PI * 2;
    }
    this.yaw += d * ky;
  }

  /** Heading the defense rig looks along (radians, 0 = +z). */
  heading(): number {
    return this.dir === 1 ? 0 : this.yaw;
  }

  /** Where the rig centres itself for a spot on the field. */
  private anchorZ(z: number): number {
    return this.dir === 1 ? z : z + DEF_LEAD;
  }

  private presnapZ(): number {
    return this.dir === 1 ? this.losZ - POCKET_BACK : this.losZ + DEF_LEAD;
  }

  setPhase(phase: CamPhase): void {
    this.phase = phase;
    if (phase === 'presnap') {
      this.subjectX = 0;
      this.subjectZ = this.presnapZ();
      this.ahead = LOOK_AHEAD;
      this.lift = 0;
    }
  }

  /** Track the QB or the ball carrier. */
  follow(qbX: number, qbZ: number, dt: number): void {
    if (this.phase !== 'play' && this.phase !== 'throw') {
      return;
    }
    const k = 1 - Math.exp(-dt * FOLLOW);
    this.subjectX = lerp(this.subjectX, qbX, k);
    this.subjectZ = lerp(this.subjectZ, this.anchorZ(qbZ), k);
    this.lift = lerp(this.lift, 0, k);
    const extra = this.phase === 'throw' ? THROW_AHEAD : 0;
    this.ahead = lerp(this.ahead, LOOK_AHEAD + extra, k);
  }

  /**
   * Pass in the air: ride with the ball down the field. Still
   * straight behind it on the field axis, never yawed.
   */
  followBall(x: number, y: number, z: number, dt: number): void {
    if (this.phase !== 'throw') {
      return;
    }
    const k = 1 - Math.exp(-dt * BALL_FOLLOW);
    this.subjectX = lerp(this.subjectX, x, k);
    this.subjectZ = lerp(this.subjectZ, this.anchorZ(z), k);
    this.lift = lerp(this.lift, Math.max(0, y) * BALL_LIFT, k);
    this.ahead = lerp(this.ahead, LOOK_AHEAD, k);
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
    this.subjectZ = this.presnapZ();
    this.ahead = LOOK_AHEAD;
    this.lift = 0;
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
    if (this.dir === -1 && this.defReady) {
      this.writeDefensePose();
      return;
    }
    const d = this.dir;
    const height = d === 1 ? HEIGHT : DEF_HEIGHT;
    const back = d === 1 ? BACK : DEF_BACK;
    const lookZ = this.subjectZ + this.ahead * d;
    this.look.set(this.subjectX, LOOK_Y + this.lift, lookZ);
    this.cam.position.set(
      this.look.x,
      this.look.y + height * this.zoom,
      this.look.z - back * this.zoom * d
    );
    this.cam.lookAt(this.look);
  }

  private writeDefensePose(): void {
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const z = this.zoom;
    this.look.set(
      this.defX + fx * DEF_CAM_AHEAD,
      LOOK_Y,
      this.defZ + fz * DEF_CAM_AHEAD
    );
    this.cam.position.set(
      this.defX - fx * DEF_CAM_BACK * z,
      LOOK_Y + DEF_CAM_HEIGHT * z,
      this.defZ - fz * DEF_CAM_BACK * z
    );
    this.cam.lookAt(this.look);
  }

  private readonly onWheel = (ev: WheelEvent): void => {
    ev.preventDefault();
    const step = Math.sign(ev.deltaY) * 0.06;
    this.zoom = clamp(this.zoom + step, ZOOM_MIN, ZOOM_MAX);
  };
}
