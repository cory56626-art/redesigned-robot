/**
 * The Chum system — environmental consequence.
 *
 * Every carcass the Harvester grinds raises a world "chum score". Past a
 * threshold the land around each Harvester begins to rot: a periodic sweep
 * replaces nearby grass/dirt with `custom:flesh_moss`, the biopunk creep that
 * marks a base as a slaughterhouse. Chum is the hook Module 4's amalgamations
 * will later spawn from.
 *
 * @module systems/chum
 */
import { world, system } from "@minecraft/server";
import { CONFIG } from "../core/config.js";
import { blockCenter, clamp, safe } from "../core/util.js";

const C = CONFIG.chum;

/** Current world chum score. */
export function getChumScore() {
  const v = world.getDynamicProperty(C.scoreProperty);
  return typeof v === "number" ? v : 0;
}

/** Raise the chum score (called by the Harvester each time it processes). */
export function addChum(dimension, blockLoc, amount) {
  world.setDynamicProperty(C.scoreProperty, getChumScore() + amount);
  safe(() => dimension.spawnParticle(CONFIG.particles.corruption, blockCenter(blockLoc)));
}

/** Try to corrupt one column near `base`. */
function corruptNear(dimension, base) {
  const dx = Math.floor((Math.random() * 2 - 1) * C.spreadRadius);
  const dz = Math.floor((Math.random() * 2 - 1) * C.spreadRadius);
  // Sample a few vertical offsets so we catch the local surface.
  for (const dy of [1, 0, -1, -2, -3]) {
    const loc = { x: base.x + dx, y: base.y + dy, z: base.z + dz };
    const block = safe(() => dimension.getBlock(loc));
    if (!block) continue;
    if (!C.corruptibleBlocks.includes(block.typeId)) continue;
    // Only corrupt if the space above is clear-ish (a real surface, not buried).
    const above = safe(() => block.above());
    if (above && !above.isAir && !above.isLiquid && above.typeId !== "custom:flesh_moss") {
      // Buried — allow occasionally but prefer surfaces.
      if (Math.random() > 0.25) continue;
    }
    if (safe(() => block.setType(C.corruptedBlock))) {
      safe(() => dimension.spawnParticle(CONFIG.particles.corruption, blockCenter(loc)));
      return true;
    }
  }
  return false;
}

/** Periodic corruption sweep around every Harvester. */
export function startChumCorruption() {
  system.runInterval(() => {
    const chum = getChumScore();
    if (chum < C.spreadThreshold) return;
    const intensity = clamp((chum - C.spreadThreshold) / 60, 0.05, 1);

    for (const dimId of ["overworld", "nether", "the_end"]) {
      let dim;
      try {
        dim = world.getDimension(dimId);
      } catch {
        continue;
      }
      const machines = safe(() => dim.getEntities({ type: CONFIG.harvester.logicEntity })) || [];
      for (const ent of machines) {
        const base = {
          x: Math.floor(ent.location.x),
          y: Math.floor(ent.location.y),
          z: Math.floor(ent.location.z),
        };
        let attempts = C.maxSpreadPerSweep;
        while (attempts-- > 0) {
          if (Math.random() <= intensity) corruptNear(dim, base);
        }
      }
    }
  }, C.spreadInterval);
}
