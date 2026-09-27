import type { PlayerActor } from './players';

/** Body radius in yards; 2× stays under SACK_RANGE so sacks land. */
const BODY_R = 0.38;
const PASSES = 2;

/**
 * Push overlapping players apart after everyone has moved, so bodies
 * stop running through each other. `skip` exempts pairs that are
 * meant to touch (a tackle in progress).
 */
export function separatePlayers(
  players: PlayerActor[],
  skip: (a: PlayerActor, b: PlayerActor) => boolean
): void {
  const min = BODY_R * 2;
  const touched = new Set<PlayerActor>();
  for (let pass = 0; pass < PASSES; pass += 1) {
    for (let i = 0; i < players.length; i += 1) {
      const a = players[i];
      if (a.isDown()) {
        continue;
      }
      for (let j = i + 1; j < players.length; j += 1) {
        const b = players[j];
        if (b.isDown() || skip(a, b)) {
          continue;
        }
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        let d = Math.hypot(dx, dz);
        if (d >= min) {
          continue;
        }
        if (d < 1e-4) {
          // Stacked exactly: split them sideways.
          dx = 1;
          dz = 0;
          d = 1;
        }
        const nx = dx / d;
        const nz = dz / d;
        const half = (min - Math.min(d, min)) * 0.5;
        a.bump(-nx * half, -nz * half, nx, nz);
        b.bump(nx * half, nz * half, -nx, -nz);
        touched.add(a);
        touched.add(b);
      }
    }
  }
  for (const p of touched) {
    p.place();
  }
}
