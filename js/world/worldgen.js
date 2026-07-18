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

  // Fill solid terrain (no caves yet — those are tunnelled next).
  for (let x = 0; x < w; x++) {
    const corrupt = x >= CORRUPT_X;
    const s = surface[x];
    for (let y = 0; y < h; y++) {
      let id = T.AIR;
      if (y === s) id = corrupt ? T.BLIGHTGRASS : T.GRASS;
      else if (y > s && y < s + 5) id = T.DIRT;
      else if (y >= s + 5) id = corrupt ? T.BLIGHTSTONE : T.STONE;
      tiles[idx(x, y)] = id;
    }
  }

  // Spawn column (forest surface) — reserved so nothing carves it away.
  const spawnTx = Math.floor(CORRUPT_X * 0.4);

  // Carve connected cave systems with readable surface entrances, deterministic
  // from the seed (independent PRNG stream so ores/trees stay reproducible).
  carveCaves(tiles, w, h, surface, seed, spawnTx);

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

  // Seal a small solid platform under the spawn so the player never spawns over
  // a cave entrance and falls in.
  const s0 = surface[spawnTx];
  for (let dx = -2; dx <= 2; dx++) {
    const sx = spawnTx + dx;
    if (sx < 0 || sx >= w) continue;
    const cs = surface[sx];
    if (tiles[idx(sx, cs)] === T.AIR) tiles[idx(sx, cs)] = T.GRASS;
    for (let dy = 1; dy <= 4; dy++) if (tiles[idx(sx, cs + dy)] === T.AIR) tiles[idx(sx, cs + dy)] = T.DIRT;
  }

  // Spawn point: forest, on the surface.
  const spawnTy = s0 - 3;

  return { tiles, width: w, height: h, surface, spawnX: spawnTx * TILE, spawnY: spawnTy * TILE };
}

// ---- Cave systems: drunkard-walk tunnels + chambers + surface entrances ----
function carveCaves(tiles, w, h, surface, seed, spawnTx) {
  const idx = (x, y) => y * w + x;
  const rc = mulberry32((seed ^ 0xca7e5a) >>> 0);
  const bottom = h - 4; // keep a solid deep boundary at the very bottom

  const carve = (cx, cy, r) => {
    const x0 = Math.max(1, cx - r), x1 = Math.min(w - 2, cx + r);
    const y0 = Math.max(2, cy - r), y1 = Math.min(bottom, cy + r);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > r * r + 0.4) continue;
        if (y < surface[x] - 1) continue; // never punch holes into the open sky
        tiles[idx(x, y)] = T.AIR;
      }
    }
  };

  // A single wandering tunnel. `depth` bounds recursive branching.
  const tunnel = (x, y, ang, len, radius, depth) => {
    for (let i = 0; i < len; i++) {
      carve(Math.round(x), Math.round(y), radius);
      ang += (rc() - 0.5) * 0.6;           // meander
      x += Math.cos(ang) * 1.5;
      y += Math.sin(ang) * 1.5;
      if (x < 3) { x = 3; ang = 0; }
      if (x > w - 4) { x = w - 4; ang = Math.PI; }
      if (y < surface[Math.max(0, Math.min(w - 1, Math.round(x)))] + 2) ang = Math.abs(ang || 0.6); // steer back down near the surface
      if (y > bottom) { y = bottom; ang = -Math.abs(ang); }
      if (rc() < 0.035) carve(Math.round(x), Math.round(y), radius + 2); // pocket chamber
      if (depth > 0 && rc() < 0.02 && len - i > 18) {
        tunnel(x, y, ang + (rc() < 0.5 ? -1 : 1) * (0.8 + rc()), (18 + rc() * 34) | 0, Math.max(1, radius - 1), depth - 1);
      }
    }
    return { x, y };
  };

  // Big chamber helper.
  const chamber = (cx, cy, rx, ry) => {
    for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
      if ((x * x) / (rx * rx) + (y * y) / (ry * ry) > 1) continue;
      const nx = cx + x, ny = cy + y;
      if (nx < 2 || nx >= w - 2 || ny < surface[nx] + 2 || ny > bottom) continue;
      tiles[idx(nx, ny)] = T.AIR;
    }
  };

  // 1) Surface entrances — tunnels starting at the surface heading down/aside so
  //    caves connect to the world above with readable openings.
  const entrances = 6 + (rc() * 5 | 0);
  for (let e = 0; e < entrances; e++) {
    const x = 6 + Math.floor(rc() * (w - 12));
    if (Math.abs(x - spawnTx) < 4) continue; // keep the spawn area intact
    tunnel(x, surface[x] + 1, Math.PI / 2 + (rc() - 0.5) * 1.0, (36 + rc() * 60) | 0, 1 + (rc() < 0.4 ? 1 : 0), 2);
  }

  // 2) Underground tunnel networks (deeper, more branching), scaled to width.
  const systems = 5 + Math.floor(w / 42);
  for (let s = 0; s < systems; s++) {
    const x = 5 + Math.floor(rc() * (w - 10));
    const y = UNDERGROUND_Y + Math.floor(rc() * (h - UNDERGROUND_Y - 12));
    tunnel(x, y, rc() * Math.PI * 2, (60 + rc() * 90) | 0, 1 + (rc() < 0.5 ? 1 : 0), 3);
  }

  // 3) A few large chambers in the cavern layer for landmarks/loot rooms.
  const chambers = 3 + Math.floor(w / 120);
  for (let c = 0; c < chambers; c++) {
    const cx = 8 + Math.floor(rc() * (w - 16));
    const cy = CAVERN_Y + Math.floor(rc() * (h - CAVERN_Y - 8));
    chamber(cx, Math.min(cy, bottom - 4), 3 + (rc() * 3 | 0), 2 + (rc() * 2 | 0));
  }
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
