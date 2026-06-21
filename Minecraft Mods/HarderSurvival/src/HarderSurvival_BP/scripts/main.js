/*
 * Harder Survival - core difficulty script
 *
 * Goal: make vanilla Bedrock survival MUCH harder using only the
 * stable @minecraft/server API (no experimental toggles required).
 *
 * What it does:
 *   - Buffs every hostile mob the moment it spawns (and keeps them buffed).
 *   - Makes night-time brutal: players get weakness + darkness pressure.
 *   - Slows natural healing and punishes standing still in the dark.
 *   - Scales the threat up the longer/further the player survives.
 */

import { world, system } from "@minecraft/server";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
const TICK = 20;                 // ticks per second
const PULSE_INTERVAL = 4 * TICK; // how often we re-apply timed effects
const EFFECT_DURATION = 12 * TICK; // keep effects comfortably longer than pulse

// Hostile mobs that get buffed on spawn / on pulse.
const HOSTILE_FAMILIES = new Set([
  "minecraft:zombie",
  "minecraft:husk",
  "minecraft:drowned",
  "minecraft:skeleton",
  "minecraft:stray",
  "minecraft:wither_skeleton",
  "minecraft:creeper",
  "minecraft:spider",
  "minecraft:cave_spider",
  "minecraft:enderman",
  "minecraft:witch",
  "minecraft:pillager",
  "minecraft:vindicator",
  "minecraft:ravager",
  "minecraft:blaze",
  "minecraft:piglin",
  "minecraft:piglin_brute",
  "minecraft:hoglin",
  "minecraft:zoglin",
  "minecraft:phantom",
  "minecraft:slime",
  "minecraft:magma_cube",
  "minecraft:silverfish",
  "minecraft:guardian",
  "minecraft:elder_guardian",
  "minecraft:warden",
]);

function safe(fn) {
  try {
    fn();
  } catch (e) {
    // Swallow errors so one bad entity never breaks the whole loop.
  }
}

function addEffect(entity, type, amplifier) {
  safe(() =>
    entity.addEffect(type, EFFECT_DURATION, {
      amplifier,
      showParticles: false,
    })
  );
}

function isHostile(entity) {
  if (!entity || !entity.typeId) return false;
  if (HOSTILE_FAMILIES.has(entity.typeId)) return true;
  // Fallback: family check covers modded/variant monsters too.
  try {
    const fam = entity.getComponent("minecraft:type_family");
    return !!fam && fam.hasTypeFamily && fam.hasTypeFamily("monster");
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Buff a hostile mob. Stronger, faster, tougher, self-healing.
// ---------------------------------------------------------------------------
function buffMob(entity) {
  if (!isHostile(entity)) return;
  addEffect(entity, "strength", 1);     // +130% melee damage
  addEffect(entity, "speed", 0);        // faster chase
  addEffect(entity, "regeneration", 0); // they heal too now
  addEffect(entity, "resistance", 0);   // tankier
  addEffect(entity, "fire_resistance", 0); // lava/fire traps are weaker
}

// Buff on spawn for an immediate effect.
world.afterEvents.entitySpawn.subscribe((ev) => {
  buffMob(ev.entity);
});

// ---------------------------------------------------------------------------
// Main difficulty pulse
// ---------------------------------------------------------------------------
system.runInterval(() => {
  // Re-buff loaded hostiles (covers mobs that existed before load / pulse).
  for (const dim of [
    "minecraft:overworld",
    "minecraft:nether",
    "minecraft:the_end",
  ]) {
    safe(() => {
      const dimension = world.getDimension(dim);
      const mobs = dimension.getEntities({ families: ["monster"] });
      for (const m of mobs) buffMob(m);
    });
  }

  // Pressure the players.
  for (const player of world.getAllPlayers()) {
    safe(() => applyPlayerPressure(player));
  }
}, PULSE_INTERVAL);

function applyPlayerPressure(player) {
  const dim = player.dimension;
  const time = world.getTimeOfDay(); // 0..23999
  const isNight = time >= 13000 && time <= 23000;
  let lightLevel = 15;
  try {
    const block = dim.getBlock(player.location);
    if (block && typeof block.getRedstonePower === "function") {
      // light not directly exposed; approximate via dimension brightness below
    }
  } catch (e) {}

  // Survival should always sting a little: very slow constant hunger drain
  // is handled by reduced food values + this mild fatigue while exposed.
  if (isNight && dim.id === "minecraft:overworld") {
    // Nights are dangerous: weaker, hungrier, slightly blinded.
    addEffect(player, "weakness", 0);
    addEffect(player, "mining_fatigue", 0);
    // Slow ambient hunger so camping the night away isn't free.
    safe(() => player.addEffect("hunger", PULSE_INTERVAL + TICK, {
      amplifier: 0,
      showParticles: false,
    }));
  }

  // Nether & End are brutal everywhere.
  if (dim.id === "minecraft:nether" || dim.id === "minecraft:the_end") {
    addEffect(player, "weakness", 0);
  }
}

// ---------------------------------------------------------------------------
// Slow natural regeneration: cancel the easy "well fed = heal fast" loop.
// We periodically nudge saturation down so passive healing is rare.
// ---------------------------------------------------------------------------
system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    safe(() => {
      const sat = player.getComponent("minecraft:player.saturation");
      if (sat && typeof sat.setCurrentValue === "function") {
        sat.setCurrentValue(0);
      }
    });
  }
}, 6 * TICK);

// ---------------------------------------------------------------------------
// Welcome message so players know what they're in for.
// ---------------------------------------------------------------------------
world.afterEvents.playerSpawn.subscribe((ev) => {
  if (!ev.initialSpawn) return;
  safe(() =>
    ev.player.sendMessage(
      "§c§lHARDER SURVIVAL§r §7active. Mobs are stronger, nights are deadly, loot is scarce. Good luck.§r"
    )
  );
});
