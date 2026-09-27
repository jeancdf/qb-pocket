/**
 * Extra defensive calls on top of Cover 3 / Cover 2:
 * - COVER 1      : man under, FS deep middle, Mike robber.
 * - COVER 1 BLITZ: same shell, Mike blitzes.
 * - COVER 0      : all-out man, Mike + Will blitz, nobody deep.
 * - COVER 4      : quarters, four deep, three under.
 * - COVER 3 FIRE : zone blitz, strong safety comes off the edge.
 *
 * Man defenders align on whoever they cover, so starts are
 * computed from the called play (see lookStarts).
 */

import { LOS_Z } from './constants';
import {
  COVER2,
  COVER3,
  type CoverLook,
  type Job
} from './coverage-play';
import type { OffPlay } from './plays';
import type { Vec2 } from './types';

const L = LOS_Z;

function man(
  id: string,
  match: string,
  spd: number,
  levX: number,
  levZ: number,
  press: number
): Job {
  return {
    id,
    match,
    zone: 'middleHook',
    kind: 'man',
    levX,
    levZ,
    spd,
    minRel: 0,
    maxRel: 60,
    anticipate: 0.12,
    press
  };
}

const MAN_CB_L = man('lcb', 'wrX', 6.05, 0.7, 0.55, 1.6);
const MAN_CB_R = man('rcb', 'wrZ', 6.05, 0.7, 0.55, 1.6);
const MAN_NICKEL = man('ss', 'wrH', 5.85, 0.55, 0.45, 4.2);
const MAN_TE = man('slb', 'te', 5.45, 0.4, 0.25, 3.8);
const MAN_RB = man('wlb', 'rb', 5.4, 0.35, 0.2, 4.4);

const FREE_SAFETY: Job = {
  id: 'fs',
  match: 'wrH',
  zone: 'deepMiddle',
  levX: 0,
  levZ: 4.2,
  spd: 5.9,
  minRel: 12,
  maxRel: 42,
  anticipate: 0.8,
  reads: 1
};

const ROBBER: Job = {
  id: 'mlb',
  match: 'te',
  zone: 'middleHook',
  levX: 0,
  levZ: -0.6,
  spd: 5.15,
  minRel: 4,
  maxRel: 12,
  anticipate: 0.5,
  reads: 1
};

export const COVER1: CoverLook = {
  id: 'c1',
  name: 'COVER 1',
  jobs: [MAN_CB_L, MAN_CB_R, MAN_NICKEL, MAN_TE, MAN_RB,
    FREE_SAFETY, ROBBER],
  spy: false,
  starts: {
    fs: { x: 0.4, z: L + 14.5 },
    mlb: { x: 0.2, z: L + 5.2 }
  }
};

export const COVER1_BLITZ: CoverLook = {
  id: 'c1b',
  name: 'COVER 1 · BLITZ',
  jobs: [MAN_CB_L, MAN_CB_R, MAN_NICKEL, MAN_TE, MAN_RB,
    FREE_SAFETY],
  rush: ['mlb'],
  starts: {
    fs: { x: 0.4, z: L + 14.5 },
    mlb: { x: -1.2, z: L + 3.4 }
  }
};

export const COVER0: CoverLook = {
  id: 'c0',
  name: 'COVER 0 · BLITZ',
  jobs: [
    MAN_CB_L,
    MAN_CB_R,
    MAN_NICKEL,
    man('fs', 'te', 5.6, 0.4, 0.5, 6.5),
    man('slb', 'rb', 5.4, 0.35, 0.2, 4.4)
  ],
  rush: ['mlb', 'wlb'],
  starts: {
    mlb: { x: 1.1, z: L + 2.6 },
    wlb: { x: -3.4, z: L + 2.8 }
  }
};

export const COVER4: CoverLook = {
  id: 'c4',
  name: 'COVER 4',
  jobs: [
    {
      id: 'lcb',
      match: 'wrX',
      zone: 'quarterLeft',
      levX: 0.9,
      levZ: 2.6,
      spd: 6.0,
      minRel: 6,
      maxRel: 44,
      anticipate: 0.6
    },
    {
      id: 'rcb',
      match: 'wrZ',
      zone: 'quarterRight',
      levX: -0.9,
      levZ: 2.6,
      spd: 6.0,
      minRel: 6,
      maxRel: 44,
      anticipate: 0.6
    },
    {
      id: 'fs',
      match: 'wrX',
      zone: 'quarterMidLeft',
      levX: 0.4,
      levZ: 3.0,
      spd: 5.85,
      minRel: 9,
      maxRel: 40,
      anticipate: 0.7,
      reads: 0.85
    },
    {
      id: 'ss',
      match: 'wrH',
      zone: 'quarterMidRight',
      levX: -0.4,
      levZ: 3.0,
      spd: 5.8,
      minRel: 9,
      maxRel: 40,
      anticipate: 0.7,
      reads: 0.85
    },
    {
      id: 'slb',
      match: 'te',
      zone: 'rightFlat',
      levX: 0.45,
      levZ: 0.8,
      spd: 5.15,
      minRel: 2.5,
      maxRel: 10,
      anticipate: 0.4
    },
    {
      id: 'wlb',
      match: 'rb',
      zone: 'leftFlat',
      levX: -0.5,
      levZ: 0.8,
      spd: 5.1,
      minRel: 2,
      maxRel: 10,
      anticipate: 0.4
    }
  ],
  starts: {
    lcb: { x: -17.6, z: L + 7.4 },
    rcb: { x: 18.4, z: L + 7.2 },
    fs: { x: -6.8, z: L + 10.5 },
    ss: { x: 6.8, z: L + 10.5 },
    wlb: { x: -5.4, z: L + 4.4 },
    mlb: { x: 0.2, z: L + 4.8 },
    slb: { x: 5.4, z: L + 4.4 }
  }
};

export const COVER3_FIRE: CoverLook = {
  id: 'c3f',
  name: 'COVER 3 · FIRE',
  jobs: [
    ...COVER3.jobs.filter((j) => j.id !== 'ss'),
    {
      id: 'mlb',
      match: 'wrH',
      zone: 'middleHook',
      levX: 0,
      levZ: 0.6,
      spd: 5.2,
      minRel: 4,
      maxRel: 12,
      anticipate: 0.45
    }
  ],
  rush: ['ss'],
  spy: false,
  starts: {
    ...COVER3.starts,
    fs: { x: 0.2, z: L + 13.8 },
    ss: { x: 7.4, z: L + 5.2 }
  }
};

const MENU: Array<[CoverLook, number]> = [
  [COVER3, 0.2],
  [COVER2, 0.16],
  [COVER4, 0.16],
  [COVER1, 0.16],
  [COVER1_BLITZ, 0.11],
  [COVER3_FIRE, 0.11],
  [COVER0, 0.1]
];

/** Weighted random call for the next snap. */
export function pickLook(): CoverLook {
  const total = MENU.reduce((s, [, w]) => s + w, 0);
  let roll = Math.random() * total;
  for (const [look, w] of MENU) {
    roll -= w;
    if (roll <= 0) {
      return look;
    }
  }
  return COVER3;
}

/**
 * Where each defender lines up for this play: the look's fixed
 * spots, plus man defenders over the receiver they cover.
 */
export function lookStarts(
  look: CoverLook,
  play: OffPlay
): Record<string, Vec2> {
  const starts: Record<string, Vec2> = { ...look.starts };
  for (const job of look.jobs) {
    if (job.kind !== 'man') {
      continue;
    }
    const wr = play.skill[job.match]?.start;
    if (!wr) {
      continue;
    }
    const inside = -Math.sign(wr.x) || 1;
    const backfield = wr.z < L - 2;
    starts[job.id] = {
      x: backfield ? wr.x * 0.55 : wr.x + inside * job.levX,
      z: L + (job.press ?? 3)
    };
  }
  return starts;
}
