import * as THREE from 'three';
import { ballisticVel, Football } from './ball';
import { MaddenCamera } from './camera';
import {
  CATCH_HEIGHT_MAX,
  CATCH_HEIGHT_MIN,
  CATCH_RADIUS,
  COLORS,
  GOAL_Z,
  HALF_W,
  LOS_Z,
  SACK_RANGE,
  SACK_TIME,
  TACKLE_RANGE,
  THROW_SPEED,
  YAC_SPEED,
  YAC_TIME
} from './constants';
import {
  CoverPlay,
  COVER2,
  COVER3,
  isCoverage,
  nearestEligible,
  type CoverLook
} from './coverage-play';
import { closestDefender, gradeReceiver } from './coverage';
import { Drive } from './drive';
import { buildWorld, type FieldSticks } from './field';
import type { HudRow } from './hud';
import { makeTeamMats } from './materials';
import { clamp, xzDist } from './math';
import { LinePlay } from './line-play';
import { SMASH, THROW_ORDER } from './playbook';
import { PLAYS, type OffPlay } from './plays';
import { handPos, PlayerActor } from './players';
import type { CoverGrade, Phase, Vec2 } from './types';

export interface PlaytestSnap {
  phase: Phase;
  clock: number;
  down: string;
  losZ: number;
  downN: number;
  toGo: number;
  home: number;
  away: number;
  stickLos: number;
  stickFd: number;
  aim: Vec2 | null;
  carrier: string | null;
  breaker: string | null;
  ballInAir: boolean;
  coverage: { id: string; x: number; z: number }[];
  recs: { id: string; x: number; z: number; cover: CoverGrade }[];
}

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
  private readonly cover: CoverPlay;
  private readonly drive = new Drive();
  private readonly sticks: FieldSticks;
  private readonly ray = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly plane = new THREE.Plane(
    new THREE.Vector3(0, 1, 0),
    0
  );
  private readonly hit = new THREE.Vector3();
  private readonly aimMark: THREE.Mesh;
  private readonly routeLines: THREE.Line[] = [];
  private carrier: PlayerActor | null = null;
  private breaker: PlayerActor | null = null;
  private aim: Vec2 | null = null;
  private yacT = 0;
  private whistleT = 0;
  private playIdx = 0;
  private look: CoverLook = COVER3;
  private motionOn = false;
  private motionIdx = 0;
  private stickX = 0;
  private stickZ = 0;
  private readonly ghosts = new Map<string, THREE.Line>();
  private toast?: (msg: string, bad: boolean) => void;
  private overFn?: (over: 'win' | 'loss' | null) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 400);
    this.renderer = makeRenderer(canvas);
    this.madden = new MaddenCamera(this.camera, canvas);
    this.madden.attach();
    this.scene.background = new THREE.Color(COLORS.sky);
    this.scene.fog = new THREE.Fog(COLORS.fog, 70, 210);
    addLights(this.scene);
    this.sticks = buildWorld(this.scene);
    this.aimMark = makeAimMark();
    this.scene.add(this.aimMark);
    this.spawn();
    this.line = new LinePlay(this.byId);
    this.cover = new CoverPlay(this.byId);
    this.huddle();
    this.resize();
  }

  onToast(fn: (msg: string, bad: boolean) => void): void {
    this.toast = fn;
  }

  onOver(fn: (over: 'win' | 'loss' | null) => void): void {
    this.overFn = fn;
  }

  snap(): void {
    if (this.drive.over()) {
      return;
    }
    if (this.phase === 'whistle') {
      this.huddle();
    }
    if (this.phase !== 'presnap') {
      return;
    }
    this.lockMotionSpot();
    this.phase = 'play';
    this.clock = 0;
    this.madden.setPhase('play');
    this.ball.hold(this.qb().rig.rightHand);
    this.setRoutes(false);
  }

  reset(): void {
    this.drive.kickoff();
    this.drive.home = 0;
    this.drive.away = 0;
    this.playIdx = 0;
    this.overFn?.(null);
    this.huddle();
  }

  /** Pre-snap audible. 0–3 indexes PLAYS. */
  selectPlay(i: number): void {
    if (this.phase !== 'presnap' || this.drive.over()) {
      return;
    }
    if (i < 0 || i >= PLAYS.length) {
      return;
    }
    this.playIdx = i;
    this.motionOn = false;
    this.motionIdx = 0;
    this.applyOffense();
    const los = this.drive.losZ;
    for (const id of THROW_ORDER) {
      this.byId.get(id)?.align(los);
    }
    this.rebuildGhosts();
  }

  sendMotion(): void {
    if (this.phase !== 'presnap' || this.drive.over()) {
      return;
    }
    this.motionOn = true;
    this.motionIdx = 0;
  }

  setQbStick(x: number, z: number): void {
    this.stickX = x;
    this.stickZ = z;
  }

  /** Keyboard / list shortcut: throw near that receiver. */
  throwTo(id: string): void {
    if (this.phase !== 'play') {
      return;
    }
    if (this.qb().z > this.drive.losZ + 0.4) {
      return;
    }
    const wr = this.byId.get(id);
    if (!wr?.def.eligible) {
      return;
    }
    const lead = wr.predict(0.58);
    this.throwAt(lead);
  }

  /** Click the grass: the QB throws to that spot. */
  throwAtScreen(cx: number, cy: number): void {
    if (this.phase !== 'play') {
      return;
    }
    if (this.qb().z > this.drive.losZ + 0.4) {
      return;
    }
    const spot = this.groundAt(cx, cy);
    if (spot) {
      this.throwAt(spot);
    }
  }

  previewAim(cx: number, cy: number): void {
    if (this.phase !== 'play') {
      return;
    }
    const spot = this.groundAt(cx, cy);
    if (!spot) {
      return;
    }
    this.aimMark.visible = true;
    this.aimMark.position.set(spot.x, 0.06, spot.z);
  }

  update(dt: number): void {
    const live = this.phase === 'play' || this.phase === 'throw';
    if (live) {
      this.clock += dt;
    }
    this.tickActors(dt, live);
    this.line.update(dt, live, this.qb());
    this.ball.update(dt);
    this.grade();
    if (this.phase === 'play') {
      this.checkSack();
    }
    if (this.phase === 'throw') {
      this.checkPass();
    }
    if (this.phase === 'yac') {
      this.tickYac(dt);
    }
    if (this.phase === 'presnap' && this.motionOn) {
      this.tickMotion(dt);
      this.cover.cover(dt);
    }
    if (this.phase === 'whistle' && !this.drive.over()) {
      this.whistleT += dt;
      if (this.whistleT > 0.95) {
        this.huddle();
      }
    }
    this.followCam(dt, live);
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

  downLine(): string {
    return this.drive.downLine();
  }

  yardsLeft(): number {
    return Math.max(0, Math.round(GOAL_Z - this.drive.losZ));
  }

  /** Receiver the called play is built to throw. */
  beatId(): string {
    const id = PLAYS[this.playIdx].id;
    if (id === 'flood' || id === 'mesh') {
      return 'wrH';
    }
    return 'wrZ';
  }

  readHint(): string {
    const play = PLAYS[this.playIdx].id;
    const c3 = this.look.id === 'c3';
    if (c3 && play === 'smash') {
      return 'CBs bail — hitch is hot';
    }
    if (!c3 && play === 'smash') {
      return 'CBs squat — audible Slants';
    }
    if (!c3 && play === 'slants') {
      return 'Slants vs Cover 2';
    }
    if (c3 && play === 'flood') {
      return 'Flood the corner vs Cover 3';
    }
    if (play === 'mesh') {
      return 'Throw the crossing mesh';
    }
    return `${PLAYS[this.playIdx].name} vs ${this.look.name}`;
  }

  score(): { home: number; away: number } {
    return { home: this.drive.home, away: this.drive.away };
  }

  callSheet(): {
    play: OffPlay;
    playIdx: number;
    cover: string;
    plays: OffPlay[];
    motion: boolean;
    over: 'win' | 'loss' | null;
  } {
    return {
      play: PLAYS[this.playIdx],
      playIdx: this.playIdx,
      cover: this.look.name,
      plays: PLAYS,
      motion: this.motionOn,
      over: this.drive.won ? 'win' : this.drive.lost ? 'loss' : null
    };
  }

  /** Live drive + player spots for in-browser playtests. */
  playtest(): PlaytestSnap {
    const recs = this.eligibles().map((p) => ({
      id: p.def.id,
      x: p.x,
      z: p.z,
      cover: p.cover
    }));
    const coverage = this.players
      .filter((p) => isCoverage(p.def.pos))
      .map((p) => ({ id: p.def.id, x: p.x, z: p.z }));
    return {
      phase: this.phase,
      clock: this.clock,
      down: this.drive.downLine(),
      losZ: this.drive.losZ,
      downN: this.drive.down,
      toGo: this.drive.toGo,
      home: this.drive.home,
      away: this.drive.away,
      stickLos: this.sticks.los.position.z,
      stickFd: this.sticks.fd.position.z,
      aim: this.aim,
      carrier: this.carrier?.def.id ?? null,
      breaker: this.breaker?.def.id ?? null,
      ballInAir: this.ball.inAir,
      coverage,
      recs
    };
  }

  /** Grass world point → client pixels for a real click. */
  clientOf(x: number, z: number): { x: number; y: number } {
    this.camera.updateMatrixWorld();
    const v = new THREE.Vector3(x, 0.06, z);
    v.project(this.camera);
    const rec =
      this.renderer.domElement.getBoundingClientRect();
    return {
      x: rec.left + (v.x * 0.5 + 0.5) * rec.width,
      y: rec.top + (-v.y * 0.5 + 0.5) * rec.height
    };
  }

  statusText(): string {
    switch (this.phase) {
      case 'presnap':
        return this.drive.over()
          ? 'Drive over. RESET from the 10.'
          : '1–4 audible · M motion · SNAP · ZQSD scramble.';
      case 'play':
        return 'Click grass to throw. ZQSD to scramble.';
      case 'throw':
        return 'Ball in the air. Nearest WR breaks to it.';
      case 'yac':
        return 'Catch. He is running after the catch.';
      case 'whistle':
        return 'Play is over. Next snap huddles at the new spot.';
      case 'touchdown':
        return 'TOUCHDOWN. You marched 90 yards. RESET to go again.';
      case 'turnover':
        return 'Turnover on downs. RESET to start on the 10.';
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

  private throwAt(spot: Vec2): void {
    const from = handPos(this.qb());
    const x = clamp(spot.x, -HALF_W + 0.7, HALF_W - 0.7);
    const z = clamp(spot.z, this.drive.losZ - 1.5, 58);
    const to = new THREE.Vector3(x, 1.68, z);
    const time = flightTime(from, to);
    const vel = ballisticVel(from, to, time);
    this.aim = { x, z };
    this.breaker = nearestEligible(this.aim, this.eligibles());
    this.aimMark.visible = true;
    this.aimMark.position.set(x, 0.06, z);
    this.ball.launch(this.scene, from, vel);
    this.qb().lockAnim('throw', 0.46);
    this.phase = 'throw';
    this.madden.setPhase('throw');
  }

  private tickActors(dt: number, live: boolean): void {
    const aim = this.aim;
    const qb = this.qb();
    if (this.phase === 'play' && this.scrambling()) {
      const to = {
        x: qb.x + this.stickX * 5,
        z: qb.z + this.stickZ * 5
      };
      qb.chase(to, dt, 7.4);
      if (qb.z > this.drive.losZ + 1.35) {
        this.startQbRun();
      }
    }
    for (const p of this.players) {
      const line = p.def.pos === 'OL' || p.def.pos === 'DL';
      const db = isCoverage(p.def.pos);
      if (this.phase === 'yac' && this.carrier === p) {
        p.advance(dt, YAC_SPEED);
        continue;
      }
      if (p === qb && this.phase === 'play' && this.scrambling()) {
        continue;
      }
      if (this.phase === 'throw' && p.def.eligible && aim) {
        if (this.shouldBreak(p)) {
          p.chase(aim, dt, 9.35);
          continue;
        }
      }
      if (db && (live || this.phase === 'yac')) {
        continue;
      }
      p.update(dt, live && !line && !db);
    }
    if (this.phase === 'play') {
      this.cover.cover(dt);
    } else if (this.phase === 'throw' && this.aim) {
      this.cover.breakOn(dt, this.aim);
    } else if (this.phase === 'yac' && this.carrier) {
      this.cover.chaseCarrier(dt, this.carrier);
    }
  }

  private shouldBreak(p: PlayerActor): boolean {
    return this.breaker === p;
  }

  private tickYac(dt: number): void {
    const wr = this.carrier;
    if (!wr) {
      return;
    }
    this.yacT += dt;
    wr.x = clamp(wr.x, -HALF_W + 0.35, HALF_W - 0.35);
    if (wr.z >= GOAL_Z) {
      this.endYac();
      return;
    }
    if (Math.abs(wr.x) >= HALF_W - 0.4) {
      this.endYac();
      return;
    }
    if (this.isTackled(wr) || this.yacT >= YAC_TIME) {
      this.endYac();
    }
  }

  private isTackled(wr: PlayerActor): boolean {
    for (const p of this.players) {
      if (!isCoverage(p.def.pos)) {
        continue;
      }
      if (xzDist(wr, p) < TACKLE_RANGE) {
        return true;
      }
    }
    return false;
  }

  private endYac(): void {
    const wr = this.carrier!;
    wr.x = clamp(wr.x, -HALF_W + 0.4, HALF_W - 0.4);
    const r = this.drive.gainTo(wr.z);
    if (r === 'td') {
      this.drive.scoreTd();
      this.finishDrive('TOUCHDOWN', false, 'touchdown');
      return;
    }
    if (r === 'first') {
      this.blow('FIRST DOWN', false);
      return;
    }
    if (r === 'turnover') {
      this.drive.turnover();
      this.finishDrive('TURNOVER ON DOWNS', true, 'turnover');
      return;
    }
    this.blow(this.drive.downLine(), false);
  }

  private huddle(): void {
    if (this.drive.over()) {
      return;
    }
    this.phase = 'presnap';
    this.clock = 0;
    this.yacT = 0;
    this.whistleT = 0;
    this.carrier = null;
    this.breaker = null;
    this.aim = null;
    this.aimMark.visible = false;
    this.motionOn = false;
    this.motionIdx = 0;
    this.look = Math.random() < 0.5 ? COVER3 : COVER2;
    this.cover.setLook(this.look);
    this.applyDefense();
    this.applyOffense();
    const los = this.drive.losZ;
    for (const p of this.players) {
      p.align(los);
    }
    this.line.setLos(los);
    this.line.reset();
    this.cover.setLos(los);
    this.madden.setLos(los);
    this.madden.reset();
    this.sticks.los.position.z = los;
    this.sticks.fd.position.z = this.drive.lineToGain();
    this.rebuildGhosts();
    this.placeBall();
    this.setRoutes(true);
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
        this.ghosts.set(def.id, line);
        this.scene.add(line);
      }
    }
    this.placeBall();
  }

  private placeBall(): void {
    const spot = new THREE.Vector3(0, 0.12, this.drive.losZ);
    this.ball.pin(this.scene, spot);
  }

  private setRoutes(on: boolean): void {
    for (const line of this.ghosts.values()) {
      line.visible = on;
    }
  }

  private qb(): PlayerActor {
    return this.byId.get('qb')!;
  }

  private eligibles(): PlayerActor[] {
    return this.players.filter((p) => p.def.eligible);
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
    const qb = this.qb();
    const ends = [this.byId.get('lde'), this.byId.get('rde')];
    const hit = ends.some(
      (d) => d && xzDist(qb, d) < SACK_RANGE
    );
    if (hit) {
      this.deadSack();
      return;
    }
    if (this.scrambling()) {
      return;
    }
    if (this.clock < 2.85) {
      return;
    }
    if (this.clock >= SACK_TIME) {
      this.deadSack();
    }
  }

  private checkPass(): void {
    const b = this.ball;
    if (Math.abs(b.pos.x) > HALF_W + 0.2) {
      this.deadIncomp('OUT OF BOUNDS');
      return;
    }
    if (!b.inAir) {
      this.deadIncomp('INCOMPLETE');
      return;
    }
    const wr = this.catchWindow();
    if (!wr) {
      return;
    }
    this.resolveCatch(wr);
  }

  private catchWindow(): PlayerActor | null {
    const b = this.ball;
    if (b.pos.y < CATCH_HEIGHT_MIN || b.pos.y > CATCH_HEIGHT_MAX) {
      return null;
    }
    if (this.aim && xzDist(b.pos, this.aim) > 3.4) {
      return null;
    }
    let best: PlayerActor | null = null;
    let dist = CATCH_RADIUS;
    for (const p of this.eligibles()) {
      const n = xzDist(p, b.pos);
      if (n <= dist) {
        dist = n;
        best = p;
      }
    }
    return best;
  }

  private resolveCatch(wr: PlayerActor): void {
    const cover = this.players.filter((p) =>
      isCoverage(p.def.pos)
    );
    const db = closestDefender(this.ball.pos, cover);
    const toDb = db ? xzDist(this.ball.pos, db) : 99;
    const toWr = xzDist(this.ball.pos, wr);
    const sep = db ? xzDist(wr, db) : 99;
    if (toDb + 0.7 < toWr && toDb < 0.8) {
      this.deadIncomp('PICK');
      return;
    }
    if (sep < 0.92) {
      this.deadIncomp('BROKEN UP');
      return;
    }
    this.carrier = wr;
    wr.lockAnim('catch', 0.32);
    this.ball.inAir = false;
    this.ball.hold(wr.rig.rightHand);
    this.phase = 'yac';
    this.yacT = 0;
    this.madden.setPhase('throw');
    this.aimMark.visible = false;
    this.toast?.('COMPLETE', false);
  }

  private deadIncomp(msg: string): void {
    const r = this.drive.incomplete();
    if (r === 'turnover') {
      this.drive.turnover();
      this.finishDrive('TURNOVER ON DOWNS', true, 'turnover');
      return;
    }
    this.blow(msg, true);
  }

  private deadSack(): void {
    const r = this.drive.sackAt(this.qb().z);
    if (r === 'turnover') {
      this.drive.turnover();
      this.finishDrive('TURNOVER ON DOWNS', true, 'turnover');
      return;
    }
    this.blow('SACK', true);
  }

  private finishDrive(
    msg: string,
    bad: boolean,
    phase: Phase
  ): void {
    this.phase = phase;
    this.whistleT = 0;
    this.madden.setPhase('dead');
    this.aimMark.visible = false;
    this.setRoutes(false);
    this.toast?.(msg, bad);
    this.overFn?.(this.drive.won ? 'win' : 'loss');
  }

  private blow(msg: string, bad: boolean): void {
    this.phase = 'whistle';
    this.whistleT = 0;
    this.madden.setPhase('dead');
    this.aimMark.visible = false;
    this.setRoutes(false);
    this.toast?.(msg, bad);
  }

  private followCam(dt: number, live: boolean): void {
    if (this.phase === 'yac' && this.carrier) {
      this.madden.follow(this.carrier.x, this.carrier.z, dt);
      return;
    }
    if (live) {
      const qb = this.qb();
      this.madden.follow(qb.x, qb.z, dt);
    }
  }

  private applyOffense(): void {
    const play = PLAYS[this.playIdx];
    for (const id of THROW_ORDER) {
      const pack = play.skill[id];
      const p = this.byId.get(id);
      if (!p || !pack) {
        continue;
      }
      p.setSkill(pack.start, pack.route, pack.routeName);
    }
  }

  private applyDefense(): void {
    for (const [id, start] of Object.entries(this.look.starts)) {
      this.byId.get(id)?.setStart(start);
    }
  }

  private tickMotion(dt: number): void {
    const play = PLAYS[this.playIdx];
    const wr = this.byId.get(play.motionId);
    const step = play.motion[this.motionIdx];
    if (!wr || !step) {
      this.motionOn = false;
      return;
    }
    const shift = this.drive.losZ - LOS_Z;
    const to = { x: step.x, z: step.z + shift };
    wr.chase(to, dt, step.speed ?? 7.2);
    if (xzDist(wr, to) < 0.55) {
      this.motionIdx += 1;
    }
    if (this.motionIdx >= play.motion.length) {
      this.motionOn = false;
    }
  }

  private lockMotionSpot(): void {
    if (this.motionIdx === 0 && !this.motionOn) {
      return;
    }
    const play = PLAYS[this.playIdx];
    const wr = this.byId.get(play.motionId);
    if (!wr) {
      return;
    }
    const shift = this.drive.losZ - LOS_Z;
    const local = { x: wr.x, z: wr.z - shift };
    const pack = play.skill[play.motionId];
    const rest = pack?.route ?? wr.def.route ?? [];
    wr.setSkill(local, [local, ...rest], pack?.routeName ?? 'Motion');
    this.rebuildGhosts();
  }

  private scrambling(): boolean {
    return Math.abs(this.stickX) + Math.abs(this.stickZ) > 0.2;
  }

  private startQbRun(): void {
    const qb = this.qb();
    this.carrier = qb;
    this.phase = 'yac';
    this.yacT = 0;
    this.ball.hold(qb.rig.rightHand);
    this.madden.setPhase('throw');
    this.toast?.('SCRAMBLE', false);
  }

  private rebuildGhosts(): void {
    const shift = this.drive.losZ - LOS_Z;
    for (const id of THROW_ORDER) {
      const p = this.byId.get(id);
      const old = this.ghosts.get(id);
      if (old) {
        this.scene.remove(old);
        old.geometry.dispose();
      }
      if (!p?.def.route) {
        continue;
      }
      const line = routeGhost(p.def.start, p.def.route);
      line.position.z = shift;
      line.visible = true;
      this.ghosts.set(id, line);
      this.scene.add(line);
    }
  }

  private groundAt(cx: number, cy: number): Vec2 | null {
    this.camera.updateMatrixWorld();
    const rec = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((cx - rec.left) / rec.width) * 2 - 1;
    this.pointer.y = -((cy - rec.top) / rec.height) * 2 + 1;
    this.ray.setFromCamera(this.pointer, this.camera);
    const hits = this.ray.intersectObject(this.sticks.field);
    if (hits[0]) {
      return { x: hits[0].point.x, z: hits[0].point.z };
    }
    if (this.ray.ray.intersectPlane(this.plane, this.hit)) {
      return { x: this.hit.x, z: this.hit.z };
    }
    return null;
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

function flightTime(
  from: THREE.Vector3,
  to: THREE.Vector3
): number {
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  return clamp(dist / THROW_SPEED + 0.02, 0.24, 1.3);
}

function makeAimMark(): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.92, 28),
    new THREE.MeshBasicMaterial({
      color: 0xe8c547,
      transparent: true,
      opacity: 0.88,
      depthWrite: false
    })
  );
  m.rotation.x = -Math.PI / 2;
  m.visible = false;
  return m;
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
