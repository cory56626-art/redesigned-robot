// =========================================================================
//  Overdrive Sculk — the infection engine.
//
//  The corruption is modelled as a rolling "frontier": the set of sculk
//  blocks that still have room to grow.  Spreading picks random frontier
//  blocks and converts a neighbour, so the mass expands FOREVER with no
//  radius or distance cap — only spread speed and total block count matter.
// =========================================================================

import { world } from "@minecraft/server";
import {
  BLOCK_ID, DP, LEVELS, FRONTIER_CAP, MIN_INTERVAL_SEC,
  PROTECTED_BLOCKS, levelData, hasFlag, randInt, shuffle, shortDimId,
} from "./config.js";

// Directions the infection can creep into, split by tier so growth can be
// biased to crawl ACROSS the surface (horizontal + up) before burrowing down.
const HORIZ_DIRS = [
  { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
  { x: 1, y: 0, z: 1 }, { x: -1, y: 0, z: -1 },
  { x: 1, y: 0, z: -1 }, { x: -1, y: 0, z: 1 },
];
const UP_DIRS = [
  { x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }, { x: -1, y: 1, z: 0 },
  { x: 0, y: 1, z: 1 }, { x: 0, y: 1, z: -1 },
];
const DOWN_DIRS = [
  { x: 0, y: -1, z: 0 }, { x: 0, y: -1, z: 1 }, { x: 0, y: -1, z: -1 },
  { x: 1, y: -1, z: 0 }, { x: -1, y: -1, z: 0 },
];
const GROW_DIRS = [...HORIZ_DIRS, ...UP_DIRS, ...DOWN_DIRS];

export class Infection {
  constructor() {
    this.active = false;
    this.level = 1;
    this.blockCount = 0;
    this.energy = 0;
    /** @type {{d:string,x:number,y:number,z:number}[]} */
    this.frontier = [];
    this._loaded = false;
  }

  // --------------------------------------------------------------------- //
  //  Persistence                                                          //
  // --------------------------------------------------------------------- //
  load() {
    this.active = world.getDynamicProperty(DP.active) === true;
    this.level = Number(world.getDynamicProperty(DP.level) ?? 1) || 1;
    this.blockCount = Number(world.getDynamicProperty(DP.blocks) ?? 0) || 0;
    this.energy = Number(world.getDynamicProperty(DP.energy) ?? 0) || 0;
    const raw = world.getDynamicProperty(DP.frontier);
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) this.frontier = parsed;
      } catch { /* corrupt save — start with an empty frontier */ }
    }
    this._loaded = true;
  }

  save() {
    world.setDynamicProperty(DP.active, this.active);
    world.setDynamicProperty(DP.level, this.level);
    world.setDynamicProperty(DP.blocks, this.blockCount);
    world.setDynamicProperty(DP.energy, this.energy);
    // Persist only the freshest slice of the frontier to respect the
    // per-property size budget; the mass itself lives in the world blocks.
    const slice = this.frontier.slice(-200);
    world.setDynamicProperty(DP.frontier, JSON.stringify(slice));
  }

  reset() {
    this.active = false;
    this.level = 1;
    this.blockCount = 0;
    this.energy = 0;
    this.frontier = [];
    this.save();
  }

  // --------------------------------------------------------------------- //
  //  Tuning derived from level + energy                                   //
  // --------------------------------------------------------------------- //
  effectiveIntervalSec() {
    const L = levelData(this.level);
    const steps = Math.floor(this.energy / 10);         // every 10 energy...
    return Math.max(MIN_INTERVAL_SEC, L.intervalSec - 0.5 * steps); // -0.5s each
  }

  rollAmount(L) {
    const steps = Math.floor(this.energy / 10);         // every 10 energy...
    const effMin = Math.min(L.maxSpread, L.minSpread + 2 * steps); // +2 blocks each
    return randInt(effMin, L.maxSpread);                // never above level max
  }

  // --------------------------------------------------------------------- //
  //  Seeding                                                              //
  // --------------------------------------------------------------------- //
  /** Register a player-placed sculk block. Returns true if this first-placement
   *  activated the infection. */
  seed(block) {
    this.frontier.push({
      d: shortDimId(block.dimension.id),
      x: block.location.x,
      y: block.location.y,
      z: block.location.z,
    });
    this.blockCount++;
    if (!this.active) {
      this.active = true;
      this.level = 1;
      return true;
    }
    return false;
  }

  // --------------------------------------------------------------------- //
  //  Growth                                                               //
  // --------------------------------------------------------------------- //
  isConvertible(block, allowWater) {
    if (!block) return false;
    let air = false, liquid = false;
    try { air = block.isAir; } catch { /* ignore */ }
    if (air) return false;
    const id = block.typeId;
    if (PROTECTED_BLOCKS.has(id)) return false;
    try { liquid = block.isLiquid; } catch { /* ignore */ }
    if (liquid || id === "minecraft:water" || id === "minecraft:flowing_water") {
      return !!allowWater; // only Level 12+ pushes through water
    }
    if (id === "minecraft:lava" || id === "minecraft:flowing_lava") return false;
    return true;
  }

  /** Try to convert one neighbour of a frontier block. Returns the new sculk
   *  position, or null if the block is fully surrounded / in an unloaded chunk. */
  tryGrowFrom(dim, pos, allowWater) {
    // Fully random direction: spreads and burrows freely in every direction.
    const dirs = shuffle(GROW_DIRS.slice());
    const range = dim.heightRange;
    for (const dd of dirs) {
      const loc = { x: pos.x + dd.x, y: pos.y + dd.y, z: pos.z + dd.z };
      if (range && (loc.y < range.min || loc.y >= range.max)) continue;
      let n;
      try { n = dim.getBlock(loc); } catch { continue; } // unloaded chunk
      if (!this.isConvertible(n, allowWater)) continue;
      try { n.setType(BLOCK_ID); } catch { continue; }
      return { d: pos.d, x: loc.x, y: loc.y, z: loc.z };
    }
    return null;
  }

  /** Convert a specific block to sculk and fold it into the frontier. Used by
   *  infected mobs seeding the ground as they roam. Returns true on success. */
  convertAt(dim, x, y, z) {
    let b;
    try { b = dim.getBlock({ x, y, z }); } catch { return false; }
    if (!this.isConvertible(b, false)) return false;
    try { b.setType(BLOCK_ID); } catch { return false; }
    this.frontier.push({ d: shortDimId(dim.id), x, y, z });
    this.blockCount++;
    this._prune();
    return true;
  }

  /** Perform one spread cycle. Returns an array of newly reached level numbers. */
  spreadStep() {
    if (!this.active || this.frontier.length === 0) return [];
    const L = levelData(this.level);
    const allowWater = hasFlag(this.level, "waterSpread");

    let target = this.rollAmount(L);
    // Burst spreads unlock at Level 4 (20–25 extra blocks in one surge).
    if (this.level >= 4 && Math.random() < 0.35) target += randInt(20, 25);

    let placed = 0;
    let attempts = 0;
    const maxAttempts = target * 8 + 40;
    while (placed < target && attempts < maxAttempts && this.frontier.length > 0) {
      attempts++;
      const idx = randInt(0, this.frontier.length - 1);
      const f = this.frontier[idx];
      let dim;
      try { dim = world.getDimension(f.d); } catch { this.frontier.splice(idx, 1); continue; }
      const grown = this.tryGrowFrom(dim, f, allowWater);
      if (grown) {
        this.frontier.push(grown);
        this.blockCount++;
        placed++;
      } else if (Math.random() < 0.4) {
        // Retire an exhausted edge block so the frontier keeps moving outward.
        this.frontier.splice(idx, 1);
      }
    }

    this._prune();
    return this.checkLevelUp();
  }

  _prune() {
    const over = this.frontier.length - FRONTIER_CAP;
    if (over > 0) this.frontier.splice(0, over);
  }

  // --------------------------------------------------------------------- //
  //  Levelling & energy                                                   //
  // --------------------------------------------------------------------- //
  checkLevelUp() {
    const reached = [];
    while (this.level < 15 && this.blockCount >= LEVELS[this.level].trigger) {
      this.level++;
      reached.push(this.level);
    }
    return reached;
  }

  /** Add energy. Returns how many fresh 10-energy thresholds were crossed. */
  addEnergy(n) {
    const before = Math.floor(this.energy / 10);
    this.energy += n;
    return Math.floor(this.energy / 10) - before;
  }

  /** A random loaded frontier block, for spawning/effects near the corruption. */
  randomFrontier() {
    if (this.frontier.length === 0) return null;
    return this.frontier[randInt(0, this.frontier.length - 1)];
  }
}
