import './style.css';
import { FootballGame } from './game/game';
import { Hud } from './game/hud';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
if (!canvas) {
  throw new Error('Missing canvas');
}

const game = new FootballGame(canvas);
window.__qb = game;
const hud = new Hud();
game.onToast((msg, bad) => hud.toast(msg, bad));
game.onOver((over) => hud.setResult(over));
const ro = new ResizeObserver(() => game.resize());
ro.observe(canvas);

const snapBtn = document.getElementById('snap-btn');
const resetBtn = document.getElementById('reset-btn');
snapBtn?.addEventListener('click', () => {
  hud.hidePlaybook();
  game.snap();
  paintHud();
});
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

canvas.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) {
    return;
  }
  const startX = ev.clientX;
  const startY = ev.clientY;
  const onUp = (up: PointerEvent) => {
    canvas.removeEventListener('pointerup', onUp);
    const dx = up.clientX - startX;
    const dy = up.clientY - startY;
    if (Math.hypot(dx, dy) > 8) {
      return;
    }
    game.throwAtScreen(up.clientX, up.clientY);
  };
  canvas.addEventListener('pointerup', onUp);
});

const down = new Set<string>();

window.addEventListener('keydown', (ev) => {
  if (ev.code === 'Space') {
    ev.preventDefault();
    hud.hidePlaybook();
    game.snap();
    paintHud();
  }
  if (ev.key === 'h' || ev.key === 'H') {
    hud.togglePlaybook();
  }
  if (ev.key === 'm' || ev.key === 'M') {
    game.sendMotion();
  }
  if (ev.key >= '1' && ev.key <= '4' && game.phase === 'presnap') {
    game.selectPlay(Number(ev.key) - 1);
    paintHud();
    return;
  }
  if (ev.key >= '1' && ev.key <= '5' && game.phase === 'play') {
    const rows = game.hudRows();
    const row = rows[Number(ev.key) - 1];
    if (row) {
      game.throwTo(row.id);
    }
  }
  if (game.phase === 'yac' &&
      ['KeyA', 'KeyQ', 'KeyD'].includes(ev.code)) {
    game.requestJuke(ev.code === 'KeyD' ? 1 : -1);
    return;
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
  down.delete(ev.code);
  syncStick();
});

function syncStick(): void {
  // AZERTY ZQSD + QWERTY WASD.
  const z =
    (held('KeyW') || held('KeyZ') ? 1 : 0) -
    (held('KeyS') ? 1 : 0);
  const x =
    (held('KeyD') ? 1 : 0) -
    (held('KeyA') || held('KeyQ') ? 1 : 0);
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
  const canSnap =
    game.phase === 'presnap' || game.phase === 'whistle';
  hud.setSnapEnabled(canSnap && !game.callSheet().over);
  hud.setLiveChrome(
    game.phase === 'presnap' || game.phase === 'whistle'
  );
  hud.setPocket(game.pocketLeft(), game.phase === 'play');
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
  hud.setResult(call.over);
}

paintHud();
requestAnimationFrame(frame);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopped = true;
    ro.disconnect();
  });
}
