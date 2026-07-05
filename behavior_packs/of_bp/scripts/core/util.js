/**
 * Small shared helpers used across the add-on.
 * @module core/util
 */
import { world } from "@minecraft/server";
import { DIMENSION_IDS } from "./config.js";

/** Center-of-block coordinate for a block/integer location. */
export function blockCenter(loc) {
  return { x: Math.floor(loc.x) + 0.5, y: Math.floor(loc.y) + 0.5, z: Math.floor(loc.z) + 0.5 };
}

/** Iterate every loaded entity of a type across all dimensions. */
export function forEachEntityOfType(typeId, callback) {
  for (const dimId of DIMENSION_IDS) {
    let dim;
    try {
      dim = world.getDimension(dimId);
    } catch {
      continue;
    }
    let entities;
    try {
      entities = dim.getEntities({ type: typeId });
    } catch {
      continue;
    }
    for (const ent of entities) callback(ent, dim);
  }
}

/** Weighted random pick from `[{ weight, ...}]`. Returns the chosen entry. */
export function weightedPick(pool) {
  const total = pool.reduce((s, e) => s + (e.weight ?? 1), 0);
  let roll = Math.random() * total;
  for (const entry of pool) {
    roll -= entry.weight ?? 1;
    if (roll <= 0) return entry;
  }
  return pool[pool.length - 1];
}

/** True if an ItemStack carries any of the given tags. */
export function itemHasAnyTag(itemStack, tags) {
  if (!itemStack) return false;
  const itemTags = itemStack.getTags();
  return tags.some((t) => itemTags.includes(t));
}

/** True if an ItemStack matches an id list or tag list. */
export function itemMatches(itemStack, { ids = [], tags = [] }) {
  if (!itemStack) return false;
  if (ids.includes(itemStack.typeId)) return true;
  if (tags.length && itemHasAnyTag(itemStack, tags)) return true;
  return false;
}

/** Read a numeric dynamic property with a fallback default. */
export function getNumber(holder, key, fallback = 0) {
  const v = holder.getDynamicProperty(key);
  return typeof v === "number" ? v : fallback;
}

/** Clamp helper. */
export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Safe wrapper — swallows the "read-only / entity invalid" style errors that
 *  crop up when an entity is unloaded mid-tick. */
export function safe(fn) {
  try {
    return fn();
  } catch (e) {
    return undefined;
  }
}
