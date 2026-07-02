// =====================================================================
//  BRAWL STICK — make any two mobs fight each other
//  Whack (or right-click) mob A to tag it, then whack mob B: FIGHT!
//  Sneak + use the stick to clear your tag.
//
//  RIOT STICK — whack mob A (say, a skeleton), then whack mob B (say,
//  a warden): every nearby mob of A's species charges B at once.
// =====================================================================
import {
  world,
  system,
  EquipmentSlot,
  EntityDamageCause
} from "@minecraft/server";

const STICK = "bw:brawl_stick";
const RIOT_STICK = "bw:riot_stick";
const SELECT_TIMEOUT = 600;    // tag expires after 30s
const FIGHT_DURATION = 1200;   // keep the grudge alive for 60s
const REAGGRO_INTERVAL = 90;   // re-poke every 4.5s so they don't lose interest
const MAX_FIGHT_RANGE = 40;    // grudge breaks if they separate this far
const RIOT_RADIUS = 24;        // how far the riot stick rallies the species

// playerId -> { id: taggedEntityId, tick: whenTagged }  (Brawl Stick)
const selections = new Map();
// playerId -> { id: taggedEntityId, tick: whenTagged }  (Riot Stick)
const riotSelections = new Map();
// active grudges: { aId, bId, until }
const fights = [];
// active riots: { targetId, attackerIds: [], until }
const riots = [];
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

function handleRiot(player, target) {
  const now = system.currentTick;
  if (now - (lastAction.get(player.id) ?? -99) < 5) return;
  lastAction.set(player.id, now);

  if (!canBrawl(target)) {
    actionbar(player, "§7The Riot Stick can't rally (or target) that.");
    return;
  }

  const sel = riotSelections.get(player.id);
  const hasFreshTag = sel && now - sel.tick <= SELECT_TIMEOUT;

  if (hasFreshTag && sel.id === target.id) {
    actionbar(player, `§eAlready rallying §f${displayName(target)}s§e — whack their target!`);
    return;
  }

  if (!hasFreshTag) {
    // first whack: tag the species you want to rally
    riotSelections.set(player.id, { id: target.id, tick: now });
    markParticle(target, "minecraft:critical_hit_emitter");
    sound(player, "random.orb", 1);
    actionbar(player, `§eRallying §f${displayName(target)}s§e — now whack their target!`);
    return;
  }

  // second whack: send the whole tagged species at this target
  riotSelections.delete(player.id);
  let leader = null;
  try { leader = world.getEntity(sel.id); } catch { }
  if (!leader || !canBrawl(leader)) {
    actionbar(player, "§cYour rallied mob is gone. Tag a new one.");
    return;
  }

  // gather the pack: every mob of the leader's species near the leader
  let pack = [leader];
  try {
    for (const e of leader.dimension.getEntities({
      type: leader.typeId,
      location: leader.location,
      maxDistance: RIOT_RADIUS
    })) {
      if (e.id !== leader.id && e.id !== target.id && canBrawl(e)) pack.push(e);
    }
  } catch { }
  // (if the target is the same species, it just gets mobbed by its kin)
  pack = pack.filter((e) => e.id !== target.id);
  if (pack.length === 0) {
    actionbar(player, "§cNo pack left to rally.");
    return;
  }

  const attackerIds = [];
  for (const mob of pack) {
    poke(mob, target); // each one now believes the target attacked it
    attackerIds.push(mob.id);
    markParticle(mob, "minecraft:villager_angry");
  }
  // and the target swings back at the pack leader
  poke(target, leader);
  markParticle(target, "minecraft:critical_hit_emitter");
  sound(player, "mob.irongolem.attack", 1.5);
  actionbar(player, `§4${pack.length} §c${displayName(leader)}${pack.length > 1 ? "s" : ""} §6charge §f${displayName(target)}§6 — RIOT!`);
  riots.push({ targetId: target.id, attackerIds, until: now + FIGHT_DURATION });
}

// left click / punch with either stick
world.afterEvents.entityHitEntity.subscribe((ev) => {
  const player = ev.damagingEntity;
  if (player?.typeId !== "minecraft:player") return;
  let heldId;
  try {
    const equip = player.getComponent("minecraft:equippable");
    heldId = equip?.getEquipment(EquipmentSlot.Mainhand)?.typeId;
  } catch {
    return;
  }
  if (heldId === STICK) handleTag(player, ev.hitEntity);
  else if (heldId === RIOT_STICK) handleRiot(player, ev.hitEntity);
});

// right click / interact with either stick (where the mob allows it)
try {
  world.afterEvents.playerInteractWithEntity.subscribe((ev) => {
    if (ev.itemStack?.typeId === STICK) handleTag(ev.player, ev.target);
    else if (ev.itemStack?.typeId === RIOT_STICK) handleRiot(ev.player, ev.target);
  });
} catch { /* event unavailable on this engine version — punching still works */ }

// using a stick on air: show status, or sneak-use to clear the tag
world.afterEvents.itemUse.subscribe((ev) => {
  if (ev.itemStack?.typeId === RIOT_STICK) {
    const player = ev.source;
    const now = system.currentTick;
    if (now - (lastAction.get(player.id) ?? -99) < 5) return;
    if (player.isSneaking) {
      riotSelections.delete(player.id);
      actionbar(player, "§7Rally cleared.");
      sound(player, "random.click", 1);
      return;
    }
    const sel = riotSelections.get(player.id);
    if (sel && now - sel.tick <= SELECT_TIMEOUT) {
      let e = null;
      try { e = world.getEntity(sel.id); } catch { }
      if (e) {
        markParticle(e, "minecraft:critical_hit_emitter");
        actionbar(player, `§eRallying: §f${displayName(e)}s §7— whack their target! (sneak-use to clear)`);
      } else {
        riotSelections.delete(player.id);
        actionbar(player, "§7Your rallied mob is gone.");
      }
    } else {
      actionbar(player, "§7Whack a mob to rally its species, whack a second mob and they all charge it.");
    }
    return;
  }
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

// is this mob already fighting that one? (then leave it alone —
// re-poking mobs that are still angry causes visible phantom hits)
function isFighting(mob, foe) {
  try {
    return mob.target?.id === foe.id;
  } catch {
    return false;
  }
}

// keep grudges hot: re-poke ONLY mobs that actually lost interest
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
      if (!isFighting(a, b)) poke(a, b);
      if (!isFighting(b, a)) poke(b, a);
    } catch {
      fights.splice(i, 1);
    }
  }

  // keep riots hot: re-anger the surviving pack at the target
  for (let i = riots.length - 1; i >= 0; i--) {
    const r = riots[i];
    if (now > r.until) {
      riots.splice(i, 1);
      continue;
    }
    let target = null;
    try { target = world.getEntity(r.targetId); } catch { }
    if (!target || !canBrawl(target)) {
      riots.splice(i, 1); // the mob (or the riot) is finished
      continue;
    }
    const survivors = [];
    for (const id of r.attackerIds) {
      let mob = null;
      try { mob = world.getEntity(id); } catch { }
      if (!mob || !canBrawl(mob)) continue;
      try {
        if (mob.dimension.id !== target.dimension.id ||
          distance(mob.location, target.location) > MAX_FIGHT_RANGE) continue;
        if (!isFighting(mob, target)) poke(mob, target);
        survivors.push(id);
      } catch { }
    }
    if (survivors.length === 0) {
      riots.splice(i, 1); // target outlived the whole mob... respect
      continue;
    }
    r.attackerIds = survivors;
  }
}, REAGGRO_INTERVAL);

// tidy stale selections so the maps can't grow forever
system.runInterval(() => {
  const now = system.currentTick;
  for (const [pid, sel] of selections) {
    if (now - sel.tick > SELECT_TIMEOUT) selections.delete(pid);
  }
  for (const [pid, sel] of riotSelections) {
    if (now - sel.tick > SELECT_TIMEOUT) riotSelections.delete(pid);
  }
}, 600);
