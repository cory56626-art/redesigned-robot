/**
 * The Harvester — a script-driven meat grinder.
 *
 * A custom block cannot hold a native multi-slot container, so each placed
 * Harvester spawns an invisible companion entity (`custom:harvester_logic`)
 * whose 6-slot inventory *is* the machine's storage. A single central interval
 * advances every machine in the world: it burns coal/charcoal, grinds a carcass
 * over ~10 seconds while venting dark smoke and grind noise, deposits the
 * extracted organic components into the output slots, and feeds the Chum system.
 *
 * @module machines/harvester
 */
import { world, system, ItemStack, EntityComponentTypes } from "@minecraft/server";
import { CONFIG } from "../core/config.js";
import { blockCenter, safe, weightedPick } from "../core/util.js";
import { addChum } from "../systems/chum.js";

const H = CONFIG.harvester;
const S = H.slots;

/* ------------------------------------------------------------------ companion entity */

function logicAt(dimension, blockLoc) {
  const center = blockCenter(blockLoc);
  const found = safe(() =>
    dimension.getEntities({ location: center, maxDistance: 1.0, type: H.logicEntity })
  );
  return found && found.length ? found[0] : undefined;
}

function ensureLogic(dimension, blockLoc) {
  let ent = logicAt(dimension, blockLoc);
  if (!ent) {
    ent = safe(() => dimension.spawnEntity(H.logicEntity, blockCenter(blockLoc)));
  }
  return ent;
}

function invOf(entity) {
  const comp = safe(() =>
    entity.getComponent(EntityComponentTypes.Inventory ?? "minecraft:inventory")
  );
  return comp ? comp.container : undefined;
}

/* ------------------------------------------------------------------ item helpers */

function isValidInput(item) {
  if (!item) return false;
  return (
    item.getTags().includes(CONFIG.tags.harvesterInput) ||
    CONFIG.rot.feedMeatItems.includes(item.typeId)
  );
}

function isFuel(item) {
  return item && H.fuelItems.includes(item.typeId);
}

/** Can the given output slot accept `count` of `itemId`? (no mutation) */
function slotAccepts(container, slot, itemId, count) {
  const existing = container.getItem(slot);
  if (!existing) return true;
  if (existing.typeId !== itemId) return false;
  return existing.amount + count <= existing.maxAmount;
}

/** Push items into a dedicated output slot, stacking where possible. */
function addToSlot(container, slot, itemId, count) {
  const existing = container.getItem(slot);
  if (!existing) {
    container.setItem(slot, new ItemStack(itemId, count));
    return true;
  }
  if (existing.typeId === itemId && existing.amount + count <= existing.maxAmount) {
    existing.amount += count;
    container.setItem(slot, existing);
    return true;
  }
  return false;
}

function decrement(container, slot, n = 1) {
  const it = container.getItem(slot);
  if (!it) return;
  if (it.amount > n) {
    it.amount -= n;
    container.setItem(slot, it);
  } else {
    container.setItem(slot, undefined);
  }
}

/* ------------------------------------------------------------------ processing */

function canProduceMain(container) {
  return (
    slotAccepts(container, S.OUT_SINEW, H.outputs.sinew.item, H.outputs.sinew.count) &&
    slotAccepts(container, S.OUT_BONE, H.outputs.bone.item, H.outputs.bone.count)
  );
}

function produce(container) {
  addToSlot(container, S.OUT_SINEW, H.outputs.sinew.item, H.outputs.sinew.count);
  addToSlot(container, S.OUT_BONE, H.outputs.bone.item, H.outputs.bone.count);
  if (Math.random() < H.byproduct.chance) {
    const pick = weightedPick(H.byproduct.pool);
    addToSlot(container, S.OUT_BYPRODUCT, pick.item, pick.count);
  }
}

function setActive(block, active) {
  if (safe(() => block.permutation.getState(H.activeState)) === active) return;
  safe(() => block.setPermutation(block.permutation.withState(H.activeState, active)));
}

function emitWorkFx(dimension, blockLoc) {
  const c = blockCenter(blockLoc);
  if (Math.random() < 0.5) {
    safe(() => dimension.spawnParticle(CONFIG.particles.darkSmoke, { x: c.x, y: c.y + 0.9, z: c.z }));
  }
  if (Math.random() < 0.25) {
    safe(() => dimension.playSound(CONFIG.sounds.grind, c, { volume: 0.6 }));
  }
}

/** Advance one machine by one loop step. */
function processMachine(entity) {
  const dimension = entity.dimension;
  const blockLoc = {
    x: Math.floor(entity.location.x),
    y: Math.floor(entity.location.y),
    z: Math.floor(entity.location.z),
  };
  const block = safe(() => dimension.getBlock(blockLoc));

  // Orphaned companion (block gone) — dump its contents and vanish.
  if (!block || block.typeId !== "custom:harvester") {
    dropContents(entity);
    safe(() => entity.remove());
    return;
  }

  const container = invOf(entity);
  if (!container) return;

  const dt = H.tickInterval;
  let progress = Number(entity.getDynamicProperty("of:progress") ?? 0);
  let fuel = Number(entity.getDynamicProperty("of:fuel") ?? 0);

  const input = container.getItem(S.INPUT);
  const runnable = isValidInput(input) && canProduceMain(container);
  let active = false;

  if (runnable) {
    if (fuel < dt && isFuel(container.getItem(S.FUEL))) {
      decrement(container, S.FUEL, 1);
      fuel += H.fuelTicksPerUnit;
    }
    if (fuel >= dt) {
      fuel -= dt;
      progress += dt;
      active = true;
      emitWorkFx(dimension, blockLoc);
      if (progress >= H.processTicks) {
        progress = 0;
        produce(container);
        decrement(container, S.INPUT, 1);
        safe(() => dimension.playSound(CONFIG.sounds.squish, blockCenter(blockLoc)));
        addChum(dimension, blockLoc, H.chumPerProcess);
      }
    }
  } else if (progress > 0) {
    progress = Math.max(0, progress - dt);
  }

  entity.setDynamicProperty("of:progress", progress);
  entity.setDynamicProperty("of:fuel", fuel);
  setActive(block, active);
}

/* ------------------------------------------------------------------ teardown */

function dropContents(entity) {
  const container = invOf(entity);
  if (!container) return;
  const dim = entity.dimension;
  const loc = entity.location;
  for (let i = 0; i < container.size; i++) {
    const it = container.getItem(i);
    if (it) safe(() => dim.spawnItem(it, loc));
  }
}

/* ------------------------------------------------------------------ block component */

export function harvesterBlockComponent(openUi) {
  return {
    onPlace(e) {
      const { block, dimension } = e;
      system.run(() => ensureLogic(dimension, block.location));
    },
    onPlayerInteract(e) {
      const { block, dimension, player } = e;
      if (!player) return;
      const entity = ensureLogic(dimension, block.location);
      if (entity) system.run(() => openUi(player, entity, block));
    },
    onPlayerDestroy(e) {
      const { block, dimension } = e;
      const entity = logicAt(dimension, block.location);
      if (entity) {
        dropContents(entity);
        safe(() => entity.remove());
      }
    },
  };
}

/** Start the single loop that drives every Harvester in the world. */
export function startHarvesterProcessing() {
  system.runInterval(() => {
    for (const dimId of ["overworld", "nether", "the_end"]) {
      let dim;
      try {
        dim = world.getDimension(dimId);
      } catch {
        continue;
      }
      const machines = safe(() => dim.getEntities({ type: H.logicEntity })) || [];
      for (const ent of machines) processMachine(ent);
    }
  }, H.tickInterval);
}

export { logicAt, invOf, isValidInput, isFuel };
