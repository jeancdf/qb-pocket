import * as THREE from 'three';
import {
  COLORS,
  ENDZONE,
  FIELD_LEN,
  FIELD_WID,
  HALF_L,
  HALF_W,
  HASH,
  LOS_Z
} from './constants';

const PX = 16;
const CW = Math.round(FIELD_WID * PX);
const CH = Math.round(FIELD_LEN * PX);

export function buildWorld(scene: THREE.Scene): void {
  const dirt = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 160),
    new THREE.MeshStandardMaterial({
      color: 0x3d4f38,
      roughness: 1
    })
  );
  dirt.rotation.x = -Math.PI / 2;
  dirt.position.y = -0.03;
  dirt.receiveShadow = true;
  scene.add(dirt);
  const field = makeField();
  scene.add(field);
  scene.add(yardMarker(LOS_Z, 0xf5d76e, 0.04));
  scene.add(yardMarker(LOS_Z + 7, 0xf29b3a, 0.05));
  addGoalPosts(scene);
  addStands(scene);
  addTowers(scene);
}

function makeField(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(FIELD_WID, FIELD_LEN, 1, 1);
  const tex = new THREE.CanvasTexture(paintField());
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.86,
    metalness: 0.02
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

function paintField(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = CW;
  c.height = CH;
  const ctx = c.getContext('2d');
  if (!ctx) {
    return c;
  }
  paintGrass(ctx);
  paintEndzones(ctx);
  paintLines(ctx);
  paintNumbers(ctx);
  return c;
}

function paintGrass(ctx: CanvasRenderingContext2D): void {
  const stripe = 5 * PX;
  for (let y = 0; y < CH; y += stripe) {
    const even = (y / stripe) % 2 === 0;
    ctx.fillStyle = even ? '#2f7a3a' : '#276b33';
    ctx.fillRect(0, y, CW, stripe);
  }
}

function paintEndzones(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#123056';
  ctx.fillRect(0, 0, CW, ENDZONE * PX);
  ctx.fillRect(0, CH - ENDZONE * PX, CW, ENDZONE * PX);
  ctx.fillStyle = '#e8c547';
  ctx.font = `bold ${Math.round(3.2 * PX)}px Barlow Condensed, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.save();
  ctx.translate(CW / 2, ENDZONE * PX * 0.5);
  ctx.rotate(Math.PI);
  ctx.fillText('POCKET', 0, 0);
  ctx.restore();
  ctx.fillText('HERO', CW / 2, CH - ENDZONE * PX * 0.5);
}

function paintLines(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = '#f4efe4';
  ctx.lineWidth = 2.4;
  const inset = 0.2 * PX;
  ctx.strokeRect(inset, inset, CW - inset * 2, CH - inset * 2);
  const goal = ENDZONE * PX;
  ctx.beginPath();
  ctx.moveTo(0, goal);
  ctx.lineTo(CW, goal);
  ctx.moveTo(0, CH - goal);
  ctx.lineTo(CW, CH - goal);
  ctx.stroke();
  const cx = CW / 2;
  const hashPx = HASH * PX;
  for (let yd = 5; yd < 110; yd += 5) {
    const y = yd * PX;
    ctx.beginPath();
    ctx.moveTo(inset, y);
    ctx.lineTo(CW - inset, y);
    ctx.stroke();
  }
  ctx.lineWidth = 1.6;
  for (let yd = 10; yd <= 110; yd += 1) {
    if (yd % 5 === 0) {
      continue;
    }
    const y = yd * PX;
    hashTick(ctx, y, cx - hashPx);
    hashTick(ctx, y, cx + hashPx);
    sidelineTick(ctx, y);
  }
}

function hashTick(
  ctx: CanvasRenderingContext2D,
  y: number,
  x: number
): void {
  ctx.beginPath();
  ctx.moveTo(x - 6, y);
  ctx.lineTo(x + 6, y);
  ctx.stroke();
}

function sidelineTick(ctx: CanvasRenderingContext2D, y: number): void {
  ctx.beginPath();
  ctx.moveTo(2, y);
  ctx.lineTo(10, y);
  ctx.moveTo(CW - 10, y);
  ctx.lineTo(CW - 2, y);
  ctx.stroke();
}

function paintNumbers(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#f4efe4';
  ctx.font = `bold ${Math.round(4.2 * PX)}px Barlow Condensed, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const nums = [10, 20, 30, 40, 50, 40, 30, 20, 10];
  nums.forEach((n, i) => {
    const yard = 20 + i * 10;
    const y = yard * PX;
    const left = 11 * PX;
    const right = CW - 11 * PX;
    drawNum(ctx, n, left, y, -Math.PI / 2);
    drawNum(ctx, n, right, y, Math.PI / 2);
  });
}

function drawNum(
  ctx: CanvasRenderingContext2D,
  n: number,
  x: number,
  y: number,
  rot: number
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillText(String(n), 0, 0);
  ctx.restore();
}

function yardMarker(z: number, color: number, y: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(FIELD_WID - 0.6, 0.18);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.85,
    depthWrite: false
  });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(0, y, z);
  return m;
}

function addGoalPosts(scene: THREE.Scene): void {
  scene.add(goalPost(-HALF_L, 1));
  scene.add(goalPost(HALF_L, -1));
}

function goalPost(z: number, face: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: COLORS.post,
    metalness: 0.55,
    roughness: 0.28
  });
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.09, 3.4, 8),
    mat
  );
  pole.position.set(0, 1.7, z);
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(6.17, 0.12, 0.12),
    mat
  );
  bar.position.set(0, 3.33, z);
  const left = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 6.5, 0.1),
    mat
  );
  left.position.set(-3.085, 6.5, z);
  const right = left.clone();
  right.position.x = 3.085;
  g.add(pole, bar, left, right);
  g.position.z += face * 0.2;
  return g;
}

function addStands(scene: THREE.Scene): void {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2a3b4d,
    roughness: 0.92
  });
  const crowd = new THREE.MeshStandardMaterial({
    color: 0x6a5344,
    roughness: 1
  });
  const left = new THREE.Mesh(new THREE.BoxGeometry(12, 14, 96), mat);
  left.position.set(-HALF_W - 8.5, 5, 0);
  left.rotation.z = 0.32;
  left.castShadow = true;
  const right = left.clone();
  right.position.x *= -1;
  right.rotation.z *= -1;
  const seatsL = new THREE.Mesh(new THREE.BoxGeometry(10, 0.4, 90), crowd);
  seatsL.position.set(-HALF_W - 7.2, 8.2, 0);
  seatsL.rotation.z = 0.32;
  const seatsR = seatsL.clone();
  seatsR.position.x *= -1;
  seatsR.rotation.z *= -1;
  scene.add(left, right, seatsL, seatsR);
}

function addTowers(scene: THREE.Scene): void {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x8899aa,
    metalness: 0.4,
    roughness: 0.4
  });
  const spots: Array<[number, number]> = [
    [-HALF_W - 4, -40],
    [HALF_W + 4, -40],
    [-HALF_W - 4, 40],
    [HALF_W + 4, 40]
  ];
  for (const [x, z] of spots) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.22, 18, 8),
      mat
    );
    pole.position.set(x, 9, z);
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.4, 1.1),
      new THREE.MeshStandardMaterial({
        color: 0xfff1c8,
        emissive: 0xffe6a0,
        emissiveIntensity: 0.8
      })
    );
    lamp.position.set(x, 18.2, z);
    scene.add(pole, lamp);
  }
}
