/**
 * Shared Harvester helpers used by both the machine logic and its UI.
 * Kept in its own module so `harvester.js` and `ui/harvesterUI.js` never import
 * each other (no circular dependency).
 *
 * @module machines/harvesterCore
 */
import { ItemStack, EntityComponentTypes } from "@minecraft/server";
import { CONFIG } from "../core/config.js";
import { blockCenter, safe } from "../core/util.js";

export const H = CONFIG.harvester;
export const SLOTS = H.slots;

/** Locate the invisible companion inventory entity sitting in a Harvester block. */
export function logicAt(dimension, blockLoc) {
  const center = blockCenter(blockLoc);
  const found = safe(() =>
    dimension.getEntities({ location: center, maxDistance: 1.0, type: H.logicEntity })
  );
  return found && found.length ? found[0] : undefined;
}

/** Ensure a companion entity exists for a Harvester block (spawns one if missing). */
export function ensureLogic(dimension, blockLoc) {
  let ent = logicAt(dimension, blockLoc);
  if (!ent) ent = safe(() => dimension.spawnEntity(H.logicEntity, blockCenter(blockLoc)));
  return ent;
}

/** The machine's storage container (6 slots). */
export function invOf(entity) {
  const comp = safe(() =>
    entity.getComponent(EntityComponentTypes.Inventory ?? "minecraft:inventory")
  );
  return comp ? comp.container : undefined;
}

export function isValidInput(item) {
  if (!item) return false;
  return (
    item.getTags().includes(CONFIG.tags.harvesterInput) ||
    CONFIG.rot.feedMeatItems.includes(item.typeId)
  );
}

export function isFuel(item) {
  return !!item && H.fuelItems.includes(item.typeId);
}

/** Can output `slot` accept `count` of `itemId`? (no mutation) */
export function slotAccepts(container, slot, itemId, count) {
  const existing = container.getItem(slot);
  if (!existing) return true;
  if (existing.typeId !== itemId) return false;
  return existing.amount + count <= existing.maxAmount;
}

/** Push items into a dedicated output slot, stacking where possible. */
export function addToSlot(container, slot, itemId, count) {
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

export function decrement(container, slot, n = 1) {
  const it = container.getItem(slot);
  if (!it) return;
  if (it.amount > n) {
    it.amount -= n;
    container.setItem(slot, it);
  } else {
    container.setItem(slot, undefined);
  }
}

/** Spill a machine's contents into the world (on break / orphan cleanup). */
export function dropContents(entity) {
  const container = invOf(entity);
  if (!container) return;
  const dim = entity.dimension;
  const loc = entity.location;
  for (let i = 0; i < container.size; i++) {
    const it = container.getItem(i);
    if (it) safe(() => dim.spawnItem(it, loc));
  }
}
