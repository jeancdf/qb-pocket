import type { CoverGrade } from './types';
import type { OffPlay } from './plays';

export interface HudRow {
  id: string;
  key: string;
  number: number;
  label: string;
  routeName: string;
  cover: CoverGrade;
}

export class Hud {
  private list: HTMLElement;
  private statusEl: HTMLElement;
  private snapBtn: HTMLButtonElement;
  private toastEl: HTMLElement;
  private pocketEl: HTMLElement;
  private downEl: HTMLElement;
  private playEl: HTMLElement;
  private yardsEl: HTMLElement;
  private playbook: HTMLElement;
  private playBar: HTMLElement;
  private audibles: HTMLElement;
  private coverEl: HTMLElement;
  private titleEl: HTMLElement;
  private playNameEl: HTMLElement;
  private resultEl: HTMLElement;
  private resultKick: HTMLElement;
  private resultTitle: HTMLElement;
  private hintEl: HTMLElement;
  private homeEl: HTMLElement;
  private awayEl: HTMLElement;
  private bookOpen = false;
  private toastTimer: number | null = null;

  constructor() {
    this.list = el('receiver-list');
    this.statusEl = el('status');
    this.snapBtn = el('snap-btn') as HTMLButtonElement;
    this.toastEl = el('toast');
    this.pocketEl = el('pocket');
    this.downEl = el('down-line');
    this.playEl = el('play-chip');
    this.yardsEl = el('yards-chip');
    this.playbook = el('hud');
    this.playBar = el('play-bar');
    this.audibles = el('audibles');
    this.coverEl = el('cover-call');
    this.titleEl = el('play-title');
    this.playNameEl = el('play-name');
    this.resultEl = el('result');
    this.resultKick = el('result-kicker');
    this.resultTitle = el('result-title');
    this.hintEl = el('read-hint');
    this.homeEl = el('home-score');
    this.awayEl = el('away-score');
    this.playbook.hidden = true;
  }

  togglePlaybook(): void {
    this.bookOpen = !this.bookOpen;
    this.playbook.hidden = !this.bookOpen;
  }

  hidePlaybook(): void {
    this.bookOpen = false;
    this.playbook.hidden = true;
  }

  setLiveChrome(show: boolean): void {
    this.playBar.classList.toggle('is-away', !show);
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  setSnapEnabled(on: boolean): void {
    this.snapBtn.disabled = !on;
  }

  setPocket(left: number, live: boolean): void {
    if (!live) {
      this.pocketEl.textContent = '';
      return;
    }
    this.pocketEl.textContent = `POCKET ${left.toFixed(1)}s`;
  }

  toast(text: string, bad: boolean): void {
    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
    }
    this.toastEl.hidden = false;
    this.toastEl.textContent = text;
    this.toastEl.classList.toggle('is-bad', bad);
    const duration = text.startsWith('TACKLED') ? 2200 : 1600;
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.hidden = true;
      this.toastTimer = null;
    }, duration);
  }

  setReceivers(rows: HudRow[]): void {
    this.list.replaceChildren();
    for (const row of rows) {
      this.list.append(rowNode(row));
    }
  }

  setDrive(line: string, play: string, yards: number): void {
    this.downEl.textContent = line;
    this.playEl.textContent = play;
    this.yardsEl.textContent = `${yards} YDS`;
  }

  setScore(home: number, away: number): void {
    this.homeEl.textContent = String(home);
    this.awayEl.textContent = String(away);
  }

  setRead(text: string, show: boolean): void {
    this.hintEl.textContent = text;
    this.hintEl.classList.toggle('is-away', !show);
  }

  setCall(
    plays: OffPlay[],
    idx: number,
    cover: string,
    presnap: boolean
  ): void {
    this.coverEl.textContent = cover;
    const play = plays[idx];
    if (play) {
      this.titleEl.textContent = play.form;
      this.playNameEl.textContent = `Play: ${play.name}`;
    }
    this.audibles.classList.toggle('is-away', !presnap);
    this.audibles.replaceChildren();
    plays.forEach((p, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.idx = String(i);
      btn.classList.toggle('is-on', i === idx);
      btn.append(`${i + 1} ${p.name}`);
      const beat = document.createElement('span');
      beat.className = 'beat';
      beat.textContent = `vs ${p.beat}`;
      btn.append(beat);
      this.audibles.append(btn);
    });
  }

  setResult(over: 'win' | 'loss' | null): void {
    if (!over) {
      this.resultEl.hidden = true;
      return;
    }
    this.resultEl.hidden = false;
    this.resultEl.classList.toggle('is-bad', over === 'loss');
    this.resultKick.textContent =
      over === 'win' ? 'TOUCHDOWN' : 'TURNOVER ON DOWNS';
    this.resultTitle.textContent =
      over === 'win' ? 'YOU WIN' : 'DRIVE OVER';
  }
}

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing #${id}`);
  }
  return node;
}

function rowNode(row: HudRow): HTMLLIElement {
  const li = document.createElement('li');
  li.dataset.id = row.id;
  const num = document.createElement('span');
  num.className = 'num';
  num.textContent = String(row.number);
  const name = document.createElement('span');
  name.textContent = `${row.key} · ${row.label} ${row.routeName}`;
  const badge = document.createElement('span');
  badge.className = `badge ${row.cover}`;
  badge.textContent = row.cover;
  li.append(num, name, badge);
  return li;
}
