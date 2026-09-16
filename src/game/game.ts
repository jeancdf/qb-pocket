import * as THREE from 'three';
import { ballisticVel, Football } from './ball';
import { MaddenCamera } from './camera';
import {
  CATCH_RADIUS,
  COLORS,
  HALF_W,
  LOS_Z,
  SACK_RANGE,
  SACK_TIME,
  THROW_SPEED
} from './constants';
import { closestDefender, gradeReceiver } from './coverage';
import { buildWorld } from './field';
import type { HudRow } from './hud';
import { makeTeamMats } from './materials';
import { clamp, xzDist } from './math';
import { LinePlay } from './line-play';
import { SMASH, THROW_ORDER } from './playbook';
import { handPos, PlayerActor } from './players';
import type { Phase } from './types';

export class FootballGame {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly madden: MaddenCamera;
  phase: Phase = 'presnap';
  clock = 0;
  private readonly ball = new Football();
  private readonly players: PlayerActor[] = [];
  private readonly byId = new Map<string, PlayerActor>();
  private readonly line: LinePlay;
  private readonly ray = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private target: PlayerActor | null = null;
  private toast?: (msg: string, bad: boolean) => void;
  private readonly routeLines: THREE.Line[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 400);
    this.renderer = makeRenderer(canvas);
    this.madden = new MaddenCamera(this.camera, canvas);
    this.madden.attach();
    this.scene.background = new THREE.Color(COLORS.sky);
    this.scene.fog = new THREE.Fog(COLORS.fog, 70, 210);
    addLights(this.scene);
    buildWorld(this.scene);
    this.spawn();
    this.line = new LinePlay(this.byId);
    this.madden.reset();
    this.resize();
  }

  onToast(fn: (msg: string, bad: boolean) => void): void {
    this.toast = fn;
  }

  snap(): void {
    if (this.phase !== 'presnap') {
      return;
    }
    this.phase = 'play';
    this.clock = 0;
    this.madden.setPhase('play');
    this.ball.hold(this.qb().mesh);
    this.setRoutes(true);
  }

  reset(): void {
    this.phase = 'presnap';
    this.clock = 0;
    this.target = null;
    for (const p of this.players) {
      p.reset();
    }
    this.line.reset();
    this.placeBall();
    this.setRoutes(false);
    this.madden.reset();
  }

  throwTo(id: string): void {
    if (this.phase !== 'play') {
      return;
    }
    const wr = this.byId.get(id);
    if (!wr?.def.eligible) {
      return;
    }
    this.target = wr;
    const from = handPos(this.qb());
    const time = flightTime(from, wr);
    const lead = wr.predict(time);
    const to = new THREE.Vector3(lead.x, 1.68, lead.z);
    const vel = ballisticVel(from, to, time);
    this.ball.launch(this.scene, from, vel);
    this.phase = 'throw';
    this.madden.setPhase('throw');
  }

  pick(cx: number, cy: number): string | null {
    const rec = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((cx - rec.left) / rec.width) * 2 - 1;
    this.pointer.y = -((cy - rec.top) / rec.height) * 2 + 1;
    this.ray.setFromCamera(this.pointer, this.camera);
    const hits = this.ray.intersectObjects(this.scene.children, true);
    for (const hit of hits) {
      const id = hit.object.userData.id as string | undefined;
      if (id && this.byId.get(id)?.def.eligible) {
        return id;
      }
    }
    return null;
  }

  update(dt: number): void {
    const live = this.phase === 'play' || this.phase === 'throw';
    if (live) {
      this.clock += dt;
    }
    for (const p of this.players) {
      const isLine =
        p.def.pos === 'OL' || p.def.pos === 'DL';
      p.update(dt, live && !isLine);
    }
    this.line.update(dt, live, this.qb());
    this.ball.update(dt);
    this.grade();
    if (this.phase === 'play') {
      this.checkSack();
    }
    if (this.phase === 'throw') {
      this.checkPass();
    }
    if (live) {
      const qb = this.qb();
      this.madden.follow(qb.x, qb.z, dt);
    }
    this.madden.update();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    this.camera.aspect = w / Math.max(h, 1);
    this.madden.resize();
    this.renderer.setSize(w, h, false);
  }

  hudRows(): HudRow[] {
    return THROW_ORDER.map((id) => {
      const p = this.byId.get(id)!;
      return {
        id: p.def.id,
        key: p.def.key ?? '',
        number: p.def.number,
        label: p.def.label,
        routeName: p.def.routeName ?? '',
        cover: p.cover
      };
    });
  }

  statusText(): string {
    switch (this.phase) {
      case 'presnap':
        return 'Pre-snap. Hit SNAP, then throw to the open man.';
      case 'play':
        return 'Scan the rings. Green is open. Throw before the sack.';
      case 'throw':
        return `Ball out to ${this.target?.def.label ?? 'WR'}.`;
      case 'complete':
        return 'Catch is secured. Reset to run Smash again.';
      case 'incomplete':
        return 'Pass fell incomplete. Reset and try another read.';
      case 'sack':
        return 'Sacked. Get the ball out sooner next time.';
      default:
        return '';
    }
  }

  pocketLeft(): number {
    if (this.phase !== 'play') {
      return 0;
    }
    return Math.max(0, SACK_TIME - this.clock);
  }

  private spawn(): void {
    const mats = makeTeamMats();
    for (const def of SMASH) {
      const actor = new PlayerActor(def, mats[def.side]);
      this.players.push(actor);
      this.byId.set(def.id, actor);
      this.scene.add(actor.mesh);
      if (def.eligible && def.route) {
        const line = routeGhost(def.start, def.route);
        line.visible = false;
        this.routeLines.push(line);
        this.scene.add(line);
      }
    }
    this.placeBall();
  }

  private placeBall(): void {
    const spot = new THREE.Vector3(0, 0.12, LOS_Z);
    this.ball.pin(this.scene, spot);
  }

  private setRoutes(on: boolean): void {
    for (const line of this.routeLines) {
      line.visible = on;
    }
  }

  private qb(): PlayerActor {
    return this.byId.get('qb')!;
  }

  private defenders(): PlayerActor[] {
    return this.players.filter((p) => p.def.side === 'defense');
  }

  private grade(): void {
    const show = this.phase === 'play' || this.phase === 'throw';
    const defs = this.defenders();
    const qb = this.qb();
    for (const p of this.players) {
      if (!p.def.eligible) {
        continue;
      }
      p.setCover(show ? gradeReceiver(p, qb, defs) : 'idle');
    }
  }

  private checkSack(): void {
    if (this.clock < 2.85) {
      return;
    }
    const qb = this.qb();
    const ends = [this.byId.get('lde'), this.byId.get('rde')];
    const hit = ends.some(
      (d) => d && xzDist(qb, d) < SACK_RANGE
    );
    if (hit || this.clock >= SACK_TIME) {
      this.finish('sack', 'SACK', true);
    }
  }

  private checkPass(): void {
    const b = this.ball;
    if (Math.abs(b.pos.x) > HALF_W + 0.2) {
      this.finish('incomplete', 'OUT OF BOUNDS', true);
      return;
    }
    if (!b.inAir) {
      this.finish('incomplete', 'INCOMPLETE', true);
      return;
    }
    if (!this.target || b.pos.y < 0.45 || b.pos.y > 2.85) {
      return;
    }
    const rec = { x: this.target.x, z: this.target.z };
    if (xzDist(rec, b.pos) > CATCH_RADIUS) {
      return;
    }
    this.resolveCatch();
  }

  private resolveCatch(): void {
    const wr = this.target!;
    const def = closestDefender(wr, this.defenders());
    const sep = def ? xzDist(wr, def) : 99;
    const toDef = def ? xzDist(this.ball.pos, def) : 99;
    const toWr = xzDist(this.ball.pos, wr);
    if (toDef + 0.15 < toWr && toDef < 1.25) {
      this.finish('incomplete', 'PICK', true);
      return;
    }
    if (sep < 1.85) {
      this.finish('incomplete', 'BROKEN UP', true);
      return;
    }
    this.ball.inAir = false;
    this.ball.hold(wr.mesh);
    this.finish('complete', 'COMPLETE', false);
  }

  private finish(phase: Phase, msg: string, bad: boolean): void {
    this.phase = phase;
    this.madden.setPhase('dead');
    this.toast?.(msg, bad);
  }
}

function makeRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
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

function addLights(scene: THREE.Scene): void {
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

function flightTime(from: THREE.Vector3, wr: PlayerActor): number {
  const dist = Math.hypot(wr.x - from.x, wr.z - from.z);
  return clamp(dist / THROW_SPEED + 0.12, 0.5, 1.55);
}

function routeGhost(
  start: { x: number; z: number },
  route: Array<{ x: number; z: number }>
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
