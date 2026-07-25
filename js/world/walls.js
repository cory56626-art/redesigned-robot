// Summoner Realms — background wall layer.
//
// Walls sit *behind* tiles. Natural terrain is generated with a wall behind every
// solid tile, so when a cave is carved out of the rock the wall stays and the
// cave reads as an enclosed space rather than a hole into the sky. This is the
// single biggest reason Terraria's underground looks like underground.
//
// Walls also gate sky light: an air tile with a wall behind it never receives
// daylight, even if nothing solid is above it (see World.computeLightWindow).
//
// Ids are part of the save format: only ever append new ones.

export const W = {
  NONE: 0,
  DIRT: 1,
  STONE: 2,
  DEEPSTONE: 3,
  SNOW: 4,
  SANDSTONE: 5,
  BLIGHT: 6,
  CLAY: 7,
};

// color   : base colour before the renderer's depth shading.
// blastResist: minimum explosion power that removes the wall (see tiles.js).
export const WALLS = {
  [W.NONE]:      { name: 'Open Air', color: null, blastResist: 0 },
  [W.DIRT]:      { name: 'Dirt Wall', color: '#43301d', blastResist: 0 },
  [W.STONE]:     { name: 'Stone Wall', color: '#3d414c', blastResist: 1 },
  [W.DEEPSTONE]: { name: 'Deepstone Wall', color: '#2c2934', blastResist: 2 },
  [W.SNOW]:      { name: 'Snowpack Wall', color: '#7d8a9c', blastResist: 0 },
  [W.SANDSTONE]: { name: 'Sandstone Wall', color: '#6d5c3b', blastResist: 1 },
  [W.BLIGHT]:    { name: 'Blightstone Wall', color: '#2b1b3c', blastResist: 2 },
  [W.CLAY]:      { name: 'Clay Wall', color: '#5a3628', blastResist: 0 },
};

export function wallDef(id) { return WALLS[id] || WALLS[W.NONE]; }
export function hasWall(id) { return id !== W.NONE && !!WALLS[id]; }
export function wallBlastResist(id) {
  const d = WALLS[id];
  if (!d) return 3;
  return d.blastResist == null ? 1 : d.blastResist;
}

export const MAX_WALL_ID = Math.max(...Object.keys(WALLS).map(Number));
