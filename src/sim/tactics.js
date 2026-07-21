// Tactical model: converts a squad's tactic sliders into a numeric profile, and computes
// each player's positional "anchor" (where they want to be when not directly on the ball).
import { PITCH } from './const.js';
import { clamp } from '../core/util.js';

const MENTALITY = { defensive: 0.25, balanced: 0.5, attacking: 0.8 };
const STYLE = {
  possession: { directness: 0.25, patience: 0.8 },
  balanced:   { directness: 0.5, patience: 0.5 },
  counter:    { directness: 0.7, patience: 0.35 },
  direct:     { directness: 0.9, patience: 0.2 },
};

export function buildProfile(tactics = {}) {
  const style = STYLE[tactics.style] || STYLE.balanced;
  return {
    attack: MENTALITY[tactics.mentality] ?? 0.5,
    press: (tactics.pressing ?? 55) / 100,
    tempo: (tactics.tempo ?? 55) / 100,
    width: (tactics.width ?? 55) / 100,
    line: (tactics.line ?? 52) / 100,
    directness: style.directness,
    patience: style.patience,
  };
}

// How strongly each role tracks the ball longitudinally / laterally.
const FOLLOW_Y = { GK: 0.08, CB: 0.34, FB: 0.46, DM: 0.5, CM: 0.6, AM: 0.68, W: 0.6, ST: 0.55 };
const FOLLOW_X = { GK: 0.14, CB: 0.26, FB: 0.5, DM: 0.3, CM: 0.34, AM: 0.36, W: 0.3, ST: 0.28 };
// Normalised advancement bands per role (0 = own goal line, 1 = opponent goal line).
const BAND = {
  GK: [0.02, 0.16], CB: [0.05, 0.6], FB: [0.06, 0.82], DM: [0.2, 0.72],
  CM: [0.22, 0.86], AM: [0.3, 0.96], W: [0.24, 0.96], ST: [0.4, 0.99],
};

const progToY = (team, n) => (team === 0 ? n * PITCH.L : (1 - n) * PITCH.L);
const yToProg = (team, y) => (team === 0 ? y / PITCH.L : 1 - y / PITCH.L);

/** Precompute a player's mirrored formation home in pitch coords + width scaling. */
export function formationHome(slot, team, widthFactor) {
  const nx = team === 0 ? slot.x : 1 - slot.x;
  const ny = team === 0 ? slot.y : 1 - slot.y;
  let hx = PITCH.W / 2 + (nx - 0.5) * PITCH.W * widthFactor;
  const hy = ny * PITCH.L;
  return { x: clamp(hx, 1.5, PITCH.W - 1.5), y: hy };
}

/**
 * Compute where player p wants to be right now (its anchor), given the ball and possession.
 * Off-ball runs are layered on top of this by ai.js.
 */
export function computeAnchor(engine, p) {
  const ball = engine.ball;
  const prof = engine.profiles[p.team];
  const inPoss = engine.possessionTeam === p.team;
  const g = p.group;
  const fy = FOLLOW_Y[g] ?? 0.5;
  const fx = FOLLOW_X[g] ?? 0.3;
  const d = p.dir;

  let ty = p.home.y + (ball.y - p.home.y) * fy;
  let tx = p.home.x + (ball.x - PITCH.W / 2) * fx;

  // Phase push along the attacking direction.
  const push = inPoss ? (0.05 + prof.attack * 0.09) : -(0.015 + (1 - prof.line) * 0.05);
  ty += d * push * PITCH.L;

  // Higher defensive line when pressing / attacking mentality (defending phase).
  if (!inPoss) ty += d * (prof.line - 0.5) * 0.18 * PITCH.L;

  // Clamp to the role's advancement band.
  let n = yToProg(p.team, ty);
  const band = BAND[g] || [0.1, 0.9];
  n = clamp(n, band[0], band[1]);
  ty = progToY(p.team, n);

  // Keep on pitch.
  tx = clamp(tx, 2, PITCH.W - 2);
  ty = clamp(ty, 2, PITCH.L - 2);
  return { x: tx, y: ty };
}
