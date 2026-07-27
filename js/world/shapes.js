// Summoner Realms — per-tile block shapes (the hammer layer).
//
// A tile's *identity* lives in the tile grid; its *shape* lives here, in a
// parallel byte per tile. A hammer cycles a solid block through half-blocks and
// the four slope orientations, exactly like Terraria's, and both the renderer
// and the collision resolver read the same value — so a slope you can see is a
// slope you can walk up.
//
// Ids are part of the save format: only ever append new ones.

export const SH = {
  FULL: 0,
  HALF_BOTTOM: 1, // solid lower half — the common "half block"
  HALF_TOP: 2,    // solid upper half
  // Slopes are named for the corner that stays *filled*, so SLOPE_NE is a ramp
  // whose high side is the top-right: you walk up it moving right.
  SLOPE_NE: 3,
  SLOPE_NW: 4,
  SLOPE_SE: 5,
  SLOPE_SW: 6,
};

export const MAX_SHAPE_ID = 6;

// The order a hammer walks through when you keep hitting the same tile. Ends
// back at FULL so a mistake is always one more swing away from undone.
export const HAMMER_CYCLE = [
  SH.FULL, SH.HALF_BOTTOM, SH.SLOPE_NE, SH.SLOPE_NW, SH.SLOPE_SE, SH.SLOPE_SW, SH.HALF_TOP,
];

export function nextShape(shape) {
  const i = HAMMER_CYCLE.indexOf(shape);
  return HAMMER_CYCLE[(i < 0 ? 0 : i + 1) % HAMMER_CYCLE.length];
}

export function isSlope(shape) {
  return shape >= SH.SLOPE_NE && shape <= SH.SLOPE_SW;
}
export function isHalf(shape) {
  return shape === SH.HALF_BOTTOM || shape === SH.HALF_TOP;
}

// Does this shape have a filled top edge? Used by the "is there floor here"
// tests that AI navigation and spawning rely on.
export function fillsTop(shape) {
  return shape === SH.FULL || shape === SH.HALF_TOP ||
    shape === SH.SLOPE_NE || shape === SH.SLOPE_NW;
}

/**
 * Height of solid material at a horizontal position inside one tile.
 *
 * @param shape one of SH.*
 * @param fx    0..1 across the tile, left to right
 * @returns     the y offset (0..1, measured down from the tile's top edge) of
 *              the *surface* of the solid, and 1 for "no solid at all here".
 *              A full block returns 0 (solid from the very top).
 */
export function surfaceOffset(shape, fx) {
  switch (shape) {
    case SH.FULL: return 0;
    case SH.HALF_BOTTOM: return 0.5;
    case SH.HALF_TOP: return 0;      // solid starts at the top; its *bottom* is the gap
    case SH.SLOPE_NE: return 1 - fx; // rises to the right
    case SH.SLOPE_NW: return fx;     // rises to the left
    // Down-slopes hang from the ceiling: nothing to stand on inside the tile.
    case SH.SLOPE_SE: return 1;
    case SH.SLOPE_SW: return 1;
    default: return 0;
  }
}

/**
 * Is the point (fx, fy) — both 0..1 within the tile — inside the solid part?
 * This is the authoritative test; everything else is a convenience over it.
 */
export function shapeContains(shape, fx, fy) {
  switch (shape) {
    case SH.FULL: return true;
    case SH.HALF_BOTTOM: return fy >= 0.5;
    case SH.HALF_TOP: return fy <= 0.5;
    case SH.SLOPE_NE: return fy >= 1 - fx; // filled toward the top-right
    case SH.SLOPE_NW: return fy >= fx;     // filled toward the top-left
    case SH.SLOPE_SE: return fy <= fx;     // filled toward the bottom-right
    case SH.SLOPE_SW: return fy <= 1 - fx; // filled toward the bottom-left
    default: return true;
  }
}

// A shape that isn't FULL never blocks a horizontal move outright — the
// resolver lifts the entity over it instead. Kept as its own predicate so the
// physics code reads as intent rather than as an id comparison.
export function isWalkOver(shape) {
  return shape !== SH.FULL;
}
