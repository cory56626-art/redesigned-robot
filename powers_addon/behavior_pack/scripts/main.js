/*
 * Powers Addon — main script
 * --------------------------------------------------------------------------
 * Players spawn with a Power Gem. Right-clicking the gem grants one of 8
 * random powers (a custom item). Holding / owning the power item grants its
 * passive buffs, and right-clicking the item triggers its active ability.
 *
 * Built against @minecraft/server 2.0.0.
 */
import {
  world,
  system,
  ItemStack,
  EquipmentSlot,
  EntityComponentTypes,
} from "@minecraft/server";

// ---------------------------------------------------------------------------
// Power registry
// ---------------------------------------------------------------------------
const NS = "powers:";
const POWERS = [
  "god_of_war",     // God of War (relic — buffs whatever weapon you hold)
  "sonic_boots",    // As Fast As Sonic
  "frost_scepter",  // Frost Sovereign
  "storm_hammer",   // Storm Bringer
  "titan_gauntlet", // Titan
  "phantom_dagger", // Phantom
  "phoenix_feather",// Phoenix
  "void_eye",       // Void Walker
];

const POWER_NAMES = {
  god_of_war: "§6God of War",
  sonic_boots: "§bAs Fast As Sonic",
  frost_scepter: "§bFrost Sovereign",
  storm_hammer: "§eStorm Bringer",
  titan_gauntlet: "§2Titan",
  phantom_dagger: "§5Phantom",
  phoenix_feather: "§6Phoenix",
  void_eye: "§5Void Walker",
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

const cooldowns = new Map(); // `${playerId}:${key}` -> tick ready
function checkCooldown(player, key, ticks) {
  const k = `${player.id}:${key}`;
  const now = system.currentTick;
  const until = cooldowns.get(k) || 0;
  if (now < until) return Math.max(1, Math.ceil((until - now) / 20));
  cooldowns.set(k, now + ticks);
  return 0;
}

function actionbar(player, text) {
  try { player.onScreenDisplay.setActionBar(text); } catch (e) {}
}

function safeEffect(entity, type, ticks, amplifier = 0, particles = false) {
  try { entity.addEffect(type, ticks, { amplifier, showParticles: particles }); } catch (e) {}
}

function mainhand(player) {
  try {
    const eq = player.getComponent(EntityComponentTypes.Equippable);
    return eq ? eq.getEquipment(EquipmentSlot.Mainhand) : undefined;
  } catch (e) { return undefined; }
}

function mainhandId(player) {
  const it = mainhand(player);
  return it ? it.typeId : undefined;
}

// Does the player have a given power item anywhere in their inventory?
function hasPower(player, id) {
  try {
    const inv = player.getComponent(EntityComponentTypes.Inventory);
    if (!inv) return false;
    const c = inv.container;
    for (let i = 0; i < c.size; i++) {
      const it = c.getItem(i);
      if (it && it.typeId === NS + id) return true;
    }
  } catch (e) {}
  return false;
}

// Nearest living, attackable entity to a player within range.
function nearestMob(player, range) {
  let best = null, bd = Infinity;
  const loc = player.location;
  let ents;
  try { ents = player.dimension.getEntities({ location: loc, maxDistance: range }); }
  catch (e) { return null; }
  for (const e of ents) {
    try {
      if (e.id === player.id) continue;
      const t = e.typeId;
      if (t === "minecraft:item" || t === "minecraft:xp_orb" || t === "minecraft:arrow") continue;
      if (!e.getComponent(EntityComponentTypes.Health)) continue;
      const d = dist(loc, e.location);
      if (d < bd) { bd = d; best = e; }
    } catch (err) {}
  }
  return best;
}

// Knockback that tolerates both the new (VectorXZ) and old applyKnockback signatures.
function knock(entity, dx, dz, h, v) {
  const len = Math.hypot(dx, dz) || 1;
  dx /= len; dz /= len;
  try { entity.applyKnockback({ x: dx * h, z: dz * h }, v); return; } catch (e) {}
  try { entity.applyKnockback(dx, dz, h, v); } catch (e) {}
}

// Teleport the player next to a target and look at it.
function blinkToTarget(player, target, gap = 1.8) {
  const tl = target.location;
  const pl = player.location;
  let dx = pl.x - tl.x, dz = pl.z - tl.z;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len; dz /= len;
  const dest = { x: tl.x + dx * gap, y: tl.y, z: tl.z + dz * gap };
  try { player.teleport(dest, { facingLocation: { x: tl.x, y: tl.y + 1, z: tl.z } }); } catch (e) {}
}

function damage(entity, amount, source) {
  try { entity.applyDamage(amount, { cause: "entityAttack", damagingEntity: source }); } catch (e) {}
}

function particle(dimension, id, loc) {
  try { dimension.spawnParticle(id, loc); } catch (e) {}
}

function isCrit(attacker) {
  try {
    const v = attacker.getVelocity();
    return !attacker.isOnGround && v.y < -0.08;
  } catch (e) { return false; }
}

// ---------------------------------------------------------------------------
// Per-player transient state
// ---------------------------------------------------------------------------
const sonicActive = new Set();   // player ids with super-speed toggled on
const infernoCharged = new Set();// player ids whose next GoW hit is blue inferno
const phoenixDash = new Map();   // player id -> ticks remaining
const burning = new Map();       // entity -> { ticks, attacker }

// ---------------------------------------------------------------------------
// Spawn: hand out the Power Gem on first join
// ---------------------------------------------------------------------------
world.afterEvents.playerSpawn.subscribe((ev) => {
  if (!ev.initialSpawn) return;
  const p = ev.player;
  if (p.getDynamicProperty("powers:gaveGem")) return;
  try {
    p.getComponent(EntityComponentTypes.Inventory).container.addItem(new ItemStack(NS + "power_gem", 1));
    p.setDynamicProperty("powers:gaveGem", true);
    p.sendMessage("§d§lPOWERS§r §7» You received a §dPower Gem§7! Hold it and use it to unlock a §brandom power§7.");
  } catch (e) {}
});

// ---------------------------------------------------------------------------
// Item use: gem unlock + every power's active ability
// ---------------------------------------------------------------------------
world.afterEvents.itemUse.subscribe((ev) => {
  const player = ev.source;
  const item = ev.itemStack;
  if (!item || !player) return;
  const id = item.typeId;

  if (id === NS + "power_gem") return unlockRandomPower(player);
  if (!id.startsWith(NS)) return;
  const power = id.slice(NS.length);
  switch (power) {
    case "god_of_war": return abilityApexRage(player);
    case "blue_inferno": return abilityBlueInferno(player);
    case "sonic_boots": return abilitySonic(player);
    case "frost_scepter": return abilityFrost(player);
    case "storm_hammer": return abilityStorm(player);
    case "titan_gauntlet": return abilityTitan(player);
    case "phantom_dagger": return abilityPhantom(player);
    case "phoenix_feather": return abilityPhoenix(player);
    case "void_eye": return abilityVoid(player);
  }
});

function unlockRandomPower(player) {
  const power = POWERS[Math.floor(Math.random() * POWERS.length)];
  try {
    const inv = player.getComponent(EntityComponentTypes.Inventory).container;
    if (power === "god_of_war") {
      // God of War comes as two separate relics — one per ability.
      inv.addItem(new ItemStack(NS + "god_of_war", 1));
      inv.addItem(new ItemStack(NS + "blue_inferno", 1));
    } else {
      inv.addItem(new ItemStack(NS + power, 1));
    }
  } catch (e) {}
  // consume one gem from the main hand
  try {
    const eq = player.getComponent(EntityComponentTypes.Equippable);
    const main = eq.getEquipment(EquipmentSlot.Mainhand);
    if (main && main.typeId === NS + "power_gem") {
      if (main.amount > 1) { main.amount -= 1; eq.setEquipment(EquipmentSlot.Mainhand, main); }
      else eq.setEquipment(EquipmentSlot.Mainhand, undefined);
    }
  } catch (e) {}
  player.sendMessage(`§d§lPOWERS§r §7» Your power is §r${POWER_NAMES[power]}§7!`);
  if (power === "god_of_war") {
    player.sendMessage("§7» You got two relics: §cApex Rage§7 and §9Blue Inferno§7. Fight with any weapon to build rage, then right-click a relic to use it.");
  } else {
    player.sendMessage("§7» Hold it and right-click to use its ability.");
  }
  try { player.playSound("beacon.power"); } catch (e) {}
  try { player.dimension.spawnParticle("minecraft:totem_particle", player.location); } catch (e) {}
}

// ---------------------------------------------------------------------------
// 1. GOD OF WAR
// ---------------------------------------------------------------------------
function getRage(p) { return Number(p.getDynamicProperty("powers:rage") || 0); }
function setRage(p, v) { p.setDynamicProperty("powers:rage", Math.max(0, Math.min(100, v))); }
function getKills(p) { return Number(p.getDynamicProperty("powers:kills") || 0); }

// A simple visual rage meter for the action bar.
function rageBar(p) {
  const r = getRage(p);
  const filled = Math.round(r / 10);
  const bar = "§c" + "|".repeat(filled) + "§8" + "|".repeat(10 - filled);
  const ready = r >= 80 ? " §6§lREADY" : "";
  return `§6Apex Rage §r[${bar}§r] §c${r}%${ready}`;
}

// God of War is delivered as TWO relics that buff whatever weapon you fight
// with. Both abilities are fully MANUAL — you charge rage by fighting, then YOU
// right-click the matching relic to unleash. Nothing ever auto-fires.
function hasGodOfWar(p) { return hasPower(p, "god_of_war") || hasPower(p, "blue_inferno"); }

// Apex Rage relic — right-click to unleash (needs the bar at 80%+).
function abilityApexRage(player) {
  if (getRage(player) < 80) {
    actionbar(player, `§cApex Rage not ready §7— ${getRage(player)}%/80%. Fight to charge it!`);
    try { player.playSound("note.bass"); } catch (e) {}
    return;
  }
  const target = nearestMob(player, 22);
  if (!target) { actionbar(player, "§cApex Rage: no target in range"); return; }
  blinkToTarget(player, target, 1.6);
  damage(target, 10, player);
  setRage(player, getRage(player) - 80);
  actionbar(player, "§c§lAPEX RAGE!");
  try { player.playSound("mob.enderdragon.flap"); } catch (e) {}
  particle(player.dimension, "minecraft:critical_hit_emitter", target.location);
}

// Blue Inferno relic — right-click to arm (needs 20 kills); next hit ignites.
function abilityBlueInferno(player) {
  if (getKills(player) < 20) {
    actionbar(player, `§9Blue Inferno locked §7— kills ${getKills(player)}/20`);
    return;
  }
  const cd = checkCooldown(player, "inferno", 160);
  if (cd) { actionbar(player, `§9Blue Inferno on cooldown (${cd}s)`); return; }
  infernoCharged.add(player.id);
  actionbar(player, "§9§lBLUE INFERNO ARMED §r§7— your next hit ignites!");
  try { player.playSound("mob.ghast.fireball"); } catch (e) {}
}

// ---------------------------------------------------------------------------
// 2. AS FAST AS SONIC
// ---------------------------------------------------------------------------
function abilitySonic(player) {
  if (sonicActive.has(player.id)) {
    sonicActive.delete(player.id);
    actionbar(player, "§bSuper Speed §7OFF");
    try { player.playSound("random.click"); } catch (e) {}
  } else {
    sonicActive.add(player.id);
    actionbar(player, "§b§lSUPER SPEED §r§7ON — obstacles auto-vaulted!");
    try { player.playSound("mob.bee.loop_aggressive"); } catch (e) {}
  }
}

// ---------------------------------------------------------------------------
// 3. FROST SOVEREIGN
// ---------------------------------------------------------------------------
function abilityFrost(player) {
  const cd = checkCooldown(player, "frost", 120);
  if (cd) { actionbar(player, `§bGlacial Nova on cooldown (${cd}s)`); return; }
  const loc = player.location;
  let ents;
  try { ents = player.dimension.getEntities({ location: loc, maxDistance: 8 }); } catch (e) { ents = []; }
  let hit = 0;
  for (const e of ents) {
    if (e.id === player.id) continue;
    if (!e.getComponent(EntityComponentTypes.Health)) continue;
    safeEffect(e, "slowness", 120, 2, true);
    safeEffect(e, "weakness", 120, 1);
    damage(e, 4, player);
    particle(player.dimension, "minecraft:snowflake_particle", e.location);
    hit++;
  }
  actionbar(player, `§b§lGLACIAL NOVA §r§7— froze ${hit} foe(s)`);
  try { player.playSound("random.glass"); } catch (e) {}
}

// ---------------------------------------------------------------------------
// 4. STORM BRINGER
// ---------------------------------------------------------------------------
function strikeLightning(dimension, loc) {
  try { dimension.spawnEntity("minecraft:lightning_bolt", loc); } catch (e) {}
}
function abilityStorm(player) {
  const cd = checkCooldown(player, "storm", 60);
  if (cd) { actionbar(player, `§eThunderstrike on cooldown (${cd}s)`); return; }
  const target = nearestMob(player, 30);
  let loc;
  if (target) { loc = target.location; damage(target, 6, player); }
  else {
    const d = player.getViewDirection();
    const h = player.getHeadLocation();
    loc = { x: h.x + d.x * 6, y: player.location.y, z: h.z + d.z * 6 };
  }
  strikeLightning(player.dimension, loc);
  actionbar(player, "§e§lTHUNDERSTRIKE!");
  try { player.playSound("item.trident.thunder"); } catch (e) {}
}

// ---------------------------------------------------------------------------
// 5. TITAN
// ---------------------------------------------------------------------------
function abilityTitan(player) {
  if (!player.isOnGround) { actionbar(player, "§2Seismic Slam: must be on ground"); return; }
  const cd = checkCooldown(player, "titan", 100);
  if (cd) { actionbar(player, `§2Seismic Slam on cooldown (${cd}s)`); return; }
  const loc = player.location;
  let ents;
  try { ents = player.dimension.getEntities({ location: loc, maxDistance: 7 }); } catch (e) { ents = []; }
  let hit = 0;
  for (const e of ents) {
    if (e.id === player.id) continue;
    if (!e.getComponent(EntityComponentTypes.Health)) continue;
    const el = e.location;
    knock(e, el.x - loc.x, el.z - loc.z, 1.8, 0.9);
    damage(e, 7, player);
    hit++;
  }
  particle(player.dimension, "minecraft:huge_explosion_emitter", loc);
  actionbar(player, `§2§lSEISMIC SLAM §r§7— launched ${hit} foe(s)`);
  try { player.playSound("random.explode"); } catch (e) {}
}

// ---------------------------------------------------------------------------
// 6. PHANTOM
// ---------------------------------------------------------------------------
function abilityPhantom(player) {
  const cd = checkCooldown(player, "phantom", 80);
  if (cd) { actionbar(player, `§5Shadow Step on cooldown (${cd}s)`); return; }
  const target = nearestMob(player, 25);
  if (!target) { actionbar(player, "§5Shadow Step: no target"); return; }
  // teleport behind the target
  const tl = target.location;
  let bx = 0, bz = 1;
  try { const d = target.getViewDirection(); bx = d.x; bz = d.z; } catch (e) {}
  const dest = { x: tl.x - bx * 1.6, y: tl.y, z: tl.z - bz * 1.6 };
  try { player.teleport(dest, { facingLocation: { x: tl.x, y: tl.y + 1, z: tl.z } }); } catch (e) {}
  safeEffect(player, "invisibility", 80, 0);
  safeEffect(player, "speed", 80, 1);
  player.setDynamicProperty("powers:assassinate", system.currentTick + 60);
  actionbar(player, "§5§lSHADOW STEP §r§7— strike from the dark!");
  try { player.playSound("mob.endermen.portal"); } catch (e) {}
}

// ---------------------------------------------------------------------------
// 7. PHOENIX
// ---------------------------------------------------------------------------
function abilityPhoenix(player) {
  const cd = checkCooldown(player, "phoenix", 100);
  if (cd) { actionbar(player, `§6Phoenix Dash on cooldown (${cd}s)`); return; }
  const d = player.getViewDirection();
  knock(player, d.x, d.z, 2.2, 0.9);
  phoenixDash.set(player.id, 16);
  actionbar(player, "§6§lPHOENIX DASH!");
  try { player.playSound("mob.enderdragon.flap"); } catch (e) {}
}

// ---------------------------------------------------------------------------
// 8. VOID WALKER
// ---------------------------------------------------------------------------
function abilityVoid(player) {
  const cd = checkCooldown(player, "void", 80);
  if (cd) { actionbar(player, `§5Void Rift on cooldown (${cd}s)`); return; }
  // teleport in the direction the player is looking (ender-pearl style)
  const d = player.getViewDirection();
  const head = player.getHeadLocation();
  let dest = null;
  try {
    const hit = player.dimension.getBlockFromRay(head, d, { maxDistance: 20 });
    if (hit && hit.block) {
      const b = hit.block.location;
      dest = { x: b.x + 0.5, y: b.y + 1, z: b.z + 0.5 };
    }
  } catch (e) {}
  if (!dest) dest = { x: head.x + d.x * 18, y: head.y + d.y * 18, z: head.z + d.z * 18 };
  try { player.teleport(dest, { keepVelocity: false }); } catch (e) {}
  particle(player.dimension, "minecraft:dragon_breath_trail", dest);
  // pull nearby enemies toward the landing spot and curse them
  let ents;
  try { ents = player.dimension.getEntities({ location: dest, maxDistance: 9 }); } catch (e) { ents = []; }
  for (const e of ents) {
    if (e.id === player.id) continue;
    if (!e.getComponent(EntityComponentTypes.Health)) continue;
    const el = e.location;
    knock(e, dest.x - el.x, dest.z - el.z, 1.4, 0.3);
    safeEffect(e, "levitation", 30, 1);
  }
  actionbar(player, "§5§lVOID RIFT!");
  try { player.playSound("mob.endermen.portal"); } catch (e) {}
}

// ---------------------------------------------------------------------------
// Combat hooks (on-hit effects, crits, blue inferno, assassinate)
// ---------------------------------------------------------------------------
world.afterEvents.entityHitEntity.subscribe((ev) => {
  const attacker = ev.damagingEntity;
  const victim = ev.hitEntity;
  if (!attacker || attacker.typeId !== "minecraft:player") return;

  // God of War is relic-based: rage builds from EVERY hit you land with any
  // weapon (more on crits), so it charges fairly during a fight.
  if (hasGodOfWar(attacker)) {
    const crit = isCrit(attacker);
    setRage(attacker, getRage(attacker) + (crit ? 25 : 10));
    actionbar(attacker, (crit ? "§c§lCRIT! " : "") + rageBar(attacker));
    if (crit) particle(attacker.dimension, "minecraft:critical_hit_emitter", victim.location);
    if (infernoCharged.has(attacker.id)) {
      infernoCharged.delete(attacker.id);
      burning.set(victim, { ticks: 120, attacker });
      try { victim.setOnFire(8, true); } catch (e) {}
      damage(victim, 6, attacker);
      actionbar(attacker, "§9§lBLUE INFERNO IGNITES!");
    }
  }

  // The remaining powers still apply through their held weapon item.
  const wield = mainhandId(attacker);
  if (!wield || !wield.startsWith(NS)) return;
  const power = wield.slice(NS.length);

  if (power === "frost_scepter") {
    safeEffect(victim, "slowness", 80, 2, true);
    safeEffect(victim, "weakness", 80, 0);
    particle(attacker.dimension, "minecraft:snowflake_particle", victim.location);
  } else if (power === "storm_hammer") {
    if (Math.random() < 0.3) strikeLightning(attacker.dimension, victim.location);
  } else if (power === "titan_gauntlet") {
    const al = attacker.location, vl = victim.location;
    knock(victim, vl.x - al.x, vl.z - al.z, 1.2, 0.5);
  } else if (power === "phantom_dagger") {
    const until = Number(attacker.getDynamicProperty("powers:assassinate") || 0);
    if (system.currentTick < until) {
      damage(victim, 8, attacker);
      attacker.setDynamicProperty("powers:assassinate", 0);
      particle(attacker.dimension, "minecraft:critical_hit_emitter", victim.location);
      actionbar(attacker, "§5§lASSASSINATE!");
    }
  } else if (power === "void_eye") {
    if (Math.random() < 0.25) safeEffect(victim, "levitation", 30, 1);
  } else if (power === "phoenix_feather") {
    try { victim.setOnFire(4, true); } catch (e) {}
  }
});

// ---------------------------------------------------------------------------
// Kill tracking for God of War's second ability
// ---------------------------------------------------------------------------
world.afterEvents.entityDie.subscribe((ev) => {
  const killer = ev.damageSource?.damagingEntity;
  if (!killer || killer.typeId !== "minecraft:player") return;
  if (!hasGodOfWar(killer)) return;
  const kills = getKills(killer) + 1;
  killer.setDynamicProperty("powers:kills", kills);
  setRage(killer, getRage(killer) + 20); // kills also build Apex Rage
  if (kills === 20) {
    killer.sendMessage("§6§lGOD OF WAR§r §7» §9Blue Inferno§7 unlocked! Sneak + use the relic to arm it, then hit with any weapon.");
    try { killer.playSound("random.levelup"); } catch (e) {}
  } else if (kills < 20) {
    actionbar(killer, `§6Kills: ${kills}/20 §7(Blue Inferno) §8| §c${getRage(killer)}% rage`);
  }
});

// ---------------------------------------------------------------------------
// Damage hooks: storm fall immunity, void blink, phoenix rebirth setup
// ---------------------------------------------------------------------------
world.afterEvents.entityHurt.subscribe((ev) => {
  const p = ev.hurtEntity;
  if (!p || p.typeId !== "minecraft:player") return;
  const cause = ev.damageSource?.cause;

  if (cause === "fall" && hasPower(p, "storm_hammer")) {
    try {
      const hc = p.getComponent(EntityComponentTypes.Health);
      hc.setCurrentValue(Math.min(hc.effectiveMax, hc.currentValue + ev.damage));
    } catch (e) {}
  }
  if (hasPower(p, "void_eye") && Math.random() < 0.4) {
    const loc = p.location;
    const dest = { x: loc.x + (Math.random() * 8 - 4), y: loc.y + 1, z: loc.z + (Math.random() * 8 - 4) };
    try { p.teleport(dest); particle(p.dimension, "minecraft:dragon_breath_trail", dest); } catch (e) {}
  }
});

// ---------------------------------------------------------------------------
// Passive tick (every 0.5s): permanent buffs per owned power
// ---------------------------------------------------------------------------
system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    try {
      if (hasGodOfWar(player)) safeEffect(player, "strength", 40, 1);
      if (hasPower(player, "sonic_boots")) {
        // base nimbleness; full speed only while toggled on (handled in fast tick)
        if (!sonicActive.has(player.id)) safeEffect(player, "speed", 40, 0);
      }
      if (hasPower(player, "frost_scepter")) {
        safeEffect(player, "fire_resistance", 40, 0);
      }
      if (hasPower(player, "storm_hammer")) {
        safeEffect(player, "haste", 40, 1);
      }
      if (hasPower(player, "titan_gauntlet")) {
        safeEffect(player, "resistance", 40, 1);
        safeEffect(player, "health_boost", 40, 3);
      }
      if (hasPower(player, "phantom_dagger")) {
        safeEffect(player, "speed", 40, 0);
        if (player.isSneaking) safeEffect(player, "invisibility", 40, 0);
      }
      if (hasPower(player, "phoenix_feather")) {
        safeEffect(player, "fire_resistance", 40, 0);
        if (player.isSneaking) safeEffect(player, "slow_falling", 40, 0);
        // Rebirth: heal to full when critically low (2-min cooldown)
        const hc = player.getComponent(EntityComponentTypes.Health);
        const last = Number(player.getDynamicProperty("powers:rebirth") || 0);
        if (hc && hc.currentValue <= 4 && system.currentTick - last > 2400) {
          player.setDynamicProperty("powers:rebirth", system.currentTick);
          hc.setCurrentValue(hc.effectiveMax);
          safeEffect(player, "regeneration", 100, 2);
          safeEffect(player, "fire_resistance", 200, 0);
          let ents;
          try { ents = player.dimension.getEntities({ location: player.location, maxDistance: 6 }); } catch (e) { ents = []; }
          for (const e of ents) { if (e.id !== player.id) { try { e.setOnFire(6, true); } catch (er) {} } }
          particle(player.dimension, "minecraft:huge_explosion_emitter", player.location);
          player.sendMessage("§6§lPHOENIX§r §7» Reborn from the ashes!");
          try { player.playSound("mob.blaze.shoot"); } catch (e) {}
        }
      }
    } catch (e) {}
  }
}, 10);

// ---------------------------------------------------------------------------
// Fast tick (every 2 ticks): sonic vaulting, phoenix dash trail, blue inferno
// ---------------------------------------------------------------------------
system.runInterval(() => {
  // Sonic super-speed + auto-vault
  for (const player of world.getAllPlayers()) {
    if (!sonicActive.has(player.id)) continue;
    if (!hasPower(player, "sonic_boots")) { sonicActive.delete(player.id); continue; }
    safeEffect(player, "speed", 20, 4);
    safeEffect(player, "haste", 20, 2);
    try {
      const v = player.getVelocity();
      const movingFast = Math.hypot(v.x, v.z) > 0.08;
      if (movingFast) {
        const d = player.getViewDirection();
        const loc = player.location;
        const ahead = { x: loc.x + d.x * 0.9, y: loc.y, z: loc.z + d.z * 0.9 };
        const foot = player.dimension.getBlock(ahead);
        const above = player.dimension.getBlock({ x: ahead.x, y: ahead.y + 1, z: ahead.z });
        const head = player.dimension.getBlock({ x: ahead.x, y: ahead.y + 2, z: ahead.z });
        if (foot && !foot.isAir && foot.isSolid && above && above.isAir && head && head.isAir && player.isOnGround) {
          knock(player, d.x, d.z, 0.55, 0.52); // auto-go above the obstacle
        }
      }
    } catch (e) {}
  }

  // Phoenix dash trail
  for (const [pid, ticks] of phoenixDash) {
    const player = world.getAllPlayers().find((p) => p.id === pid);
    if (!player || ticks <= 0) { phoenixDash.delete(pid); continue; }
    phoenixDash.set(pid, ticks - 2);
    try {
      particle(player.dimension, "minecraft:basic_flame_particle", player.location);
      const ents = player.dimension.getEntities({ location: player.location, maxDistance: 3 });
      for (const e of ents) {
        if (e.id === player.id) continue;
        if (!e.getComponent(EntityComponentTypes.Health)) continue;
        e.setOnFire(4, true);
        damage(e, 3, player);
      }
    } catch (e) {}
  }

  // Blue inferno charged shimmer
  for (const pid of infernoCharged) {
    const player = world.getAllPlayers().find((p) => p.id === pid);
    if (!player) { infernoCharged.delete(pid); continue; }
    try {
      const h = player.getHeadLocation();
      particle(player.dimension, NS + "blue_fire", { x: h.x, y: h.y - 0.3, z: h.z });
    } catch (e) {}
  }

  // Ongoing blue-fire burn damage
  for (const [victim, data] of burning) {
    if (data.ticks <= 0) { burning.delete(victim); continue; }
    data.ticks -= 2;
    try {
      particle(victim.dimension, NS + "blue_fire", victim.location);
      victim.setOnFire(3, true);
      if (data.ticks % 10 === 0) {
        victim.applyDamage(3, { cause: "fire", damagingEntity: data.attacker });
      }
    } catch (e) { burning.delete(victim); }
  }
}, 2);

console.warn("[Powers] addon loaded — 8 powers ready.");
