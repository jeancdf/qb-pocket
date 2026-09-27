import * as THREE from 'three';
import { BALL_DRAG, COLORS, GRAVITY } from './constants';

/** Visual mesh only; pass arc and flight time stay independent. */
const BALL_VISUAL_SCALE = 1.2;
const FLIGHT_SIMULATION_STEP = 1 / 120;
const VELOCITY_CORRECTION_PASSES = 4;
/** The ball's long axis (nose) in its own space. */
const LONG_AXIS = new THREE.Vector3(1, 0, 0);
/** Spiral spin, radians per (yd/s · s): ~6 rev/s on a bullet. */
const SPIRAL_SPIN_PER_SPEED = 1.6;
/** How fast the nose settles onto the flight path. */
const NOSE_FOLLOW = 18;

export class Football {
  readonly mesh: THREE.Group;
  readonly vel = new THREE.Vector3();
  readonly pos = new THREE.Vector3();
  inAir = false;
  private holder: THREE.Group | null = null;
  /** Spins around the long axis while the root points the nose. */
  private readonly spinner: THREE.Group;
  private readonly noseDir = new THREE.Vector3();
  private readonly noseQuat = new THREE.Quaternion();

  constructor() {
    const built = buildBall();
    this.mesh = built.root;
    this.spinner = built.spinner;
  }

  hold(parent: THREE.Group): void {
    this.holder = parent;
    this.inAir = false;
    this.vel.set(0, 0, 0);
    parent.add(this.mesh);
    this.mesh.position.set(0.01, -0.05, 0.02);
    this.spinner.rotation.set(0, 0, 0);
    this.mesh.rotation.set(0.4, 0.2, 1.2);
  }

  releaseToScene(scene: THREE.Scene, world: THREE.Vector3): void {
    this.holder?.remove(this.mesh);
    this.holder = null;
    scene.add(this.mesh);
    this.pos.copy(world);
    this.mesh.position.copy(world);
  }

  launch(scene: THREE.Scene, from: THREE.Vector3, vel: THREE.Vector3): void {
    this.releaseToScene(scene, from);
    this.vel.copy(vel);
    this.inAir = true;
    this.spinner.rotation.set(0, 0, 0);
    this.aimNose(1);
  }

  pin(scene: THREE.Scene, at: THREE.Vector3): void {
    this.releaseToScene(scene, at);
    this.pos.copy(at);
    this.pos.y = 0.12;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(0, Math.PI / 2, 0);
    this.spinner.rotation.set(0, 0, 0);
    this.inAir = false;
    this.vel.set(0, 0, 0);
  }

  update(dt: number): void {
    if (this.holder || !this.inAir) {
      return;
    }
    this.vel.y -= GRAVITY * dt;
    const spd = this.vel.length();
    if (spd > 0.05) {
      const drag = BALL_DRAG * spd * spd;
      this.vel.addScaledVector(this.vel, (-drag * dt) / spd);
    }
    this.pos.addScaledVector(this.vel, dt);
    if (this.pos.y <= 0.11) {
      this.pos.y = 0.11;
      this.vel.y *= -0.3;
      this.vel.x *= 0.58;
      this.vel.z *= 0.58;
      if (this.vel.length() < 1.8) {
        this.inAir = false;
        this.vel.set(0, 0, 0);
      }
    }
    this.mesh.position.copy(this.pos);
    if (!this.inAir) {
      return;
    }
    // Nose rides the velocity: up on the climb, level at the
    // apex, down into the receiver. Spiral turns about that axis.
    this.aimNose(1 - Math.exp(-dt * NOSE_FOLLOW));
    this.spinner.rotateX(spd * dt * SPIRAL_SPIN_PER_SPEED);
  }

  private aimNose(amount: number): void {
    if (this.vel.lengthSq() < 0.25) {
      return;
    }
    this.noseDir.copy(this.vel).normalize();
    this.noseQuat.setFromUnitVectors(LONG_AXIS, this.noseDir);
    this.mesh.quaternion.slerp(this.noseQuat, amount);
  }
}

export function ballisticVel(
  from: THREE.Vector3,
  to: THREE.Vector3,
  time: number
): THREE.Vector3 {
  // `time` is the real hang time; power already set it.
  const flightTime = time;
  const velocity = estimateLaunchVelocity(from, to, flightTime);
  for (let i = 0; i < VELOCITY_CORRECTION_PASSES; i += 1) {
    const landing = simulateFlight(from, velocity, flightTime);
    const correction = to.clone().sub(landing).divideScalar(flightTime);
    velocity.add(correction);
  }
  return velocity;
}

function estimateLaunchVelocity(
  from: THREE.Vector3,
  to: THREE.Vector3,
  time: number
): THREE.Vector3 {
  // Vacuum displacement plus inverse drag gives a stable first estimate.
  const disp = to.clone().sub(from);
  disp.y += 0.5 * GRAVITY * time * time;
  const d = disp.length();
  const kd = BALL_DRAG * d;
  const scale =
    kd < 1e-5 ? 1 / time : (Math.exp(kd) - 1) / (kd * time);
  return disp.multiplyScalar(scale);
}

function simulateFlight(
  from: THREE.Vector3,
  initialVelocity: THREE.Vector3,
  time: number
): THREE.Vector3 {
  // Match the live drag integration so the higher arc still reaches its aim.
  const pos = from.clone();
  const vel = initialVelocity.clone();
  const steps = Math.ceil(time / FLIGHT_SIMULATION_STEP);
  const dt = time / steps;
  for (let i = 0; i < steps; i += 1) {
    vel.y -= GRAVITY * dt;
    const spd = vel.length();
    if (spd > 0.05) {
      const drag = BALL_DRAG * spd * spd;
      vel.addScaledVector(vel, (-drag * dt) / spd);
    }
    pos.addScaledVector(vel, dt);
  }
  return pos;
}

function buildBall(): { root: THREE.Group; spinner: THREE.Group } {
  const root = new THREE.Group();
  const g = new THREE.Group();
  const leather = new THREE.MeshStandardMaterial({
    color: 0x6b3318,
    roughness: 0.55,
    metalness: 0.05
  });
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 16, 12),
    leather
  );
  body.scale.set(1.55, 0.92, 0.92);
  body.castShadow = true;
  const stripe = new THREE.Mesh(
    new THREE.TorusGeometry(0.12, 0.012, 6, 18),
    new THREE.MeshStandardMaterial({ color: COLORS.white })
  );
  stripe.rotation.y = Math.PI / 2;
  const lace = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.012, 0.03),
    new THREE.MeshStandardMaterial({ color: COLORS.white })
  );
  lace.position.set(0, 0.12, 0);
  g.add(body, stripe, lace);
  root.add(g);
  root.scale.setScalar(BALL_VISUAL_SCALE);
  return { root, spinner: g };
}
