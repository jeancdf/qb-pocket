import { LOS_Z } from './constants';
import type { RoutePoint, Vec2 } from './types';

const L = LOS_Z;

export interface SkillPack {
  start: Vec2;
  route: RoutePoint[];
  routeName: string;
}

export interface OffPlay {
  id: string;
  name: string;
  form: string;
  beat: string;
  motionId: string;
  motion: RoutePoint[];
  skill: Record<string, SkillPack>;
}

function pack(
  x: number,
  z: number,
  name: string,
  route: RoutePoint[]
): SkillPack {
  return { start: { x, z }, routeName: name, route };
}

/** Slot jet across the formation before the snap. */
const JET: RoutePoint[] = [
  { x: 4.4, z: L - 1.1, speed: 6.8 },
  { x: -8.6, z: L - 1.15, speed: 6.8 }
];

export const PLAYS: OffPlay[] = [
  {
    id: 'smash',
    name: 'SMASH',
    form: 'GUN TRIPS RT',
    beat: 'Cover 3',
    motionId: 'wrH',
    motion: JET,
    skill: {
      wrZ: pack(19.2, L - 0.9, 'Hitch', [
        { x: 19.1, z: L + 5.5, speed: 8.3 },
        { x: 18.9, z: L + 6.6, speed: 5.8 },
        { x: 19.2, z: L + 6.1, wait: 8, speed: 3.2 }
      ]),
      wrH: pack(8.2, L - 1.05, 'Corner', [
        { x: 8.1, z: L + 9.6, speed: 8.5 },
        { x: 9.4, z: L + 12.1, speed: 6.2 },
        { x: 18.4, z: L + 22.5, speed: 8.6 }
      ]),
      wrX: pack(-18.4, L - 0.9, 'Go', [
        { x: -18.1, z: L + 2.8, speed: 7.6 },
        { x: -18.6, z: L + 12, speed: 8.9 },
        { x: -19.2, z: L + 38, speed: 9.2 }
      ]),
      te: pack(6.6, L - 0.42, 'Flat', [
        { x: 7.1, z: L + 0.8, speed: 5.6 },
        { x: 10.4, z: L + 1.8, speed: 7.4 },
        { x: 16.8, z: L + 3.4, speed: 7.6 }
      ]),
      rb: pack(-4.6, L - 6.1, 'Flare', [
        { x: -4.6, z: L - 6.1, wait: 0.55, speed: 8.4 },
        { x: -9.5, z: L - 1.4, speed: 8.4 },
        { x: -15.5, z: L + 1.6, speed: 8.2 }
      ])
    }
  },
  {
    id: 'slants',
    name: 'SLANTS',
    form: 'GUN TRIPS RT',
    beat: 'Cover 2',
    motionId: 'wrH',
    motion: JET,
    skill: {
      wrZ: pack(19.2, L - 0.9, 'Slant', [
        { x: 19.0, z: L + 2.1, speed: 8.4 },
        { x: 16.2, z: L + 4.2, speed: 7.1 },
        { x: 7.4, z: L + 10.6, speed: 8.5 }
      ]),
      wrH: pack(8.2, L - 1.05, 'Slant', [
        { x: 8.1, z: L + 2.0, speed: 8.1 },
        { x: 4.8, z: L + 4.0, speed: 6.9 },
        { x: -3.6, z: L + 10.2, speed: 8.3 }
      ]),
      wrX: pack(-18.4, L - 0.9, 'Slant', [
        { x: -18.2, z: L + 2.1, speed: 8.4 },
        { x: -15.2, z: L + 4.2, speed: 7.1 },
        { x: -6.6, z: L + 10.6, speed: 8.5 }
      ]),
      te: pack(6.6, L - 0.42, 'Drag', [
        { x: 1.4, z: L + 5.2, speed: 7.6 },
        { x: -8.5, z: L + 6.4, speed: 7.5 }
      ]),
      rb: pack(-4.6, L - 6.1, 'Swing', [
        { x: -10.2, z: L - 1.2, speed: 8.2 },
        { x: -16.4, z: L + 1.4, speed: 8.1 }
      ])
    }
  },
  {
    id: 'flood',
    name: 'FLOOD',
    form: 'GUN TRIPS RT',
    beat: 'Cover 3',
    motionId: 'wrH',
    motion: JET,
    skill: {
      wrZ: pack(19.2, L - 0.9, 'Go', [
        { x: 19.1, z: L + 3.2, speed: 7.8 },
        { x: 19.4, z: L + 14, speed: 9.0 },
        { x: 19.6, z: L + 36, speed: 9.1 }
      ]),
      wrH: pack(8.2, L - 1.05, 'Out', [
        { x: 8.1, z: L + 9.8, speed: 8.4 },
        { x: 10.2, z: L + 12.1, speed: 6.1 },
        { x: 18.6, z: L + 12.4, speed: 8.4 }
      ]),
      wrX: pack(-18.4, L - 0.9, 'Comeback', [
        { x: -18.6, z: L + 14.5, speed: 8.8 },
        { x: -18.1, z: L + 12.3, speed: 5.3 },
        { x: -18.4, z: L + 10.2, wait: 6, speed: 6.4 }
      ]),
      te: pack(6.6, L - 0.42, 'Corner', [
        { x: 6.8, z: L + 7.9, speed: 7.8 },
        { x: 8.8, z: L + 10.5, speed: 6.3 },
        { x: 16.8, z: L + 20.5, speed: 8.1 }
      ]),
      rb: pack(-4.6, L - 6.1, 'Check', [
        { x: -8.2, z: L - 1.6, speed: 7.8 },
        { x: -12.4, z: L + 0.8, speed: 7.6 }
      ])
    }
  },
  {
    id: 'mesh',
    name: 'MESH',
    form: 'GUN TRIPS RT',
    beat: 'Zone',
    motionId: 'wrH',
    motion: JET,
    skill: {
      wrZ: pack(19.2, L - 0.9, 'Hitch', [
        { x: 19.1, z: L + 5.6, speed: 8.3 },
        { x: 18.9, z: L + 6.6, speed: 5.8 },
        { x: 19.2, z: L + 6.1, wait: 8, speed: 3.2 }
      ]),
      wrH: pack(8.2, L - 1.05, 'Cross', [
        { x: 8.1, z: L + 4.7, speed: 8.1 },
        { x: 5.9, z: L + 6.3, speed: 6.6 },
        { x: -8.8, z: L + 8.4, speed: 8.3 }
      ]),
      wrX: pack(-18.4, L - 0.9, 'Post', [
        { x: -18.2, z: L + 11.8, speed: 8.8 },
        { x: -16.4, z: L + 15.2, speed: 6.6 },
        { x: -8.4, z: L + 28, speed: 8.9 }
      ]),
      te: pack(6.6, L - 0.42, 'Cross', [
        { x: 6.4, z: L + 4.2, speed: 7.5 },
        { x: 8.1, z: L + 5.7, speed: 6.1 },
        { x: 14.6, z: L + 7.6, speed: 7.7 }
      ]),
      rb: pack(-4.6, L - 6.1, 'Leak', [
        { x: -4.6, z: L - 6.1, wait: 0.7, speed: 8.0 },
        { x: 2.2, z: L + 4.8, speed: 8.1 }
      ])
    }
  }
];
