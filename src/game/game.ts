import * as THREE from 'three';
import { ballisticVel, Football } from './ball';
import { MaddenCamera } from './camera';
import {
  COLORS,
  GOAL_Z,
  HALF_W,
  LOS_Z,
  SACK_RANGE,
  SACK_TIME
} from './constants';
import {
  COVER3,
  lookStarts,
  pickLook,
  type CoverLook
} from './coverage-looks';
import { CoverPlay, isCoverage, nearestEligible } from './coverage-play';
import { Drive } from './drive';
import { buildWorld, type FieldSticks } from './field';
import type { HudRow } from './hud';
import { isPassRusher, LinePlay, passRushers } from './line-play';
import { makeTeamMats } from './materials';
import { clamp, xzDist } from './math';
import { PassFlight } from './pass-flight';
import { beatId, readHint } from './play-hints';
import { SMASH, THROW_ORDER } from './playbook';
import { PLAYS, type OffPlay } from './plays';
import { handPos, PlayerActor } from './players';
import { advancePoseClock } from './pose-blend';
import { QbEyes } from './qb-eyes';
import { gradeReceiver } from './receiver-grade';
import {
  addLights,
  AimMark,
  makeRenderer,
  RouteGhosts
} from './scene-kit';
import {
  chargePower,
  flightTime,
  makeShot,
  overHold,
  pressureFrom,
  spreadFor,
  TAP_POWER,
  type ThrowSituation,
  type ThrowTarget
} from './throwing';
import type { CoverGrade, Phase, Vec2 } from './types';
import { YacRun, type JukeResult, type JukeState } from './yac';

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
  lastTackler: string | null;
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
  private readonly aimMark: AimMark;
  private readonly ghosts: RouteGhosts;
  private readonly yac: YacRun;
  private readonly flight = new PassFlight();
  private flightPeak = 0;
  private whistleT = 0;
  private playIdx = 0;
  private look: CoverLook = COVER3;
  private readonly eyes = new QbEyes();
  private motionOn = false;
  private motionIdx = 0;
  private stickX = 0;
  private stickZ = 0;
  private charge: { target: ThrowTarget; t: number } | null = null;
  private turnoverText = '';
  private toast?: (msg: string, bad: boolean) => void;
  private overFn?: (over: 'win' | 'loss' | null) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
    this.renderer = makeRenderer(canvas);
    this.madden = new MaddenCamera(this.camera, canvas);
    this.madden.attach();
    this.scene.background = new THREE.Color(COLORS.sky);
    this.scene.fog = new THREE.Fog(COLORS.fog, 70, 210);
    addLights(this.scene);
    this.sticks = buildWorld(this.scene);
    this.aimMark = new AimMark(this.scene);
    this.ghosts = new RouteGhosts(this.scene);
    this.spawn();
    this.yac = new YacRun(this.players, (m, b) => this.toast?.(m, b));
    this.line = new LinePlay(this.byId);
    this.cover = new CoverPlay(this.byId, this.eyes);
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
    this.eyes.reset();
    this.cover.startSnap(PLAYS[this.playIdx].pa ?? false);
  }

  reset(): void {
    this.drive.kickoff();
    this.drive.home = 0;
    this.drive.away = 0;
    this.playIdx = 0;
    this.yac.forget();
    this.flightPeak = 0;
    this.turnoverText = '';
    this.overFn?.(null);
    this.huddle();
  }

  /** Pre-snap audible. Indexes PLAYS (keys 1–9, 0). */
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
    this.applyDefense();
    const los = this.drive.losZ;
    for (const p of this.players) {
      if (p.def.eligible || this.cover.jobOf(p.def.id)?.kind === 'man') {
        p.align(los);
      }
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
    if (this.phase === 'yac') {
      this.yac.requestJuke(direction);
    }
  }

  controlsQbRun(): boolean {
    return this.phase === 'yac' && this.yac.carrier === this.qb();
  }

  /** HUD row click: instant touch pass to that receiver. */
  throwTo(id: string): void {
    if (!this.canThrow()) {
      return;
    }
    const wr = this.byId.get(id);
    if (!wr?.def.eligible) {
      return;
    }
    this.charge = null;
    this.throwAt(this.leadReceiver(wr, TAP_POWER), TAP_POWER, 0);
  }

  /** Instant touch pass to a grass spot. */
  throwAtScreen(cx: number, cy: number): void {
    if (!this.canThrow()) {
      return;
    }
    const spot = this.groundAt(cx, cy);
    if (spot) {
      this.charge = null;
      this.throwAt(spot, TAP_POWER, 0);
    }
  }

  /** Press on the grass: start winding up toward that spot. */
  beginChargeAtScreen(cx: number, cy: number): void {
    if (!this.canThrow() || this.charge) {
      return;
    }
    const spot = this.groundAt(cx, cy);
    if (spot) {
      this.charge = { target: { kind: 'spot', spot }, t: 0 };
    }
  }

  /** Hold a receiver key: wind up a pass led to him. */
  beginChargeOn(id: string): void {
    if (!this.canThrow() || this.charge) {
      return;
    }
    if (!this.byId.get(id)?.def.eligible) {
      return;
    }
    this.charge = { target: { kind: 'wr', id }, t: 0 };
  }

  /** Release: power comes from how long it was held. */
  releaseCharge(): void {
    const charge = this.charge;
    this.charge = null;
    if (!charge || !this.canThrow()) {
      return;
    }
    const power = chargePower(charge.t);
    const spot = this.chargeSpot(charge.target, power);
    if (spot) {
      this.throwAt(spot, power, overHold(charge.t));
    }
  }

  cancelCharge(): void {
    this.charge = null;
  }

  /** Receiver key released for a different receiver, etc. */
  chargingOn(): string | null {
    const target = this.charge?.target;
    return target?.kind === 'wr' ? target.id : null;
  }

  /** Meter readout while the pass is wound up. */
  chargeInfo(): {
    power: number;
    spread: number;
    pressure: number;
    over: boolean;
  } | null {
    const charge = this.charge;
    if (!charge || this.phase !== 'play') {
      return null;
    }
    const power = chargePower(charge.t);
    const spot = this.chargeSpot(charge.target, power);
    if (!spot) {
      return null;
    }
    const s = this.situation(spot, power, overHold(charge.t));
    return {
      power,
      spread: spreadFor(s),
      pressure: s.pressure,
      over: s.overHold > 0
    };
  }

  previewAim(cx: number, cy: number): void {
    if (this.phase !== 'play') {
      return;
    }
    const spot = this.groundAt(cx, cy);
    if (!spot) {
      return;
    }
    if (this.charge?.target.kind === 'spot') {
      this.charge.target.spot = spot;
    }
    this.eyes.look(spot);
    this.aimMark.place(spot);
  }

  update(dt: number): void {
    advancePoseClock(dt);
    const live = this.phase === 'play' || this.phase === 'throw';
    if (live) {
      this.clock += dt;
    }
    this.tickCharge(dt);
    this.tickActors(dt, live);
    this.line.update(dt, live, this.qb());
    if (this.phase === 'play') {
      this.tickEyes(dt);
    }
    this.ball.update(dt);
    if (this.ball.inAir) {
      this.flightPeak = Math.max(this.flightPeak, this.ball.pos.y);
    }
    this.grade();
    if (this.phase === 'play') {
      this.checkSack();
    }
    if (this.phase === 'throw') {
      this.checkPass(dt);
    }
    if (this.phase === 'yac' && this.yac.tick(dt, this.qb())) {
      this.endYac();
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
    this.madden.update(dt);
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
    return beatId(PLAYS[this.playIdx]);
  }

  readHint(): string {
    return readHint(PLAYS[this.playIdx], this.look);
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
      aim: this.flight.aim,
      carrier: this.yac.carrier?.def.id ?? null,
      breaker: this.flight.breaker?.def.id ?? null,
      front: this.yac.front?.def.id ?? null,
      tackler: this.yac.tackler?.def.id ?? null,
      lastTackler: this.yac.lastTacklerId,
      jukeState: this.yac.state,
      jukeResult: this.yac.lastJuke,
      carrierDown: this.yac.isDown(),
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
          : '1–0 audible · M motion · SNAP · ZQSD scramble.';
      case 'play':
        return 'Hold on grass or 1–5, release to throw. Longer = harder.';
      case 'throw':
        return 'Ball in the air. Nearest WR breaks to it.';
      case 'yac':
        return this.yacStatus();
      case 'whistle':
        return 'Play is over. Next snap huddles at the new spot.';
      case 'touchdown':
        return 'TOUCHDOWN. You marched 90 yards. RESET to go again.';
      case 'turnover':
        return `${this.turnoverText || 'Turnover on downs'}. RESET to start on the 10.`;
      default:
        return '';
    }
  }

  private yacStatus(): string {
    if (this.controlsQbRun()) {
      return 'ZQSD/WASD controls the QB all the way to the goal line.';
    }
    return this.yac.status();
  }

  pocketLeft(): number {
    if (this.phase !== 'play') {
      return 0;
    }
    return Math.max(0, SACK_TIME - this.clock);
  }

  /**
   * The QB's eyes: cursor hover, or the receiver he is winding
   * up on. Play-action turns him to the RB for the fake first.
   */
  private tickEyes(dt: number): void {
    const winding = this.chargingOn();
    const wr = winding ? this.byId.get(winding) : undefined;
    if (wr) {
      this.eyes.look(wr);
    }
    const rb = this.byId.get('rb');
    const fake = PLAYS[this.playIdx].pa && this.clock < 0.6 && rb
      ? { x: rb.x, z: rb.z }
      : null;
    this.eyes.tick(
      dt,
      this.eligibles(),
      this.qb(),
      !this.scrambling(),
      fake
    );
  }

  private canThrow(): boolean {
    return this.phase === 'play' &&
      this.qb().z <= this.drive.losZ + 0.4;
  }

  private tickCharge(dt: number): void {
    if (!this.charge) {
      return;
    }
    if (this.phase !== 'play') {
      this.charge = null;
      return;
    }
    this.charge.t += dt;
    const power = chargePower(this.charge.t);
    const spot = this.chargeSpot(this.charge.target, power);
    if (!spot) {
      return;
    }
    const s = this.situation(spot, power, overHold(this.charge.t));
    const ring = Math.max(0.55, spreadFor(s) / 0.92);
    this.aimMark.place(spot);
    this.aimMark.style(ring, s.overHold > 0);
  }

  private chargeSpot(target: ThrowTarget, power: number): Vec2 | null {
    if (target.kind === 'spot') {
      return target.spot;
    }
    const wr = this.byId.get(target.id);
    return wr ? this.leadReceiver(wr, power) : null;
  }

  private situation(
    target: Vec2,
    power: number,
    over: number
  ): ThrowSituation {
    const qb = this.qb();
    return {
      from: { x: qb.x, z: qb.z },
      target,
      power,
      pressure: this.pressure(),
      moving: clamp(Math.hypot(this.stickX, this.stickZ), 0, 1),
      overHold: over
    };
  }

  /** How close the nearest rusher is to the QB (0..1). */
  private pressure(): number {
    const qb = this.qb();
    let near = 99;
    for (const p of this.players) {
      if (p.def.side !== 'defense') {
        continue;
      }
      if (p.def.pos !== 'DL' && !isPassRusher(p.def.id)) {
        continue;
      }
      near = Math.min(near, xzDist(qb, p));
    }
    return pressureFrom(near);
  }

  private throwAt(spot: Vec2, power: number, over: number): void {
    const from = handPos(this.qb());
    const shot = makeShot(this.situation(spot, power, over));
    const x = clamp(shot.landing.x, -HALF_W - 3, HALF_W + 3);
    const z = clamp(shot.landing.z, this.drive.losZ - 1.5, 62);
    shot.landing = { x, z };
    const to = new THREE.Vector3(x, 1.68, z);
    const time = flightTime(from, to, power);
    const vel = ballisticVel(from, to, time);
    const breaker = nearestEligible(shot.intended, this.eligibles());
    this.flight.launch(shot, { x: from.x, z: from.z }, breaker);
    this.cover.onThrow(breaker?.def.id ?? null);
    this.aimMark.place(shot.intended);
    this.aimMark.style(1, false);
    this.ball.launch(this.scene, from, vel);
    this.flightPeak = from.y;
    this.qb().lockAnim('throw', 0.46);
    this.phase = 'throw';
    this.madden.setPhase('throw');
  }

  private leadReceiver(wr: PlayerActor, power: number): Vec2 {
    const from = handPos(this.qb());
    let lead = wr.predict(0.6);
    for (let i = 0; i < 3; i += 1) {
      lead = wr.predict(flightTime(from, lead, power));
    }
    return lead;
  }

  private tickActors(dt: number, live: boolean): void {
    const qb = this.qb();
    const carrier = this.yac.carrier;
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
      if (this.phase === 'yac' && carrier === p) {
        this.yac.move(dt, qb, { x: this.stickX, z: this.stickZ });
        continue;
      }
      if (this.phase === 'yac' && this.yac.tackler === p) {
        this.yac.poseTackler();
        continue;
      }
      if (p === qb && this.phase === 'play' && this.scrambling()) {
        continue;
      }
      if (this.phase === 'throw' && this.flight.breaker === p) {
        // Break on the called spot, then track the real ball.
        const run = this.flight.breakTarget();
        if (run) {
          const ball = { x: this.ball.pos.x, z: this.ball.pos.z };
          p.meet(run.to, dt, run.speed, ball, 'catch');
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
    } else if (this.phase === 'throw' && this.flight.aim) {
      this.cover.breakOn(dt, this.flight.aim);
    } else if (this.phase === 'yac' && carrier && !this.yac.tackler) {
      this.cover.chaseCarrier(dt, carrier);
    }
  }

  private endYac(): void {
    const wr = this.yac.carrier!;
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
    this.whistleT = 0;
    this.yac.clear();
    this.flight.clear();
    this.aimMark.hide();
    this.aimMark.style(1, false);
    this.charge = null;
    this.motionOn = false;
    this.motionIdx = 0;
    this.look = pickLook();
    this.cover.setLook(this.look);
    this.line.setPackage(this.look.rush, this.look.spy ?? true);
    this.applyOffense();
    this.applyDefense();
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
    }
    this.placeBall();
  }

  private placeBall(): void {
    const spot = new THREE.Vector3(0, 0.12, this.drive.losZ);
    this.ball.pin(this.scene, spot);
  }

  private setRoutes(on: boolean): void {
    this.ghosts.setVisible(on);
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
    const ends = passRushers().map((id) => this.byId.get(id));
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

  private checkPass(dt: number): void {
    const r = this.flight.tick(
      dt,
      this.ball,
      this.eligibles(),
      this.players,
      this.qb()
    );
    switch (r.kind) {
      case 'incomplete':
        this.deadIncomp(r.msg);
        return;
      case 'tipped':
        this.aimMark.hide();
        this.toast?.(r.msg, true);
        return;
      case 'pick':
        this.intercept(r.db);
        return;
      case 'catch':
        this.resolveCatch(r.wr);
        return;
      default:
        return;
    }
  }

  private intercept(db: PlayerActor): void {
    db.lockAnim('catch', 0.5);
    this.ball.inAir = false;
    this.ball.hold(db.rig.rightHand);
    this.aimMark.hide();
    this.drive.turnover();
    this.turnoverText = 'Intercepted';
    this.finishDrive(
      `INTERCEPTED · #${db.def.number}`,
      true,
      'turnover'
    );
  }

  private resolveCatch(wr: PlayerActor): void {
    this.yac.start(wr);
    wr.lockAnim('catch', 0.32);
    this.ball.inAir = false;
    this.ball.hold(wr.rig.rightHand);
    this.phase = 'yac';
    this.madden.setPhase('throw');
    this.aimMark.hide();
    this.toast?.('COMPLETE', false);
  }

  private deadIncomp(msg: string): void {
    const r = this.drive.incomplete();
    if (r === 'turnover') {
      this.drive.turnover();
      this.turnoverText = 'Turnover on downs';
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
    this.aimMark.hide();
    this.setRoutes(false);
    this.toast?.(msg, bad);
    this.overFn?.(this.drive.won ? 'win' : 'loss');
  }

  private blow(msg: string, bad: boolean): void {
    this.phase = 'whistle';
    this.whistleT = 0;
    this.madden.setPhase('dead');
    this.aimMark.hide();
    this.setRoutes(false);
    this.toast?.(msg, bad);
  }

  private followCam(dt: number, live: boolean): void {
    const carrier = this.yac.carrier;
    this.madden.setPunch(this.phase === 'yac' && this.yac.isDown());
    if (this.phase === 'yac' && carrier) {
      this.madden.follow(carrier.x, carrier.z, dt);
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
    const starts = lookStarts(this.look, PLAYS[this.playIdx]);
    for (const [id, start] of Object.entries(starts)) {
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
    this.yac.startScramble(qb);
    this.phase = 'yac';
    this.ball.hold(qb.rig.rightHand);
    this.madden.setPhase('throw');
    this.toast?.('SCRAMBLE', false);
  }

  private rebuildGhosts(): void {
    const receivers = THROW_ORDER
      .map((id) => this.byId.get(id))
      .filter((p): p is PlayerActor => Boolean(p));
    this.ghosts.rebuild(receivers, this.drive.losZ - LOS_Z);
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

