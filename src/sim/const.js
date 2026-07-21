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

// At 1x speed, 9 game-seconds elapse per real second (~10 minutes for a full 90-minute match).
// This keeps normal speed readable; the speed controls can still accelerate the match.
export const SIM_RATE = 9;

export const BALL = {
  friction: 0.86,   // per second horizontal decay when rolling
  gravity: 18,      // m/s^2 (tuned for snappy arcs at match scale)
  bounce: 0.55,
  radius: 0.35,
  controlRadius: 1.5,
};

export const PLAYER = {
  radius: 0.9,
  reach: 1.6,
};

// Convenience goal geometry (centre x, mouth range).
export const goalCenterX = PITCH.W / 2;
export const goalMinX = PITCH.W / 2 - PITCH.GOAL_W / 2;
export const goalMaxX = PITCH.W / 2 + PITCH.GOAL_W / 2;

// Team 0 attacks toward y = L; team 1 attacks toward y = 0.
export const attackDir = (team) => (team === 0 ? 1 : -1);
export const ownGoalY = (team) => (team === 0 ? 0 : PITCH.L);
export const targetGoalY = (team) => (team === 0 ? PITCH.L : 0);
