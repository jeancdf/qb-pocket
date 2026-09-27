/**
 * Pass power meter. Builds its own DOM and styles so it does
 * not depend on index.html or style.css.
 */

const CSS = `
.throw-meter {
  position: absolute;
  left: 50%;
  bottom: 96px;
  transform: translateX(-50%);
  width: min(320px, 70vw);
  pointer-events: none;
  font-family: 'Barlow Condensed', system-ui, sans-serif;
  color: #f4efe4;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
  z-index: 20;
}
.throw-meter[hidden] { display: none; }
.throw-meter__bar {
  position: relative;
  height: 12px;
  border-radius: 6px;
  background: linear-gradient(90deg,
    rgba(95,179,255,0.4) 0%, rgba(95,179,255,0.4) 33%,
    rgba(126,224,138,0.4) 33%, rgba(126,224,138,0.4) 70%,
    rgba(255,179,71,0.4) 70%, rgba(255,179,71,0.4) 100%);
}
.throw-meter__fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 0;
  border-radius: 6px;
  background: #f4efe4;
  opacity: 0.95;
}
.throw-meter__row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  margin-top: 4px;
}
.throw-meter__over { color: #ff6b5b; }
`;

export class ThrowMeter {
  private readonly root: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly kind: HTMLSpanElement;
  private readonly acc: HTMLSpanElement;

  constructor(host: HTMLElement = document.getElementById('app') ?? document.body) {
    if (!document.getElementById('throw-meter-css')) {
      const style = document.createElement('style');
      style.id = 'throw-meter-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.root = document.createElement('div');
    this.root.className = 'throw-meter';
    this.root.hidden = true;
    const bar = document.createElement('div');
    bar.className = 'throw-meter__bar';
    this.fill = document.createElement('div');
    this.fill.className = 'throw-meter__fill';
    const row = document.createElement('div');
    row.className = 'throw-meter__row';
    this.kind = document.createElement('span');
    this.acc = document.createElement('span');
    row.append(this.kind, this.acc);
    bar.appendChild(this.fill);
    this.root.append(bar, row);
    host.appendChild(this.root);
  }

  show(power: number, spread: number, pressure: number, over: boolean): void {
    this.root.hidden = false;
    this.fill.style.width = `${Math.round(power * 100)}%`;
    this.kind.textContent = over
      ? 'SAILING'
      : power < 0.33
        ? 'LOB'
        : power < 0.7
          ? 'TOUCH'
          : 'BULLET';
    this.kind.className = over ? 'throw-meter__over' : '';
    const pressed = pressure > 0.5 ? ' · PRESSURE' : '';
    this.acc.textContent = `±${spread.toFixed(1)} YD${pressed}`;
  }

  hide(): void {
    this.root.hidden = true;
  }
}
