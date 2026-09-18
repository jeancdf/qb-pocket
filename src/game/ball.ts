import * as THREE from 'three';
import { BALL_DRAG, COLORS, GRAVITY } from './constants';

/** 1 uses THROW_SPEED as authored. 2.1 made passes float. */
const PASS_FLIGHT_TIME_SCALE = 1;
/** Visual mesh only; pass arc and flight time stay independent. */
const BALL_VISUAL_SCALE = 1.2;
const FLIGHT_SIMULATION_STEP = 1 / 120;
const VELOCITY_CORRECTION_PASSES = 4;
/** Radians per yard/s. ~4 rev/s at THROW_SPEED so laces roll. */
const SPIRAL_SPIN_PER_SPEED = 0.62;
const LONG_AXIS = new THREE.Vector3(1, 0, 0);
/** Nose toward the sky at release; not the shallow launch angle. */
const NOSE_AT_THROW = 1.05;
/** Nose toward the ground when the pass arrives. */
const NOSE_AT_CATCH = -1.12;
/** Matches game.ts throw aim height for hang-time estimates. */
const PASS_ARRIVAL_Y = 1.68;

export class Football {
  readonly mesh: THREE.Group;
  readonly vel = new THREE.Vector3();
  readonly pos = new THREE.Vector3();
  inAir = false;
  private holder: THREE.Group | null = null;
  /** Spins around the long axis while the root pitches the nose. */
  private readonly spinner: THREE.Group;
  private readonly flightDir = new THREE.Vector3();
  private readonly passHeading = new THREE.Vector3(0, 0, 1);
  private flightAge = 0;
  private flightDuration = 1;

  constructor() {
    const built = buildBall();
    this.mesh = built.root;
    this.spinner = built.spinner;
  }

  hold(parent: THREE.Group): void {
    this.holder = parent;
    this.inAir = false;
    this.vel.set(0, 0, 0);
    this.flightAge = 0;
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
    this.flightAge = 0;
    this.flightDuration = estimatePassDuration(from, vel);
    this.passHeading.set(vel.x, 0, vel.z);
    if (this.passHeading.lengthSq() < 1e-6) {
      this.passHeading.set(0, 0, 1);
    } else {
      this.passHeading.normalize();
    }
    this.spinner.rotation.set(0, 0, 0);
    this.aimNoseAttitude();
  }

  pin(scene: THREE.Scene, at: THREE.Vector3): void {
    this.releaseToScene(scene, at);
    this.pos.copy(at);
    this.pos.y = 0.12;
    this.mesh.position.copy(this.pos);
    this.inAir = false;
    this.vel.set(0, 0, 0);
    this.flightAge = 0;
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
    this.flightAge += dt;
    this.aimNoseAttitude();
    this.spinner.rotateX(spd * dt * SPIRAL_SPIN_PER_SPEED);
  }

  /**
   * Sky at throw, pitch over in flight, ground at the receiver.
   * Heading stays on the throw; gyro spin is on the spinner.
   */
  private aimNoseAttitude(): void {
    const u = Math.min(1, this.flightAge / this.flightDuration);
    const eased = u * u * (3 - 2 * u);
    const pitch = NOSE_AT_THROW +
      (NOSE_AT_CATCH - NOSE_AT_THROW) * eased;
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    this.flightDir.set(
      this.passHeading.x * cosP,
      sinP,
      this.passHeading.z * cosP
    );
    this.mesh.quaternion.setFromUnitVectors(
      LONG_AXIS,
      this.flightDir
    );
  }
}

export function ballisticVel(
  from: THREE.Vector3,
  to: THREE.Vector3,
  time: number
): THREE.Vector3 {
  // Scale 1 keeps THROW_SPEED; gravity still bends the spiral.
  const flightTime = time * PASS_FLIGHT_TIME_SCALE;
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
  // Match the live drag integration so the arc still reaches its aim.
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

function estimatePassDuration(
  from: THREE.Vector3,
  initialVelocity: THREE.Vector3
): number {
  // Drag hang time down to catch height after the apex.
  const pos = from.clone();
  const vel = initialVelocity.clone();
  const dt = FLIGHT_SIMULATION_STEP;
  let t = 0;
  let seenApex = vel.y <= 0;
  while (t < 4) {
    vel.y -= GRAVITY * dt;
    const spd = vel.length();
    if (spd > 0.05) {
      const drag = BALL_DRAG * spd * spd;
      vel.addScaledVector(vel, (-drag * dt) / spd);
    }
    pos.addScaledVector(vel, dt);
    t += dt;
    if (vel.y <= 0) {
      seenApex = true;
    }
    if (seenApex && pos.y <= PASS_ARRIVAL_Y) {
      return Math.max(t, 0.4);
    }
  }
  return t;
}

function buildBall(): { root: THREE.Group; spinner: THREE.Group } {
  const root = new THREE.Group();
  const spinner = new THREE.Group();
  const leather = new THREE.MeshStandardMaterial({
    color: 0x6b3318,
    roughness: 0.55,
    metalness: 0.05
  });
  const laceMat = new THREE.MeshStandardMaterial({
    color: COLORS.white,
    roughness: 0.4,
    metalness: 0.04
  });
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 16, 12),
    leather
  );
  body.scale.set(1.55, 0.92, 0.92);
  body.castShadow = true;
  spinner.add(body);
  addEndStripes(spinner, laceMat);
  addLaces(spinner, laceMat);
  root.add(spinner);
  root.scale.setScalar(BALL_VISUAL_SCALE);
  return { root, spinner };
}

function addEndStripes(
  parent: THREE.Group,
  mat: THREE.MeshStandardMaterial
): void {
  for (const x of [-0.13, 0.13]) {
    const stripe = new THREE.Mesh(
      new THREE.TorusGeometry(0.112, 0.011, 6, 20),
      mat
    );
    stripe.rotation.y = Math.PI / 2;
    stripe.position.x = x;
    parent.add(stripe);
  }
}

function addLaces(
  parent: THREE.Group,
  mat: THREE.MeshStandardMaterial
): void {
  // Leather top is y≈0.138; keep the lace bed proud so it is not buried.
  const bed = new THREE.Mesh(
    new THREE.BoxGeometry(0.17, 0.012, 0.038),
    mat
  );
  bed.position.set(0, 0.142, 0);
  parent.add(bed);
  for (let i = 0; i < 8; i += 1) {
    const stitch = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.016, 0.052),
      mat
    );
    stitch.position.set(-0.056 + i * 0.016, 0.15, 0);
    parent.add(stitch);
  }
}
