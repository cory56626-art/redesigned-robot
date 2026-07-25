// Summoner Realms — procedural world generation.
//
// Shape of a generated world, surface to bedrock:
//
//   sky        · nothing, daylight reaches down to the first solid tile
//   surface    · biome bands (Dunes / Verdant Reach / Frostpine Hollow /
//                Corrupted Lands) with blended seams, each with its own
//                height profile, tile palette and decor
//   subsurface · dirt / snow / sand, 4-13 tiles thick with a noisy underside
//   stone      · with a speckled dirt-and-stone transition band above it
//   deepstone  · below CAVERN_Y, noisy transition
//
// Everything solid is generated with a background *wall* behind it, then caves
// are carved out of that rock. The wall stays, so a cave reads as an enclosed
// space rather than a window to the sky (see world/walls.js).
//
// Deterministic from a numeric seed. `tools/worldgen-check.mjs` asserts the
// invariants this file is responsible for.
import { WORLD_W, WORLD_H, SURFACE_Y, UNDERGROUND_Y, CAVERN_Y, TILE } from '../config.js?v=realms-2';
import { T } from './tiles.js?v=realms-2';
import { W } from './walls.js?v=realms-2';
import { BIOMES, BIOME_ORDER, buildBiomeMap, blendProp } from './biomes.js?v=realms-2';
import { mulberry32, makeFbm1D, makeFbm2D, makeValueNoise2D, clamp, smoothstep } from '../utils.js?v=realms-2';

// Half-width of the guaranteed flat, cave-free plain the player spawns on.
const SPAWN_PLAIN = 13;
const BEDROCK = 4; // solid tiles kept at the very bottom of the world
// Tiles below the surface line that carry no background wall, so shallow digging
// stays daylit and only genuine depth reads as underground.
const SURFACE_WALL_GAP = 3;

export function generateWorld(seed) {
  const w = WORLD_W, h = WORLD_H;
  const tiles = new Uint16Array(w * h);
  const walls = new Uint8Array(w * h);
  const rand = mulberry32(seed);
  const idx = (x, y) => y * w + x;

  const biome = buildBiomeMap(seed, w);
  const surface = buildHeightmap(seed, w, biome);
  const spawnTx = pickSpawnColumn(biome, w);
  flattenSpawnPlain(surface, spawnTx, w);
  enforceWalkableSlope(surface, w);

  fillLayers(tiles, walls, w, h, surface, biome, seed);
  seedPockets(tiles, walls, w, h, surface, biome, rand);

  const cave = carveCaves(seed, w, h, surface, spawnTx);
  applyCaves(tiles, cave, w, h, surface, spawnTx);

  seedOres(tiles, w, h, surface, rand);
  decorate(tiles, w, h, surface, biome, rand, spawnTx);

  sealSpawn(tiles, walls, w, h, surface, spawnTx, biome);
  clearSurfaceWalls(walls, w, h, surface);

  const spawnY = (surface[spawnTx] - 3) * TILE;
  return {
    tiles, walls, width: w, height: h, surface,
    biomeMap: biome.map, biomeBands: biome.bands,
    spawnTx, spawnX: spawnTx * TILE, spawnY,
  };
}

// ---------------------------------------------------------------------------
// Heightmap
// ---------------------------------------------------------------------------

// Large landforms from low-frequency fBm, detail scaled by each biome's
// roughness, then terraced into plateaus and smoothed. The old generator used a
// single noise octave and relied on a +/-1 slope clamp to make it walkable,
// which is exactly what produced endless staircases.
function buildHeightmap(seed, w, biome) {
  const base = makeFbm1D(seed ^ 0x1234, 4);
  const detail = makeFbm1D(seed ^ 0x9abc, 3);
  const terraceNoise = makeFbm1D(seed ^ 0x5f3a, 2);
  const raw = new Float32Array(w);

  for (let x = 0; x < w; x++) {
    const mix = biome.mixAt(x);
    const amp = blendProp(mix, 'amp', 8);
    const rough = blendProp(mix, 'rough', 0.45);
    const lift = blendProp(mix, 'lift', 0);

    // Two scales of landform: broad hills plus biome-scaled detail.
    const hills = (base(x * 0.006) - 0.5) * amp * 2.1;
    const bumps = (detail(x * 0.045) - 0.5) * amp * rough;
    raw[x] = SURFACE_Y + lift + hills + bumps;
  }

  // Terracing: where the terrace field is strong, snap toward a 3-tile step so
  // the landscape grows flats and shelves instead of being uniformly noisy.
  for (let x = 0; x < w; x++) {
    const strength = smoothstep(0.42, 0.78, terraceNoise(x * 0.011));
    if (strength <= 0) continue;
    const stepped = Math.round(raw[x] / 3) * 3;
    raw[x] = raw[x] + (stepped - raw[x]) * strength * 0.85;
  }

  // Two 3-wide box blurs knock the last of the per-column jitter out.
  boxBlur(raw, w); boxBlur(raw, w);

  const out = new Int32Array(w);
  const minY = 24, maxY = UNDERGROUND_Y - 14;
  for (let x = 0; x < w; x++) out[x] = clamp(Math.round(raw[x]), minY, maxY);
  return out;
}

function boxBlur(arr, w) {
  const copy = Float32Array.from(arr);
  for (let x = 0; x < w; x++) {
    const a = copy[Math.max(0, x - 1)], b = copy[x], c = copy[Math.min(w - 1, x + 1)];
    arr[x] = (a + b + c) / 3;
  }
}

// Final safety net: the player can only auto-climb one-tile ledges, so no two
// adjacent columns may differ by more than one. After the shaping above this
// barely has anything left to do — it is no longer the primary shaping tool.
function enforceWalkableSlope(surface, w) {
  for (let pass = 0; pass < 2; pass++) {
    for (let x = 1; x < w; x++) surface[x] = clamp(surface[x], surface[x - 1] - 1, surface[x - 1] + 1);
    for (let x = w - 2; x >= 0; x--) surface[x] = clamp(surface[x], surface[x + 1] - 1, surface[x + 1] + 1);
  }
}

// Spawn in the middle of the widest pure-forest run so the starting area is
// always ordinary grassland, never a dune shore or a corruption chasm.
function pickSpawnColumn(biome, w) {
  let best = null;
  for (const run of biome.forestRuns) {
    if (!best || (run.x1 - run.x0) > (best.x1 - best.x0)) best = run;
  }
  if (!best) return Math.floor(w * 0.3);
  return clamp(Math.floor((best.x0 + best.x1) / 2), SPAWN_PLAIN + 4, w - SPAWN_PLAIN - 5);
}

// A guaranteed flat plain to spawn (and build the Guide's home) on, ramped into
// the surrounding terrain so it doesn't look stamped on.
function flattenSpawnPlain(surface, spawnTx, w) {
  const level = surface[spawnTx];
  const ramp = SPAWN_PLAIN + 10;
  for (let dx = -ramp; dx <= ramp; dx++) {
    const x = spawnTx + dx;
    if (x < 0 || x >= w) continue;
    const d = Math.abs(dx);
    const k = d <= SPAWN_PLAIN ? 1 : 1 - (d - SPAWN_PLAIN) / (ramp - SPAWN_PLAIN);
    surface[x] = Math.round(surface[x] + (level - surface[x]) * k);
  }
}

// ---------------------------------------------------------------------------
// Layer fill
// ---------------------------------------------------------------------------

function fillLayers(tiles, walls, w, h, surface, biome, seed) {
  const idx = (x, y) => y * w + x;
  const depthNoise = makeFbm1D(seed ^ 0x77aa, 2);
  const blendNoise = makeValueNoise2D((seed ^ 0x3311) >>> 0);
  const deepNoise = makeFbm1D(seed ^ 0xbeef, 2);
  const ditherRand = mulberry32((seed ^ 0x0f0f) >>> 0);

  for (let x = 0; x < w; x++) {
    const mix = biome.mixAt(x);
    // At a seam, dither which biome owns each column so the transition is a
    // speckled gradient rather than a straight vertical line.
    const def = pickBiome(mix, ditherRand);
    const s = surface[x];
    const subMin = def.subDepth[0], subMax = def.subDepth[1];
    const subDepth = Math.round(subMin + depthNoise(x * 0.08) * (subMax - subMin));
    const deepY = Math.round(CAVERN_Y + (deepNoise(x * 0.05) - 0.5) * 14);

    for (let y = 0; y < h; y++) {
      let id = T.AIR, wall = W.NONE;
      if (y >= h - BEDROCK) {
        id = T.DEEPSTONE; wall = W.DEEPSTONE;
      } else if (y === s) {
        id = def.surface;
      } else if (y > s && y <= s + subDepth) {
        id = def.sub;
        // The top few tiles carry no wall, so digging a shallow trench stays
        // daylit and only real depth gets dark — same rule Terraria uses.
        wall = y > s + SURFACE_WALL_GAP ? def.subWall : W.NONE;
      } else if (y > s) {
        const deep = y >= deepY;
        id = deep ? T.DEEPSTONE : def.stone;
        wall = deep ? W.DEEPSTONE : def.stoneWall;
        // Speckled dirt-in-stone band just under the subsurface, and a matching
        // stone-in-dirt speckle just above it. Terraria's dirt/stone boundary is
        // never a clean line and neither is this one.
        const band = y - (s + subDepth);
        if (!deep && band > 0 && band < 16) {
          const t = band / 16;
          if (blendNoise(x * 0.35, y * 0.35) > 0.35 + t * 0.6) { id = def.sub; wall = def.subWall; }
        }
        // Same treatment at the deepstone boundary.
        if (Math.abs(y - deepY) < 9) {
          const t = (y - deepY + 9) / 18;
          const n = blendNoise(x * 0.3 + 120, y * 0.3);
          if (n > 0.3 + t * 0.55) { id = def.stone; wall = def.stoneWall; }
          else { id = T.DEEPSTONE; wall = W.DEEPSTONE; }
        }
      }
      tiles[idx(x, y)] = id;
      walls[idx(x, y)] = wall;
    }
  }
}

function pickBiome(mix, rand) {
  if (mix.length === 1) return BIOMES[mix[0].biome];
  let r = rand();
  for (const m of mix) { r -= m.weight; if (r <= 0) return BIOMES[m.biome]; }
  return BIOMES[mix[0].biome];
}

// Clay, sand and gravel-ish pockets near the surface, plus dirt caves in stone.
function seedPockets(tiles, walls, w, h, surface, biome, rand) {
  for (let x = 0; x < w; x++) {
    const def = BIOMES[BIOME_ORDER[biome.map[x]]];
    const s = surface[x];
    if (rand() < 0.035) {
      const r = 2 + Math.floor(rand() * 3);
      blob(tiles, walls, w, h, x, s + 3 + Math.floor(rand() * 5), r,
        def.key === 'corrupt' ? T.BLIGHTSTONE : T.SAND,
        def.key === 'corrupt' ? W.BLIGHT : W.SANDSTONE);
    }
    if (rand() < 0.05) blob(tiles, walls, w, h, x, s + 7 + Math.floor(rand() * 10), 2 + Math.floor(rand() * 2), T.CLAY, W.CLAY);
    if (rand() < 0.03) blob(tiles, walls, w, h, x, s + 20 + Math.floor(rand() * 40), 3 + Math.floor(rand() * 3), def.sub, def.subWall);
  }
}

function blob(tiles, walls, w, h, cx, cy, r, id, wallId) {
  const idx = (x, y) => y * w + x;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || x >= w || y < 0 || y >= h - BEDROCK) continue;
      if (dx * dx + dy * dy > r * r) continue;
      const t = tiles[idx(x, y)];
      if (t === T.AIR) continue;
      tiles[idx(x, y)] = id;
      if (wallId != null) walls[idx(x, y)] = wallId;
    }
  }
}

// ---------------------------------------------------------------------------
// Caves
// ---------------------------------------------------------------------------

// Cave shapes are generated into a separate mask so the different techniques can
// be composed in the right order: the noisy "swiss cheese" gets cellular-
// automata smoothing (which would eat one-tile-wide tunnels), and the worms,
// entrances and halls are OR-ed in afterwards so they survive intact.
function carveCaves(seed, w, h, surface, spawnTx) {
  const cheeseA = makeFbm2D((seed ^ 0xca7e5a) >>> 0, 3);
  const cheeseB = makeFbm2D((seed ^ 0x5eed11) >>> 0, 3);
  const bottom = h - BEDROCK - 1;
  let cave = new Uint8Array(w * h);
  const at = (x, y) => y * w + x;

  // 1) Swiss cheese. The threshold eases in below the surface and opens up with
  //    depth, so the dirt layer stays mostly solid and the cavern layer is airy.
  for (let x = 1; x < w - 1; x++) {
    const s = surface[x];
    for (let y = s + 5; y <= bottom; y++) {
      const depth = (y - s) / Math.max(1, bottom - s);
      const ease = smoothstep(0, 0.10, depth);          // don't undermine the surface
      const openness = 0.05 + depth * 0.07;             // deeper = more open
      // Ridged noise: two decorrelated fields, each strongest where it sits near
      // its midpoint. Their product is high only along the narrow band where
      // *both* are near the middle, which reads as connected winding ribbons
      // rather than a field of isolated bubbles.
      const a = cheeseA(x * 0.055, y * 0.055);
      const b = cheeseB(x * 0.085 + 40, y * 0.085 + 40);
      const ridge = (1 - Math.abs(a - 0.5) * 2) * (1 - Math.abs(b - 0.5) * 2);
      if (ridge > 0.82 - openness * ease) cave[at(x, y)] = 1;
    }
  }

  // 2) Smooth it. Blobby organic walls instead of noisy speckle.
  cave = smoothCave(cave, w, h, surface, bottom, 3);

  // 3) Worm tunnels — long meandering passages that tie the cheese together.
  const rc = mulberry32((seed ^ 0x77c0de) >>> 0);
  const systems = 6 + Math.floor(w / 55);
  for (let i = 0; i < systems; i++) {
    const x = 6 + Math.floor(rc() * (w - 12));
    const y = UNDERGROUND_Y + Math.floor(rc() * (bottom - UNDERGROUND_Y - 6));
    worm(cave, w, h, surface, bottom, rc, x, y, rc() * Math.PI * 2, 70 + (rc() * 110) | 0, 1 + (rc() < 0.5 ? 1 : 0), 3);
  }

  // 4) Surface entrances — shafts that visibly break the surface and reach down
  //    far enough to meet the cheese layer. Only the first few steps are allowed
  //    to cut the surface line, so the mouth stays a readable opening instead of
  //    the tunnel scraping a long trench along the skyline.
  const entrances = 6 + (rc() * 4 | 0);
  for (let e = 0; e < entrances; e++) {
    const x = 8 + Math.floor(rc() * (w - 16));
    if (Math.abs(x - spawnTx) < SPAWN_PLAIN + 8) continue;
    // A straight shaft first, so the mouth is an unmistakable hole in the ground
    // rather than a tunnel that happens to graze the surface, then a meandering
    // worm from the bottom of it to join the cave network.
    const shaftLen = 8 + (rc() * 7 | 0);
    const shaftY = shaft(cave, w, surface, bottom, x, shaftLen);
    const len = 46 + (rc() * 70) | 0;
    worm(cave, w, h, surface, bottom, rc, x, shaftY, Math.PI / 2 + (rc() - 0.5) * 0.6, len, 1, 2);
  }

  // 5) Cavern halls — landmarks and loot rooms down deep.
  const halls = 4 + Math.floor(w / 150);
  for (let c = 0; c < halls; c++) {
    const cx = 10 + Math.floor(rc() * (w - 20));
    const cy = CAVERN_Y + Math.floor(rc() * Math.max(1, bottom - CAVERN_Y - 8));
    ellipse(cave, w, h, surface, bottom, cx, Math.min(cy, bottom - 5), 5 + (rc() * 5 | 0), 3 + (rc() * 3 | 0));
  }

  return cave;
}

function smoothCave(cave, w, h, surface, bottom, passes) {
  const at = (x, y) => y * w + x;
  let src = cave;
  for (let p = 0; p < passes; p++) {
    const dst = new Uint8Array(src.length);
    for (let x = 1; x < w - 1; x++) {
      const top = surface[x] + 5;
      for (let y = top; y <= bottom; y++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            n += src[at(x + dx, y + dy)] ? 1 : 0;
          }
        }
        // Open tiles need company to survive and closed tiles need a crowd to
        // open, which rounds cave edges off and dissolves lone speckle.
        dst[at(x, y)] = src[at(x, y)] ? (n >= 4 ? 1 : 0) : (n >= 6 ? 1 : 0);
      }
    }
    src = dst;
  }
  return src;
}

// A wandering tunnel with optional branching. `breakSurface` is the number of
// leading steps allowed to cut the surface line, so an entrance shaft can open a
// mouth without the rest of the tunnel gouging the skyline.
function worm(cave, w, h, surface, bottom, rc, x, y, ang, len, radius, depth, breakSurface = 0) {
  for (let i = 0; i < len; i++) {
    disc(cave, w, h, surface, bottom, Math.round(x), Math.round(y), radius, i < breakSurface);
    ang += (rc() - 0.5) * 0.55;
    x += Math.cos(ang) * 1.5;
    y += Math.sin(ang) * 1.5;
    if (x < 3) { x = 3; ang = 0; }
    if (x > w - 4) { x = w - 4; ang = Math.PI; }
    const sx = clamp(Math.round(x), 0, w - 1);
    // Steer back down whenever we climb toward the surface line.
    if (y < surface[sx] + 3) { ang = Math.abs(ang) || 0.7; y = Math.max(y, surface[sx] + 1); }
    if (y > bottom) { y = bottom; ang = -Math.abs(ang); }
    if (rc() < 0.04) disc(cave, w, h, surface, bottom, Math.round(x), Math.round(y), radius + 2, false);
    if (depth > 0 && rc() < 0.022 && len - i > 20) {
      worm(cave, w, h, surface, bottom, rc, x, y, ang + (rc() < 0.5 ? -1 : 1) * (0.8 + rc()), (20 + rc() * 36) | 0, Math.max(1, radius - 1), depth - 1);
    }
  }
}

// A vertical entrance shaft, two tiles wide at the mouth so it reads clearly
// from the surface. Returns the y it bottoms out at.
function shaft(cave, w, surface, bottom, x, len) {
  const y0 = surface[x];
  const y1 = Math.min(bottom, y0 + len);
  for (let y = y0; y <= y1; y++) {
    for (let dx = 0; dx <= 1; dx++) {
      const nx = x + dx;
      if (nx < 1 || nx >= w - 1) continue;
      if (y < surface[nx]) continue; // never open a hole in a neighbour's sky
      cave[y * w + nx] = 1;
    }
  }
  return y1;
}

function disc(cave, w, h, surface, bottom, cx, cy, r, fromSurface) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 1 || x >= w - 1 || y < 1 || y > bottom) continue;
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > r * r + 0.4) continue;
      // Never punch a hole into open sky — except for entrance shafts, which are
      // allowed to break exactly the surface tile.
      const limit = surface[x] + (fromSurface ? 0 : 3);
      if (y < limit) continue;
      cave[y * w + x] = 1;
    }
  }
}

function ellipse(cave, w, h, surface, bottom, cx, cy, rx, ry) {
  for (let y = -ry; y <= ry; y++) {
    for (let x = -rx; x <= rx; x++) {
      if ((x * x) / (rx * rx) + (y * y) / (ry * ry) > 1) continue;
      const nx = cx + x, ny = cy + y;
      if (nx < 2 || nx >= w - 2 || ny < surface[nx] + 4 || ny > bottom) continue;
      cave[ny * w + nx] = 1;
    }
  }
}

// Apply the cave mask: clear the tile, keep the wall behind it.
function applyCaves(tiles, cave, w, h, surface, spawnTx) {
  const idx = (x, y) => y * w + x;
  for (let x = 0; x < w; x++) {
    // The spawn plain is never undermined, so the player can't fall into a cave
    // the instant the world loads.
    const protectedCol = Math.abs(x - spawnTx) <= SPAWN_PLAIN;
    for (let y = 0; y < h - BEDROCK; y++) {
      if (!cave[idx(x, y)]) continue;
      if (protectedCol && y < surface[x] + 10) continue;
      tiles[idx(x, y)] = T.AIR;
    }
  }
}

// ---------------------------------------------------------------------------
// Ore
// ---------------------------------------------------------------------------

// Depth-banded with per-tier rarity. `from`/`to` are absolute tile rows unless
// `fromSurface` is set, in which case they are measured below the surface line.
const ORE_BANDS = [
  { id: T.CUPRITE,   density: 0.0130, from: 4,   to: CAVERN_Y,        size: [3, 7], fromSurface: true },
  { id: T.IRONVEIN,  density: 0.0092, from: 12,  to: WORLD_H,         size: [3, 6], fromSurface: true },
  { id: T.GLIMMER,   density: 0.0050, from: UNDERGROUND_Y + 6, to: WORLD_H, size: [2, 5] },
  { id: T.AETHERITE, density: 0.0040, from: CAVERN_Y - 14, to: WORLD_H, size: [2, 5] },
  { id: T.BLIGHTORE, density: 0.0220, from: UNDERGROUND_Y, to: WORLD_H, size: [2, 5], hostMat: 'blightstone' },
];

function seedOres(tiles, w, h, surface, rand) {
  const idx = (x, y) => y * w + x;
  for (const band of ORE_BANDS) {
    for (let x = 0; x < w; x++) {
      const minY = band.fromSurface ? surface[x] + band.from : band.from;
      const maxY = Math.min(band.to, h - BEDROCK - 1);
      for (let y = Math.max(0, minY); y < maxY; y++) {
        if (rand() >= band.density) continue;
        // Blightore only forms inside blightstone, so it stays a corruption
        // resource instead of appearing under the forest.
        if (band.hostMat && tiles[idx(x, y)] !== T.BLIGHTSTONE) continue;
        const n = band.size[0] + Math.floor(rand() * (band.size[1] - band.size[0] + 1));
        vein(tiles, w, h, x, y, n, band.id, rand, minY);
      }
    }
  }
}

// A vein wanders as it grows, so it is clamped to the band it belongs to —
// otherwise a vein seeded on the boundary walks a tile or two out of its depth
// range and, say, blightore shows up above the underground line.
function vein(tiles, w, h, cx, cy, n, id, rand, minY) {
  const idx = (x, y) => y * w + x;
  let x = cx, y = cy;
  for (let i = 0; i < n; i++) {
    if (y < minY) y = minY;
    if (x > 0 && x < w && y > 0 && y < h - BEDROCK) {
      const t = tiles[idx(x, y)];
      if (t === T.STONE || t === T.BLIGHTSTONE || t === T.DEEPSTONE || t === T.DIRT || t === T.SANDSTONE) {
        tiles[idx(x, y)] = id;
      }
    }
    // Veins prefer to grow sideways, which reads as a seam rather than a blob.
    x += (rand() < 0.6 ? (rand() < 0.5 ? -1 : 1) : 0);
    y += (rand() < 0.45 ? (rand() < 0.5 ? -1 : 1) : 0);
  }
}

// ---------------------------------------------------------------------------
// Decoration
// ---------------------------------------------------------------------------

function decorate(tiles, w, h, surface, biome, rand, spawnTx) {
  const idx = (x, y) => y * w + x;

  // Surface flora, biome by biome.
  for (let x = 3; x < w - 3; x++) {
    const def = BIOMES[BIOME_ORDER[biome.map[x]]];
    const s = surface[x];
    const ground = tiles[idx(x, s)];
    if (ground === T.AIR) continue;
    // Leave the immediate spawn clear so the player and the Guide always have
    // headroom and a clean view of the camp.
    if (Math.abs(x - spawnTx) <= 3) continue;

    if (def.treeChance && rand() < def.treeChance && tiles[idx(x, s - 1)] === T.AIR) {
      placeTree(tiles, w, h, x, s - 1, def, rand);
      x += 2 + Math.floor(rand() * 2);
      continue;
    }
    if (def.cactusChance && rand() < def.cactusChance && ground === T.SAND) {
      const tall = 2 + Math.floor(rand() * 3);
      for (let i = 0; i < tall; i++) if (tiles[idx(x, s - 1 - i)] === T.AIR) tiles[idx(x, s - 1 - i)] = T.CACTUS;
      x += 2;
      continue;
    }
    if (def.grassChance && rand() < def.grassChance && tiles[idx(x, s - 1)] === T.AIR &&
        (ground === T.GRASS || ground === T.BLIGHTGRASS)) {
      tiles[idx(x, s - 1)] = T.TALLGRASS;
    }
    if (def.iceChance && rand() < def.iceChance) {
      blobTilesOnly(tiles, w, h, x, s + 2 + Math.floor(rand() * 6), 1 + Math.floor(rand() * 2), T.ICE, [T.SNOW, T.STONE]);
    }
  }

  // Corruption thornvines hanging from cave and chasm ceilings.
  for (let x = 0; x < w; x++) {
    if (BIOME_ORDER[biome.map[x]] !== 'corrupt') continue;
    for (let y = surface[x] + 1; y < h - BEDROCK - 1; y++) {
      if (tiles[idx(x, y)] === T.AIR && tiles[idx(x, y - 1)] !== T.AIR && rand() < 0.045) {
        tiles[idx(x, y)] = T.THORNVINE;
      }
    }
  }

  // Cave dressing: stalagmites on floors, stalactites on ceilings.
  for (let x = 2; x < w - 2; x++) {
    for (let y = Math.max(surface[x] + 6, UNDERGROUND_Y - 20); y < h - BEDROCK - 1; y++) {
      if (tiles[idx(x, y)] !== T.AIR) continue;
      if (rand() < 0.020 && tiles[idx(x, y + 1)] !== T.AIR && tiles[idx(x, y - 1)] === T.AIR) tiles[idx(x, y)] = T.STALAGMITE;
      else if (rand() < 0.018 && tiles[idx(x, y - 1)] !== T.AIR && tiles[idx(x, y + 1)] === T.AIR) tiles[idx(x, y)] = T.STALACTITE;
    }
  }
}

function blobTilesOnly(tiles, w, h, cx, cy, r, id, replaceable) {
  const idx = (x, y) => y * w + x;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || x >= w || y < 0 || y >= h - BEDROCK) continue;
      if (dx * dx + dy * dy > r * r) continue;
      if (replaceable.includes(tiles[idx(x, y)])) tiles[idx(x, y)] = id;
    }
  }
}

// Trees: a one-tile trunk plus a canopy whose shape depends on the biome. The
// trunk stays one tile wide so chop-and-fell (systems/combat.collapseTree) keeps
// working; branches and roots are drawn *inside* the trunk sprite from the
// tile's neighbours, so they cost no extra tiles.
function placeTree(tiles, w, h, x, baseY, def, rand) {
  const idx = (x2, y2) => y2 * w + x2;
  const [minH, maxH] = def.treeHeight || [5, 9];
  const height = minH + Math.floor(rand() * (maxH - minH + 1));
  const trunk = def.treeTile != null ? def.treeTile : T.WOOD;
  for (let i = 0; i < height; i++) {
    const y = baseY - i;
    if (y > 1 && tiles[idx(x, y)] === T.AIR) tiles[idx(x, y)] = trunk;
    else break;
  }
  const topY = baseY - height;
  const leaf = def.leafTile;
  if (leaf == null) return; // dead trees (corruption) have no canopy

  const put = (lx, ly) => {
    if (lx < 0 || lx >= w || ly < 1) return;
    if (tiles[idx(lx, ly)] === T.AIR) tiles[idx(lx, ly)] = leaf;
  };

  if (def.canopy === 'conifer') {
    // Frostpines taper: a wide skirt narrowing to a point, and the needles run
    // most of the way down the trunk so the tree reads as a pine rather than a
    // bare pole with a tuft on top.
    // Row 0 is the tip; the skirt widens as it descends, capped at 3 either
    // side, so the silhouette is a proper cone down most of the trunk.
    const skirt = Math.max(7, Math.round(height * 0.8));
    for (let row = 0; row < skirt; row++) {
      const ly = topY + row;
      const radius = Math.min(3, Math.floor(row / 2));
      for (let dx = -radius; dx <= radius; dx++) put(x + dx, ly);
    }
  } else {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        // Slight asymmetry keeps every canopy from being the same stamp.
        const bias = rand() < 0.15 ? 1 : 0;
        if (Math.abs(dx) + Math.abs(dy) <= 4 - bias) put(x + dx, topY + dy);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Spawn safety
// ---------------------------------------------------------------------------

// Final authority on the no-wall band near the surface. Pocket blobs and the
// spawn seal both write walls, so rather than special-casing each of them this
// runs last and guarantees the invariant: nothing within SURFACE_WALL_GAP tiles
// of the surface line carries a wall, so shallow digging always stays daylit.
function clearSurfaceWalls(walls, w, h, surface) {
  for (let x = 0; x < w; x++) {
    const y1 = Math.min(h - 1, surface[x] + SURFACE_WALL_GAP);
    for (let y = 0; y <= y1; y++) walls[y * w + x] = W.NONE;
  }
}

// Guarantee solid, walkable ground under the spawn plain even after decoration
// and pocket generation, so the player and the Guide never start over a void.
function sealSpawn(tiles, walls, w, h, surface, spawnTx, biome) {
  const idx = (x, y) => y * w + x;
  const def = BIOMES[BIOME_ORDER[biome.map[spawnTx]]];
  for (let dx = -SPAWN_PLAIN; dx <= SPAWN_PLAIN; dx++) {
    const x = spawnTx + dx;
    if (x < 0 || x >= w) continue;
    const s = surface[x];
    if (tiles[idx(x, s)] === T.AIR) { tiles[idx(x, s)] = def.surface; walls[idx(x, s)] = def.wall; }
    for (let dy = 1; dy <= 8; dy++) {
      if (tiles[idx(x, s + dy)] === T.AIR) { tiles[idx(x, s + dy)] = def.sub; walls[idx(x, s + dy)] = def.subWall; }
    }
    // Keep headroom above the plain. Right at spawn this is unconditional so a
    // canopy can never box the player in; further out, trees are left standing.
    for (let dy = 1; dy <= 2; dy++) {
      const id = tiles[idx(x, s - dy)];
      if (id === T.AIR) continue;
      const isFlora = id === def.treeTile || id === def.leafTile;
      if (!isFlora || Math.abs(dx) <= 3) tiles[idx(x, s - dy)] = T.AIR;
    }
  }
}
