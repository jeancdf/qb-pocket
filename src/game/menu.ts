/** Every way to start a game from the title screen. */
export type GameMode = 'practice' | 'match' | 'career';

interface ModeCard {
  mode: GameMode;
  kicker: string;
  title: string;
  blurb: string;
  ready: boolean;
}

const CARDS: ModeCard[] = [
  {
    mode: 'career',
    kicker: '5 matchs',
    title: 'CARRIÈRE',
    blurb:
      'Une mini saison : chaque adversaire est plus fort que le précédent.',
    ready: false
  },
  {
    mode: 'match',
    kicker: 'Match rapide',
    title: 'MATCH',
    blurb:
      'Attaque puis défense, possessions qui alternent, chrono et score.',
    ready: false
  },
  {
    mode: 'practice',
    kicker: 'Entraînement',
    title: 'LANCER',
    blurb:
      'Un drive depuis tes 10 yards. Lis la défense et marque.',
    ready: true
  }
];

/** Title screen overlay: pick a mode, come back with MENU / Esc. */
export class Menu {
  private readonly root: HTMLElement;
  private readonly modes: HTMLElement;
  private pick?: (mode: GameMode) => void;

  constructor() {
    this.root = el('menu');
    this.modes = el('menu-modes');
    this.render();
    this.open();
    this.modes.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest('button');
      const mode = btn?.dataset.mode as GameMode | undefined;
      if (mode && !btn?.disabled) {
        this.close();
        this.pick?.(mode);
      }
    });
  }

  onPick(fn: (mode: GameMode) => void): void {
    this.pick = fn;
  }

  isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.root.hidden = false;
    document.body.classList.add('in-menu');
  }

  close(): void {
    this.root.hidden = true;
    document.body.classList.remove('in-menu');
  }

  private render(): void {
    this.modes.replaceChildren(
      ...CARDS.map((card) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mode-card';
        btn.dataset.mode = card.mode;
        btn.disabled = !card.ready;
        const kick = document.createElement('span');
        kick.className = 'mode-card__kicker';
        kick.textContent = card.ready ? card.kicker : `${card.kicker} · bientôt`;
        const title = document.createElement('span');
        title.className = 'mode-card__title';
        title.textContent = card.title;
        const blurb = document.createElement('span');
        blurb.className = 'mode-card__blurb';
        blurb.textContent = card.blurb;
        btn.append(kick, title, blurb);
        return btn;
      })
    );
  }
}

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing #${id}`);
  }
  return node;
}
