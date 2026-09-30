/**
 * Sprint (Shift) for the player-controlled runner: a real gear above
 * the normal run, full strength for the first seconds, then the legs
 * go: the longer Shift stays down, the faster the pace falls away,
 * ending below a normal run. Letting go recovers it. Also the on-screen
 * gauge, which builds its own DOM and styles like the throw meter.
 */

/** Top-speed multiplier while the sprint is fresh. */
export const SPRINT_BOOST = 1.3;
/** Seconds of full-strength sprint before it starts to fade. */
export const SPRINT_FRESH = 4;
/** Floor once the runner is spent (a bit under his normal run). */
const SPENT = 0.85;
/** Seconds of held sprint recovered per second off Shift. */
const RECOVER = 1;
/** Held time where the gauge reads fully spent. */
const SPENT_AT = 7.3;

export class SprintMeter {
  /** Seconds Shift has been working, minus what was recovered. */
  private held = 0;
  private on = false;

  reset(): void {
    this.held = 0;
    this.on = false;
  }

  /** Call once per frame with whether the sprint is being used. */
  tick(dt: number, sprinting: boolean): void {
    this.on = sprinting;
    this.held = sprinting
      ? this.held + dt
      : Math.max(0, this.held - dt * RECOVER);
  }

  /** Speed multiplier for this frame (1 when not sprinting). */
  factor(): number {
    if (!this.on) {
      return 1;
    }
    const over = Math.max(0, this.held - SPRINT_FRESH);
    // Fades slowly at first, then faster the longer it is held.
    return Math.max(SPENT, SPRINT_BOOST - 0.07 * over - 0.02 * over * over);
  }

  /** For the gauge: 1 fresh .. 0 spent, and whether it is fading. */
  info(): { level: number; fading: boolean; active: boolean } {
    const level = this.held <= SPRINT_FRESH
      ? 1 - 0.5 * (this.held / SPRINT_FRESH)
      : 0.5 * Math.max(0, 1 - (this.held - SPRINT_FRESH) /
        (SPENT_AT - SPRINT_FRESH));
    return {
      level,
      fading: this.held > SPRINT_FRESH,
      active: this.on || this.held > 0
    };
  }
}

const CSS = `
.sprint-gauge {
  position: absolute;
  left: 50%;
  bottom: 150px;
  transform: translateX(-50%);
  width: min(180px, 46vw);
  pointer-events: none;
  font-family: 'Barlow Condensed', system-ui, sans-serif;
  color: #f4efe4;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
  z-index: 20;
  transition: opacity 0.25s;
}
.sprint-gauge[hidden] { display: none; }
.sprint-gauge__row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  margin-bottom: 3px;
}
.sprint-gauge__bar {
  position: relative;
  height: 8px;
  border-radius: 4px;
  background: rgba(10, 20, 35, 0.55);
  overflow: hidden;
}
.sprint-gauge__fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 4px;
  background: #7ee08a;
}
.sprint-gauge--fading .sprint-gauge__fill { background: #ffb347; }
.sprint-gauge--spent .sprint-gauge__fill { background: #ff6b5b; }
.sprint-gauge--fading .sprint-gauge__state { color: #ffb347; }
.sprint-gauge--spent .sprint-gauge__state { color: #ff6b5b; }
`;

export class SprintGauge {
  private readonly root: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly state: HTMLSpanElement;

  constructor(host: HTMLElement = document.getElementById('app') ?? document.body) {
    if (!document.getElementById('sprint-gauge-css')) {
      const style = document.createElement('style');
      style.id = 'sprint-gauge-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.root = document.createElement('div');
    this.root.className = 'sprint-gauge';
    this.root.hidden = true;
    const row = document.createElement('div');
    row.className = 'sprint-gauge__row';
    const name = document.createElement('span');
    name.textContent = 'SPRINT';
    this.state = document.createElement('span');
    this.state.className = 'sprint-gauge__state';
    row.append(name, this.state);
    const bar = document.createElement('div');
    bar.className = 'sprint-gauge__bar';
    this.fill = document.createElement('div');
    this.fill.className = 'sprint-gauge__fill';
    bar.appendChild(this.fill);
    this.root.append(row, bar);
    host.appendChild(this.root);
  }

  /** `sprinting`: Shift held right now. */
  show(level: number, fading: boolean, sprinting: boolean): void {
    this.root.hidden = false;
    this.fill.style.width = `${Math.round(level * 100)}%`;
    const spent = level < 0.08;
    this.root.classList.toggle('sprint-gauge--fading', fading && !spent);
    this.root.classList.toggle('sprint-gauge--spent', spent);
    this.state.textContent = spent
      ? 'ÉPUISÉ'
      : fading
        ? 'FATIGUE'
        : sprinting
          ? 'À FOND'
          : '';
  }

  hide(): void {
    this.root.hidden = true;
  }
}
