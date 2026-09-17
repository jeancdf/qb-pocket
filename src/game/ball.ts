import * as THREE from 'three';
import { BALL_DRAG, COLORS, GRAVITY } from './constants';

const PASS_FLIGHT_TIME_SCALE = 2.1;
const BALL_VISUAL_SCALE = 1.8;
const FLIGHT_SIMULATION_STEP = 1 / 120;
const VELOCITY_CORRECTION_PASSES = 4;

export class Football {
  readonly mesh: THREE.Group;
  readonly vel = new THREE.Vector3();
  readonly pos = new THREE.Vector3();
  inAir = false;
  private holder: THREE.Group | null = null;

  constructor() {
    this.mesh = buildBall();
  }

  hold(parent: THREE.Group): void {
    this.holder = parent;
    this.inAir = false;
    this.vel.set(0, 0, 0);
    parent.add(this.mesh);
    this.mesh.position.set(0.01, -0.05, 0.02);
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
  }

  pin(scene: THREE.Scene, at: THREE.Vector3): void {
    this.releaseToScene(scene, at);
    this.pos.copy(at);
    this.pos.y = 0.12;
    this.mesh.position.copy(this.pos);
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
    this.mesh.rotateX(spd * dt * 0.55);
  }
}

export function ballisticVel(
  from: THREE.Vector3,
  to: THREE.Vector3,
  time: number
): THREE.Vector3 {
  // Longer flight time slows passes and gives gravity room to show the arc.
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

function buildBall(): THREE.Group {
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
  g.scale.setScalar(BALL_VISUAL_SCALE);
  return g;
}
