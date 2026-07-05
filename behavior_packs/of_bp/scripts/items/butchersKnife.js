/**
 * Butcher's Knife.
 *
 * Interact (right-click) with a weakened farm mob to render it down into a Raw
 * Carcass — despawns the mob, sprays blood, cracks bone, drops the carcass, and
 * chips the blade. Also sprays a little blood on any melee hit. Wired through
 * stable world events (no item custom component), so the item always loads.
 *
 * @module items/butchersKnife
 */
import { world, system, ItemStack, EquipmentSlot, EntityComponentTypes } from "@minecraft/server";
import { CONFIG } from "../core/config.js";
import { safe } from "../core/util.js";

const KNIFE_ID = "custom:butchers_knife";

function mainhandOf(entity) {
  const equip = safe(() =>
    entity.getComponent(EntityComponentTypes.Equippable ?? "minecraft:equippable")
  );
  return equip ? { equip, item: safe(() => equip.getEquipment(EquipmentSlot.Mainhand)) } : {};
}

/** Is this a farm mob that the knife can harvest, and is it weak enough? */
function isHarvestable(target) {
  if (!target || !CONFIG.knife.harvestableTypes.includes(target.typeId)) return false;
  const hp = safe(() => target.getComponent(EntityComponentTypes.Health ?? "minecraft:health"));
  if (!hp) return false;
  return hp.currentValue <= hp.effectiveMax * CONFIG.knife.weakHealthFraction;
}

/** Spend a little durability on the knife after a successful harvest. */
function damageKnife(player) {
  const { equip, item } = mainhandOf(player);
  if (!equip || !item || item.typeId !== KNIFE_ID) return;
  const dur = item.getComponent("minecraft:durability");
  if (!dur) return;
  dur.damage = Math.min(dur.maxDurability, dur.damage + CONFIG.knife.harvestDurabilityCost);
  if (dur.damage >= dur.maxDurability) {
    equip.setEquipment(EquipmentSlot.Mainhand, undefined); // blade shatters
    safe(() => player.playSound("random.break", { location: player.location }));
  } else {
    equip.setEquipment(EquipmentSlot.Mainhand, item);
  }
}

/** The gory bit — run next tick, outside the read-only interact event. */
function harvest(player, target) {
  if (!target || target.isValid === false) return;
  const dim = target.dimension;
  const loc = target.location;

  safe(() => dim.spawnParticle(CONFIG.particles.blood, { x: loc.x, y: loc.y + 0.6, z: loc.z }));
  safe(() => dim.playSound(CONFIG.sounds.boneBreak, loc));
  safe(() => dim.playSound(CONFIG.sounds.squish, loc));

  safe(() => target.remove());
  safe(() =>
    dim.spawnItem(
      new ItemStack(CONFIG.knife.carcassItem, CONFIG.knife.carcassCount),
      { x: loc.x, y: loc.y + 0.3, z: loc.z }
    )
  );
  damageKnife(player);
}

export function startButcherKnife() {
  // Interact-to-harvest.
  world.beforeEvents.playerInteractWithEntity.subscribe((e) => {
    const { player, target, itemStack } = e;
    if (!itemStack || itemStack.typeId !== KNIFE_ID) return;
    if (!isHarvestable(target)) return;
    e.cancel = true; // committing to the harvest
    system.run(() => harvest(player, target));
  });

  // Light blood spray on any melee hit with the knife.
  world.afterEvents.entityHitEntity.subscribe((e) => {
    const { damagingEntity, hitEntity } = e;
    if (!damagingEntity || !hitEntity) return;
    const { item } = mainhandOf(damagingEntity);
    if (!item || item.typeId !== KNIFE_ID) return;
    safe(() =>
      hitEntity.dimension.spawnParticle(CONFIG.particles.blood, {
        x: hitEntity.location.x,
        y: hitEntity.location.y + 0.6,
        z: hitEntity.location.z,
      })
    );
  });
}
