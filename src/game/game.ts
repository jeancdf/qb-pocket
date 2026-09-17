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
  JUKE_CHANCE,
  JUKE_RANGE,
  JUKE_TIME,
  LOS_Z,
  SACK_RANGE,
  SACK_TIME,
  TACKLE_RANGE,
  TACKLE_SETTLE_TIME,
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
  type CoverLook,
  type PursuitContext
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

type JukeState =
  | 'none'
  | 'approach'
  | 'cut'
  | 'escaped'
  | 'stuffed'
  | 'down';

type JukeResult = 'won' | 'stuffed' | null;

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
  front: string | null;
  tackler: string | null;
  jukeState: JukeState;
  jukeResult: JukeResult;
  carrierDown: boolean;
  ballInAir: boolean;
  ballSpeed: number;
  ballHeight: number;
  flightPeak: number;
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
  private jukeT = 0;
  private tackleT = 0;
  private frontMissT = 0;
  private jukeState: JukeState = 'none';
  private lastJuke: JukeResult = null;
  private frontDefender: PlayerActor | null = null;
  private tackler: PlayerActor | null = null;
  private jukeTarget: Vec2 | null = null;
  private requestedJuke = 0;
  private flightPeak = 0;
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

  /** Let the player call a left or right cut during YAC. */
  requestJuke(direction: number): void {
    if (this.phase !== 'yac' || this.jukeState !== 'approach') {
      return;
    }
    this.requestedJuke = direction < 0 ? -1 : 1;
    const front = this.frontDefender;
    if (front && this.carrier && this.yacT >= 0.32 &&
        xzDist(front, this.carrier) < JUKE_RANGE + 1.2) {
      this.beginJuke(this.carrier);
    }
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
    this.throwAt(this.leadReceiver(wr));
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
    if (this.ball.inAir) {
      this.flightPeak = Math.max(this.flightPeak, this.ball.pos.y);
    }
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
      front: this.frontDefender?.def.id ?? null,
      tackler: this.tackler?.def.id ?? null,
      jukeState: this.jukeState,
      jukeResult: this.lastJuke,
      carrierDown: this.carrier?.isDown() ?? false,
      ballInAir: this.ball.inAir,
      ballSpeed: this.ball.vel.length(),
      ballHeight: this.ball.pos.y,
      flightPeak: this.flightPeak,
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
        return this.yacStatus();
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

  private yacStatus(): string {
    switch (this.jukeState) {
      case 'approach':
        return 'Defender ahead slows YAC. A/Q or D calls the cut.';
      case 'cut':
        return 'Juke in progress — the outcome is not guaranteed.';
      case 'escaped':
        return 'Juke won. Trailing pursuit still has closing speed.';
      case 'stuffed':
        return 'Juke stuffed. Fight through contact and pursuit.';
      case 'down':
        return 'Tackled. The carrier is physically going to ground.';
      default:
        return 'Catch. Turn upfield before pursuit closes.';
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
    this.flightPeak = from.y;
    this.qb().lockAnim('throw', 0.46);
    this.phase = 'throw';
    this.madden.setPhase('throw');
  }

  private leadReceiver(wr: PlayerActor): Vec2 {
    const from = handPos(this.qb());
    let lead = wr.predict(0.68);
    for (let i = 0; i < 2; i += 1) {
      const to = new THREE.Vector3(lead.x, 1.68, lead.z);
      lead = wr.predict(flightTime(from, to) * 0.9);
    }
    return lead;
  }

  private tickActors(dt: number, live: boolean): void {
    const aim = this.aim;
    const qb = this.qb();
    if (this.phase === 'play' && this.scrambling()) {
      const to = {
        x: qb.x + this.stickX * 5,
        z: qb.z + this.stickZ * 5
      };
      qb.chase(to, dt, 6.35);
      if (qb.z > this.drive.losZ + 1.35) {
        this.startQbRun();
      }
    }
    for (const p of this.players) {
      const line = p.def.pos === 'OL' || p.def.pos === 'DL';
      const db = isCoverage(p.def.pos);
      if (this.phase === 'yac' && this.carrier === p) {
        this.moveCarrier(p, dt);
        continue;
      }
      if (this.phase === 'yac' && this.tackler === p) {
        this.poseTackler(p);
        continue;
      }
      if (p === qb && this.phase === 'play' && this.scrambling()) {
        continue;
      }
      if (this.phase === 'throw' && p.def.eligible && aim) {
        if (this.shouldBreak(p)) {
          p.chase(aim, dt, 7.65);
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
      this.cover.chaseCarrier(
        dt,
        this.carrier,
        this.pursuitContext()
      );
    }
  }

  private shouldBreak(p: PlayerActor): boolean {
    return this.breaker === p;
  }

  private moveCarrier(wr: PlayerActor, dt: number): void {
    if (wr.isDown()) {
      wr.updateRagdoll(dt);
      return;
    }
    if (this.jukeState === 'cut' && this.jukeTarget) {
      wr.chase(this.jukeTarget, dt, this.carrierSpeed(wr));
      return;
    }
    wr.advance(dt, this.carrierSpeed(wr));
  }

  private carrierSpeed(wr: PlayerActor): number {
    if (this.jukeState === 'cut') {
      return this.lastJuke === 'won' ? 5.85 : 4.35;
    }
    if (this.jukeState === 'stuffed') {
      return this.jukeT < 0.9 ? 4.65 : 6.35;
    }
    if (this.jukeState === 'escaped' && this.jukeT < 0.45) {
      return 6.25;
    }
    const front = this.frontDefender;
    if (this.jukeState !== 'approach' || !front) {
      return YAC_SPEED;
    }
    const distance = xzDist(wr, front);
    const factor = clamp(0.62 + distance * 0.065, 0.68, 1);
    return YAC_SPEED * factor;
  }

  private poseTackler(tackler: PlayerActor): void {
    const carrier = this.carrier;
    if (!carrier) {
      return;
    }
    tackler.facePoint(carrier);
    const progress = clamp(this.tackleT / 0.62, 0, 1);
    tackler.setAnim('tackle', progress, 0);
    tackler.place();
  }

  private pursuitContext(): PursuitContext {
    return {
      frontId: this.frontDefender?.def.id ?? null,
      frontMissed: this.frontMissT > 0,
      jukeActive: this.jukeState === 'cut',
      tackleActive: this.tackler !== null
    };
  }

  private updateJuke(wr: PlayerActor): void {
    const front = this.frontDefender;
    if (this.jukeState === 'approach' && !front) {
      this.jukeState = 'none';
      return;
    }
    if (this.jukeState === 'approach' && front &&
        this.yacT >= 0.38 &&
        xzDist(wr, front) <= JUKE_RANGE) {
      this.beginJuke(wr);
      return;
    }
    if (this.jukeState !== 'cut' || this.jukeT < JUKE_TIME) {
      return;
    }
    const won = this.lastJuke === 'won';
    this.jukeState = won ? 'escaped' : 'stuffed';
    this.jukeT = 0;
    this.frontMissT = won ? 1.05 : 0.3;
    if (won) {
      front?.lockAnim('stumble', 0.78);
    }
    this.toast?.(won ? 'JUKE WON' : 'JUKE STUFFED', !won);
  }

  private beginJuke(wr: PlayerActor): void {
    if (this.jukeState !== 'approach') {
      return;
    }
    const direction = this.jukeDirection(wr);
    const won = Math.random() < JUKE_CHANCE;
    const width = won ? 2.75 : 1.05;
    const gain = won ? 2.55 : 1.25;
    this.lastJuke = won ? 'won' : 'stuffed';
    this.jukeState = 'cut';
    this.jukeT = 0;
    this.jukeTarget = {
      x: clamp(
        wr.x + direction * width,
        -HALF_W + 0.8,
        HALF_W - 0.8
      ),
      z: wr.z + gain
    };
    wr.lockAnim('juke', JUKE_TIME);
  }

  private jukeDirection(wr: PlayerActor): number {
    if (this.requestedJuke !== 0) {
      return this.requestedJuke;
    }
    const front = this.frontDefender;
    if (front && Math.abs(front.x - wr.x) > 0.2) {
      return front.x > wr.x ? -1 : 1;
    }
    return wr.x > 0 ? -1 : 1;
  }

  private startTackle(
    wr: PlayerActor,
    tackler: PlayerActor
  ): void {
    this.tackler = tackler;
    this.tackleT = 0;
    this.jukeState = 'down';
    this.frontMissT = 0;
    wr.startRagdoll(tackler);
    tackler.facePoint(wr);
    tackler.lockAnim('tackle', 0.72);
    this.toast?.(`TACKLED · #${tackler.def.number}`, true);
  }

  private tickYac(dt: number): void {
    const wr = this.carrier;
    if (!wr) {
      return;
    }
    this.yacT += dt;
    this.jukeT += dt;
    this.frontMissT = Math.max(0, this.frontMissT - dt);
    if (wr.isDown()) {
      this.tackleT += dt;
      if (this.tackleT >= TACKLE_SETTLE_TIME) {
        this.endYac();
      }
      return;
    }
    this.updateJuke(wr);
    wr.x = clamp(wr.x, -HALF_W + 0.35, HALF_W - 0.35);
    if (wr.z >= GOAL_Z) {
      this.endYac();
      return;
    }
    if (Math.abs(wr.x) >= HALF_W - 0.4) {
      this.endYac();
      return;
    }
    const tackler = this.findTackler(wr);
    if (tackler) {
      this.startTackle(wr, tackler);
      return;
    }
    if (this.yacT >= YAC_TIME) {
      this.endYac();
    }
  }

  private findTackler(wr: PlayerActor): PlayerActor | null {
    const catchBalance = this.jukeState === 'approach' &&
      this.yacT < 0.38;
    if (this.jukeState === 'cut' || catchBalance) {
      return null;
    }
    let tackler: PlayerActor | null = null;
    let distance = TACKLE_RANGE;
    for (const p of this.players) {
      if (!isCoverage(p.def.pos)) {
        continue;
      }
      const frontMiss = p === this.frontDefender &&
        this.frontMissT > 0;
      const next = xzDist(wr, p);
      if (!frontMiss && next < distance) {
        tackler = p;
        distance = next;
      }
    }
    return tackler;
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
    this.jukeT = 0;
    this.tackleT = 0;
    this.frontMissT = 0;
    this.jukeState = 'none';
    this.lastJuke = null;
    this.frontDefender = null;
    this.tackler = null;
    this.jukeTarget = null;
    this.requestedJuke = 0;
    this.flightPeak = 0;
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
    this.prepareYac(wr);
    wr.lockAnim('catch', 0.32);
    this.ball.inAir = false;
    this.ball.hold(wr.rig.rightHand);
    this.phase = 'yac';
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
    wr.chase(to, dt, step.speed ?? 6.3);
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
    this.prepareYac(qb);
    this.phase = 'yac';
    this.ball.hold(qb.rig.rightHand);
    this.madden.setPhase('throw');
    this.toast?.('SCRAMBLE', false);
  }

  private prepareYac(carrier: PlayerActor): void {
    this.carrier = carrier;
    this.frontDefender = this.pickFrontDefender(carrier);
    this.jukeState = this.frontDefender ? 'approach' : 'none';
    this.lastJuke = null;
    this.tackler = null;
    this.jukeTarget = null;
    this.requestedJuke = 0;
    this.yacT = 0;
    this.jukeT = 0;
    this.tackleT = 0;
    this.frontMissT = 0;
  }

  private pickFrontDefender(
    carrier: PlayerActor
  ): PlayerActor | null {
    let best: PlayerActor | null = null;
    let score = 99;
    for (const defender of this.players) {
      if (!isCoverage(defender.def.pos)) {
        continue;
      }
      if (defender.z < carrier.z - 1.2) {
        continue;
      }
      const angleCost = Math.abs(defender.x - carrier.x) * 0.18;
      const next = xzDist(carrier, defender) + angleCost;
      if (next < score) {
        best = defender;
        score = next;
      }
    }
    return best;
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
  return clamp(dist / THROW_SPEED + 0.18, 0.52, 1.72);
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
