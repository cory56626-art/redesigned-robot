// accumulation.js — snow piling up, caves filling, and homes getting buried,
// spread across the ENTIRE loaded area around each player (as far as Minecraft
// itself simulates) rather than a tight box. Each pass scatters a budget of
// snow over a large disc using getTopmostBlock, so coverage builds up over the
// whole storm like real weather. (Unloaded chunks can't be edited by any mod.)
import {
  MAX_BLOCKS_PER_PASS, MAX_ACCUMULATION_RADIUS, ACCUMULATION_TUNING,
} from "./config.js";
import { tryGetBlock } from "./util.js";

const SNOW_LAYER = "minecraft:snow_layer";
const SNOW_BLOCK = "minecraft:snow";

function isSupport(block) {
  // Something snow can rest on: any non-air, non-liquid block.
  return block && !block.isAir && !block.isLiquid;
}

// Highest block at an XZ column (works at any elevation, anywhere loaded).
function topmost(dimension, x, z) {
  try {
    return dimension.getTopmostBlock({ x, z });
  } catch {
    return undefined; // unloaded / out of world
  }
}

// Pile snow one step on top of the given surface block. Returns 0/1 written.
function pileOnTop(dimension, x, z, surface, maxHeight) {
  // A thin layer on the surface compacts into a full block first.
  if (surface.typeId === SNOW_LAYER) {
    try { surface.setType(SNOW_BLOCK); return 1; } catch { return 0; }
  }
  if (!isSupport(surface)) return 0;

  const above = tryGetBlock(dimension, { x, y: surface.y + 1, z });
  if (!above || !above.isAir) return 0;

  // Cap how tall a snow pile can grow so it never builds endless towers.
  if (surface.typeId === SNOW_BLOCK) {
    let h = 0, y = surface.y;
    while (h < maxHeight) {
      const b = tryGetBlock(dimension, { x, y, z });
      if (b && (b.typeId === SNOW_BLOCK || b.typeId === SNOW_LAYER)) { h++; y--; }
      else break;
    }
    if (h >= maxHeight) return 0;
  }

  try { above.setType(SNOW_LAYER); return 1; } catch { return 0; }
}

// Bury enclosed air pockets (caves/tunnels) just under the surface.
function fillCaves(dimension, x, z, startY, depth, budget) {
  let written = 0;
  for (let y = startY; y > startY - depth && written < budget; y--) {
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
  return written;
}

// Every (dx,dz) column offset inside the max disc, sorted nearest-first, built
// once. The accumulation sweep walks this list so snow fills the area right
// around the player first and then expands outward to the full radius — instead
// of scattering randomly (which left the centre bare and only dusted the rim).
const COLUMN_OFFSETS = (() => {
  const r = MAX_ACCUMULATION_RADIUS;
  const r2 = r * r;
  const list = [];
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      const d2 = dx * dx + dz * dz;
      if (d2 <= r2) list.push({ dx, dz, d2 });
    }
  }
  list.sort((a, b) => a.d2 - b.d2); // nearest columns first
  return list;
})();

// Rolling cursor so consecutive passes continue the outward sweep, then wrap
// back to the centre to keep topping the whole area up.
let sweepCursor = 0;

// Restart the sweep at the centre so a fresh storm begins snowing right around
// the players and expands outward. Called when a storm starts/changes.
export function resetSweep() {
  sweepCursor = 0;
}

// Run one accumulation pass for a single player: process the next `attempts`
// columns of the near-to-far sweep, centred on the player's current position.
export function accumulate(player, level) {
  const attempts = MAX_BLOCKS_PER_PASS[level] || 0;
  if (attempts <= 0) return;
  const tune = ACCUMULATION_TUNING[level] || {};
  const maxHeight = tune.maxHeight || 2;
  const caveDepth = tune.caveDepth || 0;
  const caveChance = tune.caveChance || 0;

  const dim = player.dimension;
  const loc = player.location;
  const px = Math.floor(loc.x);
  const pz = Math.floor(loc.z);

  const total = COLUMN_OFFSETS.length;
  for (let i = 0; i < attempts; i++) {
    const off = COLUMN_OFFSETS[(sweepCursor + i) % total];
    const x = px + off.dx;
    const z = pz + off.dz;

    const surface = topmost(dim, x, z);
    if (!surface) continue;

    pileOnTop(dim, x, z, surface, maxHeight);

    if (caveDepth > 0 && Math.random() < caveChance) {
      fillCaves(dim, x, z, surface.y - 1, caveDepth, 4);
    }
  }
  sweepCursor = (sweepCursor + attempts) % total;
}
