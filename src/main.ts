import './style.css';
import { FootballGame } from './game/game';
import { Hud } from './game/hud';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
if (!canvas) {
  throw new Error('Missing canvas');
}

const game = new FootballGame(canvas);
const hud = new Hud();
game.onToast((msg, bad) => hud.toast(msg, bad));

const snapBtn = document.getElementById('snap-btn');
const resetBtn = document.getElementById('reset-btn');
snapBtn?.addEventListener('click', () => game.snap());
resetBtn?.addEventListener('click', () => {
  game.reset();
  paintHud();
});

document.getElementById('receiver-list')?.addEventListener('click', (ev) => {
  const row = (ev.target as HTMLElement).closest('li');
  const id = row?.dataset.id;
  if (id) {
    game.throwTo(id);
  }
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
    if (Math.hypot(dx, dy) > 6) {
      return;
    }
    const id = game.pick(up.clientX, up.clientY);
    if (id) {
      game.throwTo(id);
    }
  };
  canvas.addEventListener('pointerup', onUp);
});

window.addEventListener('keydown', (ev) => {
  if (ev.code === 'Space') {
    ev.preventDefault();
    game.snap();
  }
  if (ev.key >= '1' && ev.key <= '5') {
    const rows = game.hudRows();
    const row = rows[Number(ev.key) - 1];
    if (row) {
      game.throwTo(row.id);
    }
  }
  if (ev.key === 'r' || ev.key === 'R') {
    game.reset();
  }
});

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
  hud.setSnapEnabled(game.phase === 'presnap');
  hud.setPocket(game.pocketLeft(), game.phase === 'play');
}

paintHud();
requestAnimationFrame(frame);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopped = true;
  });
}
