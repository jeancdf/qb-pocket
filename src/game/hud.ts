import type { CoverGrade } from './types';

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

  constructor() {
    this.list = el('receiver-list');
    this.statusEl = el('status');
    this.snapBtn = el('snap-btn') as HTMLButtonElement;
    this.toastEl = el('toast');
    this.pocketEl = el('pocket');
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
    this.toastEl.hidden = false;
    this.toastEl.textContent = text;
    this.toastEl.classList.toggle('is-bad', bad);
    window.setTimeout(() => {
      this.toastEl.hidden = true;
    }, 1600);
  }

  setReceivers(rows: HudRow[]): void {
    this.list.replaceChildren();
    for (const row of rows) {
      this.list.append(rowNode(row));
    }
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
