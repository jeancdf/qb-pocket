import * as THREE from 'three';
import { BALL_DRAG, COLORS, GRAVITY } from './constants';

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
    this.mesh.position.set(0.32, 1.12, 0.28);
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
    this.mesh.rotateX(spd * dt * 0.35);
  }
}

export function ballisticVel(
  from: THREE.Vector3,
  to: THREE.Vector3,
  time: number
): THREE.Vector3 {
  const v = to.clone().sub(from).divideScalar(time);
  v.y += 0.5 * GRAVITY * time;
  return v;
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
  return g;
}
