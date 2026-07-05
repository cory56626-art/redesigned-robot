/**
 * Butcher's Knife.
 *
 * Melee weapon that "renders down" a weakened farm mob when you interact
 * (right-click) with it. On a valid harvest it despawns the mob, sprays blood,
 * cracks a bone-break sound, and drops a Raw Carcass — the feedstock for the
 * Harvester.
 *
 * @module items/butchersKnife
 */
import { world, system, ItemStack, EquipmentSlot, EntityComponentTypes } from "@minecraft/server";
import { CONFIG } from "../core/config.js";
import { safe } from "../core/util.js";

const KNIFE_ID = "custom:butchers_knife";

/** Is this mob one the knife can harvest, and is it weak enough? */
function isHarvestable(target) {
  if (!CONFIG.knife.harvestableTypes.includes(target.typeId)) return false;
  const hp = safe(() => target.getComponent(EntityComponentTypes.Health ?? "minecraft:health"));
  if (!hp) return false;
  return hp.currentValue <= hp.effectiveMax * CONFIG.knife.weakHealthFraction;
}

/** Spend a little durability on the knife after a successful harvest. */
function damageKnife(player) {
  const equip = safe(() =>
    player.getComponent(EntityComponentTypes.Equippable ?? "minecraft:equippable")
  );
  if (!equip) return;
  const knife = equip.getEquipment(EquipmentSlot.Mainhand);
  if (!knife || knife.typeId !== KNIFE_ID) return;
  const dur = knife.getComponent("minecraft:durability");
  if (!dur) return;
  dur.damage = Math.min(dur.maxDurability, dur.damage + CONFIG.knife.harvestDurabilityCost);
  if (dur.damage >= dur.maxDurability) {
    // Knife shatters.
    equip.setEquipment(EquipmentSlot.Mainhand, undefined);
    safe(() => player.playSound("random.break", { location: player.location }));
  } else {
    equip.setEquipment(EquipmentSlot.Mainhand, knife);
  }
}

/** Perform the gory bit — called next tick so we're outside the read-only event. */
function harvest(player, target) {
  if (!target || !target.isValid) return;
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

/** The `of:butchers_knife` item component — light blood spray on any melee hit. */
export function butchersKnifeComponent() {
  return {
    onHitEntity(e) {
      const { hitEntity } = e;
      if (!hitEntity) return;
      safe(() =>
        hitEntity.dimension.spawnParticle(CONFIG.particles.blood, {
          x: hitEntity.location.x,
          y: hitEntity.location.y + 0.6,
          z: hitEntity.location.z,
        })
      );
    },
  };
}

/** Wire the interact-to-harvest behaviour. */
export function startButcherInteractions() {
  world.beforeEvents.playerInteractWithEntity.subscribe((e) => {
    const { player, target, itemStack } = e;
    if (!itemStack || itemStack.typeId !== KNIFE_ID) return;
    if (!isHarvestable(target)) return;

    // We are committing to a harvest — cancel any default interaction and do the
    // world mutations on the next tick (before-events are read-only).
    e.cancel = true;
    const capturedTarget = target;
    const capturedPlayer = player;
    system.run(() => harvest(capturedPlayer, capturedTarget));
  });
}
