/*
 * Harder Survival - core difficulty + thirst/water system
 *
 * Uses only the stable @minecraft/server API (no experimental toggles).
 *
 * Difficulty:
 *   - Buffs every hostile mob on spawn and keeps them buffed.
 *   - Brutal nights, throttled natural healing, scarcer loot (data files).
 *
 * Thirst / Water:
 *   - A Water bar drains over time (faster when sprinting / in the Nether).
 *   - Collecting water with a glass bottle gives "Murky Water".
 *   - Drinking Murky Water poisons you. Smelt it in a FURNACE to get
 *     "Purified Water", which safely restores a lot of thirst.
 *   - Low thirst => slowness, then weakness, then damage.
 */

import { world, system, ItemStack } from "@minecraft/server";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
const TICK = 20;
const PULSE_INTERVAL = 4 * TICK;
const EFFECT_DURATION = 12 * TICK;

const MAX_THIRST = 100;
const THIRST_PROP = "hs:thirst";

// How fast thirst drains, per second.
const DRAIN_BASE = 0.55;
const DRAIN_SPRINT = 0.9;
const DRAIN_NETHER = 0.7;

// How much each drink restores.
const RESTORE_PURIFIED = 40;
const RESTORE_DIRTY = 14;

// Minor hydration from juicy foods.
const FOOD_THIRST = {
  "minecraft:melon_slice": 6,
  "minecraft:apple": 4,
  "minecraft:sweet_berries": 4,
  "minecraft:glow_berries": 4,
  "minecraft:chorus_fruit": 3,
  "minecraft:milk_bucket": 25,
};

const HOSTILE_FAMILIES = new Set([
  "minecraft:zombie", "minecraft:husk", "minecraft:drowned",
  "minecraft:skeleton", "minecraft:stray", "minecraft:wither_skeleton",
  "minecraft:creeper", "minecraft:spider", "minecraft:cave_spider",
  "minecraft:enderman", "minecraft:witch", "minecraft:pillager",
  "minecraft:vindicator", "minecraft:ravager", "minecraft:blaze",
  "minecraft:piglin", "minecraft:piglin_brute", "minecraft:hoglin",
  "minecraft:zoglin", "minecraft:phantom", "minecraft:slime",
  "minecraft:magma_cube", "minecraft:silverfish", "minecraft:guardian",
  "minecraft:elder_guardian", "minecraft:warden",
]);

const WATER_BLOCKS = new Set(["minecraft:water", "minecraft:flowing_water"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function safe(fn) {
  try { fn(); } catch (e) { /* never let one entity break a loop */ }
}

function addEffect(entity, type, amplifier, duration = EFFECT_DURATION) {
  safe(() => entity.addEffect(type, duration, { amplifier, showParticles: false }));
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function getThirst(player) {
  const v = player.getDynamicProperty(THIRST_PROP);
  return typeof v === "number" ? v : MAX_THIRST;
}

function setThirst(player, v) {
  safe(() => player.setDynamicProperty(THIRST_PROP, clamp(v, 0, MAX_THIRST)));
}

function addThirst(player, delta) {
  setThirst(player, getThirst(player) + delta);
}

function getSelectedSlot(player) {
  // API renamed selectedSlot -> selectedSlotIndex across versions.
  if (typeof player.selectedSlotIndex === "number") return player.selectedSlotIndex;
  if (typeof player.selectedSlot === "number") return player.selectedSlot;
  return 0;
}

// ---------------------------------------------------------------------------
// Mob buffs
// ---------------------------------------------------------------------------
function isHostile(entity) {
  if (!entity || !entity.typeId) return false;
  if (HOSTILE_FAMILIES.has(entity.typeId)) return true;
  try {
    const fam = entity.getComponent("minecraft:type_family");
    return !!fam && fam.hasTypeFamily && fam.hasTypeFamily("monster");
  } catch (e) { return false; }
}

function buffMob(entity) {
  if (!isHostile(entity)) return;
  addEffect(entity, "strength", 1);
  addEffect(entity, "speed", 0);
  addEffect(entity, "regeneration", 0);
  addEffect(entity, "resistance", 0);
  addEffect(entity, "fire_resistance", 0);
}

world.afterEvents.entitySpawn.subscribe((ev) => buffMob(ev.entity));

// ---------------------------------------------------------------------------
// Water collection: glass bottle on water -> Murky Water
// ---------------------------------------------------------------------------
world.afterEvents.playerInteractWithBlock.subscribe((ev) => {
  const { player, block, itemStack } = ev;
  if (!itemStack || itemStack.typeId !== "minecraft:glass_bottle") return;
  if (!block || !WATER_BLOCKS.has(block.typeId)) return;

  // Vanilla fills the bottle into a plain water bottle; swap it to Murky Water.
  system.runTimeout(() => {
    safe(() => {
      const inv = player.getComponent("minecraft:inventory");
      if (!inv || !inv.container) return;
      const slot = getSelectedSlot(player);
      const held = inv.container.getItem(slot);
      if (held && held.typeId === "minecraft:potion") {
        inv.container.setItem(slot, new ItemStack("hs:dirty_water_bottle", held.amount));
      }
    });
  }, 2);
});

// ---------------------------------------------------------------------------
// Drinking & eating
// ---------------------------------------------------------------------------
world.afterEvents.itemCompleteUse.subscribe((ev) => {
  const player = ev.source;
  const id = ev.itemStack?.typeId;
  if (!player || !id) return;

  if (id === "hs:purified_water_bottle") {
    addThirst(player, RESTORE_PURIFIED);
    safe(() => player.removeEffect("poison"));
    safe(() => player.onScreenDisplay.setActionBar("§bAhh, clean water.§r"));
    return;
  }

  if (id === "hs:dirty_water_bottle") {
    addThirst(player, RESTORE_DIRTY);
    addEffect(player, "poison", 1, 12 * TICK);
    addEffect(player, "nausea", 0, 8 * TICK);
    if (Math.random() < 0.35) addEffect(player, "hunger", 0, 12 * TICK);
    safe(() => player.onScreenDisplay.setActionBar("§2Tastes foul... you feel sick.§r"));
    return;
  }

  if (FOOD_THIRST[id]) addThirst(player, FOOD_THIRST[id]);
});

// ---------------------------------------------------------------------------
// Difficulty pulse (mobs + night pressure)
// ---------------------------------------------------------------------------
system.runInterval(() => {
  for (const dim of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
    safe(() => {
      const mobs = world.getDimension(dim).getEntities({ families: ["monster"] });
      for (const m of mobs) buffMob(m);
    });
  }
  for (const player of world.getAllPlayers()) safe(() => applyPlayerPressure(player));
}, PULSE_INTERVAL);

function applyPlayerPressure(player) {
  const dim = player.dimension;
  const time = world.getTimeOfDay();
  const isNight = time >= 13000 && time <= 23000;

  if (isNight && dim.id === "minecraft:overworld") {
    addEffect(player, "weakness", 0);
    addEffect(player, "mining_fatigue", 0);
    safe(() => player.addEffect("hunger", PULSE_INTERVAL + TICK, { amplifier: 0, showParticles: false }));
  }
  if (dim.id === "minecraft:nether" || dim.id === "minecraft:the_end") {
    addEffect(player, "weakness", 0);
  }
}

// ---------------------------------------------------------------------------
// Throttle natural healing
// ---------------------------------------------------------------------------
system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    safe(() => {
      const sat = player.getComponent("minecraft:player.saturation");
      if (sat && typeof sat.setCurrentValue === "function") sat.setCurrentValue(0);
    });
  }
}, 6 * TICK);

// ---------------------------------------------------------------------------
// Thirst loop (drain + penalties + HUD), every second
// ---------------------------------------------------------------------------
system.runInterval(() => {
  for (const player of world.getAllPlayers()) safe(() => tickThirst(player));
}, TICK);

function tickThirst(player) {
  let thirst = getThirst(player);

  let drain = DRAIN_BASE;
  if (player.isSprinting) drain += DRAIN_SPRINT - DRAIN_BASE;
  if (player.dimension.id === "minecraft:nether") drain += DRAIN_NETHER - DRAIN_BASE;
  thirst = clamp(thirst - drain, 0, MAX_THIRST);
  setThirst(player, thirst);

  // Penalties for dehydration.
  if (thirst <= 0) {
    addEffect(player, "weakness", 1, 3 * TICK);
    addEffect(player, "slowness", 1, 3 * TICK);
    safe(() => player.applyDamage(2));
  } else if (thirst <= 15) {
    addEffect(player, "weakness", 0, 3 * TICK);
    addEffect(player, "slowness", 0, 3 * TICK);
  } else if (thirst <= 30) {
    addEffect(player, "slowness", 0, 3 * TICK);
  }

  renderThirst(player, thirst);
}

function renderThirst(player, thirst) {
  const pct = Math.round(thirst);
  const filled = Math.round(thirst / 10); // 0..10
  const empty = 10 - filled;
  let color = "§b";
  if (thirst <= 15) color = "§c";
  else if (thirst <= 30) color = "§6";
  const bar = color + "▮".repeat(filled) + "§8" + "▯".repeat(empty) + "§r";
  safe(() => player.onScreenDisplay.setActionBar(`§fWater ${bar} §7${pct}%`));
}

// ---------------------------------------------------------------------------
// Welcome / init
// ---------------------------------------------------------------------------
world.afterEvents.playerSpawn.subscribe((ev) => {
  if (!ev.initialSpawn) return;
  const player = ev.player;
  if (typeof player.getDynamicProperty(THIRST_PROP) !== "number") {
    setThirst(player, MAX_THIRST);
  }
  safe(() => player.sendMessage(
    "§c§lHARDER SURVIVAL§r §7active. Mobs are stronger, nights are deadly, loot is scarce.\n" +
    "§9You now have THIRST.§7 Bottle water (it's §2murky§7 — drinking it poisons you), then §6smelt it in a furnace§7 to purify. Stay hydrated.§r"
  ));
});
