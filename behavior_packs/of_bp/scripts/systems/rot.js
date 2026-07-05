/**
 * Rot Tier engine.
 *
 * Organic gear is a *side-grade* system, not a durability penalty. A piece of
 * gear's "wellness" is simply its remaining durability fraction, so tiers
 * survive relogs and are readable at a glance:
 *
 *   Fresh      (wellness > 66%)  — agile: +Speed, +Haste, light blood on hit.
 *   Fermented  (33%–66%)         — juggernaut: +Resistance, -Slowness, heavy knockback.
 *   Putrid     (< 33%)           — necrotic: +Strength, on-hit Poison + Wither.
 *
 * The engine is intentionally generic: anything tagged `custom:organic_gear`
 * with a durability component is driven by this file, so Module 2's weapons and
 * armour will inherit rot behaviour without new engine code.
 *
 * @module systems/rot
 */
import { world, system, EquipmentSlot, EntityComponentTypes } from "@minecraft/server";
import { CONFIG } from "../core/config.js";
import { clamp, safe } from "../core/util.js";

/** Friendly base names per gear id (falls back to a prettified type id). */
const GEAR_NAMES = {
  "custom:organic_cleaver": "Organic Cleaver",
};

function baseName(itemStack) {
  if (GEAR_NAMES[itemStack.typeId]) return GEAR_NAMES[itemStack.typeId];
  return itemStack.typeId
    .replace(/^.*:/, "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Remaining durability fraction (1 = pristine, 0 = destroyed). */
export function getWellness(itemStack) {
  const dur = safe(() => itemStack.getComponent("minecraft:durability"));
  if (!dur) return 1;
  const max = dur.maxDurability;
  return max > 0 ? clamp((max - dur.damage) / max, 0, 1) : 1;
}

/** Resolve the current Rot Tier id for an item. */
export function getTier(itemStack) {
  const w = getWellness(itemStack);
  const t = CONFIG.rot.tiers;
  if (w >= t.FRESH.min) return t.FRESH.id;
  if (w >= t.FERMENTED.min) return t.FERMENTED.id;
  return t.PUTRID.id;
}

const TIER_DISPLAY = {
  fresh: {
    name: (b) => `§aFresh ${b}`,
    lore: ["§7Rot Tier: §aFresh", "§8Pulsing, vital flesh.", "§7+Agility  +Attack pace"],
    tag: "of_tier_fresh",
  },
  fermented: {
    name: (b) => `§6Fermented ${b}`,
    lore: ["§7Rot Tier: §6Fermented", "§8Hardened, leathery hide.", "§7+Resilience  -Movement"],
    tag: "of_tier_fermented",
  },
  putrid: {
    name: (b) => `§2Putrid ${b}`,
    lore: ["§7Rot Tier: §2Putrid", "§8Bone-bared, dripping ichor.", "§7On-hit: Poison + Wither"],
    tag: "of_tier_putrid",
  },
};

/**
 * Stamp tier name + lore onto an ItemStack (mutates the passed stack).
 * Returns true if the visual actually changed (so callers can avoid needless writes).
 */
export function applyTierVisual(itemStack, tier) {
  const disp = TIER_DISPLAY[tier];
  const desiredName = disp.name(baseName(itemStack));
  if (itemStack.nameTag === desiredName) return false; // already correct — skip write
  itemStack.nameTag = desiredName;
  itemStack.setLore(disp.lore);
  return true;
}

/** Apply the passive, tier-based effects to a wielder holding organic gear. */
function applyHeldEffects(player, tier) {
  const d = CONFIG.rot.effectDuration;
  const opt = { amplifier: 0, showParticles: false };
  switch (tier) {
    case "fresh":
      player.addEffect("speed", d, opt);
      player.addEffect("haste", d, { amplifier: 1, showParticles: false });
      break;
    case "fermented":
      player.addEffect("resistance", d, opt);
      player.addEffect("slowness", d, opt);
      break;
    case "putrid":
      player.addEffect("strength", d, opt);
      break;
  }
}

/** On-hit consequences driven by the weapon's current tier. */
export function applyOnHit(attacker, victim, itemStack) {
  const tier = getTier(itemStack);
  const loc = victim.location;
  const dim = victim.dimension;
  safe(() => dim.spawnParticle(CONFIG.particles.blood, loc));

  if (tier === "fermented") {
    // Heavy knockback sweep away from the attacker (2.0 VectorXZ signature).
    const dx = victim.location.x - attacker.location.x;
    const dz = victim.location.z - attacker.location.z;
    const len = Math.hypot(dx, dz) || 1;
    const strength = 1.6;
    safe(() => victim.applyKnockback({ x: (dx / len) * strength, z: (dz / len) * strength }, 0.4));
  } else if (tier === "putrid") {
    safe(() => victim.addEffect("poison", 100, { amplifier: 1 }));
    safe(() => victim.addEffect("wither", 60, { amplifier: 0 }));
    safe(() => dim.spawnParticle(CONFIG.particles.ichor, { x: loc.x, y: loc.y + 1, z: loc.z }));
  }
}

/** Feed raw meat from the wielder's pack to restore wellness (push toward Fresh). */
function feedGear(player) {
  const equip = player.getComponent(EntityComponentTypes.Equippable ?? "minecraft:equippable");
  const inv = player.getComponent(EntityComponentTypes.Inventory ?? "minecraft:inventory");
  if (!equip || !inv) return;

  const held = equip.getEquipment(EquipmentSlot.Mainhand);
  if (!held || !held.getTags().includes(CONFIG.tags.organicGear)) return;

  const dur = held.getComponent("minecraft:durability");
  if (!dur || dur.damage <= 0) {
    safe(() => player.onScreenDisplay.setActionBar("§aGear is already Fresh."));
    return;
  }

  // Find a piece of raw meat to consume.
  const container = inv.container;
  let fedSlot = -1;
  for (let i = 0; i < container.size; i++) {
    const it = container.getItem(i);
    if (!it) continue;
    const isMeat =
      CONFIG.rot.feedMeatItems.includes(it.typeId) ||
      it.getTags().some((t) => CONFIG.rot.feedMeatTags.includes(t));
    if (isMeat) {
      fedSlot = i;
      break;
    }
  }
  if (fedSlot === -1) {
    safe(() => player.onScreenDisplay.setActionBar("§cNo raw meat to feed the gear."));
    return;
  }

  // Consume one unit of meat.
  const meat = container.getItem(fedSlot);
  if (meat.amount > 1) {
    meat.amount -= 1;
    container.setItem(fedSlot, meat);
  } else {
    container.setItem(fedSlot, undefined);
  }

  // Restore wellness and re-stamp the tier visual.
  dur.damage = Math.max(0, dur.damage - CONFIG.rot.feedRepair);
  applyTierVisual(held, getTier(held));
  equip.setEquipment(EquipmentSlot.Mainhand, held);

  safe(() => player.dimension.spawnParticle(CONFIG.particles.ichor, {
    x: player.location.x,
    y: player.location.y + 1.2,
    z: player.location.z,
  }));
  safe(() => player.dimension.playSound(CONFIG.sounds.squish, player.location));
  safe(() => player.onScreenDisplay.setActionBar(`§dGear fed — Tier: §f${getTier(held)}`));
}

/**
 * The `of:organic_gear` item custom component.
 *  - onUse       → feed raw meat to restore wellness.
 *  - onHitEntity → apply tier-based on-hit consequences.
 */
export function organicGearComponent() {
  return {
    onUse(e) {
      const player = e.source;
      if (!player || player.typeId !== "minecraft:player") return;
      feedGear(player);
    },
    onHitEntity(e) {
      const { attackingEntity, hitEntity, itemStack } = e;
      if (!attackingEntity || !hitEntity || !itemStack) return;
      applyOnHit(attackingEntity, hitEntity, itemStack);
    },
  };
}

/**
 * Background scan: for every player holding organic gear, keep the tier visual
 * current and refresh the passive tier effects. Cheap — one pass every second.
 */
export function startRotScan() {
  system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
      const equip = safe(() =>
        player.getComponent(EntityComponentTypes.Equippable ?? "minecraft:equippable")
      );
      if (!equip) continue;
      const held = safe(() => equip.getEquipment(EquipmentSlot.Mainhand));
      if (!held || !held.getTags().includes(CONFIG.tags.organicGear)) continue;

      const tier = getTier(held);
      applyHeldEffects(player, tier);
      if (applyTierVisual(held, tier)) {
        safe(() => equip.setEquipment(EquipmentSlot.Mainhand, held));
      }
    }
  }, CONFIG.rot.scanInterval);
}
