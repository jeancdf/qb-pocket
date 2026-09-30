/**
 * Pose transitions by inertialization.
 *
 * When a rig switches animation (run -> plant -> scan, scan -> throw,
 * catch -> run, ...) the new pose is not snapped in. At the switch we
 * store the gap between what was on screen last frame and the new
 * target, then let that gap decay to zero. Cycles inside one animation
 * (run strides, rush shuffles) pass through untouched.
 *
 * Several writers can pose the same rig in one frame (auto locomotion,
 * then line play or the tackle override). Only the last write of a
 * frame decides the committed animation, so overrides never restart a
 * transition every frame.
 */

let frame = 0;
let clock = 0;

/** Call once per game tick, before anyone poses a rig. */
export function advancePoseClock(dt: number): void {
  frame += 1;
  clock += Math.max(0, dt);
}

interface BlendState {
  frame: number;
  time: number;
  /** Animation that owned the rig at the end of the last frame. */
  key: string;
  offset: number[];
  tau: number;
  prevOut: number[];
  lastKey: string;
  lastOffset: number[];
  lastTau: number;
  lastOut: number[];
}

const states = new WeakMap<object, BlendState>();

/** Seconds for the gap to shrink to ~37 %; keyed by the incoming anim. */
const TAU: Record<string, number> = {
  idle: 0.16,
  scan: 0.13,
  run: 0.09,
  dropback: 0.08,
  plant: 0.06,
  hitch: 0.08,
  passSet: 0.1,
  rush: 0.1,
  engage: 0.08,
  throw: 0.05,
  catch: 0.06,
  juke: 0.06,
  stumble: 0.07,
  tackle: 0.07,
  ragdoll: 0.07,
  spin: 0.06,
  stiffArm: 0.07,
  hurdle: 0.06,
  truck: 0.07,
  ground: 0.08
};

/** Bigger gaps get a little more time so a full-body swap reads. */
function tauFor(to: string, gap: number): number {
  const base = TAU[to] ?? 0.1;
  return base * (1 + Math.min(0.6, gap * 0.25));
}

/** Drop any in-flight transition, e.g. when the huddle resets. */
export function snapPose(owner: object): void {
  states.delete(owner);
}

/**
 * Returns the pose to display for `target` under animation `key`.
 * `target` is not mutated.
 */
export function blendPose(
  owner: object,
  key: string,
  target: number[]
): number[] {
  let st = states.get(owner);
  if (!st) {
    const zero = target.map(() => 0);
    st = {
      frame,
      time: clock,
      key,
      offset: zero,
      tau: 0.1,
      prevOut: target.slice(),
      lastKey: key,
      lastOffset: zero,
      lastTau: 0.1,
      lastOut: target.slice()
    };
    states.set(owner, st);
    return target.slice();
  }
  if (st.frame !== frame) {
    commit(st);
  }
  let offset = st.offset;
  let tau = st.tau;
  if (key !== st.key) {
    offset = st.prevOut.map((v, i) => v - target[i]);
    tau = tauFor(key, maxAbs(offset));
  }
  const out = target.map((v, i) => v + offset[i]);
  st.lastKey = key;
  st.lastOffset = offset;
  st.lastTau = tau;
  st.lastOut = out;
  return out;
}

function commit(st: BlendState): void {
  const elapsed = Math.max(0, clock - st.time);
  const k = Math.exp(-elapsed / Math.max(st.lastTau, 1e-3));
  st.key = st.lastKey;
  st.tau = st.lastTau;
  st.offset = st.lastOffset.map((v) => {
    const d = v * k;
    return Math.abs(d) < 1e-4 ? 0 : d;
  });
  st.prevOut = st.lastOut;
  st.frame = frame;
  st.time = clock;
}

function maxAbs(values: number[]): number {
  let m = 0;
  for (const v of values) {
    m = Math.max(m, Math.abs(v));
  }
  return m;
}
