// Shared simulation constants. Pitch is modelled in metres.
export const PITCH = {
  L: 105,   // length (along y)
  W: 68,    // width (along x)
  GOAL_W: 7.32,
  GOAL_H: 2.44,
  MARGIN: 6, // run-off around the pitch used by the 3D world
};

export const HALF_SECONDS = 45 * 60; // game-seconds per half
export const MATCH_SECONDS = HALF_SECONDS * 2;

// Physics tick (game-seconds). The engine integrates in fixed steps of this size.
export const TICK = 1 / 30;

// Slower, readable 1x match pace. The match clock advances 2 game-seconds
// per real second, giving a 45-minute full match.
export const SIM_RATE = 2;

export const BALL = {
  friction: 0.86,
  gravity: 18,
  bounce: 0.55,
  radius: 0.35,
  controlRadius: 1.5,
};

export const PLAYER = {
  radius: 0.9,
  reach: 1.6,
};

export const goalCenterX = PITCH.W / 2;
export const goalMinX = PITCH.W / 2 - PITCH.GOAL_W / 2;
export const goalMaxX = PITCH.W / 2 + PITCH.GOAL_W / 2;

export const attackDir = (team) => (team === 0 ? 1 : -1);
export const ownGoalY = (team) => (team === 0 ? 0 : PITCH.L);
export const targetGoalY = (team) => (team === 0 ? PITCH.L : 0);
