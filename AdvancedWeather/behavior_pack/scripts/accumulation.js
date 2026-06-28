// accumulation.js — full-area snow burial. When a storm hits, the ENTIRE
// radius around every player is snowed over essentially at once (driven by
// system.runJob, the engine's bulk-edit job system) instead of dribbling out a
// few blocks per tick. Snow piles deep (deeper at higher levels), buries caves,
// and follows players as they move / new chunks load. (Unloaded chunks can't be
// edited by any add-on.)
import { system } from "@minecraft/server";
import { MAX_ACCUMULATION_RADIUS, ACCUMULATION_TUNING } from "./config.js";
import { tryGetBlock } from "./util.js";

const SNOW_LAYER = "minecraft:snow_layer";
const SNOW_BLOCK = "minecraft:snow";

// All column offsets inside the disc, nearest-first (so a storm visibly snows
// out from each player while the job runs). Built once.
const COLUMN_OFFSETS = (() => {
  const r = MAX_ACCUMULATION_RADIUS;
  const r2 = r * r;
  const list = [];
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      const d2 = dx * dx + dz * dz;
      // Skip the 3x3 right under the player so they aren't entombed where they
      // stand (everything around still buries — you dig out).
      if (d2 <= r2 && d2 > 2) list.push({ dx, dz, d2 });
    }
  }
  list.sort((a, b) => a.d2 - b.d2);
  return list;
})();

let activeJobs = [];

function isSupport(block) {
  return block && !block.isAir && !block.isLiquid;
}

function topmost(dimension, x, z) {
  try { return dimension.getTopmostBlock({ x, z }); } catch { return undefined; }
}

// Pile snow `depth` blocks high on the column, measured from the real ground
// (descends through any existing snow first, so re-runs don't grow towers).
function buryColumn(dimension, x, z, depth) {
  const surface = topmost(dimension, x, z);
  if (!surface) return;

  // Find ground level beneath any snow already here.
  let groundY = surface.y;
  for (let y = surface.y; y > surface.y - depth - 2; y--) {
    const b = tryGetBlock(dimension, { x, y, z });
    if (!b) return;
    if (b.typeId === SNOW_BLOCK || b.typeId === SNOW_LAYER) { groundY = y - 1; continue; }
    if (!isSupport(b)) return; // floating in air; nothing to rest on
    groundY = y;
    break;
  }

  for (let h = 1; h <= depth; h++) {
    const b = tryGetBlock(dimension, { x, y: groundY + h, z });
    if (!b) break;
    if (b.isAir || b.typeId === SNOW_LAYER || b.typeId === SNOW_BLOCK) {
      try { b.setType(h === depth ? SNOW_LAYER : SNOW_BLOCK); } catch { /* skip */ }
    } else {
      break; // hit a wall/roof — stop (snow sits on top of structures)
    }
  }
}

// Bury enclosed air pockets (caves/tunnels) just under the surface.
function fillCaves(dimension, x, z, startY, depth) {
  let written = 0;
  for (let y = startY; y > startY - depth && written < 6; y--) {
    const b = tryGetBlock(dimension, { x, y, z });
    if (!b || !b.isAir) continue;
    const neighbours = [
      tryGetBlock(dimension, { x: x + 1, y, z }),
      tryGetBlock(dimension, { x: x - 1, y, z }),
      tryGetBlock(dimension, { x, y, z: z + 1 }),
      tryGetBlock(dimension, { x, y, z: z - 1 }),
      tryGetBlock(dimension, { x, y: y - 1, z }),
    ];
    if (neighbours.some(isSupport)) {
      try { b.setType(SNOW_BLOCK); written++; } catch { /* skip */ }
    }
  }
}

// Generator that snows the whole disc around (cx,cz). runJob advances it as fast
// as the engine's per-tick budget allows, so the area fills near-instantly
// without freezing the game.
function* coverageJob(dimension, cx, cz, tune) {
  let n = 0;
  for (const off of COLUMN_OFFSETS) {
    const x = cx + off.dx;
    const z = cz + off.dz;
    buryColumn(dimension, x, z, tune.depth);
    if (tune.caveDepth > 0 && Math.random() < tune.caveChance) {
      const surface = topmost(dimension, x, z);
      if (surface) fillCaves(dimension, x, z, surface.y - 1, tune.caveDepth);
    }
    if ((++n & 127) === 0) yield; // let the engine breathe periodically
  }
}

// (Re)start full-area snow coverage around every player for the given level.
// Cancels any in-flight jobs first so they never stack up.
export function refreshCoverage(players, level) {
  const tune = ACCUMULATION_TUNING[level];
  stopCoverage();
  if (!tune || !tune.depth) return; // level 1 = no accumulation
  for (const p of players) {
    const loc = p.location;
    activeJobs.push(system.runJob(
      coverageJob(p.dimension, Math.floor(loc.x), Math.floor(loc.z), tune)));
  }
}

export function stopCoverage() {
  for (const id of activeJobs) {
    try { system.clearJob(id); } catch { /* already done */ }
  }
  activeJobs = [];
}
