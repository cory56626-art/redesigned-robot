// scripts/main.ts
import { Entity, ItemStack, Player, system, world } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
var NS = "com_organic_forgery_and_the_harvester_kse6cimp";
var ADAPTIVE_ARM_BLADE = `${NS}:adaptive_arm_blade`;
var FRACTURED_ARM_BLADE = `${NS}:fractured_arm_blade`;
var ADAPT_STANCES = ["severing", "sweeping", "kinetic"];
var ADAPT_STANCE_NAMES = { severing: "Severing Stance", sweeping: "Sweeping Scythe Stance", kinetic: "Kinetic Apex Stance" };
var ADAPTIVE_STANCE_COOLDOWN = { severing: 7, sweeping: 16, kinetic: 22 };
var adaptiveLeapWatch = /* @__PURE__ */ new Map();
function selectedStack(player) {
  return invContainer(player)?.getItem(player.selectedSlotIndex);
}
function heldAdaptive(player) {
  return selectedType(player) === ADAPTIVE_ARM_BLADE || offhandType(player) === ADAPTIVE_ARM_BLADE;
}
function heldFractured(player) {
  return selectedType(player) === FRACTURED_ARM_BLADE || offhandType(player) === FRACTURED_ARM_BLADE;
}
function adaptiveStance(stack, player) {
  const s = String(player?.getDynamicProperty("active_stance") ?? stack?.getDynamicProperty("active_stance") ?? "severing");
  return ADAPT_STANCES.includes(s) ? s : "severing";
}
function setAdaptiveStance(player, stack, stance) {
  stack.setDynamicProperty("active_stance", stance);
  player.setDynamicProperty("active_stance", stance);
  invContainer(player)?.setItem(player.selectedSlotIndex, stack);
  player.onScreenDisplay.setActionBar(`\xA7fAdaptive Arm-Blade: \xA7c${ADAPT_STANCE_NAMES[stance]}`);
  player.dimension.playSound("mob.skeleton.step", player.location, { volume: 0.9, pitch: stance === "kinetic" ? 0.55 : 0.9 });
}
function hostileForBlade(e, owner) {
  return (!owner || e.id !== owner.id) && !(e instanceof Player) && e.typeId !== "minecraft:item" && e.typeId !== "minecraft:xp_orb" && !e.hasTag(`${NS}_homunculus`) && !e.hasTag(`${NS}_player_ally`);
}
function addTrueDamage(victim, amount) {
  try {
    victim.applyDamage?.(amount, { cause: "magic" });
  } catch {
    victim.runCommand(`damage @s ${amount} magic`);
  }
}
function handleAdaptiveHit(player, victim, itemStack) {
  const stance = adaptiveStance(itemStack, player), target = victim.typeId;
  const previous = String(player.getDynamicProperty("adaptation_target") ?? "");
  let stacks = previous === target ? Number(player.getDynamicProperty("adaptation_stacks") ?? 0) : 0;
  if (previous !== target) player.setDynamicProperty("adaptation_target", target);
  stacks = Math.min(6, stacks + (stance === "severing" ? 2 : 1));
  player.setDynamicProperty("adaptation_stacks", stacks);
  if (stacks === 3 || stacks === 4) player.dimension.playSound(`${SOUND}.adapt_click`, victim.location, { volume: 1.5, pitch: 0.65 });
  if (stacks >= 6 && Number(player.getDynamicProperty("adaptation_complete_cue") ?? 0) !== system.currentTick) {
    player.setDynamicProperty("adaptation_complete_cue", system.currentTick);
    player.dimension.playSound(`${SOUND}.adapt_complete`, victim.location, { volume: 1.8, pitch: 0.8 });
    for (let i = 0; i < 14; i++) victim.dimension.spawnParticle(i % 2 ? "minecraft:redstone_wire_dust_particle" : "minecraft:critical_hit_emitter", { x: victim.location.x, y: victim.location.y + 1.4, z: victim.location.z });
  }
  const bonus = Math.round(12 * 0.35 * (stacks / 6));
  if (bonus > 0) addTrueDamage(victim, bonus);
  const pct = Math.round(35 * (stacks / 6));
  player.onScreenDisplay.setActionBar(`\xA7eWheel of Adaptation: \xA7f${target} \xA7c${stacks}/6 \xA78(+${pct}% dmg) \xA77${ADAPT_STANCE_NAMES[stance]}`);
}
function kineticShieldBreaker(player, victim) {
  const hasShield = !!(victim.getComponent?.("minecraft:shield") || victim.getComponent?.("minecraft:is_blocking"));
  victim.setDynamicProperty("adaptive_shield_broken_until", system.currentTick + 40);
  victim.runCommand("effect @s slowness 4 2 true");
  victim.runCommand("effect @s weakness 4 1 true");
  victim.runCommand("effect @s mining_fatigue 4 1 true");
  applySickly(victim, 120, 2);
  if (hasShield) victim.dimension.playSound("random.shield_break", victim.location, { volume: 1.1, pitch: 0.75 });
  victim.dimension.spawnParticle("minecraft:knockback_roar_particle", { x: victim.location.x, y: victim.location.y + 0.2, z: victim.location.z });
  const dx = victim.location.x - player.location.x, dz = victim.location.z - player.location.z, m = Math.max(0.1, Math.sqrt(dx * dx + dz * dz));
  if (!(victim instanceof Player)) victim.applyImpulse({ x: dx / m * 0.5, y: 1.35, z: dz / m * 0.5 });
}
world.afterEvents.entityHitEntity.subscribe((e) => {
  const p = e.damagingEntity;
  const victim = e.hitEntity;
  if (!(p instanceof Player) || !(victim instanceof Entity)) return;
  const stack = selectedStack(p);
  if (stack?.typeId !== ADAPTIVE_ARM_BLADE) return;
  const stance = adaptiveStance(stack, p);
  const now = system.currentTick, last = Number(p.getDynamicProperty("last_attack_time") ?? -99999), minTicks = ADAPTIVE_STANCE_COOLDOWN[stance] ?? 7;
  const recovering = now - last < minTicks;
  if (!recovering) p.setDynamicProperty("last_attack_time", now);
  system.run(() => {
    if (p.isValid && victim.isValid) handleAdaptiveHit(p, victim, stack);
  });
  if (recovering) {
    p.dimension.playSound("random.shield_block", p.location, { volume: 0.5, pitch: 0.65 });
    p.onScreenDisplay.setActionBar(`\xA77${ADAPT_STANCE_NAMES[stance]} recovering: \xA7c${Math.ceil((minTicks - (now - last)) / 20 * 10) / 10}s`);
    return;
  }
  const baseDamage = 12;
  if (stance === "severing") {
    system.run(() => {
      if (!victim.isValid) return;
      addTrueDamage(victim, Math.round(baseDamage * 0.25));
      victim.dimension.spawnParticle("minecraft:critical_hit_emitter", { x: victim.location.x, y: victim.location.y + 1, z: victim.location.z });
    });
  } else if (stance === "kinetic") {
    system.run(() => {
      if (victim.isValid) kineticShieldBreaker(p, victim);
    });
  } else if (stance === "sweeping") {
    system.run(() => {
      if (!p.isValid || !victim.isValid) return;
      const loc = victim.location;
      let extra = 0;
      for (const other of victim.dimension.getEntities({ location: loc, maxDistance: 3.5, excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) if (other.id !== p.id && other.id !== victim.id && hostileForBlade(other, p) && extra < 5) {
        extra++;
        other.runCommand(`damage @s ${Math.max(1, Math.floor(baseDamage * 0.8))} entity_attack`);
        const dx = other.location.x - p.location.x, dz = other.location.z - p.location.z, dm = Math.max(0.1, Math.sqrt(dx * dx + dz * dz));
        other.applyKnockback({ x: dx / dm, z: dz / dm }, 0.35);
        other.dimension.spawnParticle("minecraft:critical_hit_emitter", { x: other.location.x, y: other.location.y + 1, z: other.location.z });
      }
      p.onScreenDisplay.setActionBar(`\xA76Sweeping Scythe cleaves \xA7f${extra + 1}\xA76 target${extra ? "s" : ""}.`);
    });
  }
});
world.afterEvents.entityHitEntity.subscribe((e) => {
  const p = e.damagingEntity;
  if (!(p instanceof Player)) return;
  const stack = selectedStack(p);
  if (stack?.typeId === FRACTURED_ARM_BLADE && hostileForBlade(e.hitEntity, p)) {
    e.hitEntity.runCommand("effect @s weakness 2 0 true");
    addTrueDamage(e.hitEntity, 1);
  }
});
function startAdaptiveSlam(player) {
  if (!ready(player, "adaptive_leap_cd", 120) || adaptiveLeapWatch.has(player.id)) return;
  const d = view(player);
  player.applyImpulse({ x: d.x * 1.8, y: 0.85, z: d.z * 1.8 });
  player.dimension.playSound("mob.enderdragon.flap", player.location, { volume: 1.2, pitch: 1.6 });
  let airborne = false;
  const run = system.runInterval(() => {
    if (!player.isValid) {
      system.clearRun?.(run);
      adaptiveLeapWatch.delete(player.id);
      return;
    }
    if (!player.isOnGround) airborne = true;
    if (airborne && player.isOnGround) {
      const loc = player.location;
      player.dimension.spawnParticle("minecraft:knockback_roar_particle", loc);
      player.dimension.playSound("mob.warden.sonic_boom", loc, { volume: 1.2, pitch: 0.75 });
      for (const e of player.dimension.getEntities({ location: loc, maxDistance: 4.5, excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) if (hostileForBlade(e, player)) {
        const dx = e.location.x - loc.x, dz = e.location.z - loc.z, m = Math.max(0.1, Math.sqrt(dx * dx + dz * dz));
        e.runCommand("damage @s 12 entity_attack");
        e.applyImpulse({ x: dx / m * 0.8, y: 0.85, z: dz / m * 0.8 });
      }
      system.clearRun?.(run);
      adaptiveLeapWatch.delete(player.id);
    }
  }, 1);
  adaptiveLeapWatch.set(player.id, run);
}
world.beforeEvents.itemUse?.subscribe((e) => {
  const p = e.source;
  if (!(p instanceof Player) || e.itemStack?.typeId !== ADAPTIVE_ARM_BLADE || !p.isSneaking) return;
  e.cancel = true;
  system.run(() => {
    const st = selectedStack(p);
    if (st?.typeId === ADAPTIVE_ARM_BLADE) setAdaptiveStance(p, st, ADAPT_STANCES[(ADAPT_STANCES.indexOf(adaptiveStance(st, p)) + 1) % ADAPT_STANCES.length]);
  });
});
world.afterEvents.itemUse.subscribe((e) => {
  const p = e.source;
  if (!(p instanceof Player)) return;
  if (e.itemStack?.typeId === ADAPTIVE_ARM_BLADE) {
    if (!p.isSneaking) startAdaptiveSlam(p);
  } else if (e.itemStack?.typeId === FRACTURED_ARM_BLADE) {
    p.setDynamicProperty("fractured_bulwark_until", system.currentTick + 40);
    p.dimension.playSound("beacon.activate", p.location, { volume: 0.45, pitch: 0.55 });
    p.onScreenDisplay.setActionBar("\xA7fCalcified Bulwark Aura protects nearby allies.");
  }
});
world.afterEvents.entityHurt.subscribe((e) => {
  const p = e.hurtEntity;
  if (!(p instanceof Player) || !heldAdaptive(p) || p.getDynamicProperty("adaptive_fractured_used")) return;
  const h = p.getComponent("minecraft:health");
  const current = Number(h?.currentValue ?? 20);
  if (current > 6) return;
  p.setDynamicProperty("adaptive_fractured_used", 1);
  try {
    h?.setCurrentValue?.(Number(h?.effectiveMax ?? h?.defaultValue ?? 20));
  } catch {
  }
  p.runCommand("effect @s resistance 8 3 true");
  p.runCommand("effect @s regeneration 8 2 true");
  p.runCommand("effect @s instant_health 1 10 true");
  p.runCommand("effect @s absorption 12 2 true");
  p.runCommand("effect @s fire_resistance 8 0 true");
  p.dimension.playSound(`${SOUND}.fracture_revive`, p.location, { volume: 2, pitch: 0.55 });
  for (let i = 0; i < 40; i++) p.dimension.spawnParticle(i % 2 ? "minecraft:redstone_wire_dust_particle" : "minecraft:critical_hit_emitter", { x: p.location.x + (Math.random() - 0.5) * 1.6, y: p.location.y + Math.random() * 1.9, z: p.location.z + (Math.random() - 0.5) * 1.6 });
  for (const en of p.dimension.getEntities({ location: p.location, maxDistance: 4.5, excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) if (hostileForBlade(en, p)) {
    const dx = en.location.x - p.location.x, dz = en.location.z - p.location.z, m = Math.max(0.1, Math.sqrt(dx * dx + dz * dz));
    en.applyImpulse({ x: dx / m, y: 0.5, z: dz / m });
    en.runCommand("effect @s slowness 3 1 true");
  }
  const c = invContainer(p), sel = selectedStack(p);
  if (sel?.typeId === ADAPTIVE_ARM_BLADE) c?.setItem(p.selectedSlotIndex, new ItemStack(FRACTURED_ARM_BLADE, 1));
  else {
    p.runCommand(`clear @s ${ADAPTIVE_ARM_BLADE} 0 1`);
    p.runCommand(`give @s ${FRACTURED_ARM_BLADE} 1`);
  }
  p.onScreenDisplay.setActionBar("\xA74\xA7lDEATH-DEFYING FRACTURE\xA7r \xA7c— the blade shatters to save you.");
});
system.runInterval(() => {
  for (const p of world.getPlayers()) if (heldFractured(p) || Number(p.getDynamicProperty("fractured_bulwark_until") ?? 0) > system.currentTick) {
    for (const ally of p.dimension.getEntities({ location: p.location, maxDistance: 5, excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) if (ally.hasTag(`${NS}_player_ally`) || ally.typeId === CREMATION_ALLY) ally.runCommand("effect @s regeneration 2 1 true");
    for (const proj of p.dimension.getEntities({ location: p.location, maxDistance: 5, excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) if (["minecraft:arrow", "minecraft:snowball", "minecraft:egg", "minecraft:trident", "minecraft:wither_skull", BONE_SHARD_PROJECTILE, HARPOON_PROJECTILE].includes(proj.typeId) && Math.random() < 0.3) {
      proj.dimension.spawnParticle("minecraft:critical_hit_emitter", proj.location);
      proj.remove();
    }
  }
}, 10);
var SPINE_SHOT_CROSSBOW = `${NS}:spine_shot_crossbow`;
var TENDON_DAGGER = `${NS}:tendon_dagger`;
var SPLINTERED_HOUND = `${NS}:splintered_hound`;
var BLOATED_AMALGAM = `${NS}:bloated_amalgam`;
var CHITIN = { head: `${NS}:chitin_helm`, chest: `${NS}:chitin_carapace`, legs: `${NS}:chitin_leggings`, feet: `${NS}:chitin_boots` };
var MEAT = { head: `${NS}:meat_sack_hood`, chest: `${NS}:meat_sack_torso`, legs: `${NS}:meat_sack_leggings`, feet: `${NS}:meat_sack_boots` };
var SOUND = "com.organic_forgery_and_the_harvester_kse6cimp";
var RAW_CARCASS = `${NS}:raw_carcass`;
var HOMUNCULUS_WARD = `${NS}:homunculus_ward`;
var HOMUNCULUS_BASE = `${NS}:homunculus_base`;
var HOMUNCULUS_VENOM = `${NS}:homunculus_venom`;
var HOMUNCULUS_MORTAR = `${NS}:homunculus_mortar`;
var HOMUNCULUS_BULWARK = `${NS}:homunculus_bulwark`;
var NECROTIC_ICHOR = `${NS}:necrotic_ichor`;
var CRYSTALLINE_MARROW = `${NS}:crystalline_marrow`;
var LIVING_BLADE = `${NS}:living_bone_blade`;
var MARROW_BLADE = `${NS}:marrow_blade`;
var FLAIL = `${NS}:vertebrae_flail`;
var SPITTER = `${NS}:bile_spitter`;
var ANCHOR = `${NS}:flesh_anchor`;
var GLAND = `${NS}:adrenaline_gland`;
var WAND = `${NS}:cremation_wand`;
var CHIMERA_SHIELD = `${NS}_chimera:shield`;
var CREMATION_ALLY = `${NS}:cremation_ally`;
var DEVOURER = `${NS}:removed_devourer`;
var PARASITIC_PICKAXE = `${NS}:parasitic_pickaxe`;
var RIB_CRACKER = `${NS}:rib_cracker`;
var PURE_HEART = `${NS}:pure_necrotic_heart`;
var APEX_SPINE = `${NS}:apex_spine`;
var JOURNAL = `${NS}:anatomists_journal`;
var FLESH_SHIELD = `${NS}:flesh_shield`;
var BIOMASS_HIVE = `${NS}:biomass_hive`;
var SPINE_HARPOON = `${NS}:spine_harpoon`;
var SINEW_SPOOL = `${NS}:sinew_spool`;
var BILE_GLOB = `${NS}:bile_glob`;
var ACID_DART = `${NS}:acid_dart`;
var HARPOON_PROJECTILE = `${NS}:harpoon_projectile`;
var NECROTIC_SHARD = `${NS}:necrotic_shard`;
var BONE_SHARD_PROJECTILE = `${NS}:bone_shard_projectile`;
var BONE_SHARD_AMMO = `${NS}:bone_shard`;
var ROT_BLOCK = `${NS}:rot_block`;
var FLESH_MOSS = `${NS}:flesh_moss`;
var SPINE_BARRICADE = `${NS}:spine_barricade`;
var PHEROMONE_VENT = `${NS}:pheromone_vent`;
var GRAFTED_STALKER = `${NS}:grafted_stalker`;
var MARROW_GHAST = `${NS}:marrow_ghast`;
var ARMOR = { head: `${NS}:ocular_crown`, chest: `${NS}:ribcage_carapace`, legs: `${NS}:sinew_greaves`, feet: `${NS}:marrow_treads` };
var FARM_MOBS = /* @__PURE__ */ new Set(["minecraft:pig", "minecraft:horse", "minecraft:cow", "minecraft:chicken", "minecraft:sheep", "minecraft:turtle"]);
var RAW_MEATS = /* @__PURE__ */ new Set(["minecraft:beef", "minecraft:porkchop", "minecraft:chicken", "minecraft:mutton", "minecraft:rabbit", "minecraft:cod", "minecraft:salmon", "minecraft:tropical_fish"]);
var SPITTER_AMMO = ["minecraft:rotten_flesh", RAW_CARCASS, "minecraft:spider_eye"];
var HARVEST_THRESHOLD_RATIO = 0.3;
var COOLDOWN = { flail: 80, spitter: 10, anchor: 100, gland: 400, shield: 600, devourer: 6e3 };
var WELLNESS_ITEMS = /* @__PURE__ */ new Set([ARMOR.head, ARMOR.chest, ARMOR.legs, ARMOR.feet]);
function fullSet(p, set) {
  return armor(p, "Head") === set.head && armor(p, "Chest") === set.chest && armor(p, "Legs") === set.legs && armor(p, "Feet") === set.feet;
}
var FLESH_ITEMS = /* @__PURE__ */ new Set([LIVING_BLADE, MARROW_BLADE, FLAIL, SPITTER, ANCHOR, GLAND, WAND, CHIMERA_SHIELD, PARASITIC_PICKAXE, RIB_CRACKER, ARMOR.head, ARMOR.chest, ARMOR.legs, ARMOR.feet]);
function getPlacementFunctionName(cardinalDirection) {
  switch (cardinalDirection) {
    case "west":
    case "north":
    case "east":
      return `harvester_${cardinalDirection}`;
    default:
      return "harvester_south";
  }
}
var harvesterPlaceComponent = { onPlace(event) {
  const { block } = event;
  const { x, y, z } = block.location;
  const fn = getPlacementFunctionName(block.permutation.getState("minecraft:cardinal_direction"));
  block.dimension.runCommand(`execute positioned ${x} ${y} ${z} run function com/organic_forgery_and_the_harvester_kse6cimp/${fn}`);
} };
function getHealthRatio(entity) {
  const h = entity.getComponent("minecraft:health");
  if (!h) return 1;
  const current = h.currentValue ?? h.value ?? h.defaultValue ?? 1;
  const max = h.effectiveMax ?? h.max ?? h.defaultValue ?? current;
  return current / Math.max(1, max);
}
function getHealthMax(entity) {
  const h = entity.getComponent("minecraft:health");
  return Math.max(1, h?.effectiveMax ?? h?.max ?? h?.defaultValue ?? 10);
}
function selectedType(player) {
  const inv = player.getComponent("minecraft:inventory");
  return inv?.container?.getItem(player.selectedSlotIndex)?.typeId;
}
function hasEmptyMainHand(player) {
  return selectedType(player) === void 0;
}
function clearOne(player, itemId) {
  player.runCommand(`clear @s ${itemId} 0 1`);
}
function hasAndClearFuel(player) {
  const inv = player.getComponent("minecraft:inventory");
  const c = inv?.container;
  if (!c) return false;
  for (let i = 0; i < c.size; i++) {
    const id = c.getItem(i)?.typeId;
    if (id === "minecraft:coal" || id === "minecraft:charcoal") {
      clearOne(player, id);
      return true;
    }
  }
  return false;
}
function catalystSlot(player) {
  const inv = player.getComponent("minecraft:inventory");
  return inv?.container?.getItem(1)?.typeId;
}
function setWellness(player, value) {
  player.setDynamicProperty("organic_wellness", Math.max(0, Math.min(100, value)));
}
function getWellness(player) {
  return Number(player.getDynamicProperty("organic_wellness") ?? 85);
}
function rotTier(wellness) {
  if (wellness >= 67) return "Fresh";
  if (wellness >= 34) return "Fermented";
  return "Putrid";
}
function addWellness(player, amount) {
  setWellness(player, getWellness(player) + amount);
}
function ready(player, key, ticks) {
  const now = system.currentTick, last = Number(player.getDynamicProperty(key) ?? -99999);
  if (now - last < ticks) {
    player.onScreenDisplay.setActionBar(`\xA77Cooldown: \xA7c${Math.ceil((ticks - (now - last)) / 20)}s \xA78${cooldownBar(now - last, ticks)}`);
    return false;
  }
  player.setDynamicProperty(key, now);
  return true;
}
function cooldownLeft(player, key, ticks) {
  return Math.max(0, ticks - (system.currentTick - Number(player.getDynamicProperty(key) ?? -99999)));
}
function cooldownBar(elapsed, total) {
  const filled = Math.max(0, Math.min(10, Math.floor(elapsed / total * 10)));
  return `\xA7a${"|".repeat(filled)}\xA78${"|".repeat(10 - filled)}`;
}
function hudBar(frac, cf = "\xA7a", ce = "\xA78") {
  const n = Math.max(0, Math.min(10, Math.round(frac * 10)));
  return `${cf}${"█".repeat(n)}${ce}${"█".repeat(10 - n)}`;
}
function offhandType(player) {
  const eq = player.getComponent("minecraft:equippable");
  return eq?.getEquipment("Offhand")?.typeId;
}
function isHoldingChimeraShield(player) {
  return selectedType(player) === CHIMERA_SHIELD || offhandType(player) === CHIMERA_SHIELD;
}
function isChimeraShieldEquipped(player) {
  return offhandType(player) === CHIMERA_SHIELD;
}
function findNearbyHarvester(player) {
  const base = player.location;
  for (let y = -2; y <= 2; y++) for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) {
    const loc = { x: Math.floor(base.x) + x, y: Math.floor(base.y) + y, z: Math.floor(base.z) + z };
    try {
      const id = player.dimension.getBlock(loc)?.typeId;
      if (id?.startsWith(`${NS}:harvester`)) return { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 };
    } catch {
    }
  }
  return player.location;
}
function playHarvesterGrinding(player) {
  const loc = findNearbyHarvester(player);
  for (let i = 0; i < 10; i++) system.runTimeout(() => {
    if (!player.isValid) return;
    player.dimension.spawnParticle("minecraft:basic_smoke_particle", loc);
    player.dimension.spawnParticle("minecraft:redstone_wire_dust_particle", loc);
    player.dimension.playSound("block.grindstone.use", loc, { pitch: 0.45 + i * 0.03, volume: 0.8 });
  }, i * 20);
}
function chumKey(loc, dim = "overworld") {
  return `${dim}:${Math.floor(loc.x / 16)}:${Math.floor(loc.z / 16)}`;
}
function addChum(loc, dimId = "overworld", amount = 1) {
  const key = `custom:chum_score:${chumKey(loc, dimId)}`;
  const next = Number(world.getDynamicProperty(key) ?? 0) + amount;
  world.setDynamicProperty(key, next);
  world.setDynamicProperty("custom:last_chum_key", key);
  world.setDynamicProperty("chum_score", Number(world.getDynamicProperty("chum_score") ?? 0) + amount);
}
system.runInterval(() => {
  for (const dimName of ["overworld", "nether", "the_end"]) {
    const dim = world.getDimension(dimName);
    for (const p of world.getPlayers().filter((pl) => pl.dimension.id.endsWith(dimName))) {
      const h = findNearbyHarvester(p), key = `custom:chum_score:${chumKey(h, p.dimension.id)}`, score = Number(world.getDynamicProperty(key) ?? 0);
      if (score > 0 && Math.random() < Math.min(0.9, 0.15 + score / 80)) {
        const loc = { x: Math.floor(h.x + (Math.random() * 32 - 16)), y: Math.floor(h.y - 2 + Math.random() * 7), z: Math.floor(h.z + (Math.random() * 32 - 16)) };
        const b = dim.getBlock(loc);
        if (b && ["minecraft:grass_block", "minecraft:dirt", "minecraft:coarse_dirt", "minecraft:podzol", "minecraft:moss_block", "minecraft:mycelium"].includes(b.typeId)) {
          b.setType(FLESH_MOSS);
          dim.spawnParticle("minecraft:mobspell_emitter", { x: loc.x + 0.5, y: loc.y + 1, z: loc.z + 0.5 });
        } else if (b && (b.typeId.includes("_log") || b.typeId.includes("_wood"))) b.setType(`${NS}:calcified_bone_block`);
        else if (b && score >= 40 && ["minecraft:stone", "minecraft:cobblestone", "minecraft:deepslate", "minecraft:tuff"].includes(b.typeId)) b.setType(ROT_BLOCK);
      }
      if (score >= 70 && Math.random() < 0.02) {
        dim.spawnEntity(GRAFTED_STALKER, { x: h.x - 8, y: h.y + 1, z: h.z });
        world.setDynamicProperty(key, score - 25);
      }
    }
    for (const e of dim.getEntities({ excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) {
      const b = dim.getBlock({ x: Math.floor(e.location.x), y: Math.floor(e.location.y), z: Math.floor(e.location.z) });
      if (b?.typeId === SPINE_BARRICADE && !(e instanceof Player) && !e.hasTag(`${NS}_homunculus`) && !e.hasTag(`${NS}_player_ally`)) e.runCommand("damage @s 3 thorns");
    }
  }
}, 40);
system.runInterval(() => {
  for (const p of world.getPlayers()) {
    const noisy = p.isSprinting || p.isJumping || Number(p.getDynamicProperty("organic_noise_until") ?? 0) > system.currentTick;
    if (noisy) for (const s of p.dimension.getEntities({ type: GRAFTED_STALKER, location: p.location, maxDistance: 32 })) {
      s.runCommand("effect @s speed 4 1 true");
      s.setDynamicProperty("organic_noise_x", p.location.x);
      s.setDynamicProperty("organic_noise_y", p.location.y);
      s.setDynamicProperty("organic_noise_z", p.location.z);
    }
    if (fullAnatomicalSet(p)) {
      const tier = rotTier(getWellness(p));
      if (tier === "Fermented") {
        p.runCommand("effect @s resistance 2 0 true");
        if (p.isInWater) p.applyImpulse({ x: 0, y: -0.18, z: 0 });
      }
      if (tier === "Putrid") {
        p.addTag(`${NS}_undead_excluded`);
        if (getHealthRatio(p) < 0.3 && Number(p.getDynamicProperty("organic_putrid_veil") ?? 0) < system.currentTick) {
          p.setDynamicProperty("organic_putrid_veil", system.currentTick + 100);
          p.runCommand("effect @s invisibility 4 0 true");
          for (let i = 0; i < 8; i++) p.dimension.spawnParticle("minecraft:mobspell_emitter", p.location);
        }
      } else p.removeTag(`${NS}_undead_excluded`);
    } else p.removeTag(`${NS}_undead_excluded`);
    const until = Number(p.getDynamicProperty("organic_pheromone_until") ?? 0);
    if (until > system.currentTick) {
      const loc = { x: Number(p.getDynamicProperty("organic_pheromone_x")), y: Number(p.getDynamicProperty("organic_pheromone_y")), z: Number(p.getDynamicProperty("organic_pheromone_z")) };
      p.dimension.spawnParticle("minecraft:mobspell_emitter", loc);
      for (const m of p.dimension.getEntities({ location: loc, maxDistance: 24, excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) if (!(m instanceof Player) && !m.hasTag(`${NS}_homunculus`)) m.applyImpulse({ x: Math.max(-0.2, Math.min(0.2, loc.x - m.location.x)), y: 0, z: Math.max(-0.2, Math.min(0.2, loc.z - m.location.z)) });
    }
  }
}, 20);
system.runInterval(() => {
  for (const dimName of ["overworld", "nether", "the_end"]) {
    const dim = world.getDimension(dimName);
    for (const e of dim.getEntities({ excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) {
      const sickUntil = Number(e.getDynamicProperty("sickly_expires") ?? e.getDynamicProperty("organic_sickly_until") ?? 0);
      if (sickUntil > system.currentTick && system.currentTick % 10 === 0) e.dimension.spawnParticle("minecraft:mobspell_emitter", { x: e.location.x, y: e.location.y + 0.8, z: e.location.z });
      else if (sickUntil && sickUntil <= system.currentTick) {
        e.setDynamicProperty("sickly_tier", 0);
        e.setDynamicProperty("sickly_expires", 0);
      }
      const bleed = Number(e.getDynamicProperty("bleed_ticks") ?? 0);
      if (bleed > 0 && Number(e.getDynamicProperty("organic_bleed_next") ?? 0) <= system.currentTick) {
        e.setDynamicProperty("bleed_ticks", Math.max(0, bleed - 20));
        e.setDynamicProperty("organic_bleed_next", system.currentTick + 20);
        e.dimension.playSound(`${SOUND}.bleed_slice`, e.location, { volume: 0.45, pitch: 1.3 });
        e.dimension.spawnParticle("minecraft:redstone_wire_dust_particle", { x: e.location.x, y: e.location.y + 0.6, z: e.location.z });
        e.runCommand("damage @s 2 entity_attack");
      }
      const under = dim.getBlock({ x: Math.floor(e.location.x), y: Math.floor(e.location.y - 0.05), z: Math.floor(e.location.z) });
      if (under?.typeId === ROT_BLOCK && !(e instanceof Player) && !e.hasTag(`${NS}_homunculus`) && !e.hasTag(`${NS}_player_ally`)) applySickly(e, 200, 1);
      if (e.typeId === CREMATION_ALLY) {
        if (system.currentTick - Number(e.getDynamicProperty("organic_birth") ?? system.currentTick) >= 2400) {
          e.dimension.spawnParticle("minecraft:large_smoke", e.location);
          e.remove();
          continue;
        }
        const ox = Number(e.getDynamicProperty("organic_order_x") ?? NaN), oy = Number(e.getDynamicProperty("organic_order_y") ?? NaN), oz = Number(e.getDynamicProperty("organic_order_z") ?? NaN);
        if (!Number.isNaN(ox)) e.applyImpulse({ x: Math.max(-0.18, Math.min(0.18, ox - e.location.x)), y: 0, z: Math.max(-0.18, Math.min(0.18, oz - e.location.z)) });
      }
    }
  }
}, 10);
var processCarcassComponent = { onUse(event) {
  const player = event.source;
  if (!(player instanceof Player)) return;
  const catalyst = catalystSlot(player);
  if (!hasAndClearFuel(player)) {
    player.sendMessage("\xA74The Harvester needs coal or charcoal fuel.");
    return;
  }
  clearOne(player, RAW_CARCASS);
  if (catalyst === "minecraft:fermented_spider_eye" || catalyst === "minecraft:amethyst_shard") clearOne(player, catalyst);
  const harvesterLoc = findNearbyHarvester(player);
  addChum(harvesterLoc, player.dimension.id, catalyst ? 3 : 2);
  playHarvesterGrinding(player);
  player.sendMessage("\xA77The Harvester grinds for 10 seconds... \xA74Chum builds under the soil.");
  system.runTimeout(() => {
    if (!player.isValid) return;
    if (catalyst === "minecraft:fermented_spider_eye") player.runCommand(`give @s ${NECROTIC_ICHOR} 2`);
    else if (catalyst === "minecraft:amethyst_shard") player.runCommand(`give @s ${CRYSTALLINE_MARROW} 2`);
    else {
      player.runCommand(`give @s ${NS}:sinew 2`);
      player.runCommand(`give @s ${NS}:dense_bone 1`);
    }
    player.runCommand(`give @s ${NS}:marrow 1`);
    player.runCommand(`give @s ${NS}:cured_hide 1`);
    player.dimension.spawnParticle("minecraft:large_explosion", harvesterLoc);
    player.dimension.playSound("mob.slime.attack", player.location, { pitch: 0.6, volume: 1 });
  }, 200);
} };
var pheromoneVentComponent = { onPlayerInteract(e) {
  const p = e.player;
  if (!p) return;
  if (selectedType(p) !== RAW_CARCASS) {
    p.sendMessage("\xA77Feed the vent a Raw Carcass to taunt nearby monsters.");
    return;
  }
  clearOne(p, RAW_CARCASS);
  const until = system.currentTick + 20 * 90;
  p.setDynamicProperty("organic_pheromone_until", until);
  p.setDynamicProperty("organic_pheromone_x", e.block.location.x + 0.5);
  p.setDynamicProperty("organic_pheromone_y", e.block.location.y + 0.5);
  p.setDynamicProperty("organic_pheromone_z", e.block.location.z + 0.5);
  p.dimension.playSound("mob.slime.attack", e.block.location, { volume: 1.2, pitch: 0.45 });
} };
var feedGearComponent = { onUse(event) {
  const player = event.source;
  if (!(player instanceof Player)) return;
  const inv = player.getComponent("minecraft:inventory");
  const c = inv?.container;
  if (!c) return;
  for (let i = 0; i < c.size; i++) {
    const meat = c.getItem(i)?.typeId;
    if (meat && RAW_MEATS.has(meat)) {
      clearOne(player, meat);
      addWellness(player, 10);
      player.sendMessage(`\xA7cYour living gear consumes raw meat. Wellness ${Math.floor(getWellness(player))} (${rotTier(getWellness(player))}).`);
      return;
    }
  }
  player.sendMessage("\xA77Your living blade needs raw meat, or blood earned by attacking and killing enemies.");
} };
function view(player) {
  return player.getViewDirection();
}
function armor(player, slot) {
  const e = player.getComponent("minecraft:equippable");
  return e?.getEquipment(slot)?.typeId;
}
function fullAnatomicalSet(player) {
  return armor(player, "Head") === ARMOR.head && armor(player, "Chest") === ARMOR.chest && armor(player, "Legs") === ARMOR.legs && armor(player, "Feet") === ARMOR.feet;
}
function applySickly(entity, ticks = 100, tier = 1) {
  if (entity.typeId === CREMATION_ALLY || entity.typeId === "minecraft:wolf") return;
  entity.setDynamicProperty("sickly_tier", tier);
  entity.setDynamicProperty("sickly_expires", system.currentTick + ticks);
  entity.setDynamicProperty("organic_sickly_until", system.currentTick + ticks);
  entity.runCommand("effect @s weakness 5 0 true");
}
function applyBleed(entity) {
  entity.setDynamicProperty("bleed_ticks", 60);
  entity.setDynamicProperty("organic_bleed_next", system.currentTick + 20);
}
function rotArea(player, center = player.location, radius = 4) {
  for (let x = -radius; x <= radius; x++) for (let y = -radius; y <= radius; y++) for (let z = -radius; z <= radius; z++) {
    if (Math.random() > 0.38 || x * x + y * y + z * z > radius * radius + 3) continue;
    const loc = { x: Math.floor(center.x) + x, y: Math.floor(center.y) + y, z: Math.floor(center.z) + z };
    try {
      const b = player.dimension.getBlock(loc);
      if (b && !["minecraft:air", "minecraft:water", "minecraft:lava", ROT_BLOCK].includes(b.typeId)) b.setType(ROT_BLOCK);
    } catch {
    }
  }
}
function summonCremationAlly(player) {
  const d = view(player), loc = { x: player.location.x + d.x * 2, y: player.location.y, z: player.location.z + d.z * 2 };
  const mob = player.dimension.spawnEntity(CREMATION_ALLY, loc);
  mob.addTag(`${NS}_player_ally`);
  mob.setDynamicProperty("organic_owner", player.name);
  mob.setDynamicProperty("organic_birth", system.currentTick);
  mob.setDynamicProperty("organic_combo", 0);
  mob.dimension.playSound(`${SOUND}.cremation_ally_scream`, loc, { volume: 2, pitch: 0.7 });
  for (const e of mob.dimension.getEntities({ location: loc, maxDistance: 8, excludeTypes: ["minecraft:item", "minecraft:xp_orb", CREMATION_ALLY] })) if (!(e instanceof Player) && !e.hasTag(`${NS}_homunculus`) && !e.hasTag(`${NS}_player_ally`)) {
    e.setDynamicProperty("stun_expires", system.currentTick + 40);
    e.runCommand("effect @s slowness 2 255 true");
    e.runCommand("effect @s weakness 2 255 true");
  }
  player.onScreenDisplay.setActionBar("\xA75The Cremation Ally screams into being.");
  return true;
}
function countItem(player, itemId) {
  const inv = player.getComponent("minecraft:inventory");
  const c = inv?.container;
  let n = 0;
  if (!c) return 0;
  for (let i = 0; i < c.size; i++) {
    const it = c.getItem(i);
    if (it?.typeId === itemId) n += it.amount ?? 1;
  }
  return n;
}
function consumeOneFromInventory(player, itemIds) {
  const c = invContainer(player);
  if (!c) return void 0;
  for (let i = 0; i < c.size; i++) {
    const it = c.getItem(i);
    if (!it || !itemIds.includes(it.typeId)) continue;
    const used = it.typeId;
    if ((it.amount ?? 1) <= 1) c.setItem(i, void 0);
    else {
      it.amount = (it.amount ?? 1) - 1;
      c.setItem(i, it);
    }
    return used;
  }
  return void 0;
}
function hasItem(player, itemId) {
  return countItem(player, itemId) > 0;
}
function spitterLoaded(player) {
  return Number(player.getDynamicProperty("organic_spitter_chamber") ?? 0);
}
function spitterAmmo(player) {
  const v = String(player.getDynamicProperty("organic_spitter_ammo") ?? "");
  return SPITTER_AMMO.includes(v) ? v : void 0;
}
function loadSpitter(player) {
  for (const id of SPITTER_AMMO) if (countItem(player, id) > 0) {
    clearOne(player, id);
    player.setDynamicProperty("organic_spitter_ammo", id);
    player.setDynamicProperty("organic_spitter_chamber", 5);
    player.dimension.playSound("block.grindstone.use", player.location, { volume: 1, pitch: 0.55 });
    player.onScreenDisplay.setActionBar(`\xA7aBile-Spitter chambered 5 ${id === RAW_CARCASS ? "Shrapnel Blasts" : id === "minecraft:spider_eye" ? "Sickly Darts" : "Toxic Globs"}.`);
    return true;
  }
  return false;
}
function takeLoadedAmmo(player) {
  const n = spitterLoaded(player), ammo = spitterAmmo(player);
  if (n <= 0 || !ammo) return void 0;
  player.setDynamicProperty("organic_spitter_chamber", n - 1);
  return ammo;
}
function rayMob(player, range) {
  const hits = player.getEntitiesFromViewDirection?.({ maxDistance: range, excludeTypes: ["minecraft:item", "minecraft:xp_orb"] });
  return hits?.find((h) => h.entity.id !== player.id)?.entity;
}
var spineShotLoops = /* @__PURE__ */ new Map();
function stopSpineShot(playerId) {
  const run = spineShotLoops.get(playerId);
  if (run !== void 0) system.clearRun?.(run);
  spineShotLoops.delete(playerId);
}
function damageSelectedItem(player) {
  const c = invContainer(player), st = selectedStack(player);
  if (!c || !st) return true;
  const dur = st.getComponent?.("minecraft:durability");
  if (!dur) return true;
  const max = Number(dur.maxDurability ?? dur.max_durability ?? 465), used = Number(dur.damage ?? 0) + 1;
  dur.damage = used;
  if (used >= max) {
    c.setItem(player.selectedSlotIndex, void 0);
    player.dimension.playSound("random.break", player.location, { volume: 1, pitch: 0.8 });
    return false;
  }
  c.setItem(player.selectedSlotIndex, st);
  return true;
}
function fireSpineShot(player) {
  if (!player.isValid || selectedType(player) !== SPINE_SHOT_CROSSBOW) return false;
  const ammo = consumeOneFromInventory(player, [BONE_SHARD_AMMO]);
  if (!ammo) {
    player.dimension.playSound("random.click", player.location, { volume: 0.8, pitch: 0.55 });
    player.onScreenDisplay.setActionBar("\xA78Spine-Shot dry-clicks: no bone shards.");
    return false;
  }
  if (!damageSelectedItem(player)) return false;
  const dir = view(player), head = player.getHeadLocation();
  const loc = { x: head.x + dir.x, y: head.y + dir.y, z: head.z + dir.z };
  const projectile = player.dimension.spawnEntity(BONE_SHARD_PROJECTILE, loc);
  projectile.addTag(`${NS}_bone_shard_projectile`);
  projectile.setDynamicProperty("organic_owner_id", player.id);
  projectile.applyImpulse({ x: dir.x * 3, y: dir.y * 3, z: dir.z * 3 });
  player.dimension.playSound(`${SOUND}.harvester.crunch`, player.location, { volume: 0.9, pitch: 1.25 });
  player.dimension.playSound("random.bow", player.location, { volume: 0.7, pitch: 1.45 });
  player.onScreenDisplay.setActionBar("\xA7fSpine-Shot: \xA7cbone shard fired");
  return true;
}
function startSpineShot(player) {
  if (spineShotLoops.has(player.id)) return;
  if (!fireSpineShot(player)) return;
  const id = system.runInterval(() => {
    if (!fireSpineShot(player)) stopSpineShot(player.id);
  }, 4);
  spineShotLoops.set(player.id, id);
}
world.afterEvents.itemUse.subscribe((e) => {
  const p = e.source;
  if (p instanceof Player && e.itemStack?.typeId === SPINE_SHOT_CROSSBOW) startSpineShot(p);
});
world.afterEvents.itemReleaseAfterUse?.subscribe((e) => {
  const p = e.source;
  if (p instanceof Player && e.itemStack?.typeId === SPINE_SHOT_CROSSBOW) stopSpineShot(p.id);
});
world.afterEvents.projectileHitEntity.subscribe((e) => {
  const projectile = e.projectile;
  if (!projectile || projectile.typeId !== BONE_SHARD_PROJECTILE) return;
  const victim = e.getEntityHit?.()?.entity ?? e.hitEntity ?? e.entityHit?.entity;
  if (!victim || victim instanceof Player) return;
  const hasSickly = Boolean(victim.getEffect?.(`${NS}:sickly`) ?? victim.getEffect?.("custom:sickly")) || Number(victim.getDynamicProperty("sickly_expires") ?? victim.getDynamicProperty("organic_sickly_until") ?? 0) > system.currentTick;
  if (!hasSickly) return;
  victim.runCommand("damage @s 8 magic");
  victim.setDynamicProperty("sickly_expires", 0);
  victim.setDynamicProperty("organic_sickly_until", 0);
  for (let i = 0; i < 10; i++) victim.dimension.spawnParticle("minecraft:redstone_wire_dust_particle", { x: victim.location.x, y: victim.location.y + 0.6, z: victim.location.z });
  victim.dimension.playSound("mob.zombie.hurt", victim.location, { volume: 1.3, pitch: 0.55 });
});
function coneShrapnel(player) {
  const dir = view(player), origin = player.getHeadLocation();
  let hits = 0;
  for (const ent of player.dimension.getEntities({ location: player.location, maxDistance: 6, excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) {
    if (ent.id === player.id || ent instanceof Player || ent.hasTag(`${NS}_player_ally`) || ent.hasTag(`${NS}_homunculus`)) continue;
    const vx = ent.location.x - origin.x, vy = ent.location.y + 0.8 - origin.y, vz = ent.location.z - origin.z, mag = Math.max(1e-3, Math.sqrt(vx * vx + vy * vy + vz * vz));
    const dot = (dir.x * vx + dir.y * vy + dir.z * vz) / mag;
    if (dot <= 0.7) continue;
    hits++;
    ent.runCommand("damage @s 7 projectile");
    applySickly(ent, 80, 1);
    const h = Math.max(0.1, Math.sqrt(vx * vx + vz * vz));
    ent.applyKnockback({ x: vx / h, z: vz / h }, 0.35);
    ent.dimension.spawnParticle("minecraft:critical_hit_emitter", { x: ent.location.x, y: ent.location.y + 0.8, z: ent.location.z });
  }
  player.dimension.playSound(`${SOUND}.bile_spitter_fire`, player.location, { volume: 1, pitch: 0.85 });
  player.onScreenDisplay.setActionBar(`\xA7aBile-Spitter shrapnel cone hit ${hits} target${hits === 1 ? "" : "s"}.`);
}
function triggerSafeAdrenalineBlast(player) {
  const d = view(player);
  player.dimension.playSound(`${SOUND}.adrenaline_squeeze`, player.location, { volume: 1.2, pitch: 0.65 });
  player.onScreenDisplay.setActionBar("\xA7cAdrenaline gland swelling: \xA7f3 seconds\xA7c...");
  player.setDynamicProperty("organic_gland_swell_start", system.currentTick);
  system.runTimeout(() => {
    if (!player.isValid) return;
    player.setDynamicProperty("organic_gland_swell_start", 0);
    player.runCommand("effect @s speed 15 1 true");
    player.runCommand("effect @s strength 15 1 true");
    player.runCommand("effect @s jump_boost 15 1 true");
    player.runCommand("effect @s resistance 15 0 true");
    player.runCommand("effect @s regeneration 6 1 true");
    const loc = { x: player.location.x + d.x * 2, y: player.location.y + 0.8 + d.y * 2, z: player.location.z + d.z * 2 };
    player.dimension.spawnParticle("minecraft:huge_explosion_emitter", loc);
    for (let i = 0; i < 18; i++) player.dimension.spawnParticle(i % 2 ? "minecraft:redstone_wire_dust_particle" : "minecraft:critical_hit_emitter", { x: loc.x + (Math.random() - 0.5) * 8, y: loc.y + (Math.random() - 0.5) * 8, z: loc.z + (Math.random() - 0.5) * 8 });
    player.dimension.playSound("random.explode", loc, { volume: 1.8, pitch: 0.7 });
    for (const ent of player.dimension.getEntities({ location: loc, maxDistance: 4.5, excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) {
      if (ent.id === player.id) continue;
      const dx = ent.location.x - loc.x, dz = ent.location.z - loc.z, dist = Math.max(0.3, Math.sqrt(dx * dx + dz * dz));
      ent.runCommand("damage @s 10 entity_explosion");
      if (!(ent instanceof Player)) ent.applyImpulse({ x: dx / dist * 0.9, y: 0.45, z: dz / dist * 0.9 });
    }
    player.onScreenDisplay.setActionBar("\xA74Adrenaline overdose! \xA7cSpeed II \xA78\xB7 \xA7cStrength II \xA78\xB7 \xA7cResistance");
  }, 60);
}
world.afterEvents.itemUse.subscribe((e) => {
  const p = e.source;
  if (p instanceof Player && e.itemStack?.typeId === GLAND && ready(p, "organic_gland_cd", COOLDOWN.gland)) triggerSafeAdrenalineBlast(p);
});
function ownerHasAdaptiveBlade(ally) {
  const owner = String(ally.getDynamicProperty("organic_owner") ?? "");
  const p = world.getPlayers().find((pl) => pl.name === owner && pl.dimension.id === ally.dimension.id);
  return !!p && hasItem(p, ADAPTIVE_ARM_BLADE);
}
var ALLY_ULT_DURATION = 500;
var ALLY_ULT_COOLDOWN = 1800;
function triggerAllyUlt(p, ally) {
  const cdLeft = cooldownLeft(p, "organic_ally_ult_cd", ALLY_ULT_COOLDOWN);
  if (cdLeft > 0) {
    p.dimension.playSound(`${SOUND}.cremation_wand_error`, p.location, { volume: 0.8, pitch: 0.6 });
    p.onScreenDisplay.setActionBar(`\xA7cAlly Ascension recharging: \xA7f${Math.ceil(cdLeft / 20)}s`);
    return;
  }
  p.setDynamicProperty("organic_ally_ult_cd", system.currentTick);
  ally.setDynamicProperty("ally_ult_until", system.currentTick + ALLY_ULT_DURATION);
  ally.setDynamicProperty("ally_grab_cd", 0);
  p.dimension.playSound(`${SOUND}.adapt_complete`, ally.location, { volume: 1.6, pitch: 0.7 });
  p.dimension.playSound("mob.warden.roar", ally.location, { volume: 1.2, pitch: 1.3 });
  for (let i = 0; i < 40; i++) ally.dimension.spawnParticle("minecraft:redstone_wire_dust_particle", { x: ally.location.x + (Math.random() - 0.5) * 1.6, y: ally.location.y + Math.random() * 3, z: ally.location.z + (Math.random() - 0.5) * 1.6 });
  p.onScreenDisplay.setActionBar("\xA75\xA7lYOUR CREMATION ALLY ASCENDS! \xA7r\xA7d25s of carnage.");
}
world.afterEvents.entityHurt.subscribe((e) => {
  const v = e.hurtEntity;
  if (v?.typeId !== CREMATION_ALLY || !Number(v.getDynamicProperty("is_adapted"))) return;
  const src = String(e.damageSource?.damagingEntity?.typeId ?? e.damageSource?.cause ?? "generic");
  const prev = String(v.getDynamicProperty("ally_adapt_source") ?? "");
  let stacks = prev === src ? Number(v.getDynamicProperty("ally_adapt_stacks") ?? 0) : 0;
  v.setDynamicProperty("ally_adapt_source", src);
  stacks = Math.min(4, stacks + 1);
  v.setDynamicProperty("ally_adapt_stacks", stacks);
  const amp = stacks >= 4 ? 1 : 0;
  v.runCommand(`effect @s resistance 6 ${amp} true`);
  v.dimension.spawnParticle("minecraft:critical_hit_emitter", { x: v.location.x, y: v.location.y + 1.4, z: v.location.z });
  if (stacks >= 4) v.dimension.playSound(`${SOUND}.adapt_complete`, v.location, { volume: 0.8, pitch: 1.1 });
});
system.runInterval(() => {
  for (const dimName of ["overworld", "nether", "the_end"]) {
    const dim = world.getDimension(dimName);
    for (const ward of dim.getEntities({ type: HOMUNCULUS_BULWARK })) for (const ent of dim.getEntities({ location: ward.location, maxDistance: 5, excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) if (ent.id !== ward.id && !(ent instanceof Player) && !ent.hasTag(`${NS}_homunculus`) && !ent.hasTag(`${NS}_player_ally`)) {
      applySickly(ent, 40, 1);
      ent.dimension.playSound("ambient.soul_sand_valley.mood", ent.location, { volume: 0.18, pitch: 1.5 });
    }
  }
}, 10);
function startAllyGrab(ally, target) {
  ally.setDynamicProperty("ally_grab_cd", system.currentTick + 200);
  ally.setDynamicProperty("ally_grabbing", 1);
  ally.dimension.playSound(`${SOUND}.cremation_ally_scream`, ally.location, { volume: 1.5, pitch: 0.8 });
  const targetId = target.id;
  let ticks = 0;
  const run = system.runInterval(() => {
    ticks += 4;
    const t = ally.isValid ? ally.dimension.getEntities({ location: ally.location, maxDistance: 10, excludeTypes: ["minecraft:item", "minecraft:xp_orb"] }).find((e) => e.id === targetId) : void 0;
    if (!ally.isValid || !t || !t.isValid || ticks > 60) {
      if (ally.isValid) ally.setDynamicProperty("ally_grabbing", 0);
      if (t && t.isValid) {
        const dx = t.location.x - ally.location.x, dz = t.location.z - ally.location.z, m = Math.max(0.1, Math.sqrt(dx * dx + dz * dz));
        t.applyImpulse({ x: dx / m * 2.4, y: 0.6, z: dz / m * 2.4 });
        t.runCommand("damage @s 8 entity_attack");
        ally.dimension.playSound("mob.warden.sonic_boom", ally.location, { volume: 1, pitch: 1.2 });
      }
      system.clearRun?.(run);
      return;
    }
    t.teleport?.({ x: ally.location.x, y: ally.location.y + 0.1, z: ally.location.z });
    t.runCommand("effect @s slowness 1 255 true");
    t.runCommand("effect @s weakness 1 255 true");
    t.runCommand("damage @s 5 entity_attack");
    applyBleed(t);
    applySickly(t, 100, 3);
    t.dimension.spawnParticle("minecraft:critical_hit_emitter", { x: t.location.x, y: t.location.y + 1, z: t.location.z });
    ally.dimension.playSound("mob.zombie.attack_wood", ally.location, { volume: 0.8, pitch: 0.7 });
  }, 4);
}
system.runInterval(() => {
  for (const dimName of ["overworld", "nether", "the_end"]) {
    const dim = world.getDimension(dimName);
    for (const ally of dim.getEntities({ type: CREMATION_ALLY })) {
      const adapted = Number(ally.getDynamicProperty("ally_ult_until") ?? 0) > system.currentTick;
      const wasAdapted = Number(ally.getDynamicProperty("is_adapted")) === 1;
      ally.setDynamicProperty("is_adapted", adapted ? 1 : 0);
      if (adapted && !wasAdapted) {
        try { ally.triggerEvent("organic:become_adapted"); } catch {}
        ally.dimension.playSound(`${SOUND}.adapt_complete`, ally.location, { volume: 1.6, pitch: 0.7 });
        for (let i = 0; i < 24; i++) ally.dimension.spawnParticle("minecraft:redstone_wire_dust_particle", { x: ally.location.x + (Math.random() - 0.5) * 1.4, y: ally.location.y + Math.random() * 2.4, z: ally.location.z + (Math.random() - 0.5) * 1.4 });
        ally.onScreenDisplay?.setActionBar?.("");
      } else if (!adapted && wasAdapted) {
        try { ally.triggerEvent("organic:become_normal"); } catch {}
        ally.setDynamicProperty("ally_adapt_stacks", 0);
        ally.setDynamicProperty("ally_adapt_source", "");
      }
      if (adapted) {
        ally.runCommand("effect @s speed 2 1 true");
        ally.runCommand("effect @s strength 2 2 true");
        if (system.currentTick % 10 === 0) ally.dimension.spawnParticle("minecraft:redstone_wire_dust_particle", { x: ally.location.x, y: ally.location.y + 2.3, z: ally.location.z });
      }
      if (Number(ally.getDynamicProperty("ally_grabbing")) === 1) continue;
      const targetId = String(ally.getDynamicProperty("currentTarget") ?? "");
      let target = targetId ? dim.getEntities({ location: ally.location, maxDistance: 48, excludeTypes: ["minecraft:item", "minecraft:xp_orb"] }).find((e) => e.id === targetId) : void 0;
      const commanded = !!target;
      if (target && (target instanceof Player || target.id === ally.id)) { ally.setDynamicProperty("currentTarget", ""); target = void 0; }
      if (!target && adapted) {
        let best, bestD = 1e9;
        for (const e of dim.getEntities({ location: ally.location, maxDistance: 18, families: ["monster"] })) {
          if (e.id === ally.id || e instanceof Player || e.typeId === CREMATION_ALLY || e.hasTag(`${NS}_homunculus`) || e.hasTag(`${NS}_player_ally`)) continue;
          const d2 = (e.location.x - ally.location.x) ** 2 + (e.location.z - ally.location.z) ** 2;
          if (d2 < bestD) { bestD = d2; best = e; }
        }
        target = best;
      }
      if (!target) continue;
      ally.setDynamicProperty("organic_order_x", target.location.x);
      ally.setDynamicProperty("organic_order_y", target.location.y);
      ally.setDynamicProperty("organic_order_z", target.location.z);
      const dx = target.location.x - ally.location.x, dz = target.location.z - ally.location.z, m = Math.max(0.1, Math.sqrt(dx * dx + dz * dz));
      const chase = adapted ? 0.5 : 0.34;
      ally.applyImpulse({ x: dx / m * chase, y: m > 6 ? 0.02 : 0, z: dz / m * chase });
      if (commanded && m > 14) ally.teleport?.({ x: target.location.x - dx / m * 2, y: target.location.y, z: target.location.z - dz / m * 2 });
      if (adapted && m < 3.4 && !(target instanceof Player) && Number(ally.getDynamicProperty("ally_grab_cd") ?? 0) <= system.currentTick) {
        startAllyGrab(ally, target);
        continue;
      }
      if (m < 3.4 && Number(ally.getDynamicProperty("ally_next_forced_hit") ?? 0) <= system.currentTick) {
        ally.setDynamicProperty("ally_next_forced_hit", system.currentTick + 16);
        target.runCommand(`damage @s ${adapted ? 14 : 5} entity_attack`);
        if (adapted && !(target instanceof Player)) applySickly(target, 120, 3);
      }
    }
  }
}, 20);
var flailComponent = { onUse(e) {
  const p = e.source;
  if (!(p instanceof Player) || !ready(p, "organic_flail_cd", COOLDOWN.flail)) return;
  const w = getWellness(p), tier = rotTier(w);
  p.dimension.playSound(`${SOUND}.vertebrae_flail_snap`, p.location, { volume: 1 });
  for (let i = 0; i < 8; i++) system.runTimeout(() => p.isValid && p.dimension.spawnParticle("minecraft:critical_hit_emitter", { x: p.location.x, y: p.location.y + 1.1, z: p.location.z }), i * 2);
  if (tier === "Fermented") {
    const dir = view(p);
    for (const ent of p.dimension.getEntities({ location: p.location, maxDistance: 4, excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) if (ent.id !== p.id) {
      const side = (ent.location.x - p.location.x) * dir.z - (ent.location.z - p.location.z) * dir.x;
      if (Math.abs(side) <= 4) {
        ent.runCommand("damage @s 10 entity_attack");
        ent.applyKnockback({ x: ent.location.x - p.location.x, z: ent.location.z - p.location.z }, 0.85);
      }
    }
    return;
  }
  const target = rayMob(p, tier === "Fresh" ? 9 : 7);
  if (!target) return;
  const d = { x: p.location.x - target.location.x, y: p.location.y + 0.8 - target.location.y, z: p.location.z - target.location.z };
  const mag = Math.max(0.1, Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z));
  target.applyImpulse({ x: d.x / mag * 1.5, y: 0.2 + d.y / mag * 1.5, z: d.z / mag * 1.5 });
  target.dimension.spawnParticle("minecraft:knockback_roar_particle", target.location);
  if (tier === "Fresh") target.runCommand("effect @s slowness 2 1 true");
  if (tier === "Putrid") {
    for (const ent of p.dimension.getEntities({ location: target.location, maxDistance: 4, excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) if (ent.id !== p.id) {
      ent.dimension.spawnParticle("minecraft:wither_boss_invulnerable", ent.location);
      ent.runCommand("effect @s wither 4 1 true");
      ent.runCommand("damage @s 4 magic");
    }
  }
} };
var spitterComponent = { onUse(e) {
  const p = e.source;
  if (!(p instanceof Player)) return;
  if (p.isSneaking) {
    if (!loadSpitter(p)) p.sendMessage("\xA77Reload needs Rotten Flesh, Raw Carcass, or Spider Eye.");
    return;
  }
  if (!ready(p, "organic_spitter_cd", COOLDOWN.spitter)) return;
  const ammo = takeLoadedAmmo(p);
  if (!ammo) {
    p.dimension.playSound("random.click", p.location, { volume: 0.8, pitch: 0.45 });
    p.onScreenDisplay.setActionBar("\xA78Bile-Spitter dry-clicks: chamber empty. Sneak-use to reload.");
    return;
  }
  if (ammo === RAW_CARCASS) {
    coneShrapnel(p);
    p.onScreenDisplay.setActionBar(`\xA7aShrapnel Blast \xA78\xB7 \xA7cchamber ${spitterLoaded(p)}/5`);
    return;
  }
  const dir = view(p);
  const speed = 2;
  const proj = p.dimension.spawnEntity(BILE_GLOB, { x: p.location.x + dir.x * 1.35, y: p.location.y + 1.45 + dir.y * 0.1, z: p.location.z + dir.z * 1.35 });
  proj.addTag(`${NS}_bile_glob`);
  proj.setDynamicProperty("organic_owner_id", p.id);
  proj.setDynamicProperty("organic_ammo", ammo);
  proj.setDynamicProperty("organic_birth", system.currentTick);
  proj.applyImpulse({ x: dir.x * speed, y: dir.y * speed, z: dir.z * speed });
  const hit = rayMob(p, 18);
  if (hit && !(hit instanceof Player)) {
    if (ammo === "minecraft:rotten_flesh") {
      hit.runCommand("effect @s poison 6 1 true");
      hit.runCommand("effect @s slowness 6 1 true");
    } else if (ammo === "minecraft:spider_eye") applySickly(hit, 200, 2);
  }
  for (let i = 1; i < 9; i++) system.runTimeout(() => p.isValid && p.dimension.spawnParticle(i % 2 ? "minecraft:redstone_wire_dust_particle" : "minecraft:critical_hit_emitter", { x: p.location.x + dir.x * i, y: p.location.y + 1.4 + dir.y * i, z: p.location.z + dir.z * i }), i);
  p.dimension.playSound(`${SOUND}.bile_spitter_fire`, p.location, { volume: 1, pitch: 0.9 });
  p.onScreenDisplay.setActionBar(`\xA7c${ammo === "minecraft:spider_eye" ? "Sickly Dart" : "Toxic Glob"} \xA78\xB7 \xA7cchamber ${spitterLoaded(p)}/5`);
} };
function isSolidBlockId(id) {
  return !!id && !["minecraft:air", "minecraft:water", "minecraft:lava"].includes(id);
}
function surfaceSpikeLocation(player, x, z) {
  const startY = Math.floor(player.location.y + 2);
  for (let y = startY; y >= startY - 10; y--) {
    const below = player.dimension.getBlock({ x: Math.floor(x), y: y - 1, z: Math.floor(z) });
    const here = player.dimension.getBlock({ x: Math.floor(x), y, z: Math.floor(z) });
    if (isSolidBlockId(below?.typeId) && (!here || here.typeId === "minecraft:air")) return { x, y, z };
  }
  return { x, y: player.location.y, z };
}
function isHostileOsteoTarget(entity, player) {
  return entity.id !== player.id && !(entity instanceof Player) && !entity.hasTag(`${NS}_homunculus`) && !entity.hasTag(`${NS}_player_ally`) && entity.typeId !== "minecraft:item" && entity.typeId !== "minecraft:xp_orb";
}
function triggerOsteoSpike(player) {
  const raw = view(player);
  const mag = Math.max(1e-3, Math.sqrt(raw.x * raw.x + raw.z * raw.z));
  const dirX = raw.x / mag, dirZ = raw.z / mag;
  const hitIds = /* @__PURE__ */ new Set();
  player.dimension.playSound("mob.warden.heartbeat", player.location, { volume: 1.25, pitch: 0.65 });
  player.dimension.playSound("mob.skeleton.hurt", player.location, { volume: 1.1, pitch: 0.55 });
  for (let i = 1; i <= 5; i++) {
    const targetX = player.location.x + dirX * i * 1.5, targetZ = player.location.z + dirZ * i * 1.5, loc = surfaceSpikeLocation(player, targetX, targetZ);
    try {
      player.dimension.spawnEntity(`${NS}:osteo_spike`, loc);
    } catch {
      player.dimension.spawnParticle("minecraft:critical_hit_emitter", loc);
    }
    player.dimension.spawnParticle("minecraft:redstone_wire_dust_particle", { x: loc.x, y: loc.y + 0.35, z: loc.z });
    player.dimension.spawnParticle("minecraft:knockback_roar_particle", { x: loc.x, y: loc.y + 0.1, z: loc.z });
    for (const ent of player.dimension.getEntities({ location: loc, maxDistance: 1.5, excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) if (isHostileOsteoTarget(ent, player) && !hitIds.has(ent.id)) {
      hitIds.add(ent.id);
      ent.applyImpulse({ x: 0, y: 0.65, z: 0 });
      ent.runCommand("damage @s 14 entity_attack");
      applySickly(ent, 160, 3);
      ent.dimension.spawnParticle("minecraft:bone_meal_particle", { x: ent.location.x, y: ent.location.y + 1, z: ent.location.z });
    }
  }
  player.runCommand("effect @s haste 4 1 true");
  if (hitIds.size > 0) {
    player.runCommand(`effect @s instant_health 1 ${Math.min(2, hitIds.size - 1)} true`);
    addWellness(player, 5);
    player.dimension.spawnParticle("minecraft:heart_particle", { x: player.location.x, y: player.location.y + 1.2, z: player.location.z });
  }
  player.onScreenDisplay.setActionBar(`\xA74Osteo-Spike erupts! \xA7c${hitIds.size} impaled\xA78 \xB7 \xA7amarrow reclaimed`);
}
var marrowBladeComponent = {};
world.afterEvents.entityHitEntity.subscribe((e) => {
  const p = e.damagingEntity;
  if (!(p instanceof Player) || selectedType(p) !== MARROW_BLADE) return;
  const victim = e.hitEntity;
  const now = system.currentTick, last = Number(p.getDynamicProperty("organic_marrow_last") ?? -99999);
  let stacks = now - last > 120 ? 0 : Number(p.getDynamicProperty("organic_marrow_stacks") ?? 0);
  stacks = Math.min(3, stacks + 1);
  p.setDynamicProperty("organic_marrow_stacks", stacks);
  p.setDynamicProperty("organic_marrow_last", now);
  if (victim?.isValid) victim.runCommand(`effect @s slowness 2 ${stacks - 1} true`);
  if (stacks >= 3) {
    p.dimension.playSound("mob.warden.heartbeat", p.location, { volume: 0.9, pitch: 0.7 });
    for (let i = 0; i < 8; i++) p.dimension.spawnParticle("minecraft:redstone_wire_dust_particle", { x: p.location.x + (Math.random() - 0.5) * 0.7, y: p.location.y + 1, z: p.location.z + (Math.random() - 0.5) * 0.7 });
    p.runCommand("effect @s strength 4 0 true");
    const v = p.getVelocity();
    const crit = v.y < -0.05 && !p.isOnGround;
    if (crit || p.isSprinting || p.isSneaking) {
      p.setDynamicProperty("organic_marrow_stacks", 0);
      triggerOsteoSpike(p);
      return;
    }
    p.onScreenDisplay.setActionBar("\xA74Marrow-Blade \xA7cPRIMED\xA74: \xA7fsprint, jump-crit, or sneak-strike \xA74to erupt Osteo-Spike.");
  } else p.onScreenDisplay.setActionBar(`\xA7cMarrow kinetic charge: \xA7f${stacks}/3 \xA78${"█".repeat(stacks)}${"░".repeat(3 - stacks)}`);
});
var activeHarpoons = /* @__PURE__ */ new Map();
function invContainer(player) {
  return player.getComponent("minecraft:inventory")?.container;
}
function setTrackedItem(player, slot, itemId) {
  const c = invContainer(player);
  if (c && slot >= 0 && slot < c.size) c.setItem(slot, new ItemStack(itemId, 1));
  else player.runCommand(`give @s ${itemId} 1`);
}
function playerById(id) {
  return world.getPlayers().find((p) => p.id === id);
}
function findEntityNear(player, id) {
  if (!id) return void 0;
  return player.dimension.getEntities({ location: player.location, maxDistance: 64, excludeTypes: ["minecraft:item", "minecraft:xp_orb"] }).find((e) => e.id === id);
}
function clearHarpoon(playerId, returnWeapon = true, sound = "mob.fishing_hook.splash") {
  const t = activeHarpoons.get(playerId);
  if (!t) return;
  const p = playerById(playerId);
  if (p?.isValid) {
    const proj = findEntityNear(p, t.projectileId);
    if (proj?.isValid) proj.remove();
    if (returnWeapon) {
      const c = invContainer(p);
      if (c && t.originalStack) c.setItem(t.slot, t.originalStack);
      else setTrackedItem(p, t.slot, SPINE_HARPOON);
    }
    p.dimension.playSound(sound, p.location, { volume: 1, pitch: 0.65 });
    p.setDynamicProperty("organic_harpoon_target", "");
  }
  activeHarpoons.delete(playerId);
}
var spineHarpoonComponent = { onUse(e) {
  const p = e.source;
  if (!(p instanceof Player) || activeHarpoons.has(p.id) || !ready(p, "organic_harpoon_cd", 10)) return;
  const dir = view(p), slot = p.selectedSlotIndex, originalStack = invContainer(p)?.getItem(slot);
  const proj = p.dimension.spawnEntity(HARPOON_PROJECTILE, { x: p.location.x + dir.x * 1.3, y: p.location.y + 1.35 + dir.y * 0.2, z: p.location.z + dir.z * 1.3 });
  proj.addTag(`${NS}_harpoon_projectile`);
  proj.setDynamicProperty("organic_owner", p.id);
  proj.applyImpulse({ x: dir.x * 2.6, y: dir.y * 2.6, z: dir.z * 2.6 });
  activeHarpoons.set(p.id, { playerId: p.id, slot, projectileId: proj.id, firedTick: system.currentTick, dimensionId: p.dimension.id, originalStack });
  setTrackedItem(p, slot, SINEW_SPOOL);
  system.runTimeout(() => {
    const t = activeHarpoons.get(p.id);
    if (t && !t.victimId && system.currentTick - t.firedTick >= 120) {
      p.sendMessage("\xA77The harpoon vanishes into the distance and reels itself back.");
      clearHarpoon(p.id, true, "random.bowhit");
    }
  }, 120);
  p.dimension.playSound("mob.skeleton.shoot", p.location, { volume: 1, pitch: 0.55 });
} };
var sinewSpoolComponent = { onUse(e) {
  const p = e.source;
  if (!(p instanceof Player)) return;
  const t = activeHarpoons.get(p.id);
  if (!t) {
    setTrackedItem(p, p.selectedSlotIndex, SPINE_HARPOON);
    return;
  }
  const target = findEntityNear(p, t.victimId);
  if (!target) {
    clearHarpoon(p.id, true, "mob.fishing_hook.splash");
    return;
  }
  const h = target.getComponent("minecraft:health");
  if (!target.isValid || h && h.currentValue <= 0) {
    clearHarpoon(p.id, true, "random.break");
    return;
  }
  const d = { x: p.location.x - target.location.x, y: p.location.y + 0.5 - target.location.y, z: p.location.z - target.location.z };
  const dist = Math.max(0.01, Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z));
  if (dist <= 2.5) {
    target.runCommand("damage @s 6 override");
    target.runCommand("effect @s slowness 1 255 true");
    target.dimension.spawnParticle("minecraft:critical_hit_emitter", target.location);
    clearHarpoon(p.id, true, "mob.zombie.hurt");
    return;
  }
  const nx = d.x / dist, nz = d.z / dist, yImpulse = Math.min(Math.max(dist * 0.08, 0.35), 0.8), hImpulse = Math.min(1.35, Math.max(0.45, dist * 0.13));
  target.applyImpulse({ x: Math.max(-1.35, Math.min(1.35, nx * hImpulse)), y: yImpulse, z: Math.max(-1.35, Math.min(1.35, nz * hImpulse)) });
  target.dimension.spawnParticle("minecraft:critical_hit_emitter", target.location);
  p.dimension.playSound("mob.fishing_hook.splash", p.location, { volume: 1, pitch: 0.75 });
} };
var cremationWandComponent = { onUse(e) {
  const p = e.source;
  if (!(p instanceof Player)) return;
  const ally = p.dimension.getEntities({ location: p.location, maxDistance: 64, type: CREMATION_ALLY }).find((a) => a.getDynamicProperty("organic_owner") === p.name);
  if (ally) {
    if (p.isSneaking && hasItem(p, ADAPTIVE_ARM_BLADE)) { triggerAllyUlt(p, ally); return; }
    const target = rayMob(p, 32);
    if (target && !(target instanceof Player) && target.id !== ally.id) {
      ally.setDynamicProperty("currentTarget", target.id);
      ally.setDynamicProperty("organic_order_x", target.location.x);
      ally.setDynamicProperty("organic_order_y", target.location.y);
      ally.setDynamicProperty("organic_order_z", target.location.z);
      p.dimension.playSound(`${SOUND}.cremation_command_screech`, p.location, { volume: 1, pitch: 1.1 });
      p.onScreenDisplay.setActionBar("\xA75Cremation Ally commanded to maul your target.");
    } else p.onScreenDisplay.setActionBar("\xA77Aim at an enemy to command your Cremation Ally.");
    return;
  }
  const pts = Number(p.getDynamicProperty("cremation_charge") ?? p.getDynamicProperty("organic_wand_points") ?? 0);
  if (pts < 100) {
    p.dimension.playSound(`${SOUND}.cremation_wand_error`, p.location, { volume: 0.8, pitch: 0.55 });
    p.onScreenDisplay.setActionBar(`\xA75Cremation charge: \xA7d${Math.min(100, Math.floor(pts))}/100`);
    return;
  }
  const left = cooldownLeft(p, "organic_cremation_wand_cd", 6e3);
  if (left > 0) {
    p.onScreenDisplay.setActionBar(`\xA77Cremation Wand cooling: \xA7c${Math.ceil(left / 20)}s`);
    return;
  }
  p.setDynamicProperty("cremation_charge", 0);
  p.setDynamicProperty("organic_wand_points", 0);
  p.setDynamicProperty("organic_cremation_wand_cd", system.currentTick);
  summonCremationAlly(p);
  p.runCommand("damageitem entity @s slot.weapon.mainhand 25");
} };
var anchorComponent = { onUse(e) {
  const p = e.source;
  if (!(p instanceof Player) || !ready(p, "organic_anchor_cd", COOLDOWN.anchor)) return;
  const hit = p.getBlockFromViewDirection?.({ maxDistance: 24 })?.block;
  if (!hit) return;
  const loc = hit.location;
  const d = { x: loc.x + 0.5 - p.location.x, y: loc.y + 0.7 - p.location.y, z: loc.z + 0.5 - p.location.z };
  const m = Math.max(0.1, Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z));
  p.applyKnockback({ x: d.x / m * 2.8, z: d.z / m * 2.8 }, Math.max(0.25, d.y / m * 1.2));
  p.setDynamicProperty("organic_anchor_fall_cancel", system.currentTick + 100);
  p.dimension.spawnParticle("minecraft:critical_hit_emitter", { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 });
  p.dimension.playSound(`${SOUND}.flesh_anchor_latch`, p.location, { volume: 1 });
} };
var glandComponent = {};
var chimeraShieldComponent = { onUse(e) {
  const p = e.source;
  if (!(p instanceof Player) || !p.isSneaking || !hasEmptyMainHand(p) || !isChimeraShieldEquipped(p) || !ready(p, "organic_chimera_shield_cd", COOLDOWN.shield)) return;
  const dir = view(p), start = { ...p.location };
  p.runCommand("effect @s resistance 2 255 true");
  p.runCommand("effect @s absorption 3 2 true");
  p.dimension.playSound("mob.enderdragon.flap", p.location, { volume: 0.7, pitch: 0.65 });
  for (let step = 0; step < 8; step++) system.runTimeout(() => {
    if (!p.isValid) return;
    const moved = Math.sqrt((p.location.x - start.x) ** 2 + (p.location.z - start.z) ** 2);
    if (moved < 5) p.applyKnockback({ x: dir.x * 1.3, z: dir.z * 1.3 }, 0.04);
    else p.runCommand("effect @s weakness 10 0 true");
    p.dimension.spawnParticle("minecraft:knockback_roar_particle", { x: p.location.x, y: p.location.y + 0.8, z: p.location.z });
    for (const ent of p.dimension.getEntities({ location: p.location, maxDistance: 2.3, excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) if (ent.id !== p.id) {
      ent.runCommand("damage @s 16 entity_attack");
      applySickly(ent, 120);
      ent.applyKnockback({ x: dir.x * 1.2, z: dir.z * 1.2 }, 0.25);
    }
    if (step === 7) p.runCommand("effect @s weakness 10 0 true");
  }, step * 2);
} };
var homunculusWardComponent = { onUse(e) {
  const p = e.source;
  if (!(p instanceof Player) || !ready(p, "organic_homunculus_cd", 20)) return;
  const d = view(p);
  const h = p.dimension.spawnEntity(HOMUNCULUS_BASE, { x: p.location.x + d.x * 2, y: p.location.y, z: p.location.z + d.z * 2 });
  h.addTag(`${NS}_homunculus`);
  h.setDynamicProperty("organic_owner", p.name);
  h.runCommand("effect @s slowness 999999 255 true");
  h.runCommand("effect @s resistance 999999 1 true");
  clearOne(p, HOMUNCULUS_WARD);
} };
var parasiticPickaxeComponent = { onMineBlock(e) {
  const p = e.source;
  if (!(p instanceof Player)) return;
  const mined = Number(p.getDynamicProperty("organic_parasitic_mined") ?? 0) + 1;
  p.setDynamicProperty("organic_parasitic_mined", mined);
  if (mined % 10 !== 0) return;
  const food = p.getComponent("minecraft:player.hunger");
  const cur = food?.currentValue ?? 0;
  if (food?.setCurrentValue && cur > 0) {
    food.setCurrentValue(Math.max(0, cur - 1));
    p.onScreenDisplay.setActionBar("\xA74The Parasitic Pickaxe drinks one hunger point.");
  } else {
    p.runCommand("damage @s 1 entity_attack");
    p.onScreenDisplay.setActionBar("\xA74Starved pickaxe bites into your hand.");
  }
} };
var ribCrackerComponent = { onHitEntity(e) {
  const p = e.damagingEntity ?? e.attackingEntity ?? e.source;
  const target = e.hitEntity;
  if (!(p instanceof Player) || !target || Math.random() > 0.4) return;
  const d = view(p);
  target.runCommand("effect @s weakness 5 1 true");
  target.runCommand("damage @s 2 entity_attack");
  target.applyKnockback({ x: d.x * 1.8, z: d.z * 1.8 }, 0.35);
  p.dimension.playSound("mob.skeleton.hurt", target.location, { volume: 1, pitch: 0.55 });
  p.onScreenDisplay.setActionBar("\xA7cRib-Cracker splinters through the guard!");
} };
function ribCrackerSlam(player) {
  const dir = view(player);
  player.dimension.playSound("mob.warden.sonic_boom", player.location, { volume: 1.2, pitch: 0.7 });
  player.dimension.spawnParticle("minecraft:knockback_roar_particle", player.location);
  for (const ent of player.dimension.getEntities({ location: player.location, maxDistance: 4, excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) if (hostileForBlade(ent, player)) {
    ent.runCommand("damage @s 14 entity_attack");
    applyBleed(ent);
    const dx = ent.location.x - player.location.x, dz = ent.location.z - player.location.z, m = Math.max(0.1, Math.sqrt(dx * dx + dz * dz));
    ent.applyImpulse({ x: dx / m * 0.6, y: 0.5, z: dz / m * 0.6 });
  }
  const mag = Math.max(1e-3, Math.sqrt(dir.x * dir.x + dir.z * dir.z));
  const nx = dir.x / mag, nz = dir.z / mag, hit = /* @__PURE__ */ new Set();
  for (let i = 1; i <= 8; i++) system.runTimeout(() => {
    if (!player.isValid) return;
    const loc = { x: player.location.x + nx * i, y: player.location.y, z: player.location.z + nz * i };
    player.dimension.spawnParticle("minecraft:knockback_roar_particle", loc);
    player.dimension.spawnParticle("minecraft:redstone_wire_dust_particle", { x: loc.x, y: loc.y + 0.3, z: loc.z });
    for (const ent of player.dimension.getEntities({ location: loc, maxDistance: 1.6, excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) if (hostileForBlade(ent, player) && !hit.has(ent.id)) {
      hit.add(ent.id);
      ent.runCommand("damage @s 8 entity_attack");
      applyBleed(ent);
    }
  }, i);
  player.onScreenDisplay.setActionBar("\xA74Rib-Cracker \xA7cSLAM\xA74 — \xA7fa bleeding fissure tears forward!");
}
world.afterEvents.itemUse.subscribe((e) => {
  const p = e.source;
  if (!(p instanceof Player) || e.itemStack?.typeId !== RIB_CRACKER) return;
  if (!ready(p, "organic_rib_slam_cd", 100)) return;
  p.dimension.playSound("block.bell.hit", p.location, { volume: 0.6, pitch: 0.5 });
  p.onScreenDisplay.setActionBar("\xA78Rib-Cracker \xA7ccharging\xA78 the slam...");
  const token = system.currentTick;
  p.setDynamicProperty("organic_rib_charge_start", token);
  for (let i = 1; i <= 3; i++) system.runTimeout(() => {
    if (p.isValid && selectedType(p) === RIB_CRACKER) p.dimension.spawnParticle("minecraft:redstone_wire_dust_particle", { x: p.location.x, y: p.location.y + 1.4, z: p.location.z });
  }, i * 5);
  system.runTimeout(() => {
    if (p.isValid && selectedType(p) === RIB_CRACKER && Number(p.getDynamicProperty("organic_rib_charge_start")) === token) ribCrackerSlam(p);
  }, 16);
});
function devourerEmergence(_mob) {
}
function devourerDoAttack(attacker, victim) {
  if (!attacker || attacker.typeId !== CREMATION_ALLY) return;
}
function triggerShieldBash(player) {
  if (Number(player.getDynamicProperty("organic_shield_bash_request") ?? 0) < system.currentTick) return;
  player.setDynamicProperty("organic_shield_bash_request", 0);
  chimeraShieldComponent.onUse?.({ source: player }, {});
  player.setDynamicProperty("organic_shield_bash_sneak_lock", system.currentTick + 20);
}
var ITEM_ICON = (n) => `textures/com/organic_forgery_and_the_harvester_kse6cimp/items/${n}`;
function isDevPlayer(p) {
  try {
    if (p.isOp?.()) return true;
  } catch {
  }
  try {
    const gm = p.getGameMode?.();
    if (gm && String(gm).toLowerCase().includes("creative")) return true;
  } catch {
  }
  return p.hasTag("dev") || p.hasTag("op");
}
function giveTestingGear(p) {
  [ADAPTIVE_ARM_BLADE, LIVING_BLADE, MARROW_BLADE, FLAIL, TENDON_DAGGER, SPINE_HARPOON, SPITTER, SPINE_SHOT_CROSSBOW, RIB_CRACKER, PARASITIC_PICKAXE, ANCHOR, GLAND, WAND, HOMUNCULUS_WARD, FLESH_SHIELD, CHIMERA_SHIELD, JOURNAL, `${NS}:butchers_knife`, PURE_HEART, `${NS}:harvester_placer`, CHITIN.head, CHITIN.chest, CHITIN.legs, CHITIN.feet, MEAT.head, MEAT.chest, MEAT.legs, MEAT.feet, ARMOR.head, ARMOR.chest, ARMOR.legs, ARMOR.feet].forEach((id) => p.runCommand(`give @s ${id} 1`));
  p.runCommand(`give @s ${BONE_SHARD_AMMO} 64`);
  p.runCommand(`give @s ${RAW_CARCASS} 16`);
  p.runCommand(`give @s ${NS}:calcified_bone_block 8`);
  p.runCommand("give @s minecraft:coal 16");
}
function spawnBossFor(p) {
  const d = view(p), loc = { x: p.location.x + d.x * 4, y: p.location.y, z: p.location.z + d.z * 4 };
  const b = p.dimension.spawnEntity(BIOMASS_HIVE, loc);
  b.addTag(`${NS}_boss`);
  b.setDynamicProperty("biomass_phase", 1);
  b.setDynamicProperty("biomass_anchor_x", loc.x);
  b.setDynamicProperty("biomass_anchor_y", loc.y);
  b.setDynamicProperty("biomass_anchor_z", loc.z);
  p.dimension.playSound(`${SOUND}.biomass_hive_roar`, loc, { volume: 2, pitch: 0.7 });
}
function openMobSpawner(p) {
  const mobs = [["Grafted Stalker", GRAFTED_STALKER], ["Splintered Hound", SPLINTERED_HOUND], ["Bloated Amalgam", BLOATED_AMALGAM], ["Marrow-Ghast", MARROW_GHAST], ["Homunculus Ward", HOMUNCULUS_BASE], ["Venom Homunculus", HOMUNCULUS_VENOM], ["Mortar Homunculus", HOMUNCULUS_MORTAR], ["Bulwark Homunculus", HOMUNCULUS_BULWARK]];
  const form = new ActionFormData().title("\xA7l\xA76Spawn a Mob").body("\xA77Spawns 4 blocks ahead of you. Homunculi bind to you as wards.");
  mobs.forEach((m) => form.button("\xA7f" + m[0]));
  form.button("\xA77◀ Back");
  form.show(p).then((r) => {
    if (r.canceled) return;
    if (r.selection === mobs.length) {
      openTestLab(p);
      return;
    }
    const m = mobs[r.selection], d = view(p);
    const e = p.dimension.spawnEntity(m[1], { x: p.location.x + d.x * 4, y: p.location.y, z: p.location.z + d.z * 4 });
    if ([HOMUNCULUS_BASE, HOMUNCULUS_VENOM, HOMUNCULUS_MORTAR, HOMUNCULUS_BULWARK].includes(m[1])) {
      e.addTag(`${NS}_homunculus`);
      e.setDynamicProperty("organic_owner", p.name);
    }
    p.sendMessage(`\xA7d[LAB] Spawned ${m[0]}.`);
  }).catch(() => {
  });
}
function openTestLab(p) {
  new ActionFormData().title("\xA7l\xA7dBIOSCIENCE TEST LAB").body("\xA77Developer tools — gear up, spawn, and validate every system.").button("\xA7aGive All Gear & Ammo", ITEM_ICON("apex_spine")).button("\xA7cSummon Cremation Ally", ITEM_ICON("cremation_wand")).button("\xA74Summon Biomass Hive (Boss)", ITEM_ICON("pure_necrotic_heart")).button("\xA76Spawn a Mob…", ITEM_ICON("necrotic_ichor")).button("\xA75Max Corruption / Chum", ITEM_ICON("marrow")).button("\xA7bCycle Wellness Tier", ITEM_ICON("cured_hide")).button("\xA7fHeal & Clear Effects", ITEM_ICON("crystalline_marrow")).button("\xA79Reset Fracture & Cooldowns", ITEM_ICON("adaptive_arm_blade")).button("\xA78Clear Harpoon Tethers", ITEM_ICON("sinew_spool")).show(p).then((r) => {
    if (r.canceled) return;
    switch (r.selection) {
      case 0:
        giveTestingGear(p);
        p.sendMessage("\xA7d[LAB] Full gear + ammo granted.");
        break;
      case 1:
        summonCremationAlly(p);
        p.sendMessage("\xA7d[LAB] Cremation Ally summoned.");
        break;
      case 2:
        spawnBossFor(p);
        p.sendMessage("\xA7d[LAB] Biomass Hive-Mind summoned.");
        break;
      case 3:
        openMobSpawner(p);
        break;
      case 4: {
        const k = `custom:chum_score:${chumKey(findNearbyHarvester(p), p.dimension.id)}`;
        world.setDynamicProperty(k, 250);
        world.setDynamicProperty("chum_score", 250);
        p.sendMessage("\xA7d[LAB] Corruption/Chum maxed near you.");
        break;
      }
      case 5: {
        const w = getWellness(p), nw = w >= 67 ? 20 : w >= 34 ? 90 : 50;
        setWellness(p, nw);
        p.sendMessage(`\xA7d[LAB] Wellness set to ${nw} (${rotTier(nw)}).`);
        break;
      }
      case 6:
        p.runCommand("effect @s clear");
        p.runCommand("effect @s instant_health 1 20 true");
        p.sendMessage("\xA7d[LAB] Healed & cleared effects.");
        break;
      case 7:
        for (const k of ["adaptive_fractured_used", "organic_gland_cd", "organic_parasite_cd", "organic_parasitized_cd", "organic_rib_slam_cd", "organic_chimera_shield_cd"]) p.setDynamicProperty(k, 0);
        p.sendMessage("\xA7d[LAB] Fracture + cooldowns reset.");
        break;
      case 8:
        for (const id of Array.from(activeHarpoons.keys())) clearHarpoon(id, true, "random.break");
        p.sendMessage("\xA7d[LAB] Harpoon tethers cleared.");
        break;
    }
  }).catch(() => {
  });
}
function journalPage(p, title, body) {
  new ActionFormData().title(title).body(body).button("\xA77◀ Back").button("\xA7cClose").show(p).then((r) => {
    if (!r.canceled && r.selection === 0) openJournalDev(p);
  }).catch(() => {
  });
}
function openJournalDev(p) {
  const dev = isDevPlayer(p);
  const h = findNearbyHarvester(p);
  const chum = Number(world.getDynamicProperty(`custom:chum_score:${chumKey(h, p.dimension.id)}`) ?? 0);
  const w = Math.floor(getWellness(p));
  const form = new ActionFormData().title("\xA7l\xA74The Anatomist's Journal").body(`\xA7cWellness \xA7f${w} \xA77(${rotTier(w)})    \xA78\xB7    \xA75Chum \xA7f${chum}`).button("\xA76Living Weapons\n\xA78Blades \xB7 flail \xB7 spitter \xB7 crossbow", ITEM_ICON("adaptive_arm_blade")).button("\xA7aArmor & Rot Tiers\n\xA78Sets \xB7 wellness \xB7 synergies", ITEM_ICON("ribcage_carapace")).button("\xA75Harvester & Corruption\n\xA78Chum \xB7 flesh-moss \xB7 the Hive-Mind", ITEM_ICON("pure_necrotic_heart"));
  if (dev) form.button("\xA7d\xA7lBioscience Test Lab\n\xA78Spawn \xB7 gear \xB7 validate", ITEM_ICON("anatomists_journal"));
  form.show(p).then((r) => {
    if (r.canceled) return;
    if (r.selection === 0) journalPage(p, "\xA7l\xA76Living Weapons", `\xA7cAdaptive Arm-Blade\xA77: sneak-use cycles Severing / Sweeping / Kinetic; use to leap-slam; cheats death once into the Fractured Blade.
\xA7cMarrow-Blade\xA77: build 3 kinetic stacks, then sprint, jump-crit, or sneak-strike to erupt an Osteo-Spike.
\xA7cLiving Bone Blade\xA77: vampiric; a 5-hit Sanguine combo unleashes a life-draining Feast.
\xA7cBile-Spitter\xA77: sneak to load 5 charges - rotten flesh (toxic), carcass (shrapnel cone), spider eye (sickly).
\xA7cSpine-Shot Crossbow\xA77: hold to rapid-fire bone shards; sickly targets rupture.
\xA7cTendon Dagger\xA77: sneak/invis strikes bleed - backstabs hit harder.
\xA7cRib-Cracker\xA77: hold to charge a bleeding ground-slam.`);
    else if (r.selection === 1) journalPage(p, "\xA7l\xA7aArmor & Rot Tiers", `\xA76Anatomical set\xA77 shares one Wellness pool (feed raw meat to raise it):
\xA72Fresh 67-100\xA77: faster gear, Speed/Haste on hits.
\xA76Fermented 34-66\xA77: knockback & projectile resistance.
\xA75Putrid 0-33\xA77: camouflage & emergency invisibility.

\xA7cChitinous set\xA77: fireproof, crash-proof tank.
\xA7cMeat-Sack set\xA77: full set is \xA7cParasitized\xA77 - tendrils auto-block a blow, health-boost you, and tangle the attacker (20s cooldown).`);
    else if (r.selection === 2) journalPage(p, "\xA7l\xA75Harvester & Corruption", `\xA78Place \xA7cThe Harvester\xA78, then use a \xA7cRaw Carcass\xA78 on it (coal in inventory) to grind biomaterials and build \xA75Chum\xA78.

\xA77Rising Chum spreads \xA72flesh-moss\xA77 and \xA7fcalcified bone\xA77, and \xA74Grafted Stalkers\xA77 emerge.

\xA74\xA7lTHE HIVE-MIND\xA7r\xA77: ring the Harvester base with 4 \xA7fCalcified Bone Blocks\xA77 (cardinal sides), then use a \xA7cPure Necrotic Heart\xA77 on it to summon the boss.`);
    else if (dev && r.selection === 3) openTestLab(p);
  }).catch(() => {
  });
}
world.beforeEvents.itemUse.subscribe((ev) => {
  const p = ev.source;
  if (!(p instanceof Player)) return;
  const id = ev.itemStack?.typeId;
  if (id === JOURNAL) {
    ev.cancel = true;
    system.run(() => openJournalDev(p));
  }
});
world.afterEvents.entityHitEntity.subscribe((ev) => {
  const p = ev.damagingEntity;
  const t = ev.hitEntity;
  if (!(p instanceof Player) || !t) return;
  const held = selectedType(p);
  if (held === TENDON_DAGGER && (p.isSneaking || p.getEffect?.("invisibility"))) {
    const pv = view(p), tv = t.getViewDirection?.() ?? { x: 0, y: 0, z: 0 };
    const backstab = pv.x * tv.x + pv.z * tv.z > 0.25;
    t.runCommand(`damage @s ${backstab ? 9 : 6} override`);
    applyBleed(t);
    if (backstab) {
      t.runCommand("effect @s weakness 6 1 true");
      t.runCommand("effect @s slowness 4 1 true");
      p.dimension.playSound(`${SOUND}.bleed_slice`, t.location, { volume: 1, pitch: 0.9 });
    }
    p.runCommand("effect @s speed 3 1 true");
    for (let i = 0; i < 10; i++) p.dimension.spawnParticle("minecraft:redstone_wire_dust_particle", { x: t.location.x + (Math.random() - 0.5), y: t.location.y + 0.8 + Math.random(), z: t.location.z + (Math.random() - 0.5) });
    p.onScreenDisplay.setActionBar(backstab ? "\xA74Tendon Dagger \xA7cBACKSTAB\xA74: tendons severed, deep bleed opened." : "\xA74Tendon Dagger stealth strike: \xA7c2.5x\xA74 bleed opened.");
  }
  if (t.typeId === SPLINTERED_HOUND && Math.random() < 0.25) applySickly(p, 120, 1);
});
world.afterEvents.entityDie.subscribe((ev) => {
  const killer = ev.damageSource?.damagingEntity;
  if (killer instanceof Player && fullSet(killer, MEAT)) {
    killer.runCommand("effect @s instant_health 1 1 true");
    for (let i = 0; i < 12; i++) killer.dimension.spawnParticle("minecraft:redstone_wire_dust_particle", { x: killer.location.x, y: killer.location.y + 1, z: killer.location.z });
  }
});
system.runInterval(() => {
  for (const p of world.getPlayers()) {
    if (fullSet(p, CHITIN)) {
      p.runCommand("effect @s fire_resistance 2 255 true");
      p.runCommand("effect @s resistance 2 2 true");
      p.runCommand("effect @s slowness 2 0 true");
      p.setDynamicProperty("organic_anchor_fall_cancel", system.currentTick + 40);
    }
    if (fullSet(p, MEAT)) {
      p.runCommand("effect @s regeneration 2 0 true");
      if (p.isOnFire) p.runCommand("damage @s 1 fire");
    }
    const noisy = p.isSprinting || p.isJumping || Number(p.getDynamicProperty("organic_noise_until") ?? 0) > system.currentTick;
    if (noisy) for (const h of p.dimension.getEntities({ type: SPLINTERED_HOUND, location: p.location, maxDistance: 32 })) {
      h.runCommand("effect @s speed 4 1 true");
      h.applyImpulse({ x: Math.max(-0.2, Math.min(0.2, p.location.x - h.location.x)), y: 0, z: Math.max(-0.2, Math.min(0.2, p.location.z - h.location.z)) });
    }
  }
  for (const dimName of ["overworld", "nether", "the_end"]) {
    const dim = world.getDimension(dimName);
    for (const b of dim.getEntities({ type: BLOATED_AMALGAM })) {
      const players = dim.getPlayers?.({ location: b.location, maxDistance: 3 }) ?? [];
      if (players.length) {
        if (!b.getDynamicProperty("swell")) {
          b.setDynamicProperty("swell", system.currentTick + 30);
          b.runCommand("effect @s slowness 2 255 true");
        }
        if (Number(b.getDynamicProperty("swell")) <= system.currentTick) {
          b.dimension.createExplosion?.(b.location, 2, { breaksBlocks: false, causesFire: false });
          for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) dim.getBlock({ x: Math.floor(b.location.x) + x, y: Math.floor(b.location.y) - 1, z: Math.floor(b.location.z) + z })?.setType(ROT_BLOCK);
          for (const e of dim.getEntities({ location: b.location, maxDistance: 4, excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) if (e.id !== b.id) {
            e.runCommand("damage @s 4 entity_explosion");
            applySickly(e, 160, 1);
          }
          b.remove();
        }
      }
    }
  }
}, 20);
function trySummonBiomassHive(player) {
  const h = findNearbyHarvester(player);
  const bases = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
  for (const o of bases) {
    const b = player.dimension.getBlock({ x: Math.floor(h.x) + o.x, y: Math.floor(h.y) - 1, z: Math.floor(h.z) + o.z });
    if (b?.typeId !== `${NS}:calcified_bone_block`) return false;
  }
  for (const o of bases) player.dimension.getBlock({ x: Math.floor(h.x) + o.x, y: Math.floor(h.y) - 1, z: Math.floor(h.z) + o.z })?.setType("minecraft:air");
  clearOne(player, PURE_HEART);
  const boss = player.dimension.spawnEntity(BIOMASS_HIVE, { x: h.x, y: h.y + 1, z: h.z });
  boss.addTag(`${NS}_boss`);
  boss.setDynamicProperty("biomass_phase", 1);
  boss.setDynamicProperty("biomass_anchor_x", h.x);
  boss.setDynamicProperty("biomass_anchor_y", h.y + 1);
  boss.setDynamicProperty("biomass_anchor_z", h.z);
  player.dimension.playSound(`${SOUND}.biomass_hive_roar`, boss.location, { volume: 2, pitch: 0.7 });
  player.sendMessage("\xA74The Biomass Hive-Mind anchors itself to the Harvester.");
  return true;
}
function openJournal(player) {
  const h = findNearbyHarvester(player);
  const score = Number(world.getDynamicProperty(`custom:chum_score:${chumKey(h, player.dimension.id)}`) ?? 0);
  new ActionFormData().title("\xA7l\xA74The Anatomist's Journal").body(`\xA78Local Harvester Chum Score: \xA7c${score}

\xA76Organic Forgery Recipes:
\xA77\u2022 Bile-Spitter: bone, sinew, ichor and carcass.
\u2022 Symbiotic Exoskeleton: The Apex Spine plus the anatomical armor set at the Organic Forgery.
\u2022 Flesh Shield: cured hide, dense bone, sinew and necrotic ichor.

\xA7aRot Tiers:
\xA72Fresh (67-100): stable, faster living gear.
\xA76Fermented (34-66): heavy defense and knockback resistance.
\xA75Putrid (0-33): risky predator camouflage and emergency invisibility.

Feed living gear raw meat to raise wellness; combat and time decay it.`).button("\xA7cClose").show(player).catch(() => {
  });
}
var journalComponent = { onUse(e) {
  if (e.source instanceof Player) openJournal(e.source);
} };
var fleshShieldComponent = { onUse(e) {
  const p = e.source;
  if (p instanceof Player) p.setDynamicProperty("organic_flesh_shield_blocking", system.currentTick + 10);
} };
world.afterEvents.projectileHitEntity.subscribe((event) => {
  const proj = event.projectile;
  if (!proj?.isValid || proj.typeId !== HARPOON_PROJECTILE) return;
  const ownerId = String(proj.getDynamicProperty("organic_owner") ?? "");
  const t = activeHarpoons.get(ownerId);
  const victim = event.getEntityHit?.()?.entity;
  if (!t || !victim || victim instanceof Player) {
    clearHarpoon(ownerId, true, "random.bowhit");
    return;
  }
  t.victimId = victim.id;
  t.projectileId = void 0;
  activeHarpoons.set(ownerId, t);
  victim.runCommand("effect @s slowness 30 6 true");
  victim.setDynamicProperty("organic_harpooned_by", ownerId);
  victim.dimension.spawnParticle("minecraft:critical_hit_emitter", victim.location);
  proj.remove();
  const p = playerById(ownerId);
  if (p?.isValid) {
    p.setDynamicProperty("organic_harpoon_target", victim.id);
    p.onScreenDisplay.setActionBar("\xA74Barbed spine lodged. Use the sinew spool to reel.");
    p.dimension.playSound("mob.skeleton.hurt", victim.location, { volume: 1, pitch: 0.7 });
  }
});
world.afterEvents.projectileHitBlock.subscribe((event) => {
  const proj = event.projectile;
  if (!proj?.isValid || proj.typeId !== HARPOON_PROJECTILE) return;
  const ownerId = String(proj.getDynamicProperty("organic_owner") ?? "");
  proj.remove();
  const p = playerById(ownerId);
  if (p?.isValid) p.onScreenDisplay.setActionBar("\xA77The harpoon buries itself in the ground and reels back.");
  clearHarpoon(ownerId, true, "random.bowhit");
});
world.afterEvents.entityDie.subscribe((event) => {
  const dead = event.deadEntity;
  if (!dead) return;
  for (const [pid, t] of activeHarpoons) if (t.victimId === dead.id || t.projectileId === dead.id || pid === dead.id) clearHarpoon(pid, true, "random.break");
});
world.beforeEvents.playerLeave.subscribe((event) => {
  activeHarpoons.delete(event.playerId ?? event.player?.id ?? "");
});
system.runInterval(() => {
  for (const [pid, t] of activeHarpoons) {
    const p = playerById(pid);
    if (!p?.isValid) {
      activeHarpoons.delete(pid);
      continue;
    }
    if (system.currentTick - t.firedTick > 120 && !t.victimId) {
      clearHarpoon(pid, true, "random.bowhit");
      continue;
    }
    const victim = findEntityNear(p, t.victimId);
    if (!victim) continue;
    const start = p.getHeadLocation();
    start.y -= 0.45;
    const end = { x: victim.location.x, y: victim.location.y + 0.8, z: victim.location.z };
    const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z, dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > 24) {
      p.sendMessage("\xA7cThe harpoon line snapped!\xA7r");
      clearHarpoon(pid, true, "random.break");
      continue;
    }
    const points = dist > 12 ? 6 : 4;
    for (let i = 1; i <= points; i++) {
      const f = i / (points + 1);
      p.dimension.spawnParticle("minecraft:redstone_wire_dust_particle", { x: start.x + dx * f, y: start.y + dy * f, z: start.z + dz * f });
    }
  }
}, 2);
function forgePage(player, title, body) {
  new ActionFormData().title(title).body(body).button("\xA77\u25c0 Back").button("\xA7cClose").show(player).then((r) => {
    if (!r.canceled && r.selection === 0) showForgeUi(player);
  }).catch(() => {
  });
}
function showForgeUi(player) {
  new ActionFormData().title("\xA7l\xA74ORGANIC FORGE \xA78// \xA7cLive Grafting").body("\xA78\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\xA7cBone clamps \u2022 pulsing valves \u2022 marrow channels\n\xA78\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\xA77Craft living gear, feed it raw flesh to stabilize Wellness, or let it decay into Putrid mutations for riskier power.").button("\xA7l\xA7cLIVING WEAPONS\n\xA78Blade \u2022 Flail \u2022 Spitter \u2022 Anchor", ITEM_ICON("marrow_blade")).button("\xA7l\xA76ANATOMICAL ARMOR\n\xA78Crown \u2022 Carapace \u2022 Greaves \u2022 Treads", ITEM_ICON("ocular_crown")).button("\xA7l\xA75HARVEST CYCLE\n\xA78Stronger prey yields richer carcasses", ITEM_ICON("raw_carcass")).show(player).then((r) => {
    if (r.canceled) return;
    if (r.selection === 0) forgePage(player, "\xA7l\xA7cLIVING WEAPONS", `\xA7c\u2022 Living Bone Blade\xA77: vampiric; builds a Sanguine combo into a life-draining Feast.
\xA7c\u2022 Marrow-Blade\xA77: stacks kinetic charge - jump-crit or sprint-strike erupts an Osteo-Spike.
\xA7c\u2022 Bile-Spitter\xA77: sneak-use loads 5 charges - rotten flesh (toxic), raw carcass (shrapnel cone), spider eye (sickly).
\xA7c\u2022 Adaptive Arm-Blade\xA77: sneak-use cycles Severing / Sweeping / Kinetic stances; use to leap-slam.
\xA7c\u2022 Vertebrae Flail \xB7 Flesh-Anchor \xB7 Spine-Harpoon \xB7 Cremation Wand\xA77 and more.`);
    else if (r.selection === 1) forgePage(player, "\xA7l\xA76ANATOMICAL ARMOR", `\xA76The anatomical set - Ocular Crown, Rib-Cage Carapace, Sinew Greaves, Marrow Treads - shares one Wellness pool.

\xA77Full set: lifesteal with the Living Blade, rot-tier synergies, and Wellness gains on kills.
\xA78Feed it raw meat to keep it Fresh for speed; let it turn Putrid for predator camouflage.`);
    else if (r.selection === 2) forgePage(player, "\xA7l\xA75HARVEST CYCLE", `\xA75Butcher animals below 30% HP with the Butcher's Knife for Raw Carcasses.

\xA77Grind carcasses at The Harvester (with coal) for marrow, sinew, bone and hide - and to build Chum that corrupts the land.
\xA78Catalysts: Fermented Spider Eye \u2192 Necrotic Ichor \xB7 Amethyst Shard \u2192 Crystalline Marrow.`);
  }).catch(() => {
  });
}
system.beforeEvents.startup.subscribe(({ blockComponentRegistry, itemComponentRegistry }) => {
  blockComponentRegistry.registerCustomComponent(`${NS}:place_harvester`, harvesterPlaceComponent);
  blockComponentRegistry.registerCustomComponent(`${NS}:pheromone_vent`, pheromoneVentComponent);
  itemComponentRegistry.registerCustomComponent(`${NS}:process_carcass`, processCarcassComponent);
  itemComponentRegistry.registerCustomComponent(`${NS}:living_gear_feed`, feedGearComponent);
  itemComponentRegistry.registerCustomComponent(`${NS}:vertebrae_flail`, flailComponent);
  itemComponentRegistry.registerCustomComponent(`${NS}:bile_spitter`, spitterComponent);
  itemComponentRegistry.registerCustomComponent(`${NS}:marrow_blade`, marrowBladeComponent);
  itemComponentRegistry.registerCustomComponent(`${NS}:spine_harpoon`, spineHarpoonComponent);
  itemComponentRegistry.registerCustomComponent(`${NS}:sinew_spool`, sinewSpoolComponent);
  itemComponentRegistry.registerCustomComponent(`${NS}:cremation_wand`, cremationWandComponent);
  itemComponentRegistry.registerCustomComponent(`${NS}:flesh_anchor`, anchorComponent);
  itemComponentRegistry.registerCustomComponent(`${NS}:adrenaline_gland`, glandComponent);
  itemComponentRegistry.registerCustomComponent(`${NS}:homunculus_ward`, homunculusWardComponent);
  itemComponentRegistry.registerCustomComponent(`${NS}:parasitic_pickaxe`, parasiticPickaxeComponent);
  itemComponentRegistry.registerCustomComponent(`${NS}:rib_cracker`, ribCrackerComponent);
  itemComponentRegistry.registerCustomComponent(`${NS}:anatomists_journal`, journalComponent);
  itemComponentRegistry.registerCustomComponent(`${NS}:flesh_shield`, fleshShieldComponent);
  itemComponentRegistry.registerCustomComponent(`${NS}:butchers_knife`, {});
});
world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
  const player = event.player;
  const target = event.target;
  const held = selectedType(player);
  if (target.typeId === HOMUNCULUS_BASE && (held === "minecraft:fermented_spider_eye" || held === "minecraft:magma_cream" || held === `${NS}:dense_bone`)) {
    event.cancel = true;
    system.run(() => {
      const next = held === "minecraft:fermented_spider_eye" ? HOMUNCULUS_VENOM : held === "minecraft:magma_cream" ? HOMUNCULUS_MORTAR : HOMUNCULUS_BULWARK;
      const loc2 = target.location;
      target.remove();
      const h = player.dimension.spawnEntity(next, loc2);
      h.addTag(`${NS}_homunculus`);
      h.setDynamicProperty("organic_owner", player.name);
      h.runCommand("effect @s slowness 999999 255 true");
      if (next === HOMUNCULUS_BULWARK) h.runCommand("effect @s resistance 999999 3 true");
      clearOne(player, held);
    });
    return;
  }
  if (held === WAND) {
    event.cancel = true;
    system.run(() => {
      if (target.typeId === CREMATION_ALLY && target.getDynamicProperty("organic_owner") === player.name) {
        if (player.isSneaking && hasItem(player, ADAPTIVE_ARM_BLADE)) triggerAllyUlt(player, target);
        else player.onScreenDisplay.setActionBar("\xA77Sneak + hold the Adaptive Arm-Blade, then use the Wand to unleash the Ascension.");
        return;
      }
      let marked = false;
      for (const a of player.dimension.getEntities({ location: player.location, maxDistance: 64, type: CREMATION_ALLY })) if (a.getDynamicProperty("organic_owner") === player.name) {
        a.setDynamicProperty("currentTarget", target.id);
        a.setDynamicProperty("organic_order_x", target.location.x);
        a.setDynamicProperty("organic_order_y", target.location.y);
        a.setDynamicProperty("organic_order_z", target.location.z);
        marked = true;
      }
      player.dimension.playSound(`${SOUND}.cremation_command_screech`, player.location, { volume: 1, pitch: 1.1 });
      player.onScreenDisplay.setActionBar(marked ? "\xA75The Cremation Ally marks your prey." : "\xA77Summon a Cremation Ally first.");
    });
    return;
  }
  if (held !== `${NS}:butchers_knife` || !FARM_MOBS.has(target.typeId)) return;
  if (getHealthRatio(target) > HARVEST_THRESHOLD_RATIO) {
    player.sendMessage("\xA77Weaken this animal below 30% health before harvesting.");
    return;
  }
  event.cancel = true;
  const loc = target.location, maxHp = getHealthMax(target);
  target.dimension.spawnParticle("minecraft:redstone_wire_dust_particle", loc);
  target.dimension.playSound("mob.skeleton.hurt", loc, { pitch: 0.45, volume: 1.2 });
  target.remove();
  const count = maxHp >= 28 ? 3 : maxHp >= 15 ? 2 : maxHp >= 8 ? 1 : 0;
  if (count > 0) player.runCommand(`give @s ${RAW_CARCASS} ${count}`);
  else player.sendMessage("\xA78This weak creature yielded only scraps, not a useful carcass.");
});
world.afterEvents.entityDie.subscribe((event) => {
  const killer = event.damageSource.damagingEntity;
  if (killer instanceof Player) {
    if (fullAnatomicalSet(killer)) addWellness(killer, Math.max(2, Math.min(18, Math.ceil(getHealthMax(event.deadEntity) / 5))));
    if (hasItem(killer, WAND)) {
      killer.setDynamicProperty("organic_wand_points", Math.min(100, Number(killer.getDynamicProperty("organic_wand_points") ?? 0) + 5));
      killer.setDynamicProperty("organic_wand_last_damage", system.currentTick);
    }
  }
});
world.beforeEvents.itemUse.subscribe((event) => {
  const p = event.source;
  if (!(p instanceof Player) || event.itemStack?.typeId !== PURE_HEART) return;
  const b = p.getBlockFromViewDirection?.({ maxDistance: 5 })?.block;
  if (!b?.typeId?.startsWith(`${NS}:harvester`)) return;
  event.cancel = true;
  system.run(() => {
    if (!trySummonBiomassHive(p)) p.sendMessage("\xA77Place four Calcified Bone Blocks on the cardinal sides around the Harvester's base first.");
  });
});
system.runInterval(() => {
  for (const dimName of ["overworld", "nether", "the_end"]) {
    const dim = world.getDimension(dimName);
    for (const boss of dim.getEntities({ type: BIOMASS_HIVE })) {
      const phase = Number(boss.getDynamicProperty("biomass_phase") ?? 1);
      const ratio = getHealthRatio(boss);
      if (phase === 1) {
        boss.applyImpulse({ x: Number(boss.getDynamicProperty("biomass_anchor_x") ?? boss.location.x) - boss.location.x, y: 0, z: Number(boss.getDynamicProperty("biomass_anchor_z") ?? boss.location.z) - boss.location.z });
        if (system.currentTick % 200 === 0 && boss.dimension.getEntities({ type: GRAFTED_STALKER, location: boss.location, maxDistance: 22 }).length < 4) boss.dimension.spawnEntity(GRAFTED_STALKER, { x: boss.location.x + Math.random() * 6 - 3, y: boss.location.y, z: boss.location.z + Math.random() * 6 - 3 });
        if (ratio <= 0.5) {
          boss.setDynamicProperty("biomass_phase", 2);
          boss.dimension.playSound(`${SOUND}.biomass_hive_roar`, boss.location, { volume: 2.5, pitch: 0.55 });
          boss.runCommand("effect @s speed 999999 2 true");
        }
      } else {
        if (system.currentTick % 60 === 0) {
          const target = boss.dimension.getPlayers({ location: boss.location, maxDistance: 24 })[0];
          if (target) {
            const dx = target.location.x - boss.location.x, dz = target.location.z - boss.location.z, m = Math.max(0.1, Math.sqrt(dx * dx + dz * dz));
            boss.applyImpulse({ x: dx / m * 1.6, y: 0.15, z: dz / m * 1.6 });
          }
        }
        if (system.currentTick % 160 === 0) for (let x = -3; x < 3; x++) for (let z = -3; z < 3; z++) {
          const b = dim.getBlock({ x: Math.floor(boss.location.x) + x, y: Math.floor(boss.location.y) - 1, z: Math.floor(boss.location.z) + z });
          if (b && b.typeId !== "minecraft:bedrock") b.setType(ROT_BLOCK);
        }
      }
    }
  }
}, 20);
world.afterEvents.entityHurt.subscribe((ev) => {
  const hurt = ev.hurtEntity;
  const attacker = ev.damageSource.damagingEntity;
  if (hurt.typeId === BIOMASS_HIVE && Number(hurt.getDynamicProperty("biomass_phase") ?? 1) === 1 && ev.damageSource.cause?.toString?.().includes("projectile")) system.run(() => hurt.runCommand("effect @s instant_health 1 1 true"));
  if (hurt instanceof Player && (offhandType(hurt) === FLESH_SHIELD || hasItem(hurt, FLESH_SHIELD)) && system.currentTick >= Number(hurt.getDynamicProperty("organic_parasite_cd") ?? 0)) {
    const dmg = Math.max(1, ev.damage ?? 1);
    hurt.runCommand(`effect @s instant_health 1 ${Math.min(9, Math.ceil(dmg / 2))} true`);
    hurt.runCommand("effect @s absorption 5 0 true");
    hurt.setDynamicProperty("organic_parasite_cd", system.currentTick + 120);
    hurt.dimension.playSound("mob.slime.attack", hurt.location, { volume: 1, pitch: 0.6 });
    for (let i = 0; i < 12; i++) hurt.dimension.spawnParticle("minecraft:redstone_wire_dust_particle", { x: hurt.location.x + (Math.random() - 0.5) * 1.2, y: hurt.location.y + 0.5 + Math.random(), z: hurt.location.z + (Math.random() - 0.5) * 1.2 });
    const target = attacker && !(attacker instanceof Player) ? attacker : hurt.dimension.getEntities({ location: hurt.location, maxDistance: 5, excludeTypes: ["minecraft:item", "minecraft:xp_orb"] }).find((en) => hostileForBlade(en, hurt));
    if (target?.isValid) {
      target.runCommand("effect @s slowness 3 7 true");
      target.runCommand("effect @s weakness 3 2 true");
      const dx = target.location.x - hurt.location.x, dz = target.location.z - hurt.location.z;
      for (let i = 1; i <= 6; i++) hurt.dimension.spawnParticle("minecraft:redstone_wire_dust_particle", { x: hurt.location.x + dx * i / 7, y: hurt.location.y + 1, z: hurt.location.z + dz * i / 7 });
    }
    hurt.onScreenDisplay.setActionBar("\xA7aSymbiotic Parasite intercepts the blow! \xA78Tendril recovering \xA7c6s");
  }
});
world.afterEvents.entityHurt.subscribe((ev) => {
  const victim = ev.hurtEntity;
  if (!(victim instanceof Player) || !isHoldingChimeraShield(victim) || !victim.isSneaking) return;
  const attacker = ev.damageSource.damagingEntity;
  const facing = view(victim);
  if (attacker?.isValid) {
    const dx = attacker.location.x - victim.location.x, dz = attacker.location.z - victim.location.z, m = Math.max(0.1, Math.sqrt(dx * dx + dz * dz));
    if (facing.x * (dx / m) + facing.z * (dz / m) <= -0.25) return;
  }
  const dmg = Math.max(1, ev.damage ?? 1);
  victim.runCommand(`effect @s instant_health 1 ${Math.min(8, Math.max(1, Math.floor(dmg / 5)))} true`);
  victim.dimension.playSound("random.shield_block", victim.location, { volume: 1, pitch: 0.85 });
  victim.dimension.spawnParticle("minecraft:critical_hit_emitter", { x: victim.location.x + facing.x, y: victim.location.y + 1, z: victim.location.z + facing.z });
  victim.onScreenDisplay.setActionBar("\xA76Living Carapace Shield \xA78— \xA7fraised, blow blocked");
});
world.afterEvents.entityHurt.subscribe((ev) => {
  const victim = ev.hurtEntity;
  if (!(victim instanceof Player) || !fullSet(victim, MEAT)) return;
  if (system.currentTick < Number(victim.getDynamicProperty("organic_parasitized_cd") ?? 0)) return;
  victim.setDynamicProperty("organic_parasitized_cd", system.currentTick + 900);
  const dmg = Math.max(1, ev.damage ?? 1);
  victim.runCommand(`effect @s instant_health 1 ${Math.min(9, Math.ceil(dmg / 2))} true`);
  victim.runCommand("effect @s absorption 20 1 true");
  victim.runCommand("effect @s health_boost 30 1 true");
  victim.runCommand("effect @s regeneration 4 1 true");
  victim.dimension.playSound("mob.slime.attack", victim.location, { volume: 1.1, pitch: 0.5 });
  for (let i = 0; i < 16; i++) victim.dimension.spawnParticle("minecraft:redstone_wire_dust_particle", { x: victim.location.x + (Math.random() - 0.5) * 1.4, y: victim.location.y + 0.4 + Math.random() * 1.6, z: victim.location.z + (Math.random() - 0.5) * 1.4 });
  const attacker = ev.damageSource.damagingEntity;
  const target = attacker && !(attacker instanceof Player) ? attacker : victim.dimension.getEntities({ location: victim.location, maxDistance: 5, excludeTypes: ["minecraft:item", "minecraft:xp_orb"] }).find((en) => hostileForBlade(en, victim));
  if (target?.isValid) {
    target.runCommand("effect @s slowness 5 10 true");
    target.runCommand("effect @s weakness 5 3 true");
    const dx = target.location.x - victim.location.x, dz = target.location.z - victim.location.z;
    for (let i = 1; i <= 6; i++) victim.dimension.spawnParticle("minecraft:redstone_wire_dust_particle", { x: victim.location.x + dx * i / 7, y: victim.location.y + 1, z: victim.location.z + dz * i / 7 });
  }
  victim.onScreenDisplay.setActionBar("\xA7c\xA7lPARASITIZED!\xA7r \xA78Churning tendrils tangle your attacker \xB7 \xA7c20s");
});
world.afterEvents.entityHurt.subscribe((event) => {
  const attacker = event.damageSource.damagingEntity;
  const victim = event.hurtEntity;
  const dmg = Math.max(1, event.damage ?? 1);
  const sickTier = Number(victim.getDynamicProperty("sickly_tier") ?? 0), sickUntil = Number(victim.getDynamicProperty("sickly_expires") ?? victim.getDynamicProperty("organic_sickly_until") ?? 0);
  if (sickTier > 0 && sickUntil > system.currentTick && Number(victim.getDynamicProperty("organic_sickly_bonus_tick") ?? -1) !== system.currentTick) {
    victim.setDynamicProperty("organic_sickly_bonus_tick", system.currentTick);
    victim.runCommand(`damage @s ${Math.max(1, dmg * 0.5)} magic`);
  }
  if (attacker?.typeId === CREMATION_ALLY) {
    const combo = Number(attacker.getDynamicProperty("organic_combo") ?? 0) % 3 + 1;
    attacker.setDynamicProperty("organic_combo", combo);
    if (Math.random() < 0.2) applySickly(victim, 120, 1);
    if (combo === 1) victim.runCommand("damage @s 6 entity_attack");
    else if (combo === 2) {
      victim.runCommand("damage @s 10 entity_attack");
      victim.applyImpulse({ x: Math.max(-2.5, Math.min(2.5, victim.location.x - attacker.location.x)), y: 0.35, z: Math.max(-2.5, Math.min(2.5, victim.location.z - attacker.location.z)) });
    } else {
      victim.runCommand("damage @s 14 entity_attack");
      applyBleed(victim);
    }
  }
  if (victim.typeId === CREMATION_ALLY && attacker instanceof Player && victim.getDynamicProperty("organic_owner") === attacker.name) {
    victim.runCommand("effect @s instant_health 1 3 true");
    return;
  }
  if (attacker?.typeId === DEVOURER && Number(attacker.getDynamicProperty("organic_script_attack_tick") ?? 0) !== system.currentTick) devourerDoAttack(attacker, victim);
  if (attacker instanceof Player && hasItem(attacker, WAND)) {
    const n = Math.min(100, Number(attacker.getDynamicProperty("cremation_charge") ?? attacker.getDynamicProperty("organic_wand_points") ?? 0) + dmg);
    attacker.setDynamicProperty("cremation_charge", n);
    attacker.setDynamicProperty("organic_wand_points", n);
    attacker.setDynamicProperty("organic_wand_last_damage", system.currentTick);
  }
  if (victim instanceof Player && hasItem(victim, WAND)) {
    const n = Math.min(100, Number(victim.getDynamicProperty("cremation_charge") ?? victim.getDynamicProperty("organic_wand_points") ?? 0) + dmg);
    victim.setDynamicProperty("cremation_charge", n);
    victim.setDynamicProperty("organic_wand_points", n);
  }
  if (attacker instanceof Player && fullAnatomicalSet(attacker) && rotTier(getWellness(attacker)) === "Fresh") {
    const n = Math.min(5, Number(attacker.getDynamicProperty("organic_rot_sync_hits") ?? 0) + 1);
    attacker.setDynamicProperty("organic_rot_sync_hits", n);
    attacker.setDynamicProperty("organic_rot_sync_last_hit", system.currentTick);
    attacker.runCommand(`effect @s speed 3 ${Math.min(3, n)} true`);
    attacker.runCommand(`effect @s haste 3 ${Math.min(3, n)} true`);
  }
  if (attacker instanceof Player && selectedType(attacker) === LIVING_BLADE && hostileForBlade(victim, attacker)) {
    const maxHp = getHealthMax(victim);
    attacker.dimension.spawnParticle("minecraft:heart_particle", { x: attacker.location.x, y: attacker.location.y + 1, z: attacker.location.z });
    if (fullAnatomicalSet(attacker)) {
      const heal = Math.max(1, Math.min(6, Math.floor(dmg * 0.55 * (20 / (20 + maxHp)))));
      attacker.runCommand(`effect @s instant_health 1 ${Math.max(0, heal - 1)} true`);
    } else attacker.runCommand("effect @s instant_health 1 0 true");
    const last = Number(attacker.getDynamicProperty("organic_sanguine_last") ?? -99999);
    let charge = system.currentTick - last > 60 ? 1 : Number(attacker.getDynamicProperty("organic_sanguine_charge") ?? 0) + 1;
    attacker.setDynamicProperty("organic_sanguine_last", system.currentTick);
    if (charge >= 5) {
      attacker.setDynamicProperty("organic_sanguine_charge", 0);
      attacker.runCommand("effect @s regeneration 5 1 true");
      attacker.runCommand("effect @s absorption 12 1 true");
      attacker.dimension.playSound("mob.warden.heartbeat", attacker.location, { volume: 1, pitch: 1.2 });
      for (const ent of attacker.dimension.getEntities({ location: victim.location, maxDistance: 3.5, excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) if (hostileForBlade(ent, attacker)) {
        ent.runCommand("damage @s 5 magic");
        ent.dimension.spawnParticle("minecraft:redstone_wire_dust_particle", { x: ent.location.x, y: ent.location.y + 1, z: ent.location.z });
      }
      attacker.onScreenDisplay.setActionBar("\xA74Sanguine Feast! \xA7cLife torn free in a bloody pulse.");
    } else {
      attacker.setDynamicProperty("organic_sanguine_charge", charge);
      attacker.onScreenDisplay.setActionBar(`\xA7cLiving Bone Blade \xA74❤ \xA7fSanguine ${charge}/5`);
    }
    if (getWellness(attacker) <= 0) {
      applySickly(victim, 140);
      victim.dimension.spawnParticle("minecraft:mobspell_emitter", victim.location);
    }
  }
  if (victim instanceof Player && fullAnatomicalSet(victim) && rotTier(getWellness(victim)) === "Fermented" && event.damageSource.cause === "projectile") victim.runCommand(`effect @s instant_health 1 ${Math.max(0, Math.floor((event.damage ?? 2) / 4))} true`);
  if (victim.typeId === HOMUNCULUS_BULWARK && attacker) attacker.runCommand("damage @s 5 thorns");
  if (victim instanceof Player && armor(victim, "Chest") === ARMOR.chest && attacker) {
    attacker.runCommand("damage @s 3 entity_thorns");
    victim.runCommand("effect @s instant_health 1 0 true");
  }
  if (victim instanceof Player && isHoldingChimeraShield(victim) && attacker) {
    applySickly(attacker, 140);
    attacker.runCommand("damage @s 2 magic");
    victim.dimension.spawnParticle("minecraft:mobspell_emitter", attacker.location);
  }
  if (victim instanceof Player && Number(victim.getDynamicProperty("organic_anchor_fall_cancel") ?? 0) > system.currentTick && event.damageSource.cause === "fall") victim.runCommand("effect @s resistance 1 255 true");
});
world.afterEvents.entityHurt.subscribe((event) => {
  if (event.damageSource.damagingEntity instanceof Player) event.damageSource.damagingEntity.setDynamicProperty("organic_noise_until", system.currentTick + 80);
  if (event.hurtEntity.typeId === MARROW_GHAST) event.hurtEntity.runCommand("effect @s levitation 1 0 true");
});
world.afterEvents.entityHurt.subscribe((event) => {
  const attacker = event.damageSource.damagingEntity;
  const victim = event.hurtEntity;
  if (!(attacker instanceof Player) || selectedType(attacker) !== MARROW_BLADE || getHealthRatio(victim) >= 0.4) return;
  const last = Number(victim.getDynamicProperty("organic_marrow_crit_tick") ?? -99999);
  if (system.currentTick - last < 4) return;
  victim.setDynamicProperty("organic_marrow_crit_tick", system.currentTick);
  const bonus = Math.max(2, Math.floor((event.damage ?? 3) * 2));
  victim.runCommand(`damage @s ${bonus} entity_attack`);
  addWellness(attacker, 10);
  attacker.onScreenDisplay.setActionBar("\xA7fMarrow-Blade execution: \xA7c3x critical \xA77and \xA7a+10% wellness");
  attacker.dimension.spawnParticle("minecraft:critical_hit_emitter", victim.location);
  attacker.dimension.playSound("mob.skeleton.hurt", victim.location, { pitch: 0.55, volume: 1.2 });
});
world.afterEvents.playerBreakBlock.subscribe((event) => event.player.setDynamicProperty("organic_noise_until", system.currentTick + 60));
function impactBileGlob(projectile, target) {
  const loc = target?.location ?? projectile.location;
  const ammo = String(projectile.getDynamicProperty("organic_ammo") ?? "minecraft:beef");
  projectile.dimension.spawnParticle("minecraft:large_explosion", loc);
  projectile.dimension.spawnParticle("minecraft:redstone_wire_dust_particle", loc);
  projectile.dimension.spawnParticle("minecraft:critical_hit_emitter", loc);
  if (ammo === "minecraft:porkchop") {
    for (const ent of projectile.dimension.getEntities({ location: loc, maxDistance: 3.5, excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) {
      ent.runCommand("damage @s 8 entity_explosion");
      ent.applyKnockback({ x: ent.location.x - loc.x, z: ent.location.z - loc.z }, 0.25);
    }
    projectile.dimension.playSound("random.explode", loc, { volume: 1.2, pitch: 0.85 });
  } else if (target) {
    if (ammo === "minecraft:mutton") {
      target.runCommand("damage @s 4 projectile");
      target.runCommand("effect @s poison 3 0 true");
    } else if (ammo === "minecraft:chicken") {
      target.runCommand("damage @s 2 projectile");
      target.runCommand("effect @s wither 5 0 true");
    } else {
      target.runCommand("damage @s 14 projectile");
    }
  }
  projectile.remove();
}
world.afterEvents.projectileHitEntity.subscribe((event) => {
  const projectile = event.projectile;
  if (projectile?.hasTag?.(`${NS}_bile_glob`)) impactBileGlob(projectile, event.getEntityHit?.().entity);
});
world.afterEvents.projectileHitEntity.subscribe((event) => {
  const projectile = event.projectile, hit = event.getEntityHit?.().entity;
  if (!projectile || !hit) return;
  if (projectile.typeId === ACID_DART) {
    hit.runCommand("effect @s poison 3 0 true");
    hit.runCommand("damage @s 4 projectile");
  }
  if (projectile.typeId === NECROTIC_SHARD) {
    hit.runCommand("effect @s blindness 4 0 true");
    hit.runCommand("effect @s slowness 5 1 true");
  }
});
world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
  if (event.block.typeId === `${NS}:organic_forgery`) system.run(() => showForgeUi(event.player));
  if (event.player.isSneaking && hasEmptyMainHand(event.player) && isChimeraShieldEquipped(event.player)) {
    event.player.setDynamicProperty("organic_shield_bash_request", system.currentTick + 3);
    system.run(() => chimeraShieldComponent.onUse?.({ source: event.player }, {}));
  }
});
world.beforeEvents.itemUse.subscribe((event) => {
  if (event.itemStack?.typeId === CHIMERA_SHIELD && event.source instanceof Player && event.source.isSneaking && hasEmptyMainHand(event.source) && isChimeraShieldEquipped(event.source)) system.run(() => chimeraShieldComponent.onUse?.({ source: event.source }, {}));
  if (event.itemStack?.typeId === "minecraft:rotten_flesh" && event.source instanceof Player) system.run(() => {
    setWellness(event.source, getWellness(event.source) - 15);
    event.source.sendMessage("\xA72Rotten flesh sickens your living armor wellness.");
  });
});
system.runInterval(() => {
  for (const p of world.getPlayers()) {
    const wearing = ["Head", "Chest", "Legs", "Feet"].filter((s) => armor(p, s) && WELLNESS_ITEMS.has(armor(p, s))).length;
    const held = selectedType(p);
    if (wearing > 0) setWellness(p, getWellness(p) - Math.max(0.04, 0.13 * wearing));
    const w = getWellness(p);
    if (w <= 0 && wearing > 0) {
      p.dimension.spawnParticle("minecraft:mobspell_emitter", { x: p.location.x, y: p.location.y + 1.1, z: p.location.z });
      p.runCommand("effect @s hunger 2 0 true");
    }
    if (p.isSneaking && hasEmptyMainHand(p) && isChimeraShieldEquipped(p) && Number(p.getDynamicProperty("organic_shield_bash_sneak_lock") ?? 0) <= system.currentTick) triggerShieldBash(p);
    const showWellness = wearing > 0 || held !== void 0 && FLESH_ITEMS.has(held);
    const parts = [];
    if (showWellness) {
      const tc = w >= 67 ? "\xA7a" : w >= 34 ? "\xA76" : "\xA75";
      parts.push(`\xA7c❤ \xA7fWellness ${hudBar(w / 100, tc)} ${tc}${Math.floor(w)} \xA78${rotTier(w)}`);
    }
    const swellStart = Number(p.getDynamicProperty("organic_gland_swell_start") ?? 0);
    if (swellStart > 0 && selectedType(p) === GLAND) {
      parts.push(`\xA74☠ \xA7fGland ${hudBar(Math.min(1, (system.currentTick - swellStart) / 60), "\xA7c")} \xA7cswelling`);
      p.dimension.spawnParticle("minecraft:redstone_wire_dust_particle", { x: p.location.x, y: p.location.y + 1, z: p.location.z });
    }
    const heldName = held === GLAND ? ["Gland", cooldownLeft(p, "organic_gland_cd", COOLDOWN.gland), COOLDOWN.gland] : held === ANCHOR ? ["Anchor", cooldownLeft(p, "organic_anchor_cd", COOLDOWN.anchor), COOLDOWN.anchor] : held === FLAIL ? ["Flail", cooldownLeft(p, "organic_flail_cd", COOLDOWN.flail), COOLDOWN.flail] : held === SPITTER ? ["Spitter", cooldownLeft(p, "organic_spitter_cd", COOLDOWN.spitter), COOLDOWN.spitter] : held === RIB_CRACKER ? ["Slam", cooldownLeft(p, "organic_rib_slam_cd", 100), 100] : held === CHIMERA_SHIELD || isChimeraShieldEquipped(p) ? ["Shield", cooldownLeft(p, "organic_chimera_shield_cd", COOLDOWN.shield), COOLDOWN.shield] : void 0;
    if (heldName) {
      const left = heldName[1], total = heldName[2];
      parts.push(left > 0 ? `\xA76⚡ \xA7f${heldName[0]} ${hudBar((total - left) / total, "\xA7e")} \xA7e${Math.ceil(left / 20)}s` : `\xA76⚡ \xA7f${heldName[0]} ${hudBar(1, "\xA7a")} \xA7aReady`);
    }
    if (hasItem(p, WAND)) {
      if (system.currentTick % 20 === 0) p.setDynamicProperty("organic_wand_points", Math.min(100, Number(p.getDynamicProperty("organic_wand_points") ?? 0) + 1));
      const pts = Math.min(100, Number(p.getDynamicProperty("organic_wand_points") ?? 0)), rdy = pts >= 100;
      parts.push(`${rdy ? "\xA7d" : "\xA75"}❉ \xA7fWand ${hudBar(pts / 100, rdy ? "\xA7d" : "\xA75")} ${pts}/100${rdy ? " \xA7dSNEAK-USE" : ""}`);
    }
    if (parts.length) p.onScreenDisplay.setActionBar(parts.join("  \xA78┃  "));
  }
}, 10);
system.runInterval(() => {
  for (const player of world.getPlayers()) {
    if (armor(player, "Legs") === ARMOR.legs && player.isSneaking && player.isJumping) {
      const d = view(player);
      player.applyKnockback({ x: d.x * 2.2, z: d.z * 2.2 }, 1.05);
      player.setDynamicProperty("organic_anchor_fall_cancel", system.currentTick + 120);
    }
    const worn = [armor(player, "Head"), armor(player, "Chest"), armor(player, "Legs"), armor(player, "Feet")].filter((id) => !!id && WELLNESS_ITEMS.has(id));
    if (worn.length) {
      const tier = rotTier(getWellness(player));
      const synced = worn.length === 4;
      if (tier === "Fresh") {
        const hits = Number(player.getDynamicProperty("organic_rot_sync_hits") ?? 0);
        if (system.currentTick - Number(player.getDynamicProperty("organic_rot_sync_last_hit") ?? 0) > 100) player.setDynamicProperty("organic_rot_sync_hits", 0);
        player.runCommand(`effect @s speed 3 ${synced ? Math.min(3, hits) : 1} true`);
        player.runCommand(`effect @s haste 3 ${synced ? Math.min(3, hits) : 0} true`);
        if (synced && (player.isSprinting || system.currentTick - Number(player.getDynamicProperty("organic_rot_sync_last_hit") ?? 0) < 80)) player.runCommand("effect @s hunger 2 1 true");
      }
      if (tier === "Fermented" && synced) {
        player.runCommand("effect @s resistance 3 0 true");
        if (player.isInWater) player.applyKnockback({ x: 0, z: 0 }, -0.45);
      }
      if (tier === "Putrid") {
        player.runCommand("effect @s strength 3 0 true");
        player.runCommand("effect @s night_vision 12 0 true");
        player.runCommand("effect @s hunger 2 0 true");
        if (synced) {
          player.addTag(`${NS}_undead_ignored`);
          if (getHealthRatio(player) < 0.3) {
            player.runCommand("effect @s invisibility 4 0 true");
            for (let i = 0; i < 8; i++) player.dimension.spawnParticle("minecraft:mobspell_emitter", { x: player.location.x + Math.cos(i) * 1.4, y: player.location.y + 0.4, z: player.location.z + Math.sin(i) * 1.4 });
          }
        }
      } else player.removeTag(`${NS}_undead_ignored`);
    }
  }
  for (const dimName of ["overworld", "nether", "the_end"]) {
    const dim = world.getDimension(dimName);
    // Homunculus turret attacks are driven by their data-driven minecraft:shooter
    // (acid_dart / wither_skull) which now have client render definitions, so their
    // projectiles are visible. The Bulwark's Sickly aura is handled in its own interval.
    for (const d of dim.getEntities({ type: DEVOURER })) {
      const birth = Number(d.getDynamicProperty("organic_birth") ?? system.currentTick);
      if (Number(d.getDynamicProperty("organic_spawn_scream_done") ?? 0) === 0) devourerEmergence(d);
      if (system.currentTick - birth > 2400) {
        rotArea({ dimension: d.dimension, location: d.location }, d.location, 3);
        d.remove();
        continue;
      }
      let target;
      const targetId = String(d.getDynamicProperty("organic_order_target") ?? "");
      for (const e of d.dimension.getEntities({ location: d.location, maxDistance: 18, excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) if (e.id === targetId || !target && !(e instanceof Player) && e.typeId !== DEVOURER && e.typeId !== "minecraft:wolf") target = e;
      if (target) {
        const dx = target.location.x - d.location.x, dz = target.location.z - d.location.z, m = Math.max(0.1, Math.sqrt(dx * dx + dz * dz));
        if (m > 2.2) d.applyKnockback({ x: dx / m * 0.45, z: dz / m * 0.45 }, 0.02);
        else if (Number(d.getDynamicProperty("organic_next_attack") ?? 0) <= system.currentTick) {
          d.setDynamicProperty("organic_next_attack", system.currentTick + 20);
          d.setDynamicProperty("organic_script_attack_tick", system.currentTick);
          devourerDoAttack(d, target);
          d.dimension.playSound("mob.zombie.attack_wood", d.location, { volume: 0.8, pitch: 0.7 });
        }
      } else {
        const ownerName = String(d.getDynamicProperty("organic_owner") ?? "");
        const owner = world.getPlayers().find((p) => p.name === ownerName && p.dimension.id === d.dimension.id);
        if (owner) {
          const dir = owner.getViewDirection();
          const side = { x: owner.location.x - dir.z * 1.8 - dir.x * 0.7, z: owner.location.z + dir.x * 1.8 - dir.z * 0.7 };
          const dx = side.x - d.location.x, dz = side.z - d.location.z, m = Math.max(0.1, Math.sqrt(dx * dx + dz * dz));
          if (m > 3.5) d.applyKnockback({ x: dx / m * 0.55, z: dz / m * 0.55 }, 0.02);
        }
      }
    }
  }
  for (const dimName of ["overworld", "nether", "the_end"]) {
    const dim = world.getDimension(dimName);
    for (const e of dim.getEntities({ excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) if (Number(e.getDynamicProperty("organic_sickly_until") ?? 0) > system.currentTick) {
      const y = e.location.y + 2.35;
      e.dimension.spawnParticle("minecraft:mobspell_emitter", { x: e.location.x, y, z: e.location.z });
      for (let i = 0; i < 6; i++) e.dimension.spawnParticle("minecraft:basic_smoke_particle", { x: e.location.x + Math.cos((system.currentTick + i * 20) / 6) * 0.55, y, z: e.location.z + Math.sin((system.currentTick + i * 20) / 6) * 0.55 });
    }
    for (const g of dim.getEntities({ type: BILE_GLOB })) {
      const birth = Number(g.getDynamicProperty("organic_birth") ?? system.currentTick);
      if (system.currentTick - birth > 120) {
        g.remove();
        continue;
      }
      const vx = Number(g.getDynamicProperty("organic_vx") ?? 0), vy = Number(g.getDynamicProperty("organic_vy") ?? 0), vz = Number(g.getDynamicProperty("organic_vz") ?? 0);
      if (vx || vy || vz) g.applyImpulse({ x: vx * 0.06, y: vy * 0.06, z: vz * 0.06 });
      const block = g.dimension.getBlock({ x: Math.floor(g.location.x), y: Math.floor(g.location.y), z: Math.floor(g.location.z) });
      if (block && !["minecraft:air", "minecraft:water", "minecraft:lava"].includes(block.typeId)) {
        impactBileGlob(g);
        continue;
      }
      const ownerId = String(g.getDynamicProperty("organic_owner_id") ?? "");
      const target = g.dimension.getEntities({ location: g.location, maxDistance: 1.25, excludeTypes: ["minecraft:item", "minecraft:xp_orb", BILE_GLOB] }).find((e) => e.typeId !== BILE_GLOB && !(e.id === ownerId && system.currentTick - birth < 8));
      if (target) impactBileGlob(g, target);
      else g.dimension.spawnParticle("minecraft:redstone_wire_dust_particle", g.location);
    }
  }
}, 2);
system.runInterval(() => {
  for (const dimName of ["overworld", "nether", "the_end"]) {
    const dim = world.getDimension(dimName);
    for (const e of dim.getEntities({ excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) {
      const bleedUntil = Number(e.getDynamicProperty("organic_bleed_until") ?? 0), bleedNext = Number(e.getDynamicProperty("organic_bleed_next") ?? 0), bleedTicks = Number(e.getDynamicProperty("organic_bleed_ticks") ?? 0);
      if (bleedUntil > system.currentTick && bleedNext <= system.currentTick && bleedTicks < 3) {
        e.runCommand("damage @s 1 magic");
        e.setDynamicProperty("organic_bleed_ticks", bleedTicks + 1);
        e.setDynamicProperty("organic_bleed_next", system.currentTick + 20);
      }
      if (Number(e.getDynamicProperty("organic_sickly_until") ?? 0) > system.currentTick) {
        const y = e.location.y + (e instanceof Player ? 2.2 : 2.4);
        dim.spawnParticle("minecraft:mobspell_emitter", { x: e.location.x, y, z: e.location.z });
        for (let i = 0; i < 5; i++) dim.spawnParticle("minecraft:basic_smoke_particle", { x: e.location.x + Math.cos((system.currentTick + i * 14) / 10) * 0.55, y, z: e.location.z + Math.sin((system.currentTick + i * 14) / 10) * 0.55 });
      }
      const b = dim.getBlock({ x: Math.floor(e.location.x), y: Math.floor(e.location.y - 0.1), z: Math.floor(e.location.z) });
      if (b?.typeId === ROT_BLOCK && !(e instanceof Player)) {
        applySickly(e, 60);
        e.runCommand("damage @s 1.5 magic");
      }
    }
  }
}, 20);
