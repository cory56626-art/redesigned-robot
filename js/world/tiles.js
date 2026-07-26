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
  // ---- 4.1 ---- appended, never renumbered (ids are part of the save format).
  SHORTGRASS: 33,
  FLOWER: 34,
  FERN: 35,
  CAVEMOSS: 36,
  GLOWSHROOM: 37,
  BLIGHTWOOD: 38,
  WATER: 39,
};

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
  [T.LEAVES]:     { name: 'Leaves', sway: 1, solid: false, color: '#3e7a34', hardness: 8, minPower: 0, toolType: 'axe', leaf: true, decor: true, mat: 'leaves', blastResist: 0 },
  [T.CLAY]:       { name: 'Clay', solid: true, color: '#9a5b45', hardness: 30, minPower: 0, drop: 'clay', mat: 'clay', blastResist: 0 },
  [T.SAND]:       { name: 'Sand', solid: true, color: '#d8c98a', hardness: 22, minPower: 0, drop: 'sand', mat: 'sand', blastResist: 0 },
  // Ores read as stone with a coloured gem seam, so veins sit inside the rock
  // instead of looking like separate blocks stuck to it.
  [T.CUPRITE]:    { name: 'Cuprite Ore', solid: true, color: '#77716f', hardness: 60, minPower: 1, drop: 'cupriteOre', toolType: 'pickaxe', mat: 'stone', blastResist: 1 },
  [T.IRONVEIN]:   { name: 'Ironvein Ore', solid: true, color: '#74797f', hardness: 80, minPower: 2, drop: 'ironveinOre', toolType: 'pickaxe', mat: 'stone', blastResist: 1 },
  [T.GLIMMER]:    { name: 'Glimmer Ore', solid: true, color: '#7a7566', hardness: 100, minPower: 3, drop: 'glimmerOre', toolType: 'pickaxe', mat: 'stone', blastResist: 2 },
  [T.AETHERITE]:  { name: 'Aetherite Ore', solid: true, color: '#6a7480', hardness: 120, minPower: 3, drop: 'aetheriteOre', light: 0.35, toolType: 'pickaxe', mat: 'stone', blastResist: 2 },
  [T.BLIGHTORE]:  { name: 'Blightore', solid: true, color: '#4b3560', hardness: 150, minPower: 4, drop: 'blightoreOre', light: 0.2, toolType: 'pickaxe', mat: 'blightstone', blastResist: 3 },
  [T.BLIGHTGRASS]:{ name: 'Blighted Grass', solid: true, color: '#6d3f8a', hardness: 30, minPower: 0, drop: 'dirt', mat: 'dirt', grass: '#8a52ab', blastResist: 0 },
  [T.BLIGHTSTONE]:{ name: 'Blightstone', solid: true, color: '#4a2f66', hardness: 90, minPower: 2, drop: 'blightstone', toolType: 'pickaxe', mat: 'blightstone', blastResist: 2 },
  [T.THORNVINE]:  { name: 'Thornvine', sway: 1.2, solid: false, color: '#5a7a3a', hardness: 10, minPower: 0, drop: 'fiber', dropChance: 0.6, decor: true, hazard: 3, blastResist: 0 },
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
  [T.FROSTLEAVES]:{ name: 'Frostpine Needles', sway: 0.7, solid: false, color: '#2f5c4a', hardness: 8, minPower: 0, toolType: 'axe', leaf: true, decor: true, mat: 'leaves', blastResist: 0 },
  [T.CACTUS]:     { name: 'Duneheart Cactus', solid: false, color: '#4f8a53', hardness: 16, minPower: 0, drop: 'fiber', dropChance: 0.8, decor: true, hazard: 2, blastResist: 0 },
  [T.TALLGRASS]:  { name: 'Tall Grass', sway: 1.5, solid: false, color: '#5c9c46', hardness: 4, minPower: 0, drop: 'fiber', dropChance: 0.5, decor: true, blastResist: 0 },
  [T.STALAGMITE]: { name: 'Stalagmite', solid: false, color: '#7b7f8c', hardness: 18, minPower: 0, drop: 'stone', dropChance: 0.6, decor: true, blastResist: 0 },
  [T.STALACTITE]: { name: 'Stalactite', solid: false, color: '#7b7f8c', hardness: 18, minPower: 0, drop: 'stone', dropChance: 0.6, decor: true, blastResist: 0 },
  // ---- 4.1 flora ----
  [T.SHORTGRASS]: { name: 'Meadow Grass', sway: 1.4, solid: false, color: '#6aa851', hardness: 3, minPower: 0, drop: 'fiber', dropChance: 0.35, decor: true, blastResist: 0 },
  [T.FLOWER]:     { name: 'Wildflower', sway: 1.3, solid: false, color: '#d9718f', hardness: 3, minPower: 0, drop: 'fiber', dropChance: 0.4, decor: true, blastResist: 0 },
  [T.FERN]:       { name: 'Fern', sway: 1.1, solid: false, color: '#4f8f46', hardness: 4, minPower: 0, drop: 'fiber', dropChance: 0.5, decor: true, blastResist: 0 },
  [T.CAVEMOSS]:   { name: 'Cave Moss', sway: 0.5, solid: false, color: '#5d7a4a', hardness: 4, minPower: 0, drop: 'fiber', dropChance: 0.3, decor: true, blastResist: 0 },
  [T.GLOWSHROOM]: { name: 'Glowcap', sway: 0.4, solid: false, color: '#7fd8e8', hardness: 4, minPower: 0, drop: 'fiber', dropChance: 0.3, decor: true, light: 0.42, blastResist: 0 },
  // Corruption trunk: same axe rules as wood, its own bruised palette.
  [T.BLIGHTWOOD]: { name: 'Blightwood', solid: false, color: '#5b4560', hardness: 12, minPower: 0, toolType: 'axe', tree: true, decor: true, mat: 'wood', drop: 'wood', blastResist: 0 },
  // Still water. Not a flow simulation — pools sit where worldgen puts them.
  // `liquid` gates the swim handling in physics.js and is what a fishing bobber
  // looks for. Non-minable (no hardness) so a pickaxe can't scoop it.
  [T.WATER]: { name: 'Water', solid: false, liquid: true, color: '#2f6fa8', hardness: 0, minPower: 0, blastResist: 0 },
};

// Every accessor masks off the shape nibble (see the shape section below), so
// each one can be handed either a bare tile id or a packed tile value straight
// out of the grid without the caller having to remember which it has.
export function tileDef(id) { return TILES[id & ID_MASK] || TILES[T.AIR]; }
export function isSolid(id) { return !!tileDef(id).solid; }
export function tileLight(id) { return tileDef(id).light || 0; }
export function isTree(id) { return !!tileDef(id).tree; }
export function isLeaf(id) { return !!tileDef(id).leaf; }
// How much a tile bends in the wind (0 = rigid). Leaves and plants sway;
// terrain does not.
export function tileSway(id) { return tileDef(id).sway || 0; }

// ---------------------------------------------------------------------------
// Tile shape (hammer)
// ---------------------------------------------------------------------------
// A tile value is a Uint16: the low 12 bits are the id, the high 4 bits are a
// shape. Ids currently top out at 39, so there is enormous headroom below the
// shape nibble, and because the shape lives *inside* the tile value it rides
// the save diffs and the network tile-edit messages for free.
//
// `World.get()` masks the shape off, so every existing call site keeps working
// unchanged; anything that needs the geometry asks `World.getShape()`.
export const SHAPE_BITS = 12;
export const SHAPE_MASK = 0xf000;
export const ID_MASK = 0x0fff;

export const SHAPE = {
  FULL: 0,
  HALF: 1,       // bottom half only
  HALF_TOP: 2,   // top half only
  SLOPE_NE: 3,   // solid below a line rising to the right
  SLOPE_NW: 4,   // solid below a line rising to the left
  SLOPE_SE: 5,   // solid above a line falling to the right
  SLOPE_SW: 6,   // solid above a line falling to the left
  PLATFORM: 7,   // thin walkway: stands on, drops through
};

// The order the hammer cycles through.
export const HAMMER_CYCLE = [
  SHAPE.FULL, SHAPE.HALF, SHAPE.SLOPE_NE, SHAPE.SLOPE_NW,
  SHAPE.SLOPE_SE, SHAPE.SLOPE_SW, SHAPE.HALF_TOP,
];

export function tileId(v) { return v & ID_MASK; }
export function tileShape(v) { return (v & SHAPE_MASK) >>> SHAPE_BITS; }
export function packTile(id, shape) { return (id & ID_MASK) | ((shape & 0xf) << SHAPE_BITS); }

// Which tiles the hammer is allowed to reshape: solid terrain only. Reshaping a
// torch or a sapling is meaningless and would break their sprites.
export function isShapeable(id) {
  const d = TILES[id & ID_MASK];
  return !!(d && d.solid && !d.decor && d.mat);
}

// How much of the tile column at fraction `fx` (0..1 across the tile) is solid,
// as a fraction measured from the tile's top. 0 = solid from the very top,
// 1 = nothing solid. Used by collision and by the sprite clip.
export function shapeTopAt(shape, fx) {
  switch (shape) {
    case SHAPE.FULL: return 0;
    case SHAPE.HALF: return 0.5;
    case SHAPE.HALF_TOP: return 0;
    case SHAPE.PLATFORM: return 0;
    case SHAPE.SLOPE_NE: return 1 - fx;   // low at the left, full at the right
    case SHAPE.SLOPE_NW: return fx;       // full at the left, low at the right
    case SHAPE.SLOPE_SE: return 0;
    case SHAPE.SLOPE_SW: return 0;
    default: return 0;
  }
}

// Bottom of the solid part, as a fraction from the tile top. Only the "upper"
// shapes stop short of the tile floor.
export function shapeBottomAt(shape, fx) {
  switch (shape) {
    case SHAPE.HALF_TOP: return 0.5;
    case SHAPE.PLATFORM: return 0.28;
    case SHAPE.SLOPE_SE: return fx;
    case SHAPE.SLOPE_SW: return 1 - fx;
    default: return 1;
  }
}
export function isLiquid(id) { return !!tileDef(id).liquid; }
export function isDecor(id) { return !!tileDef(id).decor; }
export function tileMat(id) { return tileDef(id).mat || null; }
export function blastResist(id) {
  const d = TILES[id & ID_MASK];
  if (!d) return 3;
  return d.blastResist == null ? 1 : d.blastResist;
}

// Highest valid tile id — used by the worldgen self-check harness.
export const MAX_TILE_ID = Math.max(...Object.keys(TILES).map(Number));
