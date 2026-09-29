import './style.css';
import { FootballGame } from './game/game';
import { Hud } from './game/hud';
import { Menu } from './game/menu';
import { ThrowMeter } from './game/throw-meter';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
if (!canvas) {
  throw new Error('Missing canvas');
}

const game = new FootballGame(canvas);
window.__qb = game;
const hud = new Hud();
const meter = new ThrowMeter();
const menu = new Menu();
menu.onPick((mode) => {
  hud.hidePlaybook();
  if (mode === 'practice') {
    game.startPractice();
  } else {
    game.startMatch(0.5);
  }
  paintHud();
});
game.onToast((msg, bad) => hud.toast(msg, bad));
game.onMenu(() => openMenu());
const ro = new ResizeObserver(() => game.resize());
ro.observe(canvas);

const snapBtn = document.getElementById('snap-btn');
const resetBtn = document.getElementById('reset-btn');
snapBtn?.addEventListener('click', () => {
  hud.hidePlaybook();
  game.snap();
  paintHud();
});
document.getElementById('menu-btn')?.addEventListener('click', openMenu);
resetBtn?.addEventListener('click', () => {
  hud.hidePlaybook();
  game.reset();
  paintHud();
});

document.getElementById('audibles')?.addEventListener('click', (ev) => {
  const btn = (ev.target as HTMLElement).closest('button');
  const idx = btn?.dataset.idx;
  if (idx !== undefined) {
    game.selectPlay(Number(idx));
    paintHud();
  }
});

document.getElementById('receiver-list')?.addEventListener('click', (ev) => {
  const row = (ev.target as HTMLElement).closest('li');
  const id = row?.dataset.id;
  if (id) {
    game.throwTo(id);
  }
});

canvas.addEventListener('pointermove', (ev) => {
  game.previewAim(ev.clientX, ev.clientY);
});

// Press on the grass to wind up, drag to aim, release to throw.
// The longer the hold, the harder (and flatter) the pass.
canvas.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0 || menu.isOpen()) {
    return;
  }
  game.beginChargeAtScreen(ev.clientX, ev.clientY);
  const onUp = () => {
    window.removeEventListener('pointerup', onUp);
    game.releaseCharge();
  };
  window.addEventListener('pointerup', onUp);
});

const down = new Set<string>();

window.addEventListener('keydown', (ev) => {
  if (menu.isOpen()) {
    return;
  }
  if (ev.code === 'Space') {
    ev.preventDefault();
    if (game.phase === 'yac') {
      game.juke();
      return;
    }
    hud.hidePlaybook();
    game.snap();
    paintHud();
  }
  if (ev.key === 'Shift') {
    game.setSprint(true);
  }
  if (ev.key === 'Tab' || ev.key === 'c' || ev.key === 'C') {
    ev.preventDefault();
    game.switchPlayer();
  }
  if (ev.key === 'h' || ev.key === 'H') {
    hud.togglePlaybook();
  }
  if (ev.key === 'm' || ev.key === 'M') {
    game.sendMotion();
  }
  if (ev.key === 'p' || ev.key === 'P') {
    game.callPunt();
    paintHud();
  }
  if (ev.key === 'v' || ev.key === 'V') {
    game.nextRun();
    paintHud();
  }
  if (/^[0-9]$/.test(ev.key) && game.phase === 'presnap') {
    // 1–9 then 0 for the tenth play.
    game.selectPlay(ev.key === '0' ? 9 : Number(ev.key) - 1);
    paintHud();
    return;
  }
  if (ev.key >= '1' && ev.key <= '5' && game.phase === 'play') {
    const rows = game.hudRows();
    const row = rows[Number(ev.key) - 1];
    if (row && !ev.repeat) {
      game.beginChargeOn(row.id);
    }
  }
  if (ev.key === 'Escape') {
    if (game.phase === 'play') {
      game.cancelCharge();
    } else {
      openMenu();
      return;
    }
  }
  if (ev.key === 'r' || ev.key === 'R') {
    hud.hidePlaybook();
    game.reset();
    paintHud();
  }
  down.add(ev.code);
  syncStick();
});

window.addEventListener('keyup', (ev) => {
  if (ev.key === 'Shift') {
    game.setSprint(false);
  }
  if (ev.key >= '1' && ev.key <= '5') {
    const row = game.hudRows()[Number(ev.key) - 1];
    if (row && game.chargingOn() === row.id) {
      game.releaseCharge();
    }
  }
  down.delete(ev.code);
  syncStick();
});

function openMenu(): void {
  game.cancelCharge();
  down.clear();
  syncStick();
  game.setSprint(false);
  hud.hidePlaybook();
  menu.open();
}

function syncStick(): void {
  // AZERTY ZQSD + QWERTY WASD. Camera is behind the QB looking
  // +z, so world +x is screen-left: Q/A left, D right.
  const z =
    (held('KeyW') || held('KeyZ') ? 1 : 0) -
    (held('KeyS') ? 1 : 0);
  const x =
    (held('KeyA') || held('KeyQ') ? 1 : 0) -
    (held('KeyD') ? 1 : 0);
  game.setQbStick(x, z);
}

function held(code: string): boolean {
  return down.has(code);
}

window.addEventListener('resize', () => game.resize());

let stopped = false;
let last = performance.now();
let hudTick = 0;

function frame(now: number): void {
  if (stopped) {
    return;
  }
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.update(dt);
  game.render();
  const charge = game.chargeInfo();
  if (charge) {
    meter.show(charge.power, charge.spread, charge.pressure, charge.over);
  } else {
    meter.hide();
  }
  hudTick += dt;
  if (hudTick > 0.12) {
    hudTick = 0;
    paintHud();
  }
  requestAnimationFrame(frame);
}

function paintHud(): void {
  hud.setReceivers(game.hudRows());
  hud.setStatus(game.statusText());
  hud.setSnapEnabled(game.canSnap());
  hud.setLiveChrome(game.canSnap());
  const call = game.callSheet();
  hud.setDrive(
    game.downLine(),
    call.play.name,
    game.yardsLeft()
  );
  hud.setScore(game.score().home, game.score().away);
  hud.setCall(
    call.plays,
    call.playIdx,
    call.cover,
    game.phase === 'presnap'
  );
  hud.setRead(game.readHint(), game.phase === 'presnap');
  hud.setCard(game.breakCard());
  hud.setClock(game.clockLine());
  hud.setSide(game.isDefending());
}

paintHud();
requestAnimationFrame(frame);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopped = true;
    ro.disconnect();
  });
}
