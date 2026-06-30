import { world, system, EnchantmentType, ItemComponentTypes } from "@minecraft/server";

/*
 * Auto Enchanter
 * --------------
 * Two custom items:
 *   ae:enchanter_tools  -> utility / mining / movement enchantments
 *   ae:enchanter_pvp    -> combat / protection enchantments
 *
 * Two ways to use it:
 *   1) ITEM  - Hold the Enchanter in your MAIN hand and right-click (use). The
 *              script enchants the first enchantable piece of gear in your hotbar
 *              / inventory and CONSUMES one Enchanter.
 *              (Bedrock can't use items from the off-hand and won't let gear go in
 *               the off-hand, so the trigger has to come from the main hand.)
 *   2) COMMAND - Hold the gear you want and run one of:
 *                  /scriptevent ae:tools
 *                  /scriptevent ae:pvp
 *              This enchants the held item (or first hotbar gear) and does NOT
 *              consume anything.
 *
 * Levels are vanilla-max. We attempt a curated, priority-ordered super-set of
 * enchantments and let the engine's canAddEnchantment() decide which are valid for
 * each item, so it works for EVERY enchantable item automatically. Conflicts
 * (Fortune vs Silk Touch, Sharpness vs Smite, Infinity vs Mending, Protection vs
 * the specialised protections) are resolved by order: the higher-priority one is
 * applied first and the conflicting one is then skipped.
 */

const ENCHANTER_TOOLS = "ae:enchanter_tools";
const ENCHANTER_PVP = "ae:enchanter_pvp";

const TOOLS_LOADOUT = [
  // Mining / harvesting tools
  { id: "efficiency", level: 5 },
  { id: "fortune", level: 3 },        // wins over silk_touch by being first
  { id: "silk_touch", level: 1 },     // applied only when Fortune is invalid (e.g. shears)
  // Fishing rod
  { id: "lure", level: 3 },
  { id: "luck_of_the_sea", level: 3 },
  // Drops (counts as a "tool/utility" perk)
  { id: "looting", level: 3 },
  // Movement / utility armour
  { id: "feather_falling", level: 4 },
  { id: "depth_strider", level: 3 },
  { id: "frost_walker", level: 2 },
  { id: "soul_speed", level: 3 },
  { id: "swift_sneak", level: 3 },
  { id: "respiration", level: 3 },
  { id: "aqua_affinity", level: 1 },
  // Durability (universal)
  { id: "unbreaking", level: 3 },
  { id: "mending", level: 1 },
];

const PVP_LOADOUT = [
  // Melee
  { id: "sharpness", level: 5 },      // wins over smite/bane
  { id: "impaling", level: 5 },       // trident
  { id: "fire_aspect", level: 2 },    // sword
  { id: "looting", level: 3 },        // sword
  { id: "knockback", level: 2 },      // sword
  // Ranged
  { id: "power", level: 5 },          // bow
  { id: "flame", level: 1 },          // bow
  { id: "punch", level: 2 },          // bow
  { id: "multishot", level: 1 },      // crossbow
  { id: "piercing", level: 4 },       // crossbow
  { id: "quick_charge", level: 3 },   // crossbow
  // Trident utility
  { id: "loyalty", level: 3 },        // wins over riptide
  { id: "channeling", level: 1 },
  // Armour
  { id: "protection", level: 4 },     // wins over the specialised protections
  { id: "thorns", level: 3 },
  // Durability (universal)
  { id: "unbreaking", level: 3 },
  { id: "infinity", level: 1 },       // bow only; placed before mending
  { id: "mending", level: 1 },
];

/** Apply a loadout to an item stack. Returns the count successfully applied. */
function enchantItem(itemStack, loadout) {
  const enchantable = itemStack.getComponent(ItemComponentTypes.Enchantable);
  if (!enchantable) return 0;

  try {
    enchantable.removeAllEnchantments(); // start clean so we always reach max
  } catch (e) {}

  let applied = 0;
  for (const entry of loadout) {
    try {
      const enchantment = { type: new EnchantmentType(entry.id), level: entry.level };
      if (enchantable.canAddEnchantment(enchantment)) {
        enchantable.addEnchantment(enchantment);
        applied++;
      }
    } catch (e) {
      // Unknown id on this version, conflict, or out-of-bounds level: skip it.
    }
  }
  return applied;
}

/** "minecraft:diamond_pickaxe" -> "Diamond Pickaxe" */
function prettyName(typeId) {
  return typeId
    .replace(/^.*:/, "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function getSelectedSlot(player) {
  return player.selectedSlotIndex ?? player.selectedSlot ?? 0;
}

function isEnchanter(item) {
  return item && (item.typeId === ENCHANTER_TOOLS || item.typeId === ENCHANTER_PVP);
}

/**
 * Find the first enchantable target item.
 *  - heldSlot: the player's selected slot.
 *  - preferHeld: if true, check the held slot first (command mode where you hold
 *    the gear). If false, skip the held slot (item mode where you hold the Enchanter).
 * Returns { item, slot } or null.
 */
function findTarget(container, heldSlot, preferHeld) {
  const total = container.size;
  const order = [];
  if (preferHeld) order.push(heldSlot);
  for (let i = 0; i < Math.min(9, total); i++) order.push(i); // hotbar
  for (let i = 9; i < total; i++) order.push(i);              // rest

  for (const i of order) {
    if (!preferHeld && i === heldSlot) continue;
    const item = container.getItem(i);
    if (!item || isEnchanter(item)) continue;
    if (!item.getComponent(ItemComponentTypes.Enchantable)) continue;
    return { item, slot: i };
  }
  return null;
}

function consumeOne(container, slot) {
  const held = container.getItem(slot);
  if (!held) return;
  if (held.amount > 1) {
    held.amount -= 1;
    container.setItem(slot, held);
  } else {
    container.setItem(slot); // clear the slot
  }
}

function feedbackFail(player, msg) {
  player.onScreenDisplay.setActionBar(msg);
  try {
    player.playSound("note.bass", { pitch: 0.7 });
  } catch (e) {}
}

function feedbackSuccess(player, isTools, name, count) {
  const flavour = isTools ? "§bTools" : "§cPVP";
  player.onScreenDisplay.setActionBar(
    `§a✦ ${flavour} §aenchanted §e${name} §awith §b${count} §aenchantment${count === 1 ? "" : "s"}!`
  );
  try {
    player.playSound("random.levelup", { pitch: 1.0, volume: 0.8 });
    player.dimension.spawnParticle("minecraft:villager_happy", {
      x: player.location.x,
      y: player.location.y + 1.2,
      z: player.location.z,
    });
  } catch (e) {}
}

/**
 * Core action shared by the item and the command.
 *  - consume: remove one Enchanter from the held slot (item mode only).
 *  - preferHeld: enchant the held item first (command mode).
 */
function runEnchant(player, isTools, { consume, preferHeld }) {
  const container = player.getComponent("minecraft:inventory")?.container;
  if (!container) return;

  const heldSlot = getSelectedSlot(player);
  const target = findTarget(container, heldSlot, preferHeld);

  if (!target) {
    feedbackFail(
      player,
      "§cNo enchantable gear found. §7Hold or hotbar the item you want to enchant."
    );
    return;
  }

  const loadout = isTools ? TOOLS_LOADOUT : PVP_LOADOUT;
  const count = enchantItem(target.item, loadout);

  if (count === 0) {
    feedbackFail(player, `§e${prettyName(target.item.typeId)} §ccan't take these enchantments.`);
    return;
  }

  container.setItem(target.slot, target.item);
  if (consume) consumeOne(container, heldSlot);

  feedbackSuccess(player, isTools, prettyName(target.item.typeId), count);
}

// ---- Item trigger: hold Enchanter in main hand, right-click ----
world.afterEvents.itemUse.subscribe((event) => {
  const player = event.source;
  const used = event.itemStack;
  if (!player || !used) return;

  const isTools = used.typeId === ENCHANTER_TOOLS;
  const isPvp = used.typeId === ENCHANTER_PVP;
  if (!isTools && !isPvp) return;

  runEnchant(player, isTools, { consume: true, preferHeld: false });
});

// ---- Command trigger: /scriptevent ae:tools  |  /scriptevent ae:pvp ----
// Hold the gear you want and run the command. Free (no Enchanter consumed).
system.afterEvents.scriptEventReceive.subscribe((event) => {
  const id = event.id;
  if (id !== "ae:tools" && id !== "ae:pvp") return;

  const player = event.sourceEntity;
  // Only players have an inventory + on-screen display we can use.
  if (!player || player.typeId !== "minecraft:player") return;

  const isTools = id === "ae:tools";
  runEnchant(player, isTools, { consume: false, preferHeld: true });
});

console.log("[Auto Enchanter] loaded. Items: ae:enchanter_tools / ae:enchanter_pvp. Commands: /scriptevent ae:tools | ae:pvp");
