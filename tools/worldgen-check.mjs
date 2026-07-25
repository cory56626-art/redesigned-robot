#!/usr/bin/env node
// Summoner Realms — world generation self-check.
//
// worldgen.js and everything it imports are DOM-free, so the generator can be
// exercised directly in node with no dependencies and no browser. This asserts
// the invariants the rest of the game relies on, across many seeds, because a
// generator that is only *usually* correct produces worlds that are only
// usually playable.
//
//   node tools/worldgen-check.mjs [seedCount]
//
// Exits non-zero on the first failing invariant, printing the seed so the
// failure can be reproduced with /debugcaves in-game.

import { generateWorld } from '../js/world/worldgen.js';
import { T, TILES, isSolid, MAX_TILE_ID } from '../js/world/tiles.js';
import { W, MAX_WALL_ID, hasWall } from '../js/world/walls.js';
import { BIOME_ORDER } from '../js/world/biomes.js';
import { UNDERGROUND_Y, CAVERN_Y, TILE, WORLD_W, WORLD_H } from '../js/config.js';

const SEEDS = Number(process.argv[2] || 60);
const failures = [];

function check(seed, name, ok, detail) {
  if (!ok) failures.push({ seed, name, detail });
  return ok;
}

// Collect per-world statistics as well as pass/fail, so drift in ore density or
// cave openness shows up as a number rather than a silent gameplay change.
const stats = { ore: {}, caveFrac: [], surfaceSpan: [], trees: [], biomeCols: {} };

for (let s = 0; s < SEEDS; s++) {
  const seed = (s * 2654435761 + 12345) >>> 0;
  const g = generateWorld(seed);
  const { tiles, walls, width, height, surface, spawnTx, biomeMap } = g;
  const at = (x, y) => tiles[y * width + x];
  const wallAt = (x, y) => walls[y * width + x];

  // ---- Dimensions match config ----
  check(seed, 'width matches config', width === WORLD_W, `${width} != ${WORLD_W}`);
  check(seed, 'height matches config', height === WORLD_H, `${height} != ${WORLD_H}`);

  // ---- Tile / wall ids are all defined ----
  let badTile = -1, badWall = -1;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] > MAX_TILE_ID || TILES[tiles[i]] === undefined) { badTile = i; break; }
  }
  for (let i = 0; i < walls.length; i++) {
    if (walls[i] > MAX_WALL_ID) { badWall = i; break; }
  }
  check(seed, 'all tile ids defined', badTile < 0, `index ${badTile} = ${tiles[badTile]}`);
  check(seed, 'all wall ids defined', badWall < 0, `index ${badWall} = ${walls[badWall]}`);

  // ---- Surface is walkable: no step larger than one tile ----
  // The player can only auto-climb one tile, so a bigger step is an impassable
  // wall that silently splits the world in half.
  let worstStep = 0, worstX = -1;
  for (let x = 1; x < width; x++) {
    const d = Math.abs(surface[x] - surface[x - 1]);
    if (d > worstStep) { worstStep = d; worstX = x; }
  }
  check(seed, 'surface steps <= 1 tile', worstStep <= 1, `step ${worstStep} at x=${worstX}`);

  // ---- Surface line agrees with the tiles ----
  // Cave entrances legitimately break the surface, so a few open columns are
  // expected — a large fraction means the surface is being eaten by caves.
  let openSurface = 0, sampled = 0;
  for (let x = 0; x < width; x++) {
    sampled++;
    if (at(x, surface[x]) === T.AIR) openSurface++;
  }
  check(seed, 'surface row is mostly ground', openSurface / sampled < 0.04,
    `${((openSurface / sampled) * 100).toFixed(1)}% of columns open at the surface line`);
  check(seed, 'surface is broken somewhere', openSurface > 0, 'no cave entrance breaks the surface');

  // ---- Spawn is safe: solid floor, clear headroom, not over a cave ----
  const sy = surface[spawnTx];
  check(seed, 'spawn stands on solid ground', isSolid(at(spawnTx, sy)), `tile ${at(spawnTx, sy)} at ${spawnTx},${sy}`);
  check(seed, 'spawn has headroom', at(spawnTx, sy - 1) === T.AIR && at(spawnTx, sy - 2) === T.AIR, 'blocked above spawn');
  let voidUnderSpawn = 0;
  for (let dx = -13; dx <= 13; dx++) {
    for (let dy = 1; dy <= 8; dy++) {
      if (at(spawnTx + dx, sy + dy) === T.AIR) voidUnderSpawn++;
    }
  }
  check(seed, 'spawn plain is not undermined', voidUnderSpawn === 0, `${voidUnderSpawn} air tiles under the spawn plain`);
  let plainFlat = true;
  for (let dx = -13; dx <= 13; dx++) if (surface[spawnTx + dx] !== sy) plainFlat = false;
  check(seed, 'spawn plain is flat', plainFlat, 'spawn plain has height variation');
  check(seed, 'spawn is in the forest', BIOME_ORDER[biomeMap[spawnTx]] === 'forest',
    `spawn biome is ${BIOME_ORDER[biomeMap[spawnTx]]}`);

  // ---- Every surface biome is present and contiguous ----
  const runs = {};
  let cur = biomeMap[0], start = 0;
  for (let x = 1; x <= width; x++) {
    if (x === width || biomeMap[x] !== cur) {
      const key = BIOME_ORDER[cur];
      runs[key] = (runs[key] || 0) + 1;
      stats.biomeCols[key] = (stats.biomeCols[key] || 0) + (x - start);
      cur = biomeMap[x]; start = x;
    }
  }
  for (const key of ['forest', 'frostpine', 'corrupt', 'dunes']) {
    check(seed, `biome ${key} exists`, runs[key] > 0, 'missing from the world');
  }
  // Dunes appear twice (one shore each end); everything else should be a single
  // band, otherwise the layout has fragmented.
  check(seed, 'frostpine is one band', runs.frostpine === 1, `${runs.frostpine} runs`);
  check(seed, 'corruption is one band', runs.corrupt === 1, `${runs.corrupt} runs`);

  // ---- Caves exist, and some of them reach the surface ----
  let caveTiles = 0, undergroundTiles = 0;
  for (let x = 1; x < width - 1; x++) {
    for (let y = surface[x] + 6; y < height - 5; y++) {
      undergroundTiles++;
      if (at(x, y) === T.AIR) caveTiles++;
    }
  }
  const caveFrac = caveTiles / Math.max(1, undergroundTiles);
  stats.caveFrac.push(caveFrac);
  check(seed, 'caves are carved', caveFrac > 0.06, `only ${(caveFrac * 100).toFixed(1)}% open`);
  check(seed, 'world is not hollow', caveFrac < 0.55, `${(caveFrac * 100).toFixed(1)}% open`);

  // A surface entrance is a column where air runs from the surface line down
  // past the underground boundary without interruption long enough to matter.
  let entrances = 0;
  for (let x = 2; x < width - 2; x++) {
    let y = surface[x];
    if (at(x, y) !== T.AIR) continue;
    let depth = 0;
    while (y < height - 5 && at(x, y) === T.AIR) { y++; depth++; }
    if (depth >= 8) entrances++;
  }
  check(seed, 'caves break the surface', entrances > 0, 'no surface entrance found');

  // ---- Walls back the terrain, but never the open sky ----
  let skyWalls = 0, deepUnwalled = 0, deepChecked = 0;
  for (let x = 0; x < width; x += 3) {
    for (let y = 0; y < surface[x] - 1; y++) if (hasWall(wallAt(x, y))) skyWalls++;
    for (let y = UNDERGROUND_Y; y < height - 6; y += 3) {
      deepChecked++;
      if (!hasWall(wallAt(x, y))) deepUnwalled++;
    }
  }
  check(seed, 'no walls in open sky', skyWalls === 0, `${skyWalls} walled tiles above the surface`);
  check(seed, 'underground is walled', deepUnwalled / Math.max(1, deepChecked) < 0.02,
    `${deepUnwalled}/${deepChecked} deep tiles had no wall`);

  // ---- Shallow digging stays daylit (no wall in the top few tiles) ----
  let shallowWalls = 0;
  for (let x = 0; x < width; x += 5) {
    for (let y = surface[x]; y <= surface[x] + 2; y++) if (hasWall(wallAt(x, y))) shallowWalls++;
  }
  check(seed, 'surface layer has no wall', shallowWalls === 0, `${shallowWalls} walled tiles in the top 3 rows`);

  // ---- Ore is present in its band and absent outside it ----
  const oreCount = { cuprite: 0, ironvein: 0, glimmer: 0, aetherite: 0, blightore: 0 };
  let glimmerTooHigh = 0, blightOutsideCorruption = 0;
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const id = at(x, y);
      if (id === T.CUPRITE) oreCount.cuprite++;
      else if (id === T.IRONVEIN) oreCount.ironvein++;
      else if (id === T.GLIMMER) { oreCount.glimmer++; if (y < UNDERGROUND_Y) glimmerTooHigh++; }
      else if (id === T.AETHERITE) oreCount.aetherite++;
      else if (id === T.BLIGHTORE) {
        oreCount.blightore++;
        if (y < UNDERGROUND_Y) blightOutsideCorruption++;
      }
    }
  }
  for (const k in oreCount) stats.ore[k] = (stats.ore[k] || []).concat(oreCount[k]);
  check(seed, 'cuprite generates', oreCount.cuprite > 200, `${oreCount.cuprite} tiles`);
  check(seed, 'ironvein generates', oreCount.ironvein > 150, `${oreCount.ironvein} tiles`);
  check(seed, 'glimmer generates', oreCount.glimmer > 40, `${oreCount.glimmer} tiles`);
  check(seed, 'aetherite generates', oreCount.aetherite > 30, `${oreCount.aetherite} tiles`);
  check(seed, 'blightore generates', oreCount.blightore > 10, `${oreCount.blightore} tiles`);
  check(seed, 'glimmer stays deep', glimmerTooHigh === 0, `${glimmerTooHigh} above the underground line`);
  check(seed, 'blightore stays deep', blightOutsideCorruption === 0, `${blightOutsideCorruption} above the underground line`);

  // ---- Trees are rooted and their leaves are supported ----
  let trees = 0, floatingTrunks = 0, floatingLeaves = 0;
  for (let x = 1; x < width - 1; x++) {
    for (let y = 1; y < surface[x] + 2; y++) {
      const id = at(x, y);
      const def = TILES[id];
      if (def && def.tree) {
        if (at(x, y + 1) === T.AIR) floatingTrunks++;
        if (!TILES[at(x, y + 1)] || !TILES[at(x, y + 1)].tree) trees++;
      } else if (def && def.leaf) {
        // A leaf must have at least one non-air neighbour, or it is orphaned.
        let support = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (at(x + dx, y + dy) !== T.AIR) support++;
        }
        if (support === 0) floatingLeaves++;
      }
    }
  }
  stats.trees.push(trees);
  check(seed, 'no floating trunks', floatingTrunks === 0, `${floatingTrunks} trunk tiles hanging in air`);
  check(seed, 'no orphaned leaves', floatingLeaves === 0, `${floatingLeaves} isolated leaf tiles`);
  check(seed, 'forest has trees', trees > 20, `only ${trees} trees`);

  stats.surfaceSpan.push(Math.max(...surface) - Math.min(...surface));
}

// ---- Report ----
const avg = (a) => (a.reduce((x, y) => x + y, 0) / Math.max(1, a.length));
console.log(`worldgen-check: ${SEEDS} seeds, ${WORLD_W}x${WORLD_H} tiles\n`);
console.log('  surface relief   ', `${avg(stats.surfaceSpan).toFixed(1)} tiles (min-to-max height)`);
console.log('  underground open ', `${(avg(stats.caveFrac) * 100).toFixed(1)}%`);
console.log('  trees per world  ', avg(stats.trees).toFixed(0));
console.log('  biome columns    ', Object.entries(stats.biomeCols)
  .map(([k, v]) => `${k} ${(v / SEEDS).toFixed(0)}`).join(', '));
console.log('  ore tiles        ', Object.entries(stats.ore)
  .map(([k, v]) => `${k} ${avg(v).toFixed(0)}`).join(', '));

if (failures.length) {
  console.error(`\n✗ ${failures.length} failed invariant(s):\n`);
  const seen = new Set();
  for (const f of failures) {
    const key = f.name;
    if (seen.has(key)) continue;
    seen.add(key);
    const count = failures.filter(x => x.name === key).length;
    console.error(`  ${f.name} — ${count}/${SEEDS} seeds`);
    console.error(`    e.g. seed ${f.seed}: ${f.detail}`);
  }
  process.exit(1);
}
console.log('\n✓ all invariants hold');
