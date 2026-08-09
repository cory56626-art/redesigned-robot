// Summoner Realms — procedural world generation.
//
// Shape of a generated world, surface to bedrock:
//
//   sky        · nothing, daylight reaches down to the first solid tile
//   surface    · biome bands (Dunes / Verdant Reach / Verdant Jungle /
//                Frostpine Hollow / Snowy Taiga / Corrupted Lands) with blended seams, each with its own
//                height profile, tile palette and decor
//   subsurface · dirt / snow / sand, 4-13 tiles thick with a noisy underside
//   stone      · with a speckled dirt-and-stone transition band above it
//   deepstone  · below CAVERN_Y, noisy transition, with ore tiers at depth
//   sky        · small floating islands above the surface for Storm Ore
//
// Everything solid is generated with a background *wall* behind it, then caves
// are carved out of that rock. The wall stays, so a cave reads as an enclosed
// space rather than a window to the sky (see world/walls.js).
//
// Deterministic from a numeric seed. `tools/worldgen-check.mjs` asserts the
// invariants this file is responsible for.
import { WORLD_W, WORLD_H, SURFACE_Y, UNDERGROUND_Y, CAVERN_Y, TILE, LIQUID_MAX } from '../config.js?v=hivewrought-1';
import { T, isSolid, isFlora } from './tiles.js?v=hivewrought-1';
import { W } from './walls.js?v=hivewrought-1';
import { BIOMES, BIOME_ORDER, buildBiomeMap, blendProp } from './biomes.js?v=hivewrought-1';
import { mulberry32, makeFbm1D, makeFbm2D, makeValueNoise2D, clamp, smoothstep, lerp } from '../utils.js?v=hivewrought-1';

// Half-width of the guaranteed flat, cave-free plain the player spawns on.
const SPAWN_PLAIN = 13;
export const BEDROCK = 4; // solid tiles kept at the very bottom of the world
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

  decorate(tiles, w, h, surface, biome, rand, spawnTx);
  // Floating islands are ordinary terrain structures rather than a new biome;
  // Storm Ore uses their tile mask as its placement boundary.
  const skyIslands = placeSkyIslands(tiles, w, h, surface, seed, spawnTx);

  sealSpawn(tiles, walls, w, h, surface, spawnTx, biome);
  // Decoration and the spawn seal both write tiles into carved space, which can
  // pinch a passage shut and strand a handful of air behind it. Sealing runs
  // last, on the finished grid, so the "no unreachable pockets" guarantee holds
  // for what the player actually gets rather than for the cave mask.
  sealTinyPockets(tiles, w, h, surface);
  clearSurfaceWalls(walls, w, h, surface);

  // Water goes in last: it settles into whatever shape the finished terrain
  // left behind, so it can never be buried by a later decoration pass.
  const liquid = fillWater(tiles, w, h, surface, biome, seed, spawnTx);
  seedOres(tiles, liquid, w, h, surface, biome, seed, skyIslands);
  // Chests and wall-mounted dart traps are placed after water has settled, so
  // neither object can split a basin or spawn submerged.
  placeUndergroundFeatures(tiles, liquid, w, h, surface, rand, spawnTx);

  const spawnY = (surface[spawnTx] - 3) * TILE;
  return {
    tiles, walls, liquid, width: w, height: h, surface,
    biomeMap: biome.map, biomeBands: biome.bands,
    spawnTx, spawnX: spawnTx * TILE, spawnY, skyIslands,
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
//
// The previous generator sampled two ridged noise fields at the same frequency
// on both axes, smoothed the result with a symmetric cellular automaton, and
// OR-ed in fixed-radius worms. Isotropic noise has no reason to prefer
// horizontal shapes, so it produced a chaotic field of bubbles; symmetric
// smoothing then pinched off the narrow links between them; and nothing
// guaranteed the survivors were connected to anything. The result read as
// "janky and all over the place" because that is structurally what it was.
//
// This generator is built around the qualities that actually make a cave
// system read as one:
//
//   * Caves run *horizontally*. The noise field is stretched along x and warped
//     by a second low-frequency field, so cavities come out as long bending
//     ribbons instead of round blobs.
//   * Caves change character with depth. Three profiles — dirt, stone, cavern —
//     are interpolated by depth, so the layer just under the grass is tight and
//     sparse while the deep cavern layer is wide and open, with no visible line
//     where one becomes the other.
//   * Smoothing preserves passages. The cellular automaton uses a wide kernel,
//     so a horizontal corridor survives it and only vertical speckle dissolves.
//   * Tunnels have momentum. They keep a heading and turn gradually, with a
//     radius that pinches and swells, instead of jittering a fixed-width tube.
//   * Everything is connected. A final flood-fill fills in isolated pockets and
//     digs links between the components that remain, so exploring underground
//     leads somewhere instead of dead-ending into rock.

// threshold : the cavity field must exceed this to open rock. The field is a
//             product of two ridged fbm fields, which concentrates hard near 1,
//             so useful thresholds all live in a narrow band near the top —
//             small changes here move the open fraction a lot.
// xScale/yScale : sampling frequency per axis. x < y stretches caves sideways,
//             which is the whole reason these read as passages and not bubbles.
// warp      : how far the domain-warp field displaces the sample point
const CAVE_PROFILES = {
  dirt:   { threshold: 0.918, xScale: 0.024, yScale: 0.078, warp: 5.0 },
  stone:  { threshold: 0.868, xScale: 0.019, yScale: 0.062, warp: 7.0 },
  cavern: { threshold: 0.808, xScale: 0.015, yScale: 0.050, warp: 9.0 },
};

// Cave components smaller than this are not caves, they are bubbles. Filling
// them back in is the single biggest readability win in this pass.
const MIN_CAVE_ROOM = 10;

function carveCaves(seed, w, h, surface, spawnTx) {
  const bottom = h - BEDROCK - 1;
  let cave = new Uint8Array(w * h);
  const rc = mulberry32((seed ^ 0x77c0de) >>> 0);

  noiseCavities(cave, seed, w, h, surface, bottom);
  cave = smoothCave(cave, w, h, surface, bottom, 2);
  carveTunnels(cave, w, h, surface, bottom, rc, seed);
  carveChambers(cave, w, h, surface, bottom, rc);
  carveEntrances(cave, w, h, surface, bottom, rc, spawnTx);
  connectCaves(cave, w, h, surface, bottom);

  return cave;
}

// Depth 0 at the surface line, 1 at bedrock. Everything below is expressed in
// terms of this so profiles blend rather than switching at a threshold.
function depthAt(y, s, bottom) {
  return clamp((y - s) / Math.max(1, bottom - s), 0, 1);
}

// Interpolate a profile field across the three depth bands. The anchors are the
// *surface line* for dirt and the two layer boundaries for stone and cavern, so
// the blend is relative to how far below the grass you actually are. Anchoring
// the dirt end at absolute y=0 instead would put the sky at one end of the
// interpolation and leave the whole dirt layer already reading as stone.
// Depth below the surface at which the dirt profile has fully become the stone
// profile. Roughly the thickness of the dirt-and-transition band, so the tight
// shallow caves stop where the rock actually starts rather than at an arbitrary
// absolute row.
const DIRT_BAND = 30;

function profileAt(y, s, key) {
  const dirt = CAVE_PROFILES.dirt[key];
  const stone = CAVE_PROFILES.stone[key];
  const cavern = CAVE_PROFILES.cavern[key];
  const stoneStart = s + DIRT_BAND;
  if (y <= stoneStart) {
    return lerp(dirt, stone, smoothstep(0, 1, (y - s) / DIRT_BAND));
  }
  const t = smoothstep(0, 1, (y - stoneStart) / Math.max(1, CAVERN_Y - stoneStart));
  return lerp(stone, cavern, t);
}

// 1) The cavity field.
//
// Two things make this read as caves rather than as noise. The sample point is
// displaced by a low-frequency warp field, which bends otherwise straight
// features into organic curves; and x is sampled at roughly 2.5x the scale of
// y, which stretches every feature horizontally. Terraria's caves are wider
// than they are tall, and so are these.
function noiseCavities(cave, seed, w, h, surface, bottom) {
  // Two decorrelated fields. Each ridged term peaks where its field sits near
  // its own midline; their product is high only along the narrow band where
  // *both* do, which traces out connected winding ribbons rather than a field
  // of independent highs. Sampling them at different frequencies keeps the two
  // bands from ever running parallel for long.
  const fieldA = makeFbm2D((seed ^ 0xca7e5a) >>> 0, 4);
  const fieldB = makeFbm2D((seed ^ 0x5eed11) >>> 0, 3);
  const warpX = makeFbm2D((seed ^ 0xbea751) >>> 0, 2);
  const warpY = makeFbm2D((seed ^ 0x31f0a2) >>> 0, 2);
  const at = (x, y) => y * w + x;

  for (let x = 1; x < w - 1; x++) {
    const s = surface[x];
    for (let y = s + 5; y <= bottom; y++) {
      const d = depthAt(y, s, bottom);
      // Never undermine the surface: the top of the dirt layer eases in.
      const ease = smoothstep(0, 0.08, d);
      if (ease <= 0) continue;

      const xScale = profileAt(y, s, 'xScale');
      const yScale = profileAt(y, s, 'yScale');
      const warp = profileAt(y, s, 'warp');
      const threshold = profileAt(y, s, 'threshold');

      // Domain warp: offset the sample point by a slowly-varying vector.
      const wx = (warpX(x * 0.012, y * 0.012) - 0.5) * 2 * warp;
      const wy = (warpY(x * 0.014 + 31, y * 0.014 + 31) - 0.5) * 2 * warp;

      const a = fieldA((x + wx) * xScale, (y + wy) * yScale);
      const b = fieldB((x + wx) * xScale * 1.7 + 40, (y + wy) * yScale * 1.7 + 40);
      const ridge = (1 - Math.abs(a - 0.5) * 2) * (1 - Math.abs(b - 0.5) * 2);
      // `ease` keeps the top of the dirt layer solid so caves don't undermine
      // the surface; it raises the bar rather than gating outright.
      if (ridge > threshold + (1 - ease) * 0.12) cave[at(x, y)] = 1;
    }
  }
}

// 2) Smoothing with a wide kernel.
//
// A symmetric 3x3 automaton treats a one-tile-tall horizontal corridor and a
// one-tile-wide vertical shaft identically, and dissolves both. Sampling 2
// tiles either side but only 1 above and below biases survival toward
// horizontal structure: corridors live, vertical speckle dies, and ceilings
// round over.
function smoothCave(cave, w, h, surface, bottom, passes) {
  const at = (x, y) => y * w + x;
  let src = cave;
  for (let p = 0; p < passes; p++) {
    const dst = new Uint8Array(src.length);
    for (let x = 2; x < w - 2; x++) {
      const top = surface[x] + 5;
      for (let y = top; y <= bottom; y++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (dx === 0 && dy === 0) continue;
            const yy = y + dy;
            if (yy < 0 || yy >= h) continue;
            n += src[at(x + dx, yy)] ? 1 : 0;
          }
        }
        // 14 neighbours in this kernel, so the thresholds are scaled from the
        // classic 4-of-8 / 5-of-8 rule.
        dst[at(x, y)] = src[at(x, y)] ? (n >= 6 ? 1 : 0) : (n >= 10 ? 1 : 0);
      }
    }
    src = dst;
  }
  return src;
}

// 3) Tunnels with momentum.
//
// The old worm added a random angular offset every step, which produced tight
// squiggles. This one integrates an angular *velocity* with damping and a
// restoring pull toward horizontal, so a tunnel commits to a direction and
// sweeps through long curves. Its radius is modulated along the length, so a
// passage narrows to a squeeze and opens into a chamber the way a real one does.
function carveTunnels(cave, w, h, surface, bottom, rc, seed) {
  const count = 3 + Math.floor(w / 140);
  for (let i = 0; i < count; i++) {
    const x = 6 + Math.floor(rc() * (w - 12));
    // Bias starts toward the middle and lower layers, where caves belong.
    const yMin = UNDERGROUND_Y - 18;
    const y = yMin + Math.floor(rc() * Math.max(1, bottom - yMin - 6));
    // Start heading roughly sideways.
    const ang = (rc() < 0.5 ? 0 : Math.PI) + (rc() - 0.5) * 0.8;
    const len = 90 + (rc() * 150) | 0;
    const baseRadius = 1.1 + rc() * 1.1;
    tunnel(cave, w, h, surface, bottom, rc, x, y, ang, len, baseRadius, 2);
  }
}

function tunnel(cave, w, h, surface, bottom, rc, x, y, ang, len, baseRadius, depth, opts = {}) {
  const breakSurface = opts.breakSurface || 0;
  // Tunnels are a rock-layer feature. Left free to wander they spend most of
  // their length in the dirt layer, which hollows out the ground right under
  // the grass and is a large part of why the old caves felt arbitrary. Only
  // entrance tunnels are allowed to run shallow.
  const ceiling = opts.ceiling != null ? opts.ceiling : UNDERGROUND_Y - 8;
  // Minimum depth below the surface line. The absolute `ceiling` alone is not
  // enough: where the terrain rides high, an absolute row can sit inside the
  // shallow band, and tunnels then hollow out the very layer that is meant to
  // stay tight.
  const clearance = opts.clearance != null ? opts.clearance : DIRT_BAND;
  // Descending tunnels need a livelier random walk than horizontal ones, since
  // the restoring torque barely acts on them.
  const wander = opts.wander || 1;
  // Steps over which the tunnel widens from a throat to its full bore. A
  // sinkhole's neck is narrow and opens into the cave below; without this the
  // full-width tunnel carves out as much shallow ground as the entire noise
  // field does, which flattens the depth profile the layers are built on.
  const growIn = opts.growIn || 0;
  // An entrance tunnel's job is to get *down* to the cave system. Without a
  // descent bias it is free to run horizontally just under the surface for its
  // whole length, hollowing out the shallow band it was supposed to pass
  // straight through. The bias applies only while it is still shallow.
  const sink = opts.sink || 0;
  let angVel = 0;
  // Each tunnel gets its own radius rhythm so they don't all pulse in step.
  const radPhase = rc() * Math.PI * 2;
  const radFreq = 0.05 + rc() * 0.07;

  for (let i = 0; i < len; i++) {
    // Radius grows with depth — the cavern layer is meant to feel open — and
    // breathes along the length.
    const depthK = clamp((y - UNDERGROUND_Y) / Math.max(1, bottom - UNDERGROUND_Y), 0, 1);
    const breathe = 1 + Math.sin(radPhase + i * radFreq) * 0.35;
    const throat = growIn ? lerp(0.5, 1, Math.min(1, i / growIn)) : 1;
    const radius = Math.max(1, Math.round(baseRadius * breathe * throat * (1 + depthK * 0.7)));

    disc(cave, w, h, surface, bottom, Math.round(x), Math.round(y), radius, i < breakSurface);

    // Steering: random impulse, damping, and a restoring torque toward the
    // nearest horizontal heading. The restoring term is what stops a tunnel
    // from wandering into a vertical drill.
    angVel += (rc() - 0.5) * 0.13 * wander;
    angVel *= 0.86;
    const toHorizontal = Math.sin(ang * 2) * -0.085;
    ang += angVel + toHorizontal;

    const sx0 = clamp(Math.round(x), 0, w - 1);
    const stillShallow = y < surface[sx0] + DIRT_BAND;
    x += Math.cos(ang) * 1.6;
    y += Math.sin(ang) * 1.6 + (sink && stillShallow ? sink : 0);

    if (x < 3) { x = 3; ang = 0; angVel = 0; }
    if (x > w - 4) { x = w - 4; ang = Math.PI; angVel = 0; }
    const sx = clamp(Math.round(x), 0, w - 1);
    // Steer back down whenever we climb above this tunnel's ceiling, and never
    // let one approach the surface line regardless.
    const limit = Math.max(ceiling, surface[sx] + clearance);
    if (y < limit) { ang = Math.abs(ang) || 0.7; angVel = 0; y = Math.max(y, limit); }
    if (y > bottom - 1) { y = bottom - 1; ang = -Math.abs(ang); angVel = 0; }

    // Occasional widening: a small chamber part-way along a passage.
    if (rc() < 0.03) disc(cave, w, h, surface, bottom, Math.round(x), Math.round(y), radius + 2, false);

    // Branches inherit a share of the parent's size, so a system reads as a
    // trunk with side passages rather than a tangle of equal tubes.
    if (depth > 0 && rc() < 0.018 && len - i > 30) {
      tunnel(cave, w, h, surface, bottom, rc,
        x, y, ang + (rc() < 0.5 ? -1 : 1) * (0.7 + rc() * 0.7),
        (30 + rc() * 55) | 0, Math.max(1.1, baseRadius * 0.7), depth - 1, { ceiling, clearance });
    }
  }
}

// 4) Cavern chambers.
//
// Terraria's big rooms are built by walking a short path and stamping
// overlapping circles along it, which gives a lumpy organic outline instead of
// the obvious ellipse a single stamp produces. Chambers grow with depth and are
// concentrated in the cavern layer.
function carveChambers(cave, w, h, surface, bottom, rc) {
  const count = 9 + Math.floor(w / 80);
  for (let c = 0; c < count; c++) {
    // Two thirds of chambers live below the cavern line. Chosen by index
    // rather than by dice so the deep layer is reliably the roomiest one.
    const deep = (c % 3) !== 0;
    const yMin = deep ? CAVERN_Y : UNDERGROUND_Y;
    const yMax = deep ? bottom - 6 : CAVERN_Y;
    if (yMax <= yMin) continue;
    let x = 12 + Math.floor(rc() * (w - 24));
    let y = yMin + Math.floor(rc() * (yMax - yMin));
    const blobs = 4 + (rc() * 6) | 0;
    const scale = deep ? 1.25 : 0.65;
    let ang = rc() * Math.PI * 2;
    for (let b = 0; b < blobs; b++) {
      const r = Math.round((2.5 + rc() * 3.5) * scale);
      disc(cave, w, h, surface, bottom, Math.round(x), Math.round(y), r, false);
      // Chambers spread wider than they are tall, matching the cave language.
      ang += (rc() - 0.5) * 1.4;
      x += Math.cos(ang) * (r * 1.15);
      y += Math.sin(ang) * (r * 0.55);
      x = clamp(x, 4, w - 5);
      y = clamp(y, yMin, bottom - 3);
    }
  }
}

// 5) Surface entrances.
//
// A 2-tile vertical shaft reads as a mineshaft somebody dug, not as a cave.
// This opens a sinkhole instead: a wide mouth at the surface that narrows as it
// descends, which is what erosion actually leaves behind, and then hands off to
// a momentum tunnel that joins the network below.
function carveEntrances(cave, w, h, surface, bottom, rc, spawnTx) {
  const count = 5 + (rc() * 4 | 0);
  for (let e = 0; e < count; e++) {
    const x = 10 + Math.floor(rc() * (w - 20));
    if (Math.abs(x - spawnTx) < SPAWN_PLAIN + 10) continue;

    const mouth = 2 + (rc() * 2 | 0);          // widest half-width, just below the lip
    // Short and bowl-shaped. A deep narrow channel reads as a drilled shaft;
    // a shallow bell that hands straight off to a diagonal tunnel reads as a
    // collapsed cave roof, which is what a sinkhole actually is.
    const depth = 5 + (rc() * 5 | 0);
    const y0 = surface[x];
    let bottomY = y0;
    for (let d = 0; d <= depth; d++) {
      const y = y0 + d;
      if (y > bottom) break;
      // The very top row stays narrow and the hole bells out a tile or two
      // below it, so a sinkhole is slightly undercut — a wide chamber behind a
      // modest opening. That keeps the skyline intact while still reading as a
      // real way in, instead of gouging a trench across the surface.
      const t = d / depth;
      const bell = d === 0 ? 1 : Math.min(mouth, 1 + d);
      const halfW = Math.max(1, Math.round(bell * (1 - t * 0.45)));
      for (let dx = -halfW; dx <= halfW; dx++) {
        const nx = x + dx;
        if (nx < 1 || nx >= w - 1) continue;
        // Only break the actual surface tile of each column, never punch a hole
        // into a neighbour's sky.
        if (y < surface[nx]) continue;
        cave[y * w + nx] = 1;
      }
      bottomY = y;
    }
    // From the bottom of the sinkhole, a tunnel down into the system.
    //
    // Launched at a real diagonal, never straight down. Vertical is an
    // *unstable* fixed point of the horizontal restoring torque (sin(2a) is
    // zero there), so a tunnel started at exactly PI/2 feels no correction and
    // bores a pin-straight shaft hundreds of tiles deep — which is precisely
    // the artificial-looking artefact this rewrite is meant to remove.
    const lean = (rc() < 0.5 ? -1 : 1) * (0.55 + rc() * 0.5);
    tunnel(cave, w, h, surface, bottom, rc, x, bottomY,
      Math.PI / 2 + lean, 40 + (rc() * 55) | 0, 1.7, 1,
      { ceiling: y0 + depth, wander: 1.7, growIn: 26, clearance: 4, sink: 0.75 });
  }
}

// 6) Connectivity and de-speckle.
//
// Label every connected cave component. Anything smaller than MIN_CAVE_ROOM is
// filled back in — those are the isolated bubbles that made the underground
// feel arbitrary. Every surviving component that is not part of the largest one
// is then linked to its nearest neighbour with a straight bore, so the cave
// system is genuinely traversable rather than a set of disconnected voids that
// happen to share a world.
function connectCaves(cave, w, h, surface, bottom) {
  const at = (x, y) => y * w + x;
  const label = new Int32Array(w * h).fill(-1);
  const components = [];
  const stack = [];

  for (let y = 0; y <= bottom; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = at(x, y);
      if (!cave[i] || label[i] !== -1) continue;
      const id = components.length;
      const cells = [];
      let sumX = 0, sumY = 0;
      stack.push(i); label[i] = id;
      while (stack.length) {
        const ci = stack.pop();
        const cx = ci % w, cy = (ci / w) | 0;
        cells.push(ci); sumX += cx; sumY += cy;
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 1 || nx >= w - 1 || ny < 0 || ny > bottom) continue;
          const ni = at(nx, ny);
          if (!cave[ni] || label[ni] !== -1) continue;
          label[ni] = id;
          stack.push(ni);
        }
      }
      components.push({ id, cells, cx: sumX / cells.length, cy: sumY / cells.length });
    }
  }
  if (!components.length) return;

  // Fill in the bubbles.
  const kept = [];
  for (const c of components) {
    if (c.cells.length < MIN_CAVE_ROOM) {
      for (const i of c.cells) cave[i] = 0;
    } else {
      kept.push(c);
    }
  }
  if (kept.length <= 1) return;

  // Link every component into the largest one. Working from the biggest
  // outward keeps the bores short: each component connects to whichever
  // already-connected component is nearest, so links follow the natural
  // clustering instead of all radiating from one point.
  kept.sort((a, b) => b.cells.length - a.cells.length);
  const connected = [kept[0]];
  for (let i = 1; i < kept.length; i++) {
    const c = kept[i];
    let best = connected[0], bd = Infinity;
    for (const other of connected) {
      const d = (other.cx - c.cx) ** 2 + (other.cy - c.cy) ** 2;
      if (d < bd) { bd = d; best = other; }
    }
    bore(cave, w, h, surface, bottom, c, best);
    connected.push(c);
  }
}

// Dig a passage between two components, from the cell of each that is closest
// to the other. Sampling a subset of cells keeps this linear enough for a
// 700x260 world while still picking a sensible pair of endpoints.
function bore(cave, w, h, surface, bottom, a, b) {
  const pick = (comp, tx, ty) => {
    let best = comp.cells[0], bd = Infinity;
    const step = Math.max(1, Math.floor(comp.cells.length / 160));
    for (let i = 0; i < comp.cells.length; i += step) {
      const ci = comp.cells[i];
      const cx = ci % w, cy = (ci / w) | 0;
      const d = (cx - tx) ** 2 + (cy - ty) ** 2;
      if (d < bd) { bd = d; best = ci; }
    }
    return { x: best % w, y: (best / w) | 0 };
  };
  const pa = pick(a, b.cx, b.cy);
  const pb = pick(b, pa.x, pa.y);

  // Walk from one end to the other with a wandering offset perpendicular to the
  // straight line. A ruled line between two components is instantly readable as
  // machine-made — these links have to look like the passages around them, not
  // like somebody drew them with a straightedge.
  const dx = pb.x - pa.x, dy = pb.y - pa.y;
  const span = Math.hypot(dx, dy);
  const steps = Math.max(2, Math.ceil(span));
  const nx = -dy / (span || 1), ny = dx / (span || 1); // unit normal
  // Two out-of-phase waves so the meander does not read as a single arc.
  const amp = Math.min(6, span * 0.14);
  const ph1 = rand01(a.id * 31 + b.id) * Math.PI * 2;
  const ph2 = rand01(a.id * 17 + b.id * 7) * Math.PI * 2;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Taper the wander to zero at both ends so the link meets each cave square
    // on rather than glancing off it.
    const taper = Math.sin(t * Math.PI);
    const off = (Math.sin(t * Math.PI * 2 + ph1) * 0.7 + Math.sin(t * Math.PI * 5 + ph2) * 0.3) * amp * taper;
    const x = Math.round(pa.x + dx * t + nx * off);
    const y = Math.round(pa.y + dy * t + ny * off);
    // Passages pinch and swell like the tunnels do.
    const r = 1 + (Math.sin(t * Math.PI * 3 + ph1) > 0.55 ? 1 : 0);
    disc(cave, w, h, surface, bottom, x, y, r, false);
  }
}

// Deterministic 0..1 from an integer, so bore meanders are stable for a seed
// without threading another PRNG through the connectivity pass.
function rand01(n) {
  let h = Math.imul(n | 0, 2654435761) | 0;
  h = (h ^ (h >>> 15)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function disc(cave, w, h, surface, bottom, cx, cy, r, fromSurface) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 1 || x >= w - 1 || y < 1 || y > bottom) continue;
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > r * r + 0.4) continue;
      // Never punch a hole into open sky — except for entrances, which are
      // allowed to break exactly the surface tile.
      const limit = surface[x] + (fromSurface ? 0 : 3);
      if (y < limit) continue;
      cave[y * w + x] = 1;
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
    // Surface undergrowth. The old generator had exactly one plant (tall grass)
    // on exactly one tile type, which is why the overworld read as empty. Each
    // biome now gets its own weighted mix, so walking from the forest into the
    // dunes changes what is growing underfoot as well as what the ground is.
    if (def.groundCover && rand() < def.groundCover.chance && tiles[idx(x, s - 1)] === T.AIR &&
        (ground === T.GRASS || ground === T.BLIGHTGRASS || ground === T.SNOW || ground === T.SAND)) {
      tiles[idx(x, s - 1)] = pickWeighted(def.groundCover.plants, rand);
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

  // Cave dressing: stalagmites and mushrooms on floors, stalactites, vines and
  // glowmoss on ceilings. Glowmoss is the only light source down here that the
  // player did not place, so it does real work: it picks out the shape of a
  // chamber before you have torches to spare.
  for (let x = 2; x < w - 2; x++) {
    for (let y = Math.max(surface[x] + 6, UNDERGROUND_Y - 20); y < h - BEDROCK - 1; y++) {
      if (tiles[idx(x, y)] !== T.AIR) continue;
      const floor = tiles[idx(x, y + 1)] !== T.AIR;
      const ceiling = tiles[idx(x, y - 1)] !== T.AIR;
      if (floor && !ceiling) {
        const r = rand();
        if (r < 0.020) tiles[idx(x, y)] = T.STALAGMITE;
        else if (r < 0.034) tiles[idx(x, y)] = T.MUSHROOM;
        else if (r < 0.042) tiles[idx(x, y)] = T.GLOWMOSS;
      } else if (ceiling && !floor) {
        const r = rand();
        if (r < 0.018) tiles[idx(x, y)] = T.STALACTITE;
        else if (r < 0.030) tiles[idx(x, y)] = T.VINE;
        else if (r < 0.038) tiles[idx(x, y)] = T.GLOWMOSS;
      }
    }
  }

  // Reeds along the banks of anything that will hold water. Placed before the
  // water pass so they end up standing *in* the shallows, which is where reeds
  // belong.
  for (let x = 2; x < w - 2; x++) {
    const s = surface[x];
    if (tiles[idx(x, s)] === T.AIR || tiles[idx(x, s - 1)] !== T.AIR) continue;
    // A dip: lower than both neighbours a couple of columns out.
    if (surface[x - 2] < s && surface[x + 2] < s && rand() < 0.25) {
      tiles[idx(x, s - 1)] = T.REEDS;
    }
  }
}

// Pick from a [{ tile, weight }] list.
function pickWeighted(list, rand) {
  let total = 0;
  for (const e of list) total += e.weight;
  let r = rand() * total;
  for (const e of list) { r -= e.weight; if (r <= 0) return e.tile; }
  return list[list.length - 1].tile;
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

// ---------------------------------------------------------------------------
// Pre-Hardmode ores and sky islands
// ---------------------------------------------------------------------------

// Storm Ore needs a visible sky-island home. These are intentionally small,
// sparse floating shelves made from existing building blocks, so they add a
// discovery landmark without introducing another block family or touching the
// grounded biome layout.
function placeSkyIslands(tiles, w, h, surface, seed, spawnTx) {
  const idx = (x, y) => y * w + x;
  const rand = mulberry32((seed ^ 0x51a15a7e) >>> 0);
  const mask = new Uint8Array(w * h);
  let made = 0;

  for (let attempt = 0; attempt < 18 && made < 6; attempt++) {
    const cx = 32 + Math.floor(rand() * Math.max(1, w - 64));
    if (Math.abs(cx - spawnTx) < 36) continue;
    const cy = 24 + Math.floor(rand() * 22);
    const rx = 6 + Math.floor(rand() * 7);
    const ry = 2 + Math.floor(rand() * 3);
    let cells = 0;

    for (let y = cy - ry; y <= cy + ry; y++) {
      for (let x = cx - rx; x <= cx + rx; x++) {
        if (x < 2 || x >= w - 2 || y < 8 || y >= h - BEDROCK) continue;
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        if (dx * dx + dy * dy > 1.08) continue;
        // Keep the structure above the natural surface so it reads as a
        // floating island rather than a hill accidentally lifted into the sky.
        if (y >= surface[x] - 6) continue;
        const i = idx(x, y);
        if (tiles[i] !== T.AIR) continue;
        tiles[i] = (y <= cy - Math.max(1, ry - 1) && rand() < 0.28) ? T.GRASS : T.STONE;
        mask[i] = 1;
        cells++;
      }
    }
    if (cells >= 12) made++;
  }
  return mask;
}

const ORE_HOSTS = {
  shallow: new Set([T.STONE, T.SANDSTONE]),
  surface: new Set([T.STONE, T.SANDSTONE, T.DIRT]),
  rock: new Set([T.STONE, T.DEEPSTONE]),
  deep: new Set([T.STONE, T.DEEPSTONE, T.BLIGHTSTONE]),
  jungle: new Set([T.STONE, T.DIRT]),
  shadow: new Set([T.STONE, T.DEEPSTONE, T.BLIGHTSTONE]),
};

// Each spec is a placement rule rather than just a random colour. The result
// is that the ore table remains readable in-world: depth and biome are part of
// the progression, not merely tooltip text.
const ORE_SPECS = [
  { key: 'stoneiron', tile: T.STONEIRON, hosts: ORE_HOSTS.shallow, veins: 34, size: [2, 5], allow: (x, y, s, b) => y >= s[x] + 8 && y < Math.min(UNDERGROUND_Y + 8, s[x] + 40) },
  { key: 'amber', tile: T.AMBER, hosts: ORE_HOSTS.surface, veins: 30, size: [2, 5], allow: (x, y, s, b) => (b === 'forest' || b === 'dunes') && y >= s[x] + 10 && y < Math.min(UNDERGROUND_Y + 24, s[x] + 52) },
  { key: 'tide', tile: T.TIDE, hosts: ORE_HOSTS.rock, veins: 18, size: [2, 4], allow: (x, y, s, b, liquid, w, h) => y >= UNDERGROUND_Y - 8 && y < CAVERN_Y + 18 && nearWater(liquid, w, h, x, y, 2) },
  { key: 'ember', tile: T.EMBER, hosts: ORE_HOSTS.deep, veins: 28, size: [2, 5], allow: (x, y) => y >= CAVERN_Y + 4 },
  { key: 'verdant', tile: T.VERDANT, hosts: ORE_HOSTS.jungle, veins: 26, size: [2, 5], allow: (x, y, s, b) => b === 'jungle' && y >= s[x] + 12 && y < CAVERN_Y + 8 },
  { key: 'storm', tile: T.STORM, hosts: ORE_HOSTS.shallow, veins: 12, size: [2, 4], allow: (x, y, s, b, liquid, w, h, sky) => !!sky[y * w + x] },
  { key: 'shadowglass', tile: T.SHADOWGLASS, hosts: ORE_HOSTS.shadow, veins: 24, size: [2, 5], allow: (x, y, s, b) => b === 'corrupt' && y >= UNDERGROUND_Y + 8 },
  { key: 'starsteel', tile: T.STARSTEEL, hosts: ORE_HOSTS.deep, veins: 16, size: [1, 3], allow: (x, y, s, b, liquid, w, h) => y >= h - BEDROCK - 34 },
];

function nearWater(liquid, w, h, x, y, radius) {
  if (!liquid) return false;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < w && ny >= 0 && ny < h && liquid[ny * w + nx] > 0) return true;
    }
  }
  return false;
}

function seedOres(tiles, liquid, w, h, surface, biome, seed, skyIslands) {
  const idx = (x, y) => y * w + x;
  const rand = mulberry32((seed ^ 0x0fe5eed) >>> 0);

  for (const spec of ORE_SPECS) {
    const candidates = [];
    for (let y = 1; y < h - BEDROCK; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = idx(x, y);
        if (!spec.hosts.has(tiles[i])) continue;
        const biomeKey = BIOME_ORDER[biome.map[x]];
        if (spec.allow(x, y, surface, biomeKey, liquid, w, h, skyIslands)) candidates.push(i);
      }
    }

    let made = 0;
    const maxAttempts = Math.max(spec.veins * 8, Math.min(candidates.length * 2, 2400));
    for (let attempt = 0; attempt < maxAttempts && made < spec.veins && candidates.length; attempt++) {
      const seedIndex = candidates[(rand() * candidates.length) | 0];
      const sx = seedIndex % w, sy = (seedIndex / w) | 0;
      if (!spec.hosts.has(tiles[seedIndex])) continue;
      const count = growOreVein(tiles, w, h, sx, sy, spec, surface, biome, liquid, skyIslands, rand);
      if (count > 0) made++;
    }
  }
}

function growOreVein(tiles, w, h, sx, sy, spec, surface, biome, liquid, skyIslands, rand) {
  const idx = (x, y) => y * w + x;
  const length = spec.size[0] + Math.floor(rand() * (spec.size[1] - spec.size[0] + 1));
  let x = sx, y = sy, placed = 0;
  for (let n = 0; n < length; n++) {
    if (x < 1 || x >= w - 1 || y < 1 || y >= h - BEDROCK) break;
    const i = idx(x, y);
    const biomeKey = BIOME_ORDER[biome.map[x]];
    if (spec.hosts.has(tiles[i]) && spec.allow(x, y, surface, biomeKey, liquid, w, h, skyIslands)) {
      tiles[i] = spec.tile;
      placed++;
    }
    x += rand() < 0.5 ? -1 : 1;
    y += rand() < 0.56 ? 0 : (rand() < 0.5 ? -1 : 1);
  }
  return placed;
}

// A restrained underground-content pass: enough chests to reward cave routes
// and enough traps to make players read a chamber, without turning every tunnel
// into a dungeon. These are tiles, so opened/broken state already persists in
// the existing world diff and multiplayer tile-sync paths.
function placeUndergroundFeatures(tiles, liquid, w, h, surface, rand, spawnTx) {
  const idx = (x, y) => y * w + x;
  const bottom = h - BEDROCK - 2;
  const dryAir = (x, y) => x > 1 && x < w - 2 && y > 1 && y < bottom &&
    tiles[idx(x, y)] === T.AIR && !(liquid && liquid[idx(x, y)]);
  const clearChestSpot = (x, y) => dryAir(x, y) && dryAir(x - 1, y) && dryAir(x + 1, y) &&
    dryAir(x, y - 1) && isSolid(tiles[idx(x, y + 1)]);
  const farEnough = (x, y, placed, minTiles) => placed.every(p => {
    const dx = p.x - x, dy = p.y - y;
    return dx * dx + dy * dy >= minTiles * minTiles;
  });

  const chestCandidates = [];
  for (let x = 4; x < w - 4; x++) {
    const top = Math.max(surface[x] + 9, UNDERGROUND_Y - 22);
    for (let y = top; y < bottom; y++) {
      if (Math.abs(x - spawnTx) < 34 || !clearChestSpot(x, y)) continue;
      chestCandidates.push({ x, y });
    }
  }
  const placed = [];
  for (let attempt = 0; attempt < 180 && placed.length < 12 && chestCandidates.length; attempt++) {
    const p = chestCandidates[(rand() * chestCandidates.length) | 0];
    if (!farEnough(p.x, p.y, placed, 24)) continue;
    tiles[idx(p.x, p.y)] = T.LOOT_CHEST;
    placed.push(p);
  }

  const trapCandidates = [];
  for (let x = 5; x < w - 5; x++) {
    const top = Math.max(surface[x] + 11, UNDERGROUND_Y - 18);
    for (let y = top; y < bottom; y++) {
      if (!dryAir(x, y)) continue;
      if (isSolid(tiles[idx(x - 1, y)]) && dryAir(x + 1, y) && dryAir(x + 2, y)) {
        trapCandidates.push({ x, y, id: T.POISON_DART_TRAP_RIGHT });
      } else if (isSolid(tiles[idx(x + 1, y)]) && dryAir(x - 1, y) && dryAir(x - 2, y)) {
        trapCandidates.push({ x, y, id: T.POISON_DART_TRAP_LEFT });
      }
    }
  }
  const trapPlaced = [];
  for (let attempt = 0; attempt < 260 && trapPlaced.length < 16 && trapCandidates.length; attempt++) {
    const p = trapCandidates[(rand() * trapCandidates.length) | 0];
    if (!farEnough(p.x, p.y, placed.concat(trapPlaced), 9)) continue;
    tiles[idx(p.x, p.y)] = p.id;
    trapPlaced.push(p);
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

  // Corruption trees grow wrong. The trunk lurches from side to side as it
  // climbs and throws out short bare branches, so a corrupted grove reads as
  // diseased rather than as the same tree in a different palette.
  if (def.canopy === 'twisted') {
    let tx = x;
    let leanDir = rand() < 0.5 ? -1 : 1;
    for (let i = 0; i < height; i++) {
      const y = baseY - i;
      if (y <= 1) break;
      // Lurch every few segments, and never twice the same way in a row, so the
      // trunk zig-zags instead of simply leaning over.
      if (i > 0 && i % 2 === 0 && rand() < 0.62) {
        const nx = tx + leanDir;
        if (nx > 1 && nx < w - 2 && tiles[idx(nx, y)] === T.AIR) {
          // Keep the column connected: fill the corner it just stepped past.
          if (tiles[idx(tx, y)] === T.AIR) tiles[idx(tx, y)] = trunk;
          tx = nx;
        }
        leanDir = -leanDir;
      }
      if (tiles[idx(tx, y)] !== T.AIR) break;
      tiles[idx(tx, y)] = trunk;
      // Bare branch stubs, one tile out, on alternating sides.
      if (i >= 2 && rand() < 0.42) {
        const bx = tx + (rand() < 0.5 ? -1 : 1);
        if (bx > 0 && bx < w - 1 && tiles[idx(bx, y)] === T.AIR) tiles[idx(bx, y)] = trunk;
      }
    }
    return; // no canopy: these are dead
  }

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

// Fill in any underground air pocket too small to be a cave. Anything this size
// sealed inside rock is something the player can never reach and never should
// have been carved; leaving them is what made the underground read as noise.
// The fill material is taken from the pocket's own neighbourhood so a sealed
// bubble in deepstone becomes deepstone, not a block of dirt.
function sealTinyPockets(tiles, w, h, surface) {
  const idx = (x, y) => y * w + x;
  const bottom = h - BEDROCK;
  const seen = new Uint8Array(w * h);
  const stack = [];

  for (let y = 0; y < bottom; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = idx(x, y);
      if (seen[i] || isSolid(tiles[i])) continue;
      const cells = [];
      let touchesSky = false;
      stack.push(i); seen[i] = 1;
      while (stack.length) {
        const ci = stack.pop();
        const cx = ci % w, cy = (ci / w) | 0;
        cells.push(ci);
        if (cy < surface[cx]) touchesSky = true;
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 1 || nx >= w - 1 || ny < 0 || ny >= bottom) continue;
          const ni = idx(nx, ny);
          if (seen[ni] || isSolid(tiles[ni])) continue;
          seen[ni] = 1; stack.push(ni);
        }
      }
      if (touchesSky || cells.length >= MIN_CAVE_ROOM) continue;
      for (const ci of cells) {
        if (tiles[ci] === T.AIR) tiles[ci] = neighbourFill(tiles, w, h, ci % w, (ci / w) | 0);
      }
    }
  }
}

// The most common solid tile around a position, so a filled pocket matches the
// rock it sits in.
function neighbourFill(tiles, w, h, x, y) {
  const counts = new Map();
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const id = tiles[ny * w + nx];
      if (id === T.AIR || !isSolid(id)) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  let best = T.STONE, bn = 0;
  for (const [id, n] of counts) if (n > bn) { bn = n; best = id; }
  return best;
}

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------
//
// Pools are found rather than placed: flood-fill each enclosed air basin from
// its floor upward, and stop at the level where the basin would spill. That is
// what puts water in the bottom of a cavern the way the reference screenshots
// show, instead of stamping rectangles of blue into the rock and hoping they
// land somewhere plausible.
//
// The result is handed to LiquidGrid as its starting state, so the flow
// simulation begins already settled and costs nothing until the player digs
// into it.

// Fraction of eligible basins that actually hold water. Not every hollow is
// flooded — a cave system where every low point is a lake stops feeling like a
// cave system.
const BASIN_WET_CHANCE = 0.42;
// Basins larger than this are drained rather than flooded: an ocean filling
// half the cavern layer is not a pool, it is a bug.
const MAX_BASIN = 900;

function fillWater(tiles, w, h, surface, biome, seed, spawnTx) {
  const levels = new Uint8Array(w * h);
  const rand = mulberry32((seed ^ 0x5ea1a4e) >>> 0);
  const idx = (x, y) => y * w + x;
  const bottom = h - BEDROCK - 1;
  const visited = new Uint8Array(w * h);

  // Scan upward from the bottom so a basin is always discovered from its floor.
  for (let y = bottom; y >= UNDERGROUND_Y - 24; y--) {
    for (let x = 2; x < w - 2; x++) {
      const i = idx(x, y);
      if (visited[i]) continue;
      if (tiles[i] !== T.AIR) continue;
      // A basin floor: air with something solid directly beneath it.
      if (!isSolid(tiles[idx(x, y + 1)])) continue;
      // Never flood the column the player spawns on.
      if (Math.abs(x - spawnTx) <= SPAWN_PLAIN + 2) continue;
      if (rand() > BASIN_WET_CHANCE) { visited[i] = 1; continue; }
      floodBasin(tiles, levels, visited, w, h, x, y, surface, bottom, rand);
    }
  }

  // Surface ponds: a dip in the terrain that holds water, so the overworld has
  // somewhere to fish before the player ever finds a cave.
  surfacePonds(tiles, levels, w, h, surface, biome, rand, spawnTx);
  return levels;
}

// Flood one basin from a floor tile. The fill rises a row at a time and stops
// at the first row that would spill out of the basin, so the resulting surface
// is genuinely level.
function floodBasin(tiles, levels, visited, w, h, sx, sy, surface, bottom, rand) {
  const idx = (x, y) => y * w + x;
  // How deep this basin is allowed to get. Shallow puddles read better than
  // uniform full-depth lakes.
  const maxRise = 2 + (rand() * 5) | 0;
  const filled = [];

  for (let rise = 0; rise < maxRise; rise++) {
    const y = sy - rise;
    if (y <= 2) break;
    // Collect this row's connected span of air at height y, walking out from
    // the seed column.
    const row = [];
    let spills = false;

    const walk = (dir) => {
      for (let x = sx; x >= 1 && x < w - 1; x += dir) {
        const i = idx(x, y);
        if (tiles[i] !== T.AIR) break;           // wall of the basin: contained
        if (y >= surface[x]) {
          // Open to the sky at this column — the basin spills out here.
          if (y < surface[x] + 1) { spills = true; break; }
        }
        // Nothing under this tile and no water yet: the row drains away.
        if (!isSolid(tiles[idx(x, y + 1)]) && !levels[idx(x, y + 1)]) { spills = true; break; }
        row.push(i);
        if (Math.abs(x - sx) > 60) { spills = true; break; } // absurdly wide: not a basin
        if (dir === 0) break;
      }
    };
    walk(-1); walk(1);

    if (spills || !row.length) break;
    if (filled.length + row.length > MAX_BASIN) break;
    for (const i of row) { levels[i] = LIQUID_MAX; visited[i] = 1; filled.push(i); }
  }

  // A one-tile puddle is noise; drain it again.
  if (filled.length < 3) for (const i of filled) levels[i] = 0;
}

// Surface water: find local minima in the height profile that are enclosed on
// both sides, and fill them to just below the lower rim.
function surfacePonds(tiles, levels, w, h, surface, biome, rand, spawnTx) {
  const idx = (x, y) => y * w + x;
  for (let x = 12; x < w - 12; x++) {
    if (Math.abs(x - spawnTx) <= SPAWN_PLAIN + 6) continue;
    if (rand() > 0.02) continue;
    // Walk out to the rims of the depression this column sits in.
    const base = surface[x];
    let left = x, right = x;
    while (left > 2 && surface[left - 1] >= surface[left] - 0 && base - surface[left - 1] <= 0) left--;
    while (right < w - 3 && base - surface[right + 1] <= 0) right++;
    const rim = Math.min(surface[left - 1] ?? base, surface[right + 1] ?? base);
    const depth = base - rim;
    if (depth < 2 || depth > 7) continue;         // too flat, or a canyon
    if (right - left < 4 || right - left > 42) continue;

    // Fill from the floor up to one tile below the lower rim, so it never
    // overflows the lip.
    const top = rim + 1;
    for (let px = left; px <= right; px++) {
      for (let py = surface[px] - 1; py >= top; py--) {
        if (tiles[idx(px, py)] !== T.AIR) break;
        levels[idx(px, py)] = LIQUID_MAX;
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
    // canopy can never box the player in; further out, trees and undergrowth
    // are left standing. Clearing the undergrowth too used to leave a 26-tile
    // strip of conspicuously bare ground around every spawn.
    for (let dy = 1; dy <= 2; dy++) {
      const id = tiles[idx(x, s - dy)];
      if (id === T.AIR) continue;
      const keepable = id === def.treeTile || id === def.leafTile || isFlora(id);
      if (!keepable || Math.abs(dx) <= 3) tiles[idx(x, s - dy)] = T.AIR;
    }
  }
}
