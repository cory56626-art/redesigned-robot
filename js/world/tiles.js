// Summoner Realms — tile definitions.
// id 0 is always air. `drop` is the item id produced when mined.
// `station` marks crafting stations that the crafting system detects nearby.

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
};

// Each entry: name, solid, color (fallback), hardness, minPower, drop item id,
// light (0-1 emitted), station name.
//   toolType : 'pickaxe' | 'axe' — the tool that mines this tile efficiently.
//              Wrong (or no) tool falls back to a slow 12% rate.
//   tree     : trunk tile that participates in chop-and-fall behaviour.
//   leaf     : foliage — non-solid, drops sticks/seeds (never wood), decays when
//              its supporting trunk is gone.
//   decor    : non-solid decoration (never forms an invisible wall).
export const TILES = {
  [T.AIR]:        { name: 'Air', solid: false },
  [T.DIRT]:       { name: 'Dirt', solid: true, color: '#6b4a2b', hardness: 26, minPower: 0, drop: 'dirt' },
  [T.GRASS]:      { name: 'Verdant Grass', solid: true, color: '#4a8f3c', hardness: 26, minPower: 0, drop: 'dirt' },
  [T.STONE]:      { name: 'Stone', solid: true, color: '#6f7484', hardness: 55, minPower: 1, drop: 'stone', toolType: 'pickaxe' },
  [T.WOOD]:       { name: 'Oakenwood', solid: false, color: '#7a5228', hardness: 30, minPower: 0, drop: 'wood', toolType: 'axe', tree: true, decor: true },
  [T.LEAVES]:     { name: 'Leaves', solid: false, color: '#3e7a34', hardness: 8, minPower: 0, toolType: 'axe', leaf: true, decor: true },
  [T.CLAY]:       { name: 'Clay', solid: true, color: '#9a5b45', hardness: 30, minPower: 0, drop: 'clay' },
  [T.SAND]:       { name: 'Sand', solid: true, color: '#d8c98a', hardness: 22, minPower: 0, drop: 'sand' },
  [T.CUPRITE]:    { name: 'Cuprite Ore', solid: true, color: '#c47b4a', hardness: 60, minPower: 1, drop: 'cupriteOre', toolType: 'pickaxe' },
  [T.IRONVEIN]:   { name: 'Ironvein Ore', solid: true, color: '#a9b0bd', hardness: 80, minPower: 2, drop: 'ironveinOre', toolType: 'pickaxe' },
  [T.GLIMMER]:    { name: 'Glimmer Ore', solid: true, color: '#ffe08a', hardness: 100, minPower: 3, drop: 'glimmerOre', toolType: 'pickaxe' },
  [T.AETHERITE]:  { name: 'Aetherite Ore', solid: true, color: '#8ad9ff', hardness: 120, minPower: 3, drop: 'aetheriteOre', light: 0.35, toolType: 'pickaxe' },
  [T.BLIGHTORE]:  { name: 'Blightore', solid: true, color: '#8a4fb0', hardness: 150, minPower: 4, drop: 'blightoreOre', light: 0.2, toolType: 'pickaxe' },
  [T.BLIGHTGRASS]:{ name: 'Blighted Grass', solid: true, color: '#6d3f8a', hardness: 30, minPower: 0, drop: 'dirt' },
  [T.BLIGHTSTONE]:{ name: 'Blightstone', solid: true, color: '#4a2f66', hardness: 90, minPower: 2, drop: 'blightstone', toolType: 'pickaxe' },
  [T.THORNVINE]:  { name: 'Thornvine', solid: false, color: '#5a7a3a', hardness: 10, minPower: 0, drop: 'fiber', dropChance: 0.6, decor: true, hazard: 3 },
  [T.TORCH]:      { name: 'Emberlight', solid: false, color: '#ffb347', hardness: 6, minPower: 0, drop: 'torch', light: 0.95, decor: true },
  [T.BENCH]:      { name: 'Crafting Bench', solid: false, color: '#8a6a3a', hardness: 20, minPower: 0, drop: 'craftingBench', station: 'bench', decor: true },
  [T.SMELTERY]:   { name: 'Smeltery', solid: false, color: '#5a5560', hardness: 40, minPower: 0, drop: 'smeltery', station: 'smeltery', light: 0.55, decor: true },
  [T.FORGE]:      { name: 'Forge', solid: false, color: '#4a4a55', hardness: 40, minPower: 0, drop: 'forge', station: 'forge', decor: true },
  [T.ALTAR]:      { name: 'Aether Altar', solid: false, color: '#5a7abf', hardness: 40, minPower: 0, drop: 'aetherAltar', station: 'altar', light: 0.5, decor: true },
  [T.PLANKS]:     { name: 'Oaken Planks', solid: true, color: '#a67c46', hardness: 24, minPower: 0, drop: 'planks' },
  [T.STONEBRICK]: { name: 'Stone Brick', solid: true, color: '#7c8296', hardness: 50, minPower: 1, drop: 'stoneBrick', toolType: 'pickaxe' },
};

export function tileDef(id) { return TILES[id] || TILES[T.AIR]; }
export function isSolid(id) { return !!(TILES[id] && TILES[id].solid); }
export function tileLight(id) { return (TILES[id] && TILES[id].light) || 0; }
export function isTree(id) { return !!(TILES[id] && TILES[id].tree); }
export function isLeaf(id) { return !!(TILES[id] && TILES[id].leaf); }
export function isDecor(id) { return !!(TILES[id] && TILES[id].decor); }
