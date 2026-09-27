/** Pre-snap coaching text for the called play vs the look. */

import type { CoverLook } from './coverage-looks';
import type { OffPlay } from './plays';

/** Receiver the called play is built to throw. */
export function beatId(play: OffPlay): string {
  if (play.id === 'flood' || play.id === 'mesh') {
    return 'wrH';
  }
  return 'wrZ';
}

export function readHint(play: OffPlay, look: CoverLook): string {
  const id = play.id;
  const c3 = look.id === 'c3';
  const c2 = look.id === 'c2';
  if (c3 && id === 'smash') {
    return 'CBs bail — hitch is hot';
  }
  if (c2 && id === 'smash') {
    return 'CBs squat — audible Slants';
  }
  if (c2 && id === 'slants') {
    return 'Slants vs Cover 2';
  }
  if (c3 && id === 'flood') {
    return 'Flood the corner vs Cover 3';
  }
  if (id === 'mesh') {
    return 'Throw the crossing mesh';
  }
  if (look.rush?.length) {
    return 'Blitz look — find the hot route fast';
  }
  if (play.hint) {
    return play.hint;
  }
  return `${play.name} vs ${look.name}`;
}
