import * as THREE from 'three';
import { ballisticVel, Football } from './ball';
import { MaddenCamera } from './camera';
import {
  COLORS,
  GOAL_Z,
  HALF_W,
  LOS_Z,
  SACK_RANGE
} from './constants';
import {
  COVER3,
  lookStarts,
  pickLook,
  type CoverLook
} from './coverage-looks';
import { CoverPlay, isCoverage, nearestEligible } from './coverage-play';
import {
  callPlay,
  cpuAccuracy,
  CpuQb,
  CpuRunner,
  powerFor,
  throwMargin
} from './cpu-offense';
import { DEF_CALLS, DefenseControl } from './defense-control';
import { separatePlayers } from './collisions';
import { Drive } from './drive';
import type { BreakCard, DriveEnd, PlayEnd } from './match';
import { MatchFlow, type MatchOptions } from './match-flow';
import { GetOpen } from './get-open';
import { buildWorld, type FieldSticks } from './field';
import type { CallItem, HudRow } from './hud';
import { isPassRusher, LinePlay, passRushers } from './line-play';
import { makeTeamMats, wearKits, type TeamMats } from './materials';
import { clamp, xzDist } from './math';
import { PassFlight } from './pass-flight';
import { beatId, readHint } from './play-hints';
import { SMASH, THROW_ORDER } from './playbook';
import { PLAYS } from './plays';
import { handPos, PlayerActor } from './players';
import { animateCrowd } from './body-language';
import { SprintMeter } from './sprint';
import { advancePoseClock } from './pose-blend';
import {
  cpuPunts,
  planPunt,
  PUNT_KICK_T,
  puntEndZ,
  PUNTER_DEPTH,
  type PuntPlan
} from './punt';
import {
  FIELD_HEIGHT,
  FIELD_RANGE,
  PuntReturn,
  RETURNER_DEPTH,
  type ReturnEnd
} from './punt-return';
import { QbEyes } from './qb-eyes';
import { handoffReady, QB_START, qbPath } from './run-play';
import { fitRoute } from './route-bounds';
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
import type { CoverGrade, Phase, Side, Vec2 } from './types';
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
  private readonly open = new GetOpen();
  private readonly flight = new PassFlight();
  private flightPeak = 0;
  private whistleT = 0;
  private playIdx = 0;
  private look: CoverLook = COVER3;
  private readonly eyes = new QbEyes();
  private motionOn = false;
  private motionIdx = 0;
  private stickX = 0;
  private sprint = false;
  /** Sprint freshness of the runner the player controls. */
  private readonly stamina = new SprintMeter();
  private stickZ = 0;
  private charge: { target: ThrowTarget; t: number } | null = null;
  private turnoverText = '';
  private toast?: (msg: string, bad: boolean) => void;
  private flow: MatchFlow | null = null;
  private mats!: Record<Side, TeamMats>;
  /** The player is the defense this possession (CPU has the ball). */
  private defending = false;
  private readonly defense = new DefenseControl();
  private readonly cpuQb = new CpuQb(0.5);
  private readonly cpuRun = new CpuRunner(0.5);
  private skill = 0.5;
  /** This snap is a punt (P on 4th down, or the CPU's call). */
  private punting = false;
  private punt: PuntPlan | null = null;
  private puntT = 0;
  private kicked = false;
  private readonly puntRet = new PuntReturn();
  /** Where the returner fielded it (world z). */
  private fieldZ = 0;
  private menuFn?: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
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
    this.yac = new YacRun(this.players, (m, b) => this.say(m, b));
    this.line = new LinePlay(this.byId);
    this.cover = new CoverPlay(this.byId, this.eyes);
    this.huddle();
    this.resize();
  }

  onToast(fn: (msg: string, bad: boolean) => void): void {
    this.toast = fn;
  }

  /** Match over and the player pressed on: back to the title. */
  onMenu(fn: () => void): void {
    this.menuFn = fn;
  }

  /** LANCER: the single practice drive from the 10. */
  startPractice(): void {
    this.flow = null;
    this.setSkill(0.5);
    this.reset();
  }

  private setSkill(skill: number): void {
    this.skill = skill;
    this.cpuQb.setSkill(skill);
    this.cpuRun.setSkill(skill);
  }

  /** A banner outside a play (match intro). */
  toastNow(msg: string): void {
    this.toast?.(msg, false);
  }

  /** Scorebug names: the player's team and the CPU's. */
  teamTags(): { home: string; away: string } {
    return { home: 'HOME', away: this.flow?.opts.awayTag ?? 'AWAY' };
  }

  /** MATCH: four quarters against a CPU team (`skill` 0..1). */
  startMatch(skill: number, opts: MatchOptions = {}): void {
    this.flow = new MatchFlow(skill, opts);
    this.setSkill(skill);
    this.newDrive(this.flow.match.startZ);
  }

  /** Always-on help while defending: who you control and the keys. */
  defenseChip(): string | null {
    if (!this.defending || this.drive.over()) {
      return null;
    }
    const who = this.defense.label();
    return `Tu joues ${who} (flèche dorée) · ZQSD bouger · Shift sprint · Tab / C changer de joueur`;
  }

  /** On defense this possession (the CPU has the ball). */
  isDefending(): boolean {
    return this.defending;
  }

  /** Tab: take the defender nearest the ball. */
  switchPlayer(): void {
    if (!this.defending || this.phase === 'return' || this.punting) {
      return;
    }
    const ball = this.yac.carrier ??
      this.flight.aim ??
      { x: this.ball.pos.x, z: this.ball.pos.z };
    this.defense.switchNear(ball, this.controllable());
    this.cover.setUser(this.defense.user?.def.id ?? null);
  }

  /** P on 4th down in a match: line up to punt. */
  callPunt(): void {
    if (this.phase !== 'presnap' || !this.flow || this.defending ||
        this.drive.over() || this.drive.down !== 4) {
      return;
    }
    this.punting = !this.punting;
    this.alignPunter();
  }

  isPunting(): boolean {
    return this.punting;
  }

  /** V: cycle through the run plays. */
  nextRun(): void {
    if (this.defending) {
      return;
    }
    const runs = PLAYS.map((p, i) => (p.run ? i : -1)).filter((i) => i >= 0);
    const at = runs.indexOf(this.playIdx);
    this.selectPlay(runs[(at + 1) % runs.length]);
  }

  inMatch(): boolean {
    return this.flow !== null;
  }

  /** SNAP is live: a snap, or pressing on from a break card. */
  canSnap(): boolean {
    if (this.drive.over()) {
      return this.flow !== null;
    }
    return this.phase === 'presnap' || this.phase === 'whistle';
  }

  snap(): void {
    if (this.drive.over()) {
      this.pressOn();
      return;
    }
    if (this.phase === 'whistle') {
      this.huddle();
    }
    if (this.phase !== 'presnap') {
      return;
    }
    if (this.punting) {
      this.snapPunt();
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
    if (this.defending) {
      const first = this.beatId();
      this.cpuQb.reset([first, ...THROW_ORDER.filter((id) => id !== first)]);
      this.cpuRun.reset();
    }
  }

  reset(): void {
    if (this.flow) {
      return;
    }
    this.drive.kickoff();
    this.drive.home = 0;
    this.drive.away = 0;
    this.newDrive(this.drive.losZ);
  }

  private newDrive(losZ: number): void {
    const away = this.flow?.match.offense === 'away';
    this.setSide(away ? 'defense' : 'offense');
    this.drive.startAt(losZ);
    this.playIdx = 0;
    this.yac.forget();
    this.flightPeak = 0;
    this.turnoverText = '';
    this.huddle();
  }

  private setSide(side: Side): void {
    this.defending = side === 'defense';
    wearKits(this.mats, side);
    this.madden.setSide(side);
    // The CPU's units play at the match difficulty, the player's at 0.5.
    const cpuUnits = this.defending ? 0.5 : this.skill;
    this.cover.setSkill(cpuUnits);
    this.line.setSkill(cpuUnits);
    if (!this.defending) {
      this.defense.take(null);
      this.cover.setUser(null);
    }
  }

  /** Break card on screen: next possession, CPU drive, or menu. */
  private pressOn(): void {
    const next = this.flow?.advance();
    if (next?.kind === 'drive') {
      this.newDrive(next.startZ);
    } else if (next?.kind === 'menu') {
      this.menuFn?.();
    }
  }

  /** Pre-snap audible. Indexes PLAYS (keys 1–9, 0). */
  selectPlay(i: number): void {
    if (this.phase !== 'presnap' || this.drive.over()) {
      return;
    }
    if (this.defending) {
      this.selectCall(i);
      return;
    }
    if (i < 0 || i >= PLAYS.length) {
      return;
    }
    if (this.punting) {
      this.punting = false;
      this.alignPunter();
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
    if (this.phase !== 'presnap' || this.drive.over() || this.defending) {
      return;
    }
    this.motionOn = true;
    this.motionIdx = 0;
  }

  setQbStick(x: number, z: number): void {
    this.stickX = x;
    this.stickZ = z;
  }

  /** Shift held: the player-controlled runner sprints. */
  setSprint(on: boolean): void {
    this.sprint = on;
  }

  /** Space with the ball in the open field: juke toward the stick. */
  juke(): void {
    if (this.phase === 'return') {
      this.puntRet.juke(Math.sign(this.stickX), this.puntCover());
      return;
    }
    if (this.phase === 'yac' && !this.defending) {
      this.yac.requestJuke(Math.sign(this.stickX));
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
    if (this.phase !== 'play' || this.defending) {
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
    if (live || this.phase === 'yac' || this.phase === 'punt' ||
        this.phase === 'return') {
      this.flow?.match.tick(dt);
    }
    this.stamina.tick(dt, this.sprint && this.userRunning());
    this.tickCharge(dt);
    this.qb().setWindUp(this.charge ? this.aimSpot() : null);
    this.tickActors(dt, live);
    this.line.update(dt, live, this.qb());
    if (live || this.phase === 'yac' || this.phase === 'return') {
      separatePlayers(this.players, (a, b) => this.tackling(a, b));
    }
    if (this.phase === 'play' && PLAYS[this.playIdx].run) {
      this.tryHandoff();
    } else if (this.phase === 'play') {
      if (this.defending) {
        this.tickCpuQb(dt);
      } else {
        this.tickEyes(dt);
      }
    }
    if (this.phase === 'punt') {
      this.tickPunt(dt);
    }
    if (this.phase === 'return') {
      this.tickReturn(dt);
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
    if (this.phase === 'yac' && this.yac.tick(dt)) {
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
    animateCrowd({
      players: this.players,
      ball: this.ball,
      qb: this.qb(),
      carrier: this.phase === 'yac' ? this.yac.carrier : null,
      live: this.phase === 'play',
      pressure: this.phase === 'play' ? this.pressure() : 0
    }, dt);
    this.followCam(dt, live);
    this.madden.update(dt);
  }

  /**
   * The player is driving a runner right now, so Shift spends sprint:
   * his own carrier runs on by itself, anyone else needs the stick.
   */
  private userRunning(): boolean {
    if ((this.phase === 'yac' && !this.defending) || this.phase === 'return') {
      return true;
    }
    const steering = Math.abs(this.stickX) + Math.abs(this.stickZ) > 0.2;
    return steering &&
      (this.phase === 'play' || this.phase === 'throw' || this.phase === 'yac');
  }

  /** Sprint gauge: level 1 fresh .. 0 spent, fading past 4 s. */
  sprintInfo(): { visible: boolean; level: number; fading: boolean; sprinting: boolean } {
    const s = this.stamina.info();
    const inPlay = this.phase === 'play' || this.phase === 'throw' ||
      this.phase === 'yac' || this.phase === 'return';
    return {
      visible: inPlay && s.active,
      level: s.level,
      fading: s.fading,
      sprinting: this.sprint && this.userRunning()
    };
  }

  /** Where the charged pass is aimed (the ring on the grass). */
  private aimSpot(): Vec2 {
    const at = this.aimMark.mesh.position;
    return { x: at.x, z: at.z };
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
    if (this.defending) {
      return [];
    }
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
    if (this.punting) {
      return this.defending
        ? '4e tentative : ils vont punter. Espace pour le snap.'
        : 'Punt. Espace pour botter, P pour annuler.';
    }
    if (this.flow && !this.defending && this.drive.down === 4) {
      return '4e tentative : P pour punter, ou tente le coup.';
    }
    if (this.defending) {
      const form = PLAYS[this.playIdx].form;
      return `Ils sortent en ${form}. 1–7 appel défensif · Tab change de joueur.`;
    }
    return readHint(PLAYS[this.playIdx], this.look);
  }

  score(): { home: number; away: number } {
    const m = this.flow?.match;
    return m
      ? { home: m.home, away: m.away }
      : { home: this.drive.home, away: this.drive.away };
  }

  /** Q1 2:45 in a match, empty in practice. */
  clockLine(): string {
    return this.flow?.match.clockLine() ?? '';
  }

  /** Overlay between possessions / at the end. */
  breakCard(): BreakCard | null {
    if (!this.drive.over()) {
      return null;
    }
    if (this.flow) {
      return this.flow.card;
    }
    const won = this.drive.won;
    return {
      kicker: won ? 'TOUCHDOWN' : 'TURNOVER ON DOWNS',
      title: won ? 'YOU WIN' : 'DRIVE OVER',
      hint: 'R — drive again from the 10',
      bad: !won
    };
  }

  callSheet(): {
    play: CallItem;
    playIdx: number;
    cover: string;
    plays: CallItem[];
    motion: boolean;
    over: 'win' | 'loss' | null;
  } {
    if (this.defending) {
      // The CPU's play stays hidden: only its formation shows.
      const form = PLAYS[this.playIdx].form;
      const calls = DEF_CALLS.map((c) => ({
        name: c.look.name,
        beat: c.beat,
        form: 'DÉFENSE',
        chip: c.beat
      }));
      return {
        play: { name: form, beat: '', form },
        playIdx: this.defense.callIdx,
        cover: this.look.name,
        plays: calls,
        motion: false,
        over: null
      };
    }
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
    if (this.defending) {
      return this.defenseStatus();
    }
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
      case 'punt':
        return 'Punt.';
      case 'touchdown':
        return 'TOUCHDOWN. You marched 90 yards. RESET to go again.';
      case 'turnover':
        return `${this.turnoverText || 'Turnover on downs'}. RESET to start on the 10.`;
      default:
        return '';
    }
  }

  private yacStatus(): string {
    return this.yac.status();
  }

  private defenseStatus(): string {
    switch (this.phase) {
      case 'presnap':
        return '1–7 appel · Tab change de joueur · Espace snap.';
      case 'play':
      case 'throw':
      case 'yac':
        return 'ZQSD ton joueur (anneau doré) · Shift sprint · Tab change.';
      case 'return':
        return 'Retour de punt : ZQSD · Shift sprint · Espace juke.';
      default:
        return '';
    }
  }

  /** Toasts read from the player's side: a stop is good news. */
  private say(msg: string, bad: boolean): void {
    this.toast?.(msg, this.defending ? !bad : bad);
  }

  /** Defenders the player may take: coverage men, not rushers. */
  private controllable(): PlayerActor[] {
    return this.defenders().filter((p) =>
      this.cover.jobOf(p.def.id) !== undefined &&
      !isPassRusher(p.def.id)
    );
  }

  /** Keep the controlled man if he still has a coverage job. */
  private pickUser(): void {
    const pool = this.controllable();
    const keep = this.defense.user;
    let next = keep && pool.includes(keep) ? keep : null;
    if (!next) {
      for (const id of ['fs', 'mlb', 'ss', 'wlb', 'lcb']) {
        next = pool.find((p) => p.def.id === id) ?? null;
        if (next) {
          break;
        }
      }
    }
    this.defense.take(next ?? pool[0] ?? null);
    this.cover.setUser(this.defense.user?.def.id ?? null);
  }

  /** Defense call before the snap (keys 1–7). */
  private selectCall(i: number): void {
    if (!this.defense.setCall(i)) {
      return;
    }
    this.look = this.defense.call().look;
    this.cover.setLook(this.look);
    this.line.setPackage(this.look.rush, this.look.spy ?? true);
    this.line.reset();
    this.applyDefense();
    const los = this.drive.losZ;
    for (const p of this.defenders()) {
      p.align(los);
    }
    this.pickUser();
  }

  /** CPU quarterback: read the progression, then throw. */
  private tickCpuQb(dt: number): void {
    const qb = this.qb();
    const eye = this.byId.get(this.cpuQb.eyesOn() ?? '');
    if (eye) {
      this.eyes.look(eye);
    }
    this.eyes.tick(dt, this.eligibles(), qb, true, null);
    // Each man is read at his lead point: where he will be when
    // a ball thrown now gets there.
    const defs = this.defenders().filter((d) => !d.isDown());
    const from = handPos(qb);
    const reads = this.eligibles().map((p) => {
      const power = powerFor(xzDist(qb, p));
      const catchAt = this.leadReceiver(p, power);
      const flight = flightTime(from, catchAt, power);
      return {
        id: p.def.id,
        dist: xzDist(qb, catchAt),
        power,
        margin: throwMargin(qb, catchAt, flight, power, defs)
      };
    });
    const call = this.cpuQb.tick(
      dt,
      reads,
      this.pressure(),
      qb,
      this.drive.losZ
    );
    if (call?.kind === 'throw') {
      const wr = this.byId.get(call.id);
      if (wr) {
        this.throwAt(this.leadReceiver(wr, call.power), call.power, 0);
      }
    } else if (call?.kind === 'away') {
      this.throwAt(call.spot, 0.6, 0);
    }
  }

  /**
   * Stick in world axes. On defense the camera turns with the
   * ball, so forward / left follow its heading.
   */
  private userStick(): Vec2 {
    if (!this.defending) {
      return { x: this.stickX, z: this.stickZ };
    }
    const h = this.madden.heading();
    const s = Math.sin(h);
    const c = Math.cos(h);
    return {
      x: this.stickZ * s + this.stickX * c,
      z: this.stickZ * c - this.stickX * s
    };
  }

  /** Where the ball is right now: carrier, flight, QB or the spot. */
  private ballSpot(): Vec2 {
    const ret = this.puntRet.carrier;
    if (this.phase === 'return' && ret) {
      // Look where he is running: the kicking team's end zone.
      return { x: ret.x, z: ret.z - 10 };
    }
    if (this.yac.carrier) {
      return this.yac.carrier;
    }
    if (this.ball.inAir || this.phase === 'presnap' ||
        this.phase === 'whistle') {
      return { x: this.ball.pos.x, z: this.ball.pos.z };
    }
    return this.qb();
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
    return this.phase === 'play' && !this.defending &&
      !PLAYS[this.playIdx].run &&
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
      moving: this.defending
        ? 0
        : clamp(Math.hypot(this.stickX, this.stickZ), 0, 1),
      overHold: over,
      accuracy: this.defending ? cpuAccuracy(this.skill) : undefined
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
    const to = new THREE.Vector3(x, 1.45, z);
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
    const ahead = (t: number): Vec2 => {
      if (!wr.routeDone()) {
        return wr.predict(t);
      }
      // Off script (working open): lead him along his run.
      const v = wr.velocity();
      const k = Math.min(t, 1.2);
      return { x: wr.x + v.x * k, z: wr.z + v.z * k };
    };
    let lead = ahead(0.6);
    for (let i = 0; i < 3; i += 1) {
      lead = ahead(flightTime(from, lead, power));
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
      qb.leaveRoute();
      qb.chase(to, dt, 6.35 * this.stamina.factor());
      if (qb.z > this.drive.losZ + 1.35) {
        this.startQbRun();
      }
    }
    for (const p of this.players) {
      if (this.phase === 'return') {
        // punt-return.ts moves everyone.
        continue;
      }
      if (this.phase === 'punt') {
        this.movePunt(p, dt);
        continue;
      }
      const line = p.def.pos === 'OL' || p.def.pos === 'DL';
      const db = isCoverage(p.def.pos);
      if (this.phase === 'yac' && carrier === p) {
        this.moveCarrier(dt, p);
        continue;
      }
      if (this.phase === 'yac' && this.yac.tackler === p) {
        this.yac.poseTackler();
        continue;
      }
      if (this.phase === 'yac' && this.yac.dives.has(p)) {
        this.yac.dives.move(p, dt);
        continue;
      }
      if (p === qb && this.phase === 'play' && this.scrambling()) {
        continue;
      }
      if (this.phase === 'throw' && this.flight.isDiving(p)) {
        this.flight.moveDiver(p, dt);
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
      if (p === this.defense.user && (live || this.phase === 'yac')) {
        this.defense.move(dt, this.userStick(), this.stamina.factor());
        continue;
      }
      if (p === this.defense.user && this.phase === 'presnap') {
        this.defense.shift(dt, this.userStick(), this.drive.losZ);
        continue;
      }
      if (live && this.open.wants(p)) {
        this.workOpen(p, dt);
        continue;
      }
      if (db && (live || this.phase === 'yac')) {
        continue;
      }
      p.update(dt, live && !line && !db);
    }
    if (this.phase === 'play') {
      this.cover.cover(dt);
    } else if (this.phase === 'throw' && this.flight.aim) {
      this.cover.breakOn(
        dt,
        this.flight.aim,
        (p) => this.flight.isDiving(p)
      );
    } else if (this.phase === 'yac' && carrier && !this.yac.tackler) {
      const diving = (p: PlayerActor) => this.yac.dives.has(p);
      this.cover.chaseCarrier(dt, carrier, diving);
      this.line.pursue(dt, carrier, diving);
    }
  }

  /** Run play: the RB reaches the mesh and takes the ball. */
  private tryHandoff(): void {
    const qb = this.qb();
    const rb = this.byId.get('rb');
    if (!rb || !handoffReady(this.clock, qb, rb)) {
      return;
    }
    rb.leaveRoute();
    this.yac.start(rb);
    this.ball.hold(rb.rig.rightHand);
    this.phase = 'yac';
    this.madden.setPhase('throw');
    this.cpuRun.reset();
    // A better CPU front gets off blocks sooner.
    const hold = this.defending ? 1 : 1.3 - this.skill * 0.55;
    this.line.startRun(hold);
  }

  /** Punter drops to his depth; everyone else stays in the formation. */
  private alignPunter(): void {
    const qb = this.qb();
    const depth = this.punting ? PUNTER_DEPTH : 0;
    const z = this.punting
      ? this.drive.losZ - depth
      : QB_START.z + (this.drive.losZ - LOS_Z);
    qb.x = this.punting ? 0 : QB_START.x;
    qb.z = z;
    qb.place();
    const returner = this.byId.get('fs');
    if (this.punting && this.defending && returner) {
      // Our returner waits deep for the CPU's punt.
      returner.x = 0;
      returner.z = this.drive.losZ + RETURNER_DEPTH;
      returner.place();
      // The camera rides with him while he gets under the ball.
      this.defense.take(returner);
    }
    this.setRoutes(!this.punting && !this.defending);
  }

  private snapPunt(): void {
    this.phase = 'punt';
    this.clock = 0;
    this.puntT = 0;
    this.kicked = false;
    this.punt = planPunt(this.drive.losZ);
    this.puntRet.clear();
    this.ball.hold(this.qb().rig.rightHand);
    this.madden.setPhase('play');
    this.setRoutes(false);
  }

  private tickPunt(dt: number): void {
    const plan = this.punt;
    if (!plan) {
      return;
    }
    this.puntT += dt;
    if (!this.kicked && this.puntT >= PUNT_KICK_T) {
      this.kicked = true;
      const qb = this.qb();
      const from = handPos(qb);
      const to = new THREE.Vector3(plan.landing.x, 0.2, plan.landing.z);
      this.ball.launch(this.scene, from, ballisticVel(from, to, plan.hang));
      qb.lockAnim('throw', 0.5);
      this.madden.setPhase('throw');
    }
    const returner = this.byId.get('fs');
    if (this.kicked && this.defending && returner && this.ball.inAir &&
        this.ball.pos.y < FIELD_HEIGHT &&
        xzDist(returner, this.ball.pos) < FIELD_RANGE) {
      this.startReturn(returner);
      return;
    }
    const landed = this.kicked &&
      (!this.ball.inAir || this.puntT > PUNT_KICK_T + plan.hang + 0.8);
    if (!landed) {
      return;
    }
    const net = Math.round(puntEndZ(plan) - this.drive.losZ);
    this.drive.turnover();
    this.turnoverText = 'Punt';
    this.finishDrive(
      plan.touchback ? 'PUNT · TOUCHBACK' : `PUNT · ${net} YDS`,
      true,
      'turnover',
      'punt',
      'turnover',
      puntEndZ(plan)
    );
  }

  /** Gunners run under the kick, the returner goes to it. */
  private movePunt(p: PlayerActor, dt: number): void {
    const spot = this.punt?.landing;
    const cover = p.def.side === 'offense' &&
      p.def.pos !== 'OL' && p.def.pos !== 'QB';
    if (spot && this.kicked && cover) {
      p.leaveRoute();
      p.chase(spot, dt, 6.3);
      return;
    }
    if (spot && p.def.id === 'fs') {
      // The returner goes and stands under it.
      p.meet(spot, dt, 7.2, { x: this.ball.pos.x, z: this.ball.pos.z }, 'catch');
      return;
    }
    p.update(dt, false);
  }

  /** Our returner fields the CPU's punt: the player runs it back. */
  private startReturn(returner: PlayerActor): void {
    this.ball.hold(returner.rig.rightHand);
    returner.lockAnim('catch', 0.3);
    this.fieldZ = returner.z;
    this.phase = 'return';
    this.defense.take(returner);
    this.cover.setUser(null);
    this.puntRet.start(returner);
    this.madden.setPhase('throw');
    this.say('RETOUR DE PUNT', true);
  }

  /** Kicking team: everyone on the CPU side chases the returner. */
  private puntCover(): PlayerActor[] {
    return this.players.filter((p) => p.def.side === 'offense');
  }

  private tickReturn(dt: number): void {
    const returner = this.puntRet.carrier;
    const blockers = this.defenders().filter((p) => p !== returner);
    const end = this.puntRet.tick(
      dt,
      this.userStick(),
      this.stamina.factor(),
      this.puntCover(),
      blockers
    );
    if (end) {
      this.finishReturn(end);
    }
  }

  private finishReturn(end: ReturnEnd): void {
    const c = this.puntRet.carrier;
    const z = c?.z ?? this.fieldZ;
    const yds = Math.max(0, Math.round(this.fieldZ - z));
    this.drive.turnover();
    this.turnoverText = 'Punt';
    if (end === 'td') {
      this.finishDrive(
        'TOUCHDOWN SUR RETOUR',
        true,
        'turnover',
        'return-td',
        'score',
        z
      );
      return;
    }
    this.finishDrive(
      `RETOUR · ${yds} YDS`,
      true,
      'turnover',
      'punt',
      'turnover',
      z
    );
  }

  /** Player steers his own carrier; the CPU runs its own. */
  private moveCarrier(dt: number, p: PlayerActor): void {
    if (!this.defending) {
      this.yac.move(
        dt,
        this.qb(),
        { x: this.stickX, z: this.stickZ },
        this.stamina.factor()
      );
      return;
    }
    const run = this.cpuRun.tick(dt, p, this.defenders());
    if (run.juke !== 0) {
      this.yac.requestJuke(run.juke);
    }
    // CPU carriers run a steady gear a little above a jog, no fatigue.
    this.yac.move(dt, this.qb(), run.stick, 1.12);
  }

  private endYac(): void {
    const wr = this.yac.carrier!;
    wr.x = clamp(wr.x, -HALF_W + 0.4, HALF_W - 0.4);
    const r = this.drive.gainTo(wr.z);
    if (r === 'td') {
      this.drive.scoreTd();
      this.finishDrive('TOUCHDOWN', false, 'touchdown', 'td', 'score');
      return;
    }
    if (r === 'first') {
      this.blow('FIRST DOWN', false, 'tackle');
      return;
    }
    if (r === 'turnover') {
      this.drive.turnover();
      this.finishDrive('TURNOVER ON DOWNS', true, 'turnover', 'downs', 'tackle');
      return;
    }
    this.blow(this.drive.downLine(), false, 'tackle');
  }

  private huddle(): void {
    if (this.drive.over()) {
      return;
    }
    this.phase = 'presnap';
    this.clock = 0;
    this.whistleT = 0;
    this.stamina.reset();
    this.yac.clear();
    this.open.clear();
    this.flight.clear();
    this.aimMark.hide();
    this.aimMark.style(1, false);
    this.charge = null;
    this.motionOn = false;
    this.motionIdx = 0;
    this.punting = false;
    this.punt = null;
    if (this.defending) {
      this.playIdx = callPlay(
        PLAYS,
        this.skill,
        this.drive.down,
        this.drive.toGo
      );
      this.look = this.defense.call().look;
    } else {
      this.look = pickLook();
    }
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
    this.setRoutes(!this.defending);
    if (this.defending) {
      this.pickUser();
      const user = this.defense.user;
      if (user) {
        const ball = this.ballSpot();
        this.madden.trackDefender(user.x, user.z, ball.x, ball.z, 0, true);
      }
      if (this.drive.down === 4 &&
          cpuPunts(this.drive.toGo, this.drive.losZ)) {
        this.punting = true;
        this.alignPunter();
      }
    }
  }

  private spawn(): void {
    const mats = makeTeamMats();
    this.mats = mats;
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
    const show = !this.defending &&
      (this.phase === 'play' || this.phase === 'throw');
    const defs = this.defenders();
    const qb = this.qb();
    for (const p of this.players) {
      if (!p.def.eligible) {
        continue;
      }
      p.setCover(show ? gradeReceiver(p, qb, defs) : 'idle');
    }
  }

  /** A sack needs a rusher to actually reach the QB: no pocket timer. */
  private checkSack(): void {
    const qb = this.qb();
    const user = this.defense.user?.def.id;
    const hunters = user ? [...passRushers(), user] : passRushers();
    for (const id of hunters) {
      const d = this.byId.get(id);
      if (d && xzDist(qb, d) < SACK_RANGE) {
        this.deadSack(d);
        return;
      }
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
        this.say(r.msg, true);
        return;
      case 'pick':
        this.intercept(r.db);
        return;
      case 'catch':
        this.resolveCatch(r.wr, r.dive);
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
      'turnover',
      'pick',
      'turnover',
      db.z
    );
  }

  private resolveCatch(wr: PlayerActor, dive = false): void {
    this.yac.start(wr);
    this.ball.inAir = false;
    this.ball.hold(wr.rig.rightHand);
    this.aimMark.hide();
    if (dive) {
      // Laid out on the grass: the play ends where he lands.
      this.say('DIVING CATCH', false);
      this.endYac();
      return;
    }
    wr.lockAnim('catch', 0.32);
    this.phase = 'yac';
    this.madden.setPhase('throw');
    this.say('COMPLETE', false);
  }

  private deadIncomp(msg: string): void {
    const r = this.drive.incomplete();
    if (r === 'turnover') {
      this.drive.turnover();
      this.turnoverText = 'Turnover on downs';
      this.finishDrive('TURNOVER ON DOWNS', true, 'turnover', 'downs', 'incomplete');
      return;
    }
    this.blow(msg, true, 'incomplete');
  }

  private deadSack(by: PlayerActor): void {
    const qb = this.qb();
    by.facePoint(qb);
    by.lockAnim('tackle', 0.72);
    qb.startRagdoll(by);
    const r = this.drive.sackAt(qb.z);
    if (r === 'turnover') {
      this.drive.turnover();
      this.finishDrive('TURNOVER ON DOWNS', true, 'turnover', 'downs', 'tackle');
      return;
    }
    this.blow('SACK', true, 'tackle');
  }

  private finishDrive(
    msg: string,
    bad: boolean,
    phase: Phase,
    end: DriveEnd,
    play: PlayEnd,
    endZ = this.drive.losZ
  ): void {
    this.phase = phase;
    this.whistleT = 0;
    this.madden.setPhase('dead');
    this.aimMark.hide();
    this.setRoutes(false);
    this.say(msg, bad);
    if (this.flow) {
      const clock = this.flow.playOver(play);
      this.flow.driveOver(end, endZ, clock);
    }
  }

  private blow(msg: string, bad: boolean, play: PlayEnd): void {
    this.phase = 'whistle';
    this.whistleT = 0;
    this.madden.setPhase('dead');
    this.aimMark.hide();
    this.setRoutes(false);
    this.say(msg, bad);
    const clock = this.flow?.playOver(play) ?? 'none';
    if (clock !== 'none') {
      // Quarter 2 or 4 ran out on this snap: the possession stops.
      this.drive.turnover();
      this.phase = 'turnover';
      this.flow?.driveOver('clock', this.drive.losZ, clock);
    }
  }

  private followCam(dt: number, live: boolean): void {
    const carrier = this.yac.carrier;
    this.madden.setPunch(this.phase === 'yac' && this.yac.isDown());
    const user = this.defense.user;
    if (this.defending && user) {
      const ball = this.ballSpot();
      this.madden.trackDefender(user.x, user.z, ball.x, ball.z, dt);
      return;
    }
    if (this.phase === 'yac' && carrier) {
      this.madden.follow(carrier.x, carrier.z, dt);
      return;
    }
    if ((this.phase === 'throw' || this.phase === 'punt') &&
        this.ball.inAir) {
      const b = this.ball.pos;
      this.madden.followBall(b.x, b.y, b.z, dt);
      return;
    }
    if (live) {
      const qb = this.qb();
      this.madden.follow(qb.x, qb.z, dt);
    }
  }

  private applyOffense(): void {
    const play = PLAYS[this.playIdx];
    this.qb().setSkill(
      QB_START,
      fitRoute(qbPath(play), this.drive.losZ),
      'QB'
    );
    for (const id of THROW_ORDER) {
      const pack = play.skill[id];
      const p = this.byId.get(id);
      if (!p || !pack) {
        continue;
      }
      p.setSkill(
        pack.start,
        fitRoute(pack.route, this.drive.losZ),
        pack.routeName
      );
    }
  }

  /** Route is over: find grass away from the coverage. */
  private workOpen(p: PlayerActor, dt: number): void {
    const scrambling = this.phase === 'play' && this.scrambling();
    this.open.move(p, dt, {
      qb: this.qb(),
      losZ: this.drive.losZ,
      defenders: this.defenders(),
      mates: this.eligibles(),
      scramble: scrambling ? Math.sign(this.stickX) : 0
    });
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
    const rest = fitRoute(pack?.route ?? wr.def.route ?? [], this.drive.losZ);
    wr.setSkill(local, [local, ...rest], pack?.routeName ?? 'Motion');
    this.rebuildGhosts();
  }

  /** Carrier and tackler are meant to collide; let the tackle play. */
  private tackling(a: PlayerActor, b: PlayerActor): boolean {
    const t = this.yac.tackler;
    const c = this.yac.carrier;
    return !!t && !!c && ((a === t && b === c) || (a === c && b === t));
  }

  private scrambling(): boolean {
    return !this.defending && !PLAYS[this.playIdx].run && Math.abs(this.stickX) + Math.abs(this.stickZ) > 0.2;
  }

  private startQbRun(): void {
    const qb = this.qb();
    this.yac.startScramble(qb);
    this.phase = 'yac';
    this.ball.hold(qb.rig.rightHand);
    this.madden.setPhase('throw');
    this.say('SCRAMBLE', false);
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

