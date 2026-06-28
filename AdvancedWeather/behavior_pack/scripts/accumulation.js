// accumulation.js — snow piling up, caves filling, and homes getting buried.
// Only runs for snow/omega storms at levels 3 and 4, with strict per-pass
// block-write budgets so it never lags the server.
import {
  MAX_BLOCKS_PER_PASS, ACCUMULATION_RADIUS,
} from "./config.js";
import { tryGetBlock } from "./util.js";

const SNOW_LAYER = "minecraft:snow_layer";
const SNOW_BLOCK = "minecraft:snow";

// Blocks snow is allowed to replace when piling (air-like / passable).
function isReplaceable(block) {
  if (!block) return false;
  if (block.isAir) return true;
  const id = block.typeId;
  return id === SNOW_LAYER ||
    id === "minecraft:short_grass" || id === "minecraft:tall_grass" ||
    id === "minecraft:fern" || id === "minecraft:large_fern" ||
    id === "minecraft:double_plant";
}

function isSupport(block) {
  // Something snow can rest on: any non-air, non-liquid solid.
  return block && !block.isAir && !block.isLiquid;
}

// Raise the snow in one column by a single step. Returns blocks written (0/1).
// Piling is done purely with setType (thin layer -> full snow block -> new
// layer on top), so it never depends on the exact snow_layer block-state name,
// which differs across Bedrock versions.
function pileColumn(dimension, x, z, topY, bottomY, maxHeight) {
  // Find the surface: topmost solid block with replaceable space above it.
  for (let y = topY; y >= bottomY; y--) {
    const here = tryGetBlock(dimension, { x, y, z });
    if (!isSupport(here)) continue;
    const above = tryGetBlock(dimension, { x, y: y + 1, z });
    if (above === undefined) return 0;

    // Empty space above a surface -> drop a fresh thin layer.
    if (above.isAir) {
      try { above.setType(SNOW_LAYER); return 1; } catch { return 0; }
    }
    // Thin layer already there -> compact it into a solid snow block so the
    // pile can keep growing upward.
    if (above.typeId === SNOW_LAYER) {
      try { above.setType(SNOW_BLOCK); return 1; } catch { return 0; }
    }
    // Full snow block already here -> keep piling upward until maxHeight.
    if (above.typeId === SNOW_BLOCK) {
      let probe = y + 1;
      while (probe < y + 1 + maxHeight) {
        const b = tryGetBlock(dimension, { x, y: probe, z });
        if (b && b.typeId === SNOW_BLOCK) { probe++; continue; }
        if (b && b.isAir) {
          try { b.setType(SNOW_LAYER); return 1; } catch { return 0; }
        }
        break;
      }
      return 0;
    }
    return 0; // non-snow obstruction above the surface: leave it alone
  }
  return 0;
}

// Fill an enclosed air pocket (a cave) near the surface with snow.
// Returns blocks written this call (bounded by `budget`).
function fillCaves(dimension, x, z, startY, depth, budget) {
  let written = 0;
  for (let y = startY; y > startY - depth && written < budget; y--) {
    const b = tryGetBlock(dimension, { x, y, z });
    if (!b || !b.isAir) continue;
    // Only fill air that has at least one solid neighbour (i.e. inside terrain),
    // so we bury caves/tunnels rather than floating in open air.
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

// Run one accumulation pass around a single player.
export function accumulate(player, level) {
  const budget = MAX_BLOCKS_PER_PASS[level] || 0;
  if (budget <= 0) return;
  const radius = ACCUMULATION_RADIUS[level] || 4;
  const dim = player.dimension;
  const loc = player.location;
  const px = Math.floor(loc.x);
  const py = Math.floor(loc.y);
  const pz = Math.floor(loc.z);
  const maxHeight = level >= 4 ? 6 : 2;

  let written = 0;
  // Visit columns in a randomized order so coverage spreads over time.
  const columns = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      columns.push([px + dx, pz + dz]);
    }
  }
  for (let i = columns.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [columns[i], columns[j]] = [columns[j], columns[i]];
  }

  for (const [x, z] of columns) {
    if (written >= budget) break;
    written += pileColumn(dim, x, z, py + 12, py - 6, maxHeight);

    // Level 4 also buries caves and tunnels beneath the surface.
    if (level >= 4 && written < budget) {
      written += fillCaves(dim, x, z, py - 1, 24, budget - written);
    }
  }
}
