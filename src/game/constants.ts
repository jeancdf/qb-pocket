/** One world unit = one yard. */
export const FIELD_LEN = 120;
export const FIELD_WID = 53.33;
export const ENDZONE = 10;
export const HALF_W = FIELD_WID / 2;
export const HALF_L = FIELD_LEN / 2;
export const HASH = 3.083;

/** Playbook is authored at own 40 (z = -10). */
export const LOS_Z = -10;
/** North goal line the offense attacks. */
export const GOAL_Z = 50;
export const BACK_GOAL_Z = -50;
/** Opening spot: own 10. Goal is 90 yards away (z = 50). */
export const DRIVE_START_Z = -40;

export const GRAVITY = 10.73;
export const BALL_MASS = 0.41;
export const BALL_DRAG = 0.006;
/** ~4.2× a WR at 9 yd/s; camera-feel above NFL 24–30 yd/s. */
export const THROW_SPEED = 38;
export const CATCH_RADIUS = 1.85;
export const OPEN_YARDS = 4.4;
export const WINDOW_YARDS = 2.7;
export const SACK_TIME = 4.8;
export const SACK_RANGE = 1.2;
/** After-catch pace — pads, not an arcade sprint. */
export const YAC_SPEED = 5.7;
export const YAC_TIME = 2.85;
export const TACKLE_RANGE = 1.42;
export const CATCH_HEIGHT_MIN = 0.45;
export const CATCH_HEIGHT_MAX = 2.85;

export const COLORS = {
  grassA: 0x2f7a3a,
  grassB: 0x276b33,
  endzone: 0x123056,
  line: 0xf4efe4,
  navy: 0x0d2a4a,
  silver: 0xc9d0da,
  white: 0xf2f5f8,
  skin: 0xc68642,
  helmetOff: 0x0b1d36,
  helmetDef: 0xb8c2ce,
  gold: 0xe8c547,
  post: 0xf0c43a,
  sky: 0x7d98b3,
  fog: 0x8aa3b8
};
