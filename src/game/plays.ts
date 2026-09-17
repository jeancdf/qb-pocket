import { LOS_Z } from './constants';
import type { RoutePoint, Vec2 } from './types';

const L = LOS_Z;
/** Live stems sit in the slower playbook band (~5–6 yd/s). */
const ROUTE_SPEED_SCALE = 0.95;

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
  const pacedRoute = route.map((point) => ({
    ...point,
    speed: point.speed === undefined
      ? undefined
      : point.speed * ROUTE_SPEED_SCALE
  }));
  return { start: { x, z }, routeName: name, route: pacedRoute };
}

/** Slot jet across the formation before the snap. */
const JET: RoutePoint[] = [
  { x: 8.2, z: L - 1.05, speed: 5.0 },
  { x: -8.6, z: L - 1.15, speed: 5.0 }
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
        { x: 19.0, z: L + 2.4, speed: 5.8 },
        { x: 19.1, z: L + 6.8, speed: 6.0 },
        { x: 18.6, z: L + 5.3, wait: 8, speed: 3.9 }
      ]),
      wrH: pack(8.2, L - 1.05, 'Corner', [
        { x: 8.0, z: L + 3.5, speed: 5.8 },
        { x: 7.7, z: L + 10.8, speed: 6.1 },
        { x: 10.0, z: L + 13.2, speed: 5.3 },
        { x: 19.2, z: L + 22.5, speed: 5.8 }
      ]),
      wrX: pack(-18.4, L - 0.9, 'Go', [
        { x: -19.1, z: L + 3.5, speed: 6.0 },
        { x: -19.0, z: L + 14.0, speed: 6.3 },
        { x: -18.3, z: L + 38.0, speed: 6.3 }
      ]),
      te: pack(6.6, L - 0.42, 'Flat', [
        { x: 7.3, z: L + 0.8, speed: 4.8 },
        { x: 11.6, z: L + 2.2, speed: 5.1 },
        { x: 17.8, z: L + 3.2, speed: 5.2 }
      ]),
      rb: pack(-4.6, L - 6.1, 'Flare', [
        { x: -4.6, z: L - 6.1, wait: 0.55, speed: 5.7 },
        { x: -6.1, z: L - 4.7, speed: 5.1 },
        { x: -10.4, z: L - 0.9, speed: 5.6 },
        { x: -16.2, z: L + 2.4, speed: 5.6 }
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
        { x: 19.7, z: L + 1.2, speed: 5.8 },
        { x: 16.8, z: L + 3.3, speed: 5.6 },
        { x: 7.0, z: L + 11.2, speed: 5.9 }
      ]),
      wrH: pack(8.2, L - 1.05, 'Slant', [
        { x: 8.5, z: L + 1.3, speed: 5.6 },
        { x: 5.6, z: L + 3.9, speed: 5.6 },
        { x: -3.2, z: L + 11.2, speed: 5.8 }
      ]),
      wrX: pack(-18.4, L - 0.9, 'Slant', [
        { x: -19.0, z: L + 1.2, speed: 5.8 },
        { x: -16.1, z: L + 3.5, speed: 5.6 },
        { x: -6.2, z: L + 11.4, speed: 5.9 }
      ]),
      te: pack(6.6, L - 0.42, 'Drag', [
        { x: 6.7, z: L + 1.6, speed: 5.0 },
        { x: 4.7, z: L + 3.8, speed: 4.9 },
        { x: -9.5, z: L + 5.8, speed: 5.2 }
      ]),
      rb: pack(-4.6, L - 6.1, 'Swing', [
        { x: -4.6, z: L - 6.1, wait: 0.35, speed: 5.4 },
        { x: -6.2, z: L - 4.8, speed: 5.0 },
        { x: -11.2, z: L - 0.5, speed: 5.5 },
        { x: -17.0, z: L + 1.8, speed: 5.6 }
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
        { x: 19.8, z: L + 3.6, speed: 6.0 },
        { x: 19.6, z: L + 15.0, speed: 6.3 },
        { x: 18.9, z: L + 37.0, speed: 6.3 }
      ]),
      wrH: pack(8.2, L - 1.05, 'Out', [
        { x: 8.0, z: L + 3.4, speed: 5.7 },
        { x: 7.6, z: L + 11.8, speed: 6.0 },
        { x: 10.4, z: L + 12.2, speed: 5.0 },
        { x: 19.0, z: L + 12.3, speed: 5.7 }
      ]),
      wrX: pack(-18.4, L - 0.9, 'Comeback', [
        { x: -19.1, z: L + 3.2, speed: 5.8 },
        { x: -18.6, z: L + 15.5, speed: 6.1 },
        { x: -20.0, z: L + 11.8, wait: 6, speed: 4.4 }
      ]),
      te: pack(6.6, L - 0.42, 'Corner', [
        { x: 6.8, z: L + 3.2, speed: 5.2 },
        { x: 7.8, z: L + 9.0, speed: 5.5 },
        { x: 10.5, z: L + 12.0, speed: 5.0 },
        { x: 17.5, z: L + 20.5, speed: 5.5 }
      ]),
      rb: pack(-4.6, L - 6.1, 'Check', [
        { x: -4.6, z: L - 6.1, wait: 0.45, speed: 5.3 },
        { x: -5.5, z: L - 4.5, speed: 4.9 },
        { x: -9.0, z: L - 0.8, speed: 5.3 },
        { x: -13.0, z: L + 1.0, speed: 5.2 }
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
      wrZ: pack(19.2, L - 0.9, 'Corner', [
        { x: 19.8, z: L + 3.0, speed: 5.8 },
        { x: 19.5, z: L + 11.0, speed: 6.1 },
        { x: 24.2, z: L + 19.0, speed: 5.9 }
      ]),
      wrH: pack(8.2, L - 1.05, 'Mesh', [
        { x: 8.4, z: L + 1.8, speed: 5.6 },
        { x: 6.2, z: L + 3.7, speed: 5.4 },
        { x: 0.8, z: L + 5.0, speed: 5.5 },
        { x: -11.5, z: L + 5.8, speed: 5.6 }
      ]),
      wrX: pack(-18.4, L - 0.9, 'Mesh', [
        { x: -18.8, z: L + 1.5, speed: 5.7 },
        { x: -15.8, z: L + 4.6, speed: 5.5 },
        { x: -2.0, z: L + 6.3, speed: 5.8 },
        { x: 12.0, z: L + 6.9, speed: 5.8 }
      ]),
      te: pack(6.6, L - 0.42, 'Sit', [
        { x: 6.4, z: L + 2.6, speed: 5.1 },
        { x: 4.5, z: L + 6.5, speed: 5.2 },
        { x: 2.8, z: L + 7.8, wait: 8, speed: 3.8 }
      ]),
      rb: pack(-4.6, L - 6.1, 'Leak', [
        { x: -4.6, z: L - 6.1, wait: 0.45, speed: 5.3 },
        { x: -2.2, z: L - 3.8, speed: 5.1 },
        { x: 5.5, z: L + 1.8, speed: 5.5 },
        { x: 9.5, z: L + 7.5, speed: 5.6 }
      ])
    }
  }
];
