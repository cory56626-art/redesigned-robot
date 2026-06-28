// util.js — small helpers shared across the weather modules.
import { HEAT_BLOCKS, HEAT_RADIUS, SKY_SCAN_HEIGHT } from "./config.js";

// Clamp a number to [min, max].
export function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

// Safe block read: returns the Block or undefined if the chunk is unloaded
// or the coordinate is out of the world. Never throws.
export function tryGetBlock(dimension, location) {
  try {
    return dimension.getBlock(location);
  } catch {
    return undefined;
  }
}

// Returns true if the player has open sky above them (no solid block within
// SKY_SCAN_HEIGHT). Used to decide who is exposed to the storm.
export function isExposedToSky(player) {
  const dim = player.dimension;
  const head = player.getHeadLocation();
  const startY = Math.floor(head.y) + 1;
  const x = Math.floor(head.x);
  const z = Math.floor(head.z);
  const top = startY + SKY_SCAN_HEIGHT;
  for (let y = startY; y <= top; y++) {
    const block = tryGetBlock(dim, { x, y, z });
    if (block === undefined) continue; // unloaded slice: treat as transparent
    if (!block.isAir && !block.isLiquid) {
      // A solid block (leaves/glass included) overhead means sheltered.
      return false;
    }
  }
  return true;
}

// Returns true if a warmth source (fire, lava, campfire, torch, ...) sits
// within HEAT_RADIUS of the player. Scans a small cube; capped for perf.
export function isNearHeat(player) {
  const dim = player.dimension;
  const loc = player.location;
  const bx = Math.floor(loc.x);
  const by = Math.floor(loc.y);
  const bz = Math.floor(loc.z);
  const r = HEAT_RADIUS;
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        const block = tryGetBlock(dim, { x: bx + dx, y: by + dy, z: bz + dz });
        if (block && HEAT_BLOCKS.has(block.typeId)) return true;
      }
    }
  }
  return false;
}

// Format a 0..1 fraction as a 10-segment ASCII bar for the action bar.
export function bar(fraction, filledChar = "▰", emptyChar = "▱", segments = 10) {
  const filled = clamp(Math.round(fraction * segments), 0, segments);
  return filledChar.repeat(filled) + emptyChar.repeat(segments - filled);
}
