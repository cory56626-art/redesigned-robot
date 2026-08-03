// Summoner Realms — tile definitions.
// id 0 is always air. `drop` is the item id produced when mined.
// `station` marks crafting stations that the crafting system detects nearby.
//
// Ids are part of the save format: only ever append new ones.

export const T = {
  AIR: 0,
  DIRT: 1,
  GRASS: 2,
  STONE: 3,
  WOOD: 4,
  LEAVES: 5,
  CLAY: 6,
  SAND: 7,
  CUPRITE: 8,
  IRONVEIN: 9,
  GLIMMER: 10,
  AETHERITE: 11,
  BLIGHTORE: 12,
  BLIGHTGRASS: 13,
  BLIGHTSTONE: 14,
  THORNVINE: 15,
  TORCH: 16,
  BENCH: 17,
  SMELTERY: 18,
  FORGE: 19,
  ALTAR: 20,
  PLANKS: 21,
  STONEBRICK: 22,
  // --- Added with the biome rework ---
  SNOW: 23,
  ICE: 24,
  SANDSTONE: 25,
  DEEPSTONE: 26,
  FROSTWOOD: 27,
  FROSTLEAVES: 28,
  CACTUS: 29,
  TALLGRASS: 30,
  STALAGMITE: 31,
  STALACTITE: 32,
  // --- Added in 4.1: flora ---
  // All non-solid decor that sways with the wind (see `sway` below).
  SHORTGRASS: 33,
  FLOWERS: 34,
  FERN: 35,
  REEDS: 36,
  VINE: 37,
  MUSHROOM: 38,
  GLOWMOSS: 39,
  DUNESHRUB: 40,
  FROSTBRACKEN: 41,
  BLIGHTBLOOM: 42,
  // --- Snowy Taiga + underground exploration ---
  GLACIERITE: 43,
  LOOT_CHEST: 44,
  POISON_DART_TRAP_LEFT: 45,
  POISON_DART_TRAP_RIGHT: 46,
};

// Kept as numeric IDs so old saves remain readable, but never generated,
// rendered, mined, or accepted from a saved diff in the first-world build.
export const ORE_TILE_IDS = new Set([
  T.CUPRITE, T.IRONVEIN, T.GLIMMER, T.AETHERITE, T.BLIGHTORE, T.GLACIERITE,
]);

// Each entry: name, solid, color (fallback), hardness, minPower, drop item id,
// light (0-1 emitted), station name.
//   toolType    : 'pickaxe' | 'axe' — the tool that mines this tile efficiently.
//                 Wrong (or no) tool falls back to a slow 12% rate.
//   tree        : trunk tile that participates in chop-and-fall behaviour.
//   leaf        : foliage — non-solid, drops sticks/seeds (never wood), decays
//                 when its supporting trunk is gone.
//   decor       : non-solid decoration (never forms an invisible wall).
//   mat         : framing/merge group. Tiles sharing a `mat` draw as one mass
//                 (no border between them); anything else gets an edge.
//   blastResist : minimum explosion power that can break the tile.
//                 Bombs are power 1, dynamite/sticky bombs power 2. 3 = immune.
export const TILES = {
  [T.AIR]:        { name: 'Air', solid: false },
  [T.DIRT]:       { name: 'Dirt', solid: true, color: '#6b4a2b', hardness: 26, minPower: 0, drop: 'dirt', mat: 'dirt', blastResist: 0 },
  [T.GRASS]:      { name: 'Verdant Grass', solid: true, color: '#4a8f3c', hardness: 26, minPower: 0, drop: 'dirt', mat: 'dirt', grass: '#5fae4a', blastResist: 0 },
  [T.STONE]:      { name: 'Stone', solid: true, color: '#6f7484', hardness: 55, minPower: 1, drop: 'stone', toolType: 'pickaxe', mat: 'stone', blastResist: 1 },
  [T.WOOD]:       { name: 'Oakenwood', solid: false, color: '#7a5228', hardness: 30, minPower: 0, drop: 'wood', toolType: 'axe', tree: true, decor: true, mat: 'wood', blastResist: 1 },
  [T.LEAVES]:     { name: 'Leaves', solid: false, color: '#3e7a34', hardness: 8, minPower: 0, toolType: 'axe', leaf: true, decor: true, mat: 'leaves', blastResist: 0 },
  [T.CLAY]:       { name: 'Clay', solid: true, color: '#9a5b45', hardness: 30, minPower: 0, drop: 'clay', mat: 'clay', blastResist: 0 },
  [T.SAND]:       { name: 'Sand', solid: true, color: '#d8c98a', hardness: 22, minPower: 0, drop: 'sand', mat: 'sand', blastResist: 0 },
  [T.BLIGHTGRASS]:{ name: 'Blighted Grass', solid: true, color: '#6d3f8a', hardness: 30, minPower: 0, drop: 'dirt', mat: 'dirt', grass: '#8a52ab', blastResist: 0 },
  [T.BLIGHTSTONE]:{ name: 'Blightstone', solid: true, color: '#4a2f66', hardness: 90, minPower: 2, drop: 'blightstone', toolType: 'pickaxe', mat: 'blightstone', blastResist: 2 },
  [T.THORNVINE]:  { name: 'Thornvine', solid: false, color: '#5a7a3a', hardness: 10, minPower: 0, drop: 'fiber', dropChance: 0.6, decor: true, hazard: 3, blastResist: 0 },
  [T.TORCH]:      { name: 'Emberlight', solid: false, color: '#ffb347', hardness: 6, minPower: 0, drop: 'torch', light: 0.95, decor: true, blastResist: 0 },
  [T.BENCH]:      { name: 'Crafting Bench', solid: false, color: '#8a6a3a', hardness: 20, minPower: 0, drop: 'craftingBench', station: 'bench', decor: true, blastResist: 0 },
  [T.SMELTERY]:   { name: 'Smeltery', solid: false, color: '#5a5560', hardness: 40, minPower: 0, drop: 'smeltery', station: 'smeltery', light: 0.55, decor: true, blastResist: 0 },
  [T.FORGE]:      { name: 'Forge', solid: false, color: '#4a4a55', hardness: 40, minPower: 0, drop: 'forge', station: 'forge', decor: true, blastResist: 0 },
  [T.ALTAR]:      { name: 'Aether Altar', solid: false, color: '#5a7abf', hardness: 40, minPower: 0, drop: 'aetherAltar', station: 'altar', light: 0.5, decor: true, blastResist: 0 },
  [T.PLANKS]:     { name: 'Oaken Planks', solid: true, color: '#a67c46', hardness: 24, minPower: 0, drop: 'planks', mat: 'planks', blastResist: 1 },
  [T.STONEBRICK]: { name: 'Stone Brick', solid: true, color: '#7c8296', hardness: 50, minPower: 1, drop: 'stoneBrick', toolType: 'pickaxe', mat: 'stonebrick', blastResist: 1 },

  [T.SNOW]:       { name: 'Snowpack', solid: true, color: '#dfe8f4', hardness: 24, minPower: 0, drop: 'snow', mat: 'snow', blastResist: 0 },
  [T.ICE]:        { name: 'Rimeglass', solid: true, color: '#a8cfe4', hardness: 45, minPower: 1, drop: 'ice', toolType: 'pickaxe', mat: 'snow', blastResist: 2, slippery: true },
  [T.SANDSTONE]:  { name: 'Sandstone', solid: true, color: '#bfa367', hardness: 48, minPower: 1, drop: 'sandstone', toolType: 'pickaxe', mat: 'sand', blastResist: 1 },
  [T.DEEPSTONE]:  { name: 'Deepstone', solid: true, color: '#4e4a59', hardness: 90, minPower: 2, drop: 'deepstone', toolType: 'pickaxe', mat: 'deepstone', blastResist: 2 },
  [T.FROSTWOOD]:  { name: 'Frostpine', solid: false, color: '#6a5b4c', hardness: 32, minPower: 0, drop: 'wood', toolType: 'axe', tree: true, decor: true, mat: 'wood', blastResist: 1 },
  [T.FROSTLEAVES]:{ name: 'Frostpine Needles', solid: false, color: '#2f5c4a', hardness: 8, minPower: 0, toolType: 'axe', leaf: true, decor: true, mat: 'leaves', blastResist: 0 },
  [T.CACTUS]:     { name: 'Duneheart Cactus', solid: false, color: '#4f8a53', hardness: 16, minPower: 0, drop: 'fiber', dropChance: 0.8, decor: true, hazard: 2, blastResist: 0 },
  [T.TALLGRASS]:  { name: 'Tall Grass', solid: false, color: '#5c9c46', hardness: 4, minPower: 0, drop: 'fiber', dropChance: 0.5, decor: true, blastResist: 0 },
  [T.STALAGMITE]: { name: 'Stalagmite', solid: false, color: '#7b7f8c', hardness: 18, minPower: 0, drop: 'stone', dropChance: 0.6, decor: true, blastResist: 0 },
  [T.STALACTITE]: { name: 'Stalactite', solid: false, color: '#7b7f8c', hardness: 18, minPower: 0, drop: 'stone', dropChance: 0.6, decor: true, blastResist: 0 },

  // Flora. Every one is non-solid decor you walk straight through, and every
  // one carries a `sway` weight: how far the wind moves it, relative to a tree
  // canopy's 1.0. Grass whips, a shrub barely shifts, and a hanging vine swings
  // more than either because it is pivoting from the top.
  //
  // `anchor` says which side the plant is rooted to, so the renderer knows
  // where the pivot is: 'floor' (default), 'ceiling', or 'any'.
  [T.SHORTGRASS]:   { name: 'Meadow Grass', solid: false, color: '#5c9c46', hardness: 3, minPower: 0, drop: 'fiber', dropChance: 0.4, decor: true, sway: 1.15, flora: true, blastResist: 0 },
  [T.FLOWERS]:      { name: 'Wildflowers', solid: false, color: '#6ea84f', hardness: 3, minPower: 0, drop: 'fiber', dropChance: 0.5, decor: true, sway: 1.0, flora: true, blastResist: 0 },
  [T.FERN]:         { name: 'Shadefern', solid: false, color: '#3f7a3c', hardness: 4, minPower: 0, drop: 'fiber', dropChance: 0.6, decor: true, sway: 0.8, flora: true, blastResist: 0 },
  [T.REEDS]:        { name: 'Bank Reeds', solid: false, color: '#7f9a4a', hardness: 3, minPower: 0, drop: 'fiber', dropChance: 0.7, decor: true, sway: 1.3, flora: true, blastResist: 0 },
  [T.VINE]:         { name: 'Hanging Vine', solid: false, color: '#4a7a3a', hardness: 4, minPower: 0, drop: 'fiber', dropChance: 0.5, decor: true, sway: 1.4, flora: true, anchor: 'ceiling', blastResist: 0 },
  [T.MUSHROOM]:     { name: 'Cavecap', solid: false, color: '#c4a08a', hardness: 5, minPower: 0, drop: 'fiber', dropChance: 0.5, decor: true, sway: 0.25, flora: true, blastResist: 0 },
  [T.GLOWMOSS]:     { name: 'Glowmoss', solid: false, color: '#6fd6c0', hardness: 4, minPower: 0, drop: 'fiber', dropChance: 0.4, decor: true, sway: 0.2, flora: true, light: 0.22, anchor: 'any', blastResist: 0 },
  [T.DUNESHRUB]:    { name: 'Dune Shrub', solid: false, color: '#9a9a58', hardness: 6, minPower: 0, drop: 'fiber', dropChance: 0.6, decor: true, sway: 0.55, flora: true, blastResist: 0 },
  [T.FROSTBRACKEN]: { name: 'Frost Bracken', solid: false, color: '#8fb4a8', hardness: 5, minPower: 0, drop: 'fiber', dropChance: 0.5, decor: true, sway: 0.7, flora: true, blastResist: 0 },
  [T.BLIGHTBLOOM]:  { name: 'Blightbloom', solid: false, color: '#8a52ab', hardness: 5, minPower: 0, drop: 'fiber', dropChance: 0.5, decor: true, sway: 0.9, flora: true, light: 0.12, blastResist: 0 },

  // Exploration content. Chests and traps are non-solid decor, so they read as
  // world objects without blocking a cave corridor. `chest` and `dartTrap`
  // are consumed by the interaction and hazard systems rather than by physics.
  [T.LOOT_CHEST]: { name: 'Cave Chest', solid: false, color: '#a36a32', hardness: 1, minPower: 0, decor: true, chest: true, blastResist: 3 },
  [T.POISON_DART_TRAP_LEFT]: { name: 'Poison Dart Trap', solid: false, color: '#52674f', hardness: 20, minPower: 1, drop: 'stone', dropChance: 0.4, toolType: 'pickaxe', decor: true, dartTrap: -1, blastResist: 0 },
  [T.POISON_DART_TRAP_RIGHT]: { name: 'Poison Dart Trap', solid: false, color: '#52674f', hardness: 20, minPower: 1, drop: 'stone', dropChance: 0.4, toolType: 'pickaxe', decor: true, dartTrap: 1, blastResist: 0 },
};

export function tileDef(id) { return TILES[id] || TILES[T.AIR]; }
export function isSolid(id) { return !!(TILES[id] && TILES[id].solid); }
export function tileLight(id) { return (TILES[id] && TILES[id].light) || 0; }
export function isTree(id) { return !!(TILES[id] && TILES[id].tree); }
export function isLeaf(id) { return !!(TILES[id] && TILES[id].leaf); }
export function isDecor(id) { return !!(TILES[id] && TILES[id].decor); }
// How much the wind moves this tile, relative to a tree canopy. 0 = fixed.
export function swayWeight(id) {
  const d = TILES[id];
  if (!d) return 0;
  if (d.sway != null) return d.sway;
  return d.leaf ? 1 : 0;
}
export function isFlora(id) { return !!(TILES[id] && TILES[id].flora); }
export function isOreTile(id) { return ORE_TILE_IDS.has(id); }
// 'floor' | 'ceiling' | 'any' — which edge the plant is rooted to, and so
// where its sway pivot sits.
export function floraAnchor(id) { return (TILES[id] && TILES[id].anchor) || 'floor'; }
export function tileMat(id) { return (TILES[id] && TILES[id].mat) || null; }
export function blastResist(id) {
  const d = TILES[id];
  if (!d) return 3;
  return d.blastResist == null ? 1 : d.blastResist;
}

// Highest valid tile id — used by the worldgen self-check harness.
export const MAX_TILE_ID = Math.max(...Object.keys(TILES).map(Number));
