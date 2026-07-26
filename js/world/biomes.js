// Summoner Realms — surface biome layout.
//
// Biomes used to be a hard vertical cut at one x coordinate, which is why the
// world read as "two halves" rather than a landscape. They are now laid out as
// seeded bands along the world with blended seams, and every band carries its
// own terrain shaping, tile palette, wall palette, decor table and sky colours.
import { T } from './tiles.js?v=realms-qor-45';
import { W } from './walls.js?v=realms-qor-45';
import { mulberry32 } from '../utils.js?v=realms-qor-45';

// amp      : surface height amplitude in tiles (how hilly)
// rough    : weight of the high-frequency octaves (how jagged)
// lift     : average height offset in tiles (negative = higher ground)
// subDepth : [min, max] thickness of the subsurface layer under the surface tile
export const BIOMES = {
  dunes: {
    key: 'dunes', label: 'Sunken Dunes',
    surface: T.SAND, sub: T.SAND, subDepth: [7, 13], stone: T.SANDSTONE,
    wall: W.SANDSTONE, subWall: W.SANDSTONE, stoneWall: W.SANDSTONE,
    amp: 3.5, rough: 0.25, lift: 5,
    treeChance: 0, cactusChance: 0.05, grassChance: 0.02, vineChance: 0,
    skyDay: ['#4f7fb5', '#e0cd97'], skyNight: ['#0c1226', '#2a2438'],
  },
  forest: {
    key: 'forest', label: 'Verdant Reach',
    surface: T.GRASS, sub: T.DIRT, subDepth: [5, 9], stone: T.STONE,
    wall: W.DIRT, subWall: W.DIRT, stoneWall: W.STONE,
    amp: 9.5, rough: 0.45, lift: 0,
    treeChance: 0.22, cactusChance: 0, grassChance: 0.3, vineChance: 0,
    treeTile: T.WOOD, leafTile: T.LEAVES, treeHeight: [5, 9], canopy: 'round',
    skyDay: ['#3a6ea5', '#8fc0e8'], skyNight: ['#0a0e22', '#1a1d3a'],
  },
  frostpine: {
    key: 'frostpine', label: 'Frostpine Hollow',
    surface: T.SNOW, sub: T.SNOW, subDepth: [6, 11], stone: T.STONE,
    wall: W.SNOW, subWall: W.SNOW, stoneWall: W.STONE,
    amp: 13, rough: 0.5, lift: -4,
    treeChance: 0.26, cactusChance: 0, grassChance: 0.04, vineChance: 0,
    treeTile: T.FROSTWOOD, leafTile: T.FROSTLEAVES, treeHeight: [7, 13], canopy: 'conifer',
    iceChance: 0.16,
    skyDay: ['#5b81ad', '#cfe2f2'], skyNight: ['#0b1224', '#232c46'],
  },
  corrupt: {
    key: 'corrupt', label: 'Corrupted Lands',
    surface: T.BLIGHTGRASS, sub: T.DIRT, subDepth: [4, 8], stone: T.BLIGHTSTONE,
    wall: W.BLIGHT, subWall: W.DIRT, stoneWall: W.BLIGHT,
    amp: 15, rough: 0.85, lift: -2,
    treeChance: 0.07, cactusChance: 0, grassChance: 0.05, vineChance: 0.06,
    treeTile: T.BLIGHTWOOD, leafTile: null, treeHeight: [4, 8], canopy: 'dead',
    chasmChance: 0.35,
    skyDay: ['#4a2f5a', '#7a5a86'], skyNight: ['#14081e', '#2a1436'],
  },
};

export const BIOME_ORDER = ['dunes', 'forest', 'frostpine', 'corrupt'];
export const SURFACE_BIOMES = new Set(BIOME_ORDER);

// Width of the cross-fade at every band seam, in tiles. Terrain properties are
// interpolated across it and surface tiles are dithered, so no seam is a line.
export const SEAM = 14;

/**
 * Lay out the surface biome bands for a world.
 *
 * Returns:
 *   map    Uint8Array(width) — index into BIOME_ORDER, the dominant biome
 *   mixAt(x) -> [{ biome, weight }, …] normalised blend weights at column x
 *   bands  the raw band list (for debugging / the worldgen harness)
 *   forestRuns  contiguous pure-forest spans, used to seat the spawn plain
 */
export function buildBiomeMap(seed, width) {
  const rc = mulberry32((seed ^ 0xb10e5) >>> 0);
  const duneW = Math.max(24, Math.round(width * 0.06));
  const frostW = Math.max(48, Math.round(width * (0.11 + rc() * 0.05)));
  const corruptW = Math.max(56, Math.round(width * (0.13 + rc() * 0.06)));

  // Frostpine sits left of centre, corruption right of centre, both clear of
  // the dune shores and of each other.
  const frostMin = duneW + 34;
  const frostMax = Math.max(frostMin + 1, Math.floor(width * 0.40) - frostW);
  const frostStart = Math.round(frostMin + rc() * (frostMax - frostMin));

  const corruptMin = Math.max(frostStart + frostW + 60, Math.floor(width * 0.55));
  const corruptMax = Math.max(corruptMin + 1, width - duneW - corruptW - 30);
  const corruptStart = Math.round(corruptMin + rc() * (corruptMax - corruptMin));

  const bands = [
    { biome: 'dunes', x0: 0, x1: duneW },
    { biome: 'frostpine', x0: frostStart, x1: frostStart + frostW },
    { biome: 'corrupt', x0: corruptStart, x1: corruptStart + corruptW },
    { biome: 'dunes', x0: width - duneW, x1: width },
  ];

  const map = new Uint8Array(width);
  const forestIdx = BIOME_ORDER.indexOf('forest');
  map.fill(forestIdx);
  for (const b of bands) {
    const idx = BIOME_ORDER.indexOf(b.biome);
    for (let x = Math.max(0, b.x0); x < Math.min(width, b.x1); x++) map[x] = idx;
  }

  // Contiguous runs of pure forest (at least SEAM away from any band edge), so
  // the spawn plain can be seated somewhere sane.
  const forestRuns = [];
  let runStart = -1;
  for (let x = 0; x <= width; x++) {
    const pure = x < width && map[x] === forestIdx && distToSeam(bands, x, width) > SEAM;
    if (pure && runStart < 0) runStart = x;
    else if (!pure && runStart >= 0) { forestRuns.push({ x0: runStart, x1: x }); runStart = -1; }
  }

  return { map, bands, forestRuns, mixAt: (x) => mixAt(map, bands, x, width) };
}

function distToSeam(bands, x, width) {
  let best = Math.min(x, width - 1 - x);
  for (const b of bands) best = Math.min(best, Math.abs(x - b.x0), Math.abs(x - b.x1));
  return best;
}

// Blend weights at a column: the dominant biome plus whatever it is fading into.
function mixAt(map, bands, x, width) {
  const own = BIOME_ORDER[map[Math.max(0, Math.min(width - 1, x))]];
  const d = distToSeam(bands, x, width);
  if (d >= SEAM) return [{ biome: own, weight: 1 }];
  // Find the nearest column on the other side of the seam.
  const dir = nearestSeamDir(bands, x, width);
  const other = BIOME_ORDER[map[Math.max(0, Math.min(width - 1, x + dir * (SEAM + 2)))]];
  if (other === own) return [{ biome: own, weight: 1 }];
  const t = 0.5 + 0.5 * (d / SEAM); // 0.5 right at the seam -> 1 at the core
  return [{ biome: own, weight: t }, { biome: other, weight: 1 - t }];
}

function nearestSeamDir(bands, x, width) {
  let best = Infinity, dir = 1;
  const consider = (edge) => {
    const d = Math.abs(x - edge);
    if (d < best) { best = d; dir = edge >= x ? 1 : -1; }
  };
  for (const b of bands) { consider(b.x0); consider(b.x1); }
  consider(0); consider(width - 1);
  return dir;
}

// Blend a numeric biome property across a seam.
export function blendProp(mix, prop, fallback = 0) {
  let v = 0;
  for (const m of mix) {
    const b = BIOMES[m.biome];
    v += ((b && b[prop] != null) ? b[prop] : fallback) * m.weight;
  }
  return v;
}

export function biomeDef(key) { return BIOMES[key] || BIOMES.forest; }
