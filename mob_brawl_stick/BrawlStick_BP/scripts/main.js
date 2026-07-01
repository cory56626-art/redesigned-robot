// =====================================================================
//  BRAWL STICK — make any two mobs fight each other
//  Whack (or right-click) mob A to tag it, then whack mob B: FIGHT!
//  Sneak + use the stick to clear your tag.
// =====================================================================
import {
  world,
  system,
  EquipmentSlot,
  EntityDamageCause
} from "@minecraft/server";

const STICK = "bw:brawl_stick";
const SELECT_TIMEOUT = 600;    // tag expires after 30s
const FIGHT_DURATION = 1200;   // keep the grudge alive for 60s
const REAGGRO_INTERVAL = 90;   // re-poke every 4.5s so they don't lose interest
const MAX_FIGHT_RANGE = 40;    // grudge breaks if they separate this far

// playerId -> { id: taggedEntityId, tick: whenTagged }
const selections = new Map();
// active grudges: { aId, bId, until }
const fights = [];
// playerId -> last handled tick (debounce double-fired events)
const lastAction = new Map();

// things that can't meaningfully brawl
const DENY = new Set([
  "minecraft:player", "minecraft:item", "minecraft:xp_orb",
  "minecraft:arrow", "minecraft:snowball", "minecraft:egg",
  "minecraft:ender_pearl", "minecraft:fishing_hook", "minecraft:painting",
  "minecraft:leash_knot", "minecraft:boat", "minecraft:chest_boat",
  "minecraft:minecart", "minecraft:chest_minecart", "minecraft:hopper_minecart",
  "minecraft:tnt_minecart", "minecraft:command_block_minecart",
  "minecraft:armor_stand", "minecraft:ender_crystal", "minecraft:tnt",
  "minecraft:falling_block", "minecraft:fireball", "minecraft:small_fireball",
  "minecraft:dragon_fireball", "minecraft:wither_skull", "minecraft:shulker_bullet",
  "minecraft:lightning_bolt", "minecraft:area_effect_cloud", "minecraft:eye_of_ender_signal",
  "minecraft:fireworks_rocket", "minecraft:lingering_potion", "minecraft:splash_potion",
  "minecraft:thrown_trident", "minecraft:llama_spit", "minecraft:evocation_fang",
  "minecraft:agent", "minecraft:npc", "minecraft:tripod_camera", "minecraft:balloon",
  "minecraft:ice_bomb", "minecraft:wind_charge_projectile", "minecraft:breeze_wind_charge_projectile",
  "minecraft:ominous_item_spawner"
]);

function actionbar(player, text) {
  try { player.onScreenDisplay.setActionBar(text); } catch { }
}

function displayName(entity) {
  try {
    if (entity.nameTag) return entity.nameTag;
    const raw = entity.typeId.split(":").pop().replace(/_/g, " ");
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  } catch {
    return "mob";
  }
}

function canBrawl(entity) {
  if (!entity) return false;
  try {
    if (DENY.has(entity.typeId)) return false;
    return !!entity.getComponent("minecraft:health");
  } catch {
    return false;
  }
}

// The trick that starts the fight: attribute a tiny hit to the opponent.
// Any mob with retaliation AI (hurt_by_target) turns on its "attacker".
function poke(victim, aggressor) {
  try {
    victim.applyDamage(1, {
      cause: EntityDamageCause.entityAttack,
      damagingEntity: aggressor
    });
  } catch { }
}

function markParticle(entity, name) {
  try {
    const l = entity.location;
    entity.dimension.spawnParticle(name, { x: l.x, y: l.y + 1.2, z: l.z });
  } catch { }
}

function sound(entity, id, volume = 1.2) {
  try { entity.dimension.playSound(id, entity.location, { volume }); } catch { }
}

function distance(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function handleTag(player, target) {
  // debounce: interact events can fire twice (once per hand)
  const now = system.currentTick;
  if (now - (lastAction.get(player.id) ?? -99) < 5) return;
  lastAction.set(player.id, now);

  if (!canBrawl(target)) {
    actionbar(player, "§7The Brawl Stick can't goad that into a fight.");
    return;
  }

  const sel = selections.get(player.id);
  const hasFreshTag = sel && now - sel.tick <= SELECT_TIMEOUT;

  if (hasFreshTag && sel.id === target.id) {
    actionbar(player, `§eAlready tagged §f${displayName(target)}§e — whack its opponent!`);
    return;
  }

  if (hasFreshTag) {
    // second mob tagged: FIGHT!
    selections.delete(player.id);
    let first = null;
    try { first = world.getEntity(sel.id); } catch { }
    if (!first || !canBrawl(first)) {
      actionbar(player, "§cYour first pick is gone. Tag a new one.");
      return;
    }
    if (first.dimension.id !== target.dimension.id ||
      distance(first.location, target.location) > MAX_FIGHT_RANGE) {
      actionbar(player, "§cThey're too far apart to start a brawl.");
      return;
    }
    poke(first, target);
    poke(target, first);
    markParticle(first, "minecraft:villager_angry");
    markParticle(target, "minecraft:villager_angry");
    sound(player, "mob.irongolem.attack", 1.5);
    actionbar(player, `§c${displayName(first)} §7⚔ §c${displayName(target)} §6— FIGHT!`);
    fights.push({ aId: first.id, bId: target.id, until: now + FIGHT_DURATION });
  } else {
    // first mob tagged
    selections.set(player.id, { id: target.id, tick: now });
    markParticle(target, "minecraft:critical_hit_emitter");
    sound(player, "random.orb", 1);
    actionbar(player, `§eTagged §f${displayName(target)}§e — now whack its opponent!`);
  }
}

// left click / punch with the stick
world.afterEvents.entityHitEntity.subscribe((ev) => {
  const player = ev.damagingEntity;
  if (player?.typeId !== "minecraft:player") return;
  try {
    const equip = player.getComponent("minecraft:equippable");
    const held = equip?.getEquipment(EquipmentSlot.Mainhand);
    if (held?.typeId !== STICK) return;
  } catch {
    return;
  }
  handleTag(player, ev.hitEntity);
});

// right click / interact with the stick (where the mob allows it)
try {
  world.afterEvents.playerInteractWithEntity.subscribe((ev) => {
    if (ev.itemStack?.typeId !== STICK) return;
    handleTag(ev.player, ev.target);
  });
} catch { /* event unavailable on this engine version — punching still works */ }

// using the stick on air: show status, or sneak-use to clear the tag
world.afterEvents.itemUse.subscribe((ev) => {
  if (ev.itemStack?.typeId !== STICK) return;
  const player = ev.source;
  const now = system.currentTick;
  if (now - (lastAction.get(player.id) ?? -99) < 5) return;

  if (player.isSneaking) {
    selections.delete(player.id);
    actionbar(player, "§7Tag cleared.");
    sound(player, "random.click", 1);
    return;
  }
  const sel = selections.get(player.id);
  if (sel && now - sel.tick <= SELECT_TIMEOUT) {
    let e = null;
    try { e = world.getEntity(sel.id); } catch { }
    if (e) {
      markParticle(e, "minecraft:critical_hit_emitter");
      actionbar(player, `§eTagged: §f${displayName(e)} §7— whack its opponent! (sneak-use to clear)`);
    } else {
      selections.delete(player.id);
      actionbar(player, "§7Your tagged mob is gone.");
    }
  } else {
    actionbar(player, "§7Whack a mob to tag it, whack a second to start the fight.");
  }
});

// keep grudges hot: some mobs calm down, so re-poke them at each other
system.runInterval(() => {
  const now = system.currentTick;
  for (let i = fights.length - 1; i >= 0; i--) {
    const f = fights[i];
    if (now > f.until) {
      fights.splice(i, 1);
      continue;
    }
    let a = null, b = null;
    try {
      a = world.getEntity(f.aId);
      b = world.getEntity(f.bId);
    } catch { }
    if (!a || !b || !canBrawl(a) || !canBrawl(b)) {
      fights.splice(i, 1); // somebody won (or despawned)
      continue;
    }
    try {
      if (a.dimension.id !== b.dimension.id ||
        distance(a.location, b.location) > MAX_FIGHT_RANGE) {
        fights.splice(i, 1);
        continue;
      }
      poke(a, b);
      poke(b, a);
    } catch {
      fights.splice(i, 1);
    }
  }
}, REAGGRO_INTERVAL);

// tidy stale selections so the map can't grow forever
system.runInterval(() => {
  const now = system.currentTick;
  for (const [pid, sel] of selections) {
    if (now - sel.tick > SELECT_TIMEOUT) selections.delete(pid);
  }
}, 600);
