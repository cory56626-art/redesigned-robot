// Summoner Realms — procedural world generation.
// Three biomes: Forest (surface, left), Corrupted Lands (surface, right),
// Underground (depth). Deterministic from a numeric seed.
import { WORLD_W, WORLD_H, SURFACE_Y, UNDERGROUND_Y, CAVERN_Y, CORRUPT_X, TILE } from '../config.js';
import { T } from './tiles.js';
import { mulberry32, makeValueNoise } from '../utils.js';

export function generateWorld(seed) {
  const w = WORLD_W, h = WORLD_H;
  const tiles = new Uint16Array(w * h);
  const rand = mulberry32(seed);
  const surfNoise = makeValueNoise(seed ^ 0x1234);
  const surfNoise2 = makeValueNoise(seed ^ 0x9abc);
  const caveNoise = makeValueNoise(seed ^ 0x55aa);
  const caveNoiseY = makeValueNoise(seed ^ 0xaa55);

  const idx = (x, y) => y * w + x;

  // Column surface heights.
  const surface = new Int32Array(w);
  for (let x = 0; x < w; x++) {
    const corrupt = x >= CORRUPT_X;
    let hgt = SURFACE_Y
      + (surfNoise(x * 0.05) - 0.5) * 16
      + (surfNoise2(x * 0.14) - 0.5) * 6;
    if (corrupt) hgt += (surfNoise2(x * 0.3) - 0.5) * 10; // jagged corruption
    surface[x] = Math.max(30, Math.min(UNDERGROUND_Y - 6, Math.round(hgt)));
  }

  // Fill terrain.
  for (let x = 0; x < w; x++) {
    const corrupt = x >= CORRUPT_X;
    const s = surface[x];
    for (let y = 0; y < h; y++) {
      let id = T.AIR;
      if (y === s) id = corrupt ? T.BLIGHTGRASS : T.GRASS;
      else if (y > s && y < s + 5) id = T.DIRT;
      else if (y >= s + 5) id = corrupt ? T.BLIGHTSTONE : T.STONE;

      // Cave carving underground.
      if (y > s + 3) {
        const c = caveNoise(x * 0.08 + y * 0.02) * 0.6 + caveNoiseY(x * 0.03 - y * 0.09) * 0.4;
        const depthBias = Math.min(1, (y - s) / 60);
        if (c > 0.62 - depthBias * 0.14) id = T.AIR;
      }
      tiles[idx(x, y)] = id;
    }
  }

  // Surface dirt->grass fix and clay/sand pockets near surface.
  for (let x = 0; x < w; x++) {
    const s = surface[x];
    if (rand() < 0.04) {
      // sand pocket
      const r = 2 + Math.floor(rand() * 3);
      blob(tiles, w, h, x, s + 2 + Math.floor(rand() * 4), r, x >= CORRUPT_X ? T.BLIGHTSTONE : T.SAND, rand);
    }
    if (rand() < 0.05) blob(tiles, w, h, x, s + 6 + Math.floor(rand() * 8), 2 + Math.floor(rand() * 2), T.CLAY, rand);
  }

  // Ore veins. Rarity + depth gate the ore tier.
  seedOre(tiles, w, h, surface, rand, T.CUPRITE, 0.010, s => s + 3, CAVERN_Y, false);
  seedOre(tiles, w, h, surface, rand, T.IRONVEIN, 0.008, s => s + 8, WORLD_H, false);
  seedOre(tiles, w, h, surface, rand, T.GLIMMER, 0.005, () => UNDERGROUND_Y, WORLD_H, false);
  seedOre(tiles, w, h, surface, rand, T.AETHERITE, 0.004, () => CAVERN_Y - 10, WORLD_H, false);
  // Blightore only in the corrupted half, deep.
  seedOre(tiles, w, h, surface, rand, T.BLIGHTORE, 0.010, () => UNDERGROUND_Y, WORLD_H, true);

  // Thornvines in corruption caves.
  for (let x = CORRUPT_X; x < w; x++) {
    for (let y = surface[x] + 1; y < WORLD_H - 1; y++) {
      if (tiles[idx(x, y)] === T.AIR && tiles[idx(x, y - 1)] !== T.AIR && rand() < 0.05) {
        tiles[idx(x, y)] = T.THORNVINE;
      }
    }
  }

  // Trees on the forest surface.
  for (let x = 4; x < CORRUPT_X - 2; x++) {
    if (rand() < 0.10) {
      const s = surface[x];
      if (tiles[idx(x, s)] === T.GRASS) { placeTree(tiles, w, h, x, s - 1, rand); x += 2; }
    }
  }
  // Sparse dead trees / thornclusters on corruption surface.
  for (let x = CORRUPT_X + 2; x < w - 2; x++) {
    if (rand() < 0.05) {
      const s = surface[x];
      placeDeadTree(tiles, w, h, x, s - 1, rand); x += 3;
    }
  }

  // Spawn point: forest, on the surface.
  const spawnTx = Math.floor(CORRUPT_X * 0.4);
  const spawnTy = surface[spawnTx] - 3;

  return { tiles, width: w, height: h, surface, spawnX: spawnTx * TILE, spawnY: spawnTy * TILE };
}

function seedOre(tiles, w, h, surface, rand, oreId, density, minYFn, maxY, corruptOnly) {
  const idx = (x, y) => y * w + x;
  for (let x = 0; x < w; x++) {
    if (corruptOnly && x < CORRUPT_X) continue;
    const minY = minYFn(surface[x]);
    for (let y = minY; y < Math.min(maxY, h - 1); y++) {
      if (rand() < density) {
        const size = 2 + Math.floor(rand() * 4);
        veinBlob(tiles, w, h, x, y, size, oreId, rand);
      }
    }
  }
}

function veinBlob(tiles, w, h, cx, cy, n, id, rand) {
  const idx = (x, y) => y * w + x;
  let x = cx, y = cy;
  for (let i = 0; i < n; i++) {
    if (x > 0 && x < w && y > 0 && y < h) {
      const t = tiles[idx(x, y)];
      if (t === T.STONE || t === T.BLIGHTSTONE || t === T.DIRT) tiles[idx(x, y)] = id;
    }
    x += Math.floor(rand() * 3) - 1;
    y += Math.floor(rand() * 3) - 1;
  }
}

function blob(tiles, w, h, cx, cy, r, id, rand) {
  const idx = (x, y) => y * w + x;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      if (dx * dx + dy * dy > r * r) continue;
      const t = tiles[idx(x, y)];
      if (t === T.STONE || t === T.DIRT || t === T.BLIGHTSTONE) tiles[idx(x, y)] = id;
    }
  }
}

function placeTree(tiles, w, h, x, baseY, rand) {
  const idx = (x, y) => y * w + x;
  const height = 4 + Math.floor(rand() * 4);
  for (let i = 0; i < height; i++) {
    const y = baseY - i;
    if (y > 0 && tiles[idx(x, y)] === T.AIR) tiles[idx(x, y)] = T.WOOD;
  }
  const topY = baseY - height;
  for (let dy = -2; dy <= 1; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const lx = x + dx, ly = topY + dy;
      if (lx < 0 || lx >= w || ly < 0) continue;
      if (Math.abs(dx) + Math.abs(dy) <= 3 && tiles[idx(lx, ly)] === T.AIR) tiles[idx(lx, ly)] = T.LEAVES;
    }
  }
}

function placeDeadTree(tiles, w, h, x, baseY, rand) {
  const idx = (x, y) => y * w + x;
  const height = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < height; i++) {
    const y = baseY - i;
    if (y > 0 && tiles[idx(x, y)] === T.AIR) tiles[idx(x, y)] = T.WOOD;
  }
}
