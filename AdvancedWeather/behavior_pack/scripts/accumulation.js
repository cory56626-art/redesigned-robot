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

// Run one accumulation pass around a single player, scattered over a big disc.
export function accumulate(player, level) {
  const attempts = MAX_BLOCKS_PER_PASS[level] || 0;
  if (attempts <= 0) return;
  // Every storm/level scatters snow over the same maxed-out radius.
  const radius = MAX_ACCUMULATION_RADIUS;
  const tune = ACCUMULATION_TUNING[level] || {};
  const maxHeight = tune.maxHeight || 2;
  const caveDepth = tune.caveDepth || 0;
  const caveChance = tune.caveChance || 0;

  const dim = player.dimension;
  const loc = player.location;
  const px = Math.floor(loc.x);
  const pz = Math.floor(loc.z);

  for (let i = 0; i < attempts; i++) {
    // Uniformly sample a column inside the disc of `radius` (sqrt for even
    // area coverage instead of clumping near the centre).
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.sqrt(Math.random()) * radius;
    const x = px + Math.round(Math.cos(ang) * dist);
    const z = pz + Math.round(Math.sin(ang) * dist);

    const surface = topmost(dim, x, z);
    if (!surface) continue;

    pileOnTop(dim, x, z, surface, maxHeight);

    if (caveDepth > 0 && Math.random() < caveChance) {
      fillCaves(dim, x, z, surface.y - 1, caveDepth, 4);
    }
  }
}
