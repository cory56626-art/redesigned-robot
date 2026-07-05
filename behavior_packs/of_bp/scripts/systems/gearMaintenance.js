/**
 * Gear maintenance — Combat Siphoning.
 *
 * Killing a living mob while wielding organic gear siphons a little vitality
 * back into it (a lifesteal-for-durability mechanic), nudging the piece toward
 * the Fresh tier. The other restoration path — feeding raw meat — lives in the
 * `of:organic_gear` item component (see systems/rot.js).
 *
 * @module systems/gearMaintenance
 */
import { world, EquipmentSlot, EntityComponentTypes } from "@minecraft/server";
import { CONFIG } from "../core/config.js";
import { safe } from "../core/util.js";
import { applyTierVisual, getTier } from "./rot.js";

function siphonInto(player, amount) {
  const equip = safe(() =>
    player.getComponent(EntityComponentTypes.Equippable ?? "minecraft:equippable")
  );
  if (!equip) return;
  const held = equip.getEquipment(EquipmentSlot.Mainhand);
  if (!held || !held.getTags().includes(CONFIG.tags.organicGear)) return;
  const dur = held.getComponent("minecraft:durability");
  if (!dur || dur.damage <= 0) return;

  dur.damage = Math.max(0, dur.damage - amount);
  applyTierVisual(held, getTier(held));
  equip.setEquipment(EquipmentSlot.Mainhand, held);

  safe(() =>
    player.dimension.spawnParticle(CONFIG.particles.ichor, {
      x: player.location.x,
      y: player.location.y + 1.2,
      z: player.location.z,
    })
  );
}

export function startCombatSiphon() {
  world.afterEvents.entityDie.subscribe((e) => {
    const killer = e.damageSource?.damagingEntity;
    if (!killer || killer.typeId !== "minecraft:player") return;
    // Don't reward killing our own machines.
    if (e.deadEntity?.typeId === CONFIG.harvester.logicEntity) return;
    siphonInto(killer, CONFIG.rot.siphonRepair);
  });
}
