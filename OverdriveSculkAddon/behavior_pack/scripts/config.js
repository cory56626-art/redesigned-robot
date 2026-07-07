// =========================================================================
//  Overdrive Sculk — configuration & level table
//  Every gameplay number the infection uses lives here so the 15-level
//  progression stays declarative and easy to tune.
// =========================================================================

export const BLOCK_ID = "overdrive:overdrive_sculk";
export const NODE_ID = "overdrive:overdrive_node";

export const VINE_ID = "overdrive:overdrive_vine";
export const TENTACLE_ID = "overdrive:tentacle";
export const MOB_ZOMBIE = "overdrive:infected_zombie";
export const MOB_SKELETON = "overdrive:infected_skeleton";
export const MOB_CREEPER = "overdrive:infected_creeper";

// The corruption never radius-limits.  These are only *performance* guards so
// a single world cannot allocate unbounded script memory: the frontier is the
// rolling "growing edge" of the infection, not the whole mass.
export const FRONTIER_CAP = 400;

// Global floor the energy accelerator can push a level's interval down toward.
// (Level 15 itself already spreads every 1s, so this is the true minimum.)
export const MIN_INTERVAL_SEC = 1.0;

// Energy added to the infection every time the Vine Grab claims a mob.
export const ENERGY_PER_GRAB = 5;

// Blocks that the infection is never allowed to consume.
export const PROTECTED_BLOCKS = new Set([
  BLOCK_ID,
  NODE_ID,
  "minecraft:bedrock",
  "minecraft:barrier",
  "minecraft:command_block",
  "minecraft:chain_command_block",
  "minecraft:repeating_command_block",
  "minecraft:structure_block",
  "minecraft:structure_void",
  "minecraft:end_portal",
  "minecraft:end_portal_frame",
  "minecraft:light_block",
  "minecraft:jigsaw",
]);

// Dynamic-property keys (world scoped) used to persist state across reloads.
export const DP = {
  active: "overdrive:active",
  level: "overdrive:level",
  blocks: "overdrive:blocks",
  energy: "overdrive:energy",
  frontier: "overdrive:frontier",
};

// -------------------------------------------------------------------------
//  The 15 levels.  Each entry ONLY changes spread speed, spread amount and
//  which behaviors are unlocked — exactly as specified.
// -------------------------------------------------------------------------
export const LEVELS = [
  { level: 1,  trigger: 0,    intervalSec: 15,  minSpread: 5,  maxSpread: 8 },
  { level: 2,  trigger: 100,  intervalSec: 12,  minSpread: 8,  maxSpread: 12, spawnZombie: true },
  { level: 3,  trigger: 200,  intervalSec: 10,  minSpread: 10, maxSpread: 15, tentacles: true },
  { level: 4,  trigger: 300,  intervalSec: 9,   minSpread: 12, maxSpread: 18, tentacles: true, tentaclesOften: true, burstMin: 20, burstMax: 25 },
  { level: 5,  trigger: 400,  intervalSec: 8,   minSpread: 15, maxSpread: 20, tentacles: true },
  { level: 6,  trigger: 500,  intervalSec: 7,   minSpread: 18, maxSpread: 25, spawnSkeleton: true },
  { level: 7,  trigger: 600,  intervalSec: 6,   minSpread: 20, maxSpread: 28, spawnCreeper: true },
  { level: 8,  trigger: 700,  intervalSec: 5,   minSpread: 22, maxSpread: 30, tentacleReach: true },
  { level: 9,  trigger: 800,  intervalSec: 4,   minSpread: 25, maxSpread: 35 },
  { level: 10, trigger: 900,  intervalSec: 3.5, minSpread: 28, maxSpread: 40, rumbling: true },
  { level: 11, trigger: 1000, intervalSec: 3,   minSpread: 30, maxSpread: 45, wardenChance: 0.075 },
  { level: 12, trigger: 1200, intervalSec: 2.5, minSpread: 35, maxSpread: 50, waterSpread: true },
  { level: 13, trigger: 1500, intervalSec: 2,   minSpread: 40, maxSpread: 55, nodes: true },
  { level: 14, trigger: 1800, intervalSec: 1.5, minSpread: 45, maxSpread: 60, fog: true },
  { level: 15, trigger: 2000, intervalSec: 1,   minSpread: 50, maxSpread: 70, maxAggression: true },
];

export function levelData(level) {
  const i = Math.max(1, Math.min(15, level | 0)) - 1;
  return LEVELS[i];
}

// A capability is unlocked once *any* level up to the current one enabled it.
export function hasFlag(level, flag) {
  for (let i = 0; i < level && i < LEVELS.length; i++) {
    if (LEVELS[i][flag]) return true;
  }
  return false;
}

// Vine Grab chance ramps at the specified breakpoints and holds in between.
export function vineChanceForLevel(level) {
  if (level >= 15) return 0.40;
  if (level >= 9) return 0.35;
  if (level >= 5) return 0.30;
  if (level >= 2) return 0.25;
  return 0;
}

// world.getDimension() reliably accepts the short id on every runtime version,
// whereas the namespaced "minecraft:overworld" form is only accepted on newer
// ones. Frontier positions therefore always store the short id.
export function shortDimId(id) {
  return typeof id === "string" ? id.replace("minecraft:", "") : "overworld";
}

export function randInt(min, max) {
  if (max < min) [min, max] = [max, min];
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
