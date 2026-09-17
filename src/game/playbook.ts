import { LOS_Z } from './constants';
import type { PlayerDef } from './types';

const L = LOS_Z;

/**
 * Gun Trips Right — Smash.
 * Concept: hitch outside, corner from the slot, backside go,
 * TE flat and RB checkdown as outlets.
 * Defense: 4-3 Cover 3 (CBs bail, SS underneath trips).
 */
export const SMASH: PlayerDef[] = [
  // --- Offensive line ---
  ol('lt', 'LT', 72, -4.6),
  ol('lg', 'LG', 70, -2.3),
  ol('c', 'C', 55, 0),
  ol('rg', 'RG', 66, 2.3),
  ol('rt', 'RT', 71, 4.6),

  {
    id: 'qb',
    label: 'QB',
    number: 7,
    pos: 'QB',
    side: 'offense',
    start: { x: 0.25, z: L - 5.1 },
    heading: 0
  },
  {
    id: 'rb',
    label: 'RB',
    number: 22,
    pos: 'RB',
    side: 'offense',
    start: { x: -4.6, z: L - 6.1 },
    heading: 0,
    eligible: true,
    key: '5',
    routeName: 'Flare',
    route: [
      { x: -4.6, z: L - 6.1, wait: 0.55, speed: 5.7 },
      { x: -9.5, z: L - 1.4, speed: 5.7 },
      { x: -15.5, z: L + 1.6, speed: 5.6 }
    ]
  },
  {
    id: 'te',
    label: 'TE',
    number: 87,
    pos: 'TE',
    side: 'offense',
    start: { x: 6.6, z: L - 0.42 },
    heading: 0,
    eligible: true,
    key: '4',
    routeName: 'Flat',
    route: [
      { x: 10.4, z: L + 1.8, speed: 5.0 },
      { x: 16.8, z: L + 3.4, speed: 5.2 }
    ]
  },
  {
    id: 'wrX',
    label: 'X',
    number: 18,
    pos: 'WR',
    side: 'offense',
    start: { x: -18.4, z: L - 0.9 },
    heading: 0,
    eligible: true,
    key: '3',
    routeName: 'Go',
    route: [
      { x: -18.6, z: L + 12, speed: 6.2 },
      { x: -19.2, z: L + 38, speed: 6.2 }
    ]
  },
  {
    id: 'wrH',
    label: 'Slot',
    number: 11,
    pos: 'WR',
    side: 'offense',
    start: { x: 8.2, z: L - 1.05 },
    heading: 0,
    eligible: true,
    key: '2',
    routeName: 'Corner',
    route: [
      { x: 8.2, z: L + 11.5, speed: 6.0 },
      { x: 18.4, z: L + 22.5, speed: 5.8 }
    ]
  },
  {
    id: 'wrZ',
    label: 'Z',
    number: 10,
    pos: 'WR',
    side: 'offense',
    start: { x: 19.2, z: L - 0.9 },
    heading: 0,
    eligible: true,
    key: '1',
    routeName: 'Hitch',
    route: [
      { x: 19.2, z: L + 6.1, speed: 5.9 },
      { x: 19.2, z: L + 6.1, wait: 8, speed: 0.2 }
    ]
  },

  // --- Defensive line (blocked DTs, contain DEs) ---
  {
    id: 'lde',
    label: 'DE',
    number: 94,
    pos: 'DL',
    side: 'defense',
    start: { x: -5.8, z: L + 0.72 },
    heading: Math.PI,
    route: [
      { x: -8.6, z: L + 3.2, speed: 3.0 },
      { x: -9.4, z: L + 0.6, speed: 2.8 },
      { x: -7.2, z: L - 2.8, speed: 2.6 },
      { x: -1.8, z: L - 5.0, speed: 2.4 }
    ]
  },
  {
    id: 'ldt',
    label: 'DT',
    number: 98,
    pos: 'DL',
    side: 'defense',
    start: { x: -1.55, z: L + 0.7 },
    heading: Math.PI,
    route: [
      { x: -1.35, z: L - 0.3, speed: 2.3 },
      { x: -1.2, z: L - 1.15, speed: 1.9 }
    ]
  },
  {
    id: 'rdt',
    label: 'DT',
    number: 91,
    pos: 'DL',
    side: 'defense',
    start: { x: 1.55, z: L + 0.7 },
    heading: Math.PI,
    route: [
      { x: 1.35, z: L - 0.3, speed: 2.3 },
      { x: 1.15, z: L - 1.15, speed: 1.9 }
    ]
  },
  {
    id: 'rde',
    label: 'DE',
    number: 52,
    pos: 'DL',
    side: 'defense',
    start: { x: 5.8, z: L + 0.72 },
    heading: Math.PI,
    route: [
      { x: 8.6, z: L + 3.2, speed: 3.0 },
      { x: 9.4, z: L + 0.6, speed: 2.8 },
      { x: 7.2, z: L - 2.8, speed: 2.6 },
      { x: 1.8, z: L - 5.0, speed: 2.4 }
    ]
  },

  // --- Linebackers: Cover 3 hook / curl-flat ---
  {
    id: 'wlb',
    label: 'WLB',
    number: 54,
    pos: 'LB',
    side: 'defense',
    start: { x: -5.8, z: L + 4.4 },
    heading: Math.PI,
    route: [
      { x: -9.2, z: L + 6.6, speed: 4.9 }
    ]
  },
  {
    id: 'mlb',
    label: 'MLB',
    number: 45,
    pos: 'LB',
    side: 'defense',
    start: { x: 0.2, z: L + 4.8 },
    heading: Math.PI,
    route: [
      { x: 0.4, z: L + 9.4, speed: 4.6 }
    ]
  },
  {
    id: 'slb',
    label: 'SLB',
    number: 43,
    pos: 'LB',
    side: 'defense',
    start: { x: 5.6, z: L + 4.4 },
    heading: Math.PI,
    route: [
      { x: 9.4, z: L + 6.8, speed: 5.0 }
    ]
  },

  // --- Secondary: Cover 3 ---
  {
    id: 'lcb',
    label: 'CB',
    number: 23,
    pos: 'CB',
    side: 'defense',
    start: { x: -18.2, z: L + 6.8 },
    heading: Math.PI,
    route: [
      { x: -16.4, z: L + 20.5, speed: 5.8 }
    ]
  },
  {
    id: 'rcb',
    label: 'CB',
    number: 21,
    pos: 'CB',
    side: 'defense',
    start: { x: 19.0, z: L + 6.6 },
    heading: Math.PI,
    route: [
      { x: 16.8, z: L + 20.8, speed: 5.9 }
    ]
  },
  {
    id: 'fs',
    label: 'FS',
    number: 20,
    pos: 'S',
    side: 'defense',
    start: { x: -2.4, z: L + 13.5 },
    heading: Math.PI,
    route: [
      { x: -1.0, z: L + 23.5, speed: 5.6 }
    ]
  },
  {
    id: 'ss',
    label: 'SS',
    number: 27,
    pos: 'S',
    side: 'defense',
    start: { x: 8.4, z: L + 11.2 },
    heading: Math.PI,
    route: [
      { x: 9.6, z: L + 12.8, speed: 5.4 },
      { x: 13.2, z: L + 16.4, speed: 5.3 }
    ]
  }
];

function ol(
  id: string,
  label: string,
  number: number,
  x: number
): PlayerDef {
  return {
    id,
    label,
    number,
    pos: 'OL',
    side: 'offense',
    start: { x, z: L - 0.42 },
    heading: 0,
    route: [{ x, z: L - 1.35, speed: 1.8 }]
  };
}

export const THROW_ORDER = [
  'wrZ',
  'wrH',
  'wrX',
  'te',
  'rb'
] as const;
